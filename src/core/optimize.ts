/**
 * Golden-section search: minimise a one-dimensional, unimodal function without
 * derivatives.
 *
 * The body fit reduces to exactly this. Once the measured values are pinned,
 * one free variable is left — a global scale on the un-measured circumferences —
 * and the objective (weighted squared error against the entered weight, plus a
 * penalty for straying from the anthropometric priors) is unimodal in it.
 */
export interface MinimizeResult {
  /** The minimising argument. */
  readonly x: number;
  /** The objective value there. */
  readonly value: number;
  readonly iterations: number;
}

const INVERSE_PHI = (Math.sqrt(5) - 1) / 2;

/**
 * @param objective Function to minimise. Must be unimodal on [lo, hi].
 * @param lo Lower bound of the search bracket.
 * @param hi Upper bound of the search bracket.
 * @param tolerance Absolute width of the final bracket.
 */
export function goldenSectionMinimize(
  objective: (x: number) => number,
  lo: number,
  hi: number,
  tolerance = 1e-4,
): MinimizeResult {
  let a = Math.min(lo, hi);
  let b = Math.max(lo, hi);
  let c = b - (b - a) * INVERSE_PHI;
  let d = a + (b - a) * INVERSE_PHI;
  let fc = objective(c);
  let fd = objective(d);
  let iterations = 2;

  // 100 iterations is far more than the bracket ever needs; the tolerance test
  // is what actually stops the loop.
  while (b - a > tolerance && iterations < 100) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - (b - a) * INVERSE_PHI;
      fc = objective(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + (b - a) * INVERSE_PHI;
      fd = objective(d);
    }
    iterations += 1;
  }

  const x = (a + b) / 2;
  return { x, value: objective(x), iterations: iterations + 1 };
}
