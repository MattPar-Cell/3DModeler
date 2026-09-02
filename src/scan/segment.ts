import type { Mask, RasterImage } from './types.ts';

/**
 * Foreground segmentation.
 *
 * The scanner is not an AI model and does not pretend to be one. It assumes
 * what a person can easily arrange: a subject standing against a background it
 * contrasts with. Everything here is a classical image-processing step whose
 * failure modes are predictable and explainable, which matters more for a tool
 * whose output becomes a measurement than a cleverer method whose errors are
 * not.
 */

export interface SegmentOptions {
  /**
   * Fraction of the image's edge sampled to estimate the background colour.
   * The subject is assumed not to touch the frame edge.
   */
  readonly borderFraction?: number;
  /**
   * Multiplies the automatic threshold. Below 1 includes more of the image in
   * the subject, above 1 less. Exposed as the sidebar's sensitivity slider.
   */
  readonly sensitivity?: number;
}

const DEFAULT_BORDER_FRACTION = 0.06;

/**
 * Median colour of the image's border band, as an RGB triple.
 *
 * Median rather than mean: if the subject reaches the frame edge — which is
 * common, and already flagged as a warning elsewhere — a mean is dragged
 * toward the subject's own colour, and the segmentation then fails to find
 * anything that differs from "background". The median shrugs that off until
 * the subject occupies more than half the border.
 */
export function estimateBackground(
  image: RasterImage,
  borderFraction = DEFAULT_BORDER_FRACTION,
): { r: number; g: number; b: number } {
  const bandX = Math.max(1, Math.round(image.width * borderFraction));
  const bandY = Math.max(1, Math.round(image.height * borderFraction));
  const histograms = [new Int32Array(256), new Int32Array(256), new Int32Array(256)];
  let count = 0;

  for (let y = 0; y < image.height; y += 1) {
    const inVerticalBand = y < bandY || y >= image.height - bandY;
    for (let x = 0; x < image.width; x += 1) {
      if (!inVerticalBand && x >= bandX && x < image.width - bandX) {
        // Skip the interior in one jump rather than testing every pixel.
        x = image.width - bandX - 1;
        continue;
      }
      const i = (y * image.width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const channel = histograms[c];
        const value = image.data[i + c] ?? 0;
        if (channel !== undefined) channel[value] = (channel[value] ?? 0) + 1;
      }
      count += 1;
    }
  }
  if (count === 0) return { r: 0, g: 0, b: 0 };

  const median = (histogram: Int32Array | undefined): number => {
    if (histogram === undefined) return 0;
    const target = count / 2;
    let seen = 0;
    for (let v = 0; v < 256; v += 1) {
      seen += histogram[v] ?? 0;
      if (seen >= target) return v;
    }
    return 255;
  };
  return { r: median(histograms[0]), g: median(histograms[1]), b: median(histograms[2]) };
}

/**
 * Distance from the background colour, per pixel, scaled to 0-255.
 *
 * Luma is weighted lower than chroma so a shadow on the backdrop — same hue,
 * lower brightness — does not read as subject.
 */
export function backgroundDistance(
  image: RasterImage,
  background: { r: number; g: number; b: number },
): Uint8Array {
  const out = new Uint8Array(image.width * image.height);
  const { r: br, g: bg, b: bb } = background;
  const backgroundLuma = 0.299 * br + 0.587 * bg + 0.114 * bb;
  for (let p = 0; p < out.length; p += 1) {
    const i = p * 4;
    const r = image.data[i] ?? 0;
    const g = image.data[i + 1] ?? 0;
    const b = image.data[i + 2] ?? 0;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    // Chroma difference: the colour with its brightness taken out.
    const cr = r - luma - (br - backgroundLuma);
    const cg = g - luma - (bg - backgroundLuma);
    const cb = b - luma - (bb - backgroundLuma);
    const chroma = Math.sqrt(cr * cr + cg * cg + cb * cb);
    const brightness = Math.abs(luma - backgroundLuma);
    out[p] = Math.min(255, Math.round(chroma * 1.6 + brightness * 0.7));
  }
  return out;
}

/**
 * Otsu's method: the threshold that best separates a histogram into two
 * classes, by maximising the variance between them. Chosen over a fixed
 * threshold because exposure varies wildly between photographs.
 */
export function otsuThreshold(values: Uint8Array): number {
  const histogram = new Float64Array(256);
  for (const value of values) histogram[value] = (histogram[value] ?? 0) + 1;

  const total = values.length;
  if (total === 0) return 128;

  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * (histogram[i] ?? 0);

  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let bestVariance = -1;
  for (let t = 0; t < 256; t += 1) {
    weightBackground += histogram[t] ?? 0;
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += t * (histogram[t] ?? 0);
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const between =
      weightBackground *
      weightForeground *
      (meanBackground - meanForeground) *
      (meanBackground - meanForeground);
    if (between > bestVariance) {
      bestVariance = between;
      best = t;
    }
  }
  return best;
}

/** 3x3 erosion, then dilation: removes speckle without shrinking the subject. */
function open(mask: Uint8Array, width: number, height: number): Uint8Array {
  return dilate(erode(mask, width, height), width, height);
}

/** 3x3 dilation, then erosion: closes pinholes without growing the subject. */
function close(mask: Uint8Array, width: number, height: number): Uint8Array {
  return erode(dilate(mask, width, height), width, height);
}

function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      out[i] =
        (mask[i] ?? 0) &&
        (mask[i - 1] ?? 0) &&
        (mask[i + 1] ?? 0) &&
        (mask[i - width] ?? 0) &&
        (mask[i + width] ?? 0)
          ? 1
          : 0;
    }
  }
  return out;
}

function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      out[i] =
        (mask[i] ?? 0) ||
        (mask[i - 1] ?? 0) ||
        (mask[i + 1] ?? 0) ||
        (mask[i - width] ?? 0) ||
        (mask[i + width] ?? 0)
          ? 1
          : 0;
    }
  }
  return out;
}

/**
 * Keep only the largest connected region.
 *
 * A photograph almost always contains something else that differs from the
 * backdrop — a shadow edge, a skirting board, a hand holding the object. The
 * subject is the biggest such region, and everything else is noise.
 */
export function largestComponent(mask: Uint8Array, width: number, height: number): Uint8Array {
  const labels = new Int32Array(mask.length).fill(-1);
  const stack: number[] = [];
  let bestLabel = -1;
  let bestSize = 0;
  let label = 0;

  for (let start = 0; start < mask.length; start += 1) {
    if ((mask[start] ?? 0) === 0 || labels[start] !== -1) continue;
    let size = 0;
    stack.push(start);
    labels[start] = label;
    while (stack.length > 0) {
      const p = stack.pop();
      if (p === undefined) break;
      size += 1;
      const x = p % width;
      const y = (p - x) / width;
      if (x > 0 && (mask[p - 1] ?? 0) === 1 && labels[p - 1] === -1) {
        labels[p - 1] = label;
        stack.push(p - 1);
      }
      if (x < width - 1 && (mask[p + 1] ?? 0) === 1 && labels[p + 1] === -1) {
        labels[p + 1] = label;
        stack.push(p + 1);
      }
      if (y > 0 && (mask[p - width] ?? 0) === 1 && labels[p - width] === -1) {
        labels[p - width] = label;
        stack.push(p - width);
      }
      if (y < height - 1 && (mask[p + width] ?? 0) === 1 && labels[p + width] === -1) {
        labels[p + width] = label;
        stack.push(p + width);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = label;
    }
    label += 1;
  }

  const out = new Uint8Array(mask.length);
  if (bestLabel === -1) return out;
  for (let p = 0; p < mask.length; p += 1) out[p] = labels[p] === bestLabel ? 1 : 0;
  return out;
}

/**
 * Fill enclosed holes: flood the background inward from the frame edge, and
 * anything still unvisited was surrounded by subject. A dark logo on a lamp
 * base or a shadow under a chin would otherwise punch a hole in the mask and
 * distort the width measured at that row.
 */
export function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  const push = (p: number): void => {
    if ((mask[p] ?? 0) === 0 && outside[p] === 0) {
      outside[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length > 0) {
    const p = stack.pop();
    if (p === undefined) break;
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (y > 0) push(p - width);
    if (y < height - 1) push(p + width);
  }

  const out = new Uint8Array(mask.length);
  for (let p = 0; p < mask.length; p += 1) out[p] = outside[p] === 1 ? 0 : 1;
  return out;
}

/** Separate the subject from the background. */
export function segmentSubject(image: RasterImage, options: SegmentOptions = {}): Mask {
  const background = estimateBackground(image, options.borderFraction);
  const distance = backgroundDistance(image, background);
  const threshold = otsuThreshold(distance) * (options.sensitivity ?? 1);

  const raw = new Uint8Array(distance.length);
  for (let p = 0; p < distance.length; p += 1) raw[p] = (distance[p] ?? 0) > threshold ? 1 : 0;

  const cleaned = close(open(raw, image.width, image.height), image.width, image.height);
  const subject = largestComponent(cleaned, image.width, image.height);
  return { width: image.width, height: image.height, data: fillHoles(subject, image.width, image.height) };
}
