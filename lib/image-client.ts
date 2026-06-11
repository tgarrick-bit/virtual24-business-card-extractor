'use client';

import jsQR from 'jsqr';
import { parseQrPayload, isUrlPayload, type QrContactResult } from '@/lib/vcard';

// Client-side image preparation: decode any QR code on the card and downscale
// the photo before it ships to the extraction API. Both work off one canvas
// render so the photo is only decoded once.

export interface PreparedImage {
  blob: Blob; // downscaled JPEG (or the original file when already small)
  qrContact: QrContactResult | null;
  qrUrl: string | null;
}

const MAX_DIMENSION = 1400; // keep fine print legible for OCR/vision
const JPEG_QUALITY = 0.85;
const SMALL_ENOUGH_BYTES = 500_000;

async function drawToCanvas(file: File): Promise<{ canvas: HTMLCanvasElement; scaled: boolean }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { canvas, scaled: scale < 1 };
}

function decodeQr(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(imageData.data, imageData.width, imageData.height);
  return result?.data || null;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas encoding failed'))),
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  let canvas: HTMLCanvasElement;
  let scaled: boolean;
  try {
    ({ canvas, scaled } = await drawToCanvas(file));
  } catch {
    // Old browser or unreadable image: send the original and skip QR.
    return { blob: file, qrContact: null, qrUrl: null };
  }

  let qrContact: QrContactResult | null = null;
  let qrUrl: string | null = null;
  try {
    const payload = decodeQr(canvas);
    if (payload) {
      qrContact = parseQrPayload(payload);
      if (!qrContact) qrUrl = isUrlPayload(payload);
    }
  } catch {
    // QR decoding is best effort; never fail the scan over it.
  }

  let blob: Blob = file;
  if (scaled || file.size > SMALL_ENOUGH_BYTES) {
    try {
      blob = await canvasToBlob(canvas);
    } catch {
      blob = file;
    }
  }

  return { blob, qrContact, qrUrl };
}
