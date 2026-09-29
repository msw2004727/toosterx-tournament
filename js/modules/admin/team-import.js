import { el, mount, confirmDialog } from '../../core/ui.js';
import { can, callFunction, onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { EVENT_ID, EVENT } from '../../config.js';
import { parseTeamCsv, validateTeamImport, teamCsvTemplate, IMPORT_COLUMNS } from '../../engine/team-import.js';
import { readCsvFile, csvImportErrorMessage, CSV_ENCODINGS } from '../../lib/csv-file.js';
import { adminHead, denied } from './bits.js';
import * as data from './data.js';

const CSV_GUIDE = {
  divisionId: ['必填', '使用下方列出的代碼，例如 u10；不要填組別中文名稱。'],
  teamName: ['必填', '例如 飛達小將。同組別、同隊名的列會合併為一隊；不同球員每列重複填隊名。'],
  shortName: ['選填', '例如 飛達。最多 20 字，同隊須一致；留白時使用隊名的前 20 字。'],
  playerName: ['必填', '例如 小飛。未滿 18 歲填暱稱，成年可填姓名；最多 40 字。'],
  jerseyNo: ['必填', '例如 7。填 0–99 的整數，同隊不可重複。'],
  birthDate: ['可後補', '可留白，由管理員後續補填。例如 2017-01-01。西元年四碼，月份與日期各兩碼，以半形 - 分隔；不使用民國年。'],
  idLast4: ['可後補', '可留白，由管理員後續補填。例如 0012。只填四位數字；Excel 請設為「文字」以保留開頭 0，勿填完整身分證。'],
  isGoalkeeper: ['選填', '填 是 或 否，留白視為否。'],
  isCaptain: ['選填', '填 是 或 否，留白視為否。這是場上隊長，每隊最多一位，不是管理帳號。']
};

export async function adminTeamImportPage({ scope, view }) {
  const root = el('div', { class: 'adm' });
  mount(view, root);
  const state = { divisions: [], teams: [], csv: '', filename: '', file: null, encoding: 'auto', detectedEncoding: '', plan: null, confirmed: false, busy: false, loading: true, error: '', result: null };
  let active = true;
  hold(scope, () => { active = false; }, 'team-import:page');
  if (!can('team.manage')) { mount(root, denied('匯入球隊名冊', '管理員')); return; }
  hold(scope, onAuth(() => render()), 'auth:team-import');
  window.addEventListener('online', render);
  window.addEventListener('offline', render);
  hold(scope, () => { window.removeEventListener('online', render); window.removeEventListener('offline', render); }, 'team-import:network');
  try {
    [state.divisions, state.teams] = await Promise.all([data.getDivisions(), data.getTeams()]);
  } catch (err) { state.error = `讀不到組別或球隊，請重新整理後再試。${data.explain(err)}`; }
  state.loading = false;
  render();

  function download() {
    const url = URL.createObjectURL(new Blob([teamCsvTemplate(state.divisions[0]?.divisionId)], { type: 'text/csv;charset=utf-8;' }));
    const link = el('a', { href: url, download: '球隊名冊匯入範本.csv' });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function choose(file) {
    state.csv = ''; state.plan = null; state.result = null; state.error = ''; state.confirmed = false;
    state.file = file; state.detectedEncoding = '';
    state.filename = file?.name ?? '';
    if (!file) { render(); return; }
    state.busy = true; render();
    try {
      const decoded = await readCsvFile(file, state.encoding);
      state.csv = decoded.text; state.detectedEncoding = decoded.label;
      const rows = parseTeamCsv(state.csv);
      state.plan = validateTeamImport(rows, { divisions: state.divisions, existingTeams: state.teams, asOf: EVENT.dates[0] });
    } catch (err) { state.error = csvImportErrorMessage(err); }
    finally { state.busy = false; render(); }
  }

  async function submit() {
    if (state.busy || !state.confirmed || !state.plan || state.plan.errors.length || !can('team.manage') || !navigator.onLine) return;
    const players = state.plan.teams.reduce((n, t) => n + t.members.length, 0);
    if (!await confirmDialog({ title: '確認匯入球隊名冊？', body: `將新增 ${state.plan.teams.length} 支球隊、${players} 位球員，直接列為已通過並鎖定名單。生日或後四碼未齊的球員需補齊後才能檢錄。既有球隊不會被覆蓋。`, confirmText: '確認匯入' })) return;
    state.busy = true; state.error = ''; render();
    try {
      const result = await callFunction('importTeamsCsv', { eventId: EVENT_ID, csv: state.csv, confirmed: true });
      if (!result?.importId || !Number.isInteger(result.teamCount) || !Number.isInteger(result.playerCount)) throw new Error('伺服器未回傳完整結果，請先到球隊清單確認，再決定是否重試。');
      state.result = result; state.csv = ''; state.plan = null; state.confirmed = false;
    } catch (err) { state.error = `${data.explain(err)} 若網路中斷，請先到球隊清單確認；同一球隊無法重複匯入。`; }
    finally { state.busy = false; render(); }
  }

  function render() {
    if (!active) return;
    if (!can('team.manage')) { mount(root, denied('匯入球隊名冊', '管理員')); return; }
    const plan = state.plan;
    mount(root,
      adminHead('匯入球隊名冊', { sub: 'CSV 批次新增球隊與球員' }),
      el('p', { class: 'adm__note', text: '一列一位球員；同組別、同隊名會合併為一支球隊。最多 100 隊、1,000 位球員、1 MB，每隊最多 15 位球員。' }),
      el('p', { class: 'adm__note', text: '同一球員可參加不同球隊／盃賽，不因生日與身分證後四碼相同而阻擋。相同球隊仍不可重複匯入，同隊背號不可重複。' }),
      el('p', { class: 'adm__note', text: '未滿 18 歲只填暱稱，請勿填真名。出生日期填西元 YYYY-MM-DD，身分證只填後四碼；Excel 請保留開頭的 0，另存為 CSV UTF-8。守門員、隊長填「是／否」，可留白。' }),
      el('p', { class: 'adm__note', text: '生日與身分證後四碼可先留空，之後到「查看球隊清單 → 已通過 → 展開球隊 → 補填資料／修改資料」處理。球隊可先排賽程；未補齊的球員標示待補資料，不能確認出賽。公開名冊不顯示生日與後四碼。' }),
      el('details', { class: 'adm__csvGuide', open: true }, [
        el('summary', { text: 'CSV 欄位填寫格式與範例' }),
        el('p', { class: 'adm__note', text: '第一列保留範本的欄位名稱，從第二列開始填球員。範本中的範例球隊與球員請替換成實際名冊。可調整欄位順序，勿新增不支援的欄位。' }),
        el('table', { class: 'adm__csvTable' }, [
          el('caption', { class: 'sr-only', text: 'CSV 各欄位必填規則與填寫範例' }),
          el('thead', {}, el('tr', {}, ['欄位', '必填', '格式與範例'].map(text => el('th', { scope: 'col', text })))),
          el('tbody', {}, IMPORT_COLUMNS.map(([key, label]) => el('tr', {}, [
            el('th', { scope: 'row', text: label }), el('td', { text: CSV_GUIDE[key][0] }), el('td', { text: CSV_GUIDE[key][1] })
          ])))
        ]),
        el('p', { class: 'adm__note', text: '含逗號的隊名或暱稱請交由 Excel 匯出處理，或用雙引號包住整格。上傳後先檢查預覽，有錯誤時整份都不會寫入。' })
      ]),
      state.error ? el('div', { class: 'adm__box adm__box--warn', role: 'alert', text: state.error }) : null,
      !navigator.onLine ? el('p', { role: 'status', class: 'adm__blocked', text: '目前離線，可查看預覽；恢復連線後才能匯入。' }) : null,
      state.loading ? el('p', { role: 'status', text: '讀取組別與球隊中…' }) : null,
      el('div', { class: 'adm__actions' }, [
        el('button', { type: 'button', class: 'btn btn--lg', disabled: state.loading || state.busy || !state.divisions.length, onClick: download }, '下載 CSV 範本'),
        el('a', { class: 'btn btn--lg', href: '#/admin/teams' }, '查看球隊清單')
      ]),
      el('p', { class: 'adm__note', text: '可用組別：' + state.divisions.map(d => `${d.divisionId}（${d.name}）`).join('、') }),
      el('label', { class: 'adm__importFile' }, [el('span', { text: 'CSV 文字編碼' }), el('select', {
        'aria-label': 'CSV 文字編碼', disabled: state.loading || state.busy,
        onChange: e => { state.encoding = e.target.value; choose(state.file); }
      }, CSV_ENCODINGS.map(([value, label]) => el('option', { value, selected: value === state.encoding }, label)))]),
      el('p', { class: 'adm__note', text: '建議使用 CSV UTF-8；也支援 Excel 的 Big5 與含編碼標記的 UTF-16 CSV。若預覽中文字不正確，可切換文字編碼重新讀取。' }),
      el('label', { class: 'adm__importFile' }, [el('span', { text: '上傳 CSV 球隊名冊' }), el('input', {
        type: 'file', accept: '.csv,text/csv', 'aria-label': '上傳 CSV 球隊名冊',
        disabled: state.loading || state.busy || !state.divisions.length,
        onChange: e => choose(e.target.files?.[0])
      })]),
      state.filename ? el('p', { class: 'adm__note', text: `檔案：${state.filename}` }) : null,
      state.detectedEncoding ? el('p', { class: 'adm__note', text: `讀取編碼：${state.detectedEncoding}。請核對預覽中的中文與名冊內容。` }) : null,
      state.busy ? el('p', { role: 'status', text: '處理中，請勿重複送出…' }) : null,
      state.result ? el('div', { class: 'adm__box', role: 'status' }, [
        el('strong', { text: `匯入完成：${state.result.teamCount} 支球隊、${state.result.playerCount} 位球員，已通過。` }),
        el('a', { class: 'btn btn--primary btn--lg', href: '#/admin/schedule' }, '前往賽程管理'),
        el('a', { class: 'btn btn--lg', href: '#/admin/teams' }, '補填或修改球員資料')
      ]) : null,
      plan ? el('section', { class: 'adm__box' }, [
        el('h2', { class: 'adm__sectionHead', text: `匯入預覽：${plan.teams.length} 支球隊、${plan.teams.reduce((n, t) => n + t.members.length, 0)} 位球員` }),
        plan.errors.length ? el('div', { role: 'alert' }, [
          el('strong', { text: `發現 ${plan.errors.length} 個問題，請修正後重新上傳，尚未寫入資料。` }),
          el('ul', { class: 'adm__importErrors' }, plan.errors.slice(0, 100).map(e => el('li', { text: `${e.row ? `第 ${e.row} 列：` : ''}${e.message}` })))
        ]) : null,
        ...plan.teams.map(t => el('details', { class: 'adm__importTeam' }, [
          el('summary', { text: `${t.name} · ${state.divisions.find(d => d.divisionId === t.divisionId)?.name ?? t.divisionId} · ${t.members.length} 人` }),
          el('ul', {}, t.members.map(m => el('li', { text: `#${m.jerseyNo ?? '—'} ${m.name} · ${m.birthDate || '生日待補'} · 末四碼 ${m.idLast4 || '待補'}${m.identityComplete ? '' : ' · 待補資料'}${m.isGoalkeeper ? ' · 守門員' : ''}${m.isCaptain ? ' · 隊長' : ''}` })))
        ])),
        !plan.errors.length ? el('label', { class: 'adm__importConfirm' }, [
          el('input', { type: 'checkbox', checked: state.confirmed, disabled: state.busy, onChange: e => { state.confirmed = e.target.checked; render(); } }),
          el('span', { text: '我已核對名冊、取得提供名冊的授權，並確認未成年球員填寫的是暱稱。' })
        ]) : null,
        el('button', { type: 'button', class: 'btn btn--primary btn--lg', disabled: state.busy || !!plan.errors.length || !state.confirmed || !navigator.onLine, onClick: submit }, '匯入並核准球隊')
      ]) : null
    );
  }
}
