import { venueMapDay, orderedVenueMaps, shouldShowVenueMap, rememberVenueMapDay, venueMapStorageKey } from '../../js/lib/venue-map-policy.js';
import { EVENT, VENUE_MAPS } from '../../js/config.js';
test('台灣時間 10/9 18:00 前皆優先 ABCD；截止起永久 AB', () => {
  const ordered = instant => orderedVenueMaps(VENUE_MAPS, new Date(instant)).map(m => m.id);
  expect(ordered('2026-10-07T04:00:00Z')).toEqual(['abcd','ab']);
  expect(ordered('2026-10-09T09:59:59Z')).toEqual(['abcd','ab']);
  expect(ordered('2026-10-09T10:00:00Z')).toEqual(['ab','abcd']);
  expect(ordered('2026-10-10T00:00:00Z')).toEqual(['ab','abcd']);
  expect(ordered('2027-10-09T04:00:00Z')).toEqual(['ab','abcd']);
  expect(venueMapDay(new Date('2026-10-09T16:00:00Z'),EVENT.timezone)).toBe('2026-10-10');
});
test('今日不再顯示僅限同一活動與同一天，可取消勾選', () => {
  const data=new Map();const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  expect(shouldShowVenueMap(storage,EVENT.id,'2026-10-09')).toBe(true);
  rememberVenueMapDay(storage,EVENT.id,'2026-10-09',true);
  expect(data.get(venueMapStorageKey(EVENT.id))).toBe('2026-10-09');
  expect(shouldShowVenueMap(storage,EVENT.id,'2026-10-09')).toBe(false);
  expect(shouldShowVenueMap(storage,EVENT.id,'2026-10-10')).toBe(true);
  expect(shouldShowVenueMap(storage,'other-event','2026-10-09')).toBe(true);
  rememberVenueMapDay(storage,EVENT.id,'2026-10-09',false);
  expect(shouldShowVenueMap(storage,EVENT.id,'2026-10-09')).toBe(true);
});
test('Safari 停用儲存仍能顯示與關閉',()=>{
 const storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 expect(shouldShowVenueMap(storage,EVENT.id,'2026-10-09')).toBe(true);
 expect(()=>rememberVenueMapDay(storage,EVENT.id,'2026-10-09',true)).not.toThrow();
 expect(()=>rememberVenueMapDay(null,EVENT.id,'2026-10-09',false)).not.toThrow();
});
