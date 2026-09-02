/**
 * The parameter model that the whole app is organised around.
 *
 * Nothing in this project stores geometry. It stores a small record of named,
 * unit-carrying numbers plus where each number came from, and regenerates the
 * mesh from that record on every change. `Provenance` is what lets the UI and
 * the 3D viewer distinguish a dimension the user actually measured from one
 * the app inferred.
 */

/** Where a parameter's current value came from. */
export type Provenance =
  /** Entered directly by the user. Treated as ground truth by every solver. */
  | 'measured'
  /**
   * Read off a photograph by the scanner.
   *
   * An observation of this specific object, so the solvers pin it exactly as
   * they pin a typed measurement — but it carries the error of a silhouette
   * read through a lens, which a tape does not, so it is reported separately
   * rather than quietly promoted to `measured`.
   */
  | 'scanned'
  /** Computed from observed values via a template ratio or a fitted model. */
  | 'derived'
  /** Filled in from a population prior because nothing constrains it. */
  | 'estimated';

/**
 * True when the value came from this specific object rather than from a
 * calculation or a population. Both kinds of observation are pinned by the
 * solvers and never rewritten to satisfy a constraint.
 */
export function isObserved(provenance: Provenance): boolean {
  return provenance === 'measured' || provenance === 'scanned';
}

/** Confidence order, most certain first. */
const PROVENANCE_RANK: Record<Provenance, number> = {
  measured: 0,
  scanned: 1,
  derived: 2,
  estimated: 3,
};

/** The least certain of the given provenances. */
export function worstProvenance(values: readonly Provenance[]): Provenance {
  let worst: Provenance = 'measured';
  for (const value of values) {
    if (PROVENANCE_RANK[value] > PROVENANCE_RANK[worst]) worst = value;
  }
  return worst;
}

/** How a measurement reached the app. */
export type MeasurementSource = 'manual' | 'scanned';

/** Per-key record of how each measurement was obtained. */
export type Sources<K extends string> = { readonly [P in K]?: MeasurementSource };

/** The provenance an observed value should carry, given how it arrived. */
export function observedProvenance(source: MeasurementSource | undefined): Provenance {
  return source === 'scanned' ? 'scanned' : 'measured';
}

/** Physical unit of a parameter. The app is metric end to end. */
export type Unit = 'cm' | 'kg' | 'deg' | 'ratio';

/**
 * The static description of a parameter: everything needed to render an input
 * for it, validate it, and document it. One of these exists per parameter, and
 * the code-quality rule "every parameter documented" is enforced by the fact
 * that a parameter cannot be declared without filling this in.
 */
export interface ParamSpec {
  /** Stable machine key, unique within its template. */
  readonly key: string;
  /** Human label for the sidebar. */
  readonly label: string;
  readonly unit: Unit;
  /** Lowest value considered physically plausible. Inputs clamp to this. */
  readonly min: number;
  /** Highest value considered physically plausible. Inputs clamp to this. */
  readonly max: number;
  /** What the number means, and where the plausible range comes from. */
  readonly description: string;
  /** Step for the numeric input. */
  readonly step?: number;
}

/** A parameter's resolved value together with its provenance. */
export interface ResolvedParam {
  readonly spec: ParamSpec;
  readonly value: number;
  readonly provenance: Provenance;
  /** Set when the solver had to move the value to satisfy a constraint. */
  readonly note?: string;
}

/** A full solved parameter set, keyed by {@link ParamSpec.key}. */
export type ParamSet<K extends string> = { readonly [P in K]: ResolvedParam };

/** A user-supplied measurement set: any subset of the keys, all optional. */
export type Measurements<K extends string> = { readonly [P in K]?: number };

/** Build a {@link ResolvedParam}, clamping into the spec's plausible range. */
export function resolve(
  spec: ParamSpec,
  value: number,
  provenance: Provenance,
  note?: string,
): ResolvedParam {
  const clamped = Math.min(Math.max(value, spec.min), spec.max);
  const clampNote =
    clamped !== value
      ? `Clamped to the plausible range ${spec.min}–${spec.max}${spec.unit === 'ratio' ? '' : ` ${spec.unit}`}.`
      : undefined;
  const merged = [note, clampNote].filter((n): n is string => n !== undefined).join(' ');
  return merged.length > 0
    ? { spec, value: clamped, provenance, note: merged }
    : { spec, value: clamped, provenance };
}

/** Convenience: pull the plain numbers out of a solved set. */
export function valuesOf<K extends string>(set: ParamSet<K>): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const key of Object.keys(set) as K[]) {
    out[key] = set[key].value;
  }
  return out;
}

/** A constraint the solver checked while resolving a parameter set. */
export interface ConstraintReport {
  readonly id: string;
  /** Plain-English statement of the rule. */
  readonly description: string;
  readonly satisfied: boolean;
  /** How the solver repaired the violation, when it did. */
  readonly resolution?: string;
}
