/**
 * 匯出資料 `#/admin/export`
 * ------------------------------------------------------------------
 * 規格：docs/06 §7.3（抽獎名單 CSV）、§11（活動指標）
 *
 * MVP 只做**匯出名單**（企劃書第二十六章明示；抽獎工具是 P2）。
 *
 * 四件不可協商：
 *   1. **下載之前先讓主辦看到裡面有什麼。** 直接丟一個檔案下去，
 *      錯了要到抽獎現場才發現。這一頁先顯示「幾個人、共幾張、幾人全破」，
 *      而且列出前幾名讓他對照。
 *   2. **暱稱是玩家自己取的，而主辦會用 Excel 打開。** 公式注入的防護在
 *      `js/engine/csv.js`，這一頁不自己拼字串。
 *   3. **張數用 Function 寫的權威值**，不在前端重算——重算跟管線分岔的話，
 *      名單上的張數會跟玩家手機上看到的不一樣，那是抽獎現場才會吵起來的事。
 *   4. **沒有資格的人不進名單**（0 張）。要主辦自己在試算表裡篩一次，
 *      漏篩就等於把沒有資格的人放進抽獎箱。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */

import { el, mount, toast, skeleton } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { can, onAuth, callFunction } from '../../core/firebase.js';
import { EVENT_ID } from '../../config.js';
import { DAILY_RULE, selectedActivityDate } from '../../engine/challenge-days.js';
import { dayTabs, dateLabel, watchActivityDay } from '../challenge/days.js';
import { hold } from '../../core/store.js';
import { now as serverNow } from '../../core/clock.js';
import { activityTime } from '../../core/activity-clock.js';
import {
  toCsv, luckyDrawRows, luckyDrawSummary, csvFilename, LUCKY_DRAW_COLUMNS
} from '../../engine/csv.js';
import * as data from './data.js';
import { adminHead, denied } from './bits.js';

export async function adminExportPage({ scope, view }) {
  const root = el('div', { class: 'adm adm-export' });
  mount(view, root);
  mount(root, adminHead('匯出資料'), skeleton(3));

  const state = {
    players: undefined,        // undefined = 還沒載入
    challengeTotal: 0,
    date: null, dailyRows: [],
    error: null,
    busy: false
  };
  state.participantScope = 'all'; state.participantRows = null;

  if (!can('export')) { mount(root, denied('匯出資料', '管理員')); return; }

  load();
  hold(scope, onAuth(() => render()), 'auth:admin-export');
  watchActivityDay(scope, () => state.rewards, date => {
    if (state.date === date) return;
    if (state.busy) return false;
    selectDate(date);
  });

  // ── 具名函式（會被提升）───────────────────────────────────

  async function load() {
    state.error = null;
    try {
      const [players, challenges, contacts, rewards] = await Promise.all([
        data.getPlayers({ server: true }), data.getChallenges({ server: true }),
        data.getPlayerContacts({ server: true }), data.getChallengeRewards({ server: true })
      ]);
      if (!['allChallengesCompleted', 'perChallengeCompleted', DAILY_RULE].includes(rewards?.rule)) {
        throw new Error('抽獎規則尚未設定或無法確認，請聯絡總管後再匯出。');
      }
      state.players = players;
      state.challengeTotal = rewards?.requiredChallengeIds?.length ?? challenges.length;
      state.contacts = contacts;
      state.rewards = rewards;
      if (rewards.rule === DAILY_RULE) {
        state.date ??= selectedActivityDate(activityTime(), rewards.dates, rewards.timeZone);
        const result = await callFunction('exportDailyDraw', { eventId: EVENT_ID, date: state.date });
        if (result?.date !== state.date || !Array.isArray(result.rows)) throw new Error('當日名單尚未確認，請重新更新');
        state.dailyRows = result.rows;
        state.challengeTotal = result.requiredCount;
      }
      state.loadedAt = new Date(serverNow()).toLocaleTimeString('zh-TW', { hour12: false });
    } catch (err) {
      state.error = err;
      state.players = [];
    }
    if (!state.error) await loadParticipants();
    render();
    return !state.error;
  }

  async function loadParticipants() {
    state.participantError = null;
    try {
      state.date ??= selectedActivityDate(activityTime(), state.rewards?.dates, state.rewards?.timeZone);
      const result = await callFunction('exportChallengeParticipants', {
        eventId: EVENT_ID, date: state.date, scope: state.participantScope, mode: 'summary'
      });
      if (result?.date !== state.date || !Array.isArray(result.rows)) throw Error('完整名單尚未確認，請重新更新');
      state.participantRows = result.rows;
      state.participantLoadedAt = new Date(serverNow()).toLocaleTimeString('zh-TW', { hour12:false });
    } catch (err) { state.participantError = err; state.participantRows = null; }
  }

  async function exportParticipants(mode) {
    if (state.busy || !can('export')) return;
    state.busy = true; render();
    try {
      const result = await callFunction('exportChallengeParticipants', {
        eventId: EVENT_ID, date: state.date, scope: state.participantScope, mode
      });
      if (result?.date !== state.date || !Array.isArray(result.rows) || !Array.isArray(result.columns)) throw Error('名單資料不完整');
      if (!result.rows.length) { toast('此範圍目前沒有資料', 'warn'); return; }
      download(csvFilename(mode === 'summary' ? '挑戰參與名單' : '挑戰成績明細', state.date), toCsv(result.columns, result.rows));
      toast(`已匯出 ${result.rows.length} 筆`);
    } catch (err) { toast(data.explain(err, '匯出失敗'), 'error'); }
    finally { state.busy = false; render(); }
  }

  function participantCard() {
    const list = state.participantRows ?? [];
    return el('section', { class:'adm__box adm-export__card', 'aria-label':'完整挑戰名單' }, [
      el('div', { class:'adm-export__heading' }, [
        el('h2', {}, iconText('list', '挑戰參與名單')),
        el('span', { class:'adm-export__tag', text:'活動紀錄' })
      ]),
      el('p', { class:'adm__note', text:'查看領卡用戶與各攤成績，包含尚未集滿的用戶。' }),
      el('div', { class:'adm-export__controls' }, [
        el('label', { class:'adm-export__field' }, [el('span', { text:'名單範圍' }), el('select', { class:'input', 'aria-label':'挑戰名單範圍', disabled:state.busy,
        onChange:async event=>{state.participantScope=event.target.value;state.busy=true;render();await loadParticipants();state.busy=false;render();}
        }, [['all','全部已領卡用戶'],['participated','所選日有登錄紀錄']].map(([value,text])=>el('option',{value,text,selected:state.participantScope===value}))) ]),
        el('button',{class:'btn adm-export__refresh',type:'button',disabled:state.busy,onClick:async()=>{state.busy=true;render();await loadParticipants();state.busy=false;render();}},iconText('retry','更新完整名單'))
      ]),
      state.participantError
        ? el('p',{class:'adm-export__error',role:'alert',text:data.explain(state.participantError,'完整名單讀取失敗，請更新重試。')})
        : el('div',{class:'adm-export__status',role:'status'},[
            el('strong',{text:state.participantRows==null?'讀取中…':`${dateLabel(state.date)}・${list.length} 人`}),
            el('span',{text:state.participantLoadedAt?`更新於 ${state.participantLoadedAt}`:''})
          ]),
      el('div',{class:'adm-export__preview','aria-label':'挑戰名單預覽'},[
        el('h3',{text:`名單預覽（前 ${Math.min(list.length,5)} 人）`}),
        el('p',{class:'adm__note',text:'以下僅供核對用戶與完成關數，依卡號排列，並非排名；下載的 CSV 包含此範圍的全部資料。'}),
        list.length ? el('ul',{class:'adm__list'},list.slice(0,5).map(r=>el('li',{class:'adm-export__person'},[
          el('div',{class:'adm-export__personMain'},[el('strong',{text:r.nickname||r.playerId}),el('span',{text:r.playerId})]),
          el('span',{class:'adm-export__progress',text:`完成 ${r.completedCount} 關`})
        ]))) : el('p',{class:'adm__note',text:state.participantError?'名單尚未確認，請更新重試。':state.participantRows==null?'正在讀取名單…':'此範圍目前沒有用戶。'})
      ]),
      el('div',{class:'adm-export__downloads'},[
        el('div',{},[
          el('button',{class:'btn btn--lg btn--primary',type:'button',disabled:state.busy||state.participantRows==null,onClick:()=>exportParticipants('summary')},'下載挑戰名單 CSV'),
          el('p',{class:'adm__note',text:'每人一筆：暱稱、LINE UID、各攤成績與聯繫方式。'})
        ]),
        el('div',{},[
          el('button',{class:'btn btn--lg',type:'button',disabled:state.busy||state.participantRows==null,onClick:()=>exportParticipants('attempts')},'下載成績明細 CSV'),
          el('p',{class:'adm__note',text:'每次登錄一筆：逐球資料、參與時間、入庫時間與作廢紀錄。'})
        ])
      ])
    ]);
  }

  function rows() {
    if (state.error) return [];
    if (state.rewards?.rule === DAILY_RULE) return state.dailyRows;
    return luckyDrawRows(state.players ?? [], { contacts: state.contacts ?? {}, rewards: state.rewards });
  }

  async function selectDate(date) {
    if (state.busy) return;
    state.date = date; state.dailyRows = []; state.participantRows = null;
    state.participantLoadedAt = null; state.participantError = null; state.loadedAt = null;
    state.busy = true; render();
    try { await load(); } finally { state.busy = false; render(); }
  }

  /**
   * 下載。
   *
   * ⚠️ `URL.revokeObjectURL` 一定要呼叫——不然每按一次就漏一份檔案在記憶體裡。
   *    放在 setTimeout 而不是同一個 tick：Safari 在 click 還沒處理完就撤銷的話
   *    會直接不下載。
   */
  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportLuckyDraw() {
    if (state.busy || !can('export')) return;
    state.busy = true; render();
    try {
      if (!await load()) throw state.error;
      const list = rows();
      if (!list.length) { toast('目前沒有人有抽獎資格', 'warn'); return; }
      const daily = state.rewards?.rule === DAILY_RULE;
      const columns = daily ? [{ key: 'date', label: '活動日期' }, { key: 'requiredCount', label: '當日開放關卡數' }, ...LUCKY_DRAW_COLUMNS] : LUCKY_DRAW_COLUMNS;
      const csv = toCsv(columns, list);
      const name = csvFilename('抽獎名單', daily ? state.date : new Date(serverNow()).toISOString());
      download(name, csv);
      // 匯出是讀取，不是結果性資料的變更——但「誰在什麼時候把名單帶走了」
      // 在抽獎有爭議時是要查的，所以照樣留一筆（R-SEC-002 只能新增）
      await data.writeAudit({
        action: 'export.luckyDraw', targetType: 'challenge', targetId: 'luckyDraw',
        after: { players: list.length, entries: luckyDrawSummary(list).entries, filename: name,
          ...(daily ? { activityDate: state.date, requiredCount: state.challengeTotal } : {}) },
        reason: null
      });
      toast(`已匯出 ${list.length} 人`);
    } catch (err) {
      state.error = err;
      toast(data.explain(err, '匯出失敗。'), 'error');
    } finally {
      state.busy = false; render();
    }
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function summaryCard() {
    const list = rows();
    const s = luckyDrawSummary(list, state.challengeTotal);
    return el('section', { class:'adm__box adm-export__card', 'aria-label':'抽獎資格名單' }, [
      el('div', { class:'adm-export__heading' }, [el('h2',{},iconText('ticket','抽獎資格名單')),el('span',{class:'adm-export__tag',text:'抽獎使用'})]),
      el('p',{class:'adm__note',text:'只包含已有抽獎資格的用戶，方便活動現場核對與抽獎。'}),
      el('p', { class: 'adm__note', text:
        `有資格的玩家 ${s.players} 人・抽獎券合計 ${s.entries} 張`
        + (state.rewards?.rule === DAILY_RULE || s.allDone == null ? '' : `・${state.challengeTotal} 關全破 ${s.allDone} 人`) }),
      el('p', { class: 'adm__permNote', text:
        state.rewards?.rule === DAILY_RULE ? `僅匯出 ${dateLabel(state.date)} 已確認的抽獎資格；其他日期不計入本日，下載前由伺服器重新核對。`
          : state.rewards?.rule === 'allChallengesCompleted'
          ? `僅匯出全部 ${state.challengeTotal} 項完成、且伺服器已確認資格的玩家，每人 1 張。下載前會重新讀取最新資料。`
          : '只收抽獎張數 1 張以上的人。張數由伺服器確認，下載前會重新讀取最新資料。' }),
      el('div',{class:'adm-export__actions'},[
        el('button', { class: 'btn', type: 'button', disabled: state.busy, onClick: async () => {
          state.busy = true; render(); await load(); state.busy = false; render();
        } }, iconText('retry', '更新抽獎名單')),
        el('button', { class:'btn btn--primary', type:'button', disabled:state.busy||!list.length,onClick:exportLuckyDraw },iconText('install',state.busy?'匯出中…':'下載 CSV'))
      ]),
      state.loadedAt ? el('p',{class:'adm-export__updated',text:`更新於 ${state.loadedAt}`}) : null,
      previewCard()
    ]);
  }

  /** 先看得到內容再下載——錯了要到抽獎現場才發現就太晚了 */
  function previewCard() {
    const list = rows().slice(0, 10);
    if (!list.length) {
      return el('div', { class: 'adm-export__preview' }, [
        el('strong', {}, iconText('info', '還沒有人有抽獎資格')),
        el('p', { class: 'adm__note', text: '玩家完成全部必要項目，且伺服器確認抽獎資格後，就會出現在這裡。' })
      ]);
    }
    return el('div', { class: 'adm-export__preview' }, [
      el('h3', { text: `抽獎名單預覽（前 ${list.length} 人）` }),
      el('p',{class:'adm__note',text:'僅列出部分用戶供核對，下載的 CSV 會包含所有有資格的用戶。'}),
      el('ul', { class: 'adm__list' }, list.map(r => el('li', { class: 'adm__tieRow' }, [
        el('span', { class: 'adm__tieRank', text: `${r.entries} 張` }),
        el('div', { class: 'adm__tieMain' }, [
          // ⚠️ 暱稱是玩家自己取的，一律 textContent（R-CODE-002）
          el('strong', { class: 'adm__teamName', text: r.nickname || r.playerId }),
          el('span', { class: 'adm__tieStat', text: `${r.playerId}・完成 ${r.completedCount} 關` })
        ])
      ]))),
      el('p', { class: 'adm__permNote', text: '依抽獎券張數由多到少排列，同張數依卡號排列。' })
    ]);
  }

  function render() {
    if (state.players === undefined) { mount(root, adminHead('匯出資料'), skeleton(3)); return; }
    if (!can('export')) { mount(root, denied('匯出資料', '管理員')); return; }

    mount(root,
      adminHead('匯出資料', { sub: '選擇日期，核對名單，再下載 CSV' }),

      state.error
        ? el('div', { class: 'adm__box adm__box--warn', role: 'alert' }, [
            el('strong', { text: '讀不到資料' }),
            el('p', { class: 'adm__note', text: data.explain(state.error) })
          ])
        : null,

      state.rewards?.rule === DAILY_RULE ? el('section',{class:'adm__box adm-export__date','aria-label':'匯出日期'},[
        el('h2',{text:'活動日期'}),
        dayTabs(state.rewards.dates, state.date, date => { if (!state.busy) selectDate(date); }),
        el('p',{class:'adm__note',text:'挑戰成績與抽獎資格以所選日期為準；「全部已領卡用戶」仍包含未參與當日挑戰的用戶。'})
      ]) : null,
      participantCard(),
      summaryCard(),

      el('details', { class: 'adm-export__help' }, [
        el('summary', { text: '下載與資料說明' }),
        el('p',{class:'adm__note',text:'請先確認各攤位的待同步成績已入庫，再更新名單。未綁定 LINE 或未填聯繫方式時，欄位會留空。'}),
        el('p', { class: 'adm__note', text:
          '編碼是 UTF-8 帶 BOM，Excel 直接打開不會變成亂碼。暱稱裡如果有等號或加號開頭，'
          + '會多一個單引號——那是為了不讓試算表把它當成公式執行。' }),
        el('p', { class: 'adm__permNote', text:
          '聯絡方式取自私密的中獎聯絡手機；未填手機的玩家仍可符合資格，活動現場可用挑戰卡號唱名。' })
      ])
    );
  }
}
