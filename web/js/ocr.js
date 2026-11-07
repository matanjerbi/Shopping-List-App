// Receipt OCR (Hebrew + English) with Tesseract.js, loaded lazily.
let workerP = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("טעינת מנוע הזיהוי נכשלה"));
    document.head.appendChild(s);
  });
}

const abs = (p) => new URL(p, location.href).href;

async function getWorker(onProgress) {
  if (!workerP) {
    workerP = (async () => {
      await loadScript(abs("vendor/tesseract/tesseract.min.js"));
      const w = await window.Tesseract.createWorker(["heb", "eng"], 1, {
        workerPath: abs("vendor/tesseract/worker.min.js"),
        corePath: abs("vendor/tesseract/core"),
        langPath: abs("vendor/tesseract/lang"),
        gzip: true,
        logger: (m) => workerP && workerP.onProgress && workerP.onProgress(m),
      });
      await w.setParameters({ tessedit_pageseg_mode: "4", preserve_interword_spaces: "1" });
      return w;
    })();
    workerP.catch(() => (workerP = null));
  }
  workerP.onProgress = onProgress;
  return workerP;
}

/** Downscale/upscale, grayscale and boost contrast — thermal receipts OCR much better this way. */
async function preprocess(file) {
  const bmp = await createImageBitmap(file);
  const targetW = Math.min(2000, Math.max(1200, bmp.width));
  const scale = targetW / bmp.width;
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
    sum += g;
  }
  const mean = sum / (d.length / 4);
  for (let i = 0; i < d.length; i += 4) {
    let g = (d[i] - mean) * 1.6 + 150;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  const thumb = document.createElement("canvas");
  const ts = 240 / c.width;
  thumb.width = 240;
  thumb.height = Math.round(c.height * ts);
  thumb.getContext("2d").drawImage(c, 0, 0, thumb.width, thumb.height);
  return { canvas: c, thumb: thumb.toDataURL("image/jpeg", 0.6) };
}

/** files: File[] (a long receipt may be photographed in parts). */
export async function ocrReceipt(files, onProgress = () => {}) {
  onProgress({ stage: "טוען מנוע זיהוי טקסט…", p: 0.02 });
  const worker = await getWorker((m) => {
    if (m.status === "recognizing text") onProgress({ stage: "קורא את הקבלה…", p: 0.1 + 0.85 * (m.progress || 0) });
    else onProgress({ stage: "טוען מנוע זיהוי טקסט…", p: 0.05 });
  });
  let text = "";
  let thumb = "";
  for (const f of files) {
    const { canvas, thumb: t } = await preprocess(f);
    if (!thumb) thumb = t;
    const r = await worker.recognize(canvas);
    text += "\n" + r.data.text;
  }
  onProgress({ stage: "מסיים…", p: 1 });
  return { text, thumb };
}
