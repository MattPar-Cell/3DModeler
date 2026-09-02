/**
 * Small numeric helpers shared by the object templates and the body fitter.
 * Everything here is pure and side-effect free so it can be unit tested
 * under `node --test` without a DOM or a WebGL context.
 */

/** Clamp `v` into the inclusive range [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Linear interpolation. `t` is not clamped. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse of {@link lerp}: where does `v` sit between `a` and `b`? */
export function inverseLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** Map `v` from one range to another, clamped to the destination range. */
export function remapClamped(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return clamp(lerp(outMin, outMax, inverseLerp(inMin, inMax, v)), Math.min(outMin, outMax), Math.max(outMin, outMax));
}

/** Hermite smoothstep on [0,1]. */
export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Circumference of a circle from its diameter. */
export function circumferenceFromDiameter(diameter: number): number {
  return Math.PI * diameter;
}

/** Diameter of a circle from its circumference. */
export function diameterFromCircumference(circumference: number): number {
  return circumference / Math.PI;
}

/**
 * Perimeter of an ellipse with semi-axes `a` and `b`.
 * Ramanujan's second approximation — relative error < 1e-5 for the
 * eccentricities body cross-sections actually reach (b/a down to ~0.5).
 */
export function ellipsePerimeter(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/**
 * Solve for the semi-axes of an ellipse with a known `perimeter` and a known
 * ratio `b/a`. Inverts {@link ellipsePerimeter} by bisection; the perimeter is
 * strictly increasing in `a` at fixed ratio, so bisection always converges.
 */
export function ellipseAxesFromPerimeter(
  perimeter: number,
  ratio: number,
): { a: number; b: number } {
  if (perimeter <= 0) return { a: 0, b: 0 };
  const r = clamp(ratio, 0.05, 20);
  let lo = 0;
  let hi = perimeter; // perimeter >= 4a, so a < perimeter is a safe upper bound
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (ellipsePerimeter(mid, mid * r) < perimeter) lo = mid;
    else hi = mid;
  }
  const a = (lo + hi) / 2;
  return { a, b: a * r };
}

/** Sum of squared differences, ignoring pairs where the target is undefined. */
export function sumSquaredError(pairs: ReadonlyArray<readonly [number, number | undefined]>): number {
  let total = 0;
  for (const [actual, target] of pairs) {
    if (target === undefined) continue;
    const d = actual - target;
    total += d * d;
  }
  return total;
}

/** True when `v` is a usable finite number greater than zero. */
export function isPositiveFinite(v: number | undefined | null): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}
