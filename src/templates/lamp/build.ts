import { loftGeometry } from '../../core/loft.ts';
import type { Ring } from '../../core/loft.ts';
import { circleRing, revolveProfile, tubeRings } from '../../core/profile.ts';
import type { ProfilePoint } from '../../core/profile.ts';
import type { Provenance } from '../../core/params.ts';
import type { GeneratedModel, GeneratedPart } from '../types.ts';
import {
  FINIAL_DIAMETER_OVER_SHADE_TOP,
  FINIAL_HEIGHT_OVER_DIAMETER,
  HARP_SPREAD,
  HARP_WIRE_OVER_STEM_DIAMETER,
  PROFILE_ROWS,
  RADIAL_SEGMENTS,
  SHADE_BOW,
  SHADE_RIM_HEIGHT,
  SHADE_RIM_PROJECTION,
  STEM_BELLY_POSITION,
} from './defaults.ts';
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
  /** Glazed ceramic: fairly smooth, no metallic component. */
  base: { color: '#cfc6b6', roughness: 0.42, metalness: 0.03, emissive: '#000000', emissiveIntensity: 0 },
  stem: { color: '#c3b9a6', roughness: 0.4, metalness: 0.06, emissive: '#000000', emissiveIntensity: 0 },
  /** Brushed brass hardware. */
  socket: { color: '#8a7a5c', roughness: 0.32, metalness: 0.72, emissive: '#000000', emissiveIntensity: 0 },
  /**
   * Shade fabric. The emissive term stands in for light passing through the
   * cloth from the bulb inside — the single cue that most makes a truncated
   * cone read as a lampshade rather than a paper cup.
   */
  shade: { color: '#f2e7d2', roughness: 0.95, metalness: 0.0, emissive: '#ffdfa8', emissiveIntensity: 0.22 },
} as const;

function part(
  id: string,
  label: string,
  rings: readonly Ring[],
  material: {
    color: string;
    roughness: number;
    metalness: number;
    emissive: string;
    emissiveIntensity: number;
  },
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
    emissive: material.emissive,
    emissiveIntensity: material.emissiveIntensity,
    doubleSided: open,
    opacity: 1,
    confidence,
    drivenBy,
  };
}

/**
 * Base profile: a turned form — a low plinth, a torus-like swell, a cove that
 * cuts back in, and a neck for the stem to seat on. Control points are
 * fractions of base height, and the monotone profile interpolation in
 * `revolveProfile` turns them into a continuous curve without letting any span
 * bulge past a control radius.
 */
function baseProfile(bottomRadius: number, topRadius: number): ProfilePoint[] {
  return [
    { t: 0, radius: bottomRadius * 0.9 },
    { t: 0.04, radius: bottomRadius * 0.995 },
    // A narrow fillet above the plinth, the classic turned step.
    { t: 0.11, radius: bottomRadius * 0.955 },
    { t: 0.16, radius: bottomRadius * 0.985 },
    { t: 0.3, radius: bottomRadius * 0.93 },
    // The cove: the profile cuts in sharply toward the neck.
    { t: 0.55, radius: lerpRadius(bottomRadius, topRadius, 0.62) },
    { t: 0.78, radius: topRadius * 1.12 },
    { t: 0.9, radius: topRadius * 0.94 },
    { t: 1, radius: topRadius },
  ];
}

function lerpRadius(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Stem profile: a turned column with a collar, a belly and a neck ring. */
function stemProfile(radius: number, belly: number): ProfilePoint[] {
  return [
    { t: 0, radius: radius * 1.18 },
    { t: 0.05, radius: radius * 1.02 },
    { t: 0.1, radius: radius * 1.1 },
    { t: 0.16, radius },
    { t: STEM_BELLY_POSITION, radius: radius * belly },
    { t: 0.78, radius: radius * 1.01 },
    { t: 0.88, radius: radius * 1.09 },
    { t: 0.94, radius: radius * 0.98 },
    { t: 1, radius: radius * 1.04 },
  ];
}

/**
 * Shade profile: a shallow convex bow with a rolled rim at each end.
 *
 * A shade cut from a flat pattern is a straight-sided cone; a fabric one
 * relaxes outward a little, and both ends are wrapped over a wire ring that
 * stands slightly proud of the surface. Those two details are most of what
 * separates a lampshade from a truncated cone.
 */
function shadeProfile(bottomRadius: number, topRadius: number): ProfilePoint[] {
  const at = (t: number): number => lerpRadius(bottomRadius, topRadius, t);
  const mean = (bottomRadius + topRadius) / 2;
  const bow = mean * SHADE_BOW;
  const rim = mean * SHADE_RIM_PROJECTION;
  return [
    { t: 0, radius: bottomRadius + rim },
    { t: SHADE_RIM_HEIGHT, radius: bottomRadius },
    { t: 0.3, radius: at(0.3) + bow * 0.85 },
    { t: 0.5, radius: at(0.5) + bow },
    { t: 0.7, radius: at(0.7) + bow * 0.85 },
    { t: 1 - SHADE_RIM_HEIGHT, radius: topRadius },
    { t: 1, radius: topRadius + rim },
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

  // Harp: the wire loop that carries the shade. Two arcs springing from the
  // socket, bowing out past the bulb and drawing back in under the finial.
  const harpRadius = (stemR * 2 * HARP_WIRE_OVER_STEM_DIAMETER) / 2;
  const harpSpread = shadeBottomR * HARP_SPREAD;
  const harpTopY = y4 - shadeHeight * 0.08;
  for (const sign of [1, -1] as const) {
    const pathPoints = 24;
    const path = Array.from({ length: pathPoints }, (_, i) => {
      const t = i / (pathPoints - 1);
      // A single smooth arc: out to the widest point at mid height, back in.
      const spread = Math.sin(Math.PI * Math.min(t * 1.06, 1)) ** 0.85;
      return {
        x: sign * (stemR * 0.7 + (harpSpread - stemR * 0.7) * spread),
        y: y3 - socketHeight * 0.25 + (harpTopY - (y3 - socketHeight * 0.25)) * t,
        z: 0,
      };
    });
    parts.push(
      part(
        `harp-${sign > 0 ? 'l' : 'r'}`,
        `Harp (${sign > 0 ? 'left' : 'right'})`,
        tubeRings(path, harpRadius, 12),
        MATERIALS.socket,
        confidenceOf(params, ['stemDiameter', 'shadeDiameter']),
        ['stemDiameter', 'shadeDiameter'],
      ),
    );
  }

  // Shade: a shallow convex bow with a rolled rim at each end, open at both.
  parts.push(
    part(
      'shade',
      'Shade',
      revolveProfile(
        shadeProfile(shadeBottomR, shadeTopR),
        y3,
        y4,
        PROFILE_ROWS,
        RADIAL_SEGMENTS,
      ),
      MATERIALS.shade,
      confidenceOf(params, ['shadeDiameter', 'shadeTopDiameter', 'shadeHeight']),
      ['shadeDiameter', 'shadeTopDiameter', 'shadeHeight'],
      { capStart: false, capEnd: false },
    ),
  );

  // Finial: the knob that screws onto the harp and holds the shade down.
  const finialR = (shadeTopR * 2 * FINIAL_DIAMETER_OVER_SHADE_TOP) / 2;
  const finialHeight = finialR * 2 * FINIAL_HEIGHT_OVER_DIAMETER;
  parts.push(
    part(
      'finial',
      'Finial',
      revolveProfile(
        [
          { t: 0, radius: finialR * 0.34 },
          { t: 0.12, radius: finialR * 0.42 },
          { t: 0.2, radius: finialR * 0.3 },
          { t: 0.42, radius: finialR },
          { t: 0.62, radius: finialR * 0.88 },
          { t: 0.82, radius: finialR * 0.5 },
          { t: 1, radius: finialR * 0.16 },
        ],
        harpTopY,
        harpTopY + finialHeight,
        PROFILE_ROWS,
        RADIAL_SEGMENTS,
      ),
      MATERIALS.socket,
      confidenceOf(params, ['shadeTopDiameter']),
      ['shadeTopDiameter'],
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
