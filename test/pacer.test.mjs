import test from 'node:test';
import assert from 'node:assert/strict';
import { Pacer, breathValue } from '../public/lib/pacer.js';

test('breathValue rises to full inhale and returns to rest', () => {
  assert.equal(breathValue(0), 0);
  assert.ok(Math.abs(breathValue(0.4) - 1) < 1e-9);
  assert.ok(breathValue(1) < 1e-9);
  assert.ok(breathValue(0.2) > breathValue(0));
  assert.ok(breathValue(0.8) < breathValue(0.6));
});

test('an inactive pacer reports no movement', () => {
  const pacer = new Pacer();
  const tick = pacer.tick(1000);
  assert.equal(tick.active, false);
  assert.equal(tick.breaths, 0);
});

test('paced cycles count breaths and follow the period', () => {
  const pacer = new Pacer({ periodMs: 10_000 });
  pacer.begin(0);
  const first = pacer.tick(0);
  assert.equal(first.phase, 'in');
  assert.equal(first.breaths, 0);
  const middle = pacer.tick(4_000);
  assert.equal(middle.phase, 'out');
  const cycle = pacer.tick(10_000);
  assert.equal(cycle.breaths, 1);
  assert.equal(cycle.phase, 'in');
});

test('a slow breather is never sped up', () => {
  const pacer = new Pacer();
  pacer.setMeasuredRate(5);
  pacer.begin(0);
  assert.equal(pacer.periodMs, 12_000);
  for (let cycle = 1; cycle <= 6; cycle += 1) {
    pacer.tick(cycle * pacer.periodMs);
    assert.equal(pacer.periodMs, 12_000);
  }
});

test('a fast breather eases toward the ten-second pace', () => {
  const pacer = new Pacer();
  pacer.setMeasuredRate(15);
  pacer.begin(0);
  assert.equal(pacer.periodMs, 6_000);
  const periods = [];
  for (let cycle = 1; cycle <= 8; cycle += 1) {
    pacer.tick(pacer.cycleStart + pacer.periodMs);
    periods.push(pacer.periodMs);
  }
  assert.ok(periods[0] > 6_000);
  assert.ok(periods.every((period, index) => index === 0 || period >= periods[index - 1]));
  assert.equal(periods.at(-1), 10_000);
});

test('measured rate is clamped to the allowed range', () => {
  const slow = new Pacer();
  slow.setMeasuredRate(1);
  assert.equal(slow.desiredPeriodMs, 12_000);
  const fast = new Pacer();
  fast.setMeasuredRate(120);
  assert.equal(fast.desiredPeriodMs, 6_000);
});

test('begin resets cycle and breath counters', () => {
  const pacer = new Pacer({ periodMs: 10_000 });
  pacer.begin(0);
  pacer.tick(30_000);
  assert.equal(pacer.breaths, 3);
  pacer.begin(40_000);
  assert.equal(pacer.breaths, 0);
  assert.equal(pacer.tick(40_000).breaths, 0);
});
