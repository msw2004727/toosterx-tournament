import { initGestureZoom } from '../../js/core/gesture-zoom.js';
test('Safari gestures and multi-touch are cancelled; scrolling and cleanup remain available', () => {
  const target = new EventTarget();
  const dispose = initGestureZoom(target);
  const touch = count => {
    const event = new Event('touchmove', {cancelable:true});
    Object.defineProperty(event, 'touches', {value: Array(count).fill({})});
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  for (const type of ['gesturestart','gesturechange','gestureend']) {
    const event = new Event(type, {cancelable:true});
    target.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  }
  expect(touch(2)).toBe(true); expect(touch(1)).toBe(false);
  dispose(); expect(touch(2)).toBe(false);
  const event = new Event('gesturestart',{cancelable:true});
  target.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
});
