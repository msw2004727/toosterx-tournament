import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js','utf8');
test('global zoom guard preserves single-finger gestures @zoom', async ({page}) => {
  await page.route('https://www.gstatic.com/firebasejs/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:FAKE}));
  await page.goto('/#/');
  await expect(page.locator('.p-homeShortcuts')).toBeVisible();
  const result = await page.evaluate(() => {
    const dispatch = (type, count) => {
      const e = new Event(type,{bubbles:true,cancelable:true});
      if(count !== undefined) Object.defineProperty(e,'touches',{value:Array(count).fill({})});
      document.body.dispatchEvent(e); return e.defaultPrevented;
    };
    return {pinch:dispatch('touchmove',2),scroll:dispatch('touchmove',1),
      safari:dispatch('gesturechange'),pan:getComputedStyle(document.body).touchAction};
  });
  expect(result).toEqual({pinch:true,scroll:false,safari:true,pan:'pan-x pan-y'});
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content',/maximum-scale=1,user-scalable=no/);
});
