/**
 * 挑戰區首頁 `#/challenge`
 * ------------------------------------------------------------------
 * 規格：docs/06 §8
 *
 * 現場立牌的 QR 掃進來就是這一頁（或公開首頁再分流過來）。它要在
 * **三秒內**回答兩件事：這裡有什麼可以玩、我玩到哪了。
 *
 * 三件不可協商：
 *   1. **還沒有挑戰卡的人也要看得到五關。** 先要求註冊才給看，等於在
 *      攤位前面擋一道；規格第一句就是「免註冊」。
 *   2. **關卡列永遠照 `order` 排。** 那個順序就是立牌上的攤位編號，
 *      現場的人是照號碼找路的。
 *   3. **關卡是設定驅動的。** 一個 `challengeId` 都不准寫死——
 *      驗收 C08 是「新增第六關只要在後台加一筆設定」。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */

import { el, mount, skeleton } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import { can, user, onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { formatScore, completionProgress, settledDrawEntries } from '../../engine/challenge.js';
import * as data from './data.js';
import { savedPass } from './pass.js';

export async function challengeHomePage({ scope, view }) {
  const root = el('div', { class: 'chal' });
  mount(view, root);
  mount(root, skeleton(3));

  const pass = savedPass();

  const state = {
    challenges: undefined,       // undefined = 還沒載入
    player: null,
    bests: [],
    rewards: null,
    error: null
  };
  hold(scope, onAuth(() => render()), 'auth:challenge-home');

  data.getChallenges()
    .then(c => { state.challenges = c; render(); })
    .catch(err => { state.error = err; state.challenges = []; render(); });
  data.getRewards().then(r => { state.rewards = r; render(); }).catch(() => {});

  // 有挑戰卡的人才需要查進度。沒有卡的人這一頁照樣看得到五關
  if (pass) {
    data.watchPlayer(scope, pass.playerId, p => { state.player = p; render(); }, () => {});
    data.getMyBests(pass.playerId).then(b => { state.bests = b; render(); }).catch(() => {});
  }

  // ── 具名函式（會被提升）───────────────────────────────────

  function completedIds() {
    const c = state.player?.completedChallengeIds;
    return Array.isArray(c) ? c : [];
  }

  function bestOf(challengeId) {
    return state.bests.find(b => b.challengeId === challengeId) ?? null;
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function meCard() {
    const progress = completionProgress(completedIds(), state.challenges ?? [], state.rewards);
    const done = progress.done.length;
    const total = progress.total;
    const entries = settledDrawEntries(state.player, state.rewards);

    if (!pass) {
      return el('div', { class: 'chal__card' }, [
        el('strong', { text: '還沒有挑戰卡？' }),
        el('p', { class: 'chal__hint', text: '用 LINE 登入就會配發一張專屬挑戰卡，一個帳號一張。' }),
        el('button', {
          class: 'btn btn--lg btn--primary chal__go', type: 'button',
          onClick: () => navigate('/challenge/join')
        }, iconText('person', '用 LINE 領挑戰卡'))
      ]);
    }

    return el('div', { class: 'chal__card' }, [
      el('div', { class: 'chal__cardHead' }, [
        el('strong', { text: state.player?.nickname ?? pass.playerId }),
        el('span', { class: 'chal__count', text: total ? `${done} / ${total}` : '—' })
      ]),
      entries != null
        ? el('p', { class: 'chal__hint' }, iconText('ticket', `目前有 ${entries} 張抽獎資格`))
        : null,
      progressMeter(progress),
      state.rewards?.rule === 'allChallengesCompleted'
        ? el('p', { class: 'chal__hint', text: entries > 0 ? '七項集章完成，已取得 1 次抽獎機會。'
          : progress.allComplete ? '集章完成，抽獎資格正在由伺服器確認。' : `再完成 ${progress.missing.length} 項，就能取得抽獎機會。` }) : null,
      el('button', {
        class: 'btn btn--lg btn--primary chal__go', type: 'button',
        onClick: () => navigate('/challenge/me')
      }, iconText('qr', '我的 QR'))
    ].filter(Boolean));
  }

  function progressMeter(progress) {
    return el('div', { class: 'chal__stamps', role: 'group', 'aria-label': `已完成 ${progress.done.length} / ${progress.total} 項` },
      progress.required.map((id, i) => el('span', { class: 'chal__stamp', 'data-done': String(progress.done.includes(id)),
        title: state.challenges?.find(c => c.challengeId === id)?.name ?? id,
        'aria-label': `第 ${i + 1} 項${progress.done.includes(id) ? '已完成' : '未完成'}`
      }, progress.done.includes(id) ? icon('check') : String(i + 1))));
  }

  function challengeRow(c) {
    const b = bestOf(c.challengeId);
    const ok = completedIds().includes(c.challengeId);
    return el('li', {}, el('button', {
      class: 'chal__item chal__item--link', type: 'button', 'data-done': String(ok),
      onClick: () => navigate(`/challenge/board/${c.challengeId}`)
    }, [
      el('span', { class: 'chal__itemIcon' }, icon(c.icon || 'target')),
      el('div', { class: 'chal__itemMain' }, [
        el('strong', { class: 'chal__itemName', text: c.shortName || c.name || c.challengeId }),
        el('span', { class: 'chal__itemVenue', text: c.boothLocation ?? '' }),
        c.summary ? el('span', { class: 'chal__itemRule', text: c.summary }) : null
      ]),
      el('span', { class: 'chal__itemScore', text: b ? formatScore(b.rawValue, c) : (ok ? (c.inputMode === 'checkin' ? '已簽到' : '已完成') : '') }),
      el('span', { class: 'chal__itemGo' }, icon('forward'))
    ]));
  }

  function rulesCard() {
    return el('div', { class: 'chal__card chal__card--rules' }, [
      el('strong', {}, iconText('ticket', '集章與抽獎規則')),
      el('ol', { class: 'chal__rules' }, [
        el('li', { text: '用 LINE 領取挑戰卡，到各項目出示同一張 QR。' }),
        el('li', { text: '完成項目後，由現場工作人員登錄集章。中醫運動恢復站只需現場簽到打卡。' }),
        el('li', { text: '七項全部完成，才取得 1 次抽獎機會；重複挑戰不增加抽獎次數。' })
      ]),
      el('p', { class: 'chal__hint', text: '資格由伺服器確認。離線登錄會在恢復連線後更新；作廢紀錄不計入集章。' })
    ]);
  }

  function render() {
    if (state.challenges === undefined) { mount(root, skeleton(3)); return; }

    mount(root,
      el('div', { class: 'chal__hero' }, [
        el('strong', { class: 'chal__heroTitle', text: 'FEDA CUP 挑戰區' }),
        el('p', { class: 'chal__heroSub', text: '七項集章，全數完成才有抽獎機會' })
      ]),

      meCard(),
      rulesCard(),
      el('div', { class: 'chal__card' }, [
        el('strong', { text: '工作人員入口' }),
        el('p', { class: 'chal__hint', text: can('challenge.attempt.write')
          ? '進入負責攤位，以相機掃碼或手動卡號登錄參與及成績。'
          : '請先用 LINE 登入，並由總管授權負責的挑戰攤位。' }),
        el('button', { class: 'btn btn--lg chal__go', type: 'button',
          onClick: () => navigate(user() ? '/booth' : '/login?next=%2Fbooth') }, iconText('qr', '攤位登錄'))
      ]),

      state.error
        ? el('div', { class: 'chal__card chal__card--warn', role: 'alert' }, [
            el('strong', { text: '讀不到關卡' }),
            el('p', { class: 'chal__hint', text: data.explain(state.error) })
          ])
        : null,

      state.challenges.length === 0
        ? el('div', { class: 'chal__card' }, [
            el('strong', { text: '關卡還沒公布' }),
            el('p', { class: 'chal__hint', text: '主辦設定好之後這裡就會出現。' })
          ])
        : el('ul', { class: 'chal__list' }, state.challenges.map(challengeRow)),

      el('button', {
        class: 'btn chal__back', type: 'button', onClick: () => navigate('/')
      }, iconText('back', '回賽事首頁'))
    );
  }
}
