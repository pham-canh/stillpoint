import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSession } from '../lib/mock-session.mjs';

function collect(session) {
  const events = { metrics: [], validation: [], status: [], settled: [] };
  session.on('metrics', (data) => events.metrics.push(data));
  session.on('validation', (data) => events.validation.push(data));
  session.on('status', (data) => events.status.push(data));
  session.on('settled', (data) => events.settled.push(data));
  return events;
}

test('the simulated session emits metrics without a camera or key', async () => {
  const session = new MockSession({ settleMs: 300, sessionMs: 300, tickMs: 20 });
  const events = collect(session);
  session.start();
  await new Promise((resolve) => setTimeout(resolve, 260));
  await session.stop();

  assert.ok(events.metrics.length >= 3);
  const last = events.metrics.at(-1);
  assert.ok(Number.isFinite(last.breathing.value));
  assert.ok(last.breathing.value > 3 && last.breathing.value < 60);
  assert.ok(Number.isFinite(last.pulse.value));
  assert.ok(last.pulse.value > 30 && last.pulse.value < 200);
  assert.ok(last.hrv && Number.isFinite(last.hrv.rmssd));
  assert.ok(events.validation.length >= 1);
  assert.equal(events.status[0].name, 'running');
});

test('the simulated session ends on its own schedule', async () => {
  const session = new MockSession({ settleMs: 40, sessionMs: 40, tickMs: 20 });
  const events = collect(session);
  session.start();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.ok(events.settled.length >= 1);
  assert.equal(events.settled.at(-1).name, 'idle');
  await session.stop();
});

test('the simulated summary is labelled as simulated', async () => {
  const session = new MockSession({ settleMs: 300, sessionMs: 300, tickMs: 20 });
  session.start();
  await new Promise((resolve) => setTimeout(resolve, 260));
  const summary = await session.stop();
  assert.equal(summary.simulated, true);
  assert.ok(summary.pulse && summary.pulse.median > 30);
  assert.ok(summary.breathing && summary.breathing.median > 3);
});
