import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE=fs.readFileSync('tests/e2e/fake-firebase.js','utf8');
async function setup(page, date='2026-10-09T04:00:00Z') {
 await page.clock.setFixedTime(new Date(date));
 await page.route('https://www.gstatic.com/firebasejs/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:FAKE}));
 await page.route('https://firestore.googleapis.com/**',r=>r.fulfill({status:200,body:'{}'}));
 await page.addInitScript(()=>{window.__FAKE_VENUE_MAP_VISIBLE=true;window.__FAKE_SEED={'config/env':{env:'demo'},'events/feda-cup-2026':{dates:['2026-10-09','2026-10-10','2026-10-11']}};window.__FAKE_USER=null;});
 await page.goto('/#/');
 await expect(page.getByRole('dialog',{name:'今日場地配置'})).toBeVisible();
}
const dialog=page=>page.getByRole('dialog',{name:'今日場地配置'});
test('10/9 首張 ABCD、原圖完整、左右滑動及按鈕換圖 @venuemap',async({page})=>{
 await setup(page);const d=dialog(page),image=d.locator('img');
 await expect(image).toHaveAttribute('src',/taiyuan-abcd/);
 await expect(image).toHaveJSProperty('naturalWidth',1536);
 expect(await image.evaluate(e=>getComputedStyle(e).objectFit)).toBe('contain');
 await d.getByRole('button',{name:'下一張場地圖'}).click();await expect(image).toHaveAttribute('src',/taiyuan-ab\.png/);
 const box=await image.boundingBox();const x=box.x+box.width*.75,y=box.y+box.height/2;
 await image.dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',isPrimary:true,clientX:x,clientY:y});
 await image.dispatchEvent('pointerup',{pointerId:1,pointerType:'touch',isPrimary:true,clientX:x-100,clientY:y});
 await expect(image).toHaveAttribute('src',/taiyuan-abcd/);
 await d.press('ArrowLeft');await expect(image).toHaveAttribute('src',/taiyuan-ab\.png/);
 const bounds=await d.boundingBox();const size=page.viewportSize();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(size.width+1);expect(bounds.y+bounds.height).toBeLessThanOrEqual(size.height+1);
 await page.screenshot({path:`tmp/venue-map-${size.width}.png`});
 await d.getByRole('button',{name:'關閉場地配置'}).click();await expect(d).toHaveCount(0);
 await page.reload();await expect(dialog(page)).toBeVisible();
});
test('同日不再顯示、可手動重開、台灣午夜後恢復並換 AB 優先 @venuemap',async({page})=>{
 await setup(page);await dialog(page).getByRole('checkbox',{name:'今日不再顯示'}).check();
 await dialog(page).getByRole('button',{name:'關閉場地配置'}).click();
 await page.reload();await expect(page.locator('.p-homeShortcuts')).toBeVisible();await expect(dialog(page)).toHaveCount(0);
 await page.getByRole('button',{name:'場地配置',exact:true}).click();await expect(dialog(page)).toBeVisible();await expect(dialog(page).getByRole('checkbox')).toBeChecked();
 await dialog(page).press('Escape');await expect(dialog(page)).toHaveCount(0);
 await page.clock.setFixedTime(new Date('2026-10-09T16:00:00Z'));await page.reload();
 await expect(dialog(page)).toBeVisible();await expect(dialog(page).locator('img')).toHaveAttribute('src',/taiyuan-ab\.png/);
 await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
});
test('深色主題、取消隱藏以及路由離開後清理 @venuemap',async({page})=>{
 await setup(page,'2026-10-07T04:00:00Z');
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 await expect(dialog(page).locator('img')).toHaveAttribute('src',/taiyuan-ab\.png/);
 await dialog(page).getByRole('checkbox').check();await dialog(page).getByRole('checkbox').uncheck();
 await page.screenshot({path:`tmp/venue-map-dark-${page.viewportSize().width}.png`});
 await page.evaluate(()=>location.hash='/schedule');await expect(dialog(page)).toHaveCount(0);
 expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
 await page.evaluate(()=>location.hash='/');await expect(dialog(page)).toBeVisible();
});
