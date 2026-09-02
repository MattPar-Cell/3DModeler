import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitBody, priorBody } from './fit.ts';
import { BODY_PARAM_SPECS } from './spec.ts';
import type { BodyMeasurements } from './spec.ts';
import { bodyVolumeLitres, buildBodySegments, buildSkeleton } from './segments.ts';
import { circumferenceAt, measureBody, meshStature } from './measure.ts';
import * as A from '../constants/anthropometry.ts';

/**
 * Tolerances. Circumferences are matched by construction, so they get a tight
 * bound; mass is matched by a bounded 1-D search, so it gets the search's own
 * convergence tolerance.
 */
const CIRCUMFERENCE_TOLERANCE_CM = 0.25;
const LENGTH_TOLERANCE_CM = 0.05;
const MASS_TOLERANCE_FRACTION = 0.02;

const FULL: BodyMeasurements = {
  stature: 178,
  mass: 76,
  chest: 100,
  waist: 84,
  hip: 99,
  inseam: 82,
  shoulderWidth: 46,
  neck: 39,
  thigh: 58,
  bicep: 32,
  forearmLength: 26,
  wrist: 17,
};

test('every entered measurement is reproduced by the generated mesh', () => {
  const fit = fitBody({ measurements: FULL });
  assert.equal(fit.residuals.length, Object.keys(FULL).length);
  for (const residual of fit.residuals) {
    const tolerance =
      residual.key === 'mass'
        ? residual.target * MASS_TOLERANCE_FRACTION
        : residual.key === 'stature' || residual.key === 'inseam' || residual.key === 'forearmLength' || residual.key === 'shoulderWidth'
          ? LENGTH_TOLERANCE_CM
          : CIRCUMFERENCE_TOLERANCE_CM;
    assert.ok(
      Math.abs(residual.error) <= tolerance,
      `${residual.key}: reconstructed ${residual.reconstructed.toFixed(2)}, entered ${residual.target}, error ${residual.error.toFixed(3)} (tolerance ${tolerance})`,
    );
  }
});

test('the fit objective is near zero when the measurements are consistent', () => {
  const fit = fitBody({ measurements: FULL });
  assert.ok(fit.objective < 1e-3, `objective ${fit.objective}`);
});

test('circumferences are reproduced across a wide range of builds', () => {
  const builds: BodyMeasurements[] = [
    { stature: 150, chest: 78, waist: 62, hip: 86 },
    { stature: 165, chest: 92, waist: 74, hip: 98 },
    { stature: 178, chest: 100, waist: 84, hip: 99 },
    { stature: 190, chest: 128, waist: 118, hip: 122 },
    { stature: 205, chest: 115, waist: 95, hip: 110 },
  ];
  for (const measurements of builds) {
    const fit = fitBody({ measurements });
    for (const residual of fit.residuals) {
      assert.ok(
        Math.abs(residual.error) <= CIRCUMFERENCE_TOLERANCE_CM,
        `${JSON.stringify(measurements)} ${residual.key}: error ${residual.error.toFixed(3)}`,
      );
    }
  }
});

test('weight is matched by the girth search when girths are free', () => {
  for (const mass of [52, 68, 84, 110]) {
    const fit = fitBody({ measurements: { stature: 175, mass } });
    const residual = fit.residuals.find((r) => r.key === 'mass');
    assert.ok(residual !== undefined, 'no mass residual');
    assert.ok(
      Math.abs(residual.error) / mass < MASS_TOLERANCE_FRACTION,
      `${mass} kg: reconstructed ${residual.reconstructed.toFixed(1)} kg`,
    );
  }
});

test('a measured circumference is never overwritten to satisfy the weight', () => {
  // 175 cm at 120 kg cannot be reached with a 78 cm waist. The waist must hold.
  const fit = fitBody({ measurements: { stature: 175, mass: 120, waist: 78 } });
  const waist = fit.residuals.find((r) => r.key === 'waist');
  assert.ok(waist !== undefined);
  assert.ok(
    Math.abs(waist.error) <= CIRCUMFERENCE_TOLERANCE_CM,
    `waist moved by ${waist.error.toFixed(2)} cm`,
  );
  assert.equal(fit.params.waist.provenance, 'measured');
});

test('an unreachable weight is reported rather than silently absorbed', () => {
  const overConstrained = fitBody({
    measurements: { stature: 175, mass: 200, chest: 90, waist: 74, hip: 92, thigh: 52, bicep: 28, neck: 36, wrist: 16 },
  });
  const report = overConstrained.constraints.find((c) => c.id === 'mass-matched');
  assert.equal(report?.satisfied, false);
  assert.ok(report?.resolution?.includes('disagree'));
});

test('the girth search stays inside its documented bounds', () => {
  for (const mass of [30, 250]) {
    const fit = fitBody({ measurements: { stature: 170, mass } });
    assert.ok(fit.values.girthScale >= A.GIRTH_SCALE_MIN - 1e-6);
    assert.ok(fit.values.girthScale <= A.GIRTH_SCALE_MAX + 1e-6);
  }
});

test('a measured chest pulls the un-measured underbust with it', () => {
  const prior = fitBody({ measurements: { stature: 175 } });
  const large = fitBody({ measurements: { stature: 175, chest: 125 } });
  assert.ok(
    large.values.underbust > prior.values.underbust * 1.15,
    `underbust ${large.values.underbust.toFixed(1)} vs prior ${prior.values.underbust.toFixed(1)}`,
  );
  assert.equal(large.params.underbust.provenance, 'derived');
});

test('a torso measurement nudges the limbs but is not called a derivation', () => {
  const prior = fitBody({ measurements: { stature: 175 } });
  const large = fitBody({ measurements: { stature: 175, chest: 125, waist: 110, hip: 120 } });
  assert.ok(large.values.thigh > prior.values.thigh, 'thigh did not follow the torso');
  // A chest measurement standing in for a thigh is a weak inference, so the
  // thigh stays `estimated` and keeps rendering translucent. Someone who
  // measured only their torso should still see uncertain legs.
  assert.equal(large.params.thigh.provenance, 'estimated');
  assert.ok(large.params.thigh.note?.includes('scaled'));
});

// --- body-part-only mode ---------------------------------------------------

test('body part only: forearm length and wrist fit that segment exactly', () => {
  const fit = fitBody({ measurements: { forearmLength: 27, wrist: 16.5 } });

  const forearmLength = fit.residuals.find((r) => r.key === 'forearmLength');
  const wrist = fit.residuals.find((r) => r.key === 'wrist');
  assert.ok(forearmLength !== undefined && wrist !== undefined);
  assert.ok(
    Math.abs(forearmLength.error) <= LENGTH_TOLERANCE_CM,
    `forearm length error ${forearmLength.error}`,
  );
  assert.ok(Math.abs(wrist.error) <= CIRCUMFERENCE_TOLERANCE_CM, `wrist error ${wrist.error}`);

  // ...and the rest of the body is inferred from them, not left at the default.
  assert.equal(fit.params.stature.provenance, 'derived');
  assert.ok(
    Math.abs(fit.params.stature.value - 27 / A.FOREARM_LENGTH) < 1e-6,
    `stature ${fit.params.stature.value}`,
  );
  assert.equal(fit.regions.find((r) => r.region === 'forearm')?.provenance, 'measured');
  // The torso girths rest on priors alone: a forearm says nothing about a waist.
  assert.equal(fit.regions.find((r) => r.region === 'waist')?.provenance, 'estimated');
  assert.equal(fit.regions.find((r) => r.region === 'neck')?.provenance, 'estimated');
});

test('body part only: a measured segment is marked measured, the rest is not', () => {
  const fit = fitBody({ measurements: { forearmLength: 27, wrist: 16.5 } });
  const byRegion = Object.fromEntries(fit.regions.map((r) => [r.region, r.provenance]));
  assert.equal(byRegion.forearm, 'measured');
  assert.equal(byRegion.hand, 'measured');
  // Torso girths have nothing comparable to lean on.
  assert.equal(byRegion.waist, 'estimated');
  assert.equal(byRegion.neck, 'estimated');
  // Limb girths share a scaling group with the measured wrist, so they are a
  // genuine derivation rather than a bare prior.
  assert.equal(byRegion.thigh, 'derived');
});

test('inseam alone back-solves a plausible stature', () => {
  const fit = fitBody({ measurements: { inseam: 82 } });
  assert.equal(fit.params.stature.provenance, 'derived');
  assert.ok(
    Math.abs(fit.params.stature.value - 82 / A.CROTCH_HEIGHT) < 1e-6,
    `stature ${fit.params.stature.value}`,
  );
  // The inseam itself must survive the round trip.
  const residual = fit.residuals.find((r) => r.key === 'inseam');
  assert.ok(Math.abs(residual?.error ?? 99) <= LENGTH_TOLERANCE_CM);
});

// --- provenance and regions ------------------------------------------------

test('an empty measurement set produces a complete, plausible body', () => {
  const fit = fitBody({ measurements: {} });
  for (const param of Object.values(fit.params)) {
    assert.ok(Number.isFinite(param.value), `${param.spec.key} not finite`);
    assert.ok(
      param.value >= param.spec.min && param.value <= param.spec.max,
      `${param.spec.key} = ${param.value} outside ${param.spec.min}-${param.spec.max}`,
    );
  }
  assert.equal(fit.params.stature.provenance, 'estimated');
  // Every region is estimated: nothing was measured.
  assert.ok(fit.regions.every((r) => r.provenance === 'estimated'));
  // ...and the default body should still have a believable BMI.
  const bmi = fit.values.mass / (fit.values.stature / 100) ** 2;
  assert.ok(bmi > 18 && bmi < 32, `default BMI ${bmi.toFixed(1)}`);
});

test('regions report measured only when everything shaping them was measured', () => {
  const fit = fitBody({ measurements: { stature: 175, waist: 80 } });
  assert.equal(fit.regions.find((r) => r.region === 'waist')?.provenance, 'measured');
  assert.equal(fit.regions.find((r) => r.region === 'chest')?.provenance, 'derived');
  assert.equal(fit.regions.find((r) => r.region === 'head')?.provenance, 'derived');
});

test('out-of-range entries are clamped into the documented plausible range', () => {
  const fit = fitBody({ measurements: { stature: 400, mass: 900 } });
  assert.equal(fit.params.stature.value, BODY_PARAM_SPECS.stature.max);
  assert.ok(fit.params.stature.note?.includes('Clamped'));
});

test('an implausible inseam is corrected and reported', () => {
  const fit = fitBody({ measurements: { stature: 170, inseam: 105 } });
  const report = fit.constraints.find((c) => c.id === 'inseam-leaves-a-torso');
  assert.equal(report?.satisfied, false);
  assert.ok(fit.values.inseam <= 170 * 0.56 + 1e-9);
});

// --- geometry sanity -------------------------------------------------------

test('height and inseam are reconciled without breaking either', () => {
  // A long inseam for the height: the legs get theirs, the torso absorbs it.
  const fit = fitBody({ measurements: { stature: 175, inseam: 90 } });
  assert.ok(Math.abs(fit.skeleton.crotchY - 90) < 1e-9);
  assert.ok(Math.abs(meshStature(fit.segments) - 175) < LENGTH_TOLERANCE_CM);
  // Landmarks stay correctly ordered.
  const s = fit.skeleton;
  assert.ok(s.ankleY < s.kneeY);
  assert.ok(s.kneeY < s.crotchY);
  assert.ok(s.crotchY < s.hipY);
  assert.ok(s.hipY < s.waistY);
  assert.ok(s.waistY < s.chestY);
  assert.ok(s.chestY < s.shoulderY);
  assert.ok(s.shoulderY < s.chinY);
  assert.ok(s.chinY < s.stature);
});

test('every segment encloses a positive volume (faces wound outward)', () => {
  const fit = fitBody({ measurements: FULL });
  for (const segment of fit.segments) {
    const litres = bodyVolumeLitres([segment]);
    assert.ok(litres > 0, `${segment.id} has volume ${litres}`);
    assert.ok(Number.isFinite(litres), `${segment.id} volume is not finite`);
  }
});

test('the body is bilaterally symmetric', () => {
  const fit = fitBody({ measurements: FULL });
  const skeleton = fit.skeleton;
  for (const [left, right] of [
    ['thigh-l', 'thigh-r'],
    ['upperarm-l', 'upperarm-r'],
    ['forearm-l', 'forearm-r'],
  ] as const) {
    const l = circumferenceAt(fit.segments, left, skeleton.crotchY);
    const r = circumferenceAt(fit.segments, right, skeleton.crotchY);
    if (l === undefined || r === undefined) continue;
    assert.ok(Math.abs(l - r) < 1e-9, `${left}/${right} differ`);
  }
  assert.ok(
    Math.abs(bodyVolumeLitres(fit.segments.filter((s) => s.id.endsWith('-l'))) -
      bodyVolumeLitres(fit.segments.filter((s) => s.id.endsWith('-r')))) < 1e-6,
  );
});

test('no vertex is NaN for any plausible measurement set', () => {
  const cases: BodyMeasurements[] = [
    {},
    { stature: A.STATURE_MIN_CM },
    { stature: A.STATURE_MAX_CM },
    { stature: 170, mass: A.MASS_MIN_KG },
    { stature: 170, mass: A.MASS_MAX_KG },
    { wrist: 12 },
    { forearmLength: 40 },
    { inseam: 50 },
  ];
  for (const measurements of cases) {
    const fit = fitBody({ measurements });
    for (const segment of fit.segments) {
      for (const ring of segment.rings) {
        for (const point of ring) {
          assert.ok(
            Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
            `${JSON.stringify(measurements)} produced a NaN vertex in ${segment.id}`,
          );
        }
      }
    }
  }
});

test('mesh volume tracks a hand-checked reference', () => {
  // A 178 cm, 76 kg body should enclose roughly 75 litres at 1.01 kg/L.
  const values = fitBody({ measurements: { stature: 178, mass: 76 } }).values;
  const litres = bodyVolumeLitres(buildBodySegments(values));
  assert.ok(litres > 70 && litres < 80, `${litres.toFixed(1)} litres`);
});

test('refitting stays inside the interaction budget', () => {
  const start = performance.now();
  const runs = 20;
  for (let i = 0; i < runs; i += 1) {
    fitBody({ measurements: { stature: 160 + i, mass: 60 + i, chest: 90 + i } });
  }
  const perRun = (performance.now() - start) / runs;
  assert.ok(perRun < 100, `fit took ${perRun.toFixed(1)} ms, budget is 100 ms`);
});

test('measureBody reads the mesh, not the parameters', () => {
  // Deliberately hand measureBody a body built from different numbers than the
  // ones we compare against: the readback must follow the mesh.
  const values = fitBody({ measurements: { stature: 175, chest: 95 } }).values;
  const stretched = { ...values, chest: values.chest * 1.5 };
  const readback = measureBody(buildBodySegments(stretched), buildSkeleton(stretched));
  assert.ok(readback.chest !== undefined);
  assert.ok(
    Math.abs(readback.chest - values.chest * 1.5) < CIRCUMFERENCE_TOLERANCE_CM,
    `readback ${readback.chest?.toFixed(2)}`,
  );
});

test('a body built from the priors alone lands on population weight data', () => {
  // ANSUR II reports a male mean of 175.6 cm and about 85.5 kg [2]. The priors
  // in `anthropometry.ts` are the midpoint of the male and female ratios, so a
  // body built from them at male mean stature should sit close to that figure.
  // This is the one test that checks the whole pipeline — priors, cross-section
  // shapes, segment layout and density — against outside data rather than
  // against itself.
  const mass = priorBody(175.6).mass;
  assert.ok(mass > 78 && mass < 93, `prior body reconstructs to ${mass.toFixed(1)} kg`);
});

test('the prior body is geometrically similar at every stature', () => {
  // Every length prior is a fraction of stature, so the un-scaled prior body
  // must be a pure scale copy of itself: volume goes as the cube of height.
  const expected = (190 / 150) ** 3;
  const actual = priorBody(190).mass / priorBody(150).mass;
  assert.ok(
    Math.abs(actual - expected) / expected < 0.01,
    `mass ratio ${actual.toFixed(3)}, expected ${expected.toFixed(3)}`,
  );
});

test('a body with only a height entered lands on the default BMI', () => {
  // With nothing constraining girth, the fit aims at a body of typical build
  // rather than letting the priors compose into an arbitrary weight.
  for (const stature of [150, 165, 178, 195]) {
    const fit = fitBody({ measurements: { stature } });
    const bmi = fit.values.mass / (stature / 100) ** 2;
    assert.ok(
      Math.abs(bmi - A.DEFAULT_BMI) / A.DEFAULT_BMI < 0.05,
      `${stature} cm gave BMI ${bmi.toFixed(1)}, expected ~${A.DEFAULT_BMI}`,
    );
  }
});

test('reported mass does not depend on mesh resolution', () => {
  // The girth search runs on a coarse mesh and the viewer shows a fine one, so
  // the inscription correction in bodyVolumeLitres has to hold them together.
  const values = priorBody(175.6);
  const coarse = bodyVolumeLitres(buildBodySegments(values, 24));
  const fine = bodyVolumeLitres(buildBodySegments(values, 128));
  assert.ok(
    Math.abs(coarse - fine) / fine < 0.006,
    `24 segments gave ${coarse.toFixed(2)} L, 128 gave ${fine.toFixed(2)} L`,
  );
});

test('the spine curve does not corrupt torso circumferences', () => {
  // Torso sections are centred on a curved spine, so their centres move
  // front-to-back between rings. A tape around a chest is horizontal, so that
  // motion must not be treated as a limb-style tilt.
  const fit = fitBody({ measurements: { stature: 178, chest: 104, waist: 88, hip: 106 } });
  for (const key of ['chest', 'waist', 'hip'] as const) {
    const residual = fit.residuals.find((r) => r.key === key);
    assert.ok(residual !== undefined);
    assert.ok(
      Math.abs(residual.error) < 0.05,
      `${key} off by ${residual.error.toFixed(3)} cm once the spine curves`,
    );
  }
});

test('the torso is offset front-to-back by the spine curve', () => {
  const fit = fitBody({ measurements: { stature: 175 } });
  const s = fit.skeleton;
  // Lumbar lordosis forward, thoracic kyphosis back — a real standing posture,
  // not a stack of concentric tubes.
  assert.ok(s.spineAt(s.waistY) > s.spineAt(s.chestY), 'no sagittal curve');
  assert.ok(s.spineAt(s.waistY) > s.spineAt(s.hipY));
  assert.ok(Math.abs(s.spineAt(s.waistY)) < 0.02 * 175, 'curve is implausibly large');
});

test('the hips are deeper behind the spine than in front', () => {
  const fit = fitBody({ measurements: { stature: 178, hip: 100 } });
  const pelvis = fit.segments.find((seg) => seg.id === 'pelvis');
  assert.ok(pelvis !== undefined);
  const hipRing = pelvis.rings.reduce((best, ring) =>
    Math.abs((ring[0]?.y ?? 0) - fit.skeleton.hipY) <
    Math.abs((best[0]?.y ?? 0) - fit.skeleton.hipY)
      ? ring
      : best,
  );
  const centre = fit.skeleton.spineAt(fit.skeleton.hipY);
  let front = 0;
  let back = 0;
  for (const p of hipRing) {
    front = Math.max(front, p.z - centre);
    back = Math.max(back, centre - p.z);
  }
  assert.ok(back > front * 1.5, `buttocks not modelled: front ${front.toFixed(1)}, back ${back.toFixed(1)}`);
});

test('the foot reaches forward of the ankle and rests on the floor', () => {
  const fit = fitBody({ measurements: { stature: 178 } });
  const foot = fit.segments.find((seg) => seg.id === 'foot-l');
  assert.ok(foot !== undefined);
  let minY = Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const ring of foot.rings) {
    for (const p of ring) {
      minY = Math.min(minY, p.y);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  assert.ok(minY >= -0.01 && minY < 0.01, `sole sits at y = ${minY.toFixed(2)}`);
  const length = maxZ - minZ;
  assert.ok(
    Math.abs(length - fit.values.footLength) / fit.values.footLength < 0.05,
    `foot is ${length.toFixed(1)} cm long, expected ${fit.values.footLength.toFixed(1)}`,
  );
  assert.ok(minZ < 0 && maxZ > 0, 'the heel should sit behind the ankle and the toes in front');
});

test('a foot encloses a plausible volume', () => {
  const fit = fitBody({ measurements: { stature: 178, mass: 78 } });
  const foot = fit.segments.find((seg) => seg.id === 'foot-l');
  assert.ok(foot !== undefined);
  const litres = bodyVolumeLitres([foot]);
  // An adult foot displaces roughly 0.8-1.2 litres.
  assert.ok(litres > 0.6 && litres < 1.5, `foot volume ${litres.toFixed(2)} L`);
});
