import { EventEmitter } from 'node:events';
import { round, summarizeMeasurements } from '../public/lib/stats.js';

const EXPRESSION_LABELS = ['neutral', 'happy', 'neutral', 'happy'];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function reading(value, { confidence = 0, stable = false, timestamp } = {}) {
  return {
    value: round(value, 2),
    confidence: round(confidence, 0),
    stable: Boolean(stable),
    timestamp,
  };
}

export class MockSession extends EventEmitter {
  constructor({ settleMs = 32000, sessionMs = 90000, includeFace = true, tickMs = 200 } = {}) {
    super();
    this.settleMs = settleMs;
    this.sessionMs = sessionMs;
    this.includeFace = includeFace;
    this.tickMs = tickMs;
    this.startedAt = 0;
    this.lastBroadcastAt = 0;
    this.stopping = false;
    this.stopped = false;
    this.hasRun = false;
    this.tickTimer = null;
    this.endTimer = null;
    this.snapshot = {
      pulse: null,
      breathing: null,
      hrv: null,
      expression: null,
      talking: null,
      blinking: null,
      at: 0,
    };
    this.samples = { pulse: [], breathing: [], hrv: [], expression: [] };
    this.frames = { in: 0, dropped: 0 };
  }

  start() {
    if (this.hasRun) throw new Error('The simulated session is already running.');
    this.hasRun = true;
    this.startedAt = Date.now();
    this.emit('status', { status: 1, name: 'running', at: this.startedAt });
    this.emit('validation', { code: 0, hint: 'Hold still and record.', at: this.startedAt });
    this.tickTimer = setInterval(() => this.tick(), this.tickMs);
    this.tickTimer.unref?.();
    const total = this.settleMs + this.sessionMs + 1200;
    this.endTimer = setTimeout(() => this.finish(), total);
    this.endTimer.unref?.();
  }

  tick() {
    if (this.stopped) return;
    const now = Date.now();
    const elapsed = now - this.startedAt;
    const t = elapsed / 1000;

    const breathingBase = t < 8 ? 15 - t * 0.25 : 13 + 0.6 * Math.sin(t / 7);
    const breathingConfidence = t < 8 ? clamp(t * 4, 0, 30) : clamp(30 + (t - 8) * 4, 0, 92);
    const breathing = reading(breathingBase, {
      confidence: breathingConfidence,
      stable: t > 12,
      timestamp: now,
    });

    const pulse = reading(70 + 3.5 * Math.sin(t / 9) + 0.6 * Math.sin(t / 1.7), {
      confidence: clamp(t * 9, 0, 95),
      stable: t > 10,
      timestamp: now,
    });

    const hrv = {
      rmssd: round(44 + 2 * Math.sin(t / 13), 1),
      meanNn: round(860 + 8 * Math.sin(t / 11), 1),
      sdnn: round(52 + 2 * Math.sin(t / 17), 1),
      confidence: clamp(t * 6, 0, 80),
      stable: t > 18,
      timestamp: now,
    };

    const expression = this.includeFace
      ? {
          label: EXPRESSION_LABELS[Math.floor(t / 10) % EXPRESSION_LABELS.length],
          confidence: 58,
          stable: t > 6,
          timestamp: now,
        }
      : null;

    this.snapshot = {
      pulse,
      breathing,
      hrv,
      expression,
      talking: null,
      blinking: null,
      at: now,
    };
    this.samples.pulse.push(pulse);
    this.samples.breathing.push(breathing);
    this.samples.hrv.push(hrv);
    if (expression) this.samples.expression.push(expression);

    if (now - this.lastBroadcastAt >= this.tickMs) {
      this.lastBroadcastAt = now;
      this.emit('metrics', {
        ...this.snapshot,
        elapsedMs: elapsed,
        frames: { ...this.frames },
      });
    }
  }

  pushFrame() {
    return false;
  }

  summarize() {
    const pulse = summarizeMeasurements(this.samples.pulse, { min: 30, max: 200 });
    const breathing = summarizeMeasurements(this.samples.breathing, { min: 3, max: 60 });
    const hrvSample = this.samples.hrv.filter((s) => s.stable).slice(-1)[0] || null;
    return {
      durationMs: this.startedAt ? Date.now() - this.startedAt : 0,
      simulated: true,
      pulse: pulse
        ? { median: round(pulse.median, 0), confidence: round(pulse.confidence, 0), samples: pulse.samples }
        : null,
      breathing: breathing
        ? {
            median: round(breathing.median, 1),
            confidence: round(breathing.confidence, 0),
            samples: breathing.samples,
          }
        : null,
      hrv: hrvSample
        ? {
            rmssd: round(hrvSample.rmssd, 1),
            sdnn: round(hrvSample.sdnn, 1),
            confidence: round(hrvSample.confidence, 0),
            stable: hrvSample.stable,
          }
        : null,
      expressionUsed: Boolean(this.includeFace),
      frames: { ...this.frames },
      timing: { sendAvgMs: null, sendMaxMs: null, metricsAvgMs: null, metricsMaxMs: null },
    };
  }

  finish() {
    if (this.stopped) return;
    this.clearTimers();
    this.emit('status', { status: 0, name: 'idle', at: Date.now() });
    this.emit('settled', { status: 0, name: 'idle' });
  }

  clearTimers() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.tickTimer = null;
    this.endTimer = null;
  }

  async stop() {
    if (this.stopping) return null;
    this.stopping = true;
    this.stopped = true;
    this.clearTimers();
    const summary = this.summarize();
    this.emit('ended', { at: Date.now(), summary });
    return summary;
  }
}
