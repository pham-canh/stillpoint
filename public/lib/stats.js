export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

export function easeInOut(value) {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeMeasurements(samples, { minConfidence = 20, min = -Infinity, max = Infinity } = {}) {
  const valid = (samples || []).filter(
    (sample) =>
      sample &&
      Number.isFinite(sample.value) &&
      sample.value >= min &&
      sample.value <= max,
  );
  const confident = valid.filter((sample) => (sample.confidence ?? 0) >= minConfidence);
  const pool = confident.length ? confident : valid;
  if (!pool.length) return null;
  return {
    median: median(pool.map((sample) => sample.value)),
    confidence: median(pool.map((sample) => sample.confidence ?? 0)),
    samples: pool.length,
  };
}

export function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatNumber(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function round(value, digits = 0) {
  if (!Number.isFinite(value)) return null;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}
