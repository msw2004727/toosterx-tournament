/**
 * 離線佇列狀態｜送出三態
 * 規格：docs/04-功能規格-賽務裁判端.md §5.7
 * 狀態：TODO(M3)
 *
 * 監聽 snapshot.metadata.hasPendingWrites，把狀態分成：
 *   queued（已記錄，等待同步）／ saved（已儲存）／ failed（儲存失敗，可重試）
 * 絕不允許按下送出後 UI 顯示成功但實際沒寫入。
 */
export function initSync() {
  // TODO(M3)
}
