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
import { can, onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { now as serverNow } from '../../core/clock.js';
import {
  toCsv, luckyDrawRows, luckyDrawSummary, csvFilename, LUCKY_DRAW_COLUMNS
} from '../../engine/csv.js';
import * as data from './data.js';
import { adminHead, denied } from './bits.js';

export async function adminExportPage({ scope, view }) {
  const root = el('div', { class: 'adm' });
  mount(view, root);
  mount(root, adminHead('匯出資料'), skeleton(3));

  const state = {
    players: undefined,        // undefined = 還沒載入
    challengeTotal: 0,
    error: null,
    busy: false
  };

  if (!can('export')) { mount(root, denied('匯出資料', '管理員')); return; }

  load();
  hold(scope, onAuth(() => render()), 'auth:admin-export');

  // ── 具名函式（會被提升）───────────────────────────────────

  async function load() {
    try {
      const [players, challenges] = await Promise.all([
        data.getPlayers(), data.getChallenges()
      ]);
      state.players = players;
      state.challengeTotal = challenges.length;
    } catch (err) {
      state.error = err;
      state.players = [];
    }
    render();
  }

  function rows() {
    return luckyDrawRows(state.players ?? []);
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
    const list = rows();
    if (!list.length) { toast('目前沒有人有抽獎資格', 'warn'); return; }

    state.busy = true; render();
    try {
      const csv = toCsv(LUCKY_DRAW_COLUMNS, list);
      const name = csvFilename('抽獎名單', new Date(serverNow()).toISOString());
      download(name, csv);
      // 匯出是讀取，不是結果性資料的變更——但「誰在什麼時候把名單帶走了」
      // 在抽獎有爭議時是要查的，所以照樣留一筆（R-SEC-002 只能新增）
      await data.writeAudit({
        action: 'export.luckyDraw', targetType: 'challenge', targetId: 'luckyDraw',
        after: { players: list.length, entries: luckyDrawSummary(list).entries, filename: name },
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
    return el('div', { class: 'adm__box' }, [
      el('strong', {}, iconText('ticket', '抽獎名單')),
      el('p', { class: 'adm__note', text:
        `有資格的玩家 ${s.players} 人・抽獎券合計 ${s.entries} 張`
        + (s.allDone == null ? '' : `・${state.challengeTotal} 關全破 ${s.allDone} 人`) }),
      el('p', { class: 'adm__permNote', text:
        '只收抽獎張數 1 張以上的人。張數是系統算出來的權威值，跟玩家手機上看到的一致。' }),
      el('button', {
        class: 'btn btn--lg btn--primary', type: 'button',
        disabled: state.busy || !list.length, onClick: exportLuckyDraw
      }, iconText('install', state.busy ? '匯出中…' : '下載 CSV'))
    ]);
  }

  /** 先看得到內容再下載——錯了要到抽獎現場才發現就太晚了 */
  function previewCard() {
    const list = rows().slice(0, 10);
    if (!list.length) {
      return el('div', { class: 'adm__box' }, [
        el('strong', {}, iconText('info', '還沒有人有抽獎資格')),
        el('p', { class: 'adm__note', text: '玩家完成第一關之後就會出現在這裡。' })
      ]);
    }
    return el('div', { class: 'adm__box' }, [
      el('div', { class: 'adm__sectionHead', text: `預覽（前 ${list.length} 筆）` }),
      el('ul', { class: 'adm__list' }, list.map(r => el('li', { class: 'adm__tieRow' }, [
        el('span', { class: 'adm__tieRank', text: String(r.entries) }),
        el('div', { class: 'adm__tieMain' }, [
          // ⚠️ 暱稱是玩家自己取的，一律 textContent（R-CODE-002）
          el('strong', { class: 'adm__teamName', text: r.nickname || r.playerId }),
          el('span', { class: 'adm__tieStat', text: `${r.playerId}・完成 ${r.completedCount} 關` })
        ])
      ]))),
      el('p', { class: 'adm__permNote', text: '張數多的排前面，同張數依代號——重匯一次會拿到同一份名單。' })
    ]);
  }

  function render() {
    if (state.players === undefined) { mount(root, adminHead('匯出資料'), skeleton(3)); return; }

    mount(root,
      adminHead('匯出資料', { sub: 'CSV（Excel 直接開得起來）' }),

      state.error
        ? el('div', { class: 'adm__box adm__box--warn', role: 'alert' }, [
            el('strong', { text: '讀不到資料' }),
            el('p', { class: 'adm__note', text: data.explain(state.error) })
          ])
        : null,

      summaryCard(),
      previewCard(),

      el('div', { class: 'adm__box' }, [
        el('strong', { text: '關於這份檔案' }),
        el('p', { class: 'adm__note', text:
          '編碼是 UTF-8 帶 BOM，Excel 直接打開不會變成亂碼。暱稱裡如果有等號或加號開頭，'
          + '會多一個單引號——那是為了不讓試算表把它當成公式執行。' }),
        el('p', { class: 'adm__permNote', text:
          '「聯絡方式」目前一定是空的：填寫聯絡方式的表單還沒做（docs/06 §7.2）。' })
      ])
    );
  }
}
