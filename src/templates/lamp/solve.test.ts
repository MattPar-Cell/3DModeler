import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveLamp } from './solve.ts';
import { buildLampParts } from './build.ts';
import { meshVolume } from '../../core/loft.ts';
import { LAMP_PARAM_SPECS } from './spec.ts';
import {
  HARP_TOP_INSET,
  PROPORTION_MAX,
  SHADE_DIAMETER_OVER_BASE_DIAMETER,
} from './defaults.ts';

const TOLERANCE_CM = 1e-6;

test('entered measurements are reproduced exactly and marked measured', () => {
  const measurements = {
    totalHeight: 52,
    baseDiameter: 14,
    shadeDiameter: 28,
    stemDiameter: 3.2,
  };
  const { params } = solveLamp({ measurements });
  for (const [key, value] of Object.entries(measurements)) {
    const param = params[key as keyof typeof measurements];
    assert.ok(
      Math.abs(param.value - value) < TOLERANCE_CM,
      `${key}: reconstructed ${param.value}, entered ${value}`,
    );
    assert.equal(param.provenance, 'measured');
  }
});

/** The part of the finial that stands above the shade's top rim. */
function finialProtrusion(params: ReturnType<typeof solveLamp>['params']): number {
  return Math.max(0, params.finialHeight.value - params.shadeHeight.value * HARP_TOP_INSET);
}

test('part heights sum to the entered total height', () => {
  const { params } = solveLamp({ measurements: { totalHeight: 63 } });
  const sum =
    params.baseHeight.value +
    params.stemHeight.value +
    params.socketHeight.value +
    params.shadeHeight.value +
    finialProtrusion(params);
  assert.ok(Math.abs(sum - 63) < TOLERANCE_CM, `heights summed to ${sum}`);
});

test('the generated mesh is exactly as tall as the entered total height', () => {
  // The finial screws on above the shade, so it has to be inside the budget —
  // otherwise the lamp comes out taller than the number the user typed.
  for (const totalHeight of [18, 45, 120, 195]) {
    const { params } = solveLamp({ measurements: { totalHeight } });
    const parts = buildLampParts(params);
    let top = -Infinity;
    let bottom = Infinity;
    for (const part of parts) {
      const box = part.geometry.boundingBox;
      if (box === null) continue;
      top = Math.max(top, box.max.y);
      bottom = Math.min(bottom, box.min.y);
    }
    assert.ok(
      Math.abs(top - bottom - totalHeight) < 0.05,
      `${totalHeight} cm lamp generated a mesh ${(top - bottom).toFixed(2)} cm tall`,
    );
  }
});

test('the height-sum constraint reports satisfied across the plausible range', () => {
  for (let h = LAMP_PARAM_SPECS.totalHeight.min; h <= LAMP_PARAM_SPECS.totalHeight.max; h += 5) {
    const { constraints } = solveLamp({ measurements: { totalHeight: h } });
    const report = constraints.find((c) => c.id === 'height-sum');
    assert.ok(report?.satisfied, `height sum failed at ${h} cm`);
  }
});

test('unmeasured parameters are inferred, not measured', () => {
  const { params } = solveLamp({ measurements: { totalHeight: 45 } });
  assert.equal(params.totalHeight.provenance, 'measured');
  assert.equal(params.baseDiameter.provenance, 'estimated');
  assert.equal(params.shadeHeight.provenance, 'derived');
});

test('shade diameter is derived from a measured base at the trade ratio', () => {
  const { params } = solveLamp({ measurements: { baseDiameter: 12 } });
  assert.equal(params.shadeDiameter.provenance, 'derived');
  assert.ok(
    Math.abs(params.shadeDiameter.value - 12 * SHADE_DIAMETER_OVER_BASE_DIAMETER) < TOLERANCE_CM,
  );
});

test('base diameter is back-solved from a measured shade', () => {
  const { params } = solveLamp({ measurements: { shadeDiameter: 30 } });
  assert.equal(params.baseDiameter.provenance, 'derived');
  assert.ok(
    Math.abs(params.baseDiameter.value - 30 / SHADE_DIAMETER_OVER_BASE_DIAMETER) < TOLERANCE_CM,
  );
});

test('an inferred shade is widened to cover a measured base', () => {
  // Force the violation: measure a base wider than the shade the ratio gives.
  const { params, constraints } = solveLamp({
    measurements: { baseDiameter: 40, shadeDiameter: 20 },
  });
  const report = constraints.find((c) => c.id === 'shade-covers-base');
  // Both are measured here, so the solver must report rather than rewrite.
  assert.equal(report?.satisfied, false);
  assert.equal(params.baseDiameter.value, 40);
  assert.equal(params.shadeDiameter.value, 20);
});

test('a measured shade narrower than an inferred base narrows the base', () => {
  const { params, constraints } = solveLamp({
    measurements: { totalHeight: 190, shadeDiameter: 20 },
  });
  assert.ok(params.baseDiameter.value <= params.shadeDiameter.value + TOLERANCE_CM);
  assert.equal(constraints.find((c) => c.id === 'shade-covers-base')?.satisfied, true);
});

test('the stem always seats on the base neck when the base can accommodate it', () => {
  for (const stemDiameter of [0.8, 3, 8, 11]) {
    const { params, constraints } = solveLamp({
      measurements: { baseDiameter: 12, stemDiameter },
    });
    assert.equal(constraints.find((c) => c.id === 'stem-seats-on-base')?.satisfied, true);
    assert.ok(
      params.stemDiameter.value <= params.baseTopDiameter.value + TOLERANCE_CM,
      `stem ${params.stemDiameter.value} wider than neck ${params.baseTopDiameter.value}`,
    );
  }
});

test('a measured stem widens an inferred base rather than being narrowed', () => {
  const { params, constraints } = solveLamp({ measurements: { stemDiameter: 9 } });
  assert.equal(params.stemDiameter.value, 9, 'the measured stem was rewritten');
  assert.ok(params.baseDiameter.value >= 9, 'the inferred base did not grow');
  assert.equal(constraints.find((c) => c.id === 'stem-seats-on-base')?.satisfied, true);
});

test('a stem wider than a measured base is reported, not silently rewritten', () => {
  const { params, constraints } = solveLamp({
    measurements: { baseDiameter: 12, stemDiameter: 19 },
  });
  assert.equal(params.baseDiameter.value, 12);
  assert.equal(params.stemDiameter.value, 19);
  const report = constraints.find((c) => c.id === 'stem-seats-on-base');
  assert.equal(report?.satisfied, false);
  assert.ok(report?.resolution?.includes('wider than'));
});

test('the stem keeps a minimum share of the height even at maximum proportion', () => {
  const { params } = solveLamp({
    measurements: { totalHeight: 45 },
    proportion: PROPORTION_MAX,
  });
  assert.ok(params.stemHeight.value > 0, 'stem collapsed');
  assert.ok(params.stemHeight.value >= 45 * 0.2 - TOLERANCE_CM);
});

test('proportion lock leaves entered measurements pinned', () => {
  const measurements = { totalHeight: 50, baseDiameter: 15, shadeDiameter: 30, stemDiameter: 3 };
  const low = solveLamp({ measurements, proportion: 0.6 }).params;
  const high = solveLamp({ measurements, proportion: 1.4 }).params;
  for (const key of ['totalHeight', 'baseDiameter', 'shadeDiameter', 'stemDiameter'] as const) {
    assert.equal(low[key].value, high[key].value, `${key} moved under the proportion lock`);
  }
  // ...while inferred proportions do move.
  assert.ok(high.shadeHeight.value > low.shadeHeight.value * 1.5);
});

test('proportion lock scales inferred dimensions monotonically', () => {
  const measurements = { totalHeight: 50 };
  let previous = 0;
  for (const proportion of [0.6, 0.8, 1.0, 1.2, 1.4]) {
    const { params } = solveLamp({ measurements, proportion });
    assert.ok(params.shadeHeight.value > previous, 'shade height did not increase');
    previous = params.shadeHeight.value;
  }
});

test('out-of-range entries are clamped into the documented plausible range', () => {
  const { params } = solveLamp({ measurements: { totalHeight: 5000, stemDiameter: 0.01 } });
  assert.equal(params.totalHeight.value, LAMP_PARAM_SPECS.totalHeight.max);
  assert.ok(params.totalHeight.note?.includes('Clamped'));
  assert.ok(params.stemDiameter.value >= LAMP_PARAM_SPECS.stemDiameter.min);
});

test('non-finite and non-positive entries fall back to inference', () => {
  for (const bad of [0, -12, Number.NaN, Number.POSITIVE_INFINITY]) {
    const { params } = solveLamp({ measurements: { totalHeight: bad } });
    assert.notEqual(params.totalHeight.provenance, 'measured');
    assert.ok(Number.isFinite(params.totalHeight.value) && params.totalHeight.value > 0);
  }
});

test('an empty measurement set still produces a complete, plausible lamp', () => {
  const { params, constraints } = solveLamp({ measurements: {} });
  for (const param of Object.values(params)) {
    assert.ok(Number.isFinite(param.value), `${param.spec.key} is not finite`);
    assert.ok(param.value >= param.spec.min && param.value <= param.spec.max);
    assert.notEqual(param.provenance, 'measured');
  }
  assert.ok(constraints.every((c) => c.satisfied));
});

test('every generated part is a closed or intentionally open solid with real volume', () => {
  const { params } = solveLamp({ measurements: { totalHeight: 45, baseDiameter: 13 } });
  const parts = buildLampParts(params);
  assert.deepEqual(
    parts.map((p) => p.id),
    ['base', 'stem', 'socket', 'harp-l', 'harp-r', 'shade', 'finial'],
  );
  for (const part of parts) {
    const position = part.geometry.getAttribute('position');
    assert.ok(position.count > 0, `${part.id} has no vertices`);
    for (let i = 0; i < position.count; i += 1) {
      assert.ok(Number.isFinite(position.getX(i)), `${part.id} has a NaN vertex`);
    }
  }
  const base = parts.find((p) => p.id === 'base');
  assert.ok(base !== undefined && meshVolume(base.geometry) > 0);
});

test('provenance propagates through a chain of derivations', () => {
  // shadeTopDiameter <- shadeDiameter <- baseDiameter (measured). Two ratios
  // deep, but still traceable to a real measurement, so it is derived.
  const { params } = solveLamp({ measurements: { baseDiameter: 13 } });
  assert.equal(params.baseDiameter.provenance, 'measured');
  assert.equal(params.shadeDiameter.provenance, 'derived');
  assert.equal(params.shadeTopDiameter.provenance, 'derived');
  // Nothing constrains the height, so height-derived values stay estimated.
  assert.equal(params.totalHeight.provenance, 'estimated');
  assert.equal(params.shadeHeight.provenance, 'estimated');
});

test('generated parts inherit the confidence of the parameters that shaped them', () => {
  const { params } = solveLamp({ measurements: { baseDiameter: 13 } });
  const parts = buildLampParts(params);
  const shade = parts.find((p) => p.id === 'shade');
  // Nothing about the height was measured, so the shade cannot be better
  // than estimated even though its diameter is derived from a measurement.
  assert.equal(shade?.confidence, 'estimated');
});

test('regenerating the model stays inside the interaction budget', () => {
  const start = performance.now();
  const runs = 50;
  for (let i = 0; i < runs; i += 1) {
    const { params } = solveLamp({ measurements: { totalHeight: 40 + i } });
    buildLampParts(params);
  }
  const perRun = (performance.now() - start) / runs;
  assert.ok(perRun < 100, `regeneration took ${perRun.toFixed(2)} ms, budget is 100 ms`);
});

test('the harp arcs clear of the bulb and meets the finial', () => {
  const { params } = solveLamp({
    measurements: { totalHeight: 45, baseDiameter: 13, shadeDiameter: 25, stemDiameter: 3 },
  });
  const parts = buildLampParts(params);
  const harp = parts.find((p) => p.id === 'harp-l');
  const finial = parts.find((p) => p.id === 'finial');
  assert.ok(harp !== undefined && finial !== undefined);

  // The harp is a solid tube, wound outward like everything else.
  assert.ok(meshVolume(harp.geometry) > 0);

  const harpBox = harp.geometry.boundingBox;
  const finialBox = finial.geometry.boundingBox;
  assert.ok(harpBox !== null && finialBox !== null);

  // It must bow out far enough to clear the socket but stay inside the shade.
  assert.ok(harpBox.max.x > params.socketDiameter.value / 2, 'harp does not clear the socket');
  assert.ok(harpBox.max.x < params.shadeDiameter.value / 2, 'harp pokes through the shade');
  // ...and the finial sits on top of it.
  assert.ok(
    Math.abs(finialBox.min.y - harpBox.max.y) < 1,
    `finial base ${finialBox.min.y} is not at the harp top ${harpBox.max.y}`,
  );
});

test('the shade bows outward from the straight cone between its rims', () => {
  const { params } = solveLamp({
    measurements: { totalHeight: 45, shadeDiameter: 30 },
  });
  const parts = buildLampParts(params);
  const shade = parts.find((p) => p.id === 'shade');
  assert.ok(shade !== undefined);

  const bottom = params.shadeDiameter.value / 2;
  const top = params.shadeTopDiameter.value / 2;
  const position = shade.geometry.getAttribute('position');
  const height = params.shadeHeight.value;
  const y3 = shade.geometry.boundingBox?.min.y ?? 0;

  let maxExcess = 0;
  for (let i = 0; i < position.count; i += 1) {
    const t = (position.getY(i) - y3) / height;
    if (t < 0.2 || t > 0.8) continue; // skip the rims
    const straightCone = bottom + (top - bottom) * t;
    const radius = Math.hypot(position.getX(i), position.getZ(i));
    maxExcess = Math.max(maxExcess, radius - straightCone);
  }
  assert.ok(maxExcess > 0.05, 'the shade side is dead straight');
  assert.ok(maxExcess < bottom * 0.05, `bow of ${maxExcess.toFixed(2)} cm is too pronounced`);
});
