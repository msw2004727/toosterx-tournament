/**
 * 賽程管理 `#/admin/schedule`
 * ------------------------------------------------------------------
 * 規格：docs/05 §6；競賽規章第十四條（賽程統一由大會抽籤排定）
 *
 * 五個步驟（docs/05 §6.1）：
 *   1. 分組    抽籤，可手動對調
 *   2. 產生對戰 依賽制範本
 *   3. 排定時間 自動排 ＋ 逐場改
 *   4. 檢查衝突 error 擋發布、warn 只提醒
 *   5. 發布     發布之前公開端看不到
 *
 * 五件不可協商：
 *   1. **抽籤要留下種子。** 規章說「統一由大會代為抽籤排定」，而抽籤最
 *      重要的性質是事後查得到。種子寫進 audits，任何人都能重放同一組分組。
 *   2. **已經開打就不能重新產生。** 重抽一次籤，打完的那幾場會變成不同
 *      小組之間的比賽，積分榜會靜靜算出一份沒有人看得懂的結果。
 *   3. **手動調整是「兩隊對調」，不是「把一隊搬過去」。** 搬一隊會讓兩組
 *      隊數不等，而 8 隊範本的交叉表引用了 A、B 組各四個名次——
 *      少一個名次的那一組，晉級會永遠解不開。
 *   4. **error 擋發布、warn 不擋。** 休息時間規章沒有規定，是我們自己給的
 *      建議值；把它升成錯誤等於系統替主辦訂了一條規章沒有的規則。
 *   5. **整體順延不動已經開打的場次。** 把一場正在進行的比賽往後推，
 *      賽務台的時鐘就跟排定時間對不起來了。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */

import { el, mount, toast, skeleton, confirmDialog, emptyState } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { can, onAuth } from '../../core/firebase.js';
import { now as serverNow } from '../../core/clock.js';
import { hold } from '../../core/store.js';
import { navigate } from '../../core/router.js';
import { hhmm, dateLabelFromYmd } from '../../lib/format.js';
import {
  drawOrder, pickFormatFor, genericFormat, checkSchedule,
  assignMatchNos, shiftMatches, kickoffMsOf, taipeiMs
} from '../../engine/schedule.js';
import {
  approvedTeamsOf, scheduleConfigOf, venuesForDate, canRegenerate,
  planGeneration, planPlacement, matchDocOf, movePatch, drawSeedFrom, NOT_STARTED, hadResult
} from './schedule-actions.js';
import * as data from './data.js';
import { adminHead, denied } from './bits.js';
import { EVENT_ID } from '../../config.js';

export async function adminSchedulePage({ scope, view }) {
  const root = el('div', { class: 'adm' });
  mount(view, root);
  mount(root, adminHead('賽程管理'), skeleton(5));

  if (!can('schedule.manage')) { mount(root, adminHead('賽程管理'), denied('賽程管理', '管理員')); return; }

  const state = {
    ready: false, error: null, busy: '',
    divisions: [], teams: [], venues: [], formats: {}, cfg: null, matches: [],
    divisionId: null,
    draft: null,        // { order:[team], seed:number|null, formatId:string|null }
    picked: null,       // 對調時選取中的 teamId
    shiftFrom: '', shiftMin: 30
  };

  hold(scope, onAuth(() => render()), 'auth:admin-schedule');
  await load();

  // ── 資料 ─────────────────────────────────────────────────

  async function load() {
    try {
      const [divisions, teams, venues, formats, cfg, matches] = await Promise.all([
        data.getDivisions(), data.getTeams(), data.getVenues(),
        data.getFormats(), data.getScheduleConfig(), data.getAllMatches()
      ]);
      Object.assign(state, { divisions, teams, venues, formats, cfg, matches, ready: true, error: null });
      if (!state.divisionId) state.divisionId = divisions[0]?.divisionId ?? null;
      state.draft = null;
    } catch (err) {
      state.error = err;
      state.ready = true;
    }
    render();
  }

  // ── 目前這一組 ───────────────────────────────────────────

  function division() {
    return state.divisions.find(d => d.divisionId === state.divisionId) ?? null;
  }
  function approved() {
    return approvedTeamsOf(state.teams, state.divisionId);
  }
  function existing() {
    return state.matches.filter(m => m.divisionId === state.divisionId);
  }
  function cfg() {
    return scheduleConfigOf(state.cfg);
  }
  function teamsById() {
    return Object.fromEntries(state.teams.map(t => [t.teamId, t]));
  }

  /**
   * 這一組要用的賽制範本。
   *
   * 順序：組別設定上那一個（隊數要對得上）→ 隊數相同的現成範本 →
   * 系統產生的通用範本。**不會**挑一個隊數不合的範本硬套。
   */
  function formatFor() {
    const div = division();
    const n = approved().length;
    const preferred = state.formats[div?.formatId];
    if (preferred?.teamCount === n) return { format: preferred, source: 'division' };
    const found = pickFormatFor(n, state.formats);
    if (found) return { format: found, source: 'matched' };
    if (n >= 2) return { format: generatedFormat(), source: 'generated' };
    return { format: null, source: 'none' };
  }

  function generatedFormat() {
    const n = approved().length;
    const gc = state.draft?.groupCount ?? (n <= 5 ? 1 : 2);
    try { return genericFormat(n, { groupCount: gc }); } catch { return null; }
  }

  function ensureDraft() {
    if (state.draft?.order?.length === approved().length) return state.draft;
    // 已經分過組的話沿用資料庫裡的分組，不要一進頁面就把主辦抽好的結果洗掉
    const list = approved();
    const known = list.filter(t => Number.isInteger(t.seed));
    const order = known.length === list.length
      ? [...list].sort((a, b) => a.seed - b.seed)
      : list;
    // 保留已經抽好的 seed 與選好的組數，只換 order
    state.draft = { seed: null, groupCount: null, ...(state.draft ?? {}), order };
    return state.draft;
  }

  // ── 動作 ─────────────────────────────────────────────────

  function doDraw() {
    const drawGuard = canRegenerate(existing());
    if (!drawGuard.ok) { toast(drawGuard.reason, 'error'); return; }
    const seed = drawSeedFrom(serverNow());
    state.draft = {
      ...(state.draft ?? {}),
      order: drawOrder(approved(), seed),
      seed
    };
    state.picked = null;
    render();
  }

  /** 兩隊對調。**不是**把一隊搬過去——那會讓兩組隊數不等。 */
  function pickTeam(teamId) {
    const d = ensureDraft();
    if (state.picked === teamId) { state.picked = null; render(); return; }
    if (!state.picked) { state.picked = teamId; render(); return; }
    const i = d.order.findIndex(t => t.teamId === state.picked);
    const j = d.order.findIndex(t => t.teamId === teamId);
    if (i >= 0 && j >= 0) {
      const next = [...d.order];
      [next[i], next[j]] = [next[j], next[i]];
      d.order = next;
      d.seed = null;            // 手動動過就不再宣稱這是抽籤的結果
    }
    state.picked = null;
    render();
  }

  async function generate() {
    const div = division();
    const { format, source } = formatFor();
    const d = ensureDraft();
    if (!div || !format) { toast('缺少組別或賽制範本', 'warn'); return; }

    const guard = canRegenerate(existing());
    if (!guard.ok) { toast(guard.reason, 'error'); return; }

    if (existing().length) {
      const ok = await confirmDialog({
        title: '重新產生賽程？',
        body: `會刪掉「${div.name}」現有的 ${existing().length} 場，重新產生一份。已經公開的賽程會跟著變。`,
        confirmText: '重新產生', tone: 'danger'
      });
      if (!ok) return;
    }

    let plan;
    try {
      plan = planGeneration({ division: div, orderedTeams: d.order, format });
    } catch (err) { toast(err.message, 'error'); return; }

    state.busy = 'generate'; render();
    try {
      // 通用範本要先寫進 config/formats：Cloud Functions 解晉級時讀的是那一份，
      // 只改 division.formatId 會讓晉級在比賽當天才失敗
      if (source === 'generated') {
        await data.addFormat(format);
      }
      if (existing().length) await data.deleteMatches(existing().map(m => m.matchId));

      await data.writeStagesAndGroups(div.divisionId, plan.stages, plan.groupDocs);
      await data.writeStandings(div.divisionId, plan.groupDocs, teamsById());
      await data.writeTeamGroups(plan.assignments);
      await data.writeMatches(plan.matches.map(m => ({
        matchId: m.matchId,
        merge: false,
        data: matchDocOf({ m, division: div, eventId: EVENT_ID })
      })));
      await data.updateDivision(div.divisionId, {
        formatId: format.formatId,
        schedulePublished: false,
        draw: { seed: d.seed, at: null, method: d.seed == null ? 'manual' : 'random' }
      });
      await data.writeAudit({
        action: 'schedule.generate',
        targetType: 'division', targetId: div.divisionId,
        before: { matches: existing().length },
        after: { matches: plan.matches.length, formatId: format.formatId, drawSeed: d.seed },
        reason: d.seed == null ? '手動指定分組' : `抽籤（種子 ${d.seed}）`
      });
      toast(`已產生 ${plan.matches.length} 場`);
      await load();
    } catch (err) {
      toast(data.explain(err, '沒有產生成功。'), 'error');
    } finally {
      state.busy = ''; render();
    }
  }

  async function autoPlace() {
    const div = division();
    const mine = existing();
    if (!div || !mine.length) return;

    const venues = venuesForDate(cfg(), div.date, state.venues);
    // 階段的先後**從賽制範本讀**，不要在這裡再寫一份順序表——
    // 這個系統是設定檔驅動的，寫死的那一份遲早跟範本分岔
    const order = stageOrderOf(formatFor().format);
    const { placed, unplaced } = planPlacement({
      division: div,
      matches: mine.map(m => ({ ...m, _sortKey: sortKeyOf(m, order) })),
      otherMatches: state.matches,
      venues, cfg: cfg(), divisions: state.divisions
    });

    if (unplaced.length) {
      toast(`有 ${unplaced.length} 場排不下：${unplaced[0].reason}`, 'warn');
      if (!placed.length) return;
    }

    state.busy = 'place'; render();
    try {
      await data.writeMatches(placed.map(m => ({
        matchId: m.matchId,
        data: movePatch({
          kickoffMs: m.kickoffMs, venueId: m.venueId,
          venueName: state.venues.find(v => v.venueId === m.venueId)?.name ?? m.venueName
        })
      })));
      await renumber(placed.map(m => ({ ...m, kickoffAt: m.kickoffMs })));
      await data.writeAudit({
        action: 'schedule.place',
        targetType: 'division', targetId: div.divisionId,
        before: null, after: { placed: placed.length, unplaced: unplaced.length },
        reason: '自動排定時間與場地'
      });
      toast(`已排定 ${placed.length} 場`);
      await load();
    } catch (err) {
      toast(data.explain(err, '沒有排定成功。'), 'error');
    } finally {
      state.busy = ''; render();
    }
  }

  /**
   * 全賽事流水號。
   *
   * 有場次開打之後就不重編（`frozen`）——那時候重編會讓紙本賽程表與
   * 現場廣播的「第 31 場」全部對不上。
   */
  async function renumber(updatedSubset = []) {
    const merged = state.matches.map(m => {
      const hit = updatedSubset.find(x => x.matchId === m.matchId);
      return hit ? { ...m, kickoffAt: hit.kickoffAt } : m;
    });
    const frozen = merged.some(m => !NOT_STARTED.includes(m.status) || hadResult(m));
    const nos = assignMatchNos(merged, { frozen });
    if (!nos.length) return;
    await data.writeMatches(nos.map(n => ({ matchId: n.matchId, data: { matchNo: n.matchNo } })));
  }

  async function moveOne(match, patch) {
    state.busy = match.matchId; render();
    try {
      await data.writeMatches([{ matchId: match.matchId, data: patch }]);
      await data.writeAudit({
        action: 'schedule.move',
        targetType: 'match', targetId: match.matchId,
        before: { kickoffAt: kickoffMsOf(match), venueId: match.venueId ?? null },
        after: { kickoffAt: patch.kickoffAt ? patch.kickoffAt.getTime() : null, venueId: patch.venueId },
        reason: null
      });
      // patch 一定同時帶時間與場地，所以整包套用——用 `??` 保留舊值的話，
      // 「把時間清掉」會變成「什麼都沒發生」，而畫面看起來像成功了
      const i = state.matches.findIndex(m => m.matchId === match.matchId);
      if (i >= 0) state.matches[i] = { ...state.matches[i], ...patch };
      toast('已更新');
    } catch (err) {
      toast(data.explain(err, '沒有更新成功。'), 'error');
    } finally {
      state.busy = ''; render();
    }
  }

  async function doShift() {
    const from = state.shiftFrom;
    const mins = state.shiftMin;
    const target = existing().find(m => m.matchId === from);
    const fromMs = target ? kickoffMsOf(target) : null;
    if (fromMs == null) { toast('請先選一個起點場次', 'warn'); return; }
    if (!Number.isInteger(mins) || mins === 0) { toast('順延分鐘要是非零整數', 'warn'); return; }

    let plan;
    try {
      plan = shiftMatches(existing(), { fromMs, deltaMin: mins });
    } catch (err) { toast(err.message, 'warn'); return; }

    if (!plan.updates.length) { toast('沒有可以順延的場次', 'warn'); return; }

    const ok = await confirmDialog({
      title: `順延 ${mins} 分鐘？`,
      body: `${plan.updates.length} 場會往${mins > 0 ? '後' : '前'}移。` +
        (plan.skipped.length ? `已開打的 ${plan.skipped.length} 場不動。` : '') +
        '公開端會立刻跟著變。',
      confirmText: '順延', tone: 'danger'
    });
    if (!ok) return;

    state.busy = 'shift'; render();
    try {
      await data.writeMatches(plan.updates.map(u => ({
        matchId: u.matchId, data: { kickoffAt: new Date(u.kickoffMs) }
      })));
      await data.writeAudit({
        action: 'schedule.shift',
        targetType: 'division', targetId: state.divisionId,
        before: { fromMs }, after: { deltaMin: mins, moved: plan.updates.length },
        reason: `整體順延 ${mins} 分鐘`
      });
      toast(`已順延 ${plan.updates.length} 場`);
      await load();
    } catch (err) {
      toast(data.explain(err, '沒有順延成功。'), 'error');
    } finally {
      state.busy = ''; render();
    }
  }

  async function setPublished(next) {
    const div = division();
    if (next) {
      const { findings } = report();
      if (findings.some(f => f.level === 'error')) { toast('還有必須修正的問題，不能發布', 'warn'); return; }
    } else {
      const ok = await confirmDialog({
        title: '收回發布？',
        body: `「${div.name}」的賽程會從公開端消失。已經看過的人會以為賽程被取消了。`,
        confirmText: '收回', tone: 'danger'
      });
      if (!ok) return;
    }
    state.busy = 'publish'; render();
    try {
      // 發布是這份賽程定案的時刻，場次號在這裡補齊。
      // 逐場改時間時不補：每改一格就重編一次號碼，會產生一整批
      // 沒有必要的寫入，而且每一筆都要留痕。
      if (next) await renumber();
      await data.updateDivision(div.divisionId, { schedulePublished: next });
      await data.writeAudit({
        action: next ? 'schedule.publish' : 'schedule.unpublish',
        targetType: 'division', targetId: div.divisionId,
        before: { schedulePublished: div.schedulePublished !== false },
        after: { schedulePublished: next },
        reason: null
      });
      toast(next ? '已發布，公開端看得到了' : '已收回');
      await load();
    } catch (err) {
      toast(data.explain(err, '沒有更新成功。'), 'error');
    } finally {
      state.busy = ''; render();
    }
  }

  // ── 檢查 ─────────────────────────────────────────────────

  /**
   * 衝突檢查一律看**全賽事**的場次。
   * 只看自己這一組的話，兩個組別排到同一片場地的同一個時段是看不出來的。
   */
  function report() {
    const c = cfg();
    return checkSchedule({
      matches: state.matches, venues: state.venues, divisions: state.divisions,
      minRestMin: c.minRestMin, maxGapMin: c.maxGapMin
    });
  }

  /** 這一組相關的 findings（全賽事檢查，但只顯示碰得到這一組的） */
  function myFindings() {
    const ids = new Set(existing().map(m => m.matchId));
    return report().findings.filter(f => !f.matchIds?.length || f.matchIds.some(id => ids.has(id)));
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function divisionTabs() {
    return el('div', { class: 'adm__tabs', role: 'tablist' }, state.divisions.map(d => {
      const n = state.matches.filter(m => m.divisionId === d.divisionId).length;
      const on = d.divisionId === state.divisionId;
      return el('button', {
        class: `adm__tab${on ? ' is-on' : ''}`, type: 'button',
        role: 'tab', 'aria-selected': on ? 'true' : 'false',
        onClick: () => { state.divisionId = d.divisionId; state.draft = null; state.picked = null; render(); }
      }, [
        el('span', { text: d.shortName || d.name }),
        el('span', { class: 'adm__tabCount', text: String(n) })
      ]);
    }));
  }

  function statusBox() {
    const div = division();
    const mine = existing();
    const published = div?.schedulePublished !== false;
    const n = approved().length;
    const started = mine.filter(m => !NOT_STARTED.includes(m.status) || hadResult(m)).length;

    return el('div', { class: `adm__box ${mine.length && published ? 'adm__box--ok' : ''}` }, [
      el('strong', {}, iconText(
        mine.length === 0 ? 'info' : published ? 'check' : 'warn',
        mine.length === 0 ? '還沒有賽程'
          : published ? '已發布，公開端看得到' : '未發布，只有管理員看得到'
      )),
      el('p', { class: 'adm__note', text:
        `${div?.name ?? ''}：已核准 ${n} 隊、${mine.length} 場` +
        (started ? `，其中 ${started} 場已開打` : '') +
        (div?.date ? `。比賽日 ${dateLabelFromYmd(div.date)}` : '。這一組沒有設定比賽日期，排不了時間') }),
      // 未發布不是安全邊界，要講清楚——matches 的讀取規則是公開的
      mine.length && !published
        ? el('p', { class: 'adm__permNote', text: '「未發布」只是公開端不顯示，資料本身仍然讀得到。真的機密的東西不要放在這裡。' })
        : null
    ].filter(Boolean));
  }

  function formatBox() {
    const div = division();
    const n = approved().length;
    const { format, source } = formatFor();

    if (n === 0) {
      return el('div', { class: 'adm__box adm__box--warn' }, [
        el('strong', { text: '這一組還沒有核准的球隊' }),
        el('p', { class: 'adm__note', text: '賽程要等報名審核通過之後才產生得出來。' }),
        el('button', {
          class: 'btn btn--lg', type: 'button',
          onClick: () => navigate('/admin/teams')
        }, iconText('check', '去報名審核'))
      ]);
    }
    if (!format) {
      return el('div', { class: 'adm__box adm__box--warn' }, [
        el('strong', { text: `${n} 隊排不出賽程` }),
        el('p', { class: 'adm__note', text: '至少要 2 隊。' })
      ]);
    }

    const note = {
      division: '這是組別設定上的賽制範本。',
      matched: `組別設定的範本隊數對不上，改用隊數相同的「${format.name}」。`,
      generated: `沒有 ${n} 隊的現成範本，由系統產生一份。產生賽程時會一併存進賽制設定。`
    }[source];

    return el('div', { class: 'adm__box' }, [
      el('strong', {}, iconText('table', format.name)),
      el('p', { class: 'adm__note', text: format.description ?? '' }),
      el('p', { class: 'adm__permNote', text: note }),
      source === 'generated' && n >= 4 ? groupCountPicker() : null
    ].filter(Boolean));
  }

  function groupCountPicker() {
    const current = state.draft?.groupCount ?? (approved().length <= 5 ? 1 : 2);
    return el('div', { class: 'adm__field' }, [
      el('span', { class: 'adm__fieldLabel', text: '要分幾組' }),
      el('div', { class: 'adm__choices' }, [1, 2].map(gc =>
        el('button', {
          class: `adm__choice${current === gc ? ' is-on' : ''}`, type: 'button',
          onClick: () => { ensureDraft(); state.draft.groupCount = gc; render(); }
        }, [
          el('span', { class: 'adm__choiceName', text: gc === 1 ? '一組單循環' : '兩組＋名次對決' }),
          el('span', { class: 'adm__choiceNote', text: gc === 1 ? '每隊都跟每隊打一次' : '分組循環之後同名次對決' })
        ])))
    ]);
  }

  function drawBox() {
    const d = ensureDraft();
    const { format } = formatFor();
    if (!format) return null;
    const rr = (format.stages ?? []).find(s => s.type === 'roundRobin');
    const gc = rr?.groupCount ?? 1;
    const groups = splitPreview(d.order, gc);

    return el('div', {}, [
      el('h3', { class: 'adm__sectionHead', text: '1. 分組' }),
      el('div', { class: 'adm__box' }, [
        el('p', { class: 'adm__note', text: d.seed == null
          ? '目前是手動指定的順序。規章第十四條寫的是「統一由大會代為抽籤排定」——按下面的抽籤鈕會記錄亂數種子，事後查得到。'
          : `抽籤種子 ${d.seed}。同一個種子永遠得到同一組分組，這是抽籤的證據。` }),
        // 已經開打就不給重新抽籤：抽籤只改草稿，但草稿一產生就會覆蓋已打完的分組（驗收 D-09）
        !canRegenerate(existing()).ok
          ? el('p', { class: 'adm__note', id: 'draw-locked', text: canRegenerate(existing()).reason })
          : null,
        el('button', {
          class: 'btn btn--lg', type: 'button', disabled: !!state.busy || !canRegenerate(existing()).ok,
          onClick: () => doDraw()
        }, iconText('retry', d.seed == null ? '抽籤' : '重新抽籤'))
      ]),

      ...groups.map((g, gi) => el('div', { class: 'adm__field' }, [
        el('span', { class: 'adm__fieldLabel', text: gc === 1 ? '參賽隊伍' : `${String.fromCharCode(65 + gi)}組（${g.length} 隊）` }),
        el('div', { class: 'adm__chips' }, g.map(t =>
          el('button', {
            class: `adm__chip${state.picked === t.teamId ? ' is-on' : ''}`, type: 'button',
            disabled: gc === 1 || !!state.busy,
            'aria-pressed': state.picked === t.teamId ? 'true' : 'false',
            onClick: () => pickTeam(t.teamId)
          }, t.shortName || t.name || t.teamId)))
      ])),

      gc > 1
        ? el('p', { class: 'adm__permNote', text: state.picked
            ? '再點另一組的一隊就會對調。'
            : '要調整分組：點一隊，再點另一組的一隊，兩隊對調。（只能對調，不能單獨搬走——兩組隊數不等的話，名次賽會少一個對手。）' })
        : null
    ].filter(Boolean));
  }

  function generateBox() {
    const { format } = formatFor();
    const mine = existing();
    const guard = canRegenerate(mine);
    if (!format) return null;
    const count = countMatches(format, approved().length);

    return el('div', {}, [
      el('h3', { class: 'adm__sectionHead', text: '2. 產生對戰' }),
      !guard.ok
        ? el('div', { class: 'adm__box adm__box--warn' }, [
            el('strong', { text: '不能重新產生' }),
            el('p', { class: 'adm__note', text: guard.reason }),
            el('p', { class: 'adm__permNote', text: '重抽一次籤，已經打完的那幾場會變成不同小組之間的比賽，積分榜會算出一份沒有人看得懂的結果。' })
          ])
        : el('div', { class: 'adm__actions' }, [
            el('button', {
              class: 'btn btn--primary btn--lg', type: 'button',
              disabled: state.busy === 'generate',
              onClick: () => generate()
            }, iconText('table', mine.length ? `重新產生 ${count} 場` : `產生 ${count} 場`))
          ])
    ]);
  }

  function placeBox() {
    const div = division();
    const c = cfg();
    const venues = venuesForDate(c, div?.date, state.venues);
    return el('div', {}, [
      el('h3', { class: 'adm__sectionHead', text: '3. 排定時間與場地' }),
      el('div', { class: 'adm__box' }, [
        el('p', { class: 'adm__note', text:
          `${c.startTime}–${c.endTime}、每場 ${div?.matchDurationMin ?? '?'} 分 ＋ 緩衝 ${c.bufferMin} 分、休息下限 ${c.minRestMin} 分。` }),
        venues.length
          ? el('p', { class: 'adm__permNote', text: `當天可用場地：${venues.map(v => v.name).join('、')}` })
          : el('p', { class: 'adm__permNote' }, iconText('warn', '這一天沒有設定可用場地，排不出時間。')),
        !c.saved
          ? el('p', { class: 'adm__permNote', text: '（這些是預設值，還沒有存進 config/schedule。）' })
          : null
      ].filter(Boolean)),
      el('div', { class: 'adm__actions' }, [
        el('button', {
          class: 'btn btn--lg', type: 'button',
          disabled: state.busy === 'place' || !venues.length,
          onClick: () => autoPlace()
        }, iconText('clock', '自動排定'))
      ])
    ]);
  }

  function matchRow(m) {
    const div = division();
    const c = cfg();
    const ms = kickoffMsOf(m);
    const parts = ms == null ? { date: div?.date ?? '', time: '' } : msToTaipei(ms);
    // 延期／取消但已有結果的場次也算鎖定：時間可以改，但要進改判頁才能動結果（驗收 D-10）
    const locked = !NOT_STARTED.includes(m.status) || hadResult(m);
    const venues = venuesForDate(c, div?.date, state.venues);

    return el('div', { class: 'adm__item' }, [
      el('div', { class: 'adm__itemHead' }, [
        el('div', { class: 'adm__itemMain' }, [
          el('span', { class: 'adm__teamName', text: `${m.home?.displayName ?? '待定'} vs ${m.away?.displayName ?? '待定'}` }),
          el('span', { class: 'adm__teamMeta', text:
            `${m.matchNo ? `第${m.matchNo}場・` : ''}${m.label ?? ''}${m.venueName ? `・${m.venueName}` : ''}` })
        ]),
        locked ? el('span', { class: 'adm__badge', text: m.status }) : null
      ].filter(Boolean)),

      // 已經開打的場次時間與場地改不了，但**比分還是要有地方改**——
      // 賽務台送出完賽超過三分鐘就鎖住了，這裡是唯一的入口
      locked
        ? el('div', { class: 'adm__schedRow' }, [
            el('p', { class: 'adm__permNote', text: '已經開打，時間與場地不能在這裡改。' }),
            can('match.score.override') || can('match.confirm') || can('match.reopen')
              ? el('button', {
                  class: 'btn btn--lg', type: 'button',
                  onClick: () => navigate(`/admin/match/${encodeURIComponent(m.matchId)}`)
                }, iconText('note', '覆核／改判'))
              : null
          ].filter(Boolean))
        : el('div', { class: 'adm__schedRow' }, [
            el('input', {
              class: 'adm__search adm__time', type: 'time', value: parts.time,
              'aria-label': `${m.matchId} 開賽時間`,
              disabled: state.busy === m.matchId,
              onChange: e => {
                const next = taipeiMs(div?.date, e.target.value);
                if (next == null) { toast('時間格式不對', 'warn'); return; }
                moveOne(m, movePatch({ kickoffMs: next, venueId: m.venueId, venueName: m.venueName }));
              }
            }),
            el('select', {
              class: 'adm__search', 'aria-label': `${m.matchId} 場地`,
              disabled: state.busy === m.matchId,
              onChange: e => {
                const v = state.venues.find(x => x.venueId === e.target.value);
                moveOne(m, movePatch({ kickoffMs: ms, venueId: v?.venueId ?? null, venueName: v?.name ?? null }));
              }
            }, [
              el('option', { value: '', text: '（未指定）', selected: !m.venueId }),
              ...venues.map(v => el('option', { value: v.venueId, text: v.name, selected: v.venueId === m.venueId }))
            ])
          ])
    ].filter(Boolean));
  }

  function listBox() {
    const mine = [...existing()].sort((a, b) => {
      const ka = kickoffMsOf(a), kb = kickoffMsOf(b);
      if (ka != null && kb != null && ka !== kb) return ka - kb;
      if (ka == null && kb != null) return 1;
      if (ka != null && kb == null) return -1;
      return String(a.matchId).localeCompare(String(b.matchId));
    });
    return el('div', { class: 'adm__list' }, mine.map(matchRow));
  }

  function checkBox() {
    const findings = myFindings();
    const errs = findings.filter(f => f.level === 'error');
    return el('div', {}, [
      el('h3', { class: 'adm__sectionHead', text: '4. 檢查衝突' }),
      findings.length === 0
        ? el('div', { class: 'adm__box adm__box--ok' }, [
            el('strong', {}, iconText('check', '沒有發現問題'))
          ])
        : el('ul', { class: 'adm__checks' }, findings.map(f =>
            el('li', { class: `adm__check adm__check--${f.level}` }, [
              icon(f.level === 'error' ? 'warn' : 'info'),
              el('span', { class: 'adm__checkText' }, [
                el('span', { text: f.message }),
                el('span', { class: 'adm__checkSrc', text:
                  f.level === 'error' ? `${f.source}・必須修正才能發布` : `${f.source}・仍然可以發布` })
              ])
            ]))),
      errs.length
        ? el('p', { class: 'adm__permNote', text: '衝突檢查看的是全賽事的場次，所以別的組別排到同一片場地也會出現在這裡。' })
        : null
    ].filter(Boolean));
  }

  function shiftBox() {
    const movable = existing()
      .filter(m => NOT_STARTED.includes(m.status) && kickoffMsOf(m) != null)
      .sort((a, b) => kickoffMsOf(a) - kickoffMsOf(b));
    if (!movable.length) return null;
    if (!state.shiftFrom) state.shiftFrom = movable[0].matchId;

    return el('div', {}, [
      el('h3', { class: 'adm__sectionHead', text: '整體順延（雨天）' }),
      el('div', { class: 'adm__box' }, [
        el('p', { class: 'adm__note', text: '選一個起點，那一場與之後的全部往後移。已經開打的不動。' }),
        el('div', { class: 'adm__schedRow' }, [
          el('select', {
            class: 'adm__search', 'aria-label': '從哪一場開始順延',
            onChange: e => { state.shiftFrom = e.target.value; }
          }, movable.map(m => el('option', {
            value: m.matchId, selected: m.matchId === state.shiftFrom,
            text: `${hhmm(kickoffMsOf(m))} ${m.home?.displayName ?? ''} vs ${m.away?.displayName ?? ''}`
          }))),
          el('input', {
            class: 'adm__search adm__time', type: 'number', step: '5', value: String(state.shiftMin),
            'aria-label': '順延分鐘',
            onInput: e => { state.shiftMin = Math.trunc(Number(e.target.value)) || 0; }
          })
        ]),
        el('button', {
          class: 'btn btn--lg', type: 'button', disabled: state.busy === 'shift',
          onClick: () => doShift()
        }, iconText('clock', '順延'))
      ])
    ]);
  }

  function publishBox() {
    const div = division();
    const published = div?.schedulePublished !== false;
    const blocked = myFindings().some(f => f.level === 'error');
    return el('div', {}, [
      el('h3', { class: 'adm__sectionHead', text: '5. 發布' }),
      el('div', { class: 'adm__actions' }, [
        published
          ? el('button', {
              class: 'btn btn--lg', type: 'button', disabled: state.busy === 'publish',
              onClick: () => setPublished(false)
            }, iconText('undo', '收回發布'))
          : el('button', {
              class: 'btn btn--primary btn--lg', type: 'button',
              disabled: state.busy === 'publish' || blocked,
              onClick: () => setPublished(true)
            }, iconText('check', '發布賽程'))
      ]),
      blocked && !published
        ? el('p', { class: 'adm__permNote', text: '上面還有必須修正的問題，修好才發布得出去。' })
        : null
    ].filter(Boolean));
  }

  function render() {
    if (!state.ready) { mount(root, adminHead('賽程管理'), skeleton(5)); return; }
    if (!can('schedule.manage')) { mount(root, adminHead('賽程管理'), denied('賽程管理', '管理員')); return; }

    if (state.error) {
      mount(root, adminHead('賽程管理'),
        el('div', { class: 'adm__box adm__box--warn', role: 'alert' }, [
          el('strong', { text: '讀不到賽程資料' }),
          el('p', { class: 'adm__note', text: data.explain(state.error) }),
          el('button', { class: 'btn btn--lg', type: 'button', onClick: () => load() }, iconText('retry', '再試一次'))
        ]));
      return;
    }

    if (!state.divisions.length) {
      mount(root, adminHead('賽程管理'),
        emptyState({ iconName: 'table', title: '還沒有組別', note: '組別設定好之後才排得了賽程。' }));
      return;
    }

    const mine = existing();
    mount(root,
      adminHead('賽程管理', { sub: state.busy ? '處理中…' : null }),
      divisionTabs(),
      statusBox(),
      formatBox(),
      approved().length >= 2 ? drawBox() : null,
      approved().length >= 2 ? generateBox() : null,
      mine.length ? placeBox() : null,
      mine.length ? listBox() : null,
      mine.length ? checkBox() : null,
      mine.length ? shiftBox() : null,
      mine.length ? publishBox() : null
    );
  }
}

// ── 小工具 ───────────────────────────────────────────────────

/** 分組預覽（跟 buildGroups 的蛇形一致，只是不需要完整的隊伍物件） */
function splitPreview(ordered, groupCount) {
  const groups = Array.from({ length: groupCount }, () => []);
  ordered.forEach((t, i) => {
    const row = Math.floor(i / groupCount);
    const col = i % groupCount;
    groups[row % 2 === 0 ? col : groupCount - 1 - col].push(t);
  });
  return groups;
}

/** 這個範本在這個隊數下會產生幾場 */
function countMatches(format, teamCount) {
  const rr = (format.stages ?? []).find(s => s.type === 'roundRobin');
  const gc = rr?.groupCount ?? 1;
  const sizes = Array.from({ length: gc }, (_, g) =>
    Math.floor(teamCount / gc) + (teamCount % gc > g ? 1 : 0));
  const rrCount = sizes.reduce((n, s) => n + (s < 2 ? 0 : (s * (s - 1)) / 2), 0);
  const ko = (format.stages ?? [])
    .filter(s => s.type !== 'roundRobin')
    .reduce((n, s) => n + (s.slots?.length ?? 0), 0);
  return rrCount + ko;
}

/** 毫秒 → 台北時區的 `YYYY-MM-DD` 與 `HH:MM` */
function msToTaipei(ms) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const p = Object.fromEntries(f.formatToParts(ms).map(x => [x.type, x.value]));
  const h = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${h}:${p.minute}` };
}

/** stageId → 先後順序，從賽制範本讀（不在畫面裡再寫一份） */
function stageOrderOf(format) {
  const map = {};
  for (const s of format?.stages ?? []) map[s.stageId] = s.order ?? 9;
  return map;
}

/**
 * 場次在對戰表裡的順序（自動排定時要照結構排，不是照 matchId）。
 *
 * 分組賽一定要排在名次賽之前，不然名次賽會被排到還沒有名次的時候——
 * 那正是 checkSchedule 的 SOURCE_AFTER 在抓的事。
 */
function sortKeyOf(m, stageOrder = {}) {
  const g = m.groupId ? m.groupId.charCodeAt(0) - 65 : 0;
  return [stageOrder[m.stageId] ?? 9, m.round ?? 1, g, m.matchNo ?? 0];
}
