/**
 * 場次改判 `#/admin/match/:matchId`
 * ------------------------------------------------------------------
 * 規格：docs/04 §6（管理員 LIVE 介面）；競賽規章第十八條第 6 款
 *
 * ⭐ 這一頁是**比賽當天記錯分時唯一的補救工具**。在此之前，賽務台送出
 *    完賽超過三分鐘就再也改不動了（rules 分支 D 的視窗過了），
 *    現場只能請主辦直接開 Firestore Console 改資料。
 *
 * 四件不可協商：
 *   1. **每一個動作都必填原因。** 改的是已經公開出去的結果，
 *      「一切可修正、一切留痕」在這裡最需要被遵守。
 *   2. **按下去之前先講後果。** 重開會讓積分榜收回分數、改判會讓名次
 *      當場改變、公開端立刻跟著變——這些都要在確認框裡寫出來。
 *   3. **權限逐項判斷。** 覆核／重開／改判是三條不同的權限碼，
 *      總管可以只關掉其中一條（R-PERM-001）。
 *   4. **棄賽比分不給填。** 規章第十八條第 6 款判 0:2，由引擎算。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */

import { el, mount, toast, skeleton, confirmDialog } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { can, onAuth, user } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { hhmm, dateLabelFromYmd, STATUS_LABEL } from '../../lib/format.js';
import { normalizeAudit, describeAudit } from '../../engine/audit.js';
import {
  APPEAL_ROLES, appealWindow, buildAppealDoc, buildAppealDecision, matchAppealFlag
} from '../../engine/appeal.js';
import { APPEAL_RULES } from '../../engine/formats.js';
import { toMillis, APPEAL_STATUS_LABEL } from '../../lib/format.js';
import { parseYoutubeId } from '../../lib/youtube.js';
import {
  canConfirm, canReopen, canOverride, canWalkover,
  buildConfirmPatch, buildReopenPatch, buildOverridePatch,
  buildWalkoverPatch, buildStatusPatch, consequencesOf, scoreOf, resultOf
} from './match-actions.js';
import * as data from './data.js';
import { adminHead, denied } from './bits.js';

export async function adminMatchPage({ scope, view, params }) {
  const root = el('div', { class: 'adm' });
  mount(view, root);
  mount(root, adminHead('場次改判'), skeleton(4));

  const matchId = params?.matchId;

  const state = {
    match: undefined,          // undefined = 還沒載入；null = 不存在
    audits: [],
    // 改判比分的草稿
    draft: null,
    // 申訴（規章第二十條）：這一場的申訴紀錄、登記表單、裁決意見
    appeals: null,
    appealForm: null,
    decisionNote: '',
    // 單場直播覆蓋（docs/03 §5）
    streamInput: null, streamError: null,
    busy: '', error: null
  };

  hold(scope, onAuth(() => render()), 'auth:admin-match');

  if (!can('match.score.override') && !can('match.confirm') && !can('match.reopen') && !can('appeal.manage')) {
    mount(root, adminHead('場次改判'), denied('場次改判', '管理員'));
    return;
  }

  data.watchMatch(scope, matchId, m => {
    state.match = m;
    // 伺服器的比分變了就重建草稿——但只在自己沒有在編輯時
    if (!state.draft) state.draft = draftFrom(m);
    if (state.streamInput === null) state.streamInput = m?.stream?.videoId ?? '';
    render();
  }, err => { state.error = err; state.match = null; render(); });

  data.getMatchAudits(matchId).then(rows => { state.audits = rows; render(); }).catch(() => {});
  loadAppeals();

  async function loadAppeals() {
    if (!can('appeal.manage')) { state.appeals = []; return; }
    try { state.appeals = await data.getAppealsOf(matchId); }
    catch (err) { console.warn('[admin-match] 讀不到申訴', err); state.appeals = []; }
    render();
  }

  // ── 具名函式（會被提升）───────────────────────────────────

  function draftFrom(m) {
    return {
      home: scoreOf(m?.score?.home) ?? 0,
      away: scoreOf(m?.score?.away) ?? 0,
      pkHome: scoreOf(m?.penaltyScore?.home),
      pkAway: scoreOf(m?.penaltyScore?.away)
    };
  }

  function dirty() {
    const d = state.draft;
    const base = draftFrom(state.match);
    return d && JSON.stringify(d) !== JSON.stringify(base);
  }

  /** 每一個動作都走這一支：問原因 → 講後果 → 寫入 → 留痕 */
  async function act({ action, label, patch, before, after, tone = 'danger', needReason = true }) {
    const lines = consequencesOf(state.match, action);
    const ok = await confirmDialog({
      title: label,
      body: [...lines, needReason ? '' : null].filter(Boolean).join('\n'),
      confirmText: label, tone
    });
    if (!ok) return;

    let reason = null;
    if (needReason) {
      // 用瀏覽器的 prompt 而不是自己做一個對話框：這一頁一天用不到幾次，
      // 而少一個自製元件就少一處要在 320px 上驗的版面。
      reason = window.prompt(`${label}的原因（必填，會寫進稽核紀錄）：`);
      if (reason == null) return;                       // 按了取消
      reason = String(reason).trim();
      if (!reason) { toast('必須填原因', 'warn'); return; }
    }

    state.busy = action; render();
    try {
      await data.patchMatch(matchId, patch);
      await data.writeAudit({
        action: `match.${action}`,
        targetType: 'match', targetId: matchId,
        before, after, reason
      });
      state.draft = null;
      toast('已改判，積分榜會自動重算');
      data.getMatchAudits(matchId).then(rows => { state.audits = rows; render(); }).catch(() => {});
    } catch (err) {
      toast(data.explain(err, '沒有改判成功。'), 'error');
    } finally {
      state.busy = ''; render();
    }
  }

  function doConfirm() {
    return act({
      action: 'confirm', label: '覆核完賽', tone: 'default', needReason: false,
      patch: buildConfirmPatch(user()?.uid),
      before: { status: state.match.status },
      after: { status: 'confirmed' }
    });
  }

  async function doReopen() {
    // 重開要退回**最後打過的那一期**，所以先讀事件流；讀不到就退回第一期（單節組別本來就只有那一期）
    let events = [];
    try { events = await data.getTimeline(state.match.matchId); }
    catch (err) { console.warn('[admin] 讀不到事件流，重開退回第一期', err); }
    return act({
      action: 'reopen', label: '重開場次',
      patch: buildReopenPatch(user()?.uid, events),
      before: { status: state.match.status, result: state.match.result ?? null },
      after: { status: 'live' }
    });
  }

  function doOverride() {
    const d = state.draft;
    let patch;
    try {
      patch = buildOverridePatch({
        score: { home: d.home, away: d.away },
        penaltyScore: { home: d.pkHome, away: d.pkAway },
        match: state.match, uid: user()?.uid
      });
    } catch (err) { toast(err.message, 'warn'); return; }

    return act({
      action: 'override', label: '改判比分',
      patch,
      before: { score: state.match.score ?? null, result: state.match.result ?? null },
      after: { score: patch.score, result: patch.result }
    });
  }

  function doWalkover(side) {
    let patch;
    try { patch = buildWalkoverPatch({ side, uid: user()?.uid }); }
    catch (err) { toast(err.message, 'warn'); return; }
    return act({
      action: 'walkover', label: `判 ${sideName(side)} 棄賽`,
      patch,
      before: { status: state.match.status, score: state.match.score ?? null },
      after: { status: 'walkover', walkoverSide: side, score: patch.score }
    });
  }

  function doStatus(status) {
    const label = status === 'postponed' ? '延期' : '取消';
    return act({
      action: status, label: `${label}這一場`,
      patch: buildStatusPatch(status, user()?.uid),
      before: { status: state.match.status },
      after: { status }
    });
  }

  const sideName = side => (side === 'home' ? state.match?.home?.name : state.match?.away?.name) ?? side;

  // ── 申訴（規章第二十條）─────────────────────────────────

  /** 完賽的時間：賽務台送出完賽的那一刻。沒有就算不出 30 分鐘 */
  function matchEndedAtMs() {
    const m = state.match;
    return toMillis(m?.scoreSubmittedAt) ?? toMillis(m?.lock?.lockedAt) ?? null;
  }

  function newAppealForm() {
    const m = state.match;
    return { teamId: m?.home?.teamId ?? '', role: 'leader', name: '', phone: '', reason: '', depositPaid: false };
  }

  function teamNameOf(teamId) {
    const m = state.match;
    if (m?.home?.teamId === teamId) return m.home.name ?? teamId;
    if (m?.away?.teamId === teamId) return m.away.name ?? teamId;
    return teamId;
  }

  async function doFileAppeal() {
    const f = state.appealForm;
    const nowMs = Date.now();
    const w = appealWindow({ matchEndedAtMs: matchEndedAtMs(), filedAtMs: nowMs });
    let late = false;
    if (w.ready && !w.withinWindow) {
      // 規章不受理逾時的申訴。主辦要破例，先講清楚、再確認，而且文件上會記 late
      const ok = await confirmDialog({
        title: `已超過賽後 ${APPEAL_RULES.windowMin} 分鐘`,
        body: `這一場在 ${Math.round(w.minutesAfter)} 分鐘前結束。規章第二十條：申訴應於賽後三十分鐘內提出，` +
              '逾時不受理。你確定要破例受理嗎？紀錄上會標記「逾時受理」。',
        confirmText: '破例受理', tone: 'danger'
      });
      if (!ok) return;
      late = true;
    }
    let built;
    try {
      built = buildAppealDoc({
        match: state.match, teamId: f.teamId, role: f.role, filerName: f.name, phone: f.phone,
        reason: f.reason, filedAtMs: nowMs, matchEndedAtMs: matchEndedAtMs(),
        depositPaid: f.depositPaid, late, actorUid: user()?.uid ?? null
      });
    } catch (err) { toast(err.message, 'warn'); return; }

    state.busy = 'appeal'; render();
    try {
      await data.saveAppeal(built.appealId, built.doc);
      // 公開端的徽章：只放狀態與隊伍，不放事由與電話
      await data.patchMatch(matchId, { appeal: matchAppealFlag(built.doc) });
      await data.writeAudit({
        action: 'appeal.filed', targetType: 'match', targetId: matchId,
        before: null,
        after: { appealId: built.appealId, teamId: f.teamId, role: f.role, late, minutesAfter: built.doc.minutesAfter },
        reason: built.doc.reason
      });
      state.appealForm = null;
      toast('已登記申訴，公開端會顯示「申訴審理中」');
      await loadAppeals();
    } catch (err) {
      toast(data.explain(err, '沒有登記成功。'), 'error');
    } finally { state.busy = ''; render(); }
  }

  async function doDecideAppeal(a, upheld) {
    let patch;
    try { patch = buildAppealDecision({ upheld, note: state.decisionNote, actorUid: user()?.uid ?? null }); }
    catch (err) { toast(err.message, 'warn'); return; }
    const ok = await confirmDialog({
      title: upheld ? '申訴成立？' : '申訴不成立？',
      body: upheld
        ? `保證金新台幣 ${APPEAL_RULES.deposit.toLocaleString()} 元退還申訴單位。比分若要改，請用上面的改判功能。`
        : `保證金新台幣 ${APPEAL_RULES.deposit.toLocaleString()} 元不予發還（規章第二十條）。以本會之判決為終決。`,
      confirmText: upheld ? '申訴成立' : '申訴不成立', tone: upheld ? 'default' : 'danger'
    });
    if (!ok) return;
    state.busy = 'appeal'; render();
    try {
      await data.decideAppeal(a.appealId, patch);
      await data.patchMatch(matchId, { appeal: matchAppealFlag({ ...a, ...patch }) });
      await data.writeAudit({
        action: 'appeal.decided', targetType: 'match', targetId: matchId,
        before: { appealId: a.appealId, status: a.status },
        after: { appealId: a.appealId, status: patch.status, depositReturned: patch.decision.depositReturned },
        reason: patch.decision.note
      });
      state.decisionNote = '';
      toast(upheld ? '已記錄：申訴成立，退還保證金' : '已記錄：申訴不成立，保證金不予發還');
      await loadAppeals();
    } catch (err) {
      toast(data.explain(err, '沒有記錄成功。'), 'error');
    } finally { state.busy = ''; render(); }
  }

  // ── 單場直播覆蓋（docs/03 §5）──────────────────────────────
  async function doSaveStream() {
    const raw = String(state.streamInput ?? '').trim();
    const videoId = raw ? parseYoutubeId(raw) : null;
    if (raw && !videoId) { state.streamError = '看不出這是 YouTube 影片：請貼影片網址或 11 碼的影片 ID'; render(); return; }
    state.streamError = null;
    const stream = videoId ? { provider: 'youtube', videoId, status: 'live' } : { provider: 'youtube', videoId: null, status: 'off' };
    state.busy = 'stream'; render();
    try {
      await data.patchMatch(matchId, { stream });
      await data.writeAudit({
        action: 'stream.update', targetType: 'match', targetId: matchId,
        before: state.match?.stream ?? null, after: stream, reason: null
      });
      state.streamInput = null;    // 下一筆快照重建
      toast(videoId ? `這一場改用影片 ${videoId}` : '已清掉單場直播，改用場地設定');
    } catch (err) {
      toast(data.explain(err, '沒有儲存成功。'), 'error');
    } finally { state.busy = ''; render(); }
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function headBox() {
    const m = state.match;
    const preview = resultOf(
      { home: state.draft?.home, away: state.draft?.away },
      { home: state.draft?.pkHome, away: state.draft?.pkAway }
    );
    return el('div', { class: 'adm__box' }, [
      el('strong', { text: `${m.home?.name ?? '待定'} vs ${m.away?.name ?? '待定'}` }),
      el('p', { class: 'adm__note', text:
        [m.matchNo ? `第${m.matchNo}場` : null, m.label, m.venueName,
         m.date ? dateLabelFromYmd(m.date) : null, m.kickoffAt ? hhmm(m.kickoffAt) : null]
          .filter(Boolean).join('　·　') }),
      el('p', { class: 'adm__note' }, iconText(
        m.lock?.locked ? 'check' : 'info',
        `目前狀態：${STATUS_LABEL[m.status] ?? m.status}` +
        (m.lock?.locked ? '（已鎖定）' : '') +
        (m.revisionCount ? `・已改判 ${m.revisionCount} 次` : '')
      )),
      // 目前的比分要連 PK 一起看：正規時間平手時勝負是 PK 決定的，只印 2:2 看不出誰晉級
      // （2026-09-06 驗收：「總比分沒加上 PK 比分」）
      currentScoreText(m)
        ? el('p', { class: 'adm__note num', id: 'match-score-now', text: currentScoreText(m) })
        : null,
      preview && dirty()
        ? el('p', { class: 'adm__permNote', text:
            `改判後的判定：${preview.winner === 'draw' ? '和局' : `${sideName(preview.winner)} 勝`}` +
            `（${preview.homePoints}:${preview.awayPoints} 分${preview.method === 'penalty' ? '，PK 決勝' : ''}）` })
        : null
    ].filter(Boolean));
  }

  /** 「目前比分 2:2（PK 4:3）」；沒有比分就 null */
  function currentScoreText(m) {
    const h = scoreOf(m?.score?.home), a = scoreOf(m?.score?.away);
    if (h == null || a == null) return null;
    const ph = scoreOf(m?.penaltyScore?.home), pa = scoreOf(m?.penaltyScore?.away);
    return `目前比分 ${h}:${a}` + (ph != null && pa != null ? `（PK ${ph}:${pa}）` : '');
  }

  function scoreEditor() {
    const g = canOverride(state.match);
    if (!can('match.score.override')) return lockedNote('改判比分', '管理員');
    if (!g.ok) return el('p', { class: 'adm__permNote', text: g.reason });

    const num = (key, label) => el('div', { class: 'adm__field' }, [
      el('label', { class: 'adm__fieldLabel', for: `sc-${key}`, text: label }),
      el('input', {
        class: 'adm__search adm__time', id: `sc-${key}`, type: 'number', min: '0', step: '1',
        value: state.draft[key] == null ? '' : String(state.draft[key]),
        onInput: e => {
          const v = e.target.value === '' ? null : Math.trunc(Number(e.target.value));
          state.draft[key] = Number.isFinite(v) ? v : null;
          render();
        }
      })
    ]);

    return el('div', {}, [
      el('h3', { class: 'adm__sectionHead', id: 'override-section', text: '改判比分' }),
      el('div', { class: 'adm__schedRow' }, [
        num('home', state.match.home?.name ?? '主隊'),
        num('away', state.match.away?.name ?? '客隊')
      ]),
      el('p', { class: 'adm__permNote', text: 'PK 只在正規時間平手時才決定勝負，沒有就留空。' }),
      el('div', { class: 'adm__schedRow' }, [
        num('pkHome', 'PK 主'),
        num('pkAway', 'PK 客')
      ]),
      el('div', { class: 'adm__actions' }, [
        el('button', {
          class: 'btn btn--primary btn--lg', type: 'button',
          disabled: !dirty() || state.busy === 'override',
          onClick: () => doOverride()
        }, iconText('check', '改判比分')),
        dirty()
          ? el('button', {
              class: 'btn btn--lg', type: 'button',
              onClick: () => { state.draft = draftFrom(state.match); render(); }
            }, iconText('undo', '放棄變更'))
          : null
      ].filter(Boolean))
    ]);
  }

  function lockedNote(what, need) {
    return el('p', { class: 'adm__permNote', text: `「${what}」被總管關掉了，或你的身分不足（需要${need}）。` });
  }

  function actionsBox() {
    const m = state.match;
    const confirmG = canConfirm(m);
    const reopenG = canReopen(m);
    const woG = canWalkover(m);

    const row = (label, iconName, guard, permCode, onClick, tone) => {
      if (!can(permCode)) return lockedNote(label, '管理員');
      return el('div', { class: 'adm__perm' }, [
        el('div', { class: 'adm__permMain' }, [
          el('span', { class: 'adm__permLabel', text: label }),
          el('span', { class: 'adm__permMeta', text: guard.ok ? '' : guard.reason })
        ]),
        el('button', {
          class: `btn btn--lg${tone === 'primary' ? ' btn--primary' : ''}`, type: 'button',
          disabled: !guard.ok || !!state.busy,
          onClick
        }, iconText(iconName, label))
      ]);
    };

    return el('div', {}, [
      el('h3', { class: 'adm__sectionHead', text: '狀態' }),
      row('覆核完賽', 'check', confirmG, 'match.confirm', () => doConfirm(), 'primary'),
      row('重開場次', 'undo', reopenG, 'match.reopen', () => doReopen()),

      can('match.score.override') ? el('h3', { class: 'adm__sectionHead', text: '棄賽與延期' }) : null,
      can('match.score.override')
        ? el('div', { class: 'adm__box' }, [
            el('p', { class: 'adm__note', text:
              '競賽規章第十八條第 6 款：逾時 5 分鐘不出場以棄權論 0:2。比分由系統依規章判定，不能手填。' }),
            // 按鈕反灰要說得出為什麼（驗收 D-12）
            !woG.ok ? el('p', { class: 'adm__permMeta', id: 'walkover-reason', text: woG.reason }) : null,
            el('div', { class: 'adm__choices' }, [
              el('button', {
                class: 'adm__choice', type: 'button', disabled: !woG.ok || !!state.busy,
                onClick: () => doWalkover('home')
              }, [
                el('span', { class: 'adm__choiceName', text: `${m.home?.name ?? '主隊'} 棄賽` }),
                el('span', { class: 'adm__choiceNote', text: '對手獲判勝' })
              ]),
              el('button', {
                class: 'adm__choice', type: 'button', disabled: !woG.ok || !!state.busy,
                onClick: () => doWalkover('away')
              }, [
                el('span', { class: 'adm__choiceName', text: `${m.away?.name ?? '客隊'} 棄賽` }),
                el('span', { class: 'adm__choiceNote', text: '對手獲判勝' })
              ])
            ]),
            el('div', { class: 'adm__actions' }, [
              el('button', {
                class: 'btn btn--lg', type: 'button', disabled: !!state.busy,
                onClick: () => doStatus('postponed')
              }, iconText('clock', '延期')),
              el('button', {
                class: 'btn btn--lg', type: 'button', disabled: !!state.busy,
                onClick: () => doStatus('cancelled')
              }, iconText('close', '取消'))
            ])
          ])
        : null
    ].filter(Boolean));
  }

  function appealBox() {
    if (!can('appeal.manage')) return null;
    const m = state.match;
    const list = state.appeals;
    const endedMs = matchEndedAtMs();
    const w = appealWindow({ matchEndedAtMs: endedMs, filedAtMs: Date.now() });
    const windowText = !w.ready
      ? w.reason
      : w.withinWindow
        ? `賽後 ${Math.max(0, Math.round(w.minutesAfter))} 分鐘，還在 ${APPEAL_RULES.windowMin} 分鐘內`
        : `賽後 ${Math.round(w.minutesAfter)} 分鐘，已超過 ${APPEAL_RULES.windowMin} 分鐘（規章不受理，破例要確認）`;

    const items = (list ?? []).map(a => el('div', { class: 'adm__box adm__appeal', dataset: { status: a.status } }, [
      el('strong', { text: `${teamNameOf(a.teamId)}：${APPEAL_STATUS_LABEL[a.status] ?? a.status}` }),
      el('p', { class: 'adm__note', text:
        `${APPEAL_ROLES[a.filedBy?.role] ?? a.filedBy?.role ?? ''} ${a.filedBy?.name ?? ''}` +
        (a.filedBy?.phone ? `・${a.filedBy.phone}` : '') +
        `・賽後 ${a.minutesAfter ?? '?'} 分鐘提出${a.late ? '（逾時受理）' : ''}` +
        `・保證金 ${Number(a.deposit ?? APPEAL_RULES.deposit).toLocaleString()} 元${a.depositPaid ? '已收' : '未收'}` }),
      el('p', { class: 'adm__note', text: `事由：${a.reason ?? ''}` }),
      a.decision
        ? el('div', {}, [
            el('p', { class: 'adm__permNote', text:
              `裁決：${a.decision.note ?? ''}・保證金${a.decision.depositReturned ? '退還' : '不予發還'}` }),
            // 申訴成立多半要跟著改判比分，但裁決與改判是兩個動作（成立也可能只是紀律問題）。
            // 提醒並帶到改判區，不強制（2026-09-06 主辦驗收的建議 M-5）
            a.decision.depositReturned && can('match.score.override')
              ? el('button', {
                  class: 'btn btn--sm', type: 'button', dataset: { act: 'go-override' },
                  onClick: () => document.getElementById('override-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }, iconText('note', '申訴成立要改比分嗎？到「改判比分」'))
              : null
          ].filter(Boolean))
        : el('div', { class: 'adm__field' }, [
            el('label', { class: 'adm__fieldLabel', for: 'ap-note', text: '紀律委員會裁決意見（必填）' }),
            el('textarea', {
              class: 'adm__textarea', id: 'ap-note', rows: '3', value: state.decisionNote,
              placeholder: '例：錄影顯示進球前無越位，維持原判',
              onInput: e => { state.decisionNote = e.target.value; }
            }),
            el('div', { class: 'adm__actions' }, [
              el('button', {
                class: 'btn btn--lg btn--primary', type: 'button', disabled: !!state.busy,
                onClick: () => doDecideAppeal(a, true)
              }, iconText('check', '申訴成立（退還保證金）')),
              el('button', {
                class: 'btn btn--lg', type: 'button', disabled: !!state.busy,
                onClick: () => doDecideAppeal(a, false)
              }, iconText('close', '申訴不成立（保證金沒收）'))
            ])
          ])
    ]));

    const f = state.appealForm;
    const teams = [m.home, m.away].filter(t => t?.teamId);
    const canFile = teams.length === 2 && !(list ?? []).some(a => a.status === 'filed');
    const form = f ? el('div', { class: 'adm__box' }, [
      el('p', { class: 'adm__note', text: `規章第二十條：領隊或總教練於賽後 ${APPEAL_RULES.windowMin} 分鐘內書面提出，並繳納保證金新台幣 ${APPEAL_RULES.deposit.toLocaleString()} 元。這裡登記的是紙本申訴書（附件三）的收件。` }),
      el('p', { class: 'adm__permNote', text: windowText }),
      el('div', { class: 'adm__field' }, [
        el('label', { class: 'adm__fieldLabel', for: 'ap-team', text: '申訴單位' }),
        el('select', { class: 'adm__search', id: 'ap-team', value: f.teamId,
          onChange: e => { f.teamId = e.target.value; } },
          teams.map(t => el('option', { value: t.teamId, text: t.name ?? t.teamId, selected: t.teamId === f.teamId })))
      ]),
      el('div', { class: 'adm__field' }, [
        el('label', { class: 'adm__fieldLabel', for: 'ap-role', text: '申訴人職稱' }),
        el('select', { class: 'adm__search', id: 'ap-role', value: f.role,
          onChange: e => { f.role = e.target.value; } },
          Object.entries(APPEAL_ROLES).map(([k, v]) => el('option', { value: k, text: v, selected: k === f.role })))
      ]),
      el('div', { class: 'adm__field' }, [
        el('label', { class: 'adm__fieldLabel', for: 'ap-name', text: '申訴人姓名（申訴書上親簽的那一位）' }),
        el('input', { class: 'adm__search', id: 'ap-name', type: 'text', value: f.name, maxlength: '30',
          onInput: e => { f.name = e.target.value; } })
      ]),
      el('div', { class: 'adm__field' }, [
        el('label', { class: 'adm__fieldLabel', for: 'ap-phone', text: '聯絡電話' }),
        el('input', { class: 'adm__search', id: 'ap-phone', type: 'tel', value: f.phone, maxlength: '20',
          onInput: e => { f.phone = e.target.value; } })
      ]),
      el('div', { class: 'adm__field' }, [
        el('label', { class: 'adm__fieldLabel', for: 'ap-reason', text: '申訴事由與事實陳述' }),
        el('textarea', { class: 'adm__textarea', id: 'ap-reason', rows: '4', value: f.reason,
          placeholder: '爭議發生的時間點、相關球員／裁判、具體爭議事實',
          onInput: e => { f.reason = e.target.value; } })
      ]),
      el('label', { class: 'adm__checkRow' }, [
        el('input', { type: 'checkbox', id: 'ap-deposit', checked: f.depositPaid,
          onChange: e => { f.depositPaid = e.target.checked; } }),
        el('span', { text: `已收到保證金新台幣 ${APPEAL_RULES.deposit.toLocaleString()} 元（規章第二十條，未收不受理）` })
      ]),
      el('div', { class: 'adm__actions' }, [
        el('button', {
          class: 'btn btn--lg btn--primary', type: 'button', disabled: !!state.busy, id: 'ap-file',
          onClick: () => doFileAppeal()
        }, iconText('check', '登記申訴')),
        el('button', {
          class: 'btn btn--lg', type: 'button', disabled: !!state.busy,
          onClick: () => { state.appealForm = null; render(); }
        }, '取消')
      ])
    ]) : null;

    return el('div', { class: 'adm__appeals' }, [
      el('h3', { class: 'adm__sectionHead', text: `申訴（${(list ?? []).length}）` }),
      list === null ? skeleton(1) : null,
      ...items,
      form,
      !f && canFile
        ? el('div', { class: 'adm__actions' }, [
            el('button', {
              class: 'btn btn--lg', type: 'button', disabled: !!state.busy || !endedMs, id: 'ap-new',
              onClick: () => { state.appealForm = newAppealForm(); render(); }
            }, iconText('note', '登記申訴'))
          ])
        : null,
      !endedMs && !f ? el('p', { class: 'adm__permNote', text: '這一場還沒送出完賽，申訴要等完賽之後才登記得了。' }) : null
    ].filter(Boolean));
  }

  function streamBox() {
    if (!can('stream.manage')) return null;
    const m = state.match;
    const cur = m?.stream?.videoId ?? null;
    return el('div', {}, [
      el('h3', { class: 'adm__sectionHead', text: '這一場的直播' }),
      el('div', { class: 'adm__box' }, [
        el('p', { class: 'adm__note', text: cur
          ? `目前這一場用影片 ${cur}（覆蓋場地設定）。`
          : '目前跟著場地的直播設定（#/admin/stream）。要讓這一場用不同的影片，貼網址或影片 ID。' }),
        el('div', { class: 'adm__field' }, [
          el('label', { class: 'adm__fieldLabel', for: 'st-video', text: '影片網址或 ID（留空＝跟著場地）' }),
          el('input', {
            class: 'adm__search', id: 'st-video', type: 'text', value: state.streamInput ?? '',
            placeholder: 'https://youtu.be/…',
            onInput: e => { state.streamInput = e.target.value; state.streamError = null; }
          }),
          state.streamError ? el('p', { class: 'adm__permNote adm__permNote--err', text: state.streamError }) : null
        ].filter(Boolean)),
        el('div', { class: 'adm__actions' }, [
          el('button', {
            class: 'btn btn--lg', type: 'button', disabled: state.busy === 'stream', id: 'st-save',
            onClick: () => doSaveStream()
          }, iconText('check', '儲存直播設定'))
        ])
      ])
    ]);
  }

  function auditsBox() {
    if (!state.audits.length) return null;
    // 還沒同步的（at 是 null）排最後：Firestore 的 null 最小，而且那一筆
    // 在時間軸上的位置本來就還不確定
    const ms = v => (v?.toMillis ? v.toMillis() : (typeof v === 'number' ? v : Date.parse(v ?? '')));
    const rows = state.audits.map(normalizeAudit).filter(Boolean)
      .sort((a, b) => (ms(b.at) || 0) - (ms(a.at) || 0));
    return el('div', {}, [
      el('h3', { class: 'adm__sectionHead', text: `這一場的改判紀錄（${rows.length}）` }),
      el('ul', { class: 'adm__audits' }, rows.map(a => {
        const d = describeAudit(a);
        return el('li', { class: 'adm__audit' }, [
          el('p', { class: 'adm__auditTitle', text: d.title }),
          ...d.detail.map(t => el('p', { class: 'adm__auditNote', text: t }))
        ]);
      }))
    ]);
  }

  function render() {
    if (state.match === undefined) { mount(root, adminHead('場次改判'), skeleton(4)); return; }

    if (state.error || state.match === null) {
      mount(root, adminHead('場次改判'),
        el('div', { class: 'adm__box adm__box--warn', role: 'alert' }, [
          el('strong', { text: state.match === null ? '找不到這一場' : '讀不到場次' }),
          el('p', { class: 'adm__note', text: state.error ? data.explain(state.error) : `場次代碼 ${matchId}` })
        ]));
      return;
    }

    if (!state.draft) state.draft = draftFrom(state.match);

    mount(root,
      adminHead('場次改判', { sub: state.busy ? '處理中…' : matchId }),
      headBox(),
      el('p', { class: 'adm__permNote', text:
        '這一頁的每一個動作都會寫進稽核紀錄，而且公開端會立刻看到結果。' }),
      scoreEditor(),
      actionsBox(),
      appealBox(),
      streamBox(),
      auditsBox()
    );
  }
}
