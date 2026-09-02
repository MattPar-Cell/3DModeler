import type { Ring, Vec3 } from './loft.ts';
import { lerp, monotoneCubicAt, smoothstep } from './math.ts';

/**
 * Ring generators. A "profile" is the shape of a cross-section as a function of
 * height; sampling it produces the {@link Ring} stack that
 * {@link import('./loft.ts').loftGeometry} turns into a surface.
 *
 * Everything here is built on one primitive, the *asymmetric super-ellipse*:
 *
 *   |x / a|^n + |z / b(z)|^n = 1,   b(z) = front for z > 0, back for z < 0
 *
 * `n = 2` with `front = back` is a plain ellipse. Real cross-sections are
 * neither elliptical nor front-back symmetric — a waist is flatter than an
 * ellipse, and a hip is far deeper behind than in front — so both degrees of
 * freedom earn their place.
 */

/** A cross-section's shape, independent of its size. */
export interface SectionShape {
  /** Depth toward +Z (the front of the body) as a multiple of half-width. */
  readonly front: number;
  /** Depth toward -Z (the back) as a multiple of half-width. */
  readonly back: number;
  /** Super-ellipse exponent. 2 is an ellipse; higher is flatter-sided. */
  readonly squareness: number;
}

/** A circular section — the default for lamp parts. */
export function roundSection(squareness = 2): SectionShape {
  return { front: 1, back: 1, squareness };
}

/** A front-back symmetric section of the given depth-to-width ratio. */
export function evenSection(aspect: number, squareness: number): SectionShape {
  return { front: aspect, back: aspect, squareness };
}

/**
 * Unit shape cache.
 *
 * The powers in a super-ellipse depend only on the exponent and the number of
 * segments, never on the size — so they are computed once per (n, segments)
 * pair and every ring afterwards is two multiplications per point. The body
 * fitter builds a few hundred rings per trial and runs ~25 trials per fit, so
 * this is the difference between a responsive slider and a stuttering one.
 */
interface UnitShape {
  readonly ux: Float64Array;
  readonly uz: Float64Array;
}

const unitShapeCache = new Map<string, UnitShape>();

function unitShape(squareness: number, segments: number): UnitShape {
  const key = `${squareness}|${segments}`;
  const cached = unitShapeCache.get(key);
  if (cached !== undefined) return cached;

  const ux = new Float64Array(segments);
  const uz = new Float64Array(segments);
  const e = 2 / Math.max(squareness, 0.2);
  for (let j = 0; j < segments; j += 1) {
    const theta = (j / segments) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    ux[j] = Math.sign(c) * Math.abs(c) ** e;
    uz[j] = Math.sign(s) * Math.abs(s) ** e;
  }
  const shape = { ux, uz };
  unitShapeCache.set(key, shape);
  return shape;
}

/**
 * A ring of `segments` points at height `y`, centred on `centre`.
 * Points run counter-clockwise seen from +Y, matching the loft's winding.
 *
 * @param halfWidth Semi-axis along X, cm.
 * @param shape Depth ratios and squareness.
 */
export function sectionRing(
  halfWidth: number,
  shape: SectionShape,
  y: number,
  segments: number,
  centre: { x: number; z: number } = { x: 0, z: 0 },
): Ring {
  const { ux, uz } = unitShape(shape.squareness, segments);
  const front = halfWidth * shape.front;
  const back = halfWidth * shape.back;
  const points: Vec3[] = new Array<Vec3>(segments);
  for (let j = 0; j < segments; j += 1) {
    const uzj = uz[j] ?? 0;
    points[j] = {
      x: centre.x + (ux[j] ?? 0) * halfWidth,
      y,
      z: centre.z + uzj * (uzj >= 0 ? front : back),
    };
  }
  return points;
}

/** A circular ring — the common case, kept as its own name for readability. */
export function circleRing(
  radius: number,
  y: number,
  segments: number,
  centre: { x: number; z: number } = { x: 0, z: 0 },
): Ring {
  return sectionRing(radius, ROUND, y, segments, centre);
}

const ROUND: SectionShape = { front: 1, back: 1, squareness: 2 };

/**
 * A front-back symmetric super-ellipse ring.
 *
 * @param a Semi-axis along X (half the side-to-side width), cm.
 * @param b Semi-axis along Z (half the front-to-back depth), cm.
 * @param n Squareness exponent, plausible range 1.6 - 3.5.
 */
export function superellipseRing(
  a: number,
  b: number,
  n: number,
  y: number,
  segments: number,
  centre: { x: number; z: number } = { x: 0, z: 0 },
): Ring {
  return sectionRing(a, { front: b / a, back: b / a, squareness: n }, y, segments, centre);
}

const unitPerimeterCache = new Map<string, number>();

/**
 * Perimeter of a section of unit half-width.
 *
 * There is no closed form, so this integrates the sampled polygon at the same
 * resolution the ring will actually be emitted at. Perimeter is linear in
 * half-width, which is what makes {@link ringForCircumference} exact: scale by
 * the target over this value and the ring's perimeter *is* the target.
 */
export function unitPerimeter(shape: SectionShape, segments: number): number {
  const key = `${shape.front}|${shape.back}|${shape.squareness}|${segments}`;
  const cached = unitPerimeterCache.get(key);
  if (cached !== undefined) return cached;

  const ring = sectionRing(1, shape, 0, segments);
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    if (p === undefined || q === undefined) continue;
    total += Math.hypot(q.x - p.x, q.z - p.z);
  }
  unitPerimeterCache.set(key, total);
  return total;
}

/** Backwards-compatible wrapper for a symmetric section. */
export function superellipseUnitPerimeter(ratio: number, n: number, samples = 512): number {
  return unitPerimeter(evenSection(ratio, n), samples);
}

/**
 * A ring whose perimeter equals `circumference`.
 *
 * This is how a tape-measure reading becomes geometry: the user's chest
 * circumference is reproduced exactly (to polygon discretisation), while the
 * cross-section's *shape* — how much wider than deep it is, how far from
 * elliptical, and how much of its depth sits behind the spine rather than in
 * front — comes from the anthropometric priors.
 */
export function ringForCircumference(
  circumference: number,
  shape: SectionShape,
  y: number,
  segments: number,
  centre: { x: number; z: number } = { x: 0, z: 0 },
): Ring {
  if (circumference <= 0) return circleRing(0, y, segments, centre);
  return sectionRing(circumference / unitPerimeter(shape, segments), shape, y, segments, centre);
}

/** The half-width a section of the given circumference would have. */
export function halfWidthForCircumference(
  circumference: number,
  shape: SectionShape,
  segments: number,
): number {
  return circumference / unitPerimeter(shape, segments);
}

/** The circumference a section of the given half-width would have. */
export function circumferenceForHalfWidth(
  halfWidth: number,
  shape: SectionShape,
  segments: number,
): number {
  return halfWidth * unitPerimeter(shape, segments);
}

/** Backwards-compatible wrapper for a symmetric section. */
export function superellipseRingForCircumference(
  circumference: number,
  ratio: number,
  n: number,
  y: number,
  segments: number,
  centre: { x: number; z: number } = { x: 0, z: 0 },
): Ring {
  return ringForCircumference(circumference, evenSection(ratio, n), y, segments, centre);
}

/** Perimeter of a ring's polygon. */
export function ringCircumference(ring: Ring): number {
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    if (p === undefined || q === undefined) continue;
    total += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
  }
  return total;
}

/**
 * Map every point of a ring through `f`.
 *
 * Used to reorient a segment that was authored along a different axis than the
 * one it occupies — the foot is built heel-to-toe and then rotated upright.
 * `f` must be a rotation (determinant +1); a reflection would invert the loft's
 * winding and turn the segment inside out.
 */
export function mapRing(ring: Ring, f: (p: Vec3) => Vec3): Ring {
  return ring.map(f);
}

/** A control point on a radius-vs-height profile. `t` runs 0 (bottom) to 1 (top). */
export interface ProfilePoint {
  readonly t: number;
  readonly radius: number;
}

/**
 * Evaluate a piecewise profile at `t` with smoothstep blending between control
 * points, which keeps the lofted surface tangent-continuous at the joins
 * instead of showing a hard crease at every control height.
 */
export function sampleProfile(points: readonly ProfilePoint[], t: number): number {
  if (points.length === 0) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (t <= first.t) return first.radius;
  if (t >= last.t) return last.radius;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const local = span <= 0 ? 0 : (t - a.t) / span;
      return lerp(a.radius, b.radius, smoothstep(local));
    }
  }
  return last.radius;
}

/**
 * Sample a radius profile into a ring stack spanning [y0, y1].
 *
 * The profile runs through a monotone cubic rather than per-span smoothstep, so
 * a turned form reads as a continuous curve instead of a stack of cylinders
 * joined by ramps — and never bulges past a control radius.
 *
 * `rows` is the number of rings, so the surface has `rows - 1` quad bands.
 */
export function revolveProfile(
  points: readonly ProfilePoint[],
  y0: number,
  y1: number,
  rows: number,
  segments: number,
  shape: SectionShape = ROUND,
): Ring[] {
  const radiusAt = monotoneCubicAt(
    points.map((p) => p.t),
    points.map((p) => p.radius),
  );
  const rings: Ring[] = new Array<Ring>(rows);
  for (let i = 0; i < rows; i += 1) {
    const t = rows === 1 ? 0 : i / (rows - 1);
    rings[i] = sectionRing(radiusAt(t), shape, lerp(y0, y1, t), segments);
  }
  return rings;
}

/**
 * A tube swept along an arbitrary path.
 *
 * Rings are placed perpendicular to the path using parallel-transport frames:
 * a reference normal is carried along the curve and rotated only by as much as
 * the tangent turns. The obvious alternative — a Frenet frame — flips its
 * normal wherever the curve straightens out, which puts a visible twist in a
 * wire that a lamp harp shows off perfectly.
 *
 * @param path At least two points, in order along the tube.
 * @param radius Constant, or a function of the fraction along the path.
 */
export function tubeRings(
  path: readonly Vec3[],
  radius: number | ((t: number) => number),
  segments: number,
): Ring[] {
  if (path.length < 2) return [];
  const radiusAt = typeof radius === 'number' ? () => radius : radius;

  const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const cross = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
  const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
  const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
  const norm = (v: Vec3): Vec3 => {
    const len = Math.hypot(v.x, v.y, v.z);
    return len < 1e-12 ? { x: 0, y: 1, z: 0 } : scale(v, 1 / len);
  };

  const tangents: Vec3[] = path.map((_, i) => {
    const a = path[Math.max(i - 1, 0)];
    const b = path[Math.min(i + 1, path.length - 1)];
    return a === undefined || b === undefined ? { x: 0, y: 1, z: 0 } : norm(sub(b, a));
  });

  // Seed the frame with any axis not parallel to the first tangent.
  const first = tangents[0] ?? { x: 0, y: 1, z: 0 };
  const seed = Math.abs(first.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let normal = norm(sub(seed, scale(first, dot(seed, first))));

  const rings: Ring[] = [];
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i];
    const tangent = tangents[i];
    if (point === undefined || tangent === undefined) continue;
    if (i > 0) {
      // Re-orthogonalise against the new tangent: parallel transport.
      normal = norm(sub(normal, scale(tangent, dot(normal, tangent))));
    }
    // b = n x t, so the ring runs counter-clockwise seen along the tangent,
    // matching the loft's winding.
    const binormal = cross(normal, tangent);
    const r = radiusAt(path.length === 1 ? 0 : i / (path.length - 1));
    const ring: Vec3[] = new Array<Vec3>(segments);
    for (let j = 0; j < segments; j += 1) {
      const theta = (j / segments) * Math.PI * 2;
      ring[j] = add(
        point,
        add(scale(normal, Math.cos(theta) * r), scale(binormal, Math.sin(theta) * r)),
      );
    }
    rings.push(ring);
  }
  return rings;
}
