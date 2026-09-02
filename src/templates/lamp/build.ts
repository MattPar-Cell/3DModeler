import { loftGeometry } from '../../core/loft.ts';
import type { Ring } from '../../core/loft.ts';
import { circleRing, revolveProfile } from '../../core/profile.ts';
import type { ProfilePoint } from '../../core/profile.ts';
import type { Provenance } from '../../core/params.ts';
import type { GeneratedModel, GeneratedPart } from '../types.ts';
import { PROFILE_ROWS, RADIAL_SEGMENTS, STEM_BELLY_POSITION } from './defaults.ts';
import { solveLamp } from './solve.ts';
import type { LampSolveInput } from './solve.ts';
import type { LampParamKey, LampParams } from './spec.ts';

/**
 * Geometry generation for the lamp template.
 *
 * Every part is a revolved profile lofted from rings — see `core/loft.ts`. The
 * whole model is rebuilt from scratch on each parameter change; on a modern
 * laptop this costs well under a millisecond at {@link RADIAL_SEGMENTS} = 64,
 * comfortably inside the 100 ms interaction budget.
 *
 * All lengths are centimetres. The viewer and the exporters scale the root
 * group by 0.01 so that exported glTF is in metres, per the glTF convention.
 */

/** Worst (least certain) provenance among the given parameters. */
function confidenceOf(params: LampParams, keys: readonly LampParamKey[]): Provenance {
  let worst: Provenance = 'measured';
  for (const key of keys) {
    const provenance = params[key].provenance;
    if (provenance === 'estimated') return 'estimated';
    if (provenance === 'derived') worst = 'derived';
  }
  return worst;
}

const MATERIALS = {
  base: { color: '#c9c2b6', roughness: 0.55, metalness: 0.05 },
  stem: { color: '#b9b1a3', roughness: 0.5, metalness: 0.08 },
  socket: { color: '#6f6a63', roughness: 0.35, metalness: 0.55 },
  shade: { color: '#f0e9dc', roughness: 0.9, metalness: 0.0 },
} as const;

function part(
  id: string,
  label: string,
  rings: readonly Ring[],
  material: { color: string; roughness: number; metalness: number },
  confidence: Provenance,
  drivenBy: readonly LampParamKey[],
  options?: { capStart?: boolean; capEnd?: boolean },
): GeneratedPart {
  const open = options?.capStart === false || options?.capEnd === false;
  return {
    id,
    label,
    geometry: loftGeometry(rings, options ?? {}),
    color: material.color,
    roughness: material.roughness,
    metalness: material.metalness,
    doubleSided: open,
    opacity: 1,
    confidence,
    drivenBy,
  };
}

/**
 * Base profile: a wide foot that rolls in with a soft shoulder and tapers to
 * the neck the stem seats on. Control points are fractions of base height.
 */
function baseProfile(bottomRadius: number, topRadius: number): ProfilePoint[] {
  const shoulder = bottomRadius * 0.98;
  return [
    { t: 0, radius: bottomRadius * 0.92 },
    { t: 0.06, radius: bottomRadius },
    { t: 0.3, radius: shoulder },
    { t: 0.62, radius: (shoulder + topRadius) * 0.5 },
    { t: 1, radius: topRadius },
  ];
}

/** Stem profile: a straight column with a single classical belly. */
function stemProfile(radius: number, belly: number): ProfilePoint[] {
  return [
    { t: 0, radius: radius * 1.12 },
    { t: 0.12, radius },
    { t: STEM_BELLY_POSITION, radius: radius * belly },
    { t: 0.86, radius },
    { t: 1, radius: radius * 1.05 },
  ];
}

/** Build every part of the lamp from a solved parameter set. */
export function buildLampParts(params: LampParams): GeneratedPart[] {
  const v = <K extends LampParamKey>(key: K): number => params[key].value;

  const baseHeight = v('baseHeight');
  const stemHeight = v('stemHeight');
  const socketHeight = v('socketHeight');
  const shadeHeight = v('shadeHeight');

  const baseBottomR = v('baseDiameter') / 2;
  const baseTopR = v('baseTopDiameter') / 2;
  const stemR = v('stemDiameter') / 2;
  const socketR = v('socketDiameter') / 2;
  const shadeBottomR = v('shadeDiameter') / 2;
  const shadeTopR = v('shadeTopDiameter') / 2;

  const y0 = 0;
  const y1 = baseHeight;
  const y2 = y1 + stemHeight;
  const y3 = y2 + socketHeight;
  const y4 = y3 + shadeHeight;

  const parts: GeneratedPart[] = [];

  parts.push(
    part(
      'base',
      'Base',
      revolveProfile(baseProfile(baseBottomR, baseTopR), y0, y1, PROFILE_ROWS, RADIAL_SEGMENTS),
      MATERIALS.base,
      confidenceOf(params, ['baseDiameter', 'baseHeight', 'baseTopDiameter']),
      ['baseDiameter', 'baseHeight', 'baseTopDiameter'],
    ),
  );

  parts.push(
    part(
      'stem',
      'Stem',
      revolveProfile(stemProfile(stemR, v('stemBelly')), y1, y2, PROFILE_ROWS, RADIAL_SEGMENTS),
      MATERIALS.stem,
      // `stemBelly` is a styling prior with no measurable counterpart, so it is
      // deliberately excluded: it would otherwise pin every stem to "estimated".
      confidenceOf(params, ['stemDiameter', 'stemHeight']),
      ['stemDiameter', 'stemHeight'],
    ),
  );

  // Socket collar: a short straight cylinder capped by a slight flare.
  const socketRings: Ring[] = [
    circleRing(stemR * 1.05, y2, RADIAL_SEGMENTS),
    circleRing(socketR, y2 + socketHeight * 0.18, RADIAL_SEGMENTS),
    circleRing(socketR, y2 + socketHeight * 0.82, RADIAL_SEGMENTS),
    circleRing(socketR * 0.82, y3, RADIAL_SEGMENTS),
  ];
  parts.push(
    part(
      'socket',
      'Socket',
      socketRings,
      MATERIALS.socket,
      confidenceOf(params, ['socketDiameter', 'socketHeight']),
      ['socketDiameter', 'socketHeight'],
    ),
  );

  // Shade: an open-ended truncated cone, so both rims read as openings.
  const shadeRings: Ring[] = [
    circleRing(shadeBottomR, y3, RADIAL_SEGMENTS),
    circleRing(shadeTopR, y4, RADIAL_SEGMENTS),
  ];
  parts.push(
    part(
      'shade',
      'Shade',
      shadeRings,
      MATERIALS.shade,
      confidenceOf(params, ['shadeDiameter', 'shadeTopDiameter', 'shadeHeight']),
      ['shadeDiameter', 'shadeTopDiameter', 'shadeHeight'],
      { capStart: false, capEnd: false },
    ),
  );

  return parts;
}

/** Solve, then build. The single entry point the UI calls. */
export function buildLamp(input: LampSolveInput): GeneratedModel<LampParamKey> {
  const { params, constraints } = solveLamp(input);
  return {
    parts: buildLampParts(params),
    params,
    constraints,
    height: params.totalHeight.value,
  };
}
