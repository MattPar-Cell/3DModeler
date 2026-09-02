import { ringCircumference } from '../core/profile.ts';
import type { Ring } from '../core/loft.ts';
import type { BodySegment, Skeleton } from './segments.ts';
import {
  BICEP_LANDMARK_FRACTION,
  NECK_LANDMARK_OFFSET,
  SHOULDER_JOINT_INSET,
  SHOULDER_YOKE_OFFSET,
  bodyVolumeLitres,
} from './segments.ts';
import * as A from '../constants/anthropometry.ts';

/**
 * Tape-measure the reconstructed mesh.
 *
 * The residual report would be worthless if it echoed the parameters back, so
 * these functions read the *generated geometry* instead: perimeters come off
 * the actual rings, stature off the actual bounding box, and mass off the
 * actual enclosed volume. If the builder ever stops honouring a measurement,
 * the residual table — and the unit tests — say so.
 */

function centroidXZ(ring: Ring): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p.x;
    z += p.z;
  }
  const n = Math.max(ring.length, 1);
  return { x: x / n, z: z / n };
}

/**
 * Circumference perpendicular to the segment's axis at ring `i`.
 *
 * Rings are horizontal, so a leaning segment's ring is longer than the
 * cross-section a tape would read. This applies the inverse of the correction
 * `segments.ts` makes when it builds them.
 */
function perpendicularCircumference(rings: readonly Ring[], i: number): number {
  const ring = rings[i];
  if (ring === undefined) return 0;
  const previous = rings[Math.max(i - 1, 0)];
  const next = rings[Math.min(i + 1, rings.length - 1)];
  let tiltFactor = 1;
  if (previous !== undefined && next !== undefined && previous !== next) {
    const a = centroidXZ(previous);
    const b = centroidXZ(next);
    const dy = Math.abs((next[0]?.y ?? 0) - (previous[0]?.y ?? 0));
    const dl = Math.hypot(dy, b.x - a.x, b.z - a.z);
    if (dl > 1e-9) tiltFactor = dy / dl;
  }
  return ringCircumference(ring) * tiltFactor;
}

/**
 * Circumference of a named segment at height `y`, interpolated between the two
 * rings that bracket it. Returns `undefined` if the segment does not span `y`.
 */
export function circumferenceAt(
  segments: readonly BodySegment[],
  segmentId: string,
  y: number,
): number | undefined {
  const segment = segments.find((s) => s.id === segmentId);
  if (segment === undefined || segment.rings.length < 2) return undefined;
  const rings = segment.rings;

  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rings.length - 1; i += 1) {
    const y0 = rings[i]?.[0]?.y;
    const y1 = rings[i + 1]?.[0]?.y;
    if (y0 === undefined || y1 === undefined) continue;
    const lo = Math.min(y0, y1);
    const hi = Math.max(y0, y1);
    if (y >= lo && y <= hi) {
      const t = hi === lo ? 0 : (y - y0) / (y1 - y0);
      const c0 = perpendicularCircumference(rings, i);
      const c1 = perpendicularCircumference(rings, i + 1);
      return c0 + (c1 - c0) * t;
    }
    // Track the nearest ring so a landmark just outside the segment (which
    // happens at the very ends) still returns something sensible.
    for (const [index, ringY] of [
      [i, y0],
      [i + 1, y1],
    ] as const) {
      const distance = Math.abs(ringY - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = perpendicularCircumference(rings, index);
      }
    }
  }
  return best;
}

/** Highest point of the mesh — the reconstructed stature. */
export function meshStature(segments: readonly BodySegment[]): number {
  let top = 0;
  for (const segment of segments) {
    for (const ring of segment.rings) {
      for (const point of ring) {
        if (point.y > top) top = point.y;
      }
    }
  }
  return top;
}

/** Mass implied by the mesh's enclosed volume, kg. */
export function meshMass(segments: readonly BodySegment[]): number {
  return bodyVolumeLitres(segments) * A.BODY_DENSITY_KG_PER_L;
}

/** Every measurable quantity, read back off the generated mesh. */
export interface BodyMeasurementReadback {
  readonly stature: number;
  readonly mass: number;
  readonly chest: number | undefined;
  readonly waist: number | undefined;
  readonly hip: number | undefined;
  readonly neck: number | undefined;
  readonly thigh: number | undefined;
  readonly bicep: number | undefined;
  readonly wrist: number | undefined;
  readonly inseam: number;
  readonly shoulderWidth: number;
  readonly forearmLength: number;
}

/** Read every measurement back off the mesh, for the residual report. */
export function measureBody(
  segments: readonly BodySegment[],
  skeleton: Skeleton,
): BodyMeasurementReadback {
  const bicepY =
    skeleton.shoulderJoint.y +
    (skeleton.elbow.y - skeleton.shoulderJoint.y) * BICEP_LANDMARK_FRACTION;
  return {
    stature: meshStature(segments),
    mass: meshMass(segments),
    chest: circumferenceAt(segments, 'chest', skeleton.chestY),
    waist: circumferenceAt(segments, 'waist', skeleton.waistY),
    hip: circumferenceAt(segments, 'pelvis', skeleton.hipY),
    neck: circumferenceAt(segments, 'neck', skeleton.shoulderY + (SHOULDER_YOKE_OFFSET + NECK_LANDMARK_OFFSET) * skeleton.stature),
    thigh: circumferenceAt(segments, 'thigh-l', skeleton.crotchY),
    bicep: circumferenceAt(segments, 'upperarm-l', bicepY),
    wrist: circumferenceAt(segments, 'forearm-l', skeleton.wrist.y),
    inseam: skeleton.crotchY,
    // Biacromial breadth is a skeletal landmark rather than a surface one, so
    // it comes from the skeleton: the mesh's widest point across the shoulders
    // is deltoid-to-deltoid, which is legitimately wider.
    shoulderWidth: (skeleton.shoulderJoint.x * 2) / SHOULDER_JOINT_INSET,
    forearmLength: Math.hypot(
      skeleton.wrist.x - skeleton.elbow.x,
      skeleton.wrist.y - skeleton.elbow.y,
    ),
  };
}
