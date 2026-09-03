/**
 * 我的（專屬首頁）`#/my`
 * ------------------------------------------------------------------
 * 規格：docs/10 §1.3、§1.4；主辦 2026-09-03 指定的資訊架構
 *
 * 登入之後的落點，**每一種身分都是同一條路由**，內容依權限而變
 * （層級越高看得到的功能越多）。四件事：
 *   ① 你是誰（LINE 名稱、uid、身分）
 *   ② 你能做什麼（依 can() 展開的功能區）
 *   ③ 我的球隊
 *   ④ 登出
 *
 * 為什麼不做成 `#/staff-home`、`#/admin-home` 好幾條路由：
 * 一個人可能同時是隊長與記錄員，分成幾條路由就要決定「他登入後該去哪一條」，
 * 而且每加一個層級就多一個入口要維護。同一條路由、內容依權限展開，
 * 新增一個功能只要在 js/config.js 的 FEATURES 加一行。
 *
 * uid 刻意顯示出來而且可以複製：那是跨專案對帳唯一的鍵
 * （飛達盃的 uid 必須等於 FC-Football 的 uid，docs/10 §8.5），
 * 出問題時第一個要對的就是它。
 */

import { el, mount, toast, skeleton } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import { user, staff, onAuth, signOutStaff, db, sdk, can, myRoles } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { logoutLine } from '../../core/liff.js';
import { EVENT_ID, roleLabel, topRole, FEATURES } from '../../config.js';
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
    mount(root, identityCard(), featuresCard(), teamsCard(), playersCard(), signOutRow());
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
            // 顯示最高身分即可。繼承來的那幾個列出來只會讓人以為
            // 自己被指派了一堆職務（記錄員會看到「挑戰攤位、檢錄員、裁判、記錄員」）。
            text: roles.length ? roleLabel(topRole(roles)) : '一般使用者'
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

  // ── 你能做什麼（依權限展開）──────────────────────────────
  //
  // 這一區就是主辦要的「層級越高權限越大功能越多」。
  // 判斷一律走 can()，不要在這裡再列一次角色——角色與權限的對應
  // 只有 js/config.js 一份（R-ROLE-001）。
  function featuresCard() {
    const mine = FEATURES.filter(f => can(f.code));
    if (!mine.length) return null;      // 一般使用者不畫這一區

    const ready = mine.filter(f => f.route);
    const soon = mine.filter(f => !f.route);

    return el('section', { class: 'acct__card' }, [
      el('h2', { class: 'acct__cardHead' }, iconText('list', `我的功能（${mine.length}）`)),
      ready.length
        ? el('div', { class: 'acct__grid' }, ready.map(f => el('button', {
            class: 'acct__tile', type: 'button',
            onClick: () => navigate(f.route)
          }, [
            el('span', { class: 'acct__tileIcon' }, icon(f.icon)),
            el('strong', { class: 'acct__tileLabel', text: f.label }),
            el('span', { class: 'acct__tileHint', text: f.hint })
          ])))
        : null,
      // 還沒做的功能畫成說明列而不是按鈕：按了沒反應是最難回報的故障，
      // 但完全不顯示又會讓人以為自己的身分沒生效。
      soon.length
        ? el('div', { class: 'acct__soon' }, [
            el('p', { class: 'acct__note', text: '你的身分還包含這些功能，介面規劃中：' }),
            el('ul', { class: 'acct__soonList' }, soon.map(f =>
              el('li', {}, [
                el('span', { class: 'acct__soonIcon' }, icon(f.icon)),
                el('span', { text: f.label }),
                el('span', { class: 'acct__soonBadge', text: '規劃中' })
              ])))
          ])
        : null
    ].filter(Boolean));
  }

  // ── 我的球隊 ────────────────────────────────────────────
  function teamsCard() {
    const rows = state.teams;
    return el('section', { class: 'acct__card' }, [
      el('h2', { class: 'acct__cardHead' }, iconText('team', '我的球隊')),
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
