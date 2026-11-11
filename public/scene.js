const PALETTES = {
  neutral: { top: '#071021', bottom: '#123044', accent: '#7fe3d4', warm: '#f4d9a6', orb: '#fff4dc' },
  happy: { top: '#0b1026', bottom: '#3a2545', accent: '#ffd28a', warm: '#ffe9b8', orb: '#fff8e6' },
  sad: { top: '#081226', bottom: '#1d2a44', accent: '#8fb8ff', warm: '#cfe0ff', orb: '#f2f6ff' },
  angry: { top: '#160b12', bottom: '#3a1420', accent: '#ff9a8a', warm: '#ffc2a8', orb: '#fff0e8' },
  fear: { top: '#120f22', bottom: '#2a1e3d', accent: '#c6a8ff', warm: '#e3d4ff', orb: '#fbf6ff' },
  surprise: { top: '#081a22', bottom: '#14505a', accent: '#9ef7ff', warm: '#d6fcff', orb: '#f2ffff' },
  disgust: { top: '#0c1410', bottom: '#20302a', accent: '#a9d6a0', warm: '#d9e8c8', orb: '#f4faee' },
  contempt: { top: '#101018', bottom: '#2b2b38', accent: '#b9b3d6', warm: '#ded9ee', orb: '#f7f5ff' },
  unspecified: { top: '#071021', bottom: '#123044', accent: '#7fe3d4', warm: '#f4d9a6', orb: '#fff4dc' },
};

const DEFAULT_PALETTE = PALETTES.neutral;

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function rgbString(rgb, alpha = 1) {
  const [r, g, b] = rgb.map((channel) => Math.round(channel));
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function paletteToRgb(palette) {
  return {
    top: hexToRgb(palette.top),
    bottom: hexToRgb(palette.bottom),
    accent: hexToRgb(palette.accent),
    warm: hexToRgb(palette.warm),
    orb: hexToRgb(palette.orb),
  };
}

function blend(current, target, amount) {
  return current.map((channel, index) => channel + (target[index] - channel) * amount);
}

function createStars() {
  const stars = [];
  for (let index = 0; index < 120; index += 1) {
    stars.push({
      x: Math.random(),
      y: Math.random() * 0.52,
      radius: 0.4 + Math.random() * 1.3,
      phase: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.9,
    });
  }
  return stars;
}

function createMotes() {
  const motes = [];
  for (let index = 0; index < 34; index += 1) {
    motes.push({
      x: 0.2 + Math.random() * 0.6,
      y: 0.45 + Math.random() * 0.5,
      radius: 0.5 + Math.random() * 1.8,
      speed: 0.004 + Math.random() * 0.012,
      sway: 0.002 + Math.random() * 0.006,
      phase: Math.random() * Math.PI * 2,
    });
  }
  return motes;
}

export function createScene(canvas) {
  const ctx = canvas.getContext('2d');
  const stars = createStars();
  const motes = createMotes();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let lastNow = 0;
  let beatClock = 0;
  let beatPeriod = 0;
  let ripples = [];
  const current = paletteToRgb(DEFAULT_PALETTE);
  let target = paletteToRgb(DEFAULT_PALETTE);

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resize();
  window.addEventListener('resize', resize);

  function setExpression(expression) {
    if (!expression) {
      target = paletteToRgb(DEFAULT_PALETTE);
      return;
    }
    if ((expression.confidence ?? 0) < 35) return;
    const palette = PALETTES[expression.label] || DEFAULT_PALETTE;
    target = paletteToRgb(palette);
  }

  function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, rgbString(current.top));
    gradient.addColorStop(0.58, rgbString(current.bottom));
    gradient.addColorStop(1, rgbString(current.top.map((channel) => channel * 0.45)));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function drawStars(time) {
    const horizon = height * 0.56;
    for (const star of stars) {
      const x = star.x * width;
      const y = star.y * height;
      if (y > horizon) continue;
      const twinkle = reducedMotion
        ? 0.72
        : 0.45 + 0.55 * Math.abs(Math.sin(time * 0.0007 * star.speed + star.phase));
      ctx.beginPath();
      ctx.fillStyle = rgbString(current.orb, twinkle * 0.8);
      ctx.arc(x, y, star.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMist(time) {
    const horizon = height * 0.56;
    const glow = ctx.createRadialGradient(width * 0.5, horizon, 0, width * 0.5, horizon, width * 0.55);
    glow.addColorStop(0, rgbString(current.accent, 0.1));
    glow.addColorStop(1, rgbString(current.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizon - height * 0.2, width, height * 0.4);
    if (reducedMotion) return;
    const drift = Math.sin(time * 0.00012) * width * 0.03;
    const mist = ctx.createLinearGradient(0, horizon - 40, 0, horizon + 30);
    mist.addColorStop(0, rgbString(current.accent, 0));
    mist.addColorStop(0.5, rgbString(current.accent, 0.07));
    mist.addColorStop(1, rgbString(current.accent, 0));
    ctx.fillStyle = mist;
    ctx.fillRect(-width * 0.1 + drift, horizon - 60, width * 1.2, 110);
  }

  function drawHills() {
    const horizon = height * 0.56;
    ctx.beginPath();
    ctx.moveTo(0, horizon + 2);
    for (let x = 0; x <= width; x += 10) {
      const y =
        horizon -
        Math.sin((x / width) * Math.PI * 1.7 + 0.7) * height * 0.022 -
        Math.sin((x / width) * Math.PI * 4.2 + 2.1) * height * 0.007;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = rgbString(current.top.map((channel) => channel * 0.32));
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, horizon + 8);
    for (let x = 0; x <= width; x += 10) {
      const y =
        horizon +
        Math.sin((x / width) * Math.PI * 2.3 + 1.9) * height * 0.012 +
        Math.sin((x / width) * Math.PI * 5.6) * height * 0.005;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = rgbString(current.top.map((channel) => channel * 0.2));
    ctx.fill();
  }

  function drawOrb(time, state) {
    const orbX = width * 0.5;
    const orbY = height * 0.36;
    const base = Math.min(width, height) * 0.108;
    const amplitude = state.paced ? 0.2 : 0.11;
    const orbR = base * (0.92 + amplitude * state.breath);

    const outer = ctx.createRadialGradient(orbX, orbY, orbR * 0.5, orbX, orbY, orbR * 4);
    outer.addColorStop(0, rgbString(current.warm, 0.26));
    outer.addColorStop(0.35, rgbString(current.accent, 0.13));
    outer.addColorStop(1, rgbString(current.accent, 0));
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.arc(orbX, orbY, orbR * 4, 0, Math.PI * 2);
    ctx.fill();

    if (state.pulse && state.pulseConfidence > 15 && beatPeriod > 0) {
      const envelope = Math.max(0, 1 - beatClock / (beatPeriod * 0.55));
      ctx.beginPath();
      ctx.strokeStyle = rgbString(current.accent, 0.08 + 0.22 * envelope);
      ctx.lineWidth = 1.4;
      ctx.arc(orbX, orbY, orbR * (1.2 + 0.1 * envelope), 0, Math.PI * 2);
      ctx.stroke();
    }

    const body = ctx.createRadialGradient(
      orbX - orbR * 0.28,
      orbY - orbR * 0.32,
      orbR * 0.1,
      orbX,
      orbY,
      orbR,
    );
    body.addColorStop(0, rgbString(current.orb, 1));
    body.addColorStop(0.55, rgbString(current.warm, 1));
    body.addColorStop(0.92, rgbString(current.accent, 0.92));
    body.addColorStop(1, rgbString(current.accent, 0.6));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(orbX, orbY, orbR, 0, Math.PI * 2);
    ctx.fill();

    if (state.paced) {
      const start = -Math.PI / 2;
      const end = start + Math.PI * 2 * state.progress;
      ctx.beginPath();
      ctx.strokeStyle = rgbString(current.accent, 0.26);
      ctx.lineWidth = 1.2;
      ctx.arc(orbX, orbY, orbR * 1.55, start, end);
      ctx.stroke();
      const dotX = orbX + Math.cos(end) * orbR * 1.55;
      const dotY = orbY + Math.sin(end) * orbR * 1.55;
      ctx.beginPath();
      ctx.fillStyle = rgbString(current.accent, 0.75);
      ctx.arc(dotX, dotY, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    return { x: orbX, y: orbY, radius: orbR };
  }

  function drawLake(orb, time, state) {
    const horizon = height * 0.56;
    const lake = ctx.createLinearGradient(0, horizon, 0, height);
    lake.addColorStop(0, rgbString(current.accent, 0.1));
    lake.addColorStop(0.3, rgbString(current.top, 0.55));
    lake.addColorStop(1, rgbString(current.top.map((channel) => channel * 0.62)));
    ctx.fillStyle = lake;
    ctx.fillRect(0, horizon, width, height - horizon);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const reflectionWidth = orb.radius * 1.9;
    for (let index = 0; index < 26; index += 1) {
      const t = index / 26;
      const y = horizon + 6 + t * (height - horizon) * 0.78;
      const wobble = reducedMotion ? 0 : Math.sin(time * 0.0011 + index * 0.7) * 4 * (0.3 + t);
      const half = reflectionWidth * (0.36 + 0.5 * (1 - t)) * (0.7 + 0.3 * state.breath);
      const alpha = (0.1 + 0.2 * (1 - t)) * (0.65 + 0.35 * state.breath);
      ctx.fillStyle = rgbString(current.warm, alpha);
      ctx.fillRect(orb.x - half + wobble, y, half * 2, 1.5 + t * 1.4);
    }
    ctx.restore();

    for (const ripple of ripples) {
      ctx.beginPath();
      ctx.strokeStyle = rgbString(current.accent, ripple.alpha);
      ctx.lineWidth = 1.1;
      ctx.ellipse(ripple.x, ripple.y, ripple.radius, ripple.radius * 0.26, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = rgbString(current.warm, ripple.alpha * 0.5);
      ctx.ellipse(ripple.x, ripple.y, ripple.radius * 0.72, ripple.radius * 0.19, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawMotes(time, state) {
    if (reducedMotion) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const mote of motes) {
      const y = ((mote.y - time * 0.0000045 * (1 + mote.speed * 30)) % 1 + 1) % 1;
      const x = mote.x + Math.sin(time * 0.0004 + mote.phase) * mote.sway;
      const alpha = (0.1 + 0.32 * state.breath) * (0.5 + 0.5 * Math.sin(time * 0.001 + mote.phase));
      ctx.beginPath();
      ctx.fillStyle = rgbString(current.warm, Math.max(0, alpha));
      ctx.arc(x * width, y * height, mote.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function stepBeat(delta, state) {
    if (!state.pulse || state.pulseConfidence < 15) {
      beatPeriod = 0;
      return;
    }
    beatPeriod = 60000 / state.pulse;
    beatClock += delta;
    if (beatClock >= beatPeriod) {
      beatClock -= beatPeriod;
      const orbY = height * 0.72;
      ripples.push({
        x: width * 0.5,
        y: orbY,
        radius: Math.min(width, height) * 0.03,
        alpha: 0.28,
      });
      if (ripples.length > 10) ripples.shift();
    }
  }

  function stepRipples(delta) {
    for (const ripple of ripples) {
      ripple.radius += delta * 0.012 * Math.min(width, height);
      ripple.alpha *= Math.pow(0.9975, delta);
    }
    ripples = ripples.filter((ripple) => ripple.alpha > 0.012);
  }

  function render(now, state) {
    const delta = lastNow ? Math.min(64, Math.max(0, now - lastNow)) : 16;
    lastNow = now;

    const blendAmount = 1 - Math.exp(-delta / 2600);
    current.top = blend(current.top, target.top, blendAmount);
    current.bottom = blend(current.bottom, target.bottom, blendAmount);
    current.accent = blend(current.accent, target.accent, blendAmount);
    current.warm = blend(current.warm, target.warm, blendAmount);
    current.orb = blend(current.orb, target.orb, blendAmount);

    stepBeat(delta, state);
    stepRipples(delta);

    ctx.clearRect(0, 0, width, height);
    drawBackground();
    drawStars(now);
    drawMist(now);
    const orb = drawOrb(now, state);
    drawHills();
    drawLake(orb, now, state);
    drawMotes(now, state);
  }

  return {
    render,
    setExpression,
    resize,
  };
}
