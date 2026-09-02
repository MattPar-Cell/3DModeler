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
  /** Computed from measured values via a template ratio or a fitted model. */
  | 'derived'
  /** Filled in from a population prior because nothing constrains it. */
  | 'estimated';

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
