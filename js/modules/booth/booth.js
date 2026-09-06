/**
 * 挑戰攤位 `#/booth`
 * ------------------------------------------------------------------
 * 規格：docs/06 §4；驗收 C02（掃碼到送出 ≤ 10 秒、≤ 3 次點擊）、C06、C07
 *
 * 工作人員登入後依 `staff.assignment.challengeIds` **直接鎖定自己的關卡**，
 * 整天不需要再選（§4.1）。被指派到兩關以上時才出現選關卡那一步。
 *
 * 四件不可協商：
 *   1. **送出不 await Firestore 的 Promise**（R-UI-002）。離線時它永遠
 *      pending，攤位人員按下送出畫面就卡住。先顯示「已記錄」，真正的
 *      狀態交給 sync.js 的三態燈。
 *   2. **超過次數上限不是硬擋。** 顯示「已達上限（3/3）」但仍可由工作人員
 *      加場送出（`source:'staff'`），現場彈性比嚴格限制重要（§6.2）。
 *   3. **離線時不畫作廢鈕。** 伺服器認可的送出時間還不存在
 *      （`createdAt` 在本機快照是 null），硬畫一顆倒數中的按鈕，
 *      攤位會照著按然後被 rules 擋掉——那就是假成功。
 *   4. **「個人最佳」在送出當下就算出來。** 等 Function 回寫排行榜再顯示
 *      的話，離線時就永遠不會出現，而那正是攤位最需要的即時回饋。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */

import { el, mount, toast, skeleton, emptyState, confirmDialog } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { can, staff, user, onAuth } from '../../core/firebase.js';
import { now as serverNow } from '../../core/clock.js';
import { hold } from '../../core/store.js';
import { hhmm } from '../../lib/format.js';
import {
  formatScore, normalizePlayerId, parseScannedId, pickBest, attemptQuota, myRank, normalizePhone, maskPhone
} from '../../engine/challenge.js';
import {
  inputModeOf, resolveScore, isDuplicate, buildAttempt, submitFeedback,
  quotaState, canVoid, msOf, myChallenges, SUBMIT_LOCK_MS
} from './actions.js';
import * as data from './data.js';
import { syncIndicator } from '../staff/sync-indicator.js';
import { scanSupported, scanOnce } from './scan.js';

export async function boothPage({ scope, view, params, query }) {
  const root = el('div', { class: 'booth' });
  const indicator = syncIndicator();
  mount(view, indicator.node, root);
  mount(root, skeleton(4));

  const state = {
    ready: false, error: null,
    challenges: [], challenge: null,
    // 掃到／輸入的玩家
    playerId: null, player: null, attempts: [],
    // 輸入中的成績
    value: null, detail: null,
    // 送出後的回饋
    result: null,
    recent: [], board: null,
    // 手機相機掃玩家的 QR 會開 #/booth?id=FEDA-0182：代號先填進輸入框，關卡定了就自動查
    idInput: parseScannedId(query?.get('id')) ?? (query?.get('id') ?? ''),
    autoLookup: !!query?.get('id'),
    busy: false, lockUntil: 0,
    sent: []                       // 本機去重用
  };

  hold(scope, onAuth(() => render()), 'auth:booth');

  if (!can('challenge.attempt.write')) {
    mount(root, denied());
    return;
  }

  await load();

  // ── 資料 ─────────────────────────────────────────────────

  async function load() {
    try {
      const all = await data.getChallenges();
      const me = staff();
      state.challenges = myChallenges(all, {
        challengeIds: me?.assignment?.challengeIds ?? [],
        isAdmin: can('perms.manage') || can('team.manage')
      });
      const wanted = params?.challengeId;
      state.challenge = wanted
        ? state.challenges.find(c => c.challengeId === wanted) ?? null
        : (state.challenges.length === 1 ? state.challenges[0] : null);
      state.ready = true;
      state.error = null;
    } catch (err) {
      state.error = err;
      state.ready = true;
    }
    if (state.challenge) watchForChallenge();
    render();
    autoLookupIfReady();
  }

  /** 網址帶了代號、關卡也定了，就替攤位省掉那一下「查詢」 */
  function autoLookupIfReady() {
    if (!state.autoLookup || !state.challenge || !state.idInput) return;
    state.autoLookup = false;
    lookup(state.idInput);
  }

  function watchForChallenge() {
    // ⚠️ onSnapshot 的 onError 不可以傳空函式：缺索引、規則變更、離線降級都走這條路，
    //    吞掉就等於「最近登錄」與作廢鈕靜靜消失、沒有任何線索（驗收 D-03）。
    data.watchMyRecent(scope,
      rows => { state.recent = rows; state.recentError = null; render(); },
      err => { console.warn('[booth] 最近登錄', err); state.recentError = data.explain(err, '讀不到最近登錄的清單。'); render(); });
    data.watchLeaderboard(scope, state.challenge.challengeId,
      b => { state.board = b; render(); },
      err => { console.warn('[booth] 排行榜', err); });
  }

  // ── 動作 ─────────────────────────────────────────────────

  async function scan() {
    try {
      const text = await scanOnce();
      if (!text) return;
      state.idInput = parseScannedId(text) ?? text;
      render();
      lookup(text);
    } catch (err) {
      toast(err.message, 'warn');
    }
  }

  async function lookup(raw) {
    const pid = parseScannedId(raw);
    if (!pid) { toast('ID 格式不對，應該像 FEDA-0182', 'warn'); return; }
    state.busy = true; render();
    try {
      const [player, attempts] = await Promise.all([
        data.getPlayer(pid),
        data.getPlayerAttempts(pid, state.challenge.challengeId)
      ]);
      if (!player) {
        state.busy = false;
        const make = await confirmDialog({
          title: `找不到 ${pid}`,
          body: '這個 ID 還沒有建立過。要現場代建一張 Game Pass 嗎？（玩家手機沒電時用）',
          confirmText: '代建', tone: 'default'
        });
        if (make) await createOnSite(pid);
        render();
        return;
      }
      state.playerId = pid;
      state.player = player;
      state.attempts = attempts;
      resetInput();
    } catch (err) {
      toast(data.explain(err, '查不到玩家。'), 'error');
    } finally {
      state.busy = false; render();
    }
  }

  /**
   * 選定玩家後把輸入區歸零。
   * ⚠️ stepper 的起始值要**真的是那個數字**，不能留 null。
   *    畫面顯示 0 但 state 是 null 的話，「一次都沒中」這個很常見的成績要先按 ＋ 再按 −
   *    才送得出去——而 0 是合法成績。查既有玩家與現場代建**都要走這一支**：
   *    第一版只有查詢那一路歸零，代建的卡送不出 0 分（驗收 D-04）。
   */
  function resetInput() {
    state.value = inputModeOf(state.challenge) === 'stepper'
      ? (state.challenge.minValue ?? 0)
      : null;
    state.detail = null;
    state.result = null;
  }

  async function createOnSite(pid) {
    const nickname = pid;                       // 現場代建先用 ID 當暱稱，玩家之後可自己改
    data.createPlayer({ playerId: pid, nickname, ageBand: null }, `代建 ${pid}`);
    state.playerId = pid;
    state.player = { playerId: pid, nickname, completedChallengeIds: [], luckyDrawEntries: 0 };
    state.attempts = [];
    resetInput();
    toast('已代建，成績可以直接登錄');
  }

  async function submit() {
    const c = state.challenge;
    const r = resolveScore({ challenge: c, value: state.value, detail: state.detail });
    if (!r.ok) { toast(r.reason, 'warn'); return; }

    const nowMs = serverNow();
    const next = { playerId: state.playerId, challengeId: c.challengeId, rawValue: r.rawValue };
    if (isDuplicate(state.sent, next, nowMs)) {
      toast('剛剛已經送過一筆一模一樣的成績了', 'warn');
      return;
    }

    const q = quotaState(state.attempts, c);
    let payload;
    try {
      payload = buildAttempt({
        challenge: c,
        playerId: state.playerId,
        playerNickname: state.player?.nickname ?? null,
        rawValue: r.rawValue,
        detail: r.detail,
        attemptNo: q.nextAttemptNo,
        staffUid: user()?.uid,
        source: q.source,
        atMs: nowMs
      });
    } catch (err) { toast(err.message, 'error'); return; }

    // ⚠️ 不 await（R-UI-002）：離線時 Firestore 的 Promise 永遠 pending。
    //    立刻更新畫面，狀態交給三態燈。
    //
    // ⚠️ 也**不要**在這裡接 catch：`sync.track()` 回傳 `{id, promise}` 而且
    //    永遠不 reject——失敗會變成右上角的紅燈與重試清單。再補一個 toast
    //    等於開了第二條互相競爭的錯誤通道，而三態才是不可協商的那一個。
    data.submitAttempt(payload, `${state.player?.nickname ?? state.playerId}　${payload.doc.displayValue}`);

    state.result = submitFeedback({
      challenge: c, attempts: state.attempts, rawValue: r.rawValue,
      nickname: state.player?.nickname ?? state.playerId
    });
    // 本機先把這一筆加進去，次數與「最佳」立刻正確（Function 稍後會回寫 isBest）
    state.attempts = [...state.attempts, { ...payload.doc, createdAt: null }];
    state.sent = [...state.sent, { ...next, atMs: nowMs }].slice(-20);
    state.lockUntil = nowMs + SUBMIT_LOCK_MS;
    // 送完歸零，讓下一次可以直接按（stepper 回到 minValue，其餘清空）
    state.value = inputModeOf(c) === 'stepper' ? (c.minValue ?? 0) : null;
    state.detail = null;
    render();
    setTimeout(() => render(), SUBMIT_LOCK_MS + 50);
  }

  async function doVoid(a) {
    const v = canVoid(a, { uid: user()?.uid, nowMs: serverNow() });
    if (!v.ok) { toast(v.reason, 'warn'); return; }
    const ok = await confirmDialog({
      title: '作廢這筆成績？',
      body: `${a.playerNickname ?? a.playerId}　${a.displayValue}。作廢之後排行榜會自動退回次佳，紀錄仍然留著。`,
      confirmText: '作廢', tone: 'danger'
    });
    if (!ok) return;
    data.voidAttempt(a.attemptId, '攤位作廢', `作廢 ${a.attemptId}`);
    toast('已作廢');
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function denied() {
    return el('div', { class: 'booth__box booth__box--warn' }, [
      el('strong', { text: '你沒有登錄挑戰成績的權限' }),
      el('p', { class: 'booth__note', text: '這一頁需要「挑戰攤位」以上的身分。如果剛被指派，請重新整理一次。' })
    ]);
  }

  function head() {
    const c = state.challenge;
    return el('div', { class: 'booth__head' }, [
      el('div', { class: 'booth__headIcon' }, icon(c?.icon ?? 'goal')),
      el('div', { class: 'booth__headText' }, [
        el('strong', { text: c?.name ?? '挑戰攤位' }),
        el('span', { class: 'booth__headSub', text: c?.boothLocation ?? '' })
      ])
    ]);
  }

  function pickChallenge() {
    return el('div', {}, [
      el('h3', { class: 'booth__sectionHead', text: '選擇你的關卡' }),
      el('div', { class: 'booth__choices' }, state.challenges.map(c =>
        el('button', {
          class: 'booth__choice', type: 'button',
          onClick: () => { state.challenge = c; watchForChallenge(); render(); autoLookupIfReady(); }
        }, [
          icon(c.icon ?? 'goal'),
          el('span', { class: 'booth__choiceName', text: c.name }),
          el('span', { class: 'booth__choiceNote', text: c.boothLocation ?? '' })
        ])))
    ]);
  }

  function idBox() {
    return el('div', { class: 'booth__box' }, [
      el('label', { class: 'booth__label', for: 'booth-id', text: '玩家 ID' }),
      el('div', { class: 'booth__idRow' }, [
        el('input', {
          class: 'booth__id', id: 'booth-id', type: 'text', inputmode: 'numeric',
          placeholder: 'FEDA-0182', autocomplete: 'off',
          value: state.idInput,
          onInput: e => { state.idInput = e.target.value; },
          onKeyDown: e => { if (e.key === 'Enter') lookup(state.idInput); }
        }),
        el('button', {
          class: 'btn btn--primary btn--lg', type: 'button', disabled: state.busy,
          onClick: () => lookup(state.idInput)
        }, iconText('check', '查詢')),
        // 頁內掃描只在瀏覽器有 BarcodeDetector 時出現（Android Chrome）；
        // 沒有的裝置用手機相機 App 掃，QR 會直接開這一頁並帶入代號
        scanSupported() ? el('button', {
          class: 'btn btn--lg', type: 'button', disabled: state.busy, 'aria-label': '用相機掃描玩家的 QR',
          onClick: () => scan()
        }, iconText('qr', '掃描')) : null
      ]),
      el('p', { class: 'booth__note', text: '用手機相機掃玩家的 QR 會直接開這一頁並帶入代號。掃不到、或玩家手機沒電時，直接輸入卡片上的號碼。' })
    ]);
  }

  function playerBox() {
    const q = quotaState(state.attempts, state.challenge);
    const best = pickBest(state.attempts, state.challenge);
    return el('div', { class: 'booth__box booth__box--player' }, [
      el('div', { class: 'booth__playerTop' }, [
        el('strong', { class: 'booth__nick', text: state.player?.nickname ?? state.playerId }),
        el('span', { class: 'booth__pid', text: state.playerId })
      ]),
      el('p', { class: 'booth__note', text:
        `${q.text}${best.value != null ? `・最佳 ${formatScore(best.value, state.challenge)}` : ''}` }),
      q.exhausted
        ? el('p', { class: 'booth__warn' }, iconText('warn', q.note))
        : null,
      // 中獎聯絡手機（docs/06 §7.2）：攤位代建的卡沒有憑證，只能在這裡替玩家登記
      el('div', { class: 'booth__contact' }, [
        el('input', {
          class: 'booth__id', id: 'booth-phone', type: 'tel', inputmode: 'tel', autocomplete: 'off',
          placeholder: '中獎聯絡手機（選填）', maxlength: '20', 'aria-label': '中獎聯絡手機',
          value: state.contactInput ?? '',
          onInput: e => { state.contactInput = e.target.value; }
        }),
        el('button', {
          class: 'btn btn--sm', type: 'button', id: 'booth-phone-save', disabled: !!state.contactBusy,
          onClick: () => saveContact()
        }, state.contactBusy ? '登記中…' : '登記手機')
      ]),
      state.contactNote ? el('p', { class: 'booth__note', id: 'booth-phone-note', text: state.contactNote }) : null,
      el('button', {
        class: 'booth__clear', type: 'button',
        onClick: () => {
          Object.assign(state, { playerId: null, player: null, attempts: [], value: null, detail: null, result: null, idInput: '', contactInput: '', contactNote: null });
          render();
        }
      }, iconText('close', '換一位'))
    ].filter(Boolean));
  }

  /** 替玩家登記中獎聯絡手機。錯誤留在畫面上（callable 離線會直接失敗） */
  async function saveContact() {
    const phone = normalizePhone(state.contactInput);
    if (!phone) { state.contactNote = '手機號碼要是 09 開頭的 10 碼'; render(); return; }
    state.contactBusy = true; state.contactNote = null; render();
    try {
      const r = await data.setContactByStaff(state.playerId, phone);
      state.contactNote = `已登記 ${r?.maskedPhone ?? maskPhone(phone)}（只用來通知中獎）`;
      state.contactInput = '';
    } catch (err) {
      state.contactNote = data.explain(err, '沒有登記成功，請再試一次。');
    } finally {
      state.contactBusy = false; render();
    }
  }

  // ── 四種輸入介面（docs/06 §4.2）──────────────────────────

  function inputArea() {
    const c = state.challenge;
    const mode = inputModeOf(c);
    if (mode === 'stepper') return stepperInput(c);
    if (mode === 'shots') return shotsInput(c);
    if (mode === 'ladder') return ladderInput(c);
    return numpadInput(c);
  }

  function stepperInput(c) {
    const maxV = Number.isInteger(c.stepperMax) ? c.stepperMax : (c.maxValue ?? 5);
    const v = state.value ?? 0;
    const step = d => { state.value = Math.max(c.minValue ?? 0, Math.min(maxV, v + d)); render(); };
    return el('div', { class: 'booth__stepper' }, [
      el('button', { class: 'booth__stepBtn', type: 'button', 'aria-label': '減一', onClick: () => step(-1) }, '−'),
      el('div', { class: 'booth__stepValue', text: String(v) }),
      el('button', { class: 'booth__stepBtn', type: 'button', 'aria-label': '加一', onClick: () => step(1) }, '＋')
    ]);
  }

  function shotsInput(c) {
    const count = c.shotCount ?? 5;
    const options = c.shotOptions ?? [0, 1, 2, 3];
    const detail = state.detail ?? Array(count).fill(null);
    const total = detail.reduce((s, x) => s + (typeof x === 'number' ? x : 0), 0);
    return el('div', { class: 'booth__shots' }, [
      ...Array.from({ length: count }, (_, i) =>
        el('div', { class: 'booth__shotRow' }, [
          el('span', { class: 'booth__shotNo', text: `第${i + 1}球` }),
          ...options.map(o => el('button', {
            class: `booth__shotBtn${detail[i] === o ? ' is-on' : ''}`, type: 'button',
            'aria-pressed': detail[i] === o ? 'true' : 'false',
            onClick: () => {
              const next = [...detail];
              next[i] = o;
              state.detail = next;
              render();
            }
          }, String(o)))
        ])),
      el('div', { class: 'booth__shotTotal', text: `總分 ${total} ${c.unit ?? ''}` })
    ]);
  }

  function ladderInput(c) {
    const steps = Array.isArray(c.ladderSteps) ? c.ladderSteps : [];
    return el('div', { class: 'booth__ladder' }, [...steps].reverse().map(s =>
      el('button', {
        class: `booth__ladderStep${state.value === s ? ' is-on' : ''}`, type: 'button',
        'aria-pressed': state.value === s ? 'true' : 'false',
        onClick: () => { state.value = s; render(); }
      }, `${s} ${c.unit ?? ''}`)));
  }

  function numpadInput(c) {
    return el('div', { class: 'booth__numpad' }, [
      el('div', { class: 'booth__numValue', text: state.value == null ? '—' : `${state.value} ${c.unit ?? ''}` }),
      el('div', { class: 'booth__keys' }, [
        ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'].map(k =>
          el('button', {
            class: 'booth__key', type: 'button',
            onClick: () => {
              const cur = state.value == null ? '' : String(state.value);
              const next = Number(`${cur}${k}`);
              if (Number.isFinite(next)) { state.value = next; render(); }
            }
          }, k)),
        el('button', {
          class: 'booth__key booth__key--wide', type: 'button', 'aria-label': '清除',
          onClick: () => { state.value = null; render(); }
        }, iconText('close', '清除'))
      ])
    ]);
  }

  function submitBar() {
    const locked = serverNow() < state.lockUntil;
    const r = resolveScore({ challenge: state.challenge, value: state.value, detail: state.detail });
    return el('div', { class: 'booth__submitBar' }, [
      el('button', {
        class: 'btn btn--primary btn--xl', type: 'button',
        disabled: !r.ok || locked,
        onClick: () => submit()
      }, iconText('check', locked ? '請稍候…' : '送出成績')),
      !r.ok && (state.value != null || state.detail)
        ? el('p', { class: 'booth__note', text: r.reason })
        : null
    ].filter(Boolean));
  }

  function resultBox() {
    const rank = state.board ? myRank(state.board.rows ?? [], state.playerId) : null;
    return el('div', { class: 'booth__box booth__box--ok' }, [
      el('strong', {}, iconText('check', '成績已記錄')),
      el('p', { class: 'booth__resultLine', text: state.result.headline }),
      el('p', { class: 'booth__note', text: `${state.result.sub}・${state.result.best}` }),
      rank ? el('p', { class: 'booth__note', text: `目前排名 第 ${rank.rank} 名` }) : null,
      el('p', { class: 'booth__permNote', text: '排名與抽獎資格由伺服器結算，離線時會在恢復連線後補上。' })
    ].filter(Boolean));
  }

  function recentBox() {
    if (state.recentError) {
      return el('div', { class: 'booth__box booth__box--warn', role: 'alert', id: 'booth-recent-error' }, [
        el('strong', { text: '讀不到最近登錄' }),
        el('p', { class: 'booth__note', text: `${state.recentError} 送出的成績仍然有效，只是這裡看不到、也沒辦法作廢，請聯絡主辦。` })
      ]);
    }
    const mine = state.recent.filter(a => a.challengeId === state.challenge?.challengeId).slice(0, 10);
    if (!mine.length) return null;
    return el('div', {}, [
      el('h3', { class: 'booth__sectionHead', text: '最近登錄' }),
      el('ul', { class: 'booth__recent' }, mine.map(a => {
        const v = canVoid(a, { uid: user()?.uid, nowMs: serverNow() });
        const created = msOf(a.createdAt);
        return el('li', { class: `booth__recentRow${a.voided ? ' is-voided' : ''}` }, [
          el('div', { class: 'booth__recentMain' }, [
            el('span', { class: 'booth__recentName', text: a.playerNickname ?? a.playerId }),
            el('span', { class: 'booth__recentMeta', text:
              `${a.displayValue ?? ''}${created ? `・${hhmm(created)}` : '・待同步'}${a.voided ? '・已作廢' : ''}` })
          ]),
          v.ok
            ? el('button', { class: 'booth__voidBtn', type: 'button', onClick: () => doVoid(a) },
                iconText('undo', '作廢'))
            : el('span', { class: 'booth__voidNote', text: a.voided ? '' : v.reason })
        ]);
      }))
    ]);
  }

  function render() {
    if (!state.ready) { mount(root, skeleton(4)); return; }
    if (!can('challenge.attempt.write')) { mount(root, denied()); return; }

    if (state.error) {
      mount(root, el('div', { class: 'booth__box booth__box--warn', role: 'alert' }, [
        el('strong', { text: '讀不到關卡設定' }),
        el('p', { class: 'booth__note', text: data.explain(state.error) }),
        el('button', { class: 'btn btn--lg', type: 'button', onClick: () => load() }, iconText('retry', '再試一次'))
      ]));
      return;
    }

    if (!state.challenges.length) {
      mount(root, emptyState({
        iconName: 'warn', title: '你還沒有被指派到任何攤位',
        note: '請總管在「身分授權」裡指派這個帳號負責的關卡。'
      }));
      return;
    }

    if (!state.challenge) { mount(root, pickChallenge()); return; }

    mount(root,
      head(),
      state.playerId ? playerBox() : idBox(),
      state.playerId && state.result ? resultBox() : null,
      state.playerId ? inputArea() : null,
      state.playerId ? submitBar() : null,
      recentBox()
    );
  }
}
