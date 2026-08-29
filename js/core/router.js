/**
 * Hash 路由與頁面生命週期
 * 規格：docs/03-功能規格-公開端.md §1
 * 狀態：TODO(M4)
 *
 * ⚠️ 離開頁面時必須呼叫該頁註冊的所有 unsubscribe()，
 *    任一時刻的即時監聽數要 <= MAX_LISTENERS。
 */
export function initRouter(App) {
  // TODO(M4)
  console.info('[router] ready', App.env);
}
