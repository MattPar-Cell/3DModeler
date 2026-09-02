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

/**
 * Monotone cubic interpolation (Fritsch-Carlson).
 *
 * Returns a function that passes exactly through every control point, is smooth
 * between them, and — crucially — never overshoots the data.
 *
 * This replaced per-span smoothstep for both the lamp profiles and the body
 * ones. Smoothstep forces the slope to zero at *every* control point, so a
 * profile through eight control sections came out as eight plateaus joined by
 * ramps, which reads on a curved surface like a head as a stack of visible
 * bands. Plain cubic splines fix the banding but overshoot, which on a body
 * means a bulge just above a measured chest that is wider than the chest
 * itself. Monotone cubic gives the smoothness without ever exceeding a
 * measurement.
 *
 * @param xs Strictly increasing control positions.
 * @param ys Values at those positions.
 */
export function monotoneCubicAt(
  xs: readonly number[],
  ys: readonly number[],
): (x: number) => number {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return () => 0;
  if (n === 1) return () => ys[0] ?? 0;

  const h = new Array<number>(n - 1);
  const secant = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i += 1) {
    const dx = (xs[i + 1] ?? 0) - (xs[i] ?? 0);
    h[i] = dx;
    secant[i] = dx === 0 ? 0 : ((ys[i + 1] ?? 0) - (ys[i] ?? 0)) / dx;
  }

  // Initial tangents: the average of the neighbouring secants, except at a
  // local extremum — where the secants change sign — which must be flat, or
  // the curve sails past the peak value on its way through it.
  const tangent = new Array<number>(n);
  tangent[0] = secant[0] ?? 0;
  tangent[n - 1] = secant[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i += 1) {
    const before = secant[i - 1] ?? 0;
    const after = secant[i] ?? 0;
    tangent[i] = before * after <= 0 ? 0 : (before + after) / 2;
  }

  // Fritsch-Carlson limiter: clamp tangents into the circle of radius 3 so no
  // span can overshoot the values that bracket it.
  for (let i = 0; i < n - 1; i += 1) {
    const d = secant[i] ?? 0;
    if (d === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const alpha = (tangent[i] ?? 0) / d;
    const beta = (tangent[i + 1] ?? 0) / d;
    const magnitude = alpha * alpha + beta * beta;
    if (magnitude > 9) {
      const tau = 3 / Math.sqrt(magnitude);
      tangent[i] = tau * alpha * d;
      tangent[i + 1] = tau * beta * d;
    }
  }

  return (x: number): number => {
    if (x <= (xs[0] ?? 0)) return ys[0] ?? 0;
    if (x >= (xs[n - 1] ?? 0)) return ys[n - 1] ?? 0;
    let i = 0;
    while (i < n - 2 && x > (xs[i + 1] ?? 0)) i += 1;
    const span = h[i] ?? 1;
    const s = span === 0 ? 0 : (x - (xs[i] ?? 0)) / span;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * (ys[i] ?? 0) +
      (s3 - 2 * s2 + s) * span * (tangent[i] ?? 0) +
      (-2 * s3 + 3 * s2) * (ys[i + 1] ?? 0) +
      (s3 - s2) * span * (tangent[i + 1] ?? 0)
    );
  };
}

/**
 * {@link monotoneCubicAt} for evenly spaced values, parameterised by index.
 */
export function monotoneCubic(values: readonly number[]): (t: number) => number {
  return monotoneCubicAt(
    values.map((_, i) => i),
    values,
  );
}
