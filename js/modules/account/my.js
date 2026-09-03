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
import { EVENT_ID, roleLabel } from '../../config.js';
import { needLogin } from './login.js';

const TEAM_STATUS = {
  draft: '草稿', submitted: '待主辦審核', approved: '已通過',
  rejected: '已退回', withdrawn: '已撤銷'
};

export async function myPage({ scope, view }) {
  const root = el('div', { class: 'acct' });
  mount(view, root);

  const state = { teams: null, profile: null, loading: true };

  // ⚠️ 不可以寫成「掛載時如果已登入就讀一次」。
  //    onAuth 的第一次回呼可能在頁面掛載**之後**才到（Firebase 要先還原
  //    上一次的登入狀態），那時候 user() 還是 null，球隊就永遠不會被載入——
  //    畫面停在「你還沒有建立球隊」，而使用者明明有隊。
  //    所以讀取綁在身分變化上，不是綁在掛載時機上。
  let loadedFor = null;

  async function ensureTeams() {
    const u = user();
    if (!u) { state.teams = null; state.profile = null; loadedFor = null; return; }
    if (loadedFor === u.uid) return;         // 同一個人不重複讀
    loadedFor = u.uid;
    await Promise.all([loadTeams(), loadProfile()]);
  }

  /**
   * LINE 名稱與頭像。
   *
   * ⚠️ 不能用 Firebase 使用者身上的 displayName／photoURL：
   *    custom token 登入不帶這些欄位，永遠是 null——畫面會一直顯示
   *    「（沒有名稱）」，而我們明明拿得到。權威在 users/{uid}，
   *    由 lineLogin Function 在每次登入時更新（docs/10 §1.4）。
   */
  async function loadProfile() {
    try {
      const { doc, getDoc } = sdk();
      const snap = await getDoc(doc(db(), 'users', user().uid));
      state.profile = snap.exists() ? snap.data() : null;
    } catch (err) {
      console.warn('[my] 讀不到使用者名錄', err);
      state.profile = null;
    }
  }

  // onAuth 會立刻用目前的值呼叫一次，所以初次載入也走這條路。
  // 經過 store.hold 註冊，換頁自動回收（R-UI-003）。
  hold(scope, onAuth(async () => {
    await ensureTeams();
    state.loading = false;
    render();
  }), 'auth:my');

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
    const name = state.profile?.displayName || u.displayName || '（沒有名稱）';
    const photo = state.profile?.pictureUrl || u.photoURL || null;

    return el('section', { class: 'acct__card' }, [
      el('div', { class: 'acct__me' }, [
        photo
          ? el('img', { class: 'acct__avatar', src: photo, alt: '', referrerpolicy: 'no-referrer' })
          : el('span', { class: 'acct__avatar acct__avatar--none' }, icon('person')),
        el('div', { class: 'acct__meText' }, [
          el('strong', { text: name }),
          el('span', {
            class: 'acct__roles',
            text: roles.length ? roles.map(roleLabel).join('、') : '一般使用者'
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
