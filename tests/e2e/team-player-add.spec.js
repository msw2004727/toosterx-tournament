import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE=fs.readFileSync('tests/e2e/fake-firebase.js','utf8');
const E='feda-cup-2026', UID='captain', BASE=`events/${E}`, TEAM=`${BASE}/teams/t`;
const dialog=page=>page.getByRole('dialog',{name:'新增球員',exact:true});
const row=(page,index=0)=>dialog(page).locator('.adm__newPlayer').nth(index);
const save=page=>dialog(page).getByRole('button',{name:/^新增 \d+ 位球員$/});
const calls=page=>page.evaluate(()=>window.__FAKE_CALLS??[]);
const dump=page=>page.evaluate(()=>window.__fake.__dump());
async function open(page,{roles=[],assigned=true,locked=false,theme='light'}={}) {
  await page.route('https://www.gstatic.com/firebasejs/**',r=>r.fulfill({status:200,contentType:'text/javascript; charset=utf-8',body:FAKE}));
  await page.route('https://firestore.googleapis.com/**',r=>r.fulfill({status:200,body:'{}'}));
  await page.route('https://static.line-scdn.net/**',r=>r.abort());
  await page.addInitScript(({E,UID,BASE,TEAM,roles,assigned,locked,theme})=>{
    window.__FAKE_USER={uid:UID,displayName:'隊長'};
    window.__FAKE_SEED={
      'config/env':{env:'demo'},[`users/${UID}`]:{uid:UID,displayName:'隊長'},
      ...(roles.length?{[`staff/${UID}`]:{active:true,roles,name:'管理員'}}:{}),
      [BASE]:{eventId:E,dates:['2026-10-09']},
      [`${BASE}/divisions/u10`]:{divisionId:'u10',name:'U10',order:3,eligibility:{bornOnOrAfter:'2016-01-01'}},
      [TEAM]:{teamId:'t',name:'所屬球隊',shortName:'所屬球隊',divisionId:'u10',captainUid:assigned?UID:null,
        managementLocked:locked,rosterLocked:true,status:'approved',source:'csv',memberCount:1,playerCount:1},
      [`${TEAM}/members/old`]:{memberId:'old',name:'原球員',kind:'player',role:'player',status:'approved',source:'csv',jerseyNo:7,birthDate:'2017-01-01',idLast4:'0012'}
    };
    localStorage.setItem('feda_theme',theme);
  },{E,UID,BASE,TEAM,roles,assigned,locked,theme});
  await page.goto('/#/my/teams'); await page.waitForFunction(()=>!!window.__fake);
  if(!assigned&&!roles.some(r=>['admin','super_admin'].includes(r)))return;
  await page.getByRole('button',{name:'U10 1 隊'}).click();
  const button=page.getByRole('button',{name:'新增 所屬球隊 的球員',exact:true});
  if(locked&&!roles.some(r=>['admin','super_admin'].includes(r)))return;
  await button.click(); await expect(dialog(page)).toBeVisible();
}
test('ADD-UI 只填姓名可新增，＋可新增多位並更新展開名單',async({page})=>{
  await open(page);
  await row(page).getByLabel('姓名／暱稱',{exact:true}).fill('新一');
  await dialog(page).getByRole('button',{name:'再新增球員',exact:true}).click();
  await expect(dialog(page).locator('.adm__newPlayer')).toHaveCount(2);
  await expect(row(page).getByLabel('姓名／暱稱',{exact:true})).toHaveValue('新一');
  await row(page,1).getByLabel('姓名／暱稱',{exact:true}).fill('新二');
  await row(page,1).getByLabel('背號',{exact:true}).fill('0');
  await save(page).click(); await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.adm__memberName')).toHaveText(['新二','原球員','新一']);
  expect((await calls(page))[0]).toMatchObject({name:'addTeamPlayers',payload:{teamId:'t',players:[
    {name:'新一',jerseyNo:null,birthDate:'',idLast4:''},{name:'新二',jerseyNo:0,birthDate:'',idLast4:''}]}});
  expect((await dump(page))[TEAM]).toMatchObject({memberCount:3,playerCount:3});
});
test('移除多填列保留其餘輸入，取消和空姓名不送出',async({page})=>{
  await open(page); await save(page).click(); await expect(dialog(page).getByRole('alert')).toContainText('姓名');
  await row(page).getByLabel('姓名／暱稱',{exact:true}).fill('保留');
  await dialog(page).getByRole('button',{name:'再新增球員'}).click();
  await dialog(page).getByRole('button',{name:'移除第 2 位球員'}).click();
  await expect(dialog(page).locator('.adm__newPlayer')).toHaveCount(1);
  await expect(row(page).getByLabel('姓名／暱稱',{exact:true})).toHaveValue('保留');
  await dialog(page).getByRole('button',{name:'取消',exact:true}).click(); expect(await calls(page)).toEqual([]);
});
test('選填 ROC 生日及後四碼保留 0，無效選填與離線不送出',async({page})=>{
  await open(page); await row(page).getByLabel('姓名／暱稱',{exact:true}).fill('小球');
  await row(page).locator('summary').click(); await row(page).getByLabel('出生民國年',{exact:true}).fill('109');
  await save(page).click(); await expect(dialog(page).getByRole('alert')).toContainText('完整');expect(await calls(page)).toEqual([]);
  await row(page).getByLabel('出生月',{exact:true}).fill('2'); await row(page).getByLabel('出生日',{exact:true}).fill('29');
  await row(page).getByLabel('身分證後四碼',{exact:true}).fill('0012'); await row(page).getByLabel('守門員',{exact:true}).check();
  await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{value:false,configurable:true}));
  await save(page).click(); await expect(dialog(page).getByRole('alert')).toContainText('離線');expect(await calls(page)).toEqual([]);
  await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{value:true,configurable:true})); await save(page).click();
  await expect(dialog(page)).toHaveCount(0);
  expect((await calls(page))[0].payload.players[0]).toMatchObject({birthDate:'2020-02-29',idLast4:'0012',isGoalkeeper:true});
});
test('上鎖隊長沒有新增入口',async({page})=>{
  await open(page,{locked:true}); await expect(page.getByRole('button',{name:'新增 所屬球隊 的球員'})).toHaveCount(0);
});
test('管理員在上鎖球隊仍可新增',async({page})=>{
  await open(page,{roles:['admin'],locked:true}); await expect(dialog(page)).toBeVisible();
  await row(page).getByLabel('姓名／暱稱',{exact:true}).fill('管理員新增');await save(page).click();await expect(dialog(page)).toHaveCount(0);
});
test('非隊長沒有新增球員入口',async({page})=>{
  await open(page,{assigned:false,roles:['staff']}); await expect(page.getByRole('button',{name:/新增.*的球員/})).toHaveCount(0);
});
test('ADD-RECEIPT 不完整回覆不顯示成功且保留輸入',async({page})=>{
  await open(page); await row(page).getByLabel('姓名／暱稱',{exact:true}).fill('新球員');
  await page.evaluate(()=>{window.__FAKE_ADD_PLAYERS_RESULT={};}); await save(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText('尚未確認');
  await expect(row(page).getByLabel('姓名／暱稱',{exact:true})).toHaveValue('新球員');
  await expect(page.locator('.toast--success')).toHaveCount(0); await expect(save(page)).toBeEnabled();
});
test('回覆遺失重送同一操作不重複新增',async({page})=>{
  await open(page); await row(page).getByLabel('姓名／暱稱',{exact:true}).fill('新球員');
  await page.evaluate(()=>{window.__FAKE_ADD_PLAYERS_LOST_RESPONSE=true;}); await save(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText('尚未確認'); await save(page).click(); await expect(dialog(page)).toHaveCount(0);
  const commands=await calls(page); expect(commands).toHaveLength(2);expect(commands[0].payload.operationId).toBe(commands[1].payload.operationId);
  expect(Object.keys(await dump(page)).filter(path=>path.startsWith(`${TEAM}/members/`))).toHaveLength(2);
});
test('等待回覆禁止再加列、重複送出與關閉；換頁清除彈窗',async({page})=>{
  await open(page); await row(page).getByLabel('姓名／暱稱',{exact:true}).fill('新球員');
  await page.evaluate(()=>{window.__FAKE_ADD_PLAYERS_PENDING=new Promise(resolve=>{window.__ADD_PLAYERS_RESOLVE=resolve;});});
  await save(page).click(); await expect(save(page)).toBeDisabled();await expect(dialog(page).getByRole('button',{name:'再新增球員'})).toBeDisabled();
  await page.keyboard.press('Escape');await expect(dialog(page)).toBeVisible();expect(await calls(page)).toHaveLength(1);
  await page.evaluate(()=>{location.hash='/my';});await expect(dialog(page)).toHaveCount(0);
  await page.evaluate(()=>window.__ADD_PLAYERS_RESOLVE());await expect(page.locator('.toast--success')).toHaveCount(0);
});
for(const theme of ['light','dark'])test(`ADD-LAYOUT 多位球員表單可捲動，按鈕可見且 320px 不溢出：${theme}`,async({page})=>{
  await open(page,{theme});
  for(let i=0;i<5;i++)await dialog(page).getByRole('button',{name:'再新增球員'}).click();
  const removeBounds=await row(page).getByRole('button',{name:'移除第 1 位球員'}).boundingBox();
  const fieldsBounds=await row(page).locator('.adm__newPlayerMain').boundingBox();
  expect(removeBounds.y+removeBounds.height).toBeLessThanOrEqual(fieldsBounds.y);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const bounds=await dialog(page).locator('.adm__addPlayersPanel').boundingBox();expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(page.viewportSize().height);
  const actions=await save(page).boundingBox();expect(actions.y+actions.height).toBeLessThanOrEqual(page.viewportSize().height);
  expect(await dialog(page).locator('.adm__addPlayersBody').evaluate(n=>n.scrollHeight>n.clientHeight)).toBe(true);
});
