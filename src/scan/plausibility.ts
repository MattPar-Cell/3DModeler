import type { Silhouette } from './types.ts';
import { silhouetteHeightPx } from './types.ts';
import { findCrotch } from './silhouette.ts';
import type { BodyMeasurementKey } from '../body/spec.ts';

/**
 * Does this outline, and do these numbers, describe a person at all?
 *
 * The scanner's worst failure is not being wrong — it is being wrong
 * confidently. A mask that ran from a subject's forehead to her knees, on a
 * beach where her legs matched the sand, divided the 156 cm the operator typed
 * over the wrong pixels and reported a 12.7 cm shoulder width beside it, in the
 * same styling as a good measurement. Nothing downstream noticed, because
 * nothing downstream was looking.
 *
 * These checks look. They are cheap, they are about internal consistency rather
 * than about being clever, and they catch a broken mask whatever broke it.
 */

/** Something the operator should know about a scan's reliability. */
export interface ScanNote {
  readonly severity: 'info' | 'warning';
  readonly text: string;
}

/**
 * Plausible range for each measurement, as a fraction of stature.
 *
 * Deliberately generous — these are not meant to reject an unusual body, only
 * an impossible one. The narrowest bound here still admits roughly the 0.1st to
 * 99.9th percentile of the populations cited in `constants/anthropometry.ts`,
 * widened further where a tape can legitimately be taken loosely.
 */
export const RATIO_BOUNDS: Partial<Record<BodyMeasurementKey, readonly [number, number]>> = {
  // Biacromial 0.227 to bideltoid 0.281 of stature, widened both ways.
  shoulderWidth: [0.19, 0.34],
  // Chest 0.584 of stature at the mean; the upper bound admits severe obesity.
  chest: [0.40, 1.05],
  waist: [0.30, 1.1],
  hip: [0.42, 1.1],
  neck: [0.15, 0.32],
  // Crotch height 0.47 of stature; the bounds are what leaves room for a torso.
  inseam: [0.38, 0.56],
  thigh: [0.2, 0.62],
  bicep: [0.1, 0.4],
  wrist: [0.06, 0.18],
  forearmLength: [0.11, 0.19],
};

/**
 * How much taller than wide a standing person's outline may be, by view.
 *
 * A front view is bounded tightly: 4.5 for a slim adult with their feet
 * together, wider in an A-pose, and past 6.5 the mask has caught an edge, a
 * shadow or one limb — which is what produced a 12.7 cm shoulder on a 156 cm
 * subject. A profile is legitimately far narrower, because what it shows is
 * the body's depth: 174 cm over a 25 cm chest depth is 7 before anything has
 * gone wrong.
 */
const ASPECT_BOUNDS = {
  front: [1.6, 6.5],
  side: [2.5, 9.5],
} as const;

/** Which of a subject's two silhouettes this is. */
export type ViewKind = 'front' | 'side';
/**
 * Share of its own bounding box a subject fills. A standing person, arms clear,
 * fills roughly a third to a half. Approaching a solid rectangle means the
 * background has been included.
 */
const MAX_PERSON_FILL = 0.78;
const MIN_PERSON_FILL = 0.12;

export interface OutlineVerdict {
  /** False when the outline should not be measured at all. */
  readonly usable: boolean;
  readonly notes: readonly ScanNote[];
  readonly aspect: number;
  readonly fill: number;
}

/** Does this outline have the shape of a standing person, seen this way? */
export function checkBodyOutline(
  silhouette: Silhouette,
  view: ViewKind = 'front',
): OutlineVerdict {
  const [minAspect, maxAspect] = ASPECT_BOUNDS[view];
  const notes: ScanNote[] = [];
  const heightPx = silhouetteHeightPx(silhouette);

  let widest = 0;
  let filled = 0;
  for (let y = silhouette.top; y <= silhouette.bottom; y += 1) {
    const l = silhouette.left[y] ?? -1;
    const r = silhouette.right[y] ?? -1;
    if (l >= 0 && r >= l) widest = Math.max(widest, r - l + 1);
    filled += silhouette.filled[y] ?? 0;
  }

  const aspect = widest <= 0 ? 0 : heightPx / widest;
  const fill = widest <= 0 || heightPx <= 0 ? 0 : filled / (widest * heightPx);
  let usable = true;

  if (heightPx < 60) {
    usable = false;
    notes.push({
      severity: 'warning',
      text: 'The detected outline is only a few dozen pixels tall. Nothing can be measured from it.',
    });
  }

  if (aspect > 0 && aspect < minAspect) {
    usable = false;
    notes.push({
      severity: 'warning',
      text: `The outline is only ${aspect.toFixed(1)} times taller than it is wide. A standing person seen from the ${view} is at least ${minAspect}. Either part of the body was not detected, or something else in the frame was.`,
    });
  } else if (aspect > maxAspect) {
    usable = false;
    notes.push({
      severity: 'warning',
      text: `The outline is ${aspect.toFixed(1)} times taller than it is wide, which is a sliver rather than a body — usually one limb, an edge or a shadow. A standing person seen from the ${view} is under ${maxAspect}.`,
    });
  }

  if (fill > MAX_PERSON_FILL) {
    usable = false;
    notes.push({
      severity: 'warning',
      text: `The outline fills ${(fill * 100).toFixed(0)}% of its own bounding box, which is close to a solid rectangle. Part of the background is being counted as subject — lower the outline slider, or mark the background with a click.`,
    });
  } else if (fill < MIN_PERSON_FILL) {
    usable = false;
    notes.push({
      severity: 'warning',
      text: `The outline fills only ${(fill * 100).toFixed(0)}% of its bounding box, so it is in pieces rather than a body. Raise the outline slider, or click the parts that were missed.`,
    });
  }

  return { usable, notes, aspect, fill };
}

/**
 * Are these measurements consistent with each other?
 *
 * Every measurement is checked against its plausible ratio to the stature it
 * was taken alongside. This is what catches a mask that lost the legs: the
 * stature is then wrong, every other measurement is scaled by the same wrong
 * number, and the ratios between them go somewhere no body goes.
 */
export function checkRatios(measurements: Readonly<Partial<Record<BodyMeasurementKey, number>>>): {
  readonly implausible: readonly BodyMeasurementKey[];
  readonly notes: readonly ScanNote[];
} {
  const stature = measurements.stature;
  if (stature === undefined || stature <= 0) return { implausible: [], notes: [] };

  const implausible: BodyMeasurementKey[] = [];
  const notes: ScanNote[] = [];
  for (const [key, bounds] of Object.entries(RATIO_BOUNDS) as [
    BodyMeasurementKey,
    readonly [number, number],
  ][]) {
    const value = measurements[key];
    if (value === undefined || !Number.isFinite(value)) continue;
    const ratio = value / stature;
    if (ratio >= bounds[0] && ratio <= bounds[1]) continue;
    implausible.push(key);
    notes.push({
      severity: 'warning',
      text: `${key} came out at ${(ratio * 100).toFixed(1)}% of the height entered, where a real body is ${(bounds[0] * 100).toFixed(0)}-${(bounds[1] * 100).toFixed(0)}%. Not reported.`,
    });
  }
  return { implausible, notes };
}

/**
 * Do two views show the same person standing the same way?
 *
 * A side view is only usable as a depth measurement if it is the same pose at
 * the same scale. A photograph taken on a different day, cropped differently,
 * with an arm raised and the back arched, shares nothing with the front view
 * but the subject's identity — and identity is not what the depth calculation
 * needs.
 */
export function checkViewsMatch(
  front: Silhouette,
  side: Silhouette,
): { readonly usable: boolean; readonly notes: readonly ScanNote[] } {
  const notes: ScanNote[] = [];

  const frontCrotch = findCrotch(front);
  const sideCrotch = findCrotch(side);
  if (frontCrotch !== undefined && sideCrotch !== undefined) {
    const difference = Math.abs(frontCrotch - sideCrotch);
    if (difference > 0.06) {
      notes.push({
        severity: 'warning',
        text: `The two photographs put the crotch at ${(frontCrotch * 100).toFixed(0)}% and ${(sideCrotch * 100).toFixed(0)}% of the subject's height. They are not the same pose at the same crop, so the side view is not used for depth.`,
      });
      return { usable: false, notes };
    }
  }

  // Both views scale by the same entered height, so the subject must occupy a
  // similar share of each frame. A side view cropped to the hips does not.
  const frontShare = silhouetteHeightPx(front) / front.imageHeight;
  const sideShare = silhouetteHeightPx(side) / side.imageHeight;
  if (Math.abs(frontShare - sideShare) / Math.max(frontShare, 0.01) > 0.18) {
    notes.push({
      severity: 'warning',
      text: `The subject fills ${(frontShare * 100).toFixed(0)}% of the front frame but ${(sideShare * 100).toFixed(0)}% of the side one. The two are cropped differently, so one scale cannot serve both and the side view is not used for depth.`,
    });
    return { usable: false, notes };
  }

  const sideVerdict = checkBodyOutline(side, 'side');
  if (!sideVerdict.usable) {
    notes.push({
      severity: 'warning',
      text: 'The side view’s outline does not look like a standing person, so it is not used for depth.',
    });
    return { usable: false, notes };
  }

  return { usable: true, notes };
}
