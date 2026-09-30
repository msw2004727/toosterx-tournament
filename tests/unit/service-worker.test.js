import vm from 'node:vm';
import fs from 'node:fs';

function worker() {
  const handlers = {}, files = new Map();
  let offline = false, body = 'network';
  const key = r => typeof r === 'string' ? r : r.url;
  const cache = {
    add: async r => files.set(key(r), new Response('shell')),
    put: async (r, response) => files.set(key(r), response),
    match: async (r, options) => {
      const k = key(r);
      const stored = options?.ignoreSearch
        ? [...files].find(([s]) => s.split('?')[0] === k.split('?')[0])?.[1] : files.get(k);
      return stored?.clone();
    }
  };
  const fetch = async () => { if (offline) throw new Error('offline'); return new Response(body); };
  vm.runInNewContext(fs.readFileSync('sw.js', 'utf8'), {
    self: { location: { origin: 'https://cup.test' }, addEventListener: (type, fn) => { handlers[type] = fn; } },
    caches: { open: async () => cache, match: cache.match }, fetch, URL, console, Response
  });
  return {
    files, offline: () => { offline = true; }, body: value => { body = value; },
    async request(path, { html = false } = {}) {
      let response;
      const pending = [];
      handlers.fetch({ request: { method: 'GET', url: new URL(path, 'https://cup.test').href,
        mode: html ? 'navigate' : 'cors', headers: new Headers({ accept: html ? 'text/html' : '*/*' }) },
      respondWith: p => { response = p; }, waitUntil: p => pending.push(p) });
      const result = await response;
      await Promise.all(pending);
      return result;
    }
  };
}

test('成功瀏覽的 HTML 和模組在斷網後仍能重開', async () => {
  const sw = worker();
  await sw.request('/', { html: true });
  await sw.request('/js/core/firebase.js');
  await sw.request('https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js');
  sw.offline();
  for (const [path, html] of [['/', true], ['/js/core/firebase.js', false], ['https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js', false]]) {
    await expect(sw.request(path, { html }).then(r => r?.text())).resolves.toBe('network');
  }
});

test('HTML 每次以網路為準；不快取 API、登入參數或任意第三方資料', async () => {
  const sw = worker();
  await sw.request('/', { html: true });
  sw.body('new');
  expect(await (await sw.request('/', { html: true })).text()).toBe('new');
  expect(await sw.request('/?code=secret&state=oauth', { html: true })).toBeUndefined();
  expect(await sw.request('https://firestore.googleapis.com/v1/data')).toBeUndefined();
  expect(await sw.request('https://thirdparty.test/a.js')).toBeUndefined();
  expect([...sw.files.keys()].some(k => k.includes('secret'))).toBe(false);
});
