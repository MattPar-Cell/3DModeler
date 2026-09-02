import type { Provenance, ResolvedParam, Unit } from '../core/params.ts';
import type { GeneratedPart } from '../templates/types.ts';
import { buildLamp } from '../templates/lamp/build.ts';
import { LAMP_PARAM_SPECS } from '../templates/lamp/spec.ts';
import type { LampMeasurements, LampParamKey } from '../templates/lamp/spec.ts';
import { buildBody } from '../body/build.ts';
import { BODY_PARAM_SPECS } from '../body/spec.ts';
import type { BodyMeasurements, BodyParamKey } from '../body/spec.ts';

/**
 * Comparison snapshots.
 *
 * A snapshot is the measurement set and nothing else — no geometry, no cached
 * mesh, not even the solved parameters. Comparing two lamps means solving and
 * regenerating both, exactly as the live editor does. That falls straight out
 * of the app's premise: if geometry is a pure function of parameters, then
 * storing a model *is* storing its parameters, and a saved comparison stays
 * correct across changes to the templates themselves.
 */

export type SnapshotKind = 'lamp' | 'body';

interface SnapshotBase {
  readonly id: string;
  readonly label: string;
  /** Tint used for this snapshot in overlay mode and in the legend. */
  readonly color: string;
  readonly createdAt: number;
}

export type Snapshot =
  | (SnapshotBase & {
      readonly kind: 'lamp';
      readonly measurements: LampMeasurements;
      readonly proportion: number;
    })
  | (SnapshotBase & {
      readonly kind: 'body';
      readonly measurements: BodyMeasurements;
    });

/**
 * Tints for overlay mode. Chosen to stay distinguishable against the studio
 * background and from each other, including for the most common forms of
 * colour vision deficiency — overlay mode leans on colour alone to separate
 * models, so the palette has to carry that weight.
 */
export const SNAPSHOT_COLORS: readonly string[] = [
  '#6ba8ff',
  '#f0a63c',
  '#5fd4a4',
  '#e879b8',
  '#b79bff',
  '#e0d264',
];

/** A snapshot built into geometry, with the extents needed to lay it out. */
export interface ComparisonModel {
  readonly snapshot: Snapshot;
  readonly parts: readonly GeneratedPart[];
  readonly params: Readonly<Record<string, ResolvedParam>>;
  /** Overall extents of the generated mesh, cm. */
  readonly height: number;
  readonly width: number;
  readonly depth: number;
  /** Centre of the mesh across X, cm — used to line models up when laid out. */
  readonly centreX: number;
}

function extents(parts: readonly GeneratedPart[]): {
  height: number;
  width: number;
  depth: number;
  centreX: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const part of parts) {
    const box = part.geometry.boundingBox;
    if (box === null) continue;
    minX = Math.min(minX, box.min.x);
    maxX = Math.max(maxX, box.max.x);
    minY = Math.min(minY, box.min.y);
    maxY = Math.max(maxY, box.max.y);
    minZ = Math.min(minZ, box.min.z);
    maxZ = Math.max(maxZ, box.max.z);
  }
  if (!Number.isFinite(minX)) return { height: 0, width: 0, depth: 0, centreX: 0 };
  return {
    height: maxY - minY,
    width: maxX - minX,
    depth: maxZ - minZ,
    centreX: (minX + maxX) / 2,
  };
}

/** Solve and build a snapshot. */
export function buildSnapshotModel(snapshot: Snapshot): ComparisonModel {
  if (snapshot.kind === 'lamp') {
    const model = buildLamp({
      measurements: snapshot.measurements,
      proportion: snapshot.proportion,
    });
    return { snapshot, parts: model.parts, params: model.params, ...extents(model.parts) };
  }
  const model = buildBody({ measurements: snapshot.measurements });
  return { snapshot, parts: model.parts, params: model.params, ...extents(model.parts) };
}

/** Release the GPU buffers held by a set of comparison models. */
export function disposeModels(models: readonly ComparisonModel[]): void {
  for (const model of models) {
    for (const part of model.parts) part.geometry.dispose();
  }
}

/** Horizontal placement of each model when laid out side by side. */
export interface Placement {
  readonly id: string;
  /** X offset in cm to apply to the model's root. */
  readonly x: number;
}

/**
 * Lay models out in a row, centred on the origin.
 *
 * Gaps scale with the models themselves so a row of lamps is not separated by
 * body-sized gaps, and a lamp standing next to a person is not swallowed by one.
 */
export function layOutSideBySide(
  models: readonly ComparisonModel[],
  gapFraction = 0.22,
): Placement[] {
  if (models.length === 0) return [];
  const widths = models.map((m) => Math.max(m.width, 1));
  const gap = (Math.max(...widths) || 1) * gapFraction;
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * (models.length - 1);

  const placements: Placement[] = [];
  let cursor = -total / 2;
  models.forEach((model, i) => {
    const width = widths[i] ?? 0;
    // Place the model's own centre at the centre of its slot.
    placements.push({ id: model.snapshot.id, x: cursor + width / 2 - model.centreX });
    cursor += width + gap;
  });
  return placements;
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

/** One measurement compared across every selected model. */
export interface DiffRow {
  readonly key: string;
  readonly label: string;
  readonly unit: Unit;
  readonly cells: readonly {
    readonly value: number;
    readonly provenance: Provenance | undefined;
    /** Difference from the first model. `undefined` for the first model itself. */
    readonly delta: number | undefined;
    /** `delta` as a fraction of the first model's value. */
    readonly relative: number | undefined;
  }[];
  /** Largest absolute difference from the first model across the row. */
  readonly spread: number;
}

function rowFrom(
  key: string,
  label: string,
  unit: Unit,
  values: readonly { value: number; provenance: Provenance | undefined }[],
): DiffRow {
  const reference = values[0]?.value;
  let spread = 0;
  const cells = values.map((entry, i) => {
    if (i === 0 || reference === undefined) {
      return { ...entry, delta: undefined, relative: undefined };
    }
    const delta = entry.value - reference;
    spread = Math.max(spread, Math.abs(delta));
    return {
      ...entry,
      delta,
      relative: reference === 0 ? undefined : delta / reference,
    };
  });
  return { key, label, unit, cells, spread };
}

/**
 * Overall size, read off the generated meshes.
 *
 * Always available, whatever the models are: this is what lets a lamp be
 * compared against a person for scale, where no shared measurement exists.
 */
export function dimensionRows(models: readonly ComparisonModel[]): DiffRow[] {
  if (models.length === 0) return [];
  const of = (pick: (m: ComparisonModel) => number) =>
    models.map((m) => ({ value: pick(m), provenance: undefined }));
  return [
    rowFrom('height', 'Overall height', 'cm', of((m) => m.height)),
    rowFrom('width', 'Overall width', 'cm', of((m) => m.width)),
    rowFrom('depth', 'Overall depth', 'cm', of((m) => m.depth)),
  ];
}

/** The parameter keys and labels for a kind, in display order. */
function parameterSpecs(kind: SnapshotKind): readonly { key: string; label: string; unit: Unit }[] {
  const specs = kind === 'lamp' ? LAMP_PARAM_SPECS : BODY_PARAM_SPECS;
  return Object.values(specs as Record<string, { key: string; label: string; unit: Unit }>).map(
    (spec) => ({ key: spec.key, label: spec.label, unit: spec.unit }),
  );
}

/**
 * Compare every parameter across models of the same kind.
 *
 * Returns an empty list when the selection mixes kinds — a lamp's stem
 * diameter and a person's neck have nothing to say to each other, and inventing
 * a row that pairs them would be worse than showing none. Use
 * {@link dimensionRows} for that case.
 */
export function parameterRows(models: readonly ComparisonModel[]): DiffRow[] {
  if (models.length === 0) return [];
  const kind = models[0]?.snapshot.kind;
  if (kind === undefined || !models.every((m) => m.snapshot.kind === kind)) return [];

  const rows: DiffRow[] = [];
  for (const spec of parameterSpecs(kind)) {
    const values = models.map((model) => {
      const param = model.params[spec.key];
      return {
        value: param?.value ?? Number.NaN,
        provenance: param?.provenance,
      };
    });
    if (values.some((v) => !Number.isFinite(v.value))) continue;
    rows.push(rowFrom(spec.key, spec.label, spec.unit, values));
  }
  return rows;
}

/** Rows where the models actually differ, most different first. */
export function significantRows(rows: readonly DiffRow[], minimum = 1e-6): DiffRow[] {
  return rows.filter((row) => row.spread > minimum).sort((a, b) => b.spread - a.spread);
}

/** A short auto-generated name, so a saved model is identifiable at a glance. */
export function describeSnapshot(
  kind: SnapshotKind,
  measurements: LampMeasurements | BodyMeasurements,
): string {
  if (kind === 'lamp') {
    const m = measurements as LampMeasurements;
    const parts = [
      m.totalHeight === undefined ? undefined : `${m.totalHeight} cm`,
      m.shadeDiameter === undefined ? undefined : `${m.shadeDiameter} cm shade`,
    ].filter((p): p is string => p !== undefined);
    return parts.length > 0 ? `Lamp · ${parts.join(', ')}` : 'Lamp · all inferred';
  }
  const m = measurements as BodyMeasurements;
  const parts = [
    m.stature === undefined ? undefined : `${m.stature} cm`,
    m.mass === undefined ? undefined : `${m.mass} kg`,
  ].filter((p): p is string => p !== undefined);
  return parts.length > 0 ? `Body · ${parts.join(', ')}` : 'Body · all inferred';
}

export type { LampParamKey, BodyParamKey };
