import type { Mask, Silhouette } from './types.ts';
import { silhouetteHeightPx } from './types.ts';
import { monotoneCubicAt } from '../core/math.ts';

/**
 * Silhouette extraction and the questions asked of it.
 *
 * A silhouette is a function from height to a left and right edge. Every
 * measurement the scanner reports is a question about that function: how tall
 * is it, how wide at this height, where does it narrow, where does it split in
 * two.
 */

/** Reduce a mask to its per-row spans. */
export function silhouetteFrom(mask: Mask): Silhouette {
  const { width, height, data } = mask;
  const left = new Int32Array(height).fill(-1);
  const right = new Int32Array(height).fill(-1);
  const runs = new Int32Array(height);
  const filled = new Int32Array(height);

  let top = -1;
  let bottom = -1;
  let globalLeft = width;
  let globalRight = -1;
  for (let y = 0; y < height; y += 1) {
    let rowRuns = 0;
    let count = 0;
    let previous = 0;
    for (let x = 0; x < width; x += 1) {
      const value = data[y * width + x] ?? 0;
      if (value === 1) {
        count += 1;
        if (left[y] === -1) left[y] = x;
        right[y] = x;
        if (previous === 0) rowRuns += 1;
      }
      previous = value;
    }
    runs[y] = rowRuns;
    filled[y] = count;
    if (count > 0) {
      if (top === -1) top = y;
      bottom = y;
      globalLeft = Math.min(globalLeft, left[y] ?? width);
      globalRight = Math.max(globalRight, right[y] ?? -1);
    }
  }

  // The subject's midline, from its overall extent. Arms held clear of the body
  // are symmetric about it, so they do not shift it.
  const midlineX =
    globalRight < globalLeft ? Math.floor(width / 2) : Math.round((globalLeft + globalRight) / 2);
  const band = Math.max(1, Math.round(width * 0.004));
  const midlineGap = new Uint8Array(height);
  const midRunLeft = new Int32Array(height).fill(-1);
  const midRunRight = new Int32Array(height).fill(-1);
  for (let y = 0; y < height; y += 1) {
    if ((filled[y] ?? 0) === 0) continue;
    let covered = -1;
    for (let x = midlineX - band; x <= midlineX + band; x += 1) {
      if (x < 0 || x >= width) continue;
      if ((data[y * width + x] ?? 0) === 1) {
        covered = x;
        break;
      }
    }
    midlineGap[y] = covered === -1 ? 1 : 0;
    if (covered === -1) continue;
    // Walk out from the midline to the ends of the run it sits in.
    let l = covered;
    while (l - 1 >= 0 && (data[y * width + l - 1] ?? 0) === 1) l -= 1;
    let r = covered;
    while (r + 1 < width && (data[y * width + r + 1] ?? 0) === 1) r += 1;
    midRunLeft[y] = l;
    midRunRight[y] = r;
  }

  return {
    imageWidth: width,
    imageHeight: height,
    top: top === -1 ? 0 : top,
    bottom: bottom === -1 ? 0 : bottom,
    left,
    right,
    runs,
    filled,
    midlineGap,
    midlineX,
    midRunLeft,
    midRunRight,
  };
}

/** Row index for a fraction of the subject's height, 0 at the feet, 1 at the top. */
export function rowAtFraction(silhouette: Silhouette, t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return Math.round(silhouette.bottom - clamped * (silhouetteHeightPx(silhouette) - 1));
}

/**
 * Outline width at a fraction of the subject's height, in pixels.
 *
 * Averaged over a short band rather than sampled from a single row: one row of
 * a photograph is noise, and a landmark height is itself only approximate.
 */
export function widthAtFraction(silhouette: Silhouette, t: number, bandFraction = 0.012): number {
  const heightPx = silhouetteHeightPx(silhouette);
  const half = Math.max(1, Math.round(heightPx * bandFraction));
  const centre = rowAtFraction(silhouette, t);
  let total = 0;
  let count = 0;
  for (let y = centre - half; y <= centre + half; y += 1) {
    if (y < silhouette.top || y > silhouette.bottom) continue;
    const l = silhouette.left[y] ?? -1;
    const r = silhouette.right[y] ?? -1;
    if (l < 0 || r < 0) continue;
    total += r - l + 1;
    count += 1;
  }
  return count === 0 ? 0 : total / count;
}

/**
 * Width of the run straddling the midline, at a fraction of the subject's
 * height, in pixels — the *torso*, not the arm-to-arm span.
 */
export function torsoWidthAtFraction(
  silhouette: Silhouette,
  t: number,
  bandFraction = 0.012,
): number {
  const heightPx = silhouetteHeightPx(silhouette);
  const half = Math.max(1, Math.round(heightPx * bandFraction));
  const centre = rowAtFraction(silhouette, t);
  let total = 0;
  let count = 0;
  for (let y = centre - half; y <= centre + half; y += 1) {
    if (y < silhouette.top || y > silhouette.bottom) continue;
    const l = silhouette.midRunLeft[y] ?? -1;
    const r = silhouette.midRunRight[y] ?? -1;
    if (l < 0 || r < 0) continue;
    total += r - l + 1;
    count += 1;
  }
  return count === 0 ? 0 : total / count;
}

/**
 * Whether the arms are clear of the body at this height.
 *
 * In an A-pose a row through the chest cuts arm, torso, arm — three runs. With
 * the arms down there is one, and no processing recovers a torso width from it
 * because the torso's edge is simply not in the picture.
 */
export function armsClearAt(silhouette: Silhouette, t: number, bandFraction = 0.012): boolean {
  const heightPx = silhouetteHeightPx(silhouette);
  const half = Math.max(1, Math.round(heightPx * bandFraction));
  const centre = rowAtFraction(silhouette, t);
  let clear = 0;
  let count = 0;
  for (let y = centre - half; y <= centre + half; y += 1) {
    if (y < silhouette.top || y > silhouette.bottom) continue;
    count += 1;
    if ((silhouette.runs[y] ?? 0) >= 3) clear += 1;
  }
  // A majority of the band, so one stray row does not decide the pose.
  return count > 0 && clear * 2 > count;
}

/**
 * Narrowest *torso* width within a band of the subject's height.
 *
 * Used to find the neck, which has no fixed height: it is the pinch between the
 * shoulders and the jaw. Sampling at a landmark fraction instead returns
 * shoulder width at one end of that range and jaw width at the other.
 */
export function narrowestTorsoIn(
  silhouette: Silhouette,
  from: number,
  to: number,
  samples = 120,
  bandFraction = 0.006,
): { t: number; width: number } {
  let bestT = from;
  let bestWidth = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= samples; i += 1) {
    const t = from + ((to - from) * i) / samples;
    const width = torsoWidthAtFraction(silhouette, t, bandFraction);
    if (width > 0 && width < bestWidth) {
      bestWidth = width;
      bestT = t;
    }
  }
  return { t: bestT, width: Number.isFinite(bestWidth) ? bestWidth : 0 };
}

/** Outline widths sampled evenly from the feet to the top, in pixels. */
export function widthProfile(silhouette: Silhouette, samples = 128): Float64Array {
  const out = new Float64Array(samples);
  for (let i = 0; i < samples; i += 1) {
    out[i] = widthAtFraction(silhouette, samples === 1 ? 0 : i / (samples - 1));
  }
  return out;
}

/** A smooth width-vs-height function, for landmark searches. */
export function smoothWidth(silhouette: Silhouette, samples = 96): (t: number) => number {
  const profile = widthProfile(silhouette, samples);
  return monotoneCubicAt(
    Array.from({ length: samples }, (_, i) => i / (samples - 1)),
    Array.from(profile),
  );
}

/**
 * Sampling band for extreme searches, as a fraction of the subject's height.
 *
 * Much tighter than the band used for a landmark at a known height. A landmark
 * height is itself approximate, so averaging over a wider band is a virtue
 * there; an extreme is a *peak*, and averaging across it is how a lamp shade's
 * bottom rim gets measured 3 cm narrower than it is.
 */
const EXTREME_BAND_FRACTION = 0.004;

/**
 * Narrowest point of the outline within a band of the subject's height.
 * Returns the fraction of height and the width there.
 */
export function narrowestIn(
  silhouette: Silhouette,
  from: number,
  to: number,
  samples = 160,
  bandFraction = EXTREME_BAND_FRACTION,
): { t: number; width: number } {
  let bestT = from;
  let bestWidth = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= samples; i += 1) {
    const t = from + ((to - from) * i) / samples;
    const width = widthAtFraction(silhouette, t, bandFraction);
    if (width > 0 && width < bestWidth) {
      bestWidth = width;
      bestT = t;
    }
  }
  return { t: bestT, width: Number.isFinite(bestWidth) ? bestWidth : 0 };
}

/** Widest point of the outline within a band of the subject's height. */
export function widestIn(
  silhouette: Silhouette,
  from: number,
  to: number,
  samples = 160,
  bandFraction = EXTREME_BAND_FRACTION,
): { t: number; width: number } {
  let bestT = from;
  let bestWidth = -1;
  for (let i = 0; i <= samples; i += 1) {
    const t = from + ((to - from) * i) / samples;
    const width = widthAtFraction(silhouette, t, bandFraction);
    if (width > bestWidth) {
      bestWidth = width;
      bestT = t;
    }
  }
  return { t: bestT, width: Math.max(bestWidth, 0) };
}

/**
 * Height fraction at which the legs meet — the crotch.
 *
 * Scanning up from the feet, the subject's midline is uncovered while the legs
 * are apart and covered once they join. That transition is a genuine
 * anatomical landmark rather than a guessed fraction of stature, which makes
 * inseam the one body length a single photograph gives directly.
 *
 * Returns `undefined` when the midline is never uncovered — a long coat, or a
 * subject standing with their feet together.
 */
export function findCrotch(silhouette: Silhouette): number | undefined {
  const heightPx = silhouetteHeightPx(silhouette);
  if (heightPx < 8) return undefined;

  // Only the lower half can hold a crotch, and the feet themselves are noisy.
  const lowest = silhouette.bottom - Math.round(heightPx * 0.06);
  const highest = silhouette.bottom - Math.round(heightPx * 0.62);

  // Require the gap to persist, so a shadow between the ankles does not
  // register as a crotch.
  const runLength = Math.max(2, Math.round(heightPx * 0.02));
  let consecutive = 0;
  for (let y = lowest; y >= highest; y -= 1) {
    if ((silhouette.midlineGap[y] ?? 0) === 1) {
      consecutive += 1;
    } else if (consecutive >= runLength) {
      // This row is the first covered one above a sustained gap.
      return (silhouette.bottom - y) / (heightPx - 1);
    } else {
      consecutive = 0;
    }
  }
  return undefined;
}

/** Fraction of the subject's height at which its outline is at its widest overall. */
export function overallWidest(silhouette: Silhouette): { t: number; width: number } {
  return widestIn(silhouette, 0, 1, 240);
}
