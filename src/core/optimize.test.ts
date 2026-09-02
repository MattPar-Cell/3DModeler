import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goldenSectionMinimize } from './optimize.ts';

test('finds the minimum of a smooth unimodal function', () => {
  const result = goldenSectionMinimize((x) => (x - 1.37) ** 2 + 3, 0.5, 2.0, 1e-6);
  assert.ok(Math.abs(result.x - 1.37) < 1e-5, `got ${result.x}`);
  assert.ok(Math.abs(result.value - 3) < 1e-9);
});

test('returns a bound when the minimum lies outside the bracket', () => {
  const result = goldenSectionMinimize((x) => (x - 10) ** 2, 0, 2, 1e-6);
  assert.ok(Math.abs(result.x - 2) < 1e-4, `got ${result.x}`);
});

test('handles a reversed bracket', () => {
  const result = goldenSectionMinimize((x) => Math.abs(x - 0.8), 2, 0, 1e-6);
  assert.ok(Math.abs(result.x - 0.8) < 1e-4);
});

test('converges in a bounded number of evaluations', () => {
  let calls = 0;
  goldenSectionMinimize(
    (x) => {
      calls += 1;
      return (x - 1) ** 2;
    },
    0.5,
    2,
    1e-4,
  );
  assert.ok(calls < 30, `used ${calls} evaluations`);
});
