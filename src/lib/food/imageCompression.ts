'use client';

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.8;
// Vercel serverless rejects request bodies over ~4.5 MB before our route runs.
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export function computeTargetDimensions(
  width: number,
  height: number,
): { width: number; height: number; scaled: boolean } {
  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_DIMENSION) return { width, height, scaled: false };
  const scale = MAX_DIMENSION / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale), scaled: true };
}

// Returns the original file when decoding fails (e.g. HEIC in a browser
// without support) — the server will respond with a clear 415 instead.
export async function compressImageForAnalysis(file: File): Promise<File> {
  if (typeof createImageBitmap !== 'function') return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  try {
    const target = computeTargetDimensions(bitmap.width, bitmap.height);
    if (!target.scaled && file.size <= MAX_UPLOAD_BYTES && file.type === 'image/jpeg') return file;
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) return file;
    return new File([blob], 'meal.jpg', { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
