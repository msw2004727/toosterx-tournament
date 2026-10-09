import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const EVENT='feda-cup-2026',PID='FEDA-0182',UID='round-ui',DATE='2026-10-09',NEXT='FEDA-9002',THIRD='FEDA-9003';
const TIME=Date.parse(DATE+'T10:00:00+08:00'),fake=fs.readFileSync('tests/e2e/fake-firebase.js','utf8'),path=`events/${EVENT}`;
const row=(number,code,full=false)=>({number,code,entries:full?1:0,required:['a','b','c','d'],done:full?['a','b','c','d']:[],...(full?{lockedRequired:['a','b','c','d']}:{}),startedAtMs:TIME});
async function setup(page,{full=false,login=true,second=false,role=null}={}){
 const seed={[path]:{eventId:EVENT,dates:[DATE,'2026-10-10']},'config/env':{env:'demo'},'config/challengeRewards':{rule:'dailyChallengesCompleted',roundsEnabled:true,version:'daily-rounds-v1',dates:[DATE,'2026-10-10'],timeZone:'Asia/Taipei'},
 [`${path}/players/${PID}`]:{playerId:PID,eventId:EVENT,nickname:'多輪玩家',challengeRounds:{[DATE]:second?[row(1,PID,true),row(2,NEXT)]:[row(1,PID,full)]}},[`users/${UID}`]:{gamePassId:PID},[`staff/${UID}`]:{active:true,roles:role?[role]:[],assignment:{eventId:EVENT,challengeIds:['a','b','c','d','e']}}};
 for(const [order,id] of ['a','b','c','d','e'].entries()){seed[`${path}/challenges/${id}`]={challengeId:id,name:'攤位'+id,order,inputMode:'stepper',minValue:0,maxValue:5,dailyOpen:{[DATE]:id!=='e'}};if(full||second)seed[`${path}/attempts/${id}`]={attemptId:id,playerId:PID,roundCode:PID,challengeId:id,rawValue:0,recordedAtMs:TIME,createdAt:TIME};}
 if(second)seed[`${path}/players/${NEXT}`]={playerId:NEXT,roundAliasOf:PID,roundDate:DATE};
 await page.clock.install({time:new Date(TIME)});
 await page.route('https://www.gstatic.com/firebasejs/**',r=>r.fulfill({contentType:'text/javascript',body:fake}));
 await page.route('https://firestore.googleapis.com/**',r=>r.fulfill({headers:{date:new Date(TIME).toUTCString()},body:'{}'}));
 await page.addInitScript(({seed,pid,uid,login})=>{window.__FAKE_SEED=seed;window.__FAKE_USER=login?{uid,displayName:'多輪玩家'}:null;localStorage.setItem('feda:gamePass',JSON.stringify({playerId:pid}));},{seed,pid:PID,uid:UID,login});
}
const card=(p,n)=>p.locator(`.chal__card--draw[data-round="${n}"]`),button=p=>p.getByRole('button',{name:'代建新卡（領新碼進入下一輪）',exact:true});
async function finish(page,code,number,ids=['a','b','c','d']){await page.evaluate(({path,pid,code,number,ids,date,time})=>{const dump=window.__fake.__dump(),p=dump[`${path}/players/${pid}`],rows=structuredClone(p.challengeRounds[date]);rows[number-1]={...rows[number-1],entries:1,required:ids,lockedRequired:ids,done:ids};const docs={[`${path}/players/${pid}`]:{...p,challengeRounds:{...p.challengeRounds,[date]:rows}}};for(const id of ids)docs[`${path}/attempts/${code}-${id}`]={playerId:pid,roundCode:code,challengeId:id,rawValue:0,recordedAtMs:time,createdAt:time};window.__fake.__seed(docs);},{path,pid:PID,code,number,ids,date:DATE,time:TIME});}
test('ROUND-UI 未集滿反灰，完成領碼新增第二第三輪，各輪顯示碼且QR更新',async({page})=>{
 await setup(page);await page.goto('/#/challenge/me');
 await expect(button(page)).toBeDisabled();await expect(card(page,1).locator('.chal__roundCode')).toHaveText(`本輪碼號：${PID}`);
 await finish(page,PID,1);await expect(button(page)).toBeEnabled();await button(page).click();
 await expect(card(page,2)).toBeVisible();await expect(card(page,2).locator('.chal__roundCode')).toHaveText(`本輪碼號：${NEXT}`);
 await expect(page.locator('.chal__pid')).toHaveText(NEXT);await expect(card(page,1)).toContainText('已取得 1 次');await expect(card(page,2).locator('[data-done="true"]')).toHaveCount(0);await expect(button(page)).toBeDisabled();
 await finish(page,NEXT,2);await expect(button(page)).toBeEnabled();await button(page).click();await expect(card(page,3)).toBeVisible();await expect(page.locator('.chal__pid')).toHaveText(THIRD);await expect(card(page,3).locator('.chal__roundCode')).toHaveText(`本輪碼號：${THIRD}`);await expect(button(page)).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('ROUND-REOPEN 已滿四攤保留，最新未滿輪改成五攤，新點只進最新輪',async({page})=>{
 await setup(page,{second:true});await page.goto('/#/challenge/me');await expect(card(page,2)).toBeVisible();
 await page.evaluate(({path,pid,date,time,code})=>{const d=window.__fake.__dump();window.__fake.__seed({[`${path}/challenges/e`]:{...d[`${path}/challenges/e`],dailyOpen:{[date]:true}},[`${path}/attempts/new-e`]:{playerId:pid,roundCode:code,challengeId:'e',rawValue:0,recordedAtMs:time,createdAt:time}});},{path,pid:PID,date:DATE,time:TIME,code:NEXT});
 await expect(card(page,1)).toContainText('已取得 1 次');await expect(card(page,1).locator('.chal__stamp')).toHaveCount(4);await expect(card(page,2).locator('.chal__stamp')).toHaveCount(5);await expect(card(page,2).locator('[data-done="true"]')).toHaveCount(1);await expect(button(page)).toBeDisabled();
});
test('ROUND-GATE 訪客／離線／歷史日期不能領新碼，首頁同步最新輪',async({page})=>{
 await setup(page,{full:true});await page.goto('/#/challenge');await expect(button(page)).toBeEnabled();
 await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'));});await expect(button(page)).toBeDisabled();
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:true});window.dispatchEvent(new Event('online'));});await expect(button(page)).toBeEnabled();await button(page).click();await expect(card(page,2)).toBeVisible();await expect(button(page)).toBeDisabled();
 await page.getByRole('tab',{name:'10/10'}).click();await expect(button(page)).toBeDisabled();
});
test('ROUND-BOOTH 新碼寫入同一玩家最新輪，舊碼拒絕',async({page})=>{
 await setup(page,{second:true,role:'booth'});await page.goto('/#/booth/a');await page.locator('#booth-id').fill(PID);await page.getByRole('button',{name:'查詢',exact:true}).click();await expect(page.getByText(/這是舊輪/)).toBeVisible();
 await page.locator('#booth-id').fill(NEXT);await page.getByRole('button',{name:'查詢',exact:true}).click();await expect(page.locator('.booth__pid')).toHaveText(NEXT);await page.getByRole('button',{name:'送出成績',exact:true}).click();
 await expect.poll(async()=>Object.values(await page.evaluate(()=>window.__fake.__dump())).filter(a=>a.staffUid==='round-ui'&&a.roundCode==='FEDA-9002'&&a.playerId==='FEDA-0182').length).toBeGreaterThan(0);
});
