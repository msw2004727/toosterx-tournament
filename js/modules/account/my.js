/**
 * 我的 `#/my`
 * ------------------------------------------------------------------
 * 規格：docs/10 §1.3、§1.4
 *
 * 登入之後的落點。三件事：
 *   ① 你是誰（LINE 名稱、uid、身分）
 *   ② 你帶的球隊
 *   ③ 你報名的球員（M4-b 第二階段，需要 members 的 collectionGroup 查詢）
 *
 * uid 刻意顯示出來而且可以複製：那是跨專案對帳唯一的鍵
 * （飛達盃的 uid 必須等於 FC-Football 的 uid，docs/10 §8.5），
 * 出問題時第一個要對的就是它。
 */

import { el, mount, toast, skeleton } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import { user, staff, onAuth, signOutStaff, db, sdk } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { logoutLine } from '../../core/liff.js';
import { EVENT_ID } from '../../config.js';
import { needLogin } from './login.js';

const ROLE_LABEL = {
  super_admin: '大總管', admin: '管理員', scorer: '記錄員',
  referee: '裁判', booth: '挑戰攤位'
};

const TEAM_STATUS = {
  draft: '草稿', submitted: '待主辦審核', approved: '已通過',
  rejected: '已退回', withdrawn: '已撤銷'
};

export async function myPage({ scope, view }) {
  const root = el('div', { class: 'acct' });
  mount(view, root);

  const state = { teams: null, loading: true };

  // 登入狀態變了就重畫（登出時要退回「請先登入」）。
  // 經過 store.hold 註冊，換頁自動回收（R-UI-003）。
  hold(scope, onAuth(() => render()), 'auth:my');

  render();
  if (user()) { await loadTeams(); }
  state.loading = false;
  render();

  async function loadTeams() {
    try {
      const { collection, getDocs, query, where } = sdk();
      const snap = await getDocs(query(
        collection(db(), 'events', EVENT_ID, 'teams'),
        where('captainUid', '==', user().uid)
      ));
      state.teams = snap.docs.map(d => ({ teamId: d.id, ...d.data() }));
    } catch (err) {
      console.warn('[my] 讀不到球隊', err);
      state.teams = [];
    }
  }

  function render() {
    if (!user()) { mount(root, needLogin('/my')); return; }
    mount(root, identityCard(), teamsCard(), playersCard(), signOutRow());
  }

  // ── 你是誰 ──────────────────────────────────────────────
  function identityCard() {
    const u = user();
    const s = staff();
    const roles = s?.active === true ? (s.roles || []) : [];

    return el('section', { class: 'acct__card' }, [
      el('div', { class: 'acct__me' }, [
        u.photoURL
          ? el('img', { class: 'acct__avatar', src: u.photoURL, alt: '', referrerpolicy: 'no-referrer' })
          : el('span', { class: 'acct__avatar acct__avatar--none' }, icon('person')),
        el('div', { class: 'acct__meText' }, [
          el('strong', { text: u.displayName || '（沒有名稱）' }),
          el('span', {
            class: 'acct__roles',
            text: roles.length ? roles.map(r => ROLE_LABEL[r] || r).join('、') : '一般使用者'
          })
        ])
      ]),

      // uid 是跨專案對帳的鍵，出問題時第一個要看的就是它
      el('div', { class: 'acct__uid' }, [
        el('span', { class: 'acct__uidLabel', text: '你的 ID' }),
        el('code', { class: 'acct__uidValue', text: u.uid }),
        el('button', {
          class: 'btn btn--sm', type: 'button', 'aria-label': '複製 ID',
          onClick: () => copy(u.uid)
        }, iconText('list', '複製'))
      ])
    ]);
  }

  // ── 我帶的球隊 ──────────────────────────────────────────
  function teamsCard() {
    const rows = state.teams;
    return el('section', { class: 'acct__card' }, [
      el('h2', { class: 'acct__cardHead' }, iconText('team', '我帶的球隊')),
      state.loading && rows === null
        ? skeleton(2)
        : !rows?.length
          ? el('div', { class: 'acct__empty' }, [
              el('p', { class: 'acct__note', text: '你還沒有建立球隊。' }),
              el('button', {
                class: 'btn btn--lg btn--primary', type: 'button',
                onClick: () => navigate('/register')
              }, iconText('forward', '我要報名球隊', { trailing: true }))
            ])
          : el('ul', { class: 'acct__list' }, rows.map(t => el('li', {}, [
              el('button', {
                class: 'acct__row', type: 'button',
                onClick: () => navigate(`/team/${encodeURIComponent(t.teamId)}`)
              }, [
                el('span', { class: 'acct__rowMain', text: t.name || t.teamId }),
                el('span', {
                  class: `acct__badge acct__badge--${t.status || 'draft'}`,
                  text: TEAM_STATUS[t.status] || t.status || '草稿'
                }),
                el('span', { class: 'acct__rowSub', text: `${t.memberCount ?? 0} 人` })
              ])
            ])))
    ]);
  }

  // ── 我報名的球員 ────────────────────────────────────────
  function playersCard() {
    // 一個 LINE 帳號可以對應多個球員（docs/10 §1.3）：家長替兩個小孩報名，
    // 兩個小孩在不同球隊，這裡都要列出來。
    //
    // 需要 members 的 collectionGroup 查詢（跨球隊），而那需要一條
    // collection-group 索引與對應的 rules，兩者都還沒開。
    // 在開之前**誠實說還沒有**，不要放一張空表讓人以為自己沒報名成功。
    return el('section', { class: 'acct__card' }, [
      el('h2', { class: 'acct__cardHead' }, iconText('person', '我報名的球員')),
      el('p', { class: 'acct__note', text: '報名流程開放後，你替小孩（或自己）送出的報名會列在這裡。' })
    ]);
  }

  function signOutRow() {
    return el('div', { class: 'acct__foot' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => doSignOut() }, '登出')
    ]);
  }

  async function doSignOut() {
    try {
      await signOutStaff();
      await logoutLine();
      toast('已登出', 'success');
      navigate('/');
    } catch (err) {
      toast(`登出失敗：${err.message}`, 'error');
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('已複製', 'success');
    } catch {
      // 有些瀏覽器在非 https 或沒有使用者手勢時會擋，這時候至少讓人選得到
      toast('這個瀏覽器不允許自動複製，請長按上面的 ID 手動選取。', 'warn');
    }
  }
}
