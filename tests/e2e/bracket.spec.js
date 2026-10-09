import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const formats = JSON.parse(fs.readFileSync('tests/fixtures/bracket-formats.json', 'utf8'));
const E = 'events/feda-cup-2026';
function seed(id = 'F4_RR_SEMIFINAL') {
  const s = { 'config/env': { env: 'demo' }, 'config/formats': { formats },
    [`${E}/divisions/women`]: { divisionId: 'women', name: '女子組', formatId: id, schedulePublished: true,
      groupNames: { A: '女子', B: '乙組' }, playersOnField: 5, matchDurationMin: 25, display: { mercyRule: { enabled: false } } } };
  for (const stage of formats[id].stages) for (const slot of stage.slots || []) s[`${E}/matches/${slot.matchKey}`] = {
    divisionId: 'women', matchKey: slot.matchKey, stageId: stage.stageId, label: slot.label,
    status: 'scheduled', home: {}, away: {}, score: { home: 0, away: 0 },
    date: '2026-10-10', kickoffAt: '2026-10-10T10:00:00+08:00', venueName: 'A場'
  };
  return s;
}
function finish(s) {
  const names = ['很長的球隊名稱測試足球俱樂部', '中城FC', '<img src=x onerror=alert(1)>', '山海'];
  const teams = names.map((name, i) => ({ teamId: `t${i}`, name }));
  for (const [key, h, a] of [['SF1', 0, 1], ['SF2', 2, 3], ['F1', 0, 2], ['F3', 1, 3]]) {
    Object.assign(s[`${E}/matches/${key}`], { home: teams[h], away: teams[a], status: 'finished',
      result: { winner: 'home' }, score: { home: 2, away: 1 } });
  }
  return s;
}
async function open(page, s, route = '/#/division/women?tab=bracket') {
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ body: '{}' }));
  await page.addInitScript(data => { window.__FAKE_SEED = data; window.__FAKE_USER = null; }, s);
  await page.goto(route); await expect(page.getByRole('tab', { name: '晉級／名次圖' })).toBeVisible();
}
test('四強三層實際版面、長隊名、深淺色、點擊場次 @bracket', async ({ page }, testInfo) => {
  await open(page, finish(seed()));
  await expect(page.locator('.pbracket__node')).toHaveCount(7);
  await expect(page.locator('.pbracket__tier')).toHaveCount(3);
  await expect(page.locator('.pbracket__links path')).toHaveCount(6);
  await expect(page.locator('.pbracket__node--root')).toContainText('很長的球隊名稱測試足球俱樂部');
  await expect(page.locator('.pbracket img')).toHaveCount(0);
  await expect(page.locator('.pbracket__node.is-winner')).toHaveCount(4);
  await expect(page.locator('.pbracket__winnerMark svg')).toHaveCount(4);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const boxes = await page.locator('.pbracket__node').evaluateAll(nodes => nodes.map(n => ({ width: n.clientWidth, scroll: n.scrollWidth, height: n.clientHeight })));
    expect(boxes.every(b => b.scroll <= b.width + 1 && b.height >= 44)).toBe(true);
    const marks = await page.locator('.pbracket__winnerMark').evaluateAll(nodes => nodes.map(n => {
      const mark = n.getBoundingClientRect(), card = n.closest('.pbracket__node').getBoundingClientRect(), scroll = n.closest('.pbracket__scroll').getBoundingClientRect(), tree = n.closest('.pbracket__tree').getBoundingClientRect();
      return { protrudes: mark.top < card.top, visible: mark.top >= scroll.top, within: mark.left >= tree.left && mark.right <= tree.right };
    }));
    expect(marks.every(m => m.protrudes && m.visible && m.within)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`bracket-${theme}.png`), fullPage: true });
  }
  await page.locator('.pbracket__node--root').click();
  await expect(page).toHaveURL(/#\/match\/F1$/);
});

test('滿版卡片等寬，冠軍畫布無框線、比例及按鍵 @bracket', async ({ page }) => {
  await open(page, seed('F6_GROUP_TOP_SEED_BYE'));
  const viewport=page.locator('.pbracket__viewport--gestures');
  await expect(viewport.locator('.pbracket__zoomTools,.pbracket__scrollArrow')).toHaveCount(0);
  const layout=await viewport.evaluate(n=>{
    const scroll=n.querySelector('.pbracket__scroll'),tree=n.querySelector('.pbracket__tree'),r=scroll.getBoundingClientRect(),t=tree.getBoundingClientRect();
    return {widths:[...n.querySelectorAll('.pbracket__node')].map(c=>c.offsetWidth),fits:t.left>=r.left-1&&t.right<=r.right+1&&t.bottom<=r.bottom+1,border:getComputedStyle(scroll).borderWidth,touch:getComputedStyle(scroll).touchAction};
  });
  expect(layout.widths.every(w=>w===160)).toBe(true);expect(layout.fits).toBe(true);expect(layout.border).toBe('0px');expect(layout.touch).toBe('pan-y');
});
test('單指捲動網頁，雙指連續縮放與自由平移，操作後位置保留 @bracketgesture', async ({ page }) => {
  await open(page, finish(seed()));
  const scroll=page.locator('.pbracket__scroll--gestures');
  await scroll.evaluate(n=>n.scrollIntoView({block:'center'}));
  const read=()=>scroll.evaluate(n=>({scale:Number(n.dataset.scale),x:Number(n.dataset.panX),y:Number(n.dataset.panY)}));
  const initial=await read();
  const session=await page.context().newCDPSession(page);
  let box=await scroll.boundingBox();
  const pageY=await page.evaluate(()=>scrollY);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height*.7,id:1}]});
  for(let i=1;i<=8;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height*.7-i*15,id:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(pageY+30);
  expect(await read()).toEqual(initial);
  await page.waitForTimeout(350);await scroll.evaluate(n=>n.scrollIntoView({block:'center'}));
  box=await scroll.boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;
  const fixedPageY=await page.evaluate(()=>scrollY);
  const points=(distance,dx=0,dy=0)=>[{x:x-distance+dx,y:y+dy,id:1},{x:x+distance+dx,y:y+dy,id:2}];
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(25)});
  const scales=[];
  for(let i=1;i<=6;i++){
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(25+i*7)});
    await page.evaluate(()=>new Promise(requestAnimationFrame));scales.push((await read()).scale);
  }
  expect(scales.every((s,i)=>s>(i?scales[i-1]:initial.scale))).toBe(true);
  expect(scales.at(-1)).toBeCloseTo(initial.scale*67/25,2);
  const beforePan=await read();
  for(let i=1;i<=6;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(67,i*7,-i*8)});
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  const afterPan=await read();expect(afterPan.x-beforePan.x).toBeCloseTo(42,0);expect(afterPan.y-beforePan.y).toBeCloseTo(-48,0);expect(afterPan.scale).toBeCloseTo(beforePan.scale,5);
  for(let i=5;i>=0;i--)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(25+i*7,42,-48)});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  expect((await read()).scale).toBeCloseTo(initial.scale,3);
  expect(await page.evaluate(()=>scrollY)).toBe(fixedPageY);
  await expect(page).toHaveURL(/tab=bracket$/);
  const position=await read();
  await page.evaluate(({E,m})=>window.__fake.__seed({[`${E}/matches/F1`]:m}),{E,m:{...finish(seed())[`${E}/matches/F1`],score:{home:3,away:1}}});
  const saved=await read();expect(saved.scale).toBeCloseTo(position.scale,5);expect(saved.x).toBeCloseTo(position.x,5);expect(saved.y).toBeCloseTo(position.y,5);
  await page.locator('.pbracket__node--root').click();await expect(page).toHaveURL(/#\/match\/F1$/);
});
test('直接連結、待定不填零分，切分頁回收監聽 @bracket', async ({ page }) => {
  await open(page, seed(), '/#/division/women/bracket');
  await expect(page.locator('.pbracket__node--root')).toContainText('冠軍待定');
  await expect(page.locator('.pbracket__node--root')).not.toHaveClass(/is-winner/);
  await expect(page.locator('.pbracket__score')).toHaveCount(0);
  await expect(page.locator('.pbracket__name').filter({ hasText: '女子第2名' })).toHaveCount(1);
  const count = () => page.evaluate(() => window.__FAKE_STATE.watchers.size);
  const baseline = await count();
  await page.getByRole('tab', { name: '球隊', exact: true }).click();
  await expect(page.getByText('球隊名單準備中')).toBeVisible();
  await page.getByRole('tab', { name: '晉級／名次圖' }).click();
  await expect(page.locator('.pbracket__tree')).toBeVisible();
  expect(await count()).toBe(baseline);
});
for (const id of ['F6_GROUP_TOP_SEED_BYE', 'F8_GROUP_TOP_SEED_BYE']) test(`${id} 輪空連線與名次賽 @bracket`, async ({ page }) => {
  await open(page, seed(id));
  await expect(page.locator('.pbracket__node')).toHaveCount(11);
  await expect(page.locator('.pbracket__tier')).toHaveCount(4);
  await expect(page.locator('.pbracket__links path')).toHaveCount(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.pbracket .prow')).toHaveCount(id.startsWith('F8') ? 3 : 1);
});
test('即時改判、重開、PK 與撤回發布 @bracket', async ({ page }) => {
  const s = finish(seed()); await open(page, s);
  await expect(page.locator('.pbracket__node--root')).not.toContainText('冠軍待定');
  const final = s[`${E}/matches/F1`];
  final.status = 'live';
  await page.evaluate(({ E, m }) => window.__fake.__seed({ [`${E}/matches/F1`]: m }), { E, m: final });
  await expect(page.locator('.pbracket__node--root')).toContainText('冠軍待定');
  final.status = 'finished'; final.score = { home: 1, away: 1 }; final.result.winner = 'away'; final.penaltyScore = { home: 3, away: 4 };
  await page.evaluate(({ E, m }) => window.__fake.__seed({ [`${E}/matches/F1`]: m }), { E, m: final });
  await expect(page.locator('.pbracket__node--root')).toContainText('PK 3-4');
  await expect(page.locator('.pbracket__node--root .pbracket__name')).toHaveText('<img src=x onerror=alert(1)>');
  s[`${E}/matches/SF2`].status = 'live';
  await page.evaluate(({ E, m }) => window.__fake.__seed({ [`${E}/matches/SF2`]: m }), { E, m: s[`${E}/matches/SF2`] });
  await expect(page.locator('.pbracket__node--root')).toContainText('冠軍待定');
  await page.evaluate(({ E, d }) => window.__fake.__seed({ [`${E}/divisions/women`]: { ...d, schedulePublished: false } }), { E, d: s[`${E}/divisions/women`] });
  await expect(page.getByText('賽程準備中')).toBeVisible();
  await expect(page.locator('.pbracket__tree')).toHaveCount(0);
});
test('缺賽制、未發布、缺場與純循環有明確狀態 @bracket', async ({ page }) => {
  const s = seed(); s[`${E}/divisions/women`].schedulePublished = false;
  await open(page, s); await expect(page.getByText('賽程準備中')).toBeVisible();
  await page.evaluate(({ E, d }) => window.__fake.__seed({ [`${E}/divisions/women`]: { ...d, schedulePublished: true, formatId: 'missing' } }), { E, d: s[`${E}/divisions/women`] });
  await expect(page.getByText('對戰圖整理中')).toBeVisible();
  await page.evaluate(() => window.__fake.__seed({ 'config/formats': { formats: { missing: { stages: [{ type: 'roundRobin' }] } } } }));
  await expect(page.getByText('本組採循環賽')).toBeVisible();
});
