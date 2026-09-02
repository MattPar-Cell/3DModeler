import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SNAPSHOT_COLORS,
  buildSnapshotModel,
  describeSnapshot,
  dimensionRows,
  layOutSideBySide,
  parameterRows,
  significantRows,
} from './snapshots.ts';
import type { Snapshot } from './snapshots.ts';

function lamp(id: string, totalHeight: number, shadeDiameter?: number): Snapshot {
  return {
    id,
    kind: 'lamp',
    label: id,
    color: SNAPSHOT_COLORS[0] ?? '#fff',
    createdAt: 0,
    measurements:
      shadeDiameter === undefined ? { totalHeight } : { totalHeight, shadeDiameter },
    proportion: 1,
  };
}

function body(id: string, stature: number, mass?: number): Snapshot {
  return {
    id,
    kind: 'body',
    label: id,
    color: SNAPSHOT_COLORS[1] ?? '#fff',
    createdAt: 0,
    measurements: mass === undefined ? { stature } : { stature, mass },
  };
}

test('a snapshot rebuilds to the same model every time', () => {
  const snapshot = lamp('a', 52, 28);
  const first = buildSnapshotModel(snapshot);
  const second = buildSnapshotModel(snapshot);
  assert.ok(Math.abs(first.height - second.height) < 1e-9);
  assert.ok(Math.abs(first.width - second.width) < 1e-9);
  for (const key of Object.keys(first.params)) {
    assert.equal(first.params[key]?.value, second.params[key]?.value, key);
  }
});

test('a rebuilt snapshot honours its measurements', () => {
  const model = buildSnapshotModel(lamp('a', 52, 28));
  assert.equal(model.params.totalHeight?.value, 52);
  assert.equal(model.params.shadeDiameter?.value, 28);
  // ...and the mesh really is that tall.
  assert.ok(Math.abs(model.height - 52) < 0.5, `mesh is ${model.height.toFixed(2)} cm tall`);
});

test('a body snapshot rebuilds with its measurements intact', () => {
  const model = buildSnapshotModel(body('b', 178, 82));
  assert.equal(model.params.stature?.value, 178);
  assert.ok(Math.abs((model.params.mass?.value ?? 0) - 82) / 82 < 0.02);
  assert.ok(Math.abs(model.height - 178) < 0.5);
});

test('side-by-side layout centres the row and never overlaps', () => {
  const models = [lamp('a', 40), lamp('b', 60), body('c', 175)].map(buildSnapshotModel);
  const placements = layOutSideBySide(models);
  assert.equal(placements.length, 3);

  // Each model's occupied span, in order, must be disjoint and increasing.
  let previousRight = -Infinity;
  const spans = models.map((model, i) => {
    const x = placements[i]?.x ?? 0;
    return { left: x + model.centreX - model.width / 2, right: x + model.centreX + model.width / 2 };
  });
  for (const span of spans) {
    assert.ok(span.left >= previousRight - 1e-6, 'models overlap');
    previousRight = span.right;
  }

  // The whole row is centred on the origin.
  const left = spans[0]?.left ?? 0;
  const right = spans[spans.length - 1]?.right ?? 0;
  assert.ok(Math.abs(left + right) < 1e-6, `row centre is ${(left + right) / 2}`);
});

test('layout handles a single model and an empty selection', () => {
  assert.deepEqual(layOutSideBySide([]), []);
  const [only] = layOutSideBySide([buildSnapshotModel(lamp('a', 45))]);
  assert.ok(only !== undefined);
  // A lone model is centred on the origin.
  const model = buildSnapshotModel(lamp('a', 45));
  assert.ok(Math.abs(only.x + model.centreX) < 1e-6);
});

test('dimension rows work across mixed kinds', () => {
  const models = [lamp('a', 45), body('b', 178)].map(buildSnapshotModel);
  const rows = dimensionRows(models);
  assert.deepEqual(
    rows.map((r) => r.key),
    ['height', 'width', 'depth'],
  );
  const height = rows[0];
  assert.ok(height !== undefined);
  assert.equal(height.cells[0]?.delta, undefined, 'the reference model has no delta');
  const delta = height.cells[1]?.delta;
  assert.ok(delta !== undefined && delta > 120, `body should tower over the lamp, got ${delta}`);
});

test('parameter rows compare like with like and refuse to mix kinds', () => {
  const sameKind = [lamp('a', 45), lamp('b', 60)].map(buildSnapshotModel);
  assert.ok(parameterRows(sameKind).length > 0);

  const mixed = [lamp('a', 45), body('b', 178)].map(buildSnapshotModel);
  assert.equal(parameterRows(mixed).length, 0, 'a lamp and a body must not be diffed');
});

test('parameter rows report the difference and its sign', () => {
  const models = [lamp('a', 40), lamp('b', 60)].map(buildSnapshotModel);
  const rows = parameterRows(models);
  const height = rows.find((r) => r.key === 'totalHeight');
  assert.ok(height !== undefined);
  assert.equal(height.cells[0]?.value, 40);
  assert.equal(height.cells[1]?.value, 60);
  assert.equal(height.cells[1]?.delta, 20);
  assert.ok(Math.abs((height.cells[1]?.relative ?? 0) - 0.5) < 1e-9);
});

test('provenance survives into the comparison table', () => {
  const models = [lamp('a', 45, 25), lamp('b', 45)].map(buildSnapshotModel);
  const rows = parameterRows(models);
  const shade = rows.find((r) => r.key === 'shadeDiameter');
  assert.ok(shade !== undefined);
  assert.equal(shade.cells[0]?.provenance, 'measured');
  assert.notEqual(shade.cells[1]?.provenance, 'measured');
});

test('significant rows drop what matches and sort by how much differs', () => {
  const models = [lamp('a', 40), lamp('b', 70)].map(buildSnapshotModel);
  const rows = significantRows(parameterRows(models));
  assert.ok(rows.length > 0);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(
      (rows[i - 1]?.spread ?? 0) >= (rows[i]?.spread ?? 0),
      'rows are not sorted by spread',
    );
  }
  // Identical models produce no rows at all.
  const identical = [lamp('a', 50), lamp('b', 50)].map(buildSnapshotModel);
  assert.equal(significantRows(parameterRows(identical)).length, 0);
});

test('comparing a model with itself reports no differences', () => {
  const snapshot = body('b', 172, 70);
  const models = [snapshot, { ...snapshot, id: 'copy' }].map(buildSnapshotModel);
  assert.equal(significantRows(parameterRows(models)).length, 0);
  assert.ok(significantRows(dimensionRows(models)).length === 0);
});

test('snapshot names describe what was measured', () => {
  assert.match(describeSnapshot('lamp', { totalHeight: 45, shadeDiameter: 25 }), /45 cm/);
  assert.match(describeSnapshot('body', { stature: 178, mass: 82 }), /178 cm.*82 kg/);
  assert.match(describeSnapshot('body', {}), /inferred/);
});

test('every palette colour is distinct', () => {
  assert.equal(new Set(SNAPSHOT_COLORS).size, SNAPSHOT_COLORS.length);
});
