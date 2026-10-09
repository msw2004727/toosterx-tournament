import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const fake=fs.readFileSync('tests/e2e/fake-firebase.js','utf8'),event='feda-cup-2026',uid='integrity-admin';
async function setup(page,role='admin'){
  await page.clock.install({time:new Date('2026-10-09T12:00:00+08:00')});
  await page.route('https://www.gstatic.com/firebasejs/**',r=>r.fulfill({contentType:'text/javascript',body:fake}));
  await page.route('https://firestore.googleapis.com/**',r=>r.fulfill({headers:{date:new Date('2026-10-09T12:00:00+08:00').toUTCString()},body:'{}'}));
  await page.addInitScript(({event,uid,role})=>{
    window.__FAKE_USER={uid,displayName:'測試'};
    window.__FAKE_SEED={['staff/'+uid]:{active:true,roles:[role],assignment:{eventId:event,challengeIds:[]}},
      'config/env':{env:'demo'},'config/challengeRewards':{rule:'dailyChallengesCompleted',dates:['2026-10-09','2026-10-10','2026-10-11'],timeZone:'Asia/Taipei'},
      [`events/${event}/players/p1`]:{nickname:'未全破玩家',playerId:'p1',luckyDrawEntries:0}};
    window.__FAKE_PARTICIPANTS_RESULT={columns:[{key:'nickname',label:'暱稱'},{key:'lineUid',label:'LINE UID'},{key:'contact',label:'聯繫方式'},{key:'score',label:'七攤成績'}],
      rows:[{playerId:'p1',nickname:'=未全破玩家',lineUid:'LINE-PLAYER',contact:'',score:0,completedCount:1},
        {playerId:'p2',nickname:'代建卡',lineUid:'',contact:'',score:'',completedCount:0}]};
    window.__CSV=null;window.__BYTES=null;
    URL.createObjectURL=blob=>{void blob.text().then(t=>window.__CSV=t);void blob.arrayBuffer().then(b=>window.__BYTES=[...new Uint8Array(b).slice(0,3)]);return 'blob:test';};
  },{event,uid,role});
  await page.goto('/#/admin/export');
}
test('完整名單與抽獎分開，包含未全破／未綁定／聯繫空白與零分，CSV安全且伺服器重新確認',async({page})=>{
  await setup(page);const card=page.getByRole('region',{name:'完整挑戰名單'});
  await expect(card).toContainText('2 人');await expect(card).toContainText('未全破玩家');
  await page.getByRole('button',{name:'下載挑戰名單 CSV',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__CSV)).toContain('LINE UID');
  const csv=await page.evaluate(()=>window.__CSV);expect(csv).toContain("'=未全破玩家,LINE-PLAYER,,0");expect(csv).toContain('代建卡,,,');
  expect(await page.evaluate(()=>window.__BYTES)).toEqual([239,187,191]);
  await page.getByLabel('挑戰名單範圍').selectOption('participated');
  await page.getByRole('button',{name:'下載成績明細 CSV',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__FAKE_CALLS.at(-1)?.payload?.mode)).toBe('attempts');
  expect(await page.evaluate(()=>window.__FAKE_CALLS.at(-1).payload)).toMatchObject({date:'2026-10-09',scope:'participated',mode:'attempts'});
  await page.getByRole('tab',{name:'10/10',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__FAKE_CALLS.filter(c=>c.name==='exportChallengeParticipants').at(-1)?.payload?.date)).toBe('2026-10-10');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
test('完整名單讀取失敗不假裝空名單或允許下載',async({page})=>{
  await setup(page);await page.evaluate(()=>window.__FAKE_PARTICIPANTS_ERROR=true);
  await page.getByRole('button',{name:'更新完整名單',exact:true}).click();
  await expect(page.getByRole('region',{name:'完整挑戰名單'}).getByRole('alert')).toContainText('伺服器錯誤');
  await expect(page.getByRole('button',{name:'下載挑戰名單 CSV',exact:true})).toBeDisabled();
});
test('攤位人員不能看到完整名單或發送匯出請求',async({page})=>{
  await setup(page,'booth');await expect(page.getByRole('button',{name:'下載挑戰名單 CSV',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window.__FAKE_CALLS??[]).some(c=>c.name==='exportChallengeParticipants'))).toBe(false);
});
