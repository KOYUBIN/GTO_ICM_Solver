'use client';

import { parseOcrPoker, type OcrPokerResult } from '@gto/engine';

export interface OcrRun {
  text: string;
  parsed: OcrPokerResult;
}

/**
 * Run OCR on an image entirely in the browser. tesseract.js is heavy (~WASM +
 * language data fetched from a CDN at runtime), so it's loaded lazily via a
 * dynamic import the first time this is called — it never ships in the SSR
 * bundle. `onProgress` reports 0..1 recognition progress.
 */
export async function ocrImage(file: File | Blob, onProgress?: (p: number) => void): Promise<OcrRun> {
  const { default: Tesseract } = await import('tesseract.js');
  const { data } = await Tesseract.recognize(file, 'eng', {
    logger: (msg: { status?: string; progress?: number }) => {
      if (msg.status === 'recognizing text' && typeof msg.progress === 'number') {
        onProgress?.(msg.progress);
      }
    },
  });
  const text = data.text ?? '';
  return { text, parsed: parseOcrPoker(text) };
}
