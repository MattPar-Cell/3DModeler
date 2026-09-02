import type { Mask, RasterImage } from './types.ts';

/**
 * Foreground segmentation.
 *
 * The scanner is not an AI model and does not pretend to be one. Everything
 * here is a classical image-processing step whose failure modes are predictable
 * and explainable, which matters more for a tool whose output becomes a
 * measurement than a cleverer method whose errors are not.
 *
 * The first version assumed a single background colour, which is fine for a
 * subject against a plain wall and useless outdoors: a beach photograph has
 * sky, rock, sea and sand in its border, and their average is a colour that
 * appears nowhere in the image. Tanned legs then failed to separate from pale
 * sand and were cut off at the knee. The background is therefore modelled as
 * several colours per horizontal band, and the operator can correct what is
 * left with seed points.
 */

/** A point the operator has labelled, to correct what the automatic pass got wrong. */
export interface Seed {
  readonly x: number;
  readonly y: number;
  readonly kind: 'subject' | 'background';
}

export interface SegmentOptions {
  /**
   * Fraction of the image's edge sampled to model the background.
   * The subject is assumed not to touch the frame edge.
   */
  readonly borderFraction?: number;
  /**
   * Multiplies the automatic threshold. Below 1 includes more of the image in
   * the subject, above 1 less. Exposed as the sidebar's sensitivity slider.
   */
  readonly sensitivity?: number;
  /** Operator corrections. */
  readonly seeds?: readonly Seed[];
}

const DEFAULT_BORDER_FRACTION = 0.06;
/**
 * Colours kept for the background. Sky, rock, sea and sand is four, and a
 * gradient across any of them can want a fifth.
 */
const BACKGROUND_MODES = 6;
/** Quantisation used to find a band's dominant colours, bits per channel. */
const MODE_BITS = 4;

/** A colour in CIELAB, which is where all the distances below are measured. */
interface Lab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

/**
 * sRGB to CIELAB.
 *
 * Distances are taken in Lab rather than RGB because the discriminations that
 * matter here — tanned skin against pale sand, dark hair against wet rock — are
 * ones RGB distance handles badly and Lab handles about as well as anything
 * without a learned model.
 */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const linear = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const rl = linear(r);
  const gl = linear(g);
  const bl = linear(b);

  // sRGB primaries, D65 white point.
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;

  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/**
 * Distance between two colours.
 *
 * Lightness is weighted below chroma so a shadow falling across the backdrop —
 * same material, less light — does not read as a different thing.
 */
function labDistance(p: Lab, q: Lab): number {
  const dl = (p.l - q.l) * 0.55;
  const da = p.a - q.a;
  const db = p.b - q.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** Two colours closer than this in Lab are the same material to this scanner. */
const MODE_MERGE_DISTANCE = 12;
/** A colour must cover this share of the samples to count as a background mode. */
const MIN_MODE_SHARE = 0.08;

/**
 * The dominant colours of a set of samples.
 *
 * Two rules make this robust where a plain histogram peak is not. Buckets
 * closer than {@link MODE_MERGE_DISTANCE} are merged, so sensor noise splitting
 * one wall across neighbouring bins does not consume two of the slots. And a
 * colour must cover {@link MIN_MODE_SHARE} of the samples to be admitted at
 * all, which is what keeps a subject that crosses the frame edge from being
 * adopted as a background colour — the failure that made a lamp shade
 * indistinguishable from the wall behind it.
 */
function dominantColours(
  samples: readonly { r: number; g: number; b: number }[],
  count: number,
  minShare = MIN_MODE_SHARE,
): Lab[] {
  if (samples.length === 0) return [];
  const shift = 8 - MODE_BITS;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const sample of samples) {
    const key =
      ((sample.r >> shift) << (MODE_BITS * 2)) |
      ((sample.g >> shift) << MODE_BITS) |
      (sample.b >> shift);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, { n: 1, r: sample.r, g: sample.g, b: sample.b });
    else {
      bucket.n += 1;
      bucket.r += sample.r;
      bucket.g += sample.g;
      bucket.b += sample.b;
    }
  }

  const ordered = [...buckets.values()]
    .map((bucket) => ({
      n: bucket.n,
      colour: rgbToLab(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n),
    }))
    .sort((a, b) => b.n - a.n);

  const merged: { n: number; colour: Lab }[] = [];
  for (const entry of ordered) {
    const near = merged.find((m) => labDistance(m.colour, entry.colour) < MODE_MERGE_DISTANCE);
    if (near === undefined) merged.push({ n: entry.n, colour: entry.colour });
    else near.n += entry.n;
  }

  const floor = samples.length * minShare;
  const admitted = merged.filter((m) => m.n >= floor).slice(0, count);
  // Never return nothing: with no admitted mode there is no background at all
  // to compare against, and every pixel reads as subject.
  if (admitted.length === 0 && merged.length > 0) {
    const first = merged[0];
    if (first !== undefined) return [first.colour];
  }
  return admitted.map((m) => m.colour);
}

/** The background, as the set of colours found around the frame's edge. */
export interface BackgroundModel {
  readonly modes: readonly Lab[];
}

/**
 * Model the background from the frame's border.
 *
 * Several colours, not one. A beach photograph has sky, rock, sea and sand in
 * its border, and their average is a colour that appears nowhere in the image —
 * which is why tanned legs failed to separate from pale sand and were cut off
 * at the knee.
 *
 * An earlier attempt modelled each horizontal band separately, on the reasoning
 * that sky belongs at the top and sand at the bottom. That was worse: a band the
 * subject happens to cross has a border made largely of subject, and the band
 * then adopts the subject's own colour as background. The palette is discovered
 * globally instead, where the subject is a small minority of the perimeter and
 * the share floor excludes it. Offering the whole palette everywhere costs
 * nothing, because a colour only matters if the subject resembles it, and a
 * person resembles neither sky nor sand.
 */
export function buildBackgroundModel(
  image: RasterImage,
  options: SegmentOptions = {},
): BackgroundModel {
  const borderFraction = options.borderFraction ?? DEFAULT_BORDER_FRACTION;
  const bandX = Math.max(1, Math.round(image.width * borderFraction));
  const bandY = Math.max(1, Math.round(image.height * borderFraction));

  const samples: { r: number; g: number; b: number }[] = [];
  for (let y = 0; y < image.height; y += 1) {
    const inHorizontalStrip = y < bandY || y >= image.height - bandY;
    for (let x = 0; x < image.width; x += 1) {
      if (!inHorizontalStrip && x >= bandX && x < image.width - bandX) {
        x = image.width - bandX - 1;
        continue;
      }
      const i = (y * image.width + x) * 4;
      samples.push({
        r: image.data[i] ?? 0,
        g: image.data[i + 1] ?? 0,
        b: image.data[i + 2] ?? 0,
      });
    }
  }

  // Background seeds are instructions, not evidence to be outvoted by a share.
  const seeded: { r: number; g: number; b: number }[] = [];
  for (const seed of options.seeds ?? []) {
    if (seed.kind !== 'background') continue;
    const cx = Math.round(seed.x);
    const cy = Math.round(seed.y);
    for (let y = cy - 2; y <= cy + 2; y += 1) {
      for (let x = cx - 2; x <= cx + 2; x += 1) {
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
        const i = (y * image.width + x) * 4;
        seeded.push({
          r: image.data[i] ?? 0,
          g: image.data[i + 1] ?? 0,
          b: image.data[i + 2] ?? 0,
        });
      }
    }
  }

  return {
    modes: [
      ...dominantColours(samples, BACKGROUND_MODES),
      ...dominantColours(seeded, 4, 0),
    ],
  };
}

/** Colours the operator has marked as subject. */
function subjectColours(image: RasterImage, seeds: readonly Seed[]): Lab[] {
  const samples: { r: number; g: number; b: number }[] = [];
  for (const seed of seeds) {
    if (seed.kind !== 'subject') continue;
    const cx = Math.round(seed.x);
    const cy = Math.round(seed.y);
    // A small neighbourhood, so one click describes a material rather than a pixel.
    for (let y = cy - 2; y <= cy + 2; y += 1) {
      for (let x = cx - 2; x <= cx + 2; x += 1) {
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
        const i = (y * image.width + x) * 4;
        samples.push({
          r: image.data[i] ?? 0,
          g: image.data[i + 1] ?? 0,
          b: image.data[i + 2] ?? 0,
        });
      }
    }
  }
  // A seed is an instruction, not evidence to be outvoted.
  return dominantColours(samples, 4, 0);
}

/**
 * How unlike the background each pixel is, scaled to 0-255.
 *
 * When the operator has marked subject colours, a pixel's resemblance to those
 * is subtracted: it is not enough to differ from the sand, it helps to look
 * like the thing that was pointed at.
 */
export function modelDistance(
  image: RasterImage,
  model: BackgroundModel,
  subject: readonly Lab[] = [],
): Uint8Array {
  const out = new Uint8Array(image.width * image.height);
  for (let p = 0; p < out.length; p += 1) {
    const i = p * 4;
    const colour = rgbToLab(image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0);

    let nearestBackground = Number.POSITIVE_INFINITY;
    for (const mode of model.modes) {
      const d = labDistance(colour, mode);
      if (d < nearestBackground) nearestBackground = d;
    }
    let score = Number.isFinite(nearestBackground) ? nearestBackground : 0;

    if (subject.length > 0) {
      let nearestSubject = Number.POSITIVE_INFINITY;
      for (const mode of subject) {
        const d = labDistance(colour, mode);
        if (d < nearestSubject) nearestSubject = d;
      }
      if (Number.isFinite(nearestSubject)) score -= nearestSubject * 0.6;
    }
    out[p] = Math.max(0, Math.min(255, Math.round(score * 3)));
  }
  return out;
}

/**
 * Median colour of the image's border band.
 *
 * Superseded by {@link buildBackgroundModel} for segmentation, and kept because
 * it is the honest one-number summary of a background — the preview uses it to
 * say what the automatic pass thinks it is looking at.
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

/** Distance from a single background colour. Kept for the plain-wall case. */
export function backgroundDistance(
  image: RasterImage,
  background: { r: number; g: number; b: number },
): Uint8Array {
  const reference = rgbToLab(background.r, background.g, background.b);
  const out = new Uint8Array(image.width * image.height);
  for (let p = 0; p < out.length; p += 1) {
    const i = p * 4;
    const colour = rgbToLab(image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0);
    out[p] = Math.max(0, Math.min(255, Math.round(labDistance(colour, reference) * 3)));
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

/**
 * Keep the components the operator pointed at, or the largest if they pointed
 * at nothing.
 *
 * This is the escape hatch that matters. When a leg is lost because it happens
 * to match the sand behind it, the leg survives thresholding as its own small
 * component and is then thrown away for not being the largest. One click on the
 * shin keeps it. A click marked background removes whatever it lands on, for
 * the opposite failure.
 */
export function keepSeededComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  seeds: readonly Seed[],
): Uint8Array {
  const subjectSeeds = seeds.filter((seed) => seed.kind === 'subject');
  const backgroundSeeds = seeds.filter((seed) => seed.kind === 'background');
  if (subjectSeeds.length === 0 && backgroundSeeds.length === 0) {
    return largestComponent(mask, width, height);
  }

  const labels = new Int32Array(mask.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
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
      const push = (q: number): void => {
        if ((mask[q] ?? 0) === 1 && labels[q] === -1) {
          labels[q] = label;
          stack.push(q);
        }
      };
      if (x > 0) push(p - 1);
      if (x < width - 1) push(p + 1);
      if (y > 0) push(p - width);
      if (y < height - 1) push(p + width);
    }
    sizes.push(size);
    label += 1;
  }

  const at = (seed: Seed): number => {
    const x = Math.round(seed.x);
    const y = Math.round(seed.y);
    if (x < 0 || y < 0 || x >= width || y >= height) return -1;
    return labels[y * width + x] ?? -1;
  };

  const rejected = new Set<number>();
  for (const seed of backgroundSeeds) {
    const found = at(seed);
    if (found >= 0) rejected.add(found);
  }

  const kept = new Set<number>();
  for (const seed of subjectSeeds) {
    const found = at(seed);
    if (found >= 0 && !rejected.has(found)) kept.add(found);
  }

  // With only background seeds, fall back to the largest surviving component.
  if (kept.size === 0) {
    let best = -1;
    let bestSize = 0;
    for (let i = 0; i < sizes.length; i += 1) {
      if (rejected.has(i)) continue;
      const size = sizes[i] ?? 0;
      if (size > bestSize) {
        bestSize = size;
        best = i;
      }
    }
    if (best >= 0) kept.add(best);
  }

  const out = new Uint8Array(mask.length);
  for (let p = 0; p < mask.length; p += 1) {
    const found = labels[p] ?? -1;
    out[p] = found >= 0 && kept.has(found) ? 1 : 0;
  }
  return out;
}

/** Separate the subject from the background. */
export function segmentSubject(image: RasterImage, options: SegmentOptions = {}): Mask {
  const seeds = options.seeds ?? [];
  const model = buildBackgroundModel(image, options);
  const distance = modelDistance(image, model, subjectColours(image, seeds));
  const threshold = otsuThreshold(distance) * (options.sensitivity ?? 1);

  const raw = new Uint8Array(distance.length);
  for (let p = 0; p < distance.length; p += 1) raw[p] = (distance[p] ?? 0) > threshold ? 1 : 0;

  // A subject seed asserts its own pixel, whatever the threshold decided, so a
  // click always has an effect even where the colours genuinely overlap.
  for (const seed of seeds) {
    if (seed.kind !== 'subject') continue;
    const cx = Math.round(seed.x);
    const cy = Math.round(seed.y);
    for (let y = cy - 3; y <= cy + 3; y += 1) {
      for (let x = cx - 3; x <= cx + 3; x += 1) {
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
        raw[y * image.width + x] = 1;
      }
    }
  }

  const cleaned = close(open(raw, image.width, image.height), image.width, image.height);
  const subject = keepSeededComponents(cleaned, image.width, image.height, seeds);
  return {
    width: image.width,
    height: image.height,
    data: fillHoles(subject, image.width, image.height),
  };
}
