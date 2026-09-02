import type { RasterImage } from './types.ts';

/**
 * The one part of the scanner that touches the DOM.
 *
 * Everything downstream works on plain typed arrays, which is what lets the
 * analysis be tested without a browser. Nothing here uploads anything: the
 * file is decoded in the page, measured in the page, and discarded when the
 * tab closes. There is no server in this app to send it to.
 */

/**
 * Longest edge the analysis works at.
 *
 * A 12-megapixel photograph is not 20 times more informative than this about
 * where an edge is — it is 20 times more pixels of the same lens blur, and
 * segmenting it interactively would stutter. At 720 px a subject filling the
 * frame resolves to about 0.15% of its own height, which is finer than the
 * pose, the clothing and the lens together will support.
 */
export const MAX_WORKING_DIMENSION = 720;

/** Decode an image file and downscale it to the working size. */
export async function loadRasterImage(
  file: File,
  maxDimension = MAX_WORKING_DIMENSION,
): Promise<RasterImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('This browser did not provide a 2D canvas context.');
    context.drawImage(bitmap, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    return { width, height, data: imageData.data };
  } finally {
    bitmap.close();
  }
}

/** A small JPEG data URL, so a saved scan is recognisable in a list. */
export function thumbnailDataUrl(image: RasterImage, maxWidth = 96): string {
  const scale = Math.min(1, maxWidth / image.width);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const source = document.createElement('canvas');
  source.width = image.width;
  source.height = image.height;
  const sourceContext = source.getContext('2d');
  if (sourceContext === null) return '';
  // Copy into a fresh, definitely-not-shared buffer: ImageData rejects a
  // Uint8ClampedArray whose backing store might be a SharedArrayBuffer.
  const pixels = new Uint8ClampedArray(image.data.length);
  pixels.set(image.data);
  sourceContext.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);

  const target = document.createElement('canvas');
  target.width = width;
  target.height = height;
  const targetContext = target.getContext('2d');
  if (targetContext === null) return '';
  targetContext.drawImage(source, 0, 0, width, height);
  return target.toDataURL('image/jpeg', 0.6);
}
