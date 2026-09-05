/**
 * 人工裁定同分 `#/admin/standings`
 * ------------------------------------------------------------------
 * 規格：docs/02 §10、docs/05 §7.2；競賽規章第十九條
 *
 * ⭐ **這一頁是「完全同分」唯一的出口。** 規章第十九條列了五個順位，
 *    第五項是抽籤——而引擎依 R-ENG-004 不擲骰子，只標 `hasUnresolvedTie`。
 *    在這一頁出現之前，那個標記是死路：晉級永遠解不開、最終排名算不出來，
 *    而且**不會有任何錯誤訊息**，主辦只會看到冠軍賽的隊伍一直寫著
 *    「A組第1名」。U6 只有 3 隊、女子組 5 隊，發生機率不是零。
 *
 * 四件不可協商：
 *   1. **裁定一定要走 callable。** 名次由 `buildStanding` 重算（帶 manualPins），
 *      前端直接寫 `standings/` 的話（rules 對 admin 是放行的）數字會跟管線
 *      分岔，而且晉級不會被解算——那正是這個功能存在的理由。
 *   2. **抽籤要留下種子。** 規章寫的是抽籤，而抽籤的價值在於事後重放得出來。
 *      種子由這一頁產生、寫進稽核紀錄，任何人都能重放（R-ENG-004）。
 *   3. **名次用原本那一群佔的名次，不是 1、2、3。** 第 3、4 名同分時裁定的是
 *      「誰第 3 誰第 4」，寫成 1、2 會把兩隊釘到榜首而且不會報錯。
 *   4. **原因必填。** 申訴時要拿得出「誰、依什麼、在什麼時候裁定的」。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */

import { el, mount, toast, skeleton, confirmDialog } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { can, onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import * as data from './data.js';
import { adminHead, denied } from './bits.js';
import {
  tieGroupsOf, needsRuling, isRuled, pinsFrom, moveInOrder,
  drawTieOrder, newSeed, consequencesOf, namesOf
} from './standing-actions.js';

export async function adminStandingsPage({ scope, view }) {
  const root = el('div', { class: 'adm' });
  mount(view, root);
  mount(root, adminHead('人工裁定同分'), skeleton(3));

  const state = {
    standings: undefined,      // undefined = 還沒載入
    teamsById: {},
    divisions: [],
    orders: {},                // standingId|groupKey → 主辦排好的順序
    seeds: {},                 // standingId|groupKey → 這一次抽籤用的種子
    busy: '', error: null
  };

  if (!can('standing.manual')) { mount(root, denied('人工裁定同分', '管理員')); return; }

  data.watchStandings(scope, rows => {
    state.standings = rows;
    // 伺服器那邊變了就丟掉草稿：草稿是「還沒送出的排序」，
    // 而積分榜一動（有人補記了一顆球）那個排序的前提就不成立了
    state.orders = {};
    render();
  }, err => { state.error = err; state.standings = []; render(); });

  data.getTeams()
    .then(list => { state.teamsById = Object.fromEntries(list.map(t => [t.teamId, t])); render(); })
    .catch(() => {});
  data.getDivisions().then(d => { state.divisions = d; render(); }).catch(() => {});

  hold(scope, onAuth(() => render()), 'auth:admin-standings');

  // ── 具名函式（會被提升）───────────────────────────────────

  // ⚠️ 具名函式（會被提升）。寫成 `const keyOf = …` 的話，替身 SDK 的第一筆
  //    快照同步送達 → render() 在這一行執行**之前**就被呼叫 →
  //    「Cannot access 'keyOf' before initialization」，整頁空白。
  //    這是第七次踩到（CLAUDE.md 有列），E2E 抓得到、單元測試看不到。
  function keyOf(s, g) { return `${s.standingId}|${g.key}`; }

  /** 主辦排好的順序；還沒動過就用積分榜現在的順序 */
  function orderOf(s, g) {
    return state.orders[keyOf(s, g)] ?? g.teamIds;
  }

  function move(s, g, idx, dir) {
    state.orders[keyOf(s, g)] = moveInOrder(orderOf(s, g), idx, dir);
    render();
  }

  function draw(s, g) {
    const seed = newSeed();
    state.seeds[keyOf(s, g)] = seed;
    state.orders[keyOf(s, g)] = drawTieOrder(g.teamIds, seed);
    render();
    toast(`已抽籤（種子 ${seed}）`);
  }

  function divisionName(id) {
    return state.divisions.find(d => d.divisionId === id)?.name ?? id;
  }

  /** 送出裁定。⚠️ callable 會 reject，錯誤一定要留在畫面上。 */
  async function submit(s, g) {
    const order = orderOf(s, g);
    const seed = state.seeds[keyOf(s, g)] ?? null;

    const ok = await confirmDialog({
      title: '送出裁定',
      body: [
        `${divisionName(s.divisionId)} ${s.groupId} 組：`,
        order.map((id, i) => `${g.ranks[i]}. ${state.teamsById[id]?.name ?? id}`).join('\n'),
        '',
        ...consequencesOf({ hasDownstream: true })
      ].join('\n'),
      confirmText: '送出裁定', tone: 'danger'
    });
    if (!ok) return;

    // 用瀏覽器的 prompt 而不是自製對話框：這一頁整場賽事用不到幾次，
    // 少一個自製元件就少一處要在 320px 上驗的版面（同 #/admin/match）。
    let reason = window.prompt('裁定的原因（必填，會寫進稽核紀錄）：',
      seed ? `依競賽規章第十九條抽籤決定（種子 ${seed}）` : '');
    if (reason == null) return;
    reason = String(reason).trim();
    if (!reason) { toast('必須填原因', 'warn'); return; }

    let pins;
    try { pins = pinsFrom(order, g.ranks); }
    catch (err) { toast(err.message, 'warn'); return; }

    state.busy = keyOf(s, g); state.error = null; render();
    try {
      await data.setManualRanking({
        divisionId: s.divisionId, stageId: s.stageId, groupId: s.groupId,
        pins, reason, drawSeed: seed
      });
      toast('已裁定，晉級會自動解算');
    } catch (err) {
      // 留在畫面上，不要只跳一個會自己消失的提示——
      // 「按了沒反應」是最難回報的故障
      state.error = err;
      toast(data.explain(err, '裁定沒有送出。'), 'error');
    } finally {
      state.busy = ''; render();
    }
  }

  async function clearRuling(s) {
    const ok = await confirmDialog({
      title: '解除裁定',
      body: '名次會回到系統自己算的結果。\n如果那一組真的完全同分，會**再次**變回「待裁定」——那是對的，條件真的用盡了。',
      confirmText: '解除裁定', tone: 'danger'
    });
    if (!ok) return;
    let reason = window.prompt('解除的原因（必填，會寫進稽核紀錄）：');
    if (reason == null) return;
    reason = String(reason).trim();
    if (!reason) { toast('必須填原因', 'warn'); return; }

    state.busy = s.standingId; render();
    try {
      await data.setManualRanking({
        divisionId: s.divisionId, stageId: s.stageId, groupId: s.groupId,
        clear: true, reason
      });
      toast('已解除裁定');
    } catch (err) {
      state.error = err;
      toast(data.explain(err, '沒有解除成功。'), 'error');
    } finally {
      state.busy = ''; render();
    }
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function teamRow(s, g, teamId, i) {
    const order = orderOf(s, g);
    const t = state.teamsById[teamId];
    const row = (s.rows || []).find(r => r.teamId === teamId);
    return el('li', { class: 'adm__tieRow' }, [
      el('span', { class: 'adm__tieRank', text: `${g.ranks[i]}` }),
      el('div', { class: 'adm__tieMain' }, [
        el('strong', { class: 'adm__teamName', text: t?.name ?? teamId }),
        el('span', { class: 'adm__tieStat', text: row
          ? `${row.points ?? 0} 分・${row.goalsFor ?? 0}:${row.goalsAgainst ?? 0}・淨 ${row.goalDiff ?? 0}`
          : '' })
      ]),
      el('div', { class: 'adm__tieMove' }, [
        el('button', {
          class: 'btn btn--sm', type: 'button', 'aria-label': `${t?.name ?? teamId} 往上`,
          disabled: i === 0, onClick: () => move(s, g, i, -1)
        }, icon('up')),
        el('button', {
          class: 'btn btn--sm', type: 'button', 'aria-label': `${t?.name ?? teamId} 往下`,
          disabled: i === order.length - 1, onClick: () => move(s, g, i, 1)
        }, icon('down'))
      ])
    ]);
  }

  function tieCard(s, g) {
    const k = keyOf(s, g);
    const order = orderOf(s, g);
    const seed = state.seeds[k] ?? null;
    return el('div', { class: 'adm__box adm__box--warn', 'data-tie': k }, [
      el('strong', {}, iconText('warn', `${divisionName(s.divisionId)}　${s.groupId} 組`)),
      el('p', { class: 'adm__note', text:
        `${namesOf(g.teamIds, state.teamsById)} 在規章第十九條的四項條件下完全相同，第 5 順位是抽籤。` }),
      el('ol', { class: 'adm__tieList' }, order.map((id, i) => teamRow(s, g, id, i))),
      seed != null
        ? el('p', { class: 'adm__permNote', text: `抽籤種子 ${seed}（會寫進稽核紀錄，任何人都能重放）` })
        : null,
      el('div', { class: 'adm__actions' }, [
        el('button', {
          class: 'btn btn--lg', type: 'button', onClick: () => draw(s, g)
        }, iconText('shuffle', '抽籤決定')),
        el('button', {
          class: 'btn btn--lg btn--primary', type: 'button',
          disabled: state.busy === k, onClick: () => submit(s, g)
        }, iconText('check', state.busy === k ? '送出中…' : '送出裁定'))
      ])
    ].filter(Boolean));
  }

  function ruledCard(s) {
    const locked = (s.rows || []).filter(r => r.locked === true);
    return el('div', { class: 'adm__box adm__box--ok' }, [
      el('strong', {}, iconText('check', `${divisionName(s.divisionId)}　${s.groupId} 組　已裁定`)),
      el('p', { class: 'adm__note', text: locked
        .map(r => `${r.rank}. ${state.teamsById[r.teamId]?.name ?? r.teamId}`).join('　') }),
      s.manualOverride?.reason
        ? el('p', { class: 'adm__permNote', text: `原因：${s.manualOverride.reason}` })
        : null,
      Number.isInteger(s.manualOverride?.drawSeed)
        ? el('p', { class: 'adm__permNote', text: `抽籤種子 ${s.manualOverride.drawSeed}` })
        : null,
      el('div', { class: 'adm__actions' }, [
        el('button', {
          class: 'btn', type: 'button',
          disabled: state.busy === s.standingId, onClick: () => clearRuling(s)
        }, iconText('undo', '解除裁定'))
      ])
    ].filter(Boolean));
  }

  function render() {
    if (state.standings === undefined) { mount(root, adminHead('人工裁定同分'), skeleton(3)); return; }

    const pending = [];
    for (const s of state.standings) {
      if (!needsRuling(s)) continue;
      for (const g of tieGroupsOf(s)) pending.push({ s, g });
    }
    const ruled = state.standings.filter(s => isRuled(s) && !needsRuling(s));

    mount(root,
      adminHead('人工裁定同分', { sub: pending.length ? `${pending.length} 組待裁定` : '沒有待裁定的組別' }),

      state.error
        ? el('div', { class: 'adm__box adm__box--warn', role: 'alert' }, [
            el('strong', { text: '裁定沒有完成' }),
            el('p', { class: 'adm__note', text: data.explain(state.error) })
          ])
        : null,

      pending.length === 0
        ? el('div', { class: 'adm__box' }, [
            el('strong', {}, iconText('check', '目前沒有需要裁定的同分')),
            el('p', { class: 'adm__note', text:
              '規章第十九條的前四項條件（對戰關係／正負球數／進球數／被進球數少）分得出勝負時，系統會自己排。四項都相同時這裡才會出現。' })
          ])
        : el('div', { class: 'adm__list' }, pending.map(({ s, g }) => tieCard(s, g))),

      ruled.length
        ? el('div', {}, [
            el('div', { class: 'adm__sectionHead', text: '已裁定' }),
            el('div', { class: 'adm__list' }, ruled.map(ruledCard))
          ])
        : null,

      el('div', { class: 'adm__box' }, [
        el('strong', { text: '為什麼要有這一頁' }),
        el('p', { class: 'adm__note', text:
          '完全同分時系統不會隨機決定名次——那樣主辦事後說不出依據。裁定之後晉級才解得開，冠軍賽的隊伍才填得進去。' })
      ])
    );
  }
}
