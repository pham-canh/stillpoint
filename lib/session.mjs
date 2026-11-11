import { EventEmitter } from 'node:events';
import {
  CameraSelection,
  SmartSpectraSDK,
  ProcessingStatus,
  MetricType,
  PixelFormat,
} from '@smartspectra/node-sdk';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import { round, summarizeMeasurements } from '../public/lib/stats.js';

const EXPRESSION_LABELS = [
  'unspecified',
  'angry',
  'contempt',
  'disgust',
  'fear',
  'happy',
  'neutral',
  'sad',
  'surprise',
];

export const STATUS_NAMES = Object.fromEntries(
  Object.entries(ProcessingStatus).map(([key, value]) => [value, key.replace(/^k/, '').toLowerCase()]),
);

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    const numeric = value.toNumber();
    return Number.isFinite(numeric) ? numeric : null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function lastOf(list) {
  return Array.isArray(list) && list.length ? list[list.length - 1] : null;
}

function readMeasurement(sample) {
  if (!sample) return null;
  const value = toNumber(sample.value);
  if (value === null) return null;
  return {
    value,
    confidence: toNumber(sample.confidence) ?? 0,
    stable: Boolean(sample.stable),
    timestamp: toNumber(sample.timestamp),
  };
}

function readExpression(sample) {
  if (!sample || !Array.isArray(sample.scores) || !sample.scores.length) return null;
  let best = null;
  for (const score of sample.scores) {
    const confidence = toNumber(score.confidence) ?? 0;
    if (!best || confidence > best.confidence) {
      best = { type: toNumber(score.type) ?? 0, confidence };
    }
  }
  if (!best) return null;
  return {
    label: EXPRESSION_LABELS[best.type] ?? 'unknown',
    confidence: best.confidence,
    stable: Boolean(sample.stable),
    timestamp: toNumber(sample.timestamp),
  };
}

function readHrv(sample) {
  if (!sample) return null;
  const rmssd = toNumber(sample.rmssd);
  if (rmssd === null) return null;
  return {
    rmssd,
    meanNn: toNumber(sample.meanNn ?? sample.mean_nn),
    sdnn: toNumber(sample.sdnn),
    confidence: toNumber(sample.confidence) ?? 0,
    stable: Boolean(sample.stable),
    timestamp: toNumber(sample.timestamp),
  };
}

export class SmartSession extends EventEmitter {
  constructor({
    apiKey,
    mode = 'frames',
    videoPath = null,
    includeFace = true,
    cameraId = null,
    cameraOptions = { width: 1280, height: 720, fps: 30 },
  } = {}) {
    super();
    this.mode = mode;
    this.includeFace = includeFace;
    this.videoPath = videoPath;
    this.cameraId = cameraId;
    this.cameraOptions = cameraOptions;
    this.startedAt = Date.now();
    this.lastBroadcastAt = 0;
    this.stopping = false;
    this.stopped = false;
    this.sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: [
        MetricType.BREATHING_RATE,
        MetricType.PULSE_RATE,
        MetricType.HRV,
        ...(includeFace ? [MetricType.EXPRESSIONS] : []),
      ],
      enableTelemetry: false,
    });
    this.snapshot = {
      pulse: null,
      breathing: null,
      hrv: null,
      expression: null,
      talking: null,
      blinking: null,
      at: 0,
    };
    this.latestTimestamps = {
      pulse: null,
      breathing: null,
      hrv: null,
      expression: null,
    };
    this.samples = {
      pulse: [],
      breathing: [],
      hrv: [],
      expression: [],
    };
    this.frames = { in: 0, dropped: 0 };
    this.timing = {
      sendCount: 0,
      sendTotal: 0,
      sendMax: 0,
      metricsCount: 0,
      metricsTotal: 0,
      metricsMax: 0,
    };
    this.status = null;
    this.hasRun = false;
    this.sdk.on('metrics', (buffer) => this.handleMetrics(buffer));
    this.sdk.on('validationStatus', (code, timestampUs, hint) => {
      if (this.stopped) return;
      this.emit('validation', {
        code: toNumber(code),
        hint: String(hint || '').slice(0, 240),
        at: Date.now(),
      });
    });
    this.sdk.on('processingStatus', (status) => this.handleStatus(status));
    this.sdk.on('frameSentThrough', (sent) => {
      if (this.mode !== 'camera' || this.stopped) return;
      this.frames.in += 1;
      if (!sent) this.frames.dropped += 1;
    });
    this.sdk.on('videoOutput', (buffer, width, height, stride, format, timestampUs) => {
      if (this.stopped) return;
      this.emit('video', { buffer, width, height, stride, format, timestampUs });
    });
    this.sdk.on('error', (code, message, retryable) => {
      if (this.stopped) return;
      this.emit('error', {
        code: toNumber(code),
        message: String(message || 'SmartSpectra error').slice(0, 400),
        retryable: Boolean(retryable),
      });
    });
  }

  start() {
    try {
      if (this.mode === 'file') {
        this.sdk.useFile(this.videoPath);
      } else if (this.mode === 'camera') {
        const selection = this.cameraId
          ? CameraSelection.byId(this.cameraId)
          : CameraSelection.default;
        this.sdk.useCamera(selection, this.cameraOptions);
      } else {
        this.sdk.useCustomInput();
      }
      this.sdk.start();
    } catch (error) {
      throw Object.assign(new Error(String(error?.message || 'The camera could not start.')), {
        code: toNumber(error?.code) ?? -1,
      });
    }
  }

  handleStatus(status) {
    const value = toNumber(status);
    if (value === null || value === this.status) return;
    this.status = value;
    if (value === ProcessingStatus.kRunning) {
      this.hasRun = true;
    }
    this.emit('status', { status: value, name: STATUS_NAMES[value] ?? 'unknown', at: Date.now() });
    const finished = value === ProcessingStatus.kError || (value === ProcessingStatus.kIdle && this.hasRun);
    if (finished) {
      this.emit('settled', { status: value, name: STATUS_NAMES[value] ?? 'unknown' });
    }
  }

  handleMetrics(buffer) {
    if (this.stopped) return;
    const startedAt = performance.now();
    let metrics;
    try {
      metrics = decodeMetrics(buffer);
    } catch {
      return;
    }
    if (!metrics || typeof metrics !== 'object' || Buffer.isBuffer(metrics)) return;
    const pulse = readMeasurement(lastOf(metrics.cardio?.pulseRate));
    const breathing = readMeasurement(lastOf(metrics.breathing?.rate));
    const hrv = readHrv(lastOf(metrics.cardio?.hrv));
    const expression = this.includeFace ? readExpression(lastOf(metrics.face?.expression)) : null;
    const talking = lastOf(metrics.face?.talking);
    const blinking = lastOf(metrics.face?.blinking);

    if (pulse) {
      this.snapshot.pulse = pulse;
      if (pulse.timestamp !== this.latestTimestamps.pulse) {
        this.latestTimestamps.pulse = pulse.timestamp;
        this.samples.pulse.push(pulse);
      }
    }
    if (breathing) {
      this.snapshot.breathing = breathing;
      if (breathing.timestamp !== this.latestTimestamps.breathing) {
        this.latestTimestamps.breathing = breathing.timestamp;
        this.samples.breathing.push(breathing);
      }
    }
    if (hrv) {
      this.snapshot.hrv = hrv;
      if (hrv.timestamp !== this.latestTimestamps.hrv) {
        this.latestTimestamps.hrv = hrv.timestamp;
        this.samples.hrv.push(hrv);
      }
    }
    if (expression) {
      this.snapshot.expression = expression;
      if (expression.timestamp !== this.latestTimestamps.expression) {
        this.latestTimestamps.expression = expression.timestamp;
        this.samples.expression.push(expression);
      }
    }
    if (talking) this.snapshot.talking = Boolean(talking.detected);
    if (blinking) this.snapshot.blinking = Boolean(blinking.detected);

    const now = Date.now();
    this.snapshot.at = now;
    if (now - this.lastBroadcastAt >= 200) {
      this.lastBroadcastAt = now;
      this.emit('metrics', {
        ...this.snapshot,
        elapsedMs: now - this.startedAt,
        frames: { ...this.frames },
      });
    }
    const elapsed = performance.now() - startedAt;
    this.timing.metricsCount += 1;
    this.timing.metricsTotal += elapsed;
    if (elapsed > this.timing.metricsMax) this.timing.metricsMax = elapsed;
  }

  pushFrame(buffer, width, height) {
    if (this.stopped || this.mode === 'file') return false;
    const timestampUs = Number(process.hrtime.bigint() / 1000n);
    const startedAt = performance.now();
    let accepted = false;
    try {
      accepted = this.sdk.sendFrame(
        buffer,
        width,
        height,
        width * 4,
        PixelFormat.kRGBA,
        timestampUs,
      );
    } catch {
      accepted = false;
    }
    const elapsed = performance.now() - startedAt;
    this.timing.sendCount += 1;
    this.timing.sendTotal += elapsed;
    if (elapsed > this.timing.sendMax) this.timing.sendMax = elapsed;
    this.frames.in += 1;
    if (!accepted) this.frames.dropped += 1;
    return accepted;
  }

  summarize() {
    const pulse = summarizeMeasurements(this.samples.pulse, { min: 30, max: 200 });
    const breathing = summarizeMeasurements(this.samples.breathing, { min: 3, max: 60 });
    const goodHrv = this.samples.hrv.filter(
      (sample) => sample.confidence >= 10 && Number.isFinite(sample.rmssd),
    );
    const stableHrv = goodHrv.filter((sample) => sample.stable);
    const hrvSample = (stableHrv.length ? stableHrv : goodHrv).slice(-1)[0] || null;
    return {
      durationMs: Date.now() - this.startedAt,
      pulse: pulse
        ? {
            median: round(pulse.median, 0),
            confidence: round(pulse.confidence, 0),
            samples: pulse.samples,
          }
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
      timing: {
        sendAvgMs: this.timing.sendCount
          ? round(this.timing.sendTotal / this.timing.sendCount, 2)
          : null,
        sendMaxMs: round(this.timing.sendMax, 2),
        metricsAvgMs: this.timing.metricsCount
          ? round(this.timing.metricsTotal / this.timing.metricsCount, 2)
          : null,
        metricsMaxMs: round(this.timing.metricsMax, 2),
      },
    };
  }

  async stop() {
    if (this.stopping) return null;
    this.stopping = true;
    this.stopped = true;
    try {
      await this.sdk.stopAsync();
    } catch {}
    try {
      await this.sdk.destroy();
    } catch {}
    const summary = this.summarize();
    this.emit('ended', { at: Date.now(), summary });
    return summary;
  }
}
