import http from 'node:http';
import path from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { WebSocketServer } from 'ws';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = (process.env.SMARTSPECTRA_API_KEY || '').trim();
const SESSION_MS = Number(process.env.SESSION_MS || 90000);
const SETTLE_MS = Number(process.env.SETTLE_MS || 32000);
const TERMINAL_ERROR_CODES = new Set([2, 3, 4, 13, 14]);
const DEMO_VIDEO = process.env.DEMO_VIDEO
  ? path.resolve(process.cwd(), process.env.DEMO_VIDEO)
  : null;
const DEMO_ENABLED = Boolean(DEMO_VIDEO && existsSync(DEMO_VIDEO));
const CAPTURE_MODE = process.env.CAPTURE_MODE === 'frames' ? 'frames' : 'camera';
const CAMERA_WIDTH = Number(process.env.CAMERA_WIDTH || 1280);
const CAMERA_HEIGHT = Number(process.env.CAMERA_HEIGHT || 720);
const CAMERA_FPS = Number(process.env.CAMERA_FPS || 30);
const VERSION = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')).version;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
};

const CSP = [
  "default-src 'self'",
  "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "style-src 'self'",
  "script-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const clients = new Set();
let active = null;
let stopCounter = 0;

function baseHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': CSP,
    'Permissions-Policy': 'camera=(self), microphone=()',
    ...extra,
  };
}

function configPayload() {
  return {
    version: VERSION,
    hasKey: Boolean(API_KEY),
    demo: DEMO_ENABLED,
    captureMode: DEMO_ENABLED ? 'file' : CAPTURE_MODE,
    camera: {
      width: CAMERA_WIDTH,
      height: CAMERA_HEIGHT,
      fps: CAMERA_FPS,
    },
    sessionMs: SESSION_MS,
    settleMs: SETTLE_MS,
    platform: process.platform,
    arch: process.arch,
  };
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const res of clients) {
    try {
      sseWrite(res, event, data);
    } catch {
      clients.delete(res);
    }
  }
}

function isLoopback(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (!isLoopback(url.hostname)) return false;
    return url.host === req.headers.host;
  } catch {
    return false;
  }
}

function wsOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return isLoopback(url.hostname) && url.host === req.headers.host;
  } catch {
    return false;
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(
    status,
    baseHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
    }),
  );
  res.end(payload);
}

async function serveStatic(req, res, pathname) {
  let relative;
  if (pathname === '/' || pathname === '/index.html') {
    relative = 'index.html';
  } else if (pathname === '/privacy' || pathname === '/privacy.html') {
    relative = 'privacy.html';
  } else {
    try {
      relative = decodeURIComponent(pathname.replace(/^\/+/, ''));
    } catch {
      sendJson(res, 400, { error: 'bad_path' });
      return;
    }
  }
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  let info;
  try {
    info = await stat(filePath);
  } catch {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  if (!info.isFile()) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  const extension = path.extname(filePath).toLowerCase();
  res.writeHead(
    200,
    baseHeaders({
      'Content-Type': MIME[extension] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    }),
  );
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

async function serveDemoVideo(req, res) {
  if (!DEMO_ENABLED) {
    sendJson(res, 404, { error: 'no_demo_video' });
    return;
  }
  const info = await stat(DEMO_VIDEO);
  const range = req.headers.range;
  if (!range) {
    res.writeHead(
      200,
      baseHeaders({
        'Content-Type': 'video/mp4',
        'Content-Length': info.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      }),
    );
    createReadStream(DEMO_VIDEO).pipe(res);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.writeHead(416, baseHeaders({ 'Content-Range': `bytes */${info.size}` }));
    res.end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= info.size) {
    res.writeHead(416, baseHeaders({ 'Content-Range': `bytes */${info.size}` }));
    res.end();
    return;
  }
  res.writeHead(
    206,
    baseHeaders({
      'Content-Type': 'video/mp4',
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${info.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    }),
  );
  createReadStream(DEMO_VIDEO, { start, end }).pipe(res);
}

async function stopActive(reason) {
  const current = active;
  if (!current) return null;
  active = null;
  if (current.timer) clearTimeout(current.timer);
  let summary = null;
  try {
    summary = await current.session.stop();
  } catch {}
  if (summary) {
    const durationMs = summary.durationMs || 0;
    const fps = durationMs > 0 ? Math.round((summary.frames.in / durationMs) * 1000) : 0;
    console.log(
      `Session ended (${reason}): ${Math.round(durationMs / 1000)}s, ` +
        `${summary.frames.in} frames in, ${summary.frames.dropped} dropped, ${fps} fps, ` +
        `send ${summary.timing?.sendAvgMs}ms avg / ${summary.timing?.sendMaxMs}ms max, ` +
        `metrics ${summary.timing?.metricsAvgMs}ms avg / ${summary.timing?.metricsMaxMs}ms max`,
    );
  }
  broadcast('ended', { reason, summary, at: Date.now() });
  return summary;
}

function buildPreview({ buffer, width, height, stride }, seq) {
  if (!buffer || width < 16 || height < 16 || stride < width * 3) return null;
  const bpp = Math.max(3, Math.round(stride / width));
  const previewWidth = Math.min(320, width);
  const previewHeight = Math.round((previewWidth * 3) / 4);
  const targetAspect = 4 / 3;
  let cropWidth = width;
  let cropHeight = height;
  let cropX = 0;
  let cropY = 0;
  if (width / height > targetAspect) {
    cropWidth = Math.round(height * targetAspect);
    cropX = Math.round((width - cropWidth) / 2);
  } else {
    cropHeight = Math.round(width / targetAspect);
    cropY = Math.round((height - cropHeight) / 2);
  }
  const out = Buffer.allocUnsafe(12 + previewWidth * previewHeight * 4);
  out.writeUInt32LE(previewWidth, 0);
  out.writeUInt32LE(previewHeight, 4);
  out.writeUInt32LE(seq, 8);
  for (let y = 0; y < previewHeight; y += 1) {
    const sourceY = Math.min(
      height - 1,
      cropY + Math.floor((y * cropHeight) / previewHeight),
    );
    const sourceRow = sourceY * stride;
    for (let x = 0; x < previewWidth; x += 1) {
      const sourceX = Math.min(
        width - 1,
        cropX + Math.floor((x * cropWidth) / previewWidth),
      );
      const sourceIndex = sourceRow + sourceX * bpp;
      const targetIndex = 12 + (y * previewWidth + x) * 4;
      out[targetIndex] = buffer[sourceIndex];
      out[targetIndex + 1] = buffer[sourceIndex + 1];
      out[targetIndex + 2] = buffer[sourceIndex + 2];
      out[targetIndex + 3] = bpp >= 4 ? buffer[sourceIndex + 3] : 255;
    }
  }
  return out;
}

async function startSession(ws, message) {
  if (active) {
    ws.send(JSON.stringify({ type: 'error', code: 'busy', message: 'A session is already running.' }));
    return;
  }
  if (!API_KEY) {
    ws.send(
      JSON.stringify({
        type: 'error',
        code: 'missing_key',
        message: 'The server has no Presage API key. Add SMARTSPECTRA_API_KEY to .env and restart.',
      }),
    );
    return;
  }
  let SmartSession;
  let sdkModule = null;
  try {
    sdkModule = await import('@smartspectra/node-sdk');
    ({ SmartSession } = await import('./lib/session.mjs'));
  } catch (error) {
    ws.send(
      JSON.stringify({
        type: 'error',
        code: 'sdk_unavailable',
        message: `SmartSpectra could not load on ${process.platform}-${process.arch}. ${error.message}`,
      }),
    );
    return;
  }
  if (active) {
    ws.send(JSON.stringify({ type: 'error', code: 'busy', message: 'A session is already running.' }));
    return;
  }
  const mode = DEMO_ENABLED ? 'file' : CAPTURE_MODE;
  const includeFace = message.includeFace !== false;
  let cameraId = process.env.CAMERA_ID || null;
  if (mode === 'camera' && !cameraId && sdkModule) {
    try {
      cameraId = sdkModule.SmartSpectraSDK.availableCameras()[0]?.id || null;
    } catch {}
  }
  const session = new SmartSession({
    apiKey: API_KEY,
    mode,
    videoPath: DEMO_ENABLED ? DEMO_VIDEO : null,
    includeFace,
    cameraId,
    cameraOptions: {
      width: CAMERA_WIDTH,
      height: CAMERA_HEIGHT,
      fps: CAMERA_FPS,
    },
  });
  const current = {
    id: ++stopCounter,
    ws,
    session,
    includeFace,
    lastFrameAt: 0,
    reason: 'user',
    timer: null,
    previewSeq: 0,
    lastPreviewAt: 0,
    previewEnabled: message.preview !== false && mode === 'camera',
  };
  active = current;

  session.on('metrics', (data) => {
    if (active === current) broadcast('metrics', data);
  });
  session.on('status', (data) => {
    if (active === current) broadcast('status', data);
  });
  session.on('video', (frame) => {
    if (active !== current || !current.previewEnabled) return;
    const socket = current.ws;
    if (!socket || socket.readyState !== 1) return;
    const now = Date.now();
    if (now - current.lastPreviewAt < 100) return;
    current.lastPreviewAt = now;
    current.previewSeq = (current.previewSeq + 1) >>> 0;
    const preview = buildPreview(frame, current.previewSeq);
    if (preview) socket.send(preview, { binary: true });
  });
  const validationGate = { hint: '', at: 0 };
  session.on('validation', (data) => {
    if (active !== current) return;
    const now = Date.now();
    if (data.hint === validationGate.hint && now - validationGate.at < 4000) return;
    validationGate.hint = data.hint;
    validationGate.at = now;
    broadcast('validation', data);
  });
  session.on('settled', (data) => {
    if (active === current && data.name === 'idle') stopActive('complete');
  });
  session.on('error', (data) => {
    if (active !== current) return;
    broadcast('session-error', data);
    if (!data.retryable || TERMINAL_ERROR_CODES.has(data.code)) {
      setTimeout(() => {
        if (active === current) stopActive('error');
      }, 150);
    }
  });

  try {
    session.start();
  } catch (error) {
    active = null;
    try {
      await session.stop();
    } catch {}
    ws.send(
      JSON.stringify({
        type: 'error',
        code: 'start_failed',
        message: error.message || 'SmartSpectra could not start.',
      }),
    );
    return;
  }

  current.timer = setTimeout(() => {
    if (active === current) stopActive('timeout');
  }, SETTLE_MS + SESSION_MS + 45000);
  current.timer.unref?.();

  ws.send(
    JSON.stringify({
      type: 'started',
      mode,
      sessionMs: SESSION_MS,
      settleMs: SETTLE_MS,
      includeFace,
    }),
  );
}

function handleFrame(data) {
  if (!active) return;
  const now = Date.now();
  if (now - active.lastFrameAt < 15) return;
  if (data.length < 12) return;
  const width = data.readUInt32LE(0);
  const height = data.readUInt32LE(4);
  if (width < 16 || height < 16 || width > 1280 || height > 1280) return;
  if (width * height > 1280 * 720) return;
  if (data.length !== 12 + width * height * 4) return;
  active.lastFrameAt = now;
  active.session.pushFrame(data.subarray(12), width, height);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/api/config') {
      sendJson(res, 200, configPayload());
      return;
    }
    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(
        200,
        baseHeaders({
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        }),
      );
      res.write('retry: 2000\n\n');
      clients.add(res);
      sseWrite(res, 'config', configPayload());
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'POST' && pathname === '/api/stop') {
      if (!sameOrigin(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
      }
      await stopActive('user');
      sendJson(res, 200, { ok: true });
      return;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/demo.mp4' || pathname === '/media/demo.mp4')) {
      await serveDemoVideo(req, res);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, pathname);
      return;
    }
    sendJson(res, 405, { error: 'method_not_allowed' });
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'internal_error' });
    } else {
      res.end();
    }
    console.error('request failed:', error.message);
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();
const wsStats = { messages: 0, bytes: 0, since: Date.now() };
setInterval(() => {
  const elapsed = Math.max(1, (Date.now() - wsStats.since) / 1000);
  if (active) {
    const buffered = [...wss.clients].map((client) => client.bufferedAmount).join(',');
    console.log(
      `ws inflow: ${(wsStats.messages / elapsed).toFixed(1)} msg/s, ` +
        `${(wsStats.bytes / 1e6 / elapsed).toFixed(1)} MB/s, ` +
        `frames ${active.session.frames.in}, buffered ${buffered}, ` +
        `loop p95 ${(loopDelay.percentile(95) / 1e6).toFixed(1)}ms ` +
        `max ${(loopDelay.max / 1e6).toFixed(1)}ms`,
    );
  }
  wsStats.messages = 0;
  wsStats.bytes = 0;
  wsStats.since = Date.now();
  loopDelay.reset();
}, 5000).unref();

server.on('upgrade', (req, socket, head) => {
  let pathname;
  try {
    pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (pathname !== '/ws' || !wsOriginAllowed(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      wsStats.messages += 1;
      wsStats.bytes += data.length;
      handleFrame(Buffer.isBuffer(data) ? data : Buffer.from(data));
      return;
    }
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'start') {
      startSession(ws, message).catch((error) => {
        ws.send(JSON.stringify({ type: 'error', code: 'start_failed', message: error.message }));
      });
      return;
    }
    if (message.type === 'stop') {
      if (active && active.ws === ws) stopActive('user');
    }
  });
  ws.on('close', () => {
    if (active && active.ws === ws) stopActive('disconnect');
  });
  ws.on('error', () => {
    ws.terminate();
  });
});

const keepAlive = setInterval(() => {
  for (const res of clients) {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clients.delete(res);
    }
  }
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);
keepAlive.unref?.();

server.listen(PORT, HOST, () => {
  console.log(`Stillpoint listening on http://${HOST}:${PORT}`);
  if (!API_KEY) {
    console.log('No SMARTSPECTRA_API_KEY set. Copy .env.example to .env and add a key.');
  }
  if (DEMO_VIDEO && !DEMO_ENABLED) {
    console.log(`DEMO_VIDEO not found: ${DEMO_VIDEO}`);
  } else if (DEMO_ENABLED) {
    console.log('Demo video mode is enabled; no camera will be used.');
  }
});

async function shutdown() {
  await stopActive('shutdown');
  for (const ws of wss.clients) ws.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
