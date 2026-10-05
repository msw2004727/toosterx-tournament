import { EVENT } from '../../config.js';
import { setActivityTimeSource, activityTime, isActivityTimeSimulated } from '../../core/activity-clock.js';
import { el, confirmDialog, toast } from '../../core/ui.js';

const KEY = 'demo.challengeTime';
const TTL = 2 * 60 * 60 * 1000;
let anchor = null;

export function testTimeAt(value, realNow) {
  if (!Number.isFinite(value?.time) || !Number.isFinite(value?.startedAt)
      || realNow < value.startedAt || realNow - value.startedAt >= TTL) return null;
  return value.time + realNow - value.startedAt;
}

export function installTestTime() {
  try { anchor = JSON.parse(sessionStorage.getItem(KEY)); } catch { anchor = null; }
  setActivityTimeSource(() => testTimeAt(anchor, Date.now()));
}

export function testTimeLabel() {
  return isActivityTimeSimulated()
    ? `DEMO 挑戰測試時間 ${new Intl.DateTimeFormat('zh-TW', { timeZone: EVENT.timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(activityTime())}`
    : 'DEMO 展示環境・比分與名次皆為測試資料';
}

export async function chooseTestTime(onChange) {
  let date = EVENT.dates[0], time = '09:00';
  const body = el('div', {}, [
    el('p', { text: '僅此分頁的挑戰活動與首頁日期使用測試時間，持續兩小時；登錄成績會記在所選日期。比賽時鐘仍使用真實時間。' }),
    el('label', { text: '活動日期' }, el('select', { 'aria-label': '測試活動日期', onChange: e => { date = e.target.value; } },
      EVENT.dates.map(d => el('option', { value: d, text: d })))),
    el('label', { text: '時間' }, el('input', { type: 'time', value: time, 'aria-label': '測試時間', onInput: e => { time = e.target.value; } })),
    el('button', { class: 'btn', type: 'button', onClick: () => {
      anchor = null; sessionStorage.removeItem(KEY); onChange(); toast('已恢復真實時間');
    } }, '恢復真實時間')
  ]);
  if (!await confirmDialog({ title: 'Demo 挑戰測試時間', body, confirmText: '啟用測試時間' })) return;
  if (!/^\d{2}:\d{2}$/.test(time)) { toast('請選擇時間', 'warn'); return; }
  // EVENT currently uses Taipei time; date windows come from the same event settings.
  const timestamp = Date.parse(`${date}T${time}:00+08:00`);
  if (!EVENT.dates.includes(date) || !Number.isFinite(timestamp)) return;
  const { db, sdk } = await import('../../core/firebase.js');
  try {
    const env = (await sdk().getDoc(sdk().doc(db(), 'config', 'env'))).data();
    if (env?.env !== 'demo' || env?.allowChallengeTestTime !== true) throw new Error('Demo 尚未啟用挑戰測試時間設定');
    anchor = { time: timestamp, startedAt: Date.now() };
    sessionStorage.setItem(KEY, JSON.stringify(anchor)); onChange();
    toast('已啟用挑戰測試時間（此分頁兩小時）');
  } catch (err) { toast(err.message, 'error'); }
}
