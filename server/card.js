import { createCanvas, loadImage } from '@napi-rs/canvas';
import { netCells } from '../client/net.js';
import { formatTime } from './format.js';

const W = 1000;
const H = 500;
const SANS = '"Segoe UI", "Helvetica Neue", Arial, "Liberation Sans", "DejaVu Sans", sans-serif';
const MONO = 'Consolas, "SF Mono", Menlo, "Liberation Mono", "DejaVu Sans Mono", monospace';

const C = {
  bg: '#0d1114',
  panelTop: '#18222a',
  panelBottom: '#10161a',
  well: '#0a0f12',
  cyan: '#2ee6ff',
  teal: '#39c5bb',
  deep: '#0e7f80',
  pink: '#ff5fa2',
  mint: '#4dffd2',
  ink: '#eafcfb',
  dim: '#8fb9b9',
  slot: '#162126',
  line: 'rgba(57,197,187,0.45)',
};

export function avatarUrl(user) {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  const index = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

const avatarCache = new Map();
async function loadAvatar(user) {
  const url = avatarUrl(user);
  if (avatarCache.has(url)) return avatarCache.get(url);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`avatar ${res.status}`);
    const img = await loadImage(Buffer.from(await res.arrayBuffer()));
    if (avatarCache.size > 200) avatarCache.clear();
    avatarCache.set(url, img);
    return img;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function fit(ctx, text, weight, family, maxSize, maxWidth) {
  let size = maxSize;
  for (; size > 12; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  ctx.font = `${weight} ${size}px ${family}`;
}

function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

// 45-degree stripes
function stripes(ctx, x, y, w, h, color, gap = 10, lw = 3) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (let i = -h; i < w; i += gap) {
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
  }
  ctx.stroke();
  ctx.restore();
}

// L-shaped corner ticks at top-left and bottom-right.
function corners(ctx, x, y, w, h, len, color, lw = 2) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(x, y + len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.moveTo(x + w - len, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y + h - len);
  ctx.stroke();
  ctx.restore();
}

function glow(ctx, color, blur) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}

const noGlow = (ctx) => {
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
};

// bars with heights.
function waveform(ctx, x, y, w, maxH, color, seed = 0) {
  ctx.fillStyle = color;
  for (let i = 0, bx = x; bx < x + w; i++, bx += 9) {
    const t = Math.abs(Math.sin((i + seed) * 1.7) * Math.cos((i + seed) * 0.55));
    const h = 4 + t * (maxH - 4);
    ctx.beginPath();
    ctx.roundRect(bx, y - h / 2, 5, h, 2);
    ctx.fill();
  }
}

// Fill a dark "well" plate with a thin outline.
function drawWell(ctx, x, y, w, h, radii) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radii);
  ctx.fillStyle = C.well;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = C.line;
  ctx.stroke();
}

// Draw a circular avatar
function drawAvatar(ctx, img, user, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  } else {
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, C.teal);
    g.addColorStop(1, C.cyan);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = '#062022';
    ctx.font = `700 ${r}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((user.name || '?').slice(0, 1).toUpperCase(), cx, cy + 2);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();

  // neon ring + a short pink arc
  ctx.save();
  glow(ctx, C.cyan, 14);
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = C.cyan;
  ctx.stroke();
  noGlow(ctx);
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, -0.2, 0.9);
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.pink;
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Card sections
// ---------------------------------------------------------------------------

function drawBackground(ctx) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  stripes(ctx, 0, 0, W, H, 'rgba(57,197,187,0.05)', 14, 2);

  let g = ctx.createRadialGradient(80, 0, 10, 80, 0, 520);
  g.addColorStop(0, 'rgba(57,197,187,0.30)');
  g.addColorStop(1, 'rgba(57,197,187,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  g = ctx.createRadialGradient(W, H, 10, W, H, 420);
  g.addColorStop(0, 'rgba(255,95,162,0.22)');
  g.addColorStop(1, 'rgba(255,95,162,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// Path for the main panel (asymmetric corners).
function panelPath(ctx) {
  ctx.roundRect(24, 24, W - 48, H - 48, [10, 44, 10, 44]);
}

// Gradient header band with waveforms and a pink tab.
function drawHeaderBand(ctx) {
  const g = ctx.createLinearGradient(24, 0, W - 24, 0);
  g.addColorStop(0, C.teal);
  g.addColorStop(0.7, C.cyan);
  g.addColorStop(1, '#9ff6ff');
  ctx.fillStyle = g;
  ctx.fillRect(24, 24, W - 48, 56);
  stripes(ctx, W - 150, 24, 126, 56, 'rgba(6,32,34,0.28)', 12, 5);
  waveform(ctx, 58, 52, 240, 30, 'rgba(6,32,34,0.5)', 0);
  waveform(ctx, 700, 52, 150, 30, 'rgba(6,32,34,0.5)', 9);
  ctx.fillStyle = C.pink;
  ctx.fillRect(24, 76, 120, 4);
}

// Striped edge down 
function drawEdgeDecor(ctx) {
  stripes(ctx, 24, 80, 14, H - 104, 'rgba(57,197,187,0.55)', 9, 3);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(24, H - 24);
  ctx.lineTo(24, H - 120);
  ctx.lineTo(120, H - 24);
  ctx.closePath();
  ctx.clip();
  stripes(ctx, 24, H - 120, 100, 100, 'rgba(255,95,162,0.7)', 9, 3);
  ctx.restore();
}

function drawPanel(ctx) {
  const g = ctx.createLinearGradient(0, 24, 0, H - 24);
  g.addColorStop(0, C.panelTop);
  g.addColorStop(1, C.panelBottom);
  ctx.beginPath();
  panelPath(ctx);
  ctx.fillStyle = g;
  ctx.fill();

  // decorations clipped to the panel shape
  ctx.save();
  ctx.beginPath();
  panelPath(ctx);
  ctx.clip();
  drawHeaderBand(ctx);
  drawEdgeDecor(ctx);
  ctx.restore();

  // neon outline
  ctx.save();
  glow(ctx, C.cyan, 16);
  ctx.beginPath();
  panelPath(ctx);
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.cyan;
  ctx.stroke();
  ctx.restore();
  corners(ctx, 34, 92, W - 68, H - 130, 18, C.cyan, 2);
}

function drawTitle(ctx) {
  ctx.fillStyle = '#062022';
  ctx.font = `800 24px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('CUBE TIMER · 3x3', W / 2, 61);
  ctx.textAlign = 'left';
}

// Left column: avatar, name, solve label and the latest time.
function drawPlayer(ctx, { user, avatar, latest, count }) {
  drawAvatar(ctx, avatar, user, 100, 156, 46);
  ctx.fillStyle = C.ink;
  ctx.font = `700 30px ${SANS}`;
  ctx.fillText(ellipsize(ctx, user.name, 196), 168, 152);
  ctx.fillStyle = C.teal;
  ctx.font = `600 18px ${SANS}`;
  ctx.fillText(latest ? `Latest solve · #${count}` : 'Waiting for the first solve', 168, 180);

  const timeText = latest ? formatTime(latest.timeMs) : '--:--.---';
  fit(ctx, timeText, '700', MONO, 58, 310);
  ctx.save();
  if (latest) glow(ctx, C.mint, 18);
  ctx.fillStyle = latest ? C.mint : C.dim;
  ctx.fillText(timeText, 56, 282);
  ctx.restore();
}

// Middle column: 2D cube net on a dark plate.
function drawNet(ctx, latest) {
  drawWell(ctx, 388, 88, 288, 222, [6, 20, 6, 20]);
  corners(ctx, 396, 96, 272, 206, 12, C.teal, 2);
  if (!latest) return;

  const cell = 22;
  for (const { x, y, color } of netCells(latest.scramble)) {
    ctx.beginPath();
    ctx.roundRect(400 + x * cell + 1.5, 100 + y * cell + 1.5, cell - 3, cell - 3, 4);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

// One row in the "last 5" list.
function drawRecentRow(ctx, row, i, y) {
  const top = y - 28;
  const isLatest = i === 0 && !!row;

  ctx.beginPath();
  ctx.roundRect(712, top, 248, 36, [4, 12, 4, 12]);
  ctx.fillStyle = isLatest ? 'rgba(46,230,255,0.12)' : C.slot;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = isLatest ? C.cyan : C.line;
  ctx.stroke();
  stripes(ctx, 712, top, 8, 36, isLatest ? C.cyan : 'rgba(57,197,187,0.5)', 6, 2);

  if (!row) {
    ctx.fillStyle = 'rgba(143,185,185,0.35)';
    ctx.font = `600 20px ${MONO}`;
    ctx.fillText('— — : — —', 730, y - 1);
    return;
  }

  ctx.fillStyle = i === 0 ? C.mint : C.ink;
  ctx.font = `600 23px ${MONO}`;
  ctx.fillText(formatTime(row.timeMs), 730, y - 1);
  ctx.fillStyle = C.dim;
  ctx.font = `500 15px ${SANS}`;
  ctx.textAlign = 'right';
  ctx.fillText(ellipsize(ctx, row.name, 70), 946, y - 3);
  ctx.textAlign = 'left';
}

// Right column: heading and the last 5 solves.
function drawRecent(ctx, recent) {
  ctx.fillStyle = C.teal;
  ctx.font = `700 16px ${SANS}`;
  ctx.fillText('LAST 5', 712, 116);
  ctx.fillStyle = C.pink;
  ctx.fillRect(712, 122, 30, 3);
  for (let i = 0; i < 5; i++) {
    drawRecentRow(ctx, recent[i], i, 164 + i * 44);
  }
}

// Bottom: scramble on a display strip.
function drawScramble(ctx, latest) {
  drawWell(ctx, 70, 366, 860, 92, [6, 22, 6, 22]);

  if (latest) {
    ctx.beginPath();
    ctx.roundRect(92, 354, 104, 24, 4);
    ctx.fillStyle = C.teal;
    ctx.fill();
    ctx.fillStyle = '#062022';
    ctx.font = `800 13px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('SCRAMBLE', 144, 371);
  }

  ctx.textAlign = 'center';
  if (latest) {
    ctx.fillStyle = C.ink;
    ctx.font = `600 26px ${MONO}`;
    const moves = latest.scramble.split(' ');
    const half = Math.ceil(moves.length / 2);
    ctx.fillText(moves.slice(0, half).join(' '), W / 2, 402);
    ctx.fillText(moves.slice(half).join(' '), W / 2, 440);
  } else {
    ctx.fillStyle = C.dim;
    ctx.font = `600 22px ${MONO}`;
    ctx.fillText('Time a solve in the activity, then press Send score', W / 2, 418);
  }
  ctx.textAlign = 'left';
}

/**
 * user:   { id, name, avatar }   whoever the card is "about" (latest solver, or the launcher)
 * latest: { timeMs, scramble } | null
 * count:  number of solves in this session
 * recent: [{ timeMs, name }]     newest first, at most 5
 */
export async function renderCard({ user, latest, count, recent }) {
  const avatar = await loadAvatar(user);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  drawBackground(ctx);
  drawPanel(ctx);
  drawTitle(ctx);
  drawPlayer(ctx, { user, avatar, latest, count });
  drawNet(ctx, latest);
  drawRecent(ctx, recent);
  drawScramble(ctx, latest);

  return canvas.toBuffer('image/png');
}