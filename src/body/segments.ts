import type { Ring, Vec3 } from '../core/loft.ts';
import { ringStackVolume } from '../core/loft.ts';
import {
  circumferenceForHalfWidth,
  halfWidthForCircumference,
  mapRing,
  ringForCircumference,
} from '../core/profile.ts';
import type { SectionShape } from '../core/profile.ts';
import { lerp, monotoneCubic } from '../core/math.ts';
import * as A from '../constants/anthropometry.ts';
import type { BodyParamKey } from './spec.ts';

/**
 * Skeleton-driven body construction.
 *
 * The pipeline is: parameters -> landmark heights -> joint positions -> a stack
 * of cross-sections per segment -> a lofted surface. Every cross-section is an
 * asymmetric super-ellipse whose *perimeter* is the corresponding circumference,
 * so an entered tape measurement is reproduced exactly rather than approximately,
 * while its shape — wider than deep, flatter than an ellipse, and deeper behind
 * the spine than in front — comes from the anthropometric priors.
 *
 * All lengths are centimetres, Y is up, +Z is the front of the body, and the
 * origin sits on the floor between the feet.
 */

/** A body parameter set as plain numbers, which is what the fitter iterates on. */
export type BodyValues = Record<BodyParamKey, number>;

/** Regions the confidence indicator reports on. */
export type BodyRegion =
  | 'head'
  | 'neck'
  | 'chest'
  | 'waist'
  | 'pelvis'
  | 'upperArm'
  | 'forearm'
  | 'hand'
  | 'thigh'
  | 'shank'
  | 'foot';

export const BODY_REGIONS: readonly BodyRegion[] = [
  'head',
  'neck',
  'chest',
  'waist',
  'pelvis',
  'upperArm',
  'forearm',
  'hand',
  'thigh',
  'shank',
  'foot',
];

export const REGION_LABELS: Record<BodyRegion, string> = {
  head: 'Head',
  neck: 'Neck',
  chest: 'Chest & shoulders',
  waist: 'Waist & midriff',
  pelvis: 'Hips & pelvis',
  upperArm: 'Upper arms',
  forearm: 'Forearms',
  hand: 'Hands',
  thigh: 'Thighs',
  shank: 'Lower legs',
  foot: 'Feet',
};

/**
 * Which parameters shape each region. A region reads "measured" when the user
 * gave a direct measurement of it; see `fit.ts` for the full rule.
 */
export const REGION_PARAMS: Record<BodyRegion, readonly BodyParamKey[]> = {
  // Stature is deliberately absent: measuring someone's height tells you
  // nothing direct about their head, and listing it here would let the head
  // claim to be measured whenever a height was entered.
  head: ['headCircumference'],
  neck: ['neck'],
  chest: ['chest', 'underbust', 'shoulderWidth'],
  waist: ['waist'],
  pelvis: ['hip', 'hipWidth'],
  upperArm: ['bicep', 'upperArmLength'],
  forearm: ['forearm', 'forearmLength'],
  hand: ['wrist', 'handLength'],
  thigh: ['thigh', 'inseam'],
  shank: ['knee', 'calf', 'ankle', 'inseam'],
  foot: ['footLength', 'ankle'],
};

/** Height of the trapezius yoke above the shoulder line, as a fraction of stature. */
export const SHOULDER_YOKE_OFFSET = 0.024;
/** Neck circumference landmark, as a fraction of stature above the yoke. */
export const NECK_LANDMARK_OFFSET = 0.022;
/** Biceps landmark, as a fraction of the way from shoulder joint to elbow. */
export const BICEP_LANDMARK_FRACTION = 0.32;
/**
 * How far in from the shoulder point the arm hangs, as a fraction of half the
 * shoulder width. The acromion is the bony edge; the humeral head sits medial
 * to it, and the deltoid then fills back out to roughly the measured width.
 */
export const SHOULDER_JOINT_INSET = 0.82;

/** Build a section shape from a mean aspect and its front/back bias. */
export function biasedSection(
  aspect: number,
  frontBias: number,
  backBias: number,
  squareness: number,
): SectionShape {
  return { front: aspect * frontBias, back: aspect * backBias, squareness };
}

function blendSection(a: SectionShape, b: SectionShape, t: number): SectionShape {
  return {
    front: lerp(a.front, b.front, t),
    back: lerp(a.back, b.back, t),
    squareness: lerp(a.squareness, b.squareness, t),
  };
}

const TORSO_N = A.TORSO_SQUARENESS;
const LIMB_N = A.LIMB_SQUARENESS;

/** Named cross-section shapes, so the segment definitions below stay readable. */
const SHAPES = {
  hip: biasedSection(A.HIP_ASPECT, A.HIP_FRONT_BIAS, A.HIP_BACK_BIAS, TORSO_N),
  waist: biasedSection(A.WAIST_ASPECT, A.WAIST_FRONT_BIAS, A.WAIST_BACK_BIAS, TORSO_N),
  chest: biasedSection(A.CHEST_ASPECT, A.CHEST_FRONT_BIAS, A.CHEST_BACK_BIAS, TORSO_N),
  neck: biasedSection(A.NECK_ASPECT, 1, 1, LIMB_N),
  limb: biasedSection(A.LIMB_ASPECT, 1, 1, LIMB_N),
  thigh: biasedSection(A.LIMB_ASPECT, A.THIGH_FRONT_BIAS, A.THIGH_BACK_BIAS, LIMB_N),
  calf: biasedSection(A.LIMB_ASPECT, A.CALF_FRONT_BIAS, A.CALF_BACK_BIAS, LIMB_N),
  head: biasedSection(A.HEAD_ASPECT, A.HEAD_FRONT_BIAS, A.HEAD_BACK_BIAS, A.HEAD_SQUARENESS),
  /** The wrist is markedly flattened front-to-back. */
  wrist: biasedSection(0.72, 1, 1, LIMB_N),
  /** The palm is flatter still. */
  palm: biasedSection(0.42, 1.05, 0.95, 2.5),
} as const;

/** One cross-section of a segment. */
interface Slice {
  /** Height above the floor, cm (or distance along the segment's own axis). */
  readonly y: number;
  /** Centre offset across the body (+X is the model's left), cm. */
  readonly cx: number;
  /** Centre offset front-to-back (+Z is the front), cm. */
  readonly cz: number;
  /** Perimeter of the cross-section, cm. */
  readonly circumference: number;
  readonly shape: SectionShape;
}

/** A named, lofted piece of the body. */
export interface BodySegment {
  readonly id: string;
  readonly label: string;
  readonly region: BodyRegion;
  readonly rings: readonly Ring[];
  /**
   * Whether to *render* the end caps. Interior joins are left open: two
   * segments meeting at a landmark would otherwise put coincident discs in the
   * same plane, and the resulting z-fighting draws a bright ring right around
   * the body at every join.
   *
   * Volume is a separate question — {@link bodyVolumeLitres} always closes the
   * stack, so segments that meet edge to edge sum to the correct total with
   * nothing double-counted and nothing leaking.
   */
  readonly capStart: boolean;
  readonly capEnd: boolean;
  /**
   * True when this segment's circumferences are measured perpendicular to its
   * own axis rather than horizontally.
   *
   * A tape around a thigh follows the limb, so a leaning limb's horizontal ring
   * has to be enlarged to compensate. A tape around a chest is horizontal, and
   * the spine's sagittal curve must *not* be compensated for — doing so put a
   * 0.6 cm error into every chest measurement.
   */
  readonly perpendicularMeasurement: boolean;
}

/**
 * Turn slices into rings.
 *
 * See {@link BodySegment.perpendicularMeasurement} for why the tilt correction
 * is applied to limbs but not to the torso.
 */
function sliceRings(
  slices: readonly Slice[],
  segments: number,
  perpendicular: boolean,
): Ring[] {
  return slices.map((slice, i) => {
    let tiltFactor = 1;
    if (perpendicular) {
      const previous = slices[Math.max(i - 1, 0)];
      const next = slices[Math.min(i + 1, slices.length - 1)];
      if (previous !== undefined && next !== undefined && previous !== next) {
        const dy = Math.abs(next.y - previous.y);
        const dl = Math.hypot(next.y - previous.y, next.cx - previous.cx, next.cz - previous.cz);
        if (dy > 1e-6) tiltFactor = dy / dl;
      }
    }
    return ringForCircumference(
      slice.circumference / Math.max(tiltFactor, 1e-6),
      slice.shape,
      slice.y,
      segments,
      { x: slice.cx, z: slice.cz },
    );
  });
}

/**
 * Insert `count` interpolated slices between each pair of control sections.
 *
 * Every channel except height runs through a monotone cubic (see
 * {@link monotoneCubic}). The control sections are hit exactly, so a measured
 * circumference still appears verbatim in the mesh, but the profile between
 * them is genuinely smooth — no plateau at each control point, and no bulge
 * overshooting a measurement either.
 */
function subdivide(slices: readonly Slice[], count: number): Slice[] {
  if (count < 1 || slices.length < 2) return [...slices];

  const channel = (pick: (slice: Slice) => number): ((t: number) => number) =>
    monotoneCubic(slices.map(pick));

  const cx = channel((s) => s.cx);
  const cz = channel((s) => s.cz);
  const circumference = channel((s) => s.circumference);
  const front = channel((s) => s.shape.front);
  const back = channel((s) => s.shape.back);
  const squareness = channel((s) => s.shape.squareness);

  const out: Slice[] = [];
  const spans = slices.length - 1;
  const steps = spans * (count + 1);
  for (let k = 0; k <= steps; k += 1) {
    const t = (k / steps) * spans;
    const i = Math.min(Math.floor(t), spans - 1);
    const local = t - i;
    const a = slices[i];
    const b = slices[i + 1];
    if (a === undefined || b === undefined) continue;
    out.push({
      // Height stays linear so the rings are evenly spaced up the segment.
      y: lerp(a.y, b.y, local),
      cx: cx(t),
      cz: cz(t),
      circumference: circumference(t),
      shape: { front: front(t), back: back(t), squareness: squareness(t) },
    });
  }
  return out;
}

/** Landmark heights and joint positions implied by a parameter set. */
export interface Skeleton {
  readonly stature: number;
  readonly crotchY: number;
  readonly ankleY: number;
  readonly calfY: number;
  readonly kneeY: number;
  readonly hipY: number;
  readonly waistY: number;
  readonly underbustY: number;
  readonly chestY: number;
  readonly shoulderY: number;
  readonly chinY: number;
  /** Half the spacing between the hip joints. */
  readonly hipJointX: number;
  /** Shoulder joint of the model's left side; the right mirrors it. */
  readonly shoulderJoint: { x: number; y: number; z: number };
  readonly elbow: { x: number; y: number; z: number };
  readonly wrist: { x: number; y: number; z: number };
  readonly fingertip: { x: number; y: number; z: number };
  /** Sagittal offset of the spine at a given height, cm. */
  readonly spineAt: (y: number) => number;
}

/**
 * Lay out the skeleton.
 *
 * Height and inseam are reconciled here rather than fought over: the legs get
 * exactly the entered inseam, and the torso absorbs whatever height is left, so
 * both measurements are honoured exactly even when the pair is unusual.
 */
export function buildSkeleton(v: BodyValues): Skeleton {
  const H = v.stature;
  const crotchY = v.inseam;

  const legScale = crotchY / (A.CROTCH_HEIGHT * H);
  const torsoScale = (H - crotchY) / ((1 - A.CROTCH_HEIGHT) * H);
  const below = (fraction: number): number => fraction * H * legScale;
  const above = (fraction: number): number =>
    crotchY + (fraction - A.CROTCH_HEIGHT) * H * torsoScale;

  const hipY = above(A.HIP_HEIGHT);
  const waistY = above(A.WAIST_HEIGHT);
  const chestY = above(A.CHEST_HEIGHT);
  const shoulderY = above(A.SHOULDER_HEIGHT);
  const chinY = above(A.CHIN_HEIGHT);

  /**
   * The spine's sagittal curve, interpolated through the landmark offsets in
   * `anthropometry.ts`. Every torso cross-section is centred on it, which is
   * what turns a stack of concentric tubes into something with a posture.
   */
  const spineKeys: readonly (readonly [number, number])[] = [
    [crotchY, A.SPINE_OFFSET_HIP * H],
    [hipY, A.SPINE_OFFSET_HIP * H],
    [waistY, A.SPINE_OFFSET_WAIST * H],
    [chestY, A.SPINE_OFFSET_CHEST * H],
    [shoulderY, A.SPINE_OFFSET_SHOULDER * H],
    [chinY, A.SPINE_OFFSET_HEAD * H],
    [H, A.SPINE_OFFSET_HEAD * H],
  ];
  const spineAt = (y: number): number => {
    const first = spineKeys[0];
    const last = spineKeys[spineKeys.length - 1];
    if (first === undefined || last === undefined) return 0;
    if (y <= first[0]) return first[1];
    if (y >= last[0]) return last[1];
    for (let i = 0; i < spineKeys.length - 1; i += 1) {
      const a = spineKeys[i];
      const b = spineKeys[i + 1];
      if (a === undefined || b === undefined) continue;
      if (y >= a[0] && y <= b[0]) {
        const span = b[0] - a[0];
        const t = span <= 1e-9 ? 0 : (y - a[0]) / span;
        return lerp(a[1], b[1], t * t * (3 - 2 * t));
      }
    }
    return last[1];
  };

  const shoulderJoint = {
    x: (v.shoulderWidth / 2) * SHOULDER_JOINT_INSET,
    y: shoulderY - 0.032 * H,
    z: spineAt(shoulderY) + 0.004 * H,
  };

  // A relaxed arm is neither straight nor flat against the body: it abducts a
  // little, and carries a few degrees of elbow flexion that swings the forearm
  // and hand forward.
  const elbow = {
    x: shoulderJoint.x + Math.sin(A.ARM_ABDUCTION_RAD) * v.upperArmLength,
    y: shoulderJoint.y - Math.cos(A.ARM_ABDUCTION_RAD) * v.upperArmLength,
    z: shoulderJoint.z + Math.sin(A.ARM_FLEXION_RAD) * v.upperArmLength * 0.35,
  };
  const forearmAngle = A.ARM_ABDUCTION_RAD * 0.45;
  const wrist = {
    x: elbow.x + Math.sin(forearmAngle) * v.forearmLength,
    y: elbow.y - Math.cos(forearmAngle) * v.forearmLength,
    z: elbow.z + Math.sin(A.ARM_FLEXION_RAD) * v.forearmLength,
  };
  const fingertip = {
    x: wrist.x + Math.sin(forearmAngle) * v.handLength,
    y: wrist.y - Math.cos(forearmAngle) * v.handLength,
    z: wrist.z + Math.sin(A.ARM_FLEXION_RAD) * v.handLength * 1.2,
  };

  return {
    stature: H,
    crotchY,
    ankleY: below(A.ANKLE_HEIGHT),
    calfY: below(A.CALF_HEIGHT),
    kneeY: below(A.KNEE_HEIGHT),
    hipY,
    waistY,
    underbustY: above(A.UNDERBUST_HEIGHT),
    chestY,
    shoulderY,
    chinY,
    hipJointX: (v.hipWidth / 2) * 0.55,
    shoulderJoint,
    elbow,
    wrist,
    fingertip,
    spineAt,
  };
}

/**
 * Build every segment of the body.
 *
 * @param v Parameter values in centimetres (and kg for mass).
 * @param segments Ring resolution.
 */
export function buildBodySegments(
  v: BodyValues,
  segments: number = A.BODY_RADIAL_SEGMENTS,
): BodySegment[] {
  const s = buildSkeleton(v);
  const H = s.stature;
  const out: BodySegment[] = [];

  const push = (
    id: string,
    label: string,
    region: BodyRegion,
    slices: readonly Slice[],
    caps: { bottom: boolean; top: boolean },
    options: { perpendicular: boolean; smoothing?: number } = { perpendicular: true },
  ): void => {
    // Limbs read most naturally written from the joint downward, but a loft's
    // cap winding assumes a bottom-to-top stack — a descending one comes out
    // inside-out, with negative enclosed volume. Normalise the direction here
    // so the segment definitions below can stay in anatomical order.
    const first = slices[0];
    const last = slices[slices.length - 1];
    const ascending = first === undefined || last === undefined || first.y <= last.y;
    const ordered = ascending ? slices : [...slices].reverse();
    out.push({
      id,
      label,
      region,
      rings: sliceRings(
        subdivide(ordered, options.smoothing ?? A.BODY_SLICE_SMOOTHING),
        segments,
        options.perpendicular,
      ),
      capStart: caps.bottom,
      capEnd: caps.top,
      perpendicularMeasurement: options.perpendicular,
    });
  };

  const torso = { perpendicular: false };

  // --- Torso ---------------------------------------------------------------
  // The pelvis has to end exactly as wide as the two thighs leaving it, or the
  // legs step out of a narrower body and draw a "shorts" line at the crotch.
  const thighHalfWidth = halfWidthForCircumference(v.thigh, SHAPES.thigh, segments);
  // The pelvis's lowest section closes over both thigh tops, so it has to
  // circumscribe them *without* standing proud of them: as wide as the pair,
  // but only as deep as a single thigh. Its depth is therefore derived from the
  // thigh's, not from a hip aspect ratio — a hip-shaped section this wide
  // projects 8 cm behind the legs and reads as the hem of a pair of shorts,
  // while a shallower one lets the thighs poke out through it.
  const crotchHalfWidth = s.hipJointX + thighHalfWidth;
  const crotchShape: SectionShape = {
    front: (thighHalfWidth * SHAPES.thigh.front) / crotchHalfWidth,
    back: (thighHalfWidth * SHAPES.thigh.back) / crotchHalfWidth,
    // Squarer than a hip, so the outline hugs two circles side by side.
    squareness: 2.9,
  };
  const lowerWaistY = lerp(s.hipY, s.waistY, 0.5);
  const glutealY = lerp(s.crotchY, s.hipY, 0.45);

  push(
    'pelvis',
    'Hips & pelvis',
    'pelvis',
    [
      {
        y: s.crotchY,
        cx: 0,
        cz: s.spineAt(s.crotchY),
        circumference: circumferenceForHalfWidth(crotchHalfWidth, crotchShape, segments),
        shape: crotchShape,
      },
      {
        // The gluteal fold: the buttocks are already at nearly full projection
        // here even though the section is narrower than at the hip.
        y: glutealY,
        cx: 0,
        cz: s.spineAt(glutealY),
        circumference: lerp(
          circumferenceForHalfWidth(crotchHalfWidth, crotchShape, segments),
          v.hip,
          0.86,
        ),
        shape: blendSection(crotchShape, SHAPES.hip, 0.82),
      },
      { y: s.hipY, cx: 0, cz: s.spineAt(s.hipY), circumference: v.hip, shape: SHAPES.hip },
      {
        y: lowerWaistY,
        cx: 0,
        cz: s.spineAt(lowerWaistY),
        circumference: lerp(v.hip, v.waist, 0.62),
        shape: blendSection(SHAPES.hip, SHAPES.waist, 0.5),
      },
    ],
    { bottom: true, top: false },
    torso,
  );

  push(
    'waist',
    'Waist & midriff',
    'waist',
    [
      {
        y: lowerWaistY,
        cx: 0,
        cz: s.spineAt(lowerWaistY),
        circumference: lerp(v.hip, v.waist, 0.62),
        shape: blendSection(SHAPES.hip, SHAPES.waist, 0.5),
      },
      {
        y: s.waistY,
        cx: 0,
        cz: s.spineAt(s.waistY),
        circumference: v.waist,
        shape: SHAPES.waist,
      },
      {
        y: s.underbustY,
        cx: 0,
        cz: s.spineAt(s.underbustY),
        circumference: v.underbust,
        shape: blendSection(SHAPES.waist, SHAPES.chest, 0.5),
      },
    ],
    { bottom: false, top: false },
    torso,
  );

  // The top of the chest is sized by shoulder *breadth* rather than a
  // circumference, because that is the measurement people actually take there.
  const shoulderShape = blendSection(SHAPES.chest, SHAPES.neck, 0.25);
  const shoulderRingCircumference = circumferenceForHalfWidth(
    (v.shoulderWidth * 0.86) / 2,
    shoulderShape,
    segments,
  );
  const upperChestY = lerp(s.chestY, s.shoulderY, 0.62);
  const yokeY = s.shoulderY + SHOULDER_YOKE_OFFSET * H;

  push(
    'chest',
    'Chest & shoulders',
    'chest',
    [
      {
        y: s.underbustY,
        cx: 0,
        cz: s.spineAt(s.underbustY),
        circumference: v.underbust,
        shape: blendSection(SHAPES.waist, SHAPES.chest, 0.5),
      },
      {
        y: s.chestY,
        cx: 0,
        cz: s.spineAt(s.chestY),
        circumference: v.chest,
        shape: SHAPES.chest,
      },
      {
        y: upperChestY,
        cx: 0,
        cz: s.spineAt(upperChestY),
        circumference: Math.max(v.chest * 0.95, shoulderRingCircumference),
        shape: blendSection(SHAPES.chest, shoulderShape, 0.5),
      },
      {
        y: s.shoulderY,
        cx: 0,
        cz: s.spineAt(s.shoulderY),
        circumference: shoulderRingCircumference,
        shape: shoulderShape,
      },
      // The trapezius slopes up from the shoulder line to the neck. Without
      // this the torso ends in a flat shelf with the arms bolted to its corners.
      {
        y: yokeY,
        cx: 0,
        cz: s.spineAt(yokeY),
        circumference: v.neck * 1.42,
        shape: SHAPES.neck,
      },
    ],
    { bottom: false, top: false },
    torso,
  );

  const neckLandmarkY = s.shoulderY + (SHOULDER_YOKE_OFFSET + NECK_LANDMARK_OFFSET) * H;
  push(
    'neck',
    'Neck',
    'neck',
    [
      { y: yokeY, cx: 0, cz: s.spineAt(yokeY), circumference: v.neck * 1.42, shape: SHAPES.neck },
      {
        y: neckLandmarkY,
        cx: 0,
        cz: s.spineAt(neckLandmarkY),
        circumference: v.neck,
        shape: SHAPES.neck,
      },
      {
        y: s.chinY,
        cx: 0,
        cz: s.spineAt(s.chinY),
        circumference: v.neck * 0.94,
        shape: SHAPES.neck,
      },
    ],
    { bottom: false, top: false },
    torso,
  );

  // --- Head ----------------------------------------------------------------
  // A skull rather than an egg: a jaw that narrows to the chin, a widest point
  // at the cheekbones and brow, and a cranium that projects further behind the
  // ear canal than the face does in front of it.
  const headTopY = H;
  const headSpan = headTopY - s.chinY;
  const headBase = s.spineAt(s.chinY);
  const jawShape = biasedSection(A.HEAD_ASPECT * 0.86, 0.94, 1.06, A.HEAD_SQUARENESS);
  const headProfile: readonly (readonly [number, number, SectionShape, number])[] = [
    // [fraction of head height, circumference multiple, shape, forward offset]
    [0.0, 0.0, SHAPES.neck, 0.0],
    [0.1, 0.72, jawShape, 0.1],
    [0.26, 0.86, jawShape, 0.11],
    [0.45, 0.97, SHAPES.head, 0.06],
    [0.62, 1.0, SHAPES.head, 0.0],
    [0.78, 0.94, SHAPES.head, -0.03],
    [0.9, 0.74, SHAPES.head, -0.04],
    [1.0, 0.24, SHAPES.head, -0.03],
  ];
  const headSlices: Slice[] = headProfile.map(([t, scale, shape, forward], i) => ({
    y: s.chinY + headSpan * t,
    cx: 0,
    cz: headBase + forward * headSpan,
    // The first ring is pinned to the neck's top so the two meet without a
    // ledge; above that the profile is the skull's own.
    circumference: i === 0 ? v.neck * 0.94 : Math.max(v.headCircumference * scale, 1),
    shape,
  }));
  push('head', 'Head', 'head', headSlices, { bottom: false, top: true }, {
    perpendicular: false,
    smoothing: 3,
  });

  // --- Limbs, mirrored ------------------------------------------------------
  for (const sign of [1, -1] as const) {
    const side = sign > 0 ? 'l' : 'r';
    const sideLabel = sign > 0 ? 'left' : 'right';

    // Thigh: starts at the crotch plane the pelvis ends on.
    const midThighY = lerp(s.crotchY, s.kneeY, 0.55);
    push(
      `thigh-${side}`,
      `Thigh (${sideLabel})`,
      'thigh',
      [
        {
          y: s.crotchY,
          cx: sign * s.hipJointX,
          cz: s.spineAt(s.crotchY),
          circumference: v.thigh,
          shape: SHAPES.thigh,
        },
        {
          y: midThighY,
          cx: sign * s.hipJointX * 0.9,
          cz: s.spineAt(s.crotchY) * 0.5,
          circumference: lerp(v.thigh, v.knee, 0.62),
          shape: SHAPES.thigh,
        },
        {
          y: s.kneeY,
          cx: sign * s.hipJointX * 0.84,
          cz: 0.002 * H,
          circumference: v.knee,
          shape: blendSection(SHAPES.thigh, SHAPES.limb, 0.7),
        },
      ],
      // The pelvis's bottom cap spans both thigh tops, so the thigh needs none.
      { bottom: false, top: false },
    );

    push(
      `shank-${side}`,
      `Lower leg (${sideLabel})`,
      'shank',
      [
        {
          y: s.kneeY,
          cx: sign * s.hipJointX * 0.84,
          cz: 0.002 * H,
          circumference: v.knee,
          shape: blendSection(SHAPES.thigh, SHAPES.limb, 0.7),
        },
        {
          y: s.calfY,
          cx: sign * s.hipJointX * 0.78,
          cz: -0.004 * H,
          circumference: v.calf,
          shape: SHAPES.calf,
        },
        {
          y: lerp(s.calfY, s.ankleY, 0.65),
          cx: sign * s.hipJointX * 0.72,
          cz: -0.002 * H,
          circumference: lerp(v.calf, v.ankle, 0.78),
          shape: blendSection(SHAPES.calf, SHAPES.limb, 0.6),
        },
        {
          y: s.ankleY * 0.55,
          cx: sign * s.hipJointX * 0.7,
          cz: 0,
          circumference: v.ankle,
          shape: SHAPES.limb,
        },
      ],
      // The bottom sits inside the foot, which covers it.
      { bottom: true, top: false },
    );

    out.push(buildFoot(v, s, sign, segments));

    // --- Arm ---------------------------------------------------------------
    const bicepY = lerp(s.shoulderJoint.y, s.elbow.y, BICEP_LANDMARK_FRACTION);
    push(
      `upperarm-${side}`,
      `Upper arm (${sideLabel})`,
      'upperArm',
      [
        {
          // The deltoid dome closes exactly at the shoulder line, so the arm
          // neither rises above the trunk nor buries a large blob inside it —
          // that overlap would be counted twice in the volume the weight fit uses.
          y: s.shoulderY,
          cx: sign * s.shoulderJoint.x * 0.96,
          cz: s.shoulderJoint.z,
          circumference: v.bicep * 0.55,
          shape: SHAPES.limb,
        },
        {
          y: lerp(s.shoulderJoint.y, s.shoulderY, 0.62),
          cx: sign * s.shoulderJoint.x,
          cz: s.shoulderJoint.z,
          circumference: v.bicep * 1.24,
          shape: SHAPES.limb,
        },
        {
          y: lerp(s.shoulderJoint.y, s.shoulderY, 0.2),
          cx: sign * s.shoulderJoint.x,
          cz: s.shoulderJoint.z,
          circumference: v.bicep * 1.36,
          shape: SHAPES.limb,
        },
        {
          y: bicepY,
          cx: sign * lerp(s.shoulderJoint.x, s.elbow.x, BICEP_LANDMARK_FRACTION),
          cz: lerp(s.shoulderJoint.z, s.elbow.z, BICEP_LANDMARK_FRACTION),
          circumference: v.bicep,
          // Biceps in front, triceps behind: the upper arm is deeper than it is
          // wide, unlike the near-round forearm.
          shape: biasedSection(A.LIMB_ASPECT * 1.06, 1.02, 1.06, LIMB_N),
        },
        {
          y: s.elbow.y,
          cx: sign * s.elbow.x,
          cz: s.elbow.z,
          circumference: v.bicep * 0.85,
          shape: SHAPES.limb,
        },
      ],
      { bottom: false, top: true },
    );

    const forearmBellyT = 0.26;
    push(
      `forearm-${side}`,
      `Forearm (${sideLabel})`,
      'forearm',
      [
        {
          y: s.elbow.y,
          cx: sign * s.elbow.x,
          cz: s.elbow.z,
          circumference: v.bicep * 0.85,
          shape: SHAPES.limb,
        },
        {
          y: lerp(s.elbow.y, s.wrist.y, forearmBellyT),
          cx: sign * lerp(s.elbow.x, s.wrist.x, forearmBellyT),
          cz: lerp(s.elbow.z, s.wrist.z, forearmBellyT),
          circumference: v.forearm,
          shape: SHAPES.limb,
        },
        {
          y: lerp(s.elbow.y, s.wrist.y, 0.72),
          cx: sign * lerp(s.elbow.x, s.wrist.x, 0.72),
          cz: lerp(s.elbow.z, s.wrist.z, 0.72),
          circumference: lerp(v.forearm, v.wrist, 0.72),
          shape: blendSection(SHAPES.limb, SHAPES.wrist, 0.6),
        },
        {
          y: s.wrist.y,
          cx: sign * s.wrist.x,
          cz: s.wrist.z,
          circumference: v.wrist,
          shape: SHAPES.wrist,
        },
      ],
      { bottom: false, top: false },
    );

    push(
      `hand-${side}`,
      `Hand (${sideLabel})`,
      'hand',
      [
        {
          y: s.wrist.y,
          cx: sign * s.wrist.x,
          cz: s.wrist.z,
          circumference: v.wrist,
          shape: SHAPES.wrist,
        },
        {
          // Knuckle line: the palm is at its widest and flattest here.
          y: lerp(s.wrist.y, s.fingertip.y, 0.42),
          cx: sign * lerp(s.wrist.x, s.fingertip.x, 0.42),
          cz: lerp(s.wrist.z, s.fingertip.z, 0.42),
          circumference: v.wrist * 1.46,
          shape: SHAPES.palm,
        },
        {
          y: lerp(s.wrist.y, s.fingertip.y, 0.72),
          cx: sign * lerp(s.wrist.x, s.fingertip.x, 0.72),
          cz: lerp(s.wrist.z, s.fingertip.z, 0.72),
          circumference: v.wrist * 1.26,
          shape: SHAPES.palm,
        },
        {
          y: lerp(s.wrist.y, s.fingertip.y, 0.93),
          cx: sign * lerp(s.wrist.x, s.fingertip.x, 0.93),
          cz: lerp(s.wrist.z, s.fingertip.z, 0.93),
          circumference: v.wrist * 0.86,
          shape: SHAPES.palm,
        },
        {
          y: s.fingertip.y,
          cx: sign * s.fingertip.x,
          cz: s.fingertip.z,
          circumference: v.wrist * 0.3,
          shape: SHAPES.palm,
        },
      ],
      { bottom: true, top: false },
    );
  }

  return out;
}

/**
 * The foot, lofted heel to toe.
 *
 * A foot is a mostly horizontal object, so stacking horizontal cross-sections
 * up its height gives a wedge with no heel, arch or toe. It is built here in a
 * local frame where +Y runs heel to toe and +Z is up, then rotated upright.
 *
 * The map `(x, y, z) -> (-x, z, y)` is a rotation (determinant +1) rather than
 * an axis swap (determinant -1): a reflection would invert the loft's winding
 * and turn the foot inside out.
 */
function buildFoot(
  v: BodyValues,
  s: Skeleton,
  sign: 1 | -1,
  segments: number,
): BodySegment {
  const H = s.stature;
  const length = v.footLength;
  const halfBreadth = (H * A.FOOT_BREADTH) / 2;
  const footX = sign * s.hipJointX * 0.7;
  // The heel sits behind the ankle; the ball and toes reach forward of it.
  const heelZ = -length * A.HEEL_BEHIND_ANKLE;

  /** [along the foot 0-1, half-breadth multiple, section shape, centre height] */
  const profile: readonly (readonly [number, number, SectionShape, number])[] = [
    [0.0, 0.4, { front: 1.5, back: 1.0, squareness: 2.2 }, 0.3],
    [0.08, 0.78, { front: 1.5, back: 0.72, squareness: 2.3 }, 0.36],
    [0.22, 0.86, { front: 1.45, back: 0.5, squareness: 2.5 }, 0.42],
    // The instep, tall enough to swallow the bottom of the shank.
    [0.38, 0.84, { front: 1.15, back: 0.42, squareness: 2.6 }, 0.46],
    [0.56, 0.95, { front: 0.72, back: 0.34, squareness: 2.7 }, 0.3],
    // Ball of the foot: the widest point, and the lowest before the toes.
    [0.7, 1.0, { front: 0.46, back: 0.3, squareness: 2.8 }, 0.22],
    [0.88, 0.9, { front: 0.36, back: 0.3, squareness: 2.8 }, 0.2],
    [1.0, 0.5, { front: 0.3, back: 0.28, squareness: 2.6 }, 0.19],
  ];

  const rings: Ring[] = [];
  const control: { along: number; halfWidth: number; shape: SectionShape; height: number }[] =
    profile.map(([t, widthScale, shape, height]) => ({
      along: t,
      halfWidth: halfBreadth * widthScale,
      shape,
      height: height * halfBreadth * 2,
    }));

  // Subdivide along the foot for a smooth instep.
  const steps = 5;
  for (let i = 0; i < control.length - 1; i += 1) {
    const a = control[i];
    const b = control[i + 1];
    if (a === undefined || b === undefined) continue;
    for (let k = 0; k < steps; k += 1) {
      const t = k / steps;
      const e = t * t * (3 - 2 * t);
      const local = ringForCircumference(
        circumferenceForHalfWidth(lerp(a.halfWidth, b.halfWidth, e), blendSection(a.shape, b.shape, e), segments),
        blendSection(a.shape, b.shape, e),
        lerp(a.along, b.along, t) * length,
        segments,
        { x: 0, z: lerp(a.height, b.height, e) },
      );
      rings.push(mapRing(local, (p: Vec3) => ({ x: -p.x + footX, y: p.z, z: p.y + heelZ })));
    }
  }
  const last = control[control.length - 1];
  if (last !== undefined) {
    const local = ringForCircumference(
      circumferenceForHalfWidth(last.halfWidth, last.shape, segments),
      last.shape,
      last.along * length,
      segments,
      { x: 0, z: last.height },
    );
    rings.push(mapRing(local, (p: Vec3) => ({ x: -p.x + footX, y: p.z, z: p.y + heelZ })));
  }

  // Feet stand on the floor by definition, so rather than hand-tuning the
  // section heights until the sole happens to land at zero, drop the whole
  // foot by however much it is floating.
  let lowest = Number.POSITIVE_INFINITY;
  for (const ring of rings) {
    for (const p of ring) lowest = Math.min(lowest, p.y);
  }
  const grounded = Number.isFinite(lowest)
    ? rings.map((ring) => mapRing(ring, (p) => ({ x: p.x, y: p.y - lowest, z: p.z })))
    : rings;

  return {
    id: `foot-${sign > 0 ? 'l' : 'r'}`,
    label: `Foot (${sign > 0 ? 'left' : 'right'})`,
    region: 'foot',
    rings: grounded,
    capStart: true,
    capEnd: true,
    perpendicularMeasurement: false,
  };
}

/**
 * Total enclosed volume of a body, in litres.
 *
 * Corrected for polygon inscription. A ring of `N` points is a polygon
 * inscribed in the smooth section it samples, so it under-fills it by a factor
 * of `(N / 2pi) * sin(2pi / N)` — 0.6% at 32 segments, 0.13% at 72. Dividing it
 * back out makes the figure resolution-independent, which is what lets the
 * girth search run on a coarse mesh and the viewer on a fine one without the
 * reported weight changing between them.
 */
export function bodyVolumeLitres(segments: readonly BodySegment[]): number {
  let cm3 = 0;
  let inscription = 1;
  for (const segment of segments) {
    cm3 += ringStackVolume(segment.rings);
    const n = segment.rings[0]?.length ?? 0;
    if (n >= 3) inscription = (n / (2 * Math.PI)) * Math.sin((2 * Math.PI) / n);
  }
  return cm3 / 1000 / inscription;
}
