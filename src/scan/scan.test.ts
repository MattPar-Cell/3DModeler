import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backgroundDistance,
  estimateBackground,
  fillHoles,
  largestComponent,
  otsuThreshold,
  segmentSubject,
  buildBackgroundModel,
} from './segment.ts';
import { findCrotch, narrowestIn, silhouetteFrom, widestIn, widthAtFraction } from './silhouette.ts';
import { silhouetteHeightPx } from './types.ts';
import type { Mask, RasterImage } from './types.ts';
import { extractBody, extractLamp, scaleFromKnownHeight, scaleFromReference } from './extract.ts';
import { projectParts } from './project.ts';
import { checkBodyOutline, checkRatios, checkViewsMatch } from './plausibility.ts';
import type { OutlineRow, ProjectedOutline } from './project.ts';
import { solveLamp } from '../templates/lamp/solve.ts';
import { buildLampParts } from '../templates/lamp/build.ts';
import { buildBody } from '../body/build.ts';

/**
 * The scanner is tested against the app itself: generate a model, project its
 * outline, rasterise that into a synthetic photograph, scan the photograph and
 * check the measurements come back. No fixture images, and the whole pipeline —
 * segmentation, silhouette, landmark detection, extraction — runs every time.
 */

/** Draw an outline into an image: a light subject on a dark, slightly noisy ground. */
function rasterise(
  outline: ProjectedOutline,
  options: { width?: number; height?: number; margin?: number; noise?: number; seed?: number } = {},
): RasterImage {
  const width = options.width ?? 320;
  const height = options.height ?? 640;
  const margin = options.margin ?? 40;
  const noise = options.noise ?? 6;
  const data = new Uint8ClampedArray(width * height * 4);

  // A deterministic pseudo-random source, so a failure is always reproducible.
  let state = options.seed ?? 12345;
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  const subjectRows = height - margin * 2;
  const spanCm = outline.maxY - outline.minY;
  const pxPerCm = subjectRows / spanCm;
  const centreX = width / 2;

  for (let y = 0; y < height; y += 1) {
    // Row `height - 1 - margin` is the bottom of the subject.
    const t = (height - 1 - margin - y) / (subjectRows - 1);
    const rows = outline.rows.length;
    const index = Math.round(t * (rows - 1));
    const spans = t >= 0 && t <= 1 ? (outline.rows[index]?.spans ?? []) : [];

    for (let x = 0; x < width; x += 1) {
      const xCm = (x - centreX) / pxPerCm;
      let subject = false;
      for (const [left, right] of spans) {
        if (xCm >= left && xCm <= right) {
          subject = true;
          break;
        }
      }
      const i = (y * width + x) * 4;
      const base = subject ? 215 : 34;
      const jitter = (random() - 0.5) * 2 * noise;
      const value = Math.max(0, Math.min(255, base + jitter));
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** A uniform column, for tests that only need a shape of known width. */
function column(halfWidthCm: number, heightCm: number, rows = 40): ProjectedOutline {
  const spans: OutlineRow[] = Array.from({ length: rows }, () => ({
    spans: [[-halfWidthCm, halfWidthCm] as const],
  }));
  return {
    minY: 0,
    maxY: heightCm,
    rows: spans,
    halfWidths: Float64Array.from({ length: rows }, () => halfWidthCm),
    centres: new Float64Array(rows),
  };
}


/**
 * A synthetic A-pose: head, torso, two arms held clear, two legs.
 *
 * Built directly as a mask rather than from the body model, because the model
 * stands with its arms against its sides — which is exactly the pose the
 * scanner refuses to measure girths from.
 */
function aPoseMask(options: {
  width?: number;
  height?: number;
  chestHalf: number;
  waistHalf: number;
  hipHalf: number;
  armHalf?: number;
  armGap?: number;
  margin?: number;
}): Mask {
  const width = options.width ?? 400;
  const height = options.height ?? 900;
  const armHalf = options.armHalf ?? 14;
  const armGap = options.armGap ?? 12;
  const data = new Uint8Array(width * height);
  const top = options.margin ?? 40;
  const bottom = height - (options.margin ?? 40);
  const span = bottom - top;
  const centre = Math.round(width / 2);

  const set = (y: number, from: number, to: number): void => {
    for (let x = Math.max(0, Math.round(from)); x <= Math.min(width - 1, Math.round(to)); x += 1) {
      data[y * width + x] = 1;
    }
  };

  for (let y = top; y <= bottom; y += 1) {
    const t = (bottom - y) / span; // 0 at the feet
    if (t > 0.87) {
      set(y, centre - 26, centre + 26); // head
      continue;
    }
    if (t > 0.47) {
      // Torso, interpolated through the three landmark widths.
      const half =
        t > 0.72
          ? options.chestHalf
          : t > 0.63
            ? options.chestHalf + ((options.waistHalf - options.chestHalf) * (0.72 - t)) / 0.09
            : t > 0.53
              ? options.waistHalf + ((options.hipHalf - options.waistHalf) * (0.63 - t)) / 0.1
              : options.hipHalf;
      set(y, centre - half, centre + half);
      if (t < 0.8 && t > 0.5) {
        const inner = half + armGap;
        set(y, centre - inner - armHalf * 2, centre - inner);
        set(y, centre + inner, centre + inner + armHalf * 2);
      }
      continue;
    }
    // Legs
    set(y, centre - 46, centre - 12);
    set(y, centre + 12, centre + 46);
  }
  return { width, height, data };
}

function maskOf(image: RasterImage): Mask {
  return segmentSubject(image);
}

// --- segmentation ----------------------------------------------------------

test('background is estimated from the frame edge, not the subject', () => {
  const image = rasterise(column(2, 10), { noise: 0 });
  const background = estimateBackground(image);
  assert.ok(Math.abs(background.r - 34) < 2, `estimated ${background.r}`);
});

test('Otsu splits a two-peaked histogram between the peaks', () => {
  const values = new Uint8Array(2000);
  for (let i = 0; i < 1000; i += 1) values[i] = 20;
  for (let i = 1000; i < 2000; i += 1) values[i] = 200;
  const threshold = otsuThreshold(values);
  // Pixels *above* the threshold are foreground, so the split sits on the
  // lower peak: everything at 20 is background, everything at 200 is not.
  assert.ok(threshold >= 20 && threshold < 200, `threshold ${threshold}`);
  assert.ok(20 <= threshold && 200 > threshold);
});

test('Otsu survives a single-valued image', () => {
  const flat = new Uint8Array(100).fill(77);
  const threshold = otsuThreshold(flat);
  assert.ok(Number.isFinite(threshold));
});

test('background distance separates subject from ground', () => {
  const image = rasterise(column(1, 10), { noise: 0 });
  const distance = backgroundDistance(image, estimateBackground(image));
  const centre = distance[Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)];
  const corner = distance[0];
  assert.ok((centre ?? 0) > (corner ?? 0) + 50, `centre ${centre}, corner ${corner}`);
});

test('the largest connected component discards specks', () => {
  const width = 20;
  const height = 20;
  const mask = new Uint8Array(width * height);
  for (let y = 5; y < 15; y += 1) for (let x = 5; x < 15; x += 1) mask[y * width + x] = 1;
  mask[0] = 1; // a speck in the corner
  mask[1] = 1;
  const kept = largestComponent(mask, width, height);
  assert.equal(kept[0], 0, 'the speck survived');
  assert.equal(kept[10 * width + 10], 1, 'the subject was discarded');
});

test('holes inside the subject are filled', () => {
  const width = 20;
  const height = 20;
  const mask = new Uint8Array(width * height);
  for (let y = 4; y < 16; y += 1) for (let x = 4; x < 16; x += 1) mask[y * width + x] = 1;
  mask[10 * width + 10] = 0; // a dark logo
  const filled = fillHoles(mask, width, height);
  assert.equal(filled[10 * width + 10], 1, 'the hole was not filled');
  assert.equal(filled[0], 0, 'the background was filled in');
});

// --- silhouette ------------------------------------------------------------

test('a silhouette measures the width it was drawn with', () => {
  const image = rasterise(column(5, 100), { noise: 0 });
  const silhouette = silhouetteFrom(maskOf(image));
  const cmPerPixel = scaleFromKnownHeight(silhouette, 100);
  const widthCm = widthAtFraction(silhouette, 0.5) * cmPerPixel;
  assert.ok(Math.abs(widthCm - 10) < 0.5, `measured ${widthCm.toFixed(2)} cm, drew 10 cm`);
});

test('the narrowest and widest points are found where they were drawn', () => {
  // A dumbbell: wide, pinched at 40% of height, wide again.
  const rows = 100;
  const halfWidths = Float64Array.from({ length: rows }, (_, i) => {
    const t = i / (rows - 1);
    return Math.abs(t - 0.4) < 0.06 ? 2 : 8;
  });
  const image = rasterise(
    {
      minY: 0,
      maxY: 100,
      rows: Array.from({ length: rows }, (_, i) => ({
        spans: [[-(halfWidths[i] ?? 0), halfWidths[i] ?? 0] as const],
      })),
      halfWidths,
      centres: new Float64Array(rows),
    },
    { noise: 0 },
  );
  const silhouette = silhouetteFrom(maskOf(image));
  const pinch = narrowestIn(silhouette, 0.2, 0.7);
  // The drawn pinch is a flat-bottomed band, so any height inside it is right.
  assert.ok(pinch.t > 0.33 && pinch.t < 0.47, `pinch found at ${pinch.t.toFixed(3)}`);
  const wide = widestIn(silhouette, 0.6, 1);
  assert.ok(wide.width > pinch.width * 3);
});

test('the crotch is found where the outline splits in two', () => {
  const width = 200;
  const height = 400;
  const mask = new Uint8Array(width * height);
  const split = 260; // rows below this are two legs
  for (let y = 40; y < 380; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inTorso = y < split && Math.abs(x - 100) < 40;
      const inLeftLeg = y >= split && Math.abs(x - 78) < 16;
      const inRightLeg = y >= split && Math.abs(x - 122) < 16;
      if (inTorso || inLeftLeg || inRightLeg) mask[y * width + x] = 1;
    }
  }
  const silhouette = silhouetteFrom({ width, height, data: mask });
  const crotch = findCrotch(silhouette);
  assert.ok(crotch !== undefined, 'no crotch found');
  const expected = (379 - split) / (silhouetteHeightPx(silhouette) - 1);
  assert.ok(Math.abs(crotch - expected) < 0.02, `found ${crotch?.toFixed(3)}, expected ${expected.toFixed(3)}`);
});

test('no crotch is reported when the legs never separate', () => {
  const image = rasterise(column(6, 100), { noise: 0 });
  assert.equal(findCrotch(silhouetteFrom(maskOf(image))), undefined);
});

// --- scale -----------------------------------------------------------------

test('scale is derived from a known height or a reference length', () => {
  const image = rasterise(column(4, 50), { noise: 0 });
  const silhouette = silhouetteFrom(maskOf(image));
  const scale = scaleFromKnownHeight(silhouette, 50);
  assert.ok(Math.abs(silhouetteHeightPx(silhouette) * scale - 50) < 1e-9);
  assert.equal(scaleFromReference(200, 50), 0.25);
  assert.equal(scaleFromReference(0, 50), 0, 'a zero-length reference must not divide by zero');
});

// --- round trip: lamp ------------------------------------------------------

test('a lamp survives model to photograph to scan', () => {
  const entered = { totalHeight: 46, baseDiameter: 14, shadeDiameter: 28, stemDiameter: 3.2 };
  const { params } = solveLamp({ measurements: entered });
  const outline = projectParts(buildLampParts(params));
  const image = rasterise(outline, { width: 420, height: 760, margin: 50 });

  const silhouette = silhouetteFrom(maskOf(image));
  const scan = extractLamp(silhouette, scaleFromKnownHeight(silhouette, entered.totalHeight));

  const check = (key: keyof typeof entered, tolerance: number): void => {
    const value = scan.measurements[key];
    assert.ok(value !== undefined, `${key} was not extracted`);
    assert.ok(
      Math.abs(value - entered[key]) <= tolerance,
      `${key}: scanned ${value.toFixed(2)}, drew ${entered[key]} (tolerance ${tolerance})`,
    );
  };
  check('totalHeight', 0.01);
  check('baseDiameter', 1.0);
  check('shadeDiameter', 1.0);
  // The stem is the thinnest feature, so it takes the coarsest tolerance: at
  // this framing it is only about five pixels across.
  check('stemDiameter', 1.0);
});

test('a scanned lamp round-trips through the solver to the same geometry', () => {
  const entered = { totalHeight: 52, baseDiameter: 15, shadeDiameter: 30, stemDiameter: 3.5 };
  const original = solveLamp({ measurements: entered });
  const outline = projectParts(buildLampParts(original.params));
  const image = rasterise(outline, { width: 480, height: 860, margin: 50 });
  const silhouette = silhouetteFrom(maskOf(image));
  const scan = extractLamp(silhouette, scaleFromKnownHeight(silhouette, entered.totalHeight));

  const rebuilt = solveLamp({ measurements: scan.measurements });
  const rebuiltOutline = projectParts(buildLampParts(rebuilt.params));
  assert.ok(Math.abs(rebuiltOutline.maxY - outline.maxY) < 0.05);

  // The rebuilt silhouette should track the original's along its whole height.
  let worst = 0;
  for (let i = 0; i < outline.halfWidths.length; i += 1) {
    worst = Math.max(worst, Math.abs((outline.halfWidths[i] ?? 0) - (rebuiltOutline.halfWidths[i] ?? 0)));
  }
  assert.ok(worst < 1.2, `outlines diverge by up to ${worst.toFixed(2)} cm`);
});

test('scanning finds the lamp landmarks in the right order', () => {
  const { params } = solveLamp({ measurements: { totalHeight: 46, baseDiameter: 14, shadeDiameter: 28 } });
  const image = rasterise(projectParts(buildLampParts(params)), { width: 420, height: 760, margin: 50 });
  const scan = extractLamp(silhouetteFrom(maskOf(image)), 0.1);
  const byLabel = Object.fromEntries(scan.landmarks.map((l) => [l.label, l.t]));
  assert.ok(byLabel.Base !== undefined && byLabel.Stem !== undefined && byLabel.Shade !== undefined);
  assert.ok((byLabel.Base ?? 0) < (byLabel.Stem ?? 0), 'base found above the stem');
  assert.ok((byLabel.Stem ?? 0) < (byLabel.Shade ?? 0), 'stem found above the shade');
});

// --- round trip: body ------------------------------------------------------

test('a body survives model to photograph to scan', () => {
  const entered = { stature: 178, mass: 80, chest: 100, waist: 84, hip: 99, inseam: 82 };
  const model = buildBody({ measurements: entered });
  const image = rasterise(projectParts(model.parts), { width: 460, height: 900, margin: 50 });
  const silhouette = silhouetteFrom(maskOf(image));
  const scan = extractBody({
    front: silhouette,
    cmPerPixel: scaleFromKnownHeight(silhouette, entered.stature),
  });

  assert.ok(Math.abs((scan.measurements.stature ?? 0) - 178) < 0.05);
  const inseam = scan.measurements.inseam;
  assert.ok(inseam !== undefined, 'the crotch was not found');
  assert.ok(Math.abs(inseam - 82) < 4, `inseam scanned as ${inseam.toFixed(1)}, drew 82`);
});

test('girths are withheld when the arms are against the body', () => {
  // The body model stands with its arms down, which is precisely the pose that
  // fuses arm and torso into one run. Measuring it would report the span of the
  // arms as a waist.
  const entered = { stature: 174, mass: 72, chest: 96, waist: 80, hip: 96 };
  const model = buildBody({ measurements: entered });
  const image = rasterise(projectParts(model.parts), { width: 460, height: 900, margin: 50 });
  const silhouette = silhouetteFrom(maskOf(image));
  const scan = extractBody({
    front: silhouette,
    cmPerPixel: scaleFromKnownHeight(silhouette, entered.stature),
  });

  assert.equal(scan.measurements.chest, undefined);
  assert.equal(scan.measurements.waist, undefined);
  assert.equal(scan.measurements.hip, undefined);
  // ...but what the outline does support is still reported.
  assert.ok(Math.abs((scan.measurements.stature ?? 0) - 174) < 0.05);
  assert.ok(scan.measurements.inseam !== undefined);
  assert.ok(
    scan.notes.some((n) => n.severity === 'warning' && n.text.includes('A-pose')),
    'the pose problem must be named',
  );
});

test('an A-pose measures the torso, not the span of the arms', () => {
  const mask = aPoseMask({ chestHalf: 80, waistHalf: 64, hipHalf: 85 });
  const front = silhouetteFrom(mask);
  const cmPerPixel = scaleFromKnownHeight(front, 174);
  const scan = extractBody({ front, cmPerPixel });

  const waist = scan.measurements.waist;
  assert.ok(waist !== undefined, 'an A-pose must yield a waist');

  // The drawn waist is 84 px across. Anything near the arm-to-arm span — which
  // is more than twice that — means the wrong run was measured.
  const armSpan = (80 + 12 + 28) * 2 * cmPerPixel;
  const torsoWidth = 128 * cmPerPixel;
  assert.ok(
    waist < armSpan * 1.6,
    `waist ${waist.toFixed(1)} cm looks like the arm span, not the torso`,
  );
  // A circumference is necessarily larger than the width it was built from.
  assert.ok(waist > torsoWidth * 2, `waist ${waist.toFixed(1)} cm is implausibly small`);
  assert.ok(
    !scan.notes.some((n) => n.text.includes('A-pose')),
    'a correct pose must not be flagged',
  );
});

test('a side view replaces the assumed depth with a measured one', () => {
  const front = silhouetteFrom(aPoseMask({ chestHalf: 80, waistHalf: 64, hipHalf: 85 }));
  const cmPerPixel = scaleFromKnownHeight(front, 175);

  // A side view is the same pipeline with depth in place of width: a plain
  // column whose width is the subject's front-to-back depth.
  const side = silhouetteFrom(aPoseMask({ chestHalf: 34, waistHalf: 30, hipHalf: 36, armGap: 400 }));

  const frontOnly = extractBody({ front, cmPerPixel });
  const twoView = extractBody({ front, side, cmPerPixel });
  assert.ok(frontOnly.measurements.waist !== undefined);
  assert.ok(twoView.measurements.waist !== undefined);
  assert.notEqual(frontOnly.measurements.waist, twoView.measurements.waist);
  assert.ok(
    frontOnly.notes.some((n) => n.text.includes('assumed depth')),
    'a front-only scan must say its depths are assumed',
  );
  assert.ok(
    !twoView.notes.some((n) => n.text.includes('assumed depth')),
    'a two-view scan must not claim its depths are assumed',
  );
});

test('a cropped subject is reported rather than measured silently', () => {
  const image = rasterise(column(40, 100), { width: 60, height: 200, margin: 0, noise: 0 });
  const scan = extractLamp(silhouetteFrom(maskOf(image)), 0.5);
  assert.ok(
    scan.notes.some((n) => n.severity === 'warning' && n.text.includes('cropped')),
    'a subject filling the frame must be flagged as cropped',
  );
});

test('a scan of an empty frame degrades without throwing', () => {
  const width = 60;
  const height = 120;
  const data = new Uint8ClampedArray(width * height * 4).fill(30);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const silhouette = silhouetteFrom(maskOf({ width, height, data }));
  const scan = extractLamp(silhouette, 0.1);
  assert.ok(Number.isFinite(scan.measurements.totalHeight ?? 0));
  assert.ok(scan.notes.some((n) => n.severity === 'warning'));
});

test('a neck is only reported when the outline actually has one', () => {
  // The A-pose helper puts a head straight onto the shoulders with no neck
  // between them, which is what long hair or a collar does to a photograph.
  const front = silhouetteFrom(aPoseMask({ chestHalf: 80, waistHalf: 64, hipHalf: 85 }));
  const scan = extractBody({ front, cmPerPixel: scaleFromKnownHeight(front, 174) });
  assert.equal(scan.measurements.neck, undefined, 'a head was reported as a neck');
  assert.ok(scan.notes.some((n) => n.text.includes('No distinct neck')));
  // The measurements that do not depend on a neck are unaffected.
  assert.ok(scan.measurements.waist !== undefined);
});

test('the two views agree once both read the torso rather than the arms', () => {
  const front = silhouetteFrom(aPoseMask({ chestHalf: 80, waistHalf: 64, hipHalf: 85 }));
  const side = silhouetteFrom(aPoseMask({ chestHalf: 57, waistHalf: 50, hipHalf: 57 }));
  const cmPerPixel = scaleFromKnownHeight(front, 174);
  const frontOnly = extractBody({ front, cmPerPixel });
  const twoView = extractBody({ front, side, cmPerPixel });

  // The side view's depths are close to the priors here, so the two readings
  // should be near one another. A large gap means one of them is measuring the
  // arms.
  for (const key of ['chest', 'waist', 'hip'] as const) {
    const a = frontOnly.measurements[key];
    const b = twoView.measurements[key];
    assert.ok(a !== undefined && b !== undefined);
    assert.ok(
      Math.abs(a - b) / a < 0.25,
      `${key}: front-only ${a.toFixed(1)}, two-view ${b.toFixed(1)}`,
    );
  }
});

// --- refusing to measure a broken outline ----------------------------------

test('an outline that is not a person is refused rather than measured', () => {
  // A wide, squat blob: whatever it is, it is not someone standing up.
  const width = 400;
  const height = 900;
  const data = new Uint8Array(width * height);
  for (let y = 300; y < 500; y += 1) {
    for (let x = 60; x < 340; x += 1) data[y * width + x] = 1;
  }
  const silhouette = silhouetteFrom({ width, height, data });
  const verdict = checkBodyOutline(silhouette);
  assert.equal(verdict.usable, false);
  assert.ok(verdict.aspect < 1.6, `aspect ${verdict.aspect}`);

  const scan = extractBody({ front: silhouette, cmPerPixel: 0.5 });
  assert.deepEqual(scan.measurements, {}, 'nothing should be reported');
  assert.ok(scan.notes.some((n) => n.severity === 'warning'));
});

test('a mask covering nearly its whole bounding box is refused', () => {
  const width = 300;
  const height = 900;
  const data = new Uint8Array(width * height).fill(0);
  for (let y = 50; y < 850; y += 1) {
    for (let x = 40; x < 260; x += 1) data[y * width + x] = 1;
  }
  const verdict = checkBodyOutline(silhouetteFrom({ width, height, data }));
  assert.equal(verdict.usable, false);
  assert.ok(verdict.fill > 0.78, `fill ${verdict.fill}`);
  assert.ok(verdict.notes.some((n) => n.text.includes('background')));
});

test('measurements impossible for the stature given are withheld', () => {
  // Exactly the beach failure: the mask covered forehead to knees, so the
  // height the operator typed was divided over too few pixels and every ratio
  // went somewhere no body goes.
  const check = checkRatios({ stature: 156, shoulderWidth: 12.7, waist: 40 });
  assert.ok(check.implausible.includes('shoulderWidth'));
  assert.ok(check.implausible.includes('waist'));
  assert.ok(check.notes.some((n) => n.text.includes('% of the height entered')));

  // A real set passes untouched.
  const fine = checkRatios({ stature: 174, shoulderWidth: 43, waist: 78, hip: 96, inseam: 81 });
  assert.deepEqual(fine.implausible, []);
});

test('a sliver of a subject is refused rather than measured', () => {
  // The beach failure's shape: a tall, narrow mask that caught the torso and
  // one leg. Nothing about it is a whole person, and the 12.7 cm shoulder it
  // produced was the visible symptom.
  const width = 400;
  const height = 900;
  const data = new Uint8Array(width * height);
  for (let y = 80; y < 860; y += 1) {
    for (let x = 190; x < 230; x += 1) data[y * width + x] = 1;
  }
  const silhouette = silhouetteFrom({ width, height, data });
  const verdict = checkBodyOutline(silhouette);
  assert.equal(verdict.usable, false);
  assert.ok(verdict.aspect > 6.5, `aspect ${verdict.aspect}`);
  assert.ok(verdict.notes.some((n) => n.text.includes('sliver')));

  const scan = extractBody({ front: silhouette, cmPerPixel: scaleFromKnownHeight(silhouette, 156) });
  assert.deepEqual(scan.measurements, {}, 'nothing should be reported');
});

test('a side view in a different pose is rejected for depth', () => {
  const front = silhouetteFrom(aPoseMask({ chestHalf: 80, waistHalf: 64, hipHalf: 85 }));
  // A side view cropped to the lower body: the subject fills a different share
  // of the frame, so one scale cannot serve both.
  const cropped = aPoseMask({
    chestHalf: 57,
    waistHalf: 50,
    hipHalf: 57,
    height: 1600,
    margin: 400,
  });
  const side = silhouetteFrom(cropped);
  const match = checkViewsMatch(front, side);
  assert.equal(match.usable, false);
  assert.ok(match.notes.some((n) => n.text.includes('cropped differently')));

  // ...and the extraction says so rather than silently using it.
  const scan = extractBody({
    front,
    side,
    cmPerPixel: scaleFromKnownHeight(front, 174),
  });
  assert.ok(scan.notes.some((n) => n.text.includes('not used for depth')));
  assert.ok(scan.notes.some((n) => n.text.includes('assumed depth')), 'it must fall back');
});

// --- a background that is not one colour -----------------------------------

/**
 * A photograph like the one that broke the first version: sky, rock, sea and
 * sand stacked up the frame, and a subject whose legs are close in colour to
 * the sand they are standing on.
 */
function beachScene(options: { legMatchesSand: boolean }): RasterImage {
  const width = 420;
  const height = 900;
  const data = new Uint8ClampedArray(width * height * 4);
  let state = 4242;
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  const sky: [number, number, number] = [128, 176, 214];
  const rock: [number, number, number] = [188, 172, 148];
  const sea: [number, number, number] = [72, 128, 142];
  const sand: [number, number, number] = [206, 190, 165];
  const skin: [number, number, number] = [188, 146, 116];
  // Lower legs deliberately close to the sand: this is the pairing that lost
  // them, and the whole point of modelling the background as several colours.
  const leg: [number, number, number] = options.legMatchesSand ? [202, 186, 162] : skin;

  const top = 60;
  const bottom = height - 60;
  const span = bottom - top;
  const centre = width / 2;

  for (let y = 0; y < height; y += 1) {
    const background =
      y < height * 0.3 ? sky : y < height * 0.52 ? rock : y < height * 0.68 ? sea : sand;

    for (let x = 0; x < width; x += 1) {
      let colour = background;
      if (y >= top && y <= bottom) {
        const t = (bottom - y) / span;
        let half = 0;
        let offset = 0;
        if (t > 0.87) half = 26;
        else if (t > 0.47) half = t > 0.7 ? 46 : t > 0.6 ? 38 : 48;
        else {
          // Two legs, apart.
          half = 17;
          offset = x < centre ? -26 : 26;
        }
        const inside = Math.abs(x - (centre + offset)) <= half;
        // Arms held clear of the torso but attached at the shoulder: a floating
        // arm is a separate component and gets discarded, which is a property of
        // the drawing rather than of the scanner.
        const fromCentre = Math.abs(x - centre);
        const arm = t > 0.5 && t < 0.82 && fromCentre >= half - 4 && fromCentre <= half + 40;
        if (inside || arm) colour = t < 0.4 ? leg : skin;
      }
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        data[i + c] = Math.max(0, Math.min(255, (colour[c] ?? 0) + (random() - 0.5) * 10));
      }
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

test('a four-colour background does not swallow the subject', () => {
  const image = beachScene({ legMatchesSand: false });
  const silhouette = silhouetteFrom(segmentSubject(image));
  const drawnHeight = 900 - 120 + 1;
  assert.ok(
    Math.abs(silhouetteHeightPx(silhouette) - drawnHeight) < drawnHeight * 0.05,
    `recovered ${silhouetteHeightPx(silhouette)} px of a ${drawnHeight} px subject`,
  );
  assert.equal(checkBodyOutline(silhouette).usable, true);
});

test('a background model of one colour is not enough for four', () => {
  // The palette has to contain more than one entry, or sky and sand are
  // averaged into a colour that appears nowhere and nothing separates cleanly.
  const model = buildBackgroundModel(beachScene({ legMatchesSand: false }));
  assert.ok(model.modes.length >= 3, `found only ${model.modes.length} background colours`);
});

test('legs that match the background are recovered by a click', () => {
  const image = beachScene({ legMatchesSand: true });

  // Without help, the legs are close enough to the sand to be lost.
  const auto = silhouetteFrom(segmentSubject(image));
  const drawnHeight = 900 - 120 + 1;
  const autoHeight = silhouetteHeightPx(auto);

  // One mark on a shin. The leg survives thresholding as its own component and
  // is otherwise discarded for not being the largest; a seed keeps it.
  const seeded = silhouetteFrom(
    segmentSubject(image, {
      seeds: [
        { x: 184, y: 800, kind: 'subject' },
        { x: 236, y: 800, kind: 'subject' },
        { x: 210, y: 300, kind: 'subject' },
      ],
    }),
  );
  const seededHeight = silhouetteHeightPx(seeded);

  assert.ok(
    seededHeight >= autoHeight,
    `marking made it worse: ${autoHeight} px became ${seededHeight} px`,
  );
  assert.ok(
    seededHeight > drawnHeight * 0.9,
    `still only ${seededHeight} px of a ${drawnHeight} px subject after marking`,
  );
});
