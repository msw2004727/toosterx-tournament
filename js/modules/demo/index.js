/**
 * Demo 專屬模組｜正式版永遠不會 import 這個檔案
 * 規格：README.md「Demo 專屬功能」
 * 狀態：TODO(M4)
 *
 *  1. 頂部常駐 DEMO 橫幅（不可關閉）
 *  2. 免 LINE 登入的角色切換器
 *  3. 一鍵重置種子資料
 */
export function mount(App) {
  const el = document.getElementById('demo-banner');
  if (!el) return;
  el.hidden = false;
  el.textContent = 'DEMO 展示環境・此處比分與名次皆為測試資料，非正式賽果';
  el.style.cssText =
    'position:sticky;top:0;z-index:99;background:#D4A03C;color:#14181A;' +
    'font-size:12px;font-weight:700;text-align:center;padding:6px 12px;letter-spacing:.02em';
}
