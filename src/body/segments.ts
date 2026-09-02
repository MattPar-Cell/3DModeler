import type { Ring } from '../core/loft.ts';
import { ringStackVolume } from '../core/loft.ts';
import {
  superellipseRingForCircumference,
  superellipseUnitPerimeter,
} from '../core/profile.ts';
import { lerp } from '../core/math.ts';
import * as A from '../constants/anthropometry.ts';
import type { BodyParamKey } from './spec.ts';

/**
 * Skeleton-driven body construction.
 *
 * The pipeline is: parameters -> landmark heights -> joint positions -> a stack
 * of cross-sections per segment -> a lofted surface. Every cross-section is a
 * super-ellipse whose *perimeter* is the corresponding circumference, so an
 * entered tape measurement is reproduced exactly rather than approximately.
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
 * Which parameters shape each region. The confidence indicator takes a region's
 * rating from the *least* certain parameter in its list, so a region only reads
 * "measured" when everything that determines its size was actually measured.
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

/** One cross-section of a segment. */
interface Slice {
  /** Height above the floor, cm. */
  readonly y: number;
  /** Centre offset across the body (+X is the model's left), cm. */
  readonly cx: number;
  /** Centre offset front-to-back (+Z is the front), cm. */
  readonly cz: number;
  /** Perimeter of the cross-section, cm. */
  readonly circumference: number;
  /** Depth / width of the cross-section. */
  readonly aspect: number;
  /** Super-ellipse exponent. */
  readonly squareness: number;
}

/**
 * A named, lofted piece of the body.
 *
 * Segments *meet* at shared landmark planes rather than interpenetrating.
 * Overlapping them would look marginally smoother, but the overlap volume gets
 * counted twice, and the weight fit is a volume calculation — two thighs
 * pushed up inside the pelvis added around 6 litres of phantom body, which the
 * girth search then tried to remove by shrinking the real measurements.
 */
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
}

/** The circumference a super-ellipse of the given half-width would have. */
export function circumferenceForHalfWidth(
  halfWidth: number,
  aspect: number,
  squareness: number,
): number {
  return halfWidth * superellipseUnitPerimeter(aspect, squareness);
}

/**
 * Turn slices into rings.
 *
 * Rings are horizontal, which keeps the whole model on one simple code path.
 * A segment that leans away from vertical would then have a cross-section
 * stretched by `1 / cos(tilt)`, so each slice's perimeter is pre-divided by
 * that factor: the perimeter *perpendicular to the limb* — the thing a tape
 * measure reads — comes out right. At the abduction angles used here the
 * correction is under 3%, but it is the difference between matching a
 * measurement and merely approximating it.
 */
function sliceRings(slices: readonly Slice[], segments: number): Ring[] {
  return slices.map((slice, i) => {
    const previous = slices[Math.max(i - 1, 0)];
    const next = slices[Math.min(i + 1, slices.length - 1)];
    let tiltFactor = 1;
    if (previous !== undefined && next !== undefined && previous !== next) {
      const dy = Math.abs(next.y - previous.y);
      const dl = Math.hypot(next.y - previous.y, next.cx - previous.cx, next.cz - previous.cz);
      if (dy > 1e-6) tiltFactor = dy / dl;
    }
    return superellipseRingForCircumference(
      slice.circumference / Math.max(tiltFactor, 1e-6),
      slice.aspect,
      slice.squareness,
      slice.y,
      segments,
      { x: slice.cx, z: slice.cz },
    );
  });
}

/** Insert `count` interpolated slices between each pair, for a smoother loft. */
function subdivide(slices: readonly Slice[], count: number): Slice[] {
  if (count < 1) return [...slices];
  const out: Slice[] = [];
  for (let i = 0; i < slices.length - 1; i += 1) {
    const a = slices[i];
    const b = slices[i + 1];
    if (a === undefined || b === undefined) continue;
    for (let k = 0; k < count + 1; k += 1) {
      const t = k / (count + 1);
      // Smoothstep in the profile, so control slices are tangent-continuous.
      const s = t * t * (3 - 2 * t);
      out.push({
        y: lerp(a.y, b.y, t),
        cx: lerp(a.cx, b.cx, t),
        cz: lerp(a.cz, b.cz, t),
        circumference: lerp(a.circumference, b.circumference, s),
        aspect: lerp(a.aspect, b.aspect, s),
        squareness: lerp(a.squareness, b.squareness, s),
      });
    }
  }
  const last = slices[slices.length - 1];
  if (last !== undefined) out.push(last);
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
  /** Shoulder joint, for the side given by `sign` (+1 = model's left). */
  readonly shoulderJoint: { x: number; y: number };
  readonly elbow: { x: number; y: number };
  readonly wrist: { x: number; y: number };
  readonly fingertip: { x: number; y: number };
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

  const shoulderY = above(A.SHOULDER_HEIGHT);
  const shoulderJoint = {
    x: (v.shoulderWidth / 2) * SHOULDER_JOINT_INSET,
    y: shoulderY - 0.032 * H,
  };

  const elbow = {
    x: shoulderJoint.x + Math.sin(A.ARM_ABDUCTION_RAD) * v.upperArmLength,
    y: shoulderJoint.y - Math.cos(A.ARM_ABDUCTION_RAD) * v.upperArmLength,
  };
  const forearmAngle = A.ARM_ABDUCTION_RAD * 0.45;
  const wrist = {
    x: elbow.x + Math.sin(forearmAngle) * v.forearmLength,
    y: elbow.y - Math.cos(forearmAngle) * v.forearmLength,
  };
  const fingertip = {
    x: wrist.x + Math.sin(forearmAngle) * v.handLength,
    y: wrist.y - Math.cos(forearmAngle) * v.handLength,
  };

  return {
    stature: H,
    crotchY,
    ankleY: below(A.ANKLE_HEIGHT),
    calfY: below(A.CALF_HEIGHT),
    kneeY: below(A.KNEE_HEIGHT),
    hipY: above(A.HIP_HEIGHT),
    waistY: above(A.WAIST_HEIGHT),
    underbustY: above(A.UNDERBUST_HEIGHT),
    chestY: above(A.CHEST_HEIGHT),
    shoulderY,
    chinY: above(A.CHIN_HEIGHT),
    hipJointX: (v.hipWidth / 2) * 0.55,
    shoulderJoint,
    elbow,
    wrist,
    fingertip,
  };
}

/**
 * Heights at which the tape-measure landmarks sit, shared with `measure.ts`.
 * The readback has to sample the mesh at exactly the height the builder placed
 * the slice, so these live in one place rather than as two matching literals.
 */
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

const TORSO_N = A.TORSO_SQUARENESS;
const LIMB_N = A.LIMB_SQUARENESS;

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
    smoothing = 3,
  ): void => {
    // Limbs read most naturally written from the joint downward, but a loft's
    // cap winding assumes a bottom-to-top stack — a descending one comes out
    // inside-out, with negative enclosed volume. Normalise the direction here
    // so the segment definitions above can stay in anatomical order.
    const first = slices[0];
    const last = slices[slices.length - 1];
    const ascending = first === undefined || last === undefined || first.y <= last.y;
    const ordered = ascending ? slices : [...slices].reverse();
    out.push({
      id,
      label,
      region,
      rings: sliceRings(subdivide(ordered, smoothing), segments),
      capStart: caps.bottom,
      capEnd: caps.top,
    });
  };

  // --- Torso, split at the landmarks the confidence report is keyed to ------
  const lowerWaistY = lerp(s.hipY, s.waistY, 0.5);

  // The pelvis has to end exactly as wide as the two thighs leaving it, or the
  // legs step out of a narrower body and draw a "shorts" line at the crotch.
  const thighHalfWidth = v.thigh / superellipseUnitPerimeter(A.LIMB_ASPECT, LIMB_N);
  const crotchHalfWidth = s.hipJointX + thighHalfWidth;

  push(
    'pelvis',
    'Hips & pelvis',
    'pelvis',
    [
    {
      y: s.crotchY,
      cx: 0,
      cz: 0,
      circumference: circumferenceForHalfWidth(crotchHalfWidth, A.HIP_ASPECT, TORSO_N),
      aspect: A.HIP_ASPECT,
      squareness: TORSO_N,
    },
    { y: s.hipY, cx: 0, cz: 0, circumference: v.hip, aspect: A.HIP_ASPECT, squareness: TORSO_N },
    {
      y: lowerWaistY,
      cx: 0,
      cz: 0,
      circumference: lerp(v.hip, v.waist, 0.62),
      aspect: lerp(A.HIP_ASPECT, A.WAIST_ASPECT, 0.5),
      squareness: TORSO_N,
    },
    ],
    { bottom: true, top: false },
  );

  push(
    'waist',
    'Waist & midriff',
    'waist',
    [
    {
      y: lowerWaistY,
      cx: 0,
      cz: 0,
      circumference: lerp(v.hip, v.waist, 0.62),
      aspect: lerp(A.HIP_ASPECT, A.WAIST_ASPECT, 0.5),
      squareness: TORSO_N,
    },
    { y: s.waistY, cx: 0, cz: 0, circumference: v.waist, aspect: A.WAIST_ASPECT, squareness: TORSO_N },
    {
      y: s.underbustY,
      cx: 0,
      cz: 0,
      circumference: v.underbust,
      aspect: lerp(A.WAIST_ASPECT, A.CHEST_ASPECT, 0.5),
      squareness: TORSO_N,
    },
    ],
    { bottom: false, top: false },
  );

  // The top of the chest is sized by shoulder *breadth* rather than a
  // circumference, because that is the measurement people actually take there.
  const shoulderRingCircumference = circumferenceForHalfWidth(
    (v.shoulderWidth * 0.78) / 2,
    A.CHEST_ASPECT,
    TORSO_N,
  );
  push(
    'chest',
    'Chest & shoulders',
    'chest',
    [
    {
      y: s.underbustY,
      cx: 0,
      cz: 0,
      circumference: v.underbust,
      aspect: lerp(A.WAIST_ASPECT, A.CHEST_ASPECT, 0.5),
      squareness: TORSO_N,
    },
    { y: s.chestY, cx: 0, cz: 0, circumference: v.chest, aspect: A.CHEST_ASPECT, squareness: TORSO_N },
    {
      y: lerp(s.chestY, s.shoulderY, 0.62),
      cx: 0,
      cz: 0,
      circumference: Math.max(v.chest * 0.95, shoulderRingCircumference),
      aspect: A.CHEST_ASPECT,
      squareness: TORSO_N,
    },
    {
      y: s.shoulderY,
      cx: 0,
      cz: 0,
      circumference: shoulderRingCircumference,
      aspect: A.CHEST_ASPECT * 1.05,
      squareness: TORSO_N,
    },
    // The trapezius slopes up from the shoulder line to the neck. Without this
    // the torso ends in a flat shelf with the arms bolted onto its corners.
    {
      y: s.shoulderY + SHOULDER_YOKE_OFFSET * H,
      cx: 0,
      cz: 0,
      circumference: v.neck * 1.42,
      aspect: A.NECK_ASPECT,
      squareness: TORSO_N,
    },
    ],
    { bottom: false, top: false },
  );

  push(
    'neck',
    'Neck',
    'neck',
    [
      {
        y: s.shoulderY + SHOULDER_YOKE_OFFSET * H,
        cx: 0,
        cz: 0,
        circumference: v.neck * 1.42,
        aspect: A.NECK_ASPECT,
        squareness: TORSO_N,
      },
      {
        y: s.shoulderY + (SHOULDER_YOKE_OFFSET + NECK_LANDMARK_OFFSET) * H,
        cx: 0,
        cz: 0,
        circumference: v.neck,
        aspect: A.NECK_ASPECT,
        squareness: LIMB_N,
      },
      { y: s.chinY, cx: 0, cz: 0, circumference: v.neck * 0.94, aspect: A.NECK_ASPECT, squareness: LIMB_N },
    ],
    { bottom: false, top: false },
  );

  // --- Head: a closed blob from the chin to the crown ----------------------
  const headTopY = H;
  const headSlices: Slice[] = [];
  const headRows = 12;
  for (let i = 0; i <= headRows; i += 1) {
    const t = i / headRows;
    // Widest a little above the middle, tapering to a closed crown.
    const shape = Math.sin(Math.PI * (0.18 + 0.74 * t)) ** 0.72;
    headSlices.push({
      y: lerp(s.chinY, headTopY, t),
      cx: 0,
      cz: 0.012 * H * Math.sin(Math.PI * t) * 0.4,
      // The first ring is pinned to the neck's top ring so the two meet without
      // a ledge; above that the profile is the head's own.
      circumference: i === 0 ? v.neck * 0.94 : Math.max(v.headCircumference * shape, 1),
      aspect: i === 0 ? A.NECK_ASPECT : A.HEAD_ASPECT,
      squareness: LIMB_N,
    });
  }
  push('head', 'Head', 'head', headSlices, { bottom: false, top: true }, 0);

  // --- Limbs, mirrored ------------------------------------------------------
  for (const sign of [1, -1] as const) {
    const side = sign > 0 ? 'l' : 'r';
    const sideLabel = sign > 0 ? 'left' : 'right';

    // Thigh: starts inside the pelvis so the join is hidden.
    push(
      `thigh-${side}`,
      `Thigh (${sideLabel})`,
      'thigh',
      [
      { y: s.crotchY, cx: sign * s.hipJointX, cz: 0, circumference: v.thigh, aspect: A.LIMB_ASPECT, squareness: LIMB_N },
      {
        y: lerp(s.crotchY, s.kneeY, 0.55),
        cx: sign * s.hipJointX * 0.9,
        cz: 0,
        circumference: lerp(v.thigh, v.knee, 0.62),
        aspect: A.LIMB_ASPECT,
        squareness: LIMB_N,
      },
      { y: s.kneeY, cx: sign * s.hipJointX * 0.84, cz: 0, circumference: v.knee, aspect: A.LIMB_ASPECT, squareness: LIMB_N },
      ],
      // The pelvis's bottom cap spans both thigh tops, so the thigh needs none.
      { bottom: false, top: false },
    );

    push(
      `shank-${side}`,
      `Lower leg (${sideLabel})`,
      'shank',
      [
        { y: s.kneeY, cx: sign * s.hipJointX * 0.84, cz: 0, circumference: v.knee, aspect: A.LIMB_ASPECT, squareness: LIMB_N },
        { y: s.calfY, cx: sign * s.hipJointX * 0.78, cz: -0.004 * H, circumference: v.calf, aspect: A.LIMB_ASPECT * 0.94, squareness: LIMB_N },
        { y: s.ankleY, cx: sign * s.hipJointX * 0.7, cz: 0, circumference: v.ankle, aspect: A.LIMB_ASPECT, squareness: LIMB_N },
      ],
      { bottom: false, top: false },
    );

    // Foot: sized by length and breadth rather than a circumference.
    const footAspect = v.footLength / (H * A.FOOT_BREADTH);
    push(
      `foot-${side}`,
      `Foot (${sideLabel})`,
      'foot',
      [
        { y: s.ankleY, cx: sign * s.hipJointX * 0.7, cz: 0, circumference: v.ankle, aspect: A.LIMB_ASPECT, squareness: LIMB_N },
        // A short vertical stub below the ankle. Without it the foot's top ring
        // sits on a segment heading sharply forward while the shank's sits on a
        // vertical one, the two get different tilt corrections, and the
        // mismatch opens a dark step right at the ankle.
        {
          y: s.ankleY * 0.74,
          cx: sign * s.hipJointX * 0.7,
          cz: v.footLength * 0.02,
          circumference: v.ankle * 1.04,
          aspect: A.LIMB_ASPECT,
          squareness: LIMB_N,
        },
        {
          y: s.ankleY * 0.45,
          cx: sign * s.hipJointX * 0.7,
          cz: v.footLength * 0.16,
          circumference: circumferenceForHalfWidth((H * A.FOOT_BREADTH) / 2, footAspect * 0.72, 2.6),
          aspect: footAspect * 0.72,
          squareness: 2.6,
        },
        {
          y: 0.004 * H,
          cx: sign * s.hipJointX * 0.7,
          cz: v.footLength * 0.2,
          circumference: circumferenceForHalfWidth((H * A.FOOT_BREADTH) / 2, footAspect, 2.8),
          aspect: footAspect,
          squareness: 2.8,
        },
      ],
      { bottom: true, top: false },
      2,
    );

    push(
      `upperarm-${side}`,
      `Upper arm (${sideLabel})`,
      'upperArm',
      [
      // Three rings close the deltoid into a dome; a single wide ring with a
      // cap reads as a flat plate sitting on top of the shoulder.
      {
        // The dome closes exactly at the shoulder line, so the arm neither
        // rises above the trunk nor buries a large blob inside it — that
        // overlap would be counted twice in the volume the weight fit uses.
        y: s.shoulderY,
        cx: sign * s.shoulderJoint.x * 0.96,
        cz: 0,
        circumference: v.bicep * 0.55,
        aspect: A.LIMB_ASPECT,
        squareness: LIMB_N,
      },
      {
        y: lerp(s.shoulderJoint.y, s.shoulderY, 0.62),
        cx: sign * s.shoulderJoint.x,
        cz: 0,
        circumference: v.bicep * 1.24,
        aspect: A.LIMB_ASPECT,
        squareness: LIMB_N,
      },
      {
        y: lerp(s.shoulderJoint.y, s.shoulderY, 0.2),
        cx: sign * s.shoulderJoint.x,
        cz: 0,
        circumference: v.bicep * 1.36,
        aspect: A.LIMB_ASPECT,
        squareness: LIMB_N,
      },
      {
        y: lerp(s.shoulderJoint.y, s.elbow.y, BICEP_LANDMARK_FRACTION),
        cx: sign * lerp(s.shoulderJoint.x, s.elbow.x, BICEP_LANDMARK_FRACTION),
        cz: 0,
        circumference: v.bicep,
        aspect: A.LIMB_ASPECT,
        squareness: LIMB_N,
      },
      { y: s.elbow.y, cx: sign * s.elbow.x, cz: 0, circumference: v.bicep * 0.85, aspect: A.LIMB_ASPECT, squareness: LIMB_N },
      ],
      { bottom: false, top: true },
    );

    push(
      `forearm-${side}`,
      `Forearm (${sideLabel})`,
      'forearm',
      [
      { y: s.elbow.y, cx: sign * s.elbow.x, cz: 0, circumference: v.bicep * 0.85, aspect: A.LIMB_ASPECT, squareness: LIMB_N },
      {
        y: lerp(s.elbow.y, s.wrist.y, 0.28),
        cx: sign * lerp(s.elbow.x, s.wrist.x, 0.28),
        cz: 0,
        circumference: v.forearm,
        aspect: A.LIMB_ASPECT,
        squareness: LIMB_N,
      },
      { y: s.wrist.y, cx: sign * s.wrist.x, cz: 0, circumference: v.wrist, aspect: 0.72, squareness: LIMB_N },
      ],
      { bottom: false, top: false },
    );

    push(
      `hand-${side}`,
      `Hand (${sideLabel})`,
      'hand',
      [
      { y: s.wrist.y, cx: sign * s.wrist.x, cz: 0, circumference: v.wrist, aspect: 0.72, squareness: LIMB_N },
      {
        y: lerp(s.wrist.y, s.fingertip.y, 0.38),
        cx: sign * lerp(s.wrist.x, s.fingertip.x, 0.38),
        cz: 0,
        circumference: v.wrist * 1.42,
        aspect: 0.42,
        squareness: 2.6,
      },
      {
        y: lerp(s.wrist.y, s.fingertip.y, 0.88),
        cx: sign * lerp(s.wrist.x, s.fingertip.x, 0.88),
        cz: 0,
        circumference: v.wrist * 1.05,
        aspect: 0.4,
        squareness: 2.6,
      },
      { y: s.fingertip.y, cx: sign * s.fingertip.x, cz: 0, circumference: v.wrist * 0.4, aspect: 0.45, squareness: 2.4 },
      ],
      { bottom: true, top: false },
    );
  }

  return out;
}

/** Total enclosed volume of a body, in litres. */
export function bodyVolumeLitres(segments: readonly BodySegment[]): number {
  let cm3 = 0;
  for (const segment of segments) cm3 += ringStackVolume(segment.rings);
  return cm3 / 1000;
}
