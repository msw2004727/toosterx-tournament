/** @jest-environment jsdom */
import { jest } from '@jest/globals';

test('同一路由快速重新載入，舊頁完成時不能回收新頁監聽', async () => {
  document.body.innerHTML = '<div id="app-view"></div>';
  window.scrollTo = jest.fn();
  history.replaceState(null, '', '#/audit');
  const router = await import('../../js/core/router.js');
  const store = await import('../../js/core/store.js');
  let finishOld;
  const oldDone = new Promise(resolve => { finishOld = resolve; });
  const currentUnsubscribe = jest.fn();
  let renders = 0;
  router.route('/audit', async ({ scope }) => {
    if (++renders === 1) await oldDone;
    else store.hold(scope, currentUnsubscribe);
  });
  router.initRouter({ env: 'test' });
  await new Promise(resolve => setTimeout(resolve, 0));
  await router.navigate('/audit');
  finishOld();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(currentUnsubscribe).not.toHaveBeenCalled();
  expect(store.count()).toBe(1);
  store.releaseAll();
});
