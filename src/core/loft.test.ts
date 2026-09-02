import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loftGeometry, meshVolume, ringStackVolume } from './loft.ts';
import {
  circleRing,
  revolveProfile,
  ringCircumference,
  sampleProfile,
  superellipseRing,
  superellipseRingForCircumference,
} from './profile.ts';
import { ellipseAxesFromPerimeter, ellipsePerimeter } from './math.ts';

const SEGMENTS = 64;

function cylinderRings(radius: number, height: number, rows = 8) {
  return revolveProfile(
    [
      { t: 0, radius },
      { t: 1, radius },
    ],
    0,
    height,
    rows,
    SEGMENTS,
  );
}

test('loft of a cylinder has outward-facing winding (positive enclosed volume)', () => {
  const geometry = loftGeometry(cylinderRings(3, 10));
  assert.ok(meshVolume(geometry) > 0, 'expected a positive signed volume');
});

test('loft of a cylinder matches the analytic volume within discretisation error', () => {
  const radius = 3;
  const height = 10;
  const geometry = loftGeometry(cylinderRings(radius, height));
  const analytic = Math.PI * radius * radius * height;
  // An N-gon prism under-fills the circle by a factor of (N/2pi)·sin(2pi/N).
  const inscribed = analytic * ((SEGMENTS / (2 * Math.PI)) * Math.sin((2 * Math.PI) / SEGMENTS));
  assert.ok(
    Math.abs(meshVolume(geometry) - inscribed) / inscribed < 1e-3,
    `volume ${meshVolume(geometry)} not within 0.1% of ${inscribed}`,
  );
});

test('analytic normals point outward and are unit length', () => {
  const geometry = loftGeometry(cylinderRings(3, 10), { capStart: false, capEnd: false });
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < position.count; i += 1) {
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-5, 'normal not unit length');
    // On a cylinder wall the normal is the radial direction.
    const px = position.getX(i);
    const pz = position.getZ(i);
    const radial = Math.hypot(px, pz);
    assert.ok((px * nx + pz * nz) / radial > 0.999, 'normal is not radially outward');
  }
});

test('the duplicated seam column carries identical normals (no crease)', () => {
  const geometry = loftGeometry(cylinderRings(3, 10), { capStart: false, capEnd: false });
  const normal = geometry.getAttribute('normal');
  const cols = SEGMENTS + 1;
  for (let row = 0; row < 8; row += 1) {
    const first = row * cols;
    const dup = row * cols + SEGMENTS;
    for (const get of ['getX', 'getY', 'getZ'] as const) {
      assert.ok(
        Math.abs(normal[get](first) - normal[get](dup)) < 1e-6,
        'seam column normals diverge',
      );
    }
  }
});

test('loft rejects malformed ring stacks', () => {
  assert.throws(() => loftGeometry([circleRing(1, 0, 8)]), /at least 2 rings/);
  assert.throws(() => loftGeometry([circleRing(1, 0, 2), circleRing(1, 1, 2)]), /at least 3 points/);
  assert.throws(
    () => loftGeometry([circleRing(1, 0, 8), circleRing(1, 1, 12)]),
    /same point count/,
  );
});

test('circle rings run counter-clockwise seen from +Y', () => {
  const ring = circleRing(2, 0, 4);
  const [a, b] = [ring[0], ring[1]];
  assert.ok(a !== undefined && b !== undefined);
  // Cross product of successive points about +Y is positive for CCW ordering.
  assert.ok(a.x * b.z - a.z * b.x > 0);
});

test('a superellipse with n = 2 reproduces an ellipse', () => {
  const a = 18;
  const b = 12;
  const ring = superellipseRing(a, b, 2, 0, 256);
  for (const p of ring) {
    const f = (p.x / a) ** 2 + (p.z / b) ** 2;
    assert.ok(Math.abs(f - 1) < 1e-9, `point off the ellipse: ${f}`);
  }
});

test('superellipse perimeter grows with squareness', () => {
  const perimeterOf = (n: number): number => {
    const ring = superellipseRing(10, 7, n, 0, 512);
    let total = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      if (p === undefined || q === undefined) continue;
      total += Math.hypot(q.x - p.x, q.z - p.z);
    }
    return total;
  };
  assert.ok(perimeterOf(2.6) > perimeterOf(2.0));
});

test('sampleProfile interpolates smoothly and clamps outside its domain', () => {
  const profile = [
    { t: 0, radius: 1 },
    { t: 0.5, radius: 3 },
    { t: 1, radius: 2 },
  ];
  assert.equal(sampleProfile(profile, -1), 1);
  assert.equal(sampleProfile(profile, 2), 2);
  assert.equal(sampleProfile(profile, 0.5), 3);
  // Smoothstep is flat at the control points, so the midpoint of a span is
  // exactly halfway between the two radii.
  assert.ok(Math.abs(sampleProfile(profile, 0.25) - 2) < 1e-9);
});

test('ellipse perimeter inversion round-trips', () => {
  for (const ratio of [1, 0.8, 0.65, 0.5]) {
    const target = 96;
    const { a, b } = ellipseAxesFromPerimeter(target, ratio);
    assert.ok(Math.abs(ellipsePerimeter(a, b) - target) < 1e-6);
    assert.ok(Math.abs(b / a - ratio) < 1e-9);
  }
});

test('ringStackVolume agrees exactly with the built geometry', () => {
  const rings = revolveProfile(
    [
      { t: 0, radius: 4 },
      { t: 0.5, radius: 7 },
      { t: 1, radius: 2 },
    ],
    0,
    20,
    10,
    SEGMENTS,
  );
  const fromGeometry = meshVolume(loftGeometry(rings));
  const fromRings = ringStackVolume(rings);
  assert.ok(
    Math.abs(fromGeometry - fromRings) / fromGeometry < 1e-5,
    `${fromRings} != ${fromGeometry}`,
  );
});

test('a ring sized for a circumference has exactly that circumference', () => {
  for (const target of [45, 78.5, 102, 33]) {
    for (const ratio of [1, 0.72, 0.94]) {
      for (const n of [2, 2.45, 2.1]) {
        const ring = superellipseRingForCircumference(target, ratio, n, 0, 48);
        const actual = ringCircumference(ring);
        assert.ok(
          Math.abs(actual - target) < 1e-6,
          `C=${target} r=${ratio} n=${n}: got ${actual}`,
        );
      }
    }
  }
});
