/**
 * 送出三態｜對應 docs/04 §5.7
 *
 * 不可協商：按下送出後，UI 絕不能顯示成功但實際沒寫入。
 * 這份測試就是在守這條線。
 */
import {
  track, subscribe, summary, list, retry, retryAll, dismiss,
  setOnline, isOnline, resetSync, exportFailed, describeError,
  QUEUE_WARN_THRESHOLD
} from '../../js/core/sync.js';

/** 手動控制 resolve/reject 的 Promise */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const fsError = code => Object.assign(new Error(code), { code });
const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => { resetSync(); setOnline(true); });

describe('三態', () => {
  test('送出當下是 queued，不是 saved', () => {
    const d = deferred();
    track('記錄進球', () => d.promise);
    expect(summary().queued).toBe(1);
    expect(summary().level).toBe('queued');
    expect(list()[0].state).toBe('queued');
  });

  test('伺服器確認後才變 saved', async () => {
    const d = deferred();
    const { promise } = track('記錄進球', () => d.promise);
    d.resolve();
    expect((await promise).state).toBe('saved');
    expect(list()[0].state).toBe('saved');
    expect(summary().queued).toBe(0);
  });

  test('⭐ 回傳的 promise 永遠 resolve，不會產生 unhandled rejection', async () => {
    // 三態 UI 的前提是「送出後不要 await」，呼叫端不該被迫記得 .catch()
    const r = await track('會失敗的寫入', () => Promise.reject(fsError('permission-denied'))).promise;
    expect(r.state).toBe('failed');
    expect(r.error.code).toBe('permission-denied');
  });

  test('被 rules 擋下時變 failed 並保留可重試', async () => {
    const d = deferred();
    const { promise } = track('記錄進球', () => d.promise);
    d.reject(fsError('permission-denied'));
    await promise;
    const rec = list()[0];
    expect(rec.state).toBe('failed');
    expect(rec.error.code).toBe('permission-denied');
    expect(summary().level).toBe('failed');
  });

  test('⭐ 離線時 Promise 一直 pending，狀態必須停在 queued 而不是 saved', async () => {
    const d = deferred();                       // 永遠不 resolve，模擬離線
    track('完賽送出', () => d.promise);
    await tick();
    await tick();
    expect(list()[0].state).toBe('queued');
    expect(summary().level).toBe('queued');
  });

  test('失敗優先於待送：只要有一筆失敗就亮紅燈', async () => {
    await track('A', () => Promise.reject(fsError('permission-denied'))).promise;
    track('B', () => deferred().promise);
    expect(summary().level).toBe('failed');
  });

  test('離線時即使沒有待送也是黃燈', () => {
    setOnline(false);
    expect(summary().level).toBe('queued');
    expect(isOnline()).toBe(false);
  });
});

describe('錯誤訊息要說下一步', () => {
  test('每個常見錯誤碼都有具體指引，不是「驗證失敗」', () => {
    for (const code of ['permission-denied', 'unauthenticated', 'not-found', 'failed-precondition', 'unavailable']) {
      const d = describeError(fsError(code));
      expect(d.code).toBe(code);
      expect(d.message.length).toBeGreaterThan(8);
      expect(d.message).not.toMatch(/^驗證失敗$/);
    }
    expect(describeError(fsError('permission-denied')).message).toContain('管理員');
  });

  test('未知錯誤也給得出下一步', () => {
    expect(describeError(new Error('boom')).message).toContain('送出失敗');
    expect(describeError(undefined).message).toContain('請重試');
  });
});

describe('重試', () => {
  test('重試成功後變 saved，tries 遞增', async () => {
    let attempt = 0;
    const thunk = () => (++attempt === 1 ? Promise.reject(fsError('unavailable')) : Promise.resolve('ok'));
    const { id, promise } = track('記錄進球', thunk);
    await promise;
    expect(list()[0].state).toBe('failed');

    await retry(id);
    expect(list()[0].state).toBe('saved');
    expect(list()[0].tries).toBe(2);
  });

  test('只有 failed 的可以重試', async () => {
    const d = deferred();
    const { id } = track('X', () => d.promise);
    expect(retry(id)).toBeNull();
  });

  test('retryAll 一次重送全部失敗的', async () => {
    let fail = true;
    await track('A', () => (fail ? Promise.reject(fsError('unavailable')) : Promise.resolve())).promise;
    await track('B', () => (fail ? Promise.reject(fsError('unavailable')) : Promise.resolve())).promise;
    expect(summary().failed).toBe(2);

    fail = false;
    await retryAll();
    expect(summary().failed).toBe(0);
  });

  test('⭐ 恢復連線只自動重試網路類錯誤，權限錯誤不會被無謂重送', async () => {
    let netTries = 0, permTries = 0;
    await track('網路', () => { netTries++; return Promise.reject(fsError('unavailable')); }).promise;
    await track('權限', () => { permTries++; return Promise.reject(fsError('permission-denied')); }).promise;
    expect(netTries).toBe(1);
    expect(permTries).toBe(1);

    setOnline(false);
    setOnline(true);
    await tick();
    expect(netTries).toBe(2);       // 自動重試
    expect(permTries).toBe(1);      // 沒有重試
  });

  test('放棄一筆失敗的寫入（改用紙本補登）', async () => {
    const { id, promise } = track('A', () => Promise.reject(fsError('invalid-argument')));
    await promise;
    dismiss(id);
    expect(summary().failed).toBe(0);
  });
});

describe('訂閱與匯出', () => {
  test('訂閱時立刻收到目前狀態，之後每次變動都收到', async () => {
    const seen = [];
    const off = subscribe(s => seen.push(s.level));
    expect(seen).toEqual(['saved']);

    const d = deferred();
    const { promise } = track('A', () => d.promise);
    expect(seen.at(-1)).toBe('queued');
    d.resolve();
    await promise;
    expect(seen.at(-1)).toBe('saved');
    off();
  });

  test('取消訂閱後不再收到通知', () => {
    let n = 0;
    const off = subscribe(() => n++);
    const before = n;
    off();
    track('A', () => deferred().promise);
    expect(n).toBe(before);
  });

  test('某個訂閱者丟例外不會影響其他訂閱者', () => {
    subscribe(() => { throw new Error('壞掉的訂閱者'); });
    let ok = 0;
    subscribe(() => ok++);
    track('A', () => deferred().promise);
    expect(ok).toBeGreaterThan(1);
  });

  test('匯出失敗內容供賽務複製給管理員', async () => {
    const { promise } = track('完賽送出 第31場', () => Promise.reject(fsError('permission-denied')), { matchId: 'AO-G-A-01' });
    await promise;
    const text = exportFailed();
    expect(text).toContain('完賽送出 第31場');
    expect(text).toContain('AO-G-A-01');
    expect(text).toContain('權限不足');
  });

  test('list() 不外洩 thunk（避免誤把函式序列化到別處）', () => {
    track('A', () => deferred().promise);
    expect(list()[0]).not.toHaveProperty('thunk');
  });
});

describe('佇列告警', () => {
  test(`待送達 ${QUEUE_WARN_THRESHOLD} 筆時提示賽務找網路`, () => {
    for (let i = 0; i < QUEUE_WARN_THRESHOLD - 1; i++) track(`第${i}筆`, () => deferred().promise);
    expect(summary().warnQueue).toBe(false);
    track('最後一筆', () => deferred().promise);
    expect(summary().warnQueue).toBe(true);
  });
});

describe('穩健性', () => {
  test('thunk 同步丟例外也算 failed，不會讓整個流程炸掉', async () => {
    const { promise } = track('壞掉的操作', () => { throw new Error('參數組錯'); });
    await promise;
    expect(list()[0].state).toBe('failed');
  });

  test('thunk 回傳非 Promise 時視為立即成功', async () => {
    const { promise } = track('本機操作', () => 'done');
    await promise;
    expect(list()[0].state).toBe('saved');
  });
});
