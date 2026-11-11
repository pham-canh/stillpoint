import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  formatClock,
  median,
  round,
  summarizeMeasurements,
} from '../public/lib/stats.js';

test('clamp keeps values inside the range', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(Number.NaN, 3, 10), 3);
});

test('median handles odd, even, empty, and invalid input', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([1, Number.NaN, 3]), 2);
});

test('summarizeMeasurements prefers confident samples', () => {
  const summary = summarizeMeasurements(
    [
      { value: 60, confidence: 10 },
      { value: 70, confidence: 80 },
      { value: 72, confidence: 90 },
      { value: 300, confidence: 99 },
    ],
    { min: 30, max: 200 },
  );
  assert.equal(summary.median, 71);
  assert.equal(summary.confidence, 85);
  assert.equal(summary.samples, 2);
});

test('summarizeMeasurements falls back to valid samples when none are confident', () => {
  const summary = summarizeMeasurements(
    [
      { value: 60, confidence: 5 },
      { value: 62, confidence: 8 },
    ],
    { min: 30, max: 200 },
  );
  assert.equal(summary.median, 61);
  assert.equal(summary.samples, 2);
});

test('summarizeMeasurements returns null without usable samples', () => {
  assert.equal(summarizeMeasurements([], {}), null);
  assert.equal(
    summarizeMeasurements([{ value: 10, confidence: 99 }], { min: 30, max: 200 }),
    null,
  );
});

test('formatClock rounds to whole seconds', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(59_400), '0:59');
  assert.equal(formatClock(60_000), '1:00');
  assert.equal(formatClock(122_000), '2:02');
  assert.equal(formatClock(-5), '0:00');
});

test('round returns null for non-finite values', () => {
  assert.equal(round(1.234, 2), 1.23);
  assert.equal(round(Number.NaN), null);
  assert.equal(round(Infinity), null);
});
