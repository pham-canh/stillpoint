import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SmartSpectraSDK,
  breathingMetrics,
  cardioMetrics,
  faceMetrics,
} from '@smartspectra/node-sdk';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import { loadEnv } from '../lib/env.mjs';

loadEnv();

const apiKey = (process.env.SMARTSPECTRA_API_KEY || '').trim();
const videoArg = process.argv[2];

if (!apiKey) {
  console.error('Missing SMARTSPECTRA_API_KEY. Copy .env.example to .env and add a key.');
  process.exit(2);
}
if (!videoArg) {
  console.error('Usage: npm run smoke -- ./fixtures/face.mp4');
  process.exit(2);
}

const videoPath = resolve(process.cwd(), videoArg);
if (!existsSync(videoPath)) {
  console.error(`Video not found: ${videoPath}`);
  process.exit(2);
}

const sdk = new SmartSpectraSDK({
  apiKey,
  requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...faceMetrics],
  enableTelemetry: false,
  logLevel: 2,
});

const seen = {
  pulse: null,
  breathing: null,
  hrv: null,
  expression: null,
  metrics: 0,
  validation: null,
  error: null,
  statuses: [],
};

sdk.on('metrics', (buffer) => {
  let metrics;
  try {
    metrics = decodeMetrics(buffer);
  } catch {
    return;
  }
  if (!metrics || typeof metrics !== 'object') return;
  seen.metrics += 1;
  const pulse = metrics.cardio?.pulseRate?.at(-1);
  const breathing = metrics.breathing?.rate?.at(-1);
  const hrv = metrics.cardio?.hrv?.at(-1);
  const expression = metrics.face?.expression?.at(-1);
  if (pulse) seen.pulse = pulse;
  if (breathing) seen.breathing = breathing;
  if (hrv) seen.hrv = hrv;
  if (expression) seen.expression = expression;
});

sdk.on('validationStatus', (code, timestampUs, hint) => {
  seen.validation = { code, hint };
  if (hint) console.log(`validation: ${hint}`);
});

sdk.on('processingStatus', (status) => {
  seen.statuses.push(status);
  console.log(`status: ${status}`);
});

sdk.on('error', (code, message, retryable) => {
  seen.error = { code, message, retryable };
  console.error(`error ${code}: ${message} (retryable=${retryable})`);
});

let settled = false;
try {
  sdk.useFile(videoPath);
  sdk.start();
  settled = sdk.waitUntilComplete(240_000);
} catch (error) {
  seen.error = { code: error.code, message: error.message, retryable: error.retryable };
  console.error(`start failed: ${error.message}`);
}

try {
  await sdk.destroy();
} catch {}

const summary = {
  video: videoPath,
  settled,
  metricsEvents: seen.metrics,
  statuses: seen.statuses,
  pulse: seen.pulse,
  breathing: seen.breathing,
  hrv: seen.hrv,
  expression: seen.expression,
  validation: seen.validation,
  error: seen.error,
};

console.log(JSON.stringify(summary, null, 2));

if (!settled) {
  console.error('FAIL: the session did not settle within the timeout.');
  process.exit(1);
}
if (seen.error) {
  console.error('FAIL: the SDK reported an error.');
  process.exit(1);
}
if (!seen.pulse?.value && !seen.breathing?.value) {
  console.error('FAIL: no live pulse or breathing reading was produced.');
  process.exit(1);
}
console.log('OK: live SmartSpectra signals were produced.');
