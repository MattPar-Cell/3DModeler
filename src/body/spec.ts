import type { Measurements, ParamSet, ParamSpec } from '../core/params.ts';
import * as A from '../constants/anthropometry.ts';

/**
 * The body model's parameter vocabulary.
 *
 * Measurement keys are a strict subset of parameter keys, so a measurement is
 * literally "a parameter the user pinned". Everything else is fitted or taken
 * from the priors in `constants/anthropometry.ts`.
 */

/** Measurements the sidebar accepts. Every one is optional. */
export type BodyMeasurementKey =
  | 'stature'
  | 'mass'
  | 'chest'
  | 'underbust'
  | 'waist'
  | 'hip'
  | 'inseam'
  | 'shoulderWidth'
  | 'neck'
  | 'thigh'
  | 'bicep'
  | 'forearmLength'
  | 'wrist';

/** Every parameter the body builder needs. */
export type BodyParamKey =
  | BodyMeasurementKey
  | 'knee'
  | 'calf'
  | 'ankle'
  | 'forearm'
  | 'headCircumference'
  | 'hipWidth'
  | 'upperArmLength'
  | 'handLength'
  | 'footLength'
  | 'girthScale';

export type BodyMeasurements = Measurements<BodyMeasurementKey>;
export type BodyParams = ParamSet<BodyParamKey>;

/** Sidebar grouping. Order is the order the fields are rendered in. */
export const BODY_MEASUREMENT_GROUPS: readonly {
  readonly title: string;
  readonly keys: readonly BodyMeasurementKey[];
}[] = [
  { title: 'Overall', keys: ['stature', 'mass'] },
  { title: 'Torso', keys: ['chest', 'underbust', 'waist', 'hip', 'neck', 'shoulderWidth'] },
  { title: 'Limbs', keys: ['inseam', 'thigh', 'bicep', 'forearmLength', 'wrist'] },
];

export const BODY_MEASUREMENT_KEYS: readonly BodyMeasurementKey[] =
  BODY_MEASUREMENT_GROUPS.flatMap((group) => group.keys);

/**
 * Every body parameter: label, unit, plausible range and meaning. Ranges are
 * generous adult bounds — roughly the 0.1st to 99.9th percentile of the
 * populations cited in `constants/anthropometry.ts`, widened where the
 * measurement is one people commonly take loosely.
 */
export const BODY_PARAM_SPECS: { readonly [K in BodyParamKey]: ParamSpec } = {
  stature: {
    key: 'stature',
    label: 'Height',
    unit: 'cm',
    min: A.STATURE_MIN_CM,
    max: A.STATURE_MAX_CM,
    step: 0.5,
    description:
      'Standing height, floor to the top of the head. The single most useful measurement: every segment length prior is a fraction of it.',
  },
  mass: {
    key: 'mass',
    label: 'Weight',
    unit: 'kg',
    min: A.MASS_MIN_KG,
    max: A.MASS_MAX_KG,
    step: 0.5,
    description:
      'Body mass. Constrains total volume, so it pulls every un-measured circumference toward the right girth at once.',
  },
  chest: {
    key: 'chest',
    label: 'Chest / bust',
    unit: 'cm',
    min: 55,
    max: 175,
    step: 0.5,
    description: 'Circumference around the fullest part of the chest, at nipple height.',
  },
  waist: {
    key: 'waist',
    label: 'Waist',
    unit: 'cm',
    min: 45,
    max: 190,
    step: 0.5,
    description:
      'Circumference at the natural waist — the narrowest point, roughly at elbow height, not at the trouser line.',
  },
  hip: {
    key: 'hip',
    label: 'Hip',
    unit: 'cm',
    min: 60,
    max: 190,
    step: 0.5,
    description: 'Circumference around the widest point of the hips and buttocks.',
  },
  inseam: {
    key: 'inseam',
    label: 'Inseam',
    unit: 'cm',
    min: 50,
    max: 110,
    step: 0.5,
    description:
      'Crotch to floor. Fixes the leg length directly; the torso then absorbs whatever height is left over.',
  },
  shoulderWidth: {
    key: 'shoulderWidth',
    label: 'Shoulder width',
    unit: 'cm',
    min: 28,
    max: 60,
    step: 0.5,
    description: 'Biacromial breadth — straight across the back, shoulder point to shoulder point.',
  },
  neck: {
    key: 'neck',
    label: 'Neck',
    unit: 'cm',
    min: 25,
    max: 60,
    step: 0.5,
    description: 'Circumference at the base of the neck, just above where it meets the shoulders.',
  },
  thigh: {
    key: 'thigh',
    label: 'Thigh',
    unit: 'cm',
    min: 35,
    max: 95,
    step: 0.5,
    description: 'Circumference of the upper thigh, taken just below the gluteal fold.',
  },
  bicep: {
    key: 'bicep',
    label: 'Upper arm',
    unit: 'cm',
    min: 18,
    max: 60,
    step: 0.5,
    description: 'Circumference around the relaxed upper arm at its fullest.',
  },
  forearmLength: {
    key: 'forearmLength',
    label: 'Forearm length',
    unit: 'cm',
    min: 15,
    max: 40,
    step: 0.5,
    description:
      'Elbow to wrist. A reliable stand-in for height when nothing else is available, since forearm length is about 14.6% of stature.',
  },
  wrist: {
    key: 'wrist',
    label: 'Wrist',
    unit: 'cm',
    min: 12,
    max: 26,
    step: 0.5,
    description:
      'Minimum circumference just below the wrist bone. Barely affected by body fat, which makes it a good frame-size indicator.',
  },
  underbust: {
    key: 'underbust',
    label: 'Underbust',
    unit: 'cm',
    min: 50,
    max: 165,
    step: 0.5,
    description:
      'Circumference of the ribcage directly under the bust. Optional, and the single most useful extra measurement on a fuller figure: the difference between it and the chest is what tells the model a bust from a broad ribcage.',
  },
  knee: {
    key: 'knee',
    label: 'Knee',
    unit: 'cm',
    min: 25,
    max: 65,
    step: 0.5,
    description: 'Circumference around the knee joint.',
  },
  calf: {
    key: 'calf',
    label: 'Calf',
    unit: 'cm',
    min: 22,
    max: 65,
    step: 0.5,
    description: 'Maximum circumference of the calf.',
  },
  ankle: {
    key: 'ankle',
    label: 'Ankle',
    unit: 'cm',
    min: 15,
    max: 38,
    step: 0.5,
    description: 'Minimum circumference above the ankle bone.',
  },
  forearm: {
    key: 'forearm',
    label: 'Forearm',
    unit: 'cm',
    min: 16,
    max: 45,
    step: 0.5,
    description: 'Maximum circumference of the forearm, below the elbow.',
  },
  headCircumference: {
    key: 'headCircumference',
    label: 'Head',
    unit: 'cm',
    min: 45,
    max: 68,
    step: 0.5,
    description: 'Circumference around the widest part of the skull.',
  },
  hipWidth: {
    key: 'hipWidth',
    label: 'Hip width',
    unit: 'cm',
    min: 20,
    max: 50,
    step: 0.5,
    description: 'Bi-iliac breadth — the skeletal width across the pelvis, which sets hip joint spacing.',
  },
  upperArmLength: {
    key: 'upperArmLength',
    label: 'Upper arm length',
    unit: 'cm',
    min: 20,
    max: 45,
    step: 0.5,
    description: 'Shoulder joint to elbow joint.',
  },
  handLength: {
    key: 'handLength',
    label: 'Hand length',
    unit: 'cm',
    min: 12,
    max: 26,
    step: 0.5,
    description: 'Wrist to fingertip.',
  },
  footLength: {
    key: 'footLength',
    label: 'Foot length',
    unit: 'cm',
    min: 18,
    max: 36,
    step: 0.5,
    description: 'Heel to toe.',
  },
  girthScale: {
    key: 'girthScale',
    label: 'Girth scale',
    unit: 'ratio',
    min: A.GIRTH_SCALE_MIN,
    max: A.GIRTH_SCALE_MAX,
    step: 0.01,
    description:
      'The one free variable of the fit: a global multiplier on every un-measured circumference, searched so the reconstructed volume matches the entered weight. 1.0 means the priors were left alone.',
  },
};

/**
 * An example measurement set for the "Load example" button: a 178 cm adult of
 * average build. The five values are mutually consistent, so the fit converges
 * with the girth scale near 1.0 and the inferred girths land on believable
 * numbers — a good demonstration of what the report looks like when the input
 * agrees with itself.
 */
export const BODY_EXAMPLE_MEASUREMENTS: BodyMeasurements = {
  stature: 178,
  mass: 82,
  chest: 100,
  waist: 84,
  hip: 99,
};
