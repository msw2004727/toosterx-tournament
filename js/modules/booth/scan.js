/**
 * 攤位在瀏覽器裡掃玩家的 QR
 * ------------------------------------------------------------------
 * 只用瀏覽器內建的 BarcodeDetector（Android Chrome 有；iPhone Safari 沒有）。
 * 沒有的裝置不畫「掃描」鈕——用手機相機 App 掃玩家的 QR 一樣能用：QR 裡放的是
 * 攤位頁的網址（…/#/booth?id=FEDA-0182），相機掃到就直接開攤位頁並帶入代號。
 *
 * 不裝任何掃碼套件、不從 CDN 載：挑戰區整天在戶外用手機網路，CDN 一慢整個攤位停擺
 * （跟 QR 產生器不用套件是同一個理由）。掃不到永遠有備援：卡片上的大字代號。
 */
import { el } from '../../core/ui.js';
import { icon } from '../../core/icons.js';

export function scanSupported() {
  return typeof window !== 'undefined'
    && 'BarcodeDetector' in window
    && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * 開相機掃一次。掃到就 resolve 字串；按取消 resolve null；開不了相機 reject（呼叫端要 toast）。
 * @returns {Promise<string|null>}
 */
export function scanOnce() {
  return new Promise((resolve, reject) => {
    let stream = null;
    let timer = null;
    let done = false;

    const video = el('video', { class: 'scan__video', autoplay: 'true', playsinline: 'true', muted: 'true' });
    const dlg = el('div', { class: 'modal scan', role: 'dialog', 'aria-modal': 'true', 'aria-label': '掃描玩家的 QR' }, [
      el('div', { class: 'modal__panel scan__panel' }, [
        el('h2', { class: 'modal__title' }, [icon('qr'), document.createTextNode(' 對準玩家的 QR')]),
        el('div', { class: 'scan__frame' }, video),
        el('p', { class: 'scan__note', text: '掃不到就按取消，直接輸入卡片上的代號。' }),
        el('div', { class: 'modal__actions' }, [
          el('button', { class: 'btn btn--lg', type: 'button', onClick: () => finish(null) }, '取消')
        ])
      ])
    ]);

    function cleanup() {
      if (done) return false;
      done = true;
      if (timer) clearInterval(timer);
      try { stream?.getTracks().forEach(t => t.stop()); } catch { /* 已經停了 */ }
      dlg.remove();
      return true;
    }
    function finish(value) { if (cleanup()) resolve(value); }

    document.body.append(dlg);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        video.srcObject = stream;
        await video.play();
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        timer = setInterval(async () => {
          if (done || video.readyState < 2) return;
          try {
            const codes = await detector.detect(video);
            const hit = codes.find(c => c.rawValue);
            if (hit) finish(hit.rawValue);
          } catch { /* 這一格辨識失敗，下一格再試 */ }
        }, 250);
      } catch (err) {
        if (cleanup()) {
          reject(new Error(err?.name === 'NotAllowedError'
            ? '相機權限被拒絕。到瀏覽器設定允許相機，或直接輸入代號。'
            : '開不了相機，請直接輸入卡片上的代號。'));
        }
      }
    })();
  });
}
