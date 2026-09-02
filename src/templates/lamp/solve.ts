import type { ConstraintReport, Provenance, ResolvedParam } from '../../core/params.ts';
import { resolve } from '../../core/params.ts';
import { clamp, isPositiveFinite } from '../../core/math.ts';
import {
  BASE_DIAMETER_OVER_TOTAL_HEIGHT,
  BASE_HEIGHT_OVER_TOTAL_HEIGHT,
  BASE_TOP_OVER_BOTTOM_DIAMETER,
  MIN_STEM_HEIGHT_OVER_TOTAL_HEIGHT,
  PROPORTION_MAX,
  PROPORTION_MIN,
  SHADE_DIAMETER_OVER_BASE_DIAMETER,
  SHADE_HEIGHT_OVER_TOTAL_HEIGHT,
  SHADE_TOP_OVER_BOTTOM_DIAMETER,
  SOCKET_DIAMETER_OVER_STEM_DIAMETER,
  FINIAL_DIAMETER_OVER_SHADE_TOP,
  FINIAL_HEIGHT_OVER_DIAMETER,
  HARP_TOP_INSET,
  MAX_FINIAL_OVER_TOTAL_HEIGHT,
  SOCKET_HEIGHT_OVER_SHADE_HEIGHT,
  STEM_BELLY,
  STEM_DIAMETER_OVER_BASE_DIAMETER,
} from './defaults.ts';
import { LAMP_PARAM_SPECS, LAMP_STARTING_MEASUREMENTS } from './spec.ts';
import type { LampMeasurementKey, LampMeasurements, LampParamKey, LampParams } from './spec.ts';

/** Input to {@link solveLamp}. */
export interface LampSolveInput {
  /**
   * Only the measurements the user actually entered. Absent keys are inferred,
   * which is what makes them render as "estimated" rather than "measured".
   */
  readonly measurements: LampMeasurements;
  /**
   * Proportion lock, {@link PROPORTION_MIN}-{@link PROPORTION_MAX}. Scales every
   * *inferred* dimension while leaving entered measurements pinned at exactly
   * the value typed, so the silhouette can be tuned without contradicting data.
   */
  readonly proportion?: number;
}

export interface LampSolution {
  readonly params: LampParams;
  readonly constraints: readonly ConstraintReport[];
}

function entered(measurements: LampMeasurements, key: LampMeasurementKey): number | undefined {
  const v = measurements[key];
  return isPositiveFinite(v) ? v : undefined;
}

/**
 * Turn a partial measurement set into a complete, constraint-satisfying lamp
 * parameter set.
 *
 * The rules, in order:
 *  1. Anything the user entered is `measured` and is never rewritten (only
 *     clamped into its documented plausible range).
 *  2. Anything computable from a measured value via a template ratio is
 *     `derived`.
 *  3. Anything else falls back to a template default and is `estimated`.
 *  4. Cross-part constraints are then repaired by moving inferred values.
 *     When a constraint is violated by two *measured* values, the user's
 *     numbers win and the violation is reported instead of silently rewritten.
 */
export function solveLamp(input: LampSolveInput): LampSolution {
  const m = input.measurements;
  const p = clamp(input.proportion ?? 1, PROPORTION_MIN, PROPORTION_MAX);
  const constraints: ConstraintReport[] = [];

  // --- 1. Anchors ---------------------------------------------------------
  const totalHeightEntered = entered(m, 'totalHeight');
  const totalHeight = totalHeightEntered ?? LAMP_STARTING_MEASUREMENTS.totalHeight;
  const totalHeightParam = resolve(
    LAMP_PARAM_SPECS.totalHeight,
    totalHeight,
    totalHeightEntered === undefined ? 'estimated' : 'measured',
  );
  const H = totalHeightParam.value;

  const baseDiameterEntered = entered(m, 'baseDiameter');
  const shadeDiameterEntered = entered(m, 'shadeDiameter');

  let baseDiameterParam: ResolvedParam;
  if (baseDiameterEntered !== undefined) {
    baseDiameterParam = resolve(LAMP_PARAM_SPECS.baseDiameter, baseDiameterEntered, 'measured');
  } else if (shadeDiameterEntered !== undefined) {
    baseDiameterParam = resolve(
      LAMP_PARAM_SPECS.baseDiameter,
      (shadeDiameterEntered / SHADE_DIAMETER_OVER_BASE_DIAMETER) * p,
      'derived',
      `Inferred from the shade diameter at the ${SHADE_DIAMETER_OVER_BASE_DIAMETER}:1 shade-to-base trade ratio.`,
    );
  } else {
    baseDiameterParam = resolve(
      LAMP_PARAM_SPECS.baseDiameter,
      H * BASE_DIAMETER_OVER_TOTAL_HEIGHT * p,
      'estimated',
      'No width measured; taken from the typical base-diameter-to-height ratio.',
    );
  }

  // --- 2. Stem, and the neck it seats on ----------------------------------
  // Resolved before the shade so that a wide measured stem can widen an
  // inferred base *before* the shade ratio is taken from that base.
  const stemDiameterEntered = entered(m, 'stemDiameter');
  let baseDiameter = baseDiameterParam.value;
  let baseNote = baseDiameterParam.note;
  let stemDiameter = stemDiameterEntered ?? baseDiameter * STEM_DIAMETER_OVER_BASE_DIAMETER * p;
  let stemDiameterProvenance: Provenance =
    stemDiameterEntered !== undefined
      ? 'measured'
      : baseDiameterParam.provenance === 'measured'
        ? 'derived'
        : 'estimated';
  let stemNote =
    stemDiameterEntered === undefined
      ? `Inferred at ${STEM_DIAMETER_OVER_BASE_DIAMETER} of the base diameter.`
      : undefined;

  let baseTopDiameter = baseDiameter * BASE_TOP_OVER_BOTTOM_DIAMETER;
  let baseTopNote: string | undefined;

  if (stemDiameter <= baseTopDiameter) {
    constraints.push({
      id: 'stem-seats-on-base',
      description: 'Stem diameter <= base top diameter.',
      satisfied: true,
    });
  } else if (stemDiameterEntered === undefined) {
    // The stem was inferred, so narrow it onto the neck.
    stemDiameter = baseTopDiameter;
    stemDiameterProvenance = 'derived';
    stemNote = 'Capped at the base neck diameter so the stem seats on the base.';
    constraints.push({
      id: 'stem-seats-on-base',
      description: 'Stem diameter <= base top diameter.',
      satisfied: true,
      resolution: 'Narrowed the inferred stem to the base neck.',
    });
  } else {
    // The stem is measured. Open up the neck, growing the base if it is only
    // inferred; a measured base that is too narrow is a real conflict.
    const neededNeck = Math.min(stemDiameter * 1.08, LAMP_PARAM_SPECS.baseTopDiameter.max);
    if (neededNeck <= baseDiameter) {
      baseTopDiameter = neededNeck;
      baseTopNote = 'Widened so the measured stem has a seat on the base.';
      constraints.push({
        id: 'stem-seats-on-base',
        description: 'Stem diameter <= base top diameter.',
        satisfied: true,
        resolution: 'Widened the inferred base neck around the measured stem.',
      });
    } else if (baseDiameterParam.provenance !== 'measured') {
      baseDiameter = Math.min(
        neededNeck / BASE_TOP_OVER_BOTTOM_DIAMETER,
        LAMP_PARAM_SPECS.baseDiameter.max,
      );
      baseTopDiameter = Math.min(neededNeck, baseDiameter);
      baseNote = 'Widened to give the measured stem a base broad enough to seat on.';
      baseTopNote = 'Widened so the measured stem has a seat on the base.';
      constraints.push({
        id: 'stem-seats-on-base',
        description: 'Stem diameter <= base top diameter.',
        satisfied: baseTopDiameter + 1e-9 >= stemDiameter,
        resolution: 'Widened the inferred base around the measured stem.',
      });
    } else {
      baseTopDiameter = baseDiameter;
      constraints.push({
        id: 'stem-seats-on-base',
        description: 'Stem diameter <= base top diameter.',
        satisfied: false,
        resolution:
          'The measured stem is wider than the measured base. Both were kept as entered; re-check whichever of the two was estimated by eye.',
      });
    }
  }

  // --- 3. Shade, and the constraint that it may not be narrower than the base
  const shadeDiameterParam =
    shadeDiameterEntered !== undefined
      ? resolve(LAMP_PARAM_SPECS.shadeDiameter, shadeDiameterEntered, 'measured')
      : resolve(
          LAMP_PARAM_SPECS.shadeDiameter,
          baseDiameter * SHADE_DIAMETER_OVER_BASE_DIAMETER * p,
          baseDiameterParam.provenance === 'measured' ? 'derived' : 'estimated',
          `Trade rule: a shade reads correctly at about ${SHADE_DIAMETER_OVER_BASE_DIAMETER}x the base width.`,
        );

  let shadeDiameter = shadeDiameterParam.value;
  let shadeNote = shadeDiameterParam.note;

  if (shadeDiameter >= baseDiameter) {
    constraints.push({
      id: 'shade-covers-base',
      description: 'Shade bottom diameter >= base diameter.',
      satisfied: true,
    });
  } else if (
    baseDiameterParam.provenance === 'measured' &&
    shadeDiameterParam.provenance === 'measured'
  ) {
    constraints.push({
      id: 'shade-covers-base',
      description: 'Shade bottom diameter >= base diameter.',
      satisfied: false,
      resolution:
        'Both diameters were measured, so neither was rewritten. The lamp is modelled exactly as entered; check the shade measurement if this looks wrong.',
    });
  } else if (shadeDiameterParam.provenance === 'measured') {
    baseDiameter = shadeDiameter;
    baseTopDiameter = Math.min(baseTopDiameter, baseDiameter);
    baseNote = 'Narrowed to the measured shade diameter to satisfy the shade-covers-base rule.';
    constraints.push({
      id: 'shade-covers-base',
      description: 'Shade bottom diameter >= base diameter.',
      satisfied: true,
      resolution: 'Narrowed the inferred base to match the measured shade.',
    });
  } else {
    shadeDiameter = baseDiameter;
    shadeNote = 'Widened to the measured base diameter to satisfy the shade-covers-base rule.';
    constraints.push({
      id: 'shade-covers-base',
      description: 'Shade bottom diameter >= base diameter.',
      satisfied: true,
      resolution: 'Widened the inferred shade to match the measured base.',
    });
  }

  // --- 4. Shade taper, socket and finial ----------------------------------
  // Resolved before the heights, because the finial's height is part of the
  // lamp's overall height and the height budget has to know about it.
  const socketDiameter = stemDiameter * SOCKET_DIAMETER_OVER_STEM_DIAMETER;
  let shadeTopDiameter = shadeDiameter * SHADE_TOP_OVER_BOTTOM_DIAMETER;
  let shadeTopNote: string | undefined;
  const minShadeTop = socketDiameter * 1.4;
  if (shadeTopDiameter < minShadeTop) {
    shadeTopDiameter = Math.min(minShadeTop, shadeDiameter);
    shadeTopNote = 'Opened up so the shade clears the socket hardware.';
    constraints.push({
      id: 'shade-clears-socket',
      description: 'Shade top opening wider than the socket collar.',
      satisfied: true,
      resolution: shadeTopNote,
    });
  } else {
    constraints.push({
      id: 'shade-clears-socket',
      description: 'Shade top opening wider than the socket collar.',
      satisfied: true,
    });
  }
  const finialHeight = Math.min(
    shadeTopDiameter * FINIAL_DIAMETER_OVER_SHADE_TOP * FINIAL_HEIGHT_OVER_DIAMETER,
    H * MAX_FINIAL_OVER_TOTAL_HEIGHT,
  );

  // --- 5. Heights ---------------------------------------------------------
  // Everything visible has to fit inside the entered total height, the finial
  // included: it screws onto the harp just below the shade's top rim, so the
  // part of it standing above that rim adds to the lamp's overall height. Miss
  // this and the generated mesh comes out taller than the number the user typed.
  let baseHeight = H * BASE_HEIGHT_OVER_TOTAL_HEIGHT * p;
  let shadeHeight = H * SHADE_HEIGHT_OVER_TOTAL_HEIGHT * p;
  let socketHeight = shadeHeight * SOCKET_HEIGHT_OVER_SHADE_HEIGHT;
  const finialProtrusion = (): number =>
    Math.max(0, finialHeight - shadeHeight * HARP_TOP_INSET);
  const minStemHeight = H * MIN_STEM_HEIGHT_OVER_TOTAL_HEIGHT;
  let heightNote: string | undefined;

  const consumed = (): number => baseHeight + shadeHeight + socketHeight + finialProtrusion();
  if (H - consumed() < minStemHeight) {
    // Shrink the inferred base and shade together until the stem fits.
    //
    // Solved rather than iterated, because the finial's *protrusion* grows as
    // the shade shrinks — it is fixed in size and only partly hidden inside the
    // shade — so scaling the other parts by the naive ratio gives back less
    // height than it takes and leaves the stem short.
    const budget = H - minStemHeight;
    const scalable = baseHeight + shadeHeight + socketHeight;
    const shrink =
      finialHeight > shadeHeight * HARP_TOP_INSET
        ? (budget - finialHeight) / (scalable - shadeHeight * HARP_TOP_INSET)
        : budget / consumed();
    baseHeight *= shrink;
    shadeHeight *= shrink;
    socketHeight *= shrink;
    heightNote = `Scaled down by ${(shrink * 100).toFixed(0)}% so the stem keeps at least ${(MIN_STEM_HEIGHT_OVER_TOTAL_HEIGHT * 100).toFixed(0)}% of the total height.`;
    constraints.push({
      id: 'stem-minimum-height',
      description: `Stem height >= ${(MIN_STEM_HEIGHT_OVER_TOTAL_HEIGHT * 100).toFixed(0)}% of total height.`,
      satisfied: true,
      resolution: heightNote,
    });
  } else {
    constraints.push({
      id: 'stem-minimum-height',
      description: `Stem height >= ${(MIN_STEM_HEIGHT_OVER_TOTAL_HEIGHT * 100).toFixed(0)}% of total height.`,
      satisfied: true,
    });
  }
  const stemHeight = H - baseHeight - shadeHeight - socketHeight - finialProtrusion();

  constraints.push({
    id: 'height-sum',
    description:
      'Base, stem, socket and shade heights, plus the part of the finial standing above the shade, sum to the total height.',
    satisfied:
      Math.abs(
        baseHeight + stemHeight + socketHeight + shadeHeight + finialProtrusion() - H,
      ) < 1e-6,
  });

  const derivedFrom = (source: ResolvedParam): 'derived' | 'estimated' =>
    source.provenance === 'estimated' ? 'estimated' : 'derived';

  const params: { [K in LampParamKey]: ResolvedParam } = {
    totalHeight: totalHeightParam,
    baseDiameter: resolve(
      LAMP_PARAM_SPECS.baseDiameter,
      baseDiameter,
      baseDiameter === baseDiameterParam.value ? baseDiameterParam.provenance : 'derived',
      baseNote,
    ),
    shadeDiameter: resolve(
      LAMP_PARAM_SPECS.shadeDiameter,
      shadeDiameter,
      shadeDiameter === shadeDiameterParam.value ? shadeDiameterParam.provenance : 'derived',
      shadeNote,
    ),
    stemDiameter: resolve(
      LAMP_PARAM_SPECS.stemDiameter,
      stemDiameter,
      stemDiameterProvenance,
      stemNote,
    ),
    baseHeight: resolve(
      LAMP_PARAM_SPECS.baseHeight,
      baseHeight,
      derivedFrom(totalHeightParam),
      heightNote,
    ),
    baseTopDiameter: resolve(
      LAMP_PARAM_SPECS.baseTopDiameter,
      baseTopDiameter,
      derivedFrom(baseDiameterParam),
      baseTopNote,
    ),
    stemHeight: resolve(
      LAMP_PARAM_SPECS.stemHeight,
      stemHeight,
      derivedFrom(totalHeightParam),
      'Absorbs the height remainder so the total height stays exactly as entered.',
    ),
    stemBelly: resolve(LAMP_PARAM_SPECS.stemBelly, STEM_BELLY, 'estimated'),
    socketHeight: resolve(
      LAMP_PARAM_SPECS.socketHeight,
      socketHeight,
      derivedFrom(totalHeightParam),
    ),
    socketDiameter: resolve(
      LAMP_PARAM_SPECS.socketDiameter,
      socketDiameter,
      stemDiameterProvenance === 'measured' ? 'derived' : 'estimated',
    ),
    shadeHeight: resolve(
      LAMP_PARAM_SPECS.shadeHeight,
      shadeHeight,
      derivedFrom(totalHeightParam),
      heightNote,
    ),
    shadeTopDiameter: resolve(
      LAMP_PARAM_SPECS.shadeTopDiameter,
      shadeTopDiameter,
      derivedFrom(shadeDiameterParam),
      shadeTopNote,
    ),
    finialHeight: resolve(
      LAMP_PARAM_SPECS.finialHeight,
      finialHeight,
      derivedFrom(shadeDiameterParam),
      'Sized from the shade’s top opening, and counted in the total height.',
    ),
  };

  return { params, constraints };
}
