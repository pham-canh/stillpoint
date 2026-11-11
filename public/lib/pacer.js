import { clamp } from './stats.js';

export function breathValue(progress, inhaleFraction = 0.4) {
  const t = clamp(progress, 0, 1);
  if (t < inhaleFraction) {
    return 0.5 - 0.5 * Math.cos((t / inhaleFraction) * Math.PI);
  }
  return 0.5 + 0.5 * Math.cos(((t - inhaleFraction) / (1 - inhaleFraction)) * Math.PI);
}

export class Pacer {
  constructor({
    periodMs = 10000,
    minPeriodMs = 6000,
    maxPeriodMs = 12000,
    finalPeriodMs = 10000,
    easeMs = 750,
    inhaleFraction = 0.4,
  } = {}) {
    this.minPeriodMs = minPeriodMs;
    this.maxPeriodMs = maxPeriodMs;
    this.finalPeriodMs = finalPeriodMs;
    this.easeMs = easeMs;
    this.inhaleFraction = inhaleFraction;
    this.desiredPeriodMs = clamp(periodMs, minPeriodMs, maxPeriodMs);
    this.periodMs = this.desiredPeriodMs;
    this.cycleStart = null;
    this.cycles = 0;
    this.breaths = 0;
    this.measured = null;
    this.adjusting = false;
    this.active = false;
  }

  setMeasuredRate(bpm) {
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    this.measured = bpm;
    this.desiredPeriodMs = clamp(60000 / bpm, this.minPeriodMs, this.maxPeriodMs);
  }

  begin(now = null) {
    this.active = true;
    this.cycleStart = now;
    this.periodMs = clamp(this.desiredPeriodMs, this.minPeriodMs, this.maxPeriodMs);
    this.cycles = 0;
    this.breaths = 0;
  }

  nextPeriod() {
    const floor = Math.min(this.desiredPeriodMs, this.finalPeriodMs);
    const target = Math.max(this.desiredPeriodMs, this.finalPeriodMs);
    const delta = target - this.periodMs;
    const step =
      Math.abs(delta) <= this.easeMs ? delta : Math.sign(delta) * this.easeMs;
    const next = clamp(this.periodMs + step, floor, this.maxPeriodMs);
    this.adjusting = Math.abs(next - this.periodMs) >= 1;
    this.periodMs = next;
  }

  tick(now) {
    if (!this.active) {
      return {
        phase: 'out',
        progress: 0,
        phaseProgress: 0,
        remainingMs: 0,
        periodMs: this.periodMs,
        breath: 0,
        cycles: 0,
        breaths: 0,
        adjusting: false,
        measuredPeriodMs: this.desiredPeriodMs,
        measured: this.measured,
        active: false,
      };
    }
    if (this.cycleStart === null) this.cycleStart = now;
    let elapsed = Math.max(0, now - this.cycleStart);
    while (elapsed >= this.periodMs) {
      this.cycleStart += this.periodMs;
      elapsed = now - this.cycleStart;
      this.cycles += 1;
      this.breaths += 1;
      this.nextPeriod();
    }
    const progress = clamp(elapsed / this.periodMs, 0, 1);
    const phase = progress < this.inhaleFraction ? 'in' : 'out';
    const phaseProgress =
      phase === 'in'
        ? progress / this.inhaleFraction
        : (progress - this.inhaleFraction) / (1 - this.inhaleFraction);
    const phaseMs =
      phase === 'in'
        ? this.periodMs * this.inhaleFraction
        : this.periodMs * (1 - this.inhaleFraction);
    return {
      phase,
      progress,
      phaseProgress: clamp(phaseProgress, 0, 1),
      remainingMs: Math.max(0, phaseMs * (1 - phaseProgress)),
      periodMs: this.periodMs,
      breath: breathValue(progress, this.inhaleFraction),
      cycles: this.cycles,
      breaths: this.breaths,
      adjusting: this.adjusting,
      measuredPeriodMs: this.desiredPeriodMs,
      measured: this.measured,
      active: true,
    };
  }
}
