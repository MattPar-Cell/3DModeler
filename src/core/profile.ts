import type { Ring, Vec3 } from './loft.ts';
import { lerp, smoothstep } from './math.ts';

/**
 * Ring generators. A "profile" is the radius (or half-axes) of a cross-section
 * as a function of height; sampling it produces the {@link Ring} stack that
 * {@link import('./loft.ts').loftGeometry} turns into a surface.
 */

/**
 * A circular ring of `segments` points at height `y`, centred on `centre`.
 * Points run counter-clockwise seen from +Y, matching the loft's winding.
 */
export function circleRing(
  radius: number,
  y: number,
  segments: number,
  centre: { x: number; z: number } = { x: 0, z: 0 },
): Ring {
  const points: Vec3[] = new Array<Vec3>(segments);
  for (let j = 0; j < segments; j += 1) {
    const theta = (j / segments) * Math.PI * 2;
    points[j] = {
      x: centre.x + Math.cos(theta) * radius,
      y,
      z: centre.z + Math.sin(theta) * radius,
    };
  }
  return points;
}

/**
 * A super-ellipse ring: |x/a|^n + |z/b|^n = 1.
 *
 * `n = 2` is a plain ellipse. Human cross-sections are measurably flatter than
 * ellipses at the waist and rounder at the limbs, so body segments sample this
 * with `n` between about 2.0 and 2.8 — the "squareness" exponent.
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
  const points: Vec3[] = new Array<Vec3>(segments);
  const e = 2 / Math.max(n, 0.2);
  for (let j = 0; j < segments; j += 1) {
    const theta = (j / segments) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    points[j] = {
      x: centre.x + Math.sign(c) * Math.abs(c) ** e * a,
      y,
      z: centre.z + Math.sign(s) * Math.abs(s) ** e * b,
    };
  }
  return points;
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
 * `rows` is the number of rings, so the surface has `rows - 1` quad bands.
 */
export function revolveProfile(
  points: readonly ProfilePoint[],
  y0: number,
  y1: number,
  rows: number,
  segments: number,
): Ring[] {
  const rings: Ring[] = new Array<Ring>(rows);
  for (let i = 0; i < rows; i += 1) {
    const t = rows === 1 ? 0 : i / (rows - 1);
    rings[i] = circleRing(sampleProfile(points, t), lerp(y0, y1, t), segments);
  }
  return rings;
}

/**
 * Perimeter of a unit super-ellipse (semi-axis `a` = 1, `b` = `ratio`).
 *
 * A super-ellipse has no closed-form perimeter, so this integrates the sampled
 * polygon. Perimeter is linear in `a` at fixed `ratio` and `n`, which is what
 * makes {@link superellipseRingForCircumference} exact: scale by the target
 * circumference over this value and the ring's perimeter *is* the target.
 */
const unitPerimeterCache = new Map<string, number>();

export function superellipseUnitPerimeter(ratio: number, n: number, samples = 512): number {
  // The body fitter evaluates this thousands of times inside its search loop,
  // almost always for the same handful of (ratio, n) pairs.
  const cacheKey = `${ratio}|${n}|${samples}`;
  const cached = unitPerimeterCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const ring = superellipseRing(1, ratio, n, 0, samples);
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    if (p === undefined || q === undefined) continue;
    total += Math.hypot(q.x - p.x, q.z - p.z);
  }
  unitPerimeterCache.set(cacheKey, total);
  return total;
}

/**
 * A super-ellipse ring whose perimeter equals `circumference`.
 *
 * This is how a tape-measure reading becomes geometry: the user's chest
 * circumference is reproduced exactly (to polygon discretisation), while the
 * cross-section's *shape* — how much wider than deep it is, and how far from
 * elliptical — comes from the anthropometric priors.
 *
 * @param circumference Target perimeter, cm.
 * @param ratio Depth / width of the cross-section.
 * @param n Super-ellipse squareness exponent.
 */
export function superellipseRingForCircumference(
  circumference: number,
  ratio: number,
  n: number,
  y: number,
  segments: number,
  centre: { x: number; z: number } = { x: 0, z: 0 },
): Ring {
  if (circumference <= 0) return circleRing(0, y, segments, centre);
  // Measure the unit perimeter at the ring's own resolution, so the polygon we
  // actually emit has the requested perimeter rather than its smooth limit.
  const a = circumference / superellipseUnitPerimeter(ratio, n, segments);
  return superellipseRing(a, a * ratio, n, y, segments, centre);
}

/** Perimeter of a ring's polygon, projected onto the XZ plane. */
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
