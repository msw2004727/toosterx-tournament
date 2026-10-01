/** 相機掃碼：原生 QR 辨識優先，無支援時用隨站快取的 jsQR；影像不離開裝置。 */
import { el } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { parseScannedId } from '../../engine/challenge.js';

export function scanSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** 掃到挑戰卡才完成。取消／離頁 resolve null，相機錯誤 reject。 */
export function scanOnce({ signal } = {}) {
  if (!scanSupported()) return Promise.reject(new Error('此瀏覽器無法開啟相機，請手動輸入挑戰卡號。'));
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let stream = null, timer = null, done = false;
    const previousFocus = document.activeElement;
    const video = el('video', { class: 'scan__video', autoplay: 'true', playsinline: 'true', muted: 'true' });
    video.muted = true;
    const note = el('p', { class: 'scan__note', role: 'status', text: '正在開啟相機，請允許相機權限。' });
    const cancel = el('button', { class: 'btn btn--lg', type: 'button', onClick: () => finish(null) }, '取消，改用手動卡號');
    const dlg = el('div', { class: 'modal scan', role: 'dialog', 'aria-modal': 'true', 'aria-label': '掃描玩家的 QR' }, [
      el('div', { class: 'modal__panel scan__panel' }, [
        el('h2', { class: 'modal__title' }, [icon('qr'), document.createTextNode(' 對準玩家挑戰卡的 QR')]),
        el('div', { class: 'scan__frame' }, video), note,
        el('div', { class: 'modal__actions' }, cancel)
      ])
    ]);
    const stop = media => media?.getTracks().forEach(track => track.stop());
    const abort = () => finish(null);
    const hidden = () => { if (document.hidden) finish(null); };
    const key = e => { if (e.key === 'Escape') finish(null); };
    function cleanup() {
      if (done) return false;
      done = true;
      clearTimeout(timer);
      stop(stream);
      video.srcObject = null;
      signal?.removeEventListener('abort', abort);
      window.removeEventListener('pagehide', abort);
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('keydown', key);
      dlg.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      return true;
    }
    function finish(value) { if (cleanup()) resolve(value); }
    signal?.addEventListener('abort', abort, { once: true });
    window.addEventListener('pagehide', abort);
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('keydown', key);
    document.body.append(dlg);
    cancel.focus();

    void start();
    async function start() {
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (done) { stop(acquired); return; }
        stream = acquired;
        video.srcObject = stream;
        await video.play();
        if (done) return;
        let detector = null, decode = null;
        try {
          if (typeof window.BarcodeDetector === 'function') detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch { /* 不支援 QR 時改用 jsQR */ }
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        async function fallback() {
          if (!decode) decode = (await import('../../lib/vendor/jsqr.js')).default;
          if (done || !context || !video.videoWidth || !video.videoHeight) return null;
          const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          return decode(frame.data, frame.width, frame.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
        }
        async function tick() {
          if (done) return;
          try {
            if (video.readyState >= 2) {
              let raw = null;
              if (detector) {
                try { raw = (await detector.detect(video)).find(c => c.rawValue)?.rawValue ?? null; }
                catch { detector = null; }
              }
              if (!detector) raw = await fallback();
              if (done) return;
              if (raw && parseScannedId(raw)) { finish(raw); return; }
              if (raw) note.textContent = '這不是有效的挑戰卡 QR，請對準玩家「我的 QR」或手動輸入卡號。';
            }
          } catch {
            note.textContent = '暫時無法辨識，請調整光線與距離，或取消後手動輸入卡號。';
          }
          if (!done) timer = setTimeout(tick, 250);
        }
        note.textContent = '請對準挑戰卡 QR；掃不到可取消，改用手動卡號。';
        await tick();
      } catch (err) {
        if (cleanup()) reject(new Error(err?.name === 'NotAllowedError'
          ? '相機權限被拒絕。請在瀏覽器設定允許相機，或手動輸入卡號。'
          : '開不了相機，請用 Safari／Chrome 重試，或手動輸入卡號。'));
      }
    }
  });
}
