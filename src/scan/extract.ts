import type { Silhouette } from './types.ts';
import { silhouetteHeightPx } from './types.ts';
import {
  armsClearAt,
  findCrotch,
  narrowestIn,
  narrowestTorsoIn,
  torsoWidthAtFraction,
  widestIn,
  widthAtFraction,
} from './silhouette.ts';
import { circumferenceForHalfWidth } from '../core/profile.ts';
import type { SectionShape } from '../core/profile.ts';
import { biasedSection } from '../body/segments.ts';
import * as A from '../constants/anthropometry.ts';
import type { LampMeasurements } from '../templates/lamp/spec.ts';
import type { BodyMeasurements } from '../body/spec.ts';

/**
 * Turning a silhouette into measurements.
 *
 * The image never becomes geometry. It becomes a handful of numbers, which go
 * through the same solver as a typed measurement and generate the same mesh —
 * so the app's premise survives the scanner intact: nothing is imported but
 * parameters.
 *
 * What a single photograph can and cannot give is stated plainly here and
 * surfaced in the UI, because a measurement that looks authoritative and is not
 * is worse than no measurement.
 */

import { checkBodyOutline, checkRatios, checkViewsMatch } from './plausibility.ts';
import type { ScanNote } from './plausibility.ts';

export type { ScanNote };

export interface LampScan {
  readonly measurements: LampMeasurements;
  readonly notes: readonly ScanNote[];
  /** Height fractions of the detected features, for drawing on the preview. */
  readonly landmarks: readonly { readonly label: string; readonly t: number }[];
}

export interface BodyScan {
  readonly measurements: BodyMeasurements;
  readonly notes: readonly ScanNote[];
  readonly landmarks: readonly { readonly label: string; readonly t: number }[];
}

/** Centimetres per pixel, from a subject of known height filling the silhouette. */
export function scaleFromKnownHeight(silhouette: Silhouette, knownHeightCm: number): number {
  const px = silhouetteHeightPx(silhouette);
  return px <= 0 ? 0 : knownHeightCm / px;
}

/** Centimetres per pixel, from a reference of known length drawn on the image. */
export function scaleFromReference(pixelLength: number, knownLengthCm: number): number {
  return pixelLength <= 0 ? 0 : knownLengthCm / pixelLength;
}

/**
 * Checks that apply to any scan. A silhouette touching the frame is the single
 * most common way to get a confident, wrong answer, so it is a warning rather
 * than a note.
 */
function commonNotes(silhouette: Silhouette): ScanNote[] {
  const notes: ScanNote[] = [];
  const heightPx = silhouetteHeightPx(silhouette);

  let touchesSide = false;
  for (let y = silhouette.top; y <= silhouette.bottom; y += 1) {
    if ((silhouette.left[y] ?? -1) === 0 || (silhouette.right[y] ?? -1) === silhouette.imageWidth - 1) {
      touchesSide = true;
      break;
    }
  }
  if (touchesSide || silhouette.top === 0 || silhouette.bottom === silhouette.imageHeight - 1) {
    notes.push({
      severity: 'warning',
      text: 'The subject touches the edge of the frame, so it is probably cropped. Every measurement below is a lower bound.',
    });
  }

  if (heightPx < silhouette.imageHeight * 0.4) {
    notes.push({
      severity: 'warning',
      text: `The subject fills only ${((heightPx / silhouette.imageHeight) * 100).toFixed(0)}% of the frame height. Fill more of it and the outline resolves to a finer fraction of a centimetre.`,
    });
  }

  notes.push({
    severity: 'info',
    text: 'A photograph has perspective: parts nearer the lens measure larger. Stand well back and zoom in rather than stepping close.',
  });

  return notes;
}

/** Where the scanner looks for a lamp's stem, as fractions of overall height. */
const STEM_SEARCH_FROM = 0.22;
const STEM_SEARCH_TO = 0.7;

/**
 * Read a lamp's four measurements off its outline.
 *
 * A table lamp has an unmistakable width profile: wide at the foot, pinched at
 * the stem, wide again at the shade. Finding the pinch locates all three
 * regions at once, without assuming anything about their proportions — which
 * matters, because assuming the proportions is exactly what the template does
 * afterwards, and the scan's job is to override those assumptions with what the
 * photograph actually shows.
 */
export function extractLamp(silhouette: Silhouette, cmPerPixel: number): LampScan {
  const notes = commonNotes(silhouette);
  const heightPx = silhouetteHeightPx(silhouette);
  const totalHeight = heightPx * cmPerPixel;

  const stem = narrowestIn(silhouette, STEM_SEARCH_FROM, STEM_SEARCH_TO);
  const base = widestIn(silhouette, 0, Math.max(stem.t - 0.02, 0.02));
  const shade = widestIn(silhouette, Math.min(stem.t + 0.02, 0.98), 1);

  if (stem.width <= 0 || base.width <= 0 || shade.width <= 0) {
    notes.push({
      severity: 'warning',
      text: 'No usable outline was found. Check that the lamp contrasts with the background.',
    });
    return { measurements: { totalHeight }, notes, landmarks: [] };
  }

  if (stem.width > base.width * 0.85) {
    notes.push({
      severity: 'warning',
      text: 'No clear stem: the outline barely narrows between the base and the shade. The stem diameter below is unreliable.',
    });
  }
  if (shade.width < base.width) {
    notes.push({
      severity: 'info',
      text: 'The widest point above the stem is narrower than the base. If this is a lamp with an unusually broad foot the template will report the conflict rather than resolve it.',
    });
  }

  return {
    measurements: {
      totalHeight,
      baseDiameter: base.width * cmPerPixel,
      shadeDiameter: shade.width * cmPerPixel,
      stemDiameter: stem.width * cmPerPixel,
    },
    notes,
    landmarks: [
      { label: 'Base', t: base.t },
      { label: 'Stem', t: stem.t },
      { label: 'Shade', t: shade.t },
    ],
  };
}

/**
 * Landmark height as a fraction of stature, reconciled with a detected crotch.
 *
 * Mirrors `buildSkeleton`: the legs get the measured inseam and the torso
 * absorbs the remainder, so a long-legged subject's chest is not sampled at a
 * short-legged subject's chest height.
 */
function landmarkFraction(prior: number, crotchT: number | undefined): number {
  if (crotchT === undefined) return prior;
  if (prior <= A.CROTCH_HEIGHT) return (prior / A.CROTCH_HEIGHT) * crotchT;
  return crotchT + ((prior - A.CROTCH_HEIGHT) / (1 - A.CROTCH_HEIGHT)) * (1 - crotchT);
}

/**
 * Turn a measured width — and, when a side view is available, a measured depth
 * — into a circumference.
 *
 * With one photograph the depth comes from the anthropometric priors, so the
 * circumference is half observation and half assumption. With two, the section's
 * total depth is measured and only the front/back split stays a prior, which is
 * a far weaker assumption: it moves where the volume sits, not how much there is.
 */
function circumferenceFrom(
  widthPx: number,
  depthPx: number | undefined,
  cmPerPixel: number,
  prior: SectionShape,
  segments: number,
): number {
  const halfWidth = (widthPx * cmPerPixel) / 2;
  if (halfWidth <= 0) return 0;
  let shape = prior;
  if (depthPx !== undefined && depthPx > 0) {
    const totalDepth = depthPx * cmPerPixel;
    const priorTotal = prior.front + prior.back;
    const scale = priorTotal <= 0 ? 1 : totalDepth / halfWidth / priorTotal;
    shape = { front: prior.front * scale, back: prior.back * scale, squareness: prior.squareness };
  }
  return circumferenceForHalfWidth(halfWidth, shape, segments);
}

/**
 * Bideltoid breadth over the tape-across-the-back figure the template asks for.
 * ANSUR II gives bideltoid at about 0.281 of stature and the tape measurement at
 * about 0.259, so a silhouette read at shoulder height overstates it by ~9%.
 */
const BIDELTOID_OVER_SHOULDER_TAPE = 0.281 / 0.259;

/** Ring resolution used when converting a width to a circumference. */
const SECTION_SEGMENTS = 128;

export interface BodyScanInput {
  readonly front: Silhouette;
  /** Optional side view, used to measure depth instead of assuming it. */
  readonly side?: Silhouette;
  readonly cmPerPixel: number;
  /** Scale for the side view, which may have been shot at a different distance. */
  readonly sideCmPerPixel?: number;
}

/**
 * Read a body's measurements off its outline.
 *
 * Requires an A-pose: arms held clear of the torso, feet apart. With the arms
 * down the silhouette at chest and waist height is arm, not torso, and no
 * amount of processing recovers what the arms are covering.
 */
export function extractBody(input: BodyScanInput): BodyScan {
  const { front, cmPerPixel } = input;
  const notes = [...commonNotes(front)];
  const heightPx = silhouetteHeightPx(front);
  const stature = heightPx * cmPerPixel;

  /**
   * Before anything is measured, does this outline even look like a person?
   *
   * Skipping this check is how a mask running from a forehead to a pair of
   * knees produced a full table of confident numbers. When the outline is not
   * a body, the only honest output is none.
   */
  const outline = checkBodyOutline(front);
  notes.push(...outline.notes);
  if (!outline.usable) {
    return { measurements: {}, notes, landmarks: [] };
  }

  const crotchT = findCrotch(front);
  if (crotchT === undefined) {
    notes.push({
      severity: 'warning',
      text: 'The legs never separate in the outline, so the inseam could not be read. Stand with the feet apart; the remaining landmarks fall back to population proportions.',
    });
  }

  // A side view is only a depth measurement if it is the same pose at the same
  // crop. Otherwise it is a photograph of the same person and nothing more.
  let side = input.side;
  if (side !== undefined) {
    const match = checkViewsMatch(front, side);
    notes.push(...match.notes);
    if (!match.usable) side = undefined;
  }
  const sideScale = input.sideCmPerPixel ?? cmPerPixel;

  const chestT = landmarkFraction(A.CHEST_HEIGHT, crotchT);
  const waistT = landmarkFraction(A.WAIST_HEIGHT, crotchT);
  const hipT = landmarkFraction(A.HIP_HEIGHT, crotchT);

  /**
   * An A-pose is not a preference, it is a precondition. With the arms down,
   * the run through the chest is arm-torso-arm fused into one, and its width is
   * the span of the arms — which on a real subject read as a 164 cm waist for
   * an 80 cm one. Reporting that with a caveat beside it would be worse than
   * reporting nothing, so the girths are withheld entirely.
   */
  const armsClear = armsClearAt(front, chestT) && armsClearAt(front, waistT);
  if (!armsClear) {
    notes.push({
      severity: 'warning',
      text: 'The arms are against the body, so the outline at chest and waist height is arm rather than torso. Chest, waist, hip and neck are not reported. Retake the photograph in an A-pose — arms held clear, feet apart — and they will be.',
    });
  } else if (side === undefined) {
    notes.push({
      severity: 'warning',
      text: 'Front view only, so each circumference below combines a measured width with an assumed depth. Add a side view and the depth is measured too.',
    });
  }

  const measureAt = (
    t: number,
    shape: SectionShape,
  ): { circumference: number; t: number; width: number } => {
    const width = torsoWidthAtFraction(front, t);
    // The side view is read the same way. An arm held out to the side projects
    // onto the torso in profile, and taking the full extent there would add the
    // arm's own thickness to the body's depth.
    const depth = side === undefined ? undefined : torsoWidthAtFraction(side, t);
    // A side view shot at a different scale is normalised into front pixels.
    const depthInFrontPixels =
      depth === undefined ? undefined : (depth * sideScale) / (cmPerPixel || 1);
    return {
      circumference: circumferenceFrom(width, depthInFrontPixels, cmPerPixel, shape, SECTION_SEGMENTS),
      t,
      width,
    };
  };

  const chest = measureAt(
    chestT,
    biasedSection(A.CHEST_ASPECT, A.CHEST_FRONT_BIAS, A.CHEST_BACK_BIAS, A.TORSO_SQUARENESS),
  );
  const waist = measureAt(
    waistT,
    biasedSection(A.WAIST_ASPECT, A.WAIST_FRONT_BIAS, A.WAIST_BACK_BIAS, A.TORSO_SQUARENESS),
  );
  const hip = measureAt(
    hipT,
    biasedSection(A.HIP_ASPECT, A.HIP_FRONT_BIAS, A.HIP_BACK_BIAS, A.TORSO_SQUARENESS),
  );

  // The neck has no fixed height — it is the narrowest point between the
  // shoulders and the jaw. Sampled at a landmark fraction instead it comes back
  // as shoulder width, which on a real subject read as a 125 cm neck.
  const neckShape = biasedSection(A.NECK_ASPECT, 1, 1, A.LIMB_SQUARENESS);
  const neckPinch = narrowestTorsoIn(
    front,
    landmarkFraction(A.SHOULDER_HEIGHT, crotchT) + 0.012,
    landmarkFraction(A.CHIN_HEIGHT, crotchT),
  );
  const neck = measureAt(neckPinch.t, neckShape);

  /**
   * A neck is a *local* minimum: the outline narrows below the jaw and widens
   * again into the head. Long hair, a collar, or a subject photographed with
   * the chin tucked leave no such minimum, and the search then returns the
   * narrowest thing in range — which is the head, and came back as a 72 cm
   * neck. Requiring the outline to widen above the pinch rejects that.
   */
  const aboveNeck = torsoWidthAtFraction(front, Math.min(neckPinch.t + 0.02, 1), 0.006);
  const neckFound = neckPinch.width > 0 && aboveNeck > neckPinch.width * 1.08;
  if (armsClear && !neckFound) {
    notes.push({
      severity: 'info',
      text: 'No distinct neck was found between the shoulders and the jaw — hair or a collar usually explains it — so neck circumference is not reported.',
    });
  }

  // Shoulder breadth survives the arms being down: the widest point across the
  // shoulders is the deltoids either way.
  const shoulderT = landmarkFraction(A.SHOULDER_HEIGHT, crotchT);
  const shoulderWidth =
    (widthAtFraction(front, shoulderT) * cmPerPixel) / BIDELTOID_OVER_SHOULDER_TAPE;

  const candidate: BodyMeasurements = {
    stature,
    shoulderWidth,
    ...(crotchT === undefined ? {} : { inseam: crotchT * stature }),
    ...(armsClear
      ? {
          chest: chest.circumference,
          waist: waist.circumference,
          hip: hip.circumference,
          ...(neckFound ? { neck: neck.circumference } : {}),
        }
      : {}),
  };

  /**
   * Last gate: are these numbers consistent with each other?
   *
   * Every one is checked against its plausible ratio to the stature it was
   * taken alongside. A mask that lost the legs makes the stature wrong, scales
   * everything else by the same wrong number, and lands the ratios somewhere no
   * body goes — which is detectable without knowing what went wrong upstream.
   */
  const ratios = checkRatios(candidate);
  notes.push(...ratios.notes);
  const measurements: BodyMeasurements = Object.fromEntries(
    Object.entries(candidate).filter(
      ([key]) => !ratios.implausible.includes(key as keyof BodyMeasurements),
    ),
  );

  if (ratios.implausible.length >= 2) {
    notes.push({
      severity: 'warning',
      text: 'Several measurements are impossible for a body of the height entered, which almost always means the outline is wrong rather than the subject unusual. Check that the tinted region covers the whole subject — head to heels — before trusting anything here.',
    });
  }

  // A silhouette says nothing about mass, and guessing it would be the one
  // number in the set with no observation behind it at all.
  notes.push({
    severity: 'info',
    text: 'Weight cannot be read from an outline. Enter it in the body workspace and the fit will use it to pull the un-measured girths to the right build.',
  });

  const reported = (key: keyof BodyMeasurements): boolean => measurements[key] !== undefined;
  return {
    measurements,
    notes,
    landmarks: [
      ...(reported('shoulderWidth') ? [{ label: 'Shoulders', t: shoulderT }] : []),
      ...(armsClear && neckFound && reported('neck') ? [{ label: 'Neck', t: neckPinch.t }] : []),
      ...(armsClear && reported('chest') ? [{ label: 'Chest', t: chest.t }] : []),
      ...(armsClear && reported('waist') ? [{ label: 'Waist', t: waist.t }] : []),
      ...(armsClear && reported('hip') ? [{ label: 'Hip', t: hip.t }] : []),
      ...(crotchT === undefined || !reported('inseam') ? [] : [{ label: 'Crotch', t: crotchT }]),
    ],
  };
}
