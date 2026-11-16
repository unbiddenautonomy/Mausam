// Free memo reading on the phone itself, with Tesseract OCR. No key, no cost, works offline after the first use.
// The engine (about 4 MB) and the English + Kannada language data (about 5 MB) download the first time only,
// from this app's own /ocr/ path, and the phone keeps them.
import { parseMemoText, type MemoReadResult, type OcrLine } from "@mausam/shared";
import { loadPhoto } from "./api";

export type OcrStage = "loading" | "reading";

/** Phone photos are big; Tesseract does best with text around 30 px tall, so cap the long side. */
const MAX_SIDE = 2000;

async function prepare(photoKey: string): Promise<HTMLCanvasElement> {
  const url = await loadPhoto(photoKey);
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d")!;
  // Grey and a little more contrast helps pen on paper under kitchen lights.
  ctx.filter = "grayscale(1) contrast(1.4)";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Reads the memo photo on this phone. `onProgress` gets the stage and 0 to 1. */
export async function readMemoOnPhone(
  photoKey: string,
  onProgress: (stage: OcrStage, progress: number) => void,
): Promise<{ result: MemoReadResult; text: string }> {
  onProgress("loading", 0);
  const [{ createWorker, OEM, PSM }, canvas] = await Promise.all([import("tesseract.js"), prepare(photoKey)]);
  const worker = await createWorker(["eng", "kan"], OEM.LSTM_ONLY, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/",
    langPath: "/ocr",
    gzip: true,
    // A blob worker would break the app's security rules; load it from our own path instead.
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === "recognizing text") onProgress("reading", m.progress);
      else if (m.status?.startsWith("loading")) onProgress("loading", m.progress);
    },
  });
  try {
    // One column of lines of different sizes keeps "item ..... amount" on one line.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN });
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const lines: OcrLine[] = [];
    for (const b of data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const l of p.lines) {
          // How sure it is about the numbers matters more than about the words.
          const numeric = l.words.filter((w) => /\d/.test(w.text));
          const confidence = numeric.length ? Math.min(...numeric.map((w) => w.confidence)) : l.confidence;
          lines.push({ text: l.text, confidence });
        }
    return { result: parseMemoText(lines), text: data.text };
  } finally {
    await worker.terminate();
  }
}
