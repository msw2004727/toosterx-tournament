/** 以活動時區的日曆日決定圖片順序與當日隱藏，不使用首頁預覽日期。 */
export function venueMapDay(date = new Date(), timezone = 'Asia/Taipei') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export const venueMapStorageKey = eventId => `venue-map:${eventId}:hidden-day`;
export function orderedVenueMaps(maps, day) {
  const first = maps.find(m => m.preferredDate === day) ?? maps.find(m => m.default) ?? maps[0];
  return first ? [first, ...maps.filter(m => m !== first)] : [];
}
export function shouldShowVenueMap(storage, eventId, day) {
  try { return storage.getItem(venueMapStorageKey(eventId)) !== day; }
  catch { return true; }
}
export function rememberVenueMapDay(storage, eventId, day, hidden) {
  try {
    if (hidden) storage.setItem(venueMapStorageKey(eventId), day);
    else storage.removeItem(venueMapStorageKey(eventId));
  } catch { /* Safari 私密模式或停用儲存仍可正常查看與關閉。 */ }
}
