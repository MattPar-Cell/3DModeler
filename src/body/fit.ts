import type { ConstraintReport, Provenance, ResolvedParam, Unit } from '../core/params.ts';
import { resolve } from '../core/params.ts';
import { clamp, isPositiveFinite } from '../core/math.ts';
import { goldenSectionMinimize } from '../core/optimize.ts';
import * as A from '../constants/anthropometry.ts';
import { BODY_PARAM_SPECS, BODY_MEASUREMENT_KEYS } from './spec.ts';
import type {
  BodyMeasurementKey,
  BodyMeasurements,
  BodyParamKey,
  BodyParams,
} from './spec.ts';
import {
  BODY_REGIONS,
  REGION_LABELS,
  REGION_PARAMS,
  buildBodySegments,
  buildSkeleton,
} from './segments.ts';
import type { BodyRegion, BodySegment, BodyValues, Skeleton } from './segments.ts';
import { measureBody } from './measure.ts';

/**
 * Fitting a body to a partial set of measurements.
 *
 * The model is statistical but not licensed: shape comes from published
 * population ratios (`constants/anthropometry.ts`) rather than from a learned
 * basis, so there is nothing here derived from SMPL or any other encumbered
 * body model.
 *
 * The fit has three stages:
 *
 *  1. **Pin.** Anything measured is used verbatim and never rewritten.
 *  2. **Propagate.** Un-measured circumferences start at their prior, then get
 *     scaled by how far the *measured* circumferences in the same group sit
 *     from theirs. Someone whose chest is 12% above the prior almost certainly
 *     has an above-prior underbust too, and this is what carries that across.
 *  3. **Solve.** One free variable is left — a global scale on the un-measured
 *     circumferences — and it is searched to minimise squared error against the
 *     entered weight, regularised toward the priors. Measured circumferences
 *     are outside the search, so weight can never silently overwrite a tape
 *     measurement.
 */

/** Circumferences that scale together as the torso gets larger. */
const TORSO_GIRTHS: readonly BodyParamKey[] = ['chest', 'waist', 'hip', 'underbust', 'neck'];

/** Circumferences that scale together as the limbs get larger. */
const LIMB_GIRTHS: readonly BodyParamKey[] = [
  'thigh',
  'knee',
  'calf',
  'ankle',
  'bicep',
  'forearm',
  'wrist',
];

/** Prior for every circumference, as a fraction of stature. */
const GIRTH_PRIORS: Record<string, number> = {
  chest: A.CHEST_CIRCUMFERENCE,
  waist: A.WAIST_CIRCUMFERENCE,
  hip: A.HIP_CIRCUMFERENCE,
  underbust: A.UNDERBUST_CIRCUMFERENCE,
  neck: A.NECK_CIRCUMFERENCE,
  thigh: A.THIGH_CIRCUMFERENCE,
  knee: A.KNEE_CIRCUMFERENCE,
  calf: A.CALF_CIRCUMFERENCE,
  ankle: A.ANKLE_CIRCUMFERENCE,
  bicep: A.BICEP_CIRCUMFERENCE,
  forearm: A.FOREARM_CIRCUMFERENCE,
  wrist: A.WRIST_CIRCUMFERENCE,
};

/**
 * Segment-length priors usable to back-solve stature, with a weight reflecting
 * how tightly each tracks height. Long bones scale with stature far more
 * reliably than girths do, which is what makes "body part only" mode work.
 */
const STATURE_FROM_LENGTH: readonly {
  readonly key: BodyMeasurementKey;
  readonly ratio: number;
  readonly weight: number;
}[] = [
  { key: 'inseam', ratio: A.CROTCH_HEIGHT, weight: 3 },
  { key: 'forearmLength', ratio: A.FOREARM_LENGTH, weight: 2 },
];

/** Weaker fallbacks: girths track stature only loosely. */
const STATURE_FROM_GIRTH: readonly {
  readonly key: BodyMeasurementKey;
  readonly ratio: number;
  readonly weight: number;
}[] = [
  { key: 'shoulderWidth', ratio: A.SHOULDER_WIDTH, weight: 2 },
  { key: 'wrist', ratio: A.WRIST_CIRCUMFERENCE, weight: 1 },
  { key: 'chest', ratio: A.CHEST_CIRCUMFERENCE, weight: 0.5 },
  { key: 'hip', ratio: A.HIP_CIRCUMFERENCE, weight: 0.5 },
];

/**
 * How strongly the fit resists moving girths away from the priors.
 *
 * This trades off against relative mass error, so it has a readable meaning:
 * at 0.004, pulling the girths 30% away from the priors costs as much as a 2%
 * error in the reconstructed weight. Set it much higher and an entered weight
 * stops being honoured; set it to zero and a body with no other constraint
 * drifts to whatever girth happens to hit the target.
 */
const PRIOR_REGULARISATION = 0.004;

/** One entry of the fit-quality report. */
export interface Residual {
  readonly key: BodyMeasurementKey;
  readonly label: string;
  readonly unit: Unit;
  /** What the user entered. */
  readonly target: number;
  /** What came back off the generated mesh. */
  readonly reconstructed: number;
  /** reconstructed - target, in the parameter's unit. */
  readonly error: number;
}

/** Confidence rating for one body region. */
export interface RegionConfidence {
  readonly region: BodyRegion;
  readonly label: string;
  readonly provenance: Provenance;
  readonly drivenBy: readonly { readonly key: BodyParamKey; readonly provenance: Provenance }[];
}

export interface BodyFit {
  readonly params: BodyParams;
  readonly values: BodyValues;
  readonly skeleton: Skeleton;
  readonly segments: readonly BodySegment[];
  readonly residuals: readonly Residual[];
  readonly regions: readonly RegionConfidence[];
  readonly constraints: readonly ConstraintReport[];
  /** Weighted sum of squared relative errors across all entered measurements. */
  readonly objective: number;
}

export interface BodyFitInput {
  readonly measurements: BodyMeasurements;
}

function entered(m: BodyMeasurements, key: BodyMeasurementKey): number | undefined {
  const v = m[key];
  return isPositiveFinite(v) ? v : undefined;
}

/** Stature, and where it came from. */
function solveStature(m: BodyMeasurements): {
  value: number;
  provenance: Provenance;
  note?: string;
} {
  const direct = entered(m, 'stature');
  if (direct !== undefined) return { value: direct, provenance: 'measured' };

  const accumulate = (
    sources: readonly { key: BodyMeasurementKey; ratio: number; weight: number }[],
  ): { value: number; weight: number; used: string[] } => {
    let total = 0;
    let weight = 0;
    const used: string[] = [];
    for (const source of sources) {
      const measured = entered(m, source.key);
      if (measured === undefined) continue;
      total += (measured / source.ratio) * source.weight;
      weight += source.weight;
      used.push(BODY_PARAM_SPECS[source.key].label.toLowerCase());
    }
    return { value: weight > 0 ? total / weight : 0, weight, used };
  };

  const fromLengths = accumulate(STATURE_FROM_LENGTH);
  if (fromLengths.weight > 0) {
    return {
      value: fromLengths.value,
      provenance: 'derived',
      note: `Back-solved from ${fromLengths.used.join(' and ')}, which track stature closely.`,
    };
  }

  const fromGirths = accumulate(STATURE_FROM_GIRTH);
  if (fromGirths.weight > 0) {
    return {
      value: fromGirths.value,
      provenance: 'derived',
      note: `Back-solved from ${fromGirths.used.join(', ')}. Girths track stature only loosely, so this is a weak estimate — entering a height will improve everything downstream.`,
    };
  }

  return {
    value: A.DEFAULT_STATURE_CM,
    provenance: 'estimated',
    note: 'Nothing entered constrains height; using the adult population mean.',
  };
}

/**
 * How far the measured members of a girth group sit from their priors, as a
 * geometric mean ratio. Returns `undefined` when nothing in the group was
 * measured.
 */
function groupFactor(
  m: BodyMeasurements,
  stature: number,
  group: readonly BodyParamKey[],
): number | undefined {
  let logSum = 0;
  let count = 0;
  for (const key of group) {
    const prior = GIRTH_PRIORS[key];
    if (prior === undefined) continue;
    const measured = entered(m, key as BodyMeasurementKey);
    if (measured === undefined) continue;
    logSum += Math.log(measured / (prior * stature));
    count += 1;
  }
  return count === 0 ? undefined : Math.exp(logSum / count);
}

/** Assemble the complete numeric parameter set for a given girth scale. */
function assembleValues(
  m: BodyMeasurements,
  stature: number,
  girthScale: number,
  torsoFactor: number,
  limbFactor: number,
): BodyValues {
  const H = stature;
  const girth = (key: BodyParamKey, factor: number): number => {
    const measured = entered(m, key as BodyMeasurementKey);
    if (measured !== undefined) return measured;
    const prior = GIRTH_PRIORS[key] ?? 0;
    return prior * H * factor * girthScale;
  };

  const inseamMeasured = entered(m, 'inseam');
  // The inseam has to leave room for a torso; outside this band the two
  // measurements describe proportions no adult body has.
  const inseam = clamp(inseamMeasured ?? A.CROTCH_HEIGHT * H, 0.36 * H, 0.56 * H);

  const chest = girth('chest', torsoFactor);
  const waist = girth('waist', torsoFactor);

  return {
    stature: H,
    mass: 0, // filled in by the caller once the volume is known
    chest,
    waist,
    hip: girth('hip', torsoFactor),
    // The underbust is interpolated between the two measurements that bracket
    // it rather than taken from its own prior, so it can never land outside
    // them and put a ledge in the ribcage.
    underbust:
      entered(m, 'underbust' as BodyMeasurementKey) ??
      waist + A.UNDERBUST_BLEND * (chest - waist),
    neck: girth('neck', torsoFactor),
    thigh: girth('thigh', limbFactor),
    knee: girth('knee', limbFactor),
    calf: girth('calf', limbFactor),
    ankle: girth('ankle', limbFactor),
    bicep: girth('bicep', limbFactor),
    forearm: girth('forearm', limbFactor),
    wrist: girth('wrist', limbFactor),
    headCircumference: A.HEAD_CIRCUMFERENCE * H,
    shoulderWidth: entered(m, 'shoulderWidth') ?? A.SHOULDER_WIDTH * H,
    hipWidth: A.HIP_WIDTH * H,
    inseam,
    upperArmLength: A.UPPER_ARM_LENGTH * H,
    forearmLength: entered(m, 'forearmLength') ?? A.FOREARM_LENGTH * H,
    handLength: A.HAND_LENGTH * H,
    footLength: A.FOOT_LENGTH * H,
    girthScale,
  };
}

/**
 * The body the priors alone describe at a given stature, with no girth scaling
 * applied. Exposed so the anthropometric pipeline can be checked against
 * outside population data rather than only against itself.
 */
export function priorBody(stature: number): BodyValues {
  const values = assembleValues({}, stature, 1, 1, 1);
  values.mass = measureBody(buildBodySegments(values), buildSkeleton(values)).mass;
  return values;
}

/** Fit a body to whatever the user measured. */
export function fitBody(input: BodyFitInput): BodyFit {
  const m = input.measurements;
  const constraints: ConstraintReport[] = [];

  // --- Stature -------------------------------------------------------------
  const statureSolution = solveStature(m);
  const statureParam = resolve(
    BODY_PARAM_SPECS.stature,
    statureSolution.value,
    statureSolution.provenance,
    statureSolution.note,
  );
  const H = statureParam.value;

  // --- Group propagation ---------------------------------------------------
  const torsoMeasured = groupFactor(m, H, TORSO_GIRTHS);
  const limbMeasured = groupFactor(m, H, LIMB_GIRTHS);
  // A group with nothing measured borrows the other group's build, which is a
  // far better guess than the bare population mean.
  const torsoFactor = torsoMeasured ?? limbMeasured ?? 1;
  const limbFactor = limbMeasured ?? torsoMeasured ?? 1;

  // --- The one free variable: a global scale on un-measured girths ----------
  const massMeasured = entered(m, 'mass');
  const anyGirthMeasured = torsoMeasured !== undefined || limbMeasured !== undefined;

  let targetMass: number | undefined;
  if (massMeasured !== undefined) {
    targetMass = clamp(massMeasured, A.MASS_MIN_KG, A.MASS_MAX_KG);
  } else if (!anyGirthMeasured) {
    // Nothing at all constrains girth, so aim for a body of typical build
    // rather than leaving the priors to compose into something arbitrary.
    targetMass = A.DEFAULT_BMI * (H / 100) ** 2;
  }

  // Volume is corrected for polygon inscription, so a coarse trial mesh gives
  // the same mass as the fine one the viewer shows — the search can afford to
  // run at a quarter of the cost without shifting the answer it converges on.
  const massOf = (girthScale: number): number => {
    const values = assembleValues(m, H, girthScale, torsoFactor, limbFactor);
    const trial = buildBodySegments(values, A.FIT_RADIAL_SEGMENTS);
    return measureBody(trial, buildSkeleton(values)).mass;
  };

  let girthScale = 1;
  let searchIterations = 0;
  if (targetMass !== undefined) {
    const objective = (g: number): number => {
      const relative = (massOf(g) - targetMass) / targetMass;
      return relative * relative + PRIOR_REGULARISATION * Math.log(g) ** 2;
    };
    const result = goldenSectionMinimize(
      objective,
      A.GIRTH_SCALE_MIN,
      A.GIRTH_SCALE_MAX,
      1e-3,
    );
    girthScale = result.x;
    searchIterations = result.iterations;
  }

  // --- Final assembly ------------------------------------------------------
  const values = assembleValues(m, H, girthScale, torsoFactor, limbFactor);
  const skeleton = buildSkeleton(values);
  const segments = buildBodySegments(values);
  const readback = measureBody(segments, skeleton);
  values.mass = readback.mass;

  // --- Provenance ----------------------------------------------------------
  const girthProvenance = (key: BodyParamKey, group: readonly BodyParamKey[]): Provenance => {
    if (entered(m, key as BodyMeasurementKey) !== undefined) return 'measured';
    const ownGroup = group === TORSO_GIRTHS ? torsoMeasured : limbMeasured;
    // Derived when something *directly comparable* informed it: another
    // measurement in the same group, or the entered weight. A factor borrowed
    // from the other group (a chest measurement standing in for a calf) is a
    // much weaker inference, so it stays estimated rather than dressing a
    // guess up as a derivation.
    if (ownGroup !== undefined || massMeasured !== undefined) return 'derived';
    return 'estimated';
  };

  const lengthProvenance: Provenance =
    statureParam.provenance === 'estimated' ? 'estimated' : 'derived';

  const note = (key: BodyParamKey, group: readonly BodyParamKey[]): string | undefined => {
    if (entered(m, key as BodyMeasurementKey) !== undefined) return undefined;
    const factor = group === TORSO_GIRTHS ? torsoFactor : limbFactor;
    const total = factor * girthScale;
    if (Math.abs(total - 1) < 0.005) return 'Population prior for this stature.';
    return `Population prior for this stature, scaled ${total > 1 ? 'up' : 'down'} to ${(total * 100).toFixed(0)}% by the measurements you gave.`;
  };

  const girthParam = (key: BodyParamKey, group: readonly BodyParamKey[]): ResolvedParam =>
    resolve(BODY_PARAM_SPECS[key], values[key], girthProvenance(key, group), note(key, group));

  const params: { [K in BodyParamKey]: ResolvedParam } = {
    stature: statureParam,
    mass: resolve(
      BODY_PARAM_SPECS.mass,
      values.mass,
      massMeasured !== undefined ? 'measured' : 'derived',
      massMeasured !== undefined
        ? undefined
        : 'Implied by the reconstructed volume at a body density of 1.01 kg/L.',
    ),
    chest: girthParam('chest', TORSO_GIRTHS),
    waist: girthParam('waist', TORSO_GIRTHS),
    hip: girthParam('hip', TORSO_GIRTHS),
    underbust: girthParam('underbust', TORSO_GIRTHS),
    neck: girthParam('neck', TORSO_GIRTHS),
    thigh: girthParam('thigh', LIMB_GIRTHS),
    knee: girthParam('knee', LIMB_GIRTHS),
    calf: girthParam('calf', LIMB_GIRTHS),
    ankle: girthParam('ankle', LIMB_GIRTHS),
    bicep: girthParam('bicep', LIMB_GIRTHS),
    forearm: girthParam('forearm', LIMB_GIRTHS),
    wrist: girthParam('wrist', LIMB_GIRTHS),
    headCircumference: resolve(
      BODY_PARAM_SPECS.headCircumference,
      values.headCircumference,
      lengthProvenance,
    ),
    shoulderWidth: resolve(
      BODY_PARAM_SPECS.shoulderWidth,
      values.shoulderWidth,
      entered(m, 'shoulderWidth') !== undefined ? 'measured' : lengthProvenance,
    ),
    hipWidth: resolve(BODY_PARAM_SPECS.hipWidth, values.hipWidth, lengthProvenance),
    inseam: resolve(
      BODY_PARAM_SPECS.inseam,
      values.inseam,
      entered(m, 'inseam') !== undefined ? 'measured' : lengthProvenance,
      values.inseam !== entered(m, 'inseam') && entered(m, 'inseam') !== undefined
        ? 'Adjusted to leave room for a torso at this height.'
        : undefined,
    ),
    upperArmLength: resolve(
      BODY_PARAM_SPECS.upperArmLength,
      values.upperArmLength,
      lengthProvenance,
    ),
    forearmLength: resolve(
      BODY_PARAM_SPECS.forearmLength,
      values.forearmLength,
      entered(m, 'forearmLength') !== undefined ? 'measured' : lengthProvenance,
    ),
    handLength: resolve(BODY_PARAM_SPECS.handLength, values.handLength, lengthProvenance),
    footLength: resolve(BODY_PARAM_SPECS.footLength, values.footLength, lengthProvenance),
    girthScale: resolve(
      BODY_PARAM_SPECS.girthScale,
      girthScale,
      targetMass === undefined ? 'estimated' : massMeasured !== undefined ? 'derived' : 'estimated',
      targetMass === undefined
        ? 'Left at 1.0: the measurements you gave already determine the girths.'
        : `Searched in ${searchIterations} evaluations to match the target mass.`,
    ),
  };

  // --- Residuals: measured against the mesh, not against the parameters -----
  const readbackByKey: Record<BodyMeasurementKey, number | undefined> = {
    stature: readback.stature,
    mass: readback.mass,
    chest: readback.chest,
    waist: readback.waist,
    hip: readback.hip,
    inseam: readback.inseam,
    shoulderWidth: readback.shoulderWidth,
    neck: readback.neck,
    thigh: readback.thigh,
    bicep: readback.bicep,
    forearmLength: readback.forearmLength,
    wrist: readback.wrist,
  };

  const residuals: Residual[] = [];
  let objective = 0;
  for (const key of BODY_MEASUREMENT_KEYS) {
    const target = entered(m, key);
    const reconstructed = readbackByKey[key];
    if (target === undefined || reconstructed === undefined) continue;
    const spec = BODY_PARAM_SPECS[key];
    residuals.push({
      key,
      label: spec.label,
      unit: spec.unit,
      target,
      reconstructed,
      error: reconstructed - target,
    });
    const relative = (reconstructed - target) / target;
    objective += relative * relative;
  }

  // --- Region confidence ---------------------------------------------------
  // A region reads `measured` when the user gave a direct measurement of it,
  // `derived` when its parameters were computed from measurements elsewhere,
  // and `estimated` when it rests on population priors alone. The per-parameter
  // breakdown travels with it in `drivenBy`, so the UI can show that a
  // "measured" chest still has an inferred underbust behind it.
  const regions: RegionConfidence[] = BODY_REGIONS.map((region) => {
    const drivenBy = REGION_PARAMS[region].map((key) => ({
      key,
      provenance: params[key].provenance,
    }));
    let provenance: Provenance = 'estimated';
    if (drivenBy.some((item) => item.provenance === 'measured')) provenance = 'measured';
    else if (drivenBy.some((item) => item.provenance === 'derived')) provenance = 'derived';
    return { region, label: REGION_LABELS[region], provenance, drivenBy };
  });

  // --- Constraint reports --------------------------------------------------
  const measuredInseam = entered(m, 'inseam');
  constraints.push({
    id: 'inseam-leaves-a-torso',
    description: 'Inseam is between 36% and 56% of stature.',
    satisfied: measuredInseam === undefined || Math.abs(values.inseam - measuredInseam) < 1e-6,
    ...(measuredInseam !== undefined && Math.abs(values.inseam - measuredInseam) >= 1e-6
      ? {
          resolution: `Entered inseam ${measuredInseam.toFixed(1)} cm was moved to ${values.inseam.toFixed(1)} cm; outside that band the pair describes proportions no adult body has.`,
        }
      : {}),
  });

  const girthErrors = residuals.filter(
    (r) => r.unit === 'cm' && r.key !== 'stature' && r.key !== 'inseam',
  );
  const worstGirthError = girthErrors.reduce((worst, r) => Math.max(worst, Math.abs(r.error)), 0);
  constraints.push({
    id: 'measurements-reproduced',
    description: 'Every entered circumference and length is reproduced by the mesh.',
    satisfied: worstGirthError < 0.5,
    ...(worstGirthError >= 0.5
      ? { resolution: `Largest deviation is ${worstGirthError.toFixed(2)} cm.` }
      : {}),
  });

  const massResidual = residuals.find((r) => r.key === 'mass');
  if (massResidual !== undefined) {
    const relative = Math.abs(massResidual.error) / massResidual.target;
    constraints.push({
      id: 'mass-matched',
      description: 'Reconstructed volume matches the entered weight.',
      satisfied: relative < 0.02,
      ...(relative >= 0.02
        ? {
            resolution: `Off by ${massResidual.error > 0 ? '+' : ''}${massResidual.error.toFixed(1)} kg. The measured circumferences pin most of the volume, so there is not enough freedom left to close the gap — one of the measurements and the weight disagree.`,
          }
        : {}),
    });
  }

  return {
    params,
    values,
    skeleton,
    segments,
    residuals,
    regions,
    constraints,
    objective,
  };
}
