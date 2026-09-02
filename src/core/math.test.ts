import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monotoneCubic } from './math.ts';

test('monotone cubic passes exactly through every control value', () => {
  const values = [3, 7, 7, 2, 9];
  const f = monotoneCubic(values);
  values.forEach((v, i) => {
    assert.ok(Math.abs(f(i) - v) < 1e-12, `at ${i}: ${f(i)} != ${v}`);
  });
});

test('monotone cubic never overshoots the data', () => {
  // A measured chest must not be exceeded by a bulge just above it.
  const values = [88, 84, 100, 96, 46];
  const f = monotoneCubic(values);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  for (let t = 0; t <= values.length - 1; t += 0.001) {
    const v = f(t);
    assert.ok(v >= lo - 1e-9 && v <= hi + 1e-9, `f(${t}) = ${v} escaped [${lo}, ${hi}]`);
  }
});

test('monotone cubic stays monotone on monotone data', () => {
  const values = [1, 2, 4, 8, 16, 17];
  const f = monotoneCubic(values);
  let previous = -Infinity;
  for (let t = 0; t <= values.length - 1; t += 0.005) {
    const v = f(t);
    assert.ok(v >= previous - 1e-9, `dipped at ${t}`);
    previous = v;
  }
});

test('monotone cubic has no flat spots between distinct values', () => {
  // This is what smoothstep got wrong: a zero slope at every control point
  // turns a smooth profile into visible bands.
  const f = monotoneCubic([10, 20, 30]);
  const slope = (f(1.001) - f(0.999)) / 0.002;
  assert.ok(slope > 5, `slope through an interior control point was ${slope}`);
});

test('monotone cubic handles degenerate inputs', () => {
  assert.equal(monotoneCubic([])(0.5), 0);
  assert.equal(monotoneCubic([4])(99), 4);
  assert.equal(monotoneCubic([4, 8])(-3), 4);
  assert.equal(monotoneCubic([4, 8])(99), 8);
});
