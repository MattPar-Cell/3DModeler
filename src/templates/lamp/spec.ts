import type { Measurements, ParamSet, ParamSpec } from '../../core/params.ts';

/**
 * The lamp template's parameter vocabulary.
 *
 * A template is a *typed recipe*: a list of named parts, each a revolved
 * primitive whose shape is fully determined by the parameters below, plus the
 * cross-part constraints in `solve.ts`. Add a parameter here and it becomes
 * documented, range-checked and renderable automatically.
 */

/** The measurements a user is asked for in the sidebar. */
export type LampMeasurementKey =
  | 'totalHeight'
  | 'baseDiameter'
  | 'shadeDiameter'
  | 'stemDiameter';

/** Every parameter the geometry builder needs. */
export type LampParamKey =
  | LampMeasurementKey
  | 'baseHeight'
  | 'baseTopDiameter'
  | 'stemHeight'
  | 'stemBelly'
  | 'socketHeight'
  | 'socketDiameter'
  | 'shadeHeight'
  | 'shadeTopDiameter'
  | 'finialHeight';

export type LampMeasurements = Measurements<LampMeasurementKey>;
export type LampParams = ParamSet<LampParamKey>;

/** Order the sidebar renders the measurement inputs in. */
export const LAMP_MEASUREMENT_KEYS: readonly LampMeasurementKey[] = [
  'totalHeight',
  'baseDiameter',
  'shadeDiameter',
  'stemDiameter',
];

/**
 * Static description of every lamp parameter: unit, plausible range and what
 * the number means. Ranges bracket real table and floor lamps; the solver
 * clamps into them, so an out-of-range entry is corrected and annotated rather
 * than producing degenerate geometry.
 */
export const LAMP_PARAM_SPECS: { readonly [K in LampParamKey]: ParamSpec } = {
  totalHeight: {
    key: 'totalHeight',
    label: 'Total height',
    unit: 'cm',
    min: 15,
    max: 200,
    step: 0.5,
    description:
      'Floor/table surface to the very top of the lamp, finial included — what a tape measure gives. 15 cm covers small accent lamps, 200 cm the tallest floor lamps.',
  },
  baseDiameter: {
    key: 'baseDiameter',
    label: 'Base diameter',
    unit: 'cm',
    min: 4,
    max: 60,
    step: 0.5,
    description:
      'Widest diameter of the base where it meets the table. Sets the lamp’s footprint and stability.',
  },
  shadeDiameter: {
    key: 'shadeDiameter',
    label: 'Shade diameter (bottom)',
    unit: 'cm',
    min: 8,
    max: 90,
    step: 0.5,
    description:
      'Diameter of the shade’s lower opening — the number printed on replacement shades. Constrained to be at least the base diameter.',
  },
  stemDiameter: {
    key: 'stemDiameter',
    label: 'Stem diameter',
    unit: 'cm',
    min: 0.6,
    max: 20,
    step: 0.1,
    description:
      'Diameter of the column between base and socket, at its narrowest. Thin metal stems sit near 1 cm; turned ceramic near 6 cm.',
  },
  baseHeight: {
    key: 'baseHeight',
    label: 'Base height',
    unit: 'cm',
    min: 0.5,
    max: 60,
    step: 0.5,
    description:
      'Height of the base part alone. Derived as a fraction of total height; part of the height sum constraint.',
  },
  baseTopDiameter: {
    key: 'baseTopDiameter',
    label: 'Base top diameter',
    unit: 'cm',
    min: 1,
    max: 60,
    step: 0.5,
    description:
      'Diameter where the base meets the stem. Must be at least the stem diameter or the stem would float wider than its seat.',
  },
  stemHeight: {
    key: 'stemHeight',
    label: 'Stem height',
    unit: 'cm',
    min: 1,
    max: 190,
    step: 0.5,
    description:
      'Height of the column. Absorbs the remainder of the height sum so that total height stays exactly as entered.',
  },
  stemBelly: {
    key: 'stemBelly',
    label: 'Stem belly',
    unit: 'ratio',
    min: 1,
    max: 2.2,
    step: 0.01,
    description:
      'Mid-height swell of the stem as a multiple of its narrowest diameter. 1.0 is a plain cylinder, 1.2 a classical turned profile.',
  },
  socketHeight: {
    key: 'socketHeight',
    label: 'Socket height',
    unit: 'cm',
    min: 0.5,
    max: 30,
    step: 0.5,
    description:
      'Height of the socket/harp hardware between the stem top and the shade’s lower rim.',
  },
  socketDiameter: {
    key: 'socketDiameter',
    label: 'Socket diameter',
    unit: 'cm',
    min: 0.8,
    max: 25,
    step: 0.1,
    description: 'Diameter of the socket collar. Slightly wider than the stem it caps.',
  },
  shadeHeight: {
    key: 'shadeHeight',
    label: 'Shade height',
    unit: 'cm',
    min: 3,
    max: 90,
    step: 0.5,
    description:
      'Vertical height of the shade, following the trade rule of roughly one third of total lamp height.',
  },
  finialHeight: {
    key: 'finialHeight',
    label: 'Finial height',
    unit: 'cm',
    min: 0.5,
    max: 20,
    step: 0.1,
    description:
      'Height of the knob capping the shade. Most of it sits above the shade’s top rim, so it is part of the lamp’s overall height, not a decoration on top of it.',
  },
  shadeTopDiameter: {
    key: 'shadeTopDiameter',
    label: 'Shade diameter (top)',
    unit: 'cm',
    min: 4,
    max: 90,
    step: 0.5,
    description:
      'Diameter of the shade’s upper opening. An empire shade tapers to 60-70% of its bottom diameter; equal values give a drum shade.',
  },
};

/**
 * The values the sidebar starts from. They are *not* treated as measured: until
 * the user edits a field it is shown, and shaded in the viewer, as estimated.
 * Numbers describe a common 45 cm ceramic table lamp.
 */
export const LAMP_STARTING_MEASUREMENTS: { readonly [K in LampMeasurementKey]: number } = {
  totalHeight: 45,
  baseDiameter: 13,
  shadeDiameter: 25,
  stemDiameter: 3,
};
