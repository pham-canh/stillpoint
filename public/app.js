import { Pacer } from './lib/pacer.js';
import { createScene } from './scene.js';
import { formatClock, round, summarizeMeasurements } from './lib/stats.js';

const $ = (id) => document.getElementById(id);

const els = {
  scene: $('scene'),
  screens: {
    intro: $('screen-intro'),
    session: $('screen-session'),
    summary: $('screen-summary'),
  },
  setupNotice: $('setup-notice'),
  demoNotice: $('demo-notice'),
  consent: $('consent'),
  expressions: $('expressions'),
  start: $('start'),
  startNote: $('start-note'),
  factTiming: $('fact-timing'),
  privacyOpen: $('privacy-open'),
  privacyDialog: $('privacy-dialog'),
  privacyClose: $('privacy-close'),
  cameraBadge: $('camera-badge'),
  cameraBadgeText: $('camera-badge-text'),
  timer: $('timer'),
  previewToggle: $('preview-toggle'),
  stop: $('stop'),
  previewCard: $('preview-card'),
  preview: $('preview'),
  previewCanvas: $('preview-canvas'),
  previewLabel: $('preview-label'),
  hint: $('hint'),
  phase: $('phase'),
  phaseSub: $('phase-sub'),
  breaths: $('breaths'),
  pulse: $('pulse'),
  pulseSignal: $('pulse-signal'),
  breathing: $('breathing'),
  breathingSignal: $('breathing-signal'),
  hrv: $('hrv'),
  hrvSignal: $('hrv-signal'),
  expressionNote: $('expression-note'),
  sessionNote: $('session-note'),
  summaryTitle: $('summary-title'),
  summaryLede: $('summary-lede'),
  sumTime: $('sum-time'),
  sumBreaths: $('sum-breaths'),
  sumPulse: $('sum-pulse'),
  sumBreathing: $('sum-breathing'),
  sumHrv: $('sum-hrv'),
  sumSignal: $('sum-signal'),
  summaryNote: $('summary-note'),
  again: $('again'),
  done: $('done'),
  announcer: $('announcer'),
  errorToast: $('error-toast'),
  errorText: $('error-text'),
  errorClose: $('error-close'),
};

const DEFAULT_HINT = 'Sit comfortably. Face and upper chest in frame.';
const DEMO_HINT = 'Replaying a local clip through the same SmartSpectra pipeline.';
const TERMINAL_ERROR_CODES = new Set([2, 3, 4, 13, 14]);

const config = {
  hasKey: false,
  demo: false,
  captureMode: 'frames',
  sessionMs: 90000,
  settleMs: 32000,
  version: '',
};

const state = {
  screen: 'intro',
  phase: 'intro',
  finished: true,
  ending: false,
  paced: false,
  includeFace: true,
  startedAt: 0,
  settleEndsAt: 0,
  pacedEndsAt: 0,
  settleBreathStart: 0,
  pacer: null,
  breaths: 0,
  ws: null,
  es: null,
  stream: null,
  pump: null,
  ticker: null,
  raf: null,
  startWaiter: null,
  stopTimer: null,
  errorTimer: null,
  lastMetrics: null,
  hrv: null,
  samples: { pulse: [], breathing: [] },
  lastTs: { pulse: null, breathing: null },
  lastPhaseKey: '',
  stopReason: null,
  hintAt: 0,
  expressionAt: 0,
};

const scene = createScene(els.scene);

async function init() {
  bindUi();
  await loadConfig();
  applyConfig();
  state.raf = requestAnimationFrame(loop);
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('config');
    Object.assign(config, await response.json());
  } catch {
    config.hasKey = false;
  }
}

function applyConfig() {
  els.setupNotice.hidden = config.hasKey;
  els.demoNotice.hidden = !config.demo;
  els.factTiming.textContent = `${Math.round(config.settleMs / 1000)}s settle + ${Math.round(config.sessionMs / 1000)}s guided`;
  updateStartState();
}

function updateStartState() {
  const ready = config.hasKey && els.consent.checked;
  els.start.disabled = !ready;
  if (!config.hasKey) {
    els.startNote.textContent = 'Add a Presage API key on the server to begin.';
  } else if (config.demo) {
    els.startNote.textContent = 'Demo mode: a local clip is replayed through the SDK.';
  } else {
    els.startNote.textContent = 'Find a comfortable seat and even light.';
  }
}

function showScreen(name) {
  for (const [key, node] of Object.entries(els.screens)) {
    node.hidden = key !== name;
  }
  state.screen = name;
}

function setCameraBadge(kind) {
  if (kind === 'camera') {
    els.cameraBadge.classList.remove('off');
    els.cameraBadgeText.textContent = 'Camera on';
  } else {
    els.cameraBadge.classList.add('off');
    els.cameraBadgeText.textContent = 'Recorded clip';
  }
}

function setHint(text) {
  els.hint.textContent = text;
}

function setSessionNote(text) {
  els.sessionNote.textContent = text;
}

function announce(text) {
  els.announcer.textContent = text;
}

function renderMetric(valueEl, signalEl, value, confidence) {
  valueEl.textContent = value === null || value === undefined ? '—' : String(value);
  const percent = Math.max(0, Math.min(100, Number(confidence) || 0));
  signalEl.style.setProperty('--signal', `${percent}%`);
}

function resetMetricDisplays() {
  [
    [els.pulse, els.pulseSignal],
    [els.breathing, els.breathingSignal],
    [els.hrv, els.hrvSignal],
  ].forEach(([valueEl, signalEl]) => renderMetric(valueEl, signalEl, null, 0));
}

function friendlyError(error) {
  if (!error) return 'Something interrupted the session.';
  if (error.code === 'missing_key') return error.message;
  if (error.code === 'start_failed') {
    return `The camera could not start. ${error.message}`;
  }
  if (error.code === 'sdk_unavailable') {
    return `${error.message} Stillpoint runs the SDK natively, so use macOS on Apple Silicon, Linux x64/arm64, or Windows x64.`;
  }
  if (error.code === 'busy') return 'Another session is already running. Stop it first.';
  if (error.code === 'ws' || error.code === 'ws_timeout') return error.message;
  if (error.code === 'timeout') {
    return 'The measurement service took too long to start. Check the server terminal for details.';
  }
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
    return 'Camera access was blocked. Allow the camera for this page, then try again.';
  }
  if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
    return 'No camera was found on this device.';
  }
  if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
    return 'The camera is already in use by another app.';
  }
  if (error.name === 'SecurityError') {
    return 'The camera needs a secure context. Open Stillpoint through localhost or HTTPS.';
  }
  const message = String(error.message || error);
  if (/auth|api key|401|verify|subscription/i.test(message)) {
    return `Presage could not verify the API key. ${message}`;
  }
  return message;
}

function showError(message) {
  els.errorText.textContent = message;
  els.errorToast.hidden = false;
  clearTimeout(state.errorTimer);
  state.errorTimer = setTimeout(hideError, 15000);
}

function hideError() {
  els.errorToast.hidden = true;
  clearTimeout(state.errorTimer);
  state.errorTimer = null;
}

async function beginSession() {
  if (state.screen !== 'intro') return;
  if (!config.hasKey) {
    showError('Add SMARTSPECTRA_API_KEY to .env, restart the server, then reload this page.');
    return;
  }
  if (!els.consent.checked) {
    els.consent.focus();
    return;
  }

  resetSession();
  state.includeFace = els.expressions.checked;
  showScreen('session');
  els.timer.textContent = '0:00';
  els.phase.textContent = 'Preparing';
  els.phaseSub.textContent = config.demo ? 'Loading the recorded clip…' : 'Asking for the camera…';
  setSessionNote('One moment.');
  setHint(config.demo ? DEMO_HINT : DEFAULT_HINT);
  setCameraBadge(config.demo ? 'clip' : 'camera');

  try {
    startEvents();
    if (config.demo) {
      await startDemoVideo();
    } else if (config.captureMode === 'camera') {
      startServerPreview();
    } else {
      await startCamera();
    }
    const ws = await openSocket();
    state.ws = ws;
    const started = waitForStart();
    ws.send(JSON.stringify({
      type: 'start',
      includeFace: state.includeFace,
      preview: config.captureMode === 'camera',
    }));
    await started;

    state.startedAt = performance.now();
    state.settleEndsAt = state.startedAt + config.settleMs;
    state.pacedEndsAt = state.settleEndsAt + config.sessionMs;
    state.settleBreathStart = state.startedAt;
    state.phase = 'settle';
    state.pacer = new Pacer({ periodMs: 10000 });
    state.lastPhaseKey = '';
    if (!config.demo && config.captureMode !== 'camera') startPump();
    startTicker();
    updateSettle(performance.now(), true);
    announce('Session started. Settle in and let your breath be natural.');
  } catch (error) {
    const code = error?.code;
    if (code === 'missing_key' || code === 'sdk_unavailable' || code === 'busy') {
      showError(friendlyError(error));
      resetToIntro();
    } else {
      showError(friendlyError(error));
      finishSession('error', null);
    }
  }
}

function resetSession() {
  cleanupSession();
  state.finished = false;
  state.ending = false;
  state.paced = false;
  state.phase = 'preparing';
  state.breaths = 0;
  state.pacer = null;
  state.lastMetrics = null;
  state.hrv = null;
  state.samples = { pulse: [], breathing: [] };
  state.lastTs = { pulse: null, breathing: null };
  state.startedAt = 0;
  state.settleEndsAt = 0;
  state.pacedEndsAt = 0;
  state.settleBreathStart = 0;
  state.lastPhaseKey = '';
  state.stopReason = null;
  state.hintAt = 0;
  state.expressionAt = 0;
  els.expressionNote.hidden = true;
  els.previewCard.classList.remove('hidden-preview', 'demo-mode');
  els.previewToggle.textContent = 'Hide preview';
  els.previewLabel.textContent = 'Positioning';
  scene.setExpression(null);
  resetMetricDisplays();
}

function cleanupSession() {
  stopPump();
  stopTicker();
  if (state.stopTimer) {
    clearTimeout(state.stopTimer);
    state.stopTimer = null;
  }
  state.startWaiter = null;
  stopCamera();
  if (state.ws) {
    try {
      state.ws.close();
    } catch {}
    state.ws = null;
  }
  if (state.es) {
    state.es.close();
    state.es = null;
  }
}

function resetToIntro() {
  cleanupSession();
  state.finished = false;
  state.ending = false;
  state.paced = false;
  state.phase = 'intro';
  state.breaths = 0;
  state.pacer = null;
  state.lastMetrics = null;
  state.hrv = null;
  state.samples = { pulse: [], breathing: [] };
  state.lastTs = { pulse: null, breathing: null };
  state.startedAt = 0;
  state.stopReason = null;
  els.expressionNote.hidden = true;
  els.previewCard.classList.remove('hidden-preview', 'demo-mode');
  els.previewToggle.textContent = 'Hide preview';
  els.previewLabel.textContent = 'Positioning';
  els.timer.textContent = '0:00';
  els.phase.textContent = 'Settle in';
  els.phaseSub.textContent = 'Let your breath be natural.';
  els.breaths.textContent = '';
  setSessionNote('Breathe naturally while we learn your rhythm.');
  scene.setExpression(null);
  resetMetricDisplays();
  hideError();
  showScreen('intro');
  updateStartState();
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error('Camera capture is unavailable.');
    error.name = 'SecurityError';
    throw error;
  }
  const constraints = {
    facingMode: 'user',
    width: { ideal: 960 },
    height: { ideal: 540 },
    frameRate: { min: 30, ideal: 30, max: 30 },
  };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
  } catch (error) {
    if (error?.name !== 'OverconstrainedError') throw error;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
  }
  state.stream = stream;
  els.previewCard.classList.remove('demo-mode');
  els.preview.srcObject = stream;
  els.preview.muted = true;
  els.preview.playsInline = true;
  await els.preview.play().catch(() => {});
  els.previewLabel.textContent = 'Positioning';
}

function startServerPreview() {
  els.previewCard.classList.add('camera-mode');
  els.previewCard.classList.remove('demo-mode');
  els.preview.srcObject = null;
  if (els.previewCanvas) {
    els.previewCanvas.hidden = false;
    els.previewCanvas.width = 320;
    els.previewCanvas.height = 240;
    const ctx = els.previewCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0a1220';
      ctx.fillRect(0, 0, els.previewCanvas.width, els.previewCanvas.height);
    }
  }
  els.previewLabel.textContent = 'Positioning';
}

function drawPreview(data) {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 12 || !els.previewCanvas) return;
  const view = new DataView(data);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  if (!width || !height || data.byteLength < 12 + width * height * 4) return;
  if (els.previewCanvas.width !== width || els.previewCanvas.height !== height) {
    els.previewCanvas.width = width;
    els.previewCanvas.height = height;
  }
  const ctx = els.previewCanvas.getContext('2d');
  if (!ctx) return;
  const pixels = new Uint8ClampedArray(data, 12, width * height * 4);
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
}

async function startDemoVideo() {
  els.previewCard.classList.add('demo-mode');
  els.preview.srcObject = null;
  els.preview.loop = true;
  els.preview.muted = true;
  els.preview.playsInline = true;
  if (!els.preview.getAttribute('src')) els.preview.src = '/demo.mp4';
  els.previewLabel.textContent = 'Recorded clip';
  setHint(DEMO_HINT);
  await els.preview.play().catch(() => {});
}

function stopCamera() {
  els.previewCard.classList.remove('camera-mode');
  if (els.previewCanvas) {
    els.previewCanvas.hidden = true;
    const ctx = els.previewCanvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, els.previewCanvas.width, els.previewCanvas.height);
  }
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
    state.stream = null;
  }
  if (els.preview) {
    els.preview.srcObject = null;
    if (els.preview.getAttribute('src')) {
      els.preview.removeAttribute('src');
      els.preview.load();
    }
  }
}

function openSocket() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      reject(Object.assign(new Error('The local service did not respond.'), { code: 'ws_timeout' }));
    }, 8000);

    ws.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ws);
    };
    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(new Error('Could not reach the local measurement service.'), { code: 'ws' }));
    };
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        handleSocketMessage(event.data);
        return;
      }
      if (config.captureMode === 'camera' && event.data instanceof ArrayBuffer) {
        drawPreview(event.data);
      }
    };
    ws.onclose = () => {
      if (state.ws === ws) state.ws = null;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(Object.assign(new Error('The local service closed the connection.'), { code: 'ws' }));
        return;
      }
      if (state.screen === 'session' && !state.ending && !state.finished) {
        showError('The local service disconnected. Start a new session when it is back.');
        finishSession('disconnect', null);
      }
    };
  });
}

function waitForStart() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.startWaiter = null;
      reject(Object.assign(new Error('The measurement service took too long to start.'), { code: 'timeout' }));
    }, 25000);
    state.startWaiter = {
      resolve: () => {
        clearTimeout(timer);
        state.startWaiter = null;
        resolve();
      },
      reject: (error) => {
        clearTimeout(timer);
        state.startWaiter = null;
        reject(error);
      },
    };
  });
}

function handleSocketMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (!message || typeof message !== 'object') return;
  if (message.type === 'started') {
    if (state.startWaiter) state.startWaiter.resolve();
    return;
  }
  if (message.type === 'error') {
    const error = Object.assign(new Error(message.message || 'The session could not start.'), {
      code: message.code,
    });
    if (state.startWaiter) {
      state.startWaiter.reject(error);
      return;
    }
    showError(friendlyError(error));
    if (state.screen === 'session' && message.code !== 'busy') requestStop('error');
  }
}

function startEvents() {
  if (state.es) state.es.close();
  const es = new EventSource('/api/events');
  state.es = es;
  es.addEventListener('config', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data && typeof data.hasKey === 'boolean') Object.assign(config, data);
    } catch {}
  });
  es.addEventListener('metrics', (event) => onMetrics(JSON.parse(event.data)));
  es.addEventListener('validation', (event) => onValidation(JSON.parse(event.data)));
  es.addEventListener('session-error', (event) => onSessionError(JSON.parse(event.data)));
  es.addEventListener('ended', (event) => {
    const data = JSON.parse(event.data);
    if (state.stopTimer) {
      clearTimeout(state.stopTimer);
      state.stopTimer = null;
    }
    finishSession(state.stopReason || data.reason || 'complete', data.summary);
  });
  es.onerror = () => {
    if (state.screen === 'session' && !state.ending) {
      showError('Reconnecting to the local metric stream…');
    }
  };
}

function onMetrics(data) {
  if (state.screen !== 'session' || !data) return;
  state.lastMetrics = data;

  if (data.pulse) {
    if (data.pulse.timestamp !== state.lastTs.pulse) {
      state.lastTs.pulse = data.pulse.timestamp;
      state.samples.pulse.push(data.pulse);
    }
    renderMetric(
      els.pulse,
      els.pulseSignal,
      data.pulse.confidence >= 10 ? Math.round(data.pulse.value) : null,
      data.pulse.confidence,
    );
  }

  if (data.breathing) {
    if (data.breathing.timestamp !== state.lastTs.breathing) {
      state.lastTs.breathing = data.breathing.timestamp;
      state.samples.breathing.push(data.breathing);
    }
    renderMetric(
      els.breathing,
      els.breathingSignal,
      data.breathing.confidence >= 10 ? data.breathing.value.toFixed(1) : null,
      data.breathing.confidence,
    );
    const rate = data.breathing.value;
    if (Number.isFinite(rate) && rate > 0 && data.breathing.confidence >= 25 && state.pacer) {
      state.pacer.setMeasuredRate(rate);
    }
  }

  if (data.hrv) {
    state.hrv = data.hrv;
    renderMetric(
      els.hrv,
      els.hrvSignal,
      data.hrv.confidence >= 10 ? Math.round(data.hrv.rmssd) : null,
      data.hrv.confidence,
    );
  }

  if (state.includeFace && data.expression) {
    const confidence = data.expression.confidence ?? 0;
    if (confidence >= 35) {
      state.expression = data.expression;
      state.expressionAt = performance.now();
      scene.setExpression(data.expression);
      els.expressionNote.hidden = false;
      els.expressionNote.textContent = 'Scene tuned to your expression.';
    }
  }
}

const HINT_COPY = new Map([
  ['Place more of the chest in view.', 'Move back so your head and upper chest are in frame.'],
  ['No face found.', 'Center your face in the frame.'],
  ['Move up, or tilt the camera down.', 'Raise the camera or tilt it down slightly.'],
  ['Move down, or tilt the camera up.', 'Lower the camera slightly, or tilt it up.'],
  ['Face the camera.', 'Face the camera and hold still.'],
  ['Hold still and record.', 'Hold still and breathe naturally.'],
  [
    'Use a camera mode that provides at least 25 frames per second.',
    'Hold still — the signal is stabilizing.',
  ],
]);

function onValidation(data) {
  if (state.screen !== 'session' || !data) return;
  const hint = String(data.hint || '').trim();
  if (!hint) return;
  setHint(HINT_COPY.get(hint) || hint);
  state.hintAt = performance.now();
}

function onSessionError(data) {
  if (!data) return;
  const error = Object.assign(new Error(data.message || 'SmartSpectra error'), {
    code: data.code,
    retryable: data.retryable,
  });
  showError(friendlyError(error));
  if (!data.retryable || TERMINAL_ERROR_CODES.has(data.code)) requestStop('error');
}

function startPump() {
  stopPump();
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const packet = new Uint8Array(12 + 640 * 480 * 4);
  const header = new DataView(packet.buffer, 0, 12);
  header.setUint32(0, 640, true);
  header.setUint32(4, 480, true);
  let sequence = 0;
  const debug = {
    sent: 0,
    skippedBuffered: 0,
    skippedNoVideo: 0,
    totalMs: 0,
    maxMs: 0,
    lastBuffered: 0,
  };
  window.__stillpointPump = debug;

  state.pump = setInterval(() => {
    if (state.screen !== 'session' || state.phase === 'preparing') return;
    const ws = state.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    debug.lastBuffered = ws.bufferedAmount;
    if (ws.bufferedAmount > 6 * 1024 * 1024) {
      debug.skippedBuffered += 1;
      return;
    }
    const video = els.preview;
    if (!video.videoWidth || !video.videoHeight) {
      debug.skippedNoVideo += 1;
      return;
    }
    const startedAt = performance.now();

    const targetAspect = 4 / 3;
    let sx = 0;
    let sy = 0;
    let sw = video.videoWidth;
    let sh = video.videoHeight;
    if (sw / sh > targetAspect) {
      sw = sh * targetAspect;
      sx = (video.videoWidth - sw) / 2;
    } else {
      sh = sw / targetAspect;
      sy = (video.videoHeight - sh) / 2;
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, 640, 480);
    const frame = ctx.getImageData(0, 0, 640, 480).data;
    header.setUint32(8, sequence++ >>> 0, true);
    packet.set(frame, 12);
    ws.send(packet);
    debug.sent += 1;
    const elapsed = performance.now() - startedAt;
    debug.totalMs += elapsed;
    if (elapsed > debug.maxMs) debug.maxMs = elapsed;
  }, 33);
}

function stopPump() {
  if (state.pump) {
    clearInterval(state.pump);
    state.pump = null;
  }
}

function startTicker() {
  stopTicker();
  state.ticker = setInterval(() => {
    if (state.screen !== 'session') return;
    const now = performance.now();
    els.timer.textContent = formatClock(now - state.startedAt);

    if (!state.paced) {
      if (now >= state.settleEndsAt) enterPaced(now);
      else updateSettle(now, false);
    }
    if (now >= state.pacedEndsAt) requestStop('complete');

    if (state.hintAt && now - state.hintAt > 9000) {
      setHint(config.demo ? DEMO_HINT : DEFAULT_HINT);
      state.hintAt = 0;
    }
    if (state.expressionAt && now - state.expressionAt > 12000) {
      els.expressionNote.hidden = true;
    }
  }, 250);
}

function stopTicker() {
  if (state.ticker) {
    clearInterval(state.ticker);
    state.ticker = null;
  }
}

function updateSettle(now, force) {
  const remaining = Math.max(0, Math.ceil((state.settleEndsAt - now) / 1000));
  const key = `settle-${remaining}`;
  if (!force && state.lastPhaseKey === key) return;
  state.lastPhaseKey = key;
  els.phase.textContent = 'Settle in';
  els.phaseSub.textContent = `Breathe naturally · ${remaining}s`;
  els.breaths.textContent = '';
}

function enterPaced(now) {
  if (state.paced) return;
  state.paced = true;
  state.phase = 'paced';
  const rate =
    state.lastMetrics?.breathing && state.lastMetrics.breathing.confidence >= 25
      ? state.lastMetrics.breathing.value
      : null;
  if (Number.isFinite(rate) && rate > 0) state.pacer.setMeasuredRate(rate);
  state.pacer.begin(now);
  state.lastPhaseKey = '';
  setSessionNote(
    Number.isFinite(rate) && rate > 0
      ? 'Your rhythm is the starting point. We will slow it gently.'
      : 'Follow the orb. We will keep a gentle pace.',
  );
  els.breaths.textContent = '';
  announce('Now follow the orb. Breathe in as it grows, and out as it settles.');
}

function updatePaced(tick) {
  const label = tick.phase === 'in' ? 'Breathe in' : 'Breathe out';
  if (state.lastPhaseKey !== label) {
    state.lastPhaseKey = label;
    els.phase.textContent = label;
    announce(label);
  }
  const seconds = Math.ceil(tick.remainingMs / 1000);
  const adaptive = tick.adjusting
    ? 'gently slowing'
    : tick.measured
      ? 'matching your rhythm'
      : 'a gentle pace';
  const sub = `${seconds}s · ${adaptive}`;
  if (els.phaseSub.textContent !== sub) els.phaseSub.textContent = sub;
  els.breaths.textContent = tick.breaths ? `${tick.breaths} breaths guided` : '';
}

function loop(now) {
  let visual;
  if (state.screen === 'session' && state.phase !== 'preparing') {
    if (state.paced && state.pacer) {
      const tick = state.pacer.tick(now);
      state.breaths = tick.breaths;
      visual = { breath: tick.breath, progress: tick.progress, paced: true };
      updatePaced(tick);
    } else {
      const elapsed = now - (state.settleBreathStart || now);
      visual = {
        breath: 0.5 + 0.5 * Math.sin((elapsed / 13000) * Math.PI * 2),
        progress: 0,
        paced: false,
      };
    }
  } else {
    visual = {
      breath: 0.5 + 0.5 * Math.sin((now / 11000) * Math.PI * 2),
      progress: 0,
      paced: false,
    };
  }
  const pulse = state.lastMetrics?.pulse;
  visual.pulse = pulse && (pulse.confidence ?? 0) >= 15 ? pulse.value : null;
  visual.pulseConfidence = pulse?.confidence ?? 0;
  scene.render(now, visual);
  state.raf = requestAnimationFrame(loop);
}

function requestStop(reason) {
  if (state.finished || state.ending) return;
  state.ending = true;
  state.stopReason = reason;
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    try {
      state.ws.send(JSON.stringify({ type: 'stop' }));
    } catch {}
  }
  if (state.stopTimer) clearTimeout(state.stopTimer);
  state.stopTimer = setTimeout(() => finishSession(reason, null), 1800);
  if (reason === 'hidden' || reason === 'pagehide') finishSession(reason, null);
}

function finishSession(reason, summary) {
  if (state.finished) return;
  state.finished = true;
  state.stopReason = reason;
  if (state.stopTimer) {
    clearTimeout(state.stopTimer);
    state.stopTimer = null;
  }
  const elapsed = state.startedAt ? performance.now() - state.startedAt : 0;
  cleanupSession();
  showScreen('summary');
  renderSummary(reason, summary, elapsed);
  announce('Session complete.');
}

function localSummary(elapsed) {
  const pulse = summarizeMeasurements(state.samples.pulse, { min: 30, max: 200 });
  const breathing = summarizeMeasurements(state.samples.breathing, { min: 3, max: 60 });
  return {
    durationMs: elapsed,
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
    hrv: state.hrv
      ? { rmssd: round(state.hrv.rmssd, 1), confidence: round(state.hrv.confidence, 0) }
      : null,
    frames: { in: 0, dropped: 0 },
  };
}

function signalLabel(data) {
  if (!data) return '—';
  const hasPulse = data.pulse?.median !== null && data.pulse?.median !== undefined;
  const hasBreathing = data.breathing?.median !== null && data.breathing?.median !== undefined;
  if (!hasPulse && !hasBreathing) return 'Too little signal';
  const frames = data.frames || {};
  const dropped = frames.in ? (frames.dropped || 0) / frames.in : 0;
  if (hasPulse && hasBreathing) return dropped > 0.2 ? 'Good · patchy frames' : 'Good';
  return 'Limited';
}

function renderSummary(reason, summary, elapsed) {
  const data = summary || localSummary(elapsed);
  const finite = (value) => value !== null && value !== undefined && Number.isFinite(value);

  els.sumTime.textContent = formatClock(data?.durationMs ?? elapsed);
  els.sumBreaths.textContent = state.breaths ? String(state.breaths) : '—';
  els.sumPulse.textContent = finite(data?.pulse?.median)
    ? `${Math.round(data.pulse.median)} bpm`
    : '—';
  els.sumBreathing.textContent = finite(data?.breathing?.median)
    ? `${data.breathing.median.toFixed(1)} /min`
    : '—';
  els.sumHrv.textContent =
    finite(data?.hrv?.rmssd) && (data.hrv.confidence ?? 0) >= 10
      ? `${Math.round(data.hrv.rmssd)} ms`
      : '—';
  els.sumSignal.textContent = signalLabel(data);

  const noSignal = !finite(data?.pulse?.median) && !finite(data?.breathing?.median);
  if (reason === 'hidden') {
    els.summaryTitle.textContent = 'The session paused when the tab hid.';
    els.summaryLede.textContent =
      'Nothing was saved. Come back whenever you want to begin again.';
  } else if (reason === 'error' || reason === 'disconnect' || reason === 'shutdown') {
    els.summaryTitle.textContent = 'The session ended early.';
    els.summaryLede.textContent = 'That still counts. Start again when the signal is steady.';
  } else if (reason === 'user') {
    els.summaryTitle.textContent = 'You stopped early. That still counts.';
    els.summaryLede.textContent =
      'Even a few slower breaths are a pause. Come back when you have another minute.';
  } else {
    els.summaryTitle.textContent = 'You gave yourself two minutes.';
    els.summaryLede.textContent = 'No score. No streak. Just a slower rhythm to carry with you.';
  }

  els.summaryNote.textContent = noSignal
    ? 'The camera did not produce a stable pulse or breathing reading. Even light, a still camera, and your face and upper chest in frame make the biggest difference. Wellness only — not a medical device.'
    : 'Wellness only. SmartSpectra metrics are not FDA-cleared and are not a diagnosis.';
}

function togglePreview() {
  const hidden = els.previewCard.classList.toggle('hidden-preview');
  els.previewToggle.textContent = hidden ? 'Show preview' : 'Hide preview';
  if (!hidden) els.previewLabel.textContent = config.demo ? 'Recorded clip' : 'Positioning';
}

function bindUi() {
  els.consent.addEventListener('change', updateStartState);
  els.expressions.addEventListener('change', () => {
    state.includeFace = els.expressions.checked;
    if (!state.includeFace) {
      els.expressionNote.hidden = true;
      scene.setExpression(null);
    }
  });
  els.start.addEventListener('click', () => {
    beginSession();
  });
  els.privacyOpen.addEventListener('click', () => {
    if (!els.privacyDialog.open) els.privacyDialog.showModal();
  });
  els.privacyClose.addEventListener('click', () => els.privacyDialog.close());
  els.privacyDialog.addEventListener('click', (event) => {
    if (event.target === els.privacyDialog) els.privacyDialog.close();
  });
  els.errorClose.addEventListener('click', hideError);
  els.stop.addEventListener('click', () => requestStop('user'));
  els.previewToggle.addEventListener('click', togglePreview);
  els.again.addEventListener('click', async () => {
    resetToIntro();
    await beginSession();
  });
  els.done.addEventListener('click', resetToIntro);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.screen === 'session') requestStop('user');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.screen === 'session') {
      requestStop('hidden');
    }
  });
  window.addEventListener('pagehide', () => {
    if (state.screen === 'session') {
      stopCamera();
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        try {
          state.ws.send(JSON.stringify({ type: 'stop' }));
        } catch {}
      }
    }
  });
}

init();
