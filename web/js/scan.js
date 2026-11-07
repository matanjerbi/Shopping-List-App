// Barcode scanning from the camera. Uses the native BarcodeDetector when available
// (Android Chrome), otherwise ZXing (iPhone Safari).
let zxingP = null;
function loadZxing() {
  if (!zxingP) {
    zxingP = new Promise((resolve, reject) => {
      if (window.ZXing) return resolve(window.ZXing);
      const s = document.createElement("script");
      s.src = new URL("vendor/zxing.min.js", location.href).href;
      s.onload = () => resolve(window.ZXing);
      s.onerror = () => reject(new Error("טעינת סורק הברקודים נכשלה"));
      document.head.appendChild(s);
    });
  }
  return zxingP;
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

/** Starts scanning into a <video>. Returns stop(). onCode(code) called once per new code. */
export async function startScanner(video, onCode, onError) {
  let stopped = false;
  let stream = null;
  let last = "";
  const emit = (c) => {
    if (c && c !== last) {
      last = c;
      if (navigator.vibrate) navigator.vibrate(60);
      onCode(c);
    }
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    onError(new Error("אין גישה למצלמה. אשר הרשאת מצלמה בדפדפן."));
    return () => {};
  }
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  await video.play().catch(() => {});

  if ("BarcodeDetector" in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const det = new window.BarcodeDetector({ formats: FORMATS.filter((f) => supported.includes(f)) });
      const loop = async () => {
        if (stopped) return;
        try {
          const codes = await det.detect(video);
          if (codes.length) emit(codes[0].rawValue);
        } catch {}
        setTimeout(loop, 200);
      };
      loop();
      return () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); };
    } catch {}
  }
  try {
    const ZX = await loadZxing();
    const hints = new Map();
    hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E, ZX.BarcodeFormat.CODE_128]);
    hints.set(ZX.DecodeHintType.TRY_HARDER, true);
    const reader = new ZX.MultiFormatReader();
    reader.setHints(hints);
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const loop = () => {
      if (stopped) return;
      if (video.videoWidth) {
        // scan the middle band of the frame
        const w = video.videoWidth, h = video.videoHeight;
        const bh = Math.round(h * 0.4);
        c.width = w; c.height = bh;
        ctx.drawImage(video, 0, (h - bh) / 2, w, bh, 0, 0, w, bh);
        try {
          const src = new ZX.HTMLCanvasElementLuminanceSource(c);
          const bmp = new ZX.BinaryBitmap(new ZX.HybridBinarizer(src));
          const r = reader.decode(bmp);
          if (r) emit(r.getText());
        } catch {}
      }
      setTimeout(loop, 180);
    };
    loop();
  } catch (e) {
    onError(e);
  }
  return () => { stopped = true; if (stream) stream.getTracks().forEach((t) => t.stop()); };
}
