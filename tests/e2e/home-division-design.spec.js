import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { DIVISIONS } from '../../js/engine/formats.js';
const FAKE=fs.readFileSync('tests/e2e/fake-firebase.js','utf8');
const root='events/feda-cup-2026';
async function stub(page,theme=null,divisionsState='ready'){
  await page.clock.setFixedTime(new Date('2026-09-29T10:00:00+08:00'));
  const fake = divisionsState === 'loading'
    ? FAKE.replace('S.stats.getDocs += 1;', 'S.stats.getDocs += 1; if (ref.path?.endsWith("/divisions")) await window.__divisionsPending;')
    : FAKE;
  await page.route('https://www.gstatic.com/firebasejs/**',r=>r.fulfill({contentType:'text/javascript',body:fake}));
  await page.route('https://firestore.googleapis.com/**',r=>r.fulfill({body:'{}'}));
  await page.route('https://static.line-scdn.net/**',r=>r.abort());
  const seed={'config/env':{env:'demo'},'config/registration':{open:false,hidden:true},'staff/design-admin':{roles:['admin'],active:true},'users/design-admin':{displayName:'測試管理員'}};
  for(const [i,d] of DIVISIONS.entries()){
    seed[`${root}/divisions/${d.divisionId}`]={...d,schedulePublished:true};
    seed[`${root}/teams/team-${i}`]={teamId:`team-${i}`,name:`${d.name}驗收隊`,divisionId:d.divisionId,status:'approved',memberCount:1,source:'csv'};
    seed[`${root}/matches/m-${i}`]={matchId:`m-${i}`,divisionId:d.divisionId,date:'2026-10-09',kickoffAt:'2026-10-09T10:00:00+08:00',venueId:'a',venueName:'A 場',label:'小組賽',status:i===0?'live':'scheduled',home:{teamId:`team-${i}`,name:'名稱很長也需要完整呈現的足球隊'},away:{teamId:`away-${i}`,name:'青禾足球隊'},teamIds:[`team-${i}`,`away-${i}`],score:{home:2,away:1},clock:{running:false,elapsedSecAtPause:360},period:'h1'};
  }
  if(divisionsState==='empty')for(const key of Object.keys(seed))if(key.startsWith(`${root}/divisions/`))delete seed[key];
  await page.addInitScript(({seed,theme,divisionsState})=>{
    window.__FAKE_SEED=seed;window.__FAKE_USER={uid:'design-admin'};
    if(theme)localStorage.setItem('feda_theme',theme);else localStorage.removeItem('feda_theme');
    if(divisionsState==='error')window.__FAKE_SNAPSHOT_FAIL={path:'/divisions',code:'unavailable'};
    if(divisionsState==='loading')window.__divisionsPending=new Promise(resolve=>{window.__releaseDivisions=resolve;});
  },{seed,theme,divisionsState});
}
async function contrast(node){return node.evaluate(el=>{
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)};
  const lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const a=lum(rgb(getComputedStyle(el).color)),b=lum(rgb(getComputedStyle(el).backgroundColor));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
})}
for(const scheme of ['light','dark']){
  test(`單鍵主題循環、Toast、系統變更與跨分頁同步 ${scheme}`,async({page,context})=>{
    await page.emulateMedia({colorScheme:scheme});await stub(page);await page.goto('/');
    const button=page.locator('.theme-switch__opt');await expect(button).toHaveCount(1);
    await expect(button).toHaveAttribute('data-pref','system');
    const opposite=scheme==='dark'?'light':'dark';
    for(const [pref,label] of [[opposite,opposite==='dark'?'深色':'淺色'],[scheme,scheme==='dark'?'深色':'淺色'],['system','跟隨系統']]){
      await button.click();await expect(button).toHaveAttribute('data-pref',pref);
      await expect(page.locator('#toast-root .toast:not(.is-leaving)').last()).toContainText(label);
      await expect(page.locator('html')).toHaveAttribute('data-theme',pref==='system'?scheme:pref);
    }
    await page.emulateMedia({colorScheme:opposite});await expect(page.locator('html')).toHaveAttribute('data-theme',opposite);
    await expect(button).toHaveAttribute('aria-label',new RegExp(`目前${opposite==='dark'?'深色':'淺色'}`));
    const other=await context.newPage();await other.route('**/theme-peer.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Theme sync</title>'}));await other.goto('/theme-peer.html');await other.evaluate(()=>localStorage.setItem('feda_theme','dark'));
    await expect(button).toHaveAttribute('data-pref','dark');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await other.close();
  });
  test(`首頁 A、固定六組色、完整名稱及所有快捷入口 ${scheme}`,async({page})=>{
    await stub(page,scheme);await page.goto('/');await expect(page.locator('.p-homeHero')).toBeVisible();
    await expect(page.locator('.p-homeHero img')).toHaveCount(0);
    await expect(page.locator('.p-homeHero__sponsor')).toHaveText('主要贊助商：宏明體育用品社');
    await expect(page.locator('.psponsor img')).toHaveCount(2);
    await expect(page.locator('.psponsor img[alt="宏明體育用品社"]')).toHaveCount(1);
    await expect(page.locator('.psponsor img[alt="美津濃 Mizuno"]')).toHaveCount(1);
    await page.locator('.psponsor').scrollIntoViewIfNeeded();
    for (const logo of await page.locator('.psponsor img').all()) {
      expect(await logo.evaluate(async image => { await image.decode(); return image.naturalWidth; })).toBe(1254);
    }
    await expect(page.locator('.p-homeShortcuts button')).toHaveCount(3);
    for(const d of DIVISIONS){const tile=page.locator(`.pdiv[data-division="${d.divisionId}"]`);await expect(tile).toHaveAttribute('data-division-tone',d.colorToken);expect(await contrast(tile)).toBeGreaterThanOrEqual(4.5)}
    await expect(page.locator('.prow[data-division-tone]').first()).toBeVisible();
    const challenge=page.locator('.pub__challengeEntry');expect(await challenge.evaluate(n=>getComputedStyle(n).borderTopWidth)).toBe('0px');
    for(const width of [320,360,390,430,1280]){
      await page.setViewportSize({width,height:950});
      const over=await page.locator('.p-home').evaluate(n=>[...n.querySelectorAll('button,.prow__team,.p-homeHero__copy')].filter(x=>x.scrollWidth>x.clientWidth+1).map(x=>x.className));expect(over).toEqual([]);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const partners = await page.locator('.psponsor__partner').evaluateAll(nodes => nodes.map(node => {
        const bounds = node.getBoundingClientRect(); return { top: bounds.top, left: bounds.left, right: bounds.right };
      }));
      expect(Math.abs(partners[0].top - partners[1].top)).toBeLessThan(1);
      expect(partners[0].right).toBeLessThan(partners[1].left);
    }
    await page.setViewportSize({width:390,height:980});await page.screenshot({path:`tools/home-final-${scheme}-${test.info().project.name}.png`,fullPage:true});
    await page.locator('.pchips').screenshot({path:`tools/division-palette-${scheme}-${test.info().project.name}.png`});
    await page.setViewportSize({width:320,height:568});
    await page.getByRole('button',{name:'各組排名',exact:true}).click();await expect(page.locator('.pdiv').first()).toBeFocused();
    await expect(page.locator('#toast-root .toast:not(.is-leaving)')).toHaveText('請選擇組別查看排名');
    await expect(page.locator('.pchips')).toBeInViewport({ratio:1});
    await page.getByRole('button',{name:'成人公開組',exact:true}).click();await expect(page).toHaveURL(/#\/division\/adult-open$/);
    await expect(page.getByRole('tab',{name:'積分榜',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page.locator('#toast-root .toast:not(.is-leaving)')).toHaveCount(0);
    await page.goto('/');
    await page.getByRole('button',{name:'完整賽程',exact:true}).click();await expect(page).toHaveURL(/#\/schedule/);
    await page.setViewportSize({width:320,height:900});
    await page.addStyleTag({content:'.ptabs[aria-label="日期"] .ptabs__btn{font-size:20px;letter-spacing:1px}'});
    for(const tab of await page.getByRole('tablist',{name:'日期'}).getByRole('tab').all()){
      expect(await tab.evaluate(n=>n.scrollWidth<=n.clientWidth+1 && n.getBoundingClientRect().right<=innerWidth)).toBe(true);
    }
  });
  test(`組別色延伸至組別、球隊、比賽、篩選及管理名冊 ${scheme}`,async({page})=>{
    await stub(page,scheme);
    for(const [i,d] of DIVISIONS.entries()){
      for(const route of [`division/${d.divisionId}`,`team/team-${i}`,`match/m-${i}`]){
        await page.goto(`/#/${route}`);await expect(page.locator('.pub')).toHaveAttribute('data-division-tone',d.colorToken);
      }
    }
    await page.goto('/#/schedule');await page.getByLabel('全部組別').selectOption('women');await expect(page.locator('.pub')).toHaveAttribute('data-division-tone','div-women');
    await page.getByLabel('全部組別').selectOption('');await expect(page.locator('.pub')).not.toHaveAttribute('data-division-tone');
    await page.goto('/#/admin/teams');await page.getByRole('tab',{name:/已通過/}).click();
    for(const d of DIVISIONS) await expect(page.locator(`.adm__item[data-division="${d.divisionId}"]`)).toHaveAttribute('data-division-tone',d.colorToken);
    await page.goto('/#/admin/team-import');await expect(page.locator('.division-key .division-badge')).toHaveCount(6);
  });
}

for(const [status,message] of [
  ['loading','組別資料載入中，請稍候再試。'],
  ['error','讀不到組別資料，請重新整理或稍後再試。'],
  ['empty','目前尚未設定組別，請稍後再查看。']
]){
  test(`首頁排名捷徑說明組別狀態：${status}`,async({page})=>{
    await stub(page,'light',status);await page.goto('/');
    await page.getByRole('button',{name:'各組排名',exact:true}).click();
    const activeToast=page.locator('#toast-root .toast:not(.is-leaving)');
    await expect(activeToast).toHaveText(message);
    await page.getByRole('button',{name:'各組排名',exact:true}).click();
    await expect(activeToast).toHaveCount(1);
    if(status==='loading'){
      await page.evaluate(()=>window.__releaseDivisions());
      await expect(page.locator('.pdiv')).toHaveCount(6);
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.getByRole('button',{name:'各組排名',exact:true}).click();
      await expect(activeToast).toHaveText('請選擇組別查看排名');
      await expect(page.locator('.pchips')).toBeInViewport({ratio:1});
    }
    await page.getByRole('button',{name:'完整賽程',exact:true}).click();
    await expect(page).toHaveURL(/#\/schedule/);
    await expect(activeToast).toHaveCount(0);
  });
}
