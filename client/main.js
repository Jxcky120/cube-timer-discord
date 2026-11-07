import './style.css';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { generateScramble } from './scramble.js';
import { renderNet } from './net.js';

const $ = (id) => document.getElementById(id);
const timerEl = $('timer');
const scrambleEl = $('scramble');
const netEl = $('net');
const sendBtn = $('send');
const copyBtn = $('copy');
const fallbackEl = $('fallback');
const newScrambleBtn = $('new-scramble');
const hintEl = $('hint');
const statusEl = $('status');
const stage = $('stage');
const waveEl = $('wave');

const HOLD_MS = 500;
const HINTS = {
  idle: 'Hold space to get ready',
  holding: 'Keep holding…',
  ready: 'Release to start',
  running: 'Press space to stop',
};

const formatTime = (ms) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor(ms / 1000) % 60;
  const milli = Math.floor(ms % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
};

// Decorative bars under the timer
for (let i = 0; i < 30; i++) {
  const bar = document.createElement('span');
  const h = 0.3 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.55));
  bar.style.setProperty('--h', h.toFixed(2));
  bar.style.setProperty('--d', `${((i * 0.137) % 1.2).toFixed(2)}s`);
  waveEl.appendChild(bar);
}

// ---------- timer state machine ----------
// idle -> holding (red) -> ready (green, after 500ms) -> running -> idle
let state = 'idle';
let holdTimeout = null;
let startTs = 0;
let raf = 0;
let swallowRelease = false;
let scramble = '';
let lastSolve = null;

function setState(next) {
  state = next;
  timerEl.dataset.state = next;
  stage.dataset.state = next;
  hintEl.textContent = HINTS[next];
}

function newScramble() {
  scramble = generateScramble();
  scrambleEl.textContent = scramble;
  renderNet(netEl, scramble);
}

function tick() {
  timerEl.textContent = formatTime(performance.now() - startTs);
  raf = requestAnimationFrame(tick);
}

function press() {
  if (state === 'running') {
    stop();
    return;
  }
  if (state !== 'idle') return;
  setState('holding');
  timerEl.textContent = formatTime(0);
  holdTimeout = setTimeout(() => {
    if (state === 'holding') setState('ready');
  }, HOLD_MS);
}

function release() {
  if (swallowRelease) {
    swallowRelease = false;
    return;
  }
  clearTimeout(holdTimeout);
  if (state === 'ready') start();
  else if (state === 'holding') setState('idle');
}

function start() {
  startTs = performance.now();
  setState('running');
  sendBtn.hidden = true;
  copyBtn.hidden = true;
  fallbackEl.hidden = true;
  setStatusBase();
  raf = requestAnimationFrame(tick);
}

function stop() {
  const elapsed = performance.now() - startTs;
  cancelAnimationFrame(raf);
  swallowRelease = true;
  setState('idle');
  timerEl.textContent = formatTime(elapsed);

  timerEl.classList.remove('flash');
  void timerEl.offsetWidth;
  timerEl.classList.add('flash');

  lastSolve = { timeMs: elapsed, scramble, sent: false };
  newScramble();

  copyBtn.hidden = false;
  copyBtn.textContent = 'Copy result';
  if (session) {
    sendBtn.hidden = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send score';
  }
}

function resultText(solve) {
  const time = formatTime(solve.timeMs);
  const head = session
    ? `🧊 **${session.user.global_name || session.user.username}** solved a 3x3 in **${time}**`
    : `🧊 Solved a 3x3 in **${time}**`;
  return `${head}\n\`\`\`\n${solve.scramble}\n\`\`\``;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Nothing 
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

copyBtn.addEventListener('click', async () => {
  const solve = lastSolve;
  if (!solve) return;
  const text = resultText(solve);
  copyBtn.blur();
  if (await copyText(text)) {
    fallbackEl.hidden = true;
    copyBtn.textContent = 'Copied';
    setStatus('Copied. Paste it into the chat.');
    setTimeout(() => {
      if (lastSolve === solve) copyBtn.textContent = 'Copy result';
    }, 1500);
  } else {
    fallbackEl.value = text;
    fallbackEl.hidden = false;
    fallbackEl.focus();
    fallbackEl.select();
    setStatus('Press Ctrl+C to copy, then paste it into the chat.');
  }
});

// Input handler for timer
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  if (!e.repeat) press();
});
window.addEventListener('keyup', (e) => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  release();
});

// Touch / mouse: press anywhere on the stage except the buttons.
let pointerActive = false;
stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button, textarea')) return;
  pointerActive = true;
  press();
});
window.addEventListener('pointerup', () => {
  if (!pointerActive) return;
  pointerActive = false;
  release();
});
window.addEventListener('pointercancel', () => {
  pointerActive = false;
});

// Losing focus mid-hold cancels the attempt.
window.addEventListener('blur', () => {
  if (state === 'holding' || state === 'ready') {
    clearTimeout(holdTimeout);
    setState('idle');
  }
});

newScrambleBtn.addEventListener('click', () => {
  newScramble();
  newScrambleBtn.blur();
});

// Discord integration
const clientId = import.meta.env.DISCORD_CLIENT_ID;
const inDiscord = new URLSearchParams(location.search).has('frame_id');
let session = null; // { accessToken, user, channelId }

let baseStatus = '';
function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

// Restore the standing status line (who you're signed in as) when a new solve starts.
function setStatusBase() {
  setStatus(baseStatus);
}

async function connectDiscord() {
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });

  const res = await fetch('/.proxy/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error('Token exchange failed');
  const { access_token } = await res.json();

  const auth = await sdk.commands.authenticate({ access_token });
  if (!auth) throw new Error('Authenticate failed');
  session = {
    accessToken: access_token,
    user: auth.user,
    channelId: sdk.channelId,
    guildId: sdk.guildId,
  };
}

async function api(path, body) {
  const res = await fetch(`/.proxy/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

sendBtn.addEventListener('click', async () => {
  const solve = lastSolve;
  if (!solve || solve.sent || !session) return;
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending…';
  try {
    await api('/solve', {
      channelId: session.channelId,
      timeMs: solve.timeMs,
      scramble: solve.scramble,
    });
    solve.sent = true;
    if (lastSolve === solve) sendBtn.textContent = 'Sent';
    setStatus('');
  } catch (err) {
    if (lastSolve === solve) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send score';
    }
    setStatus(err.message, true);
  }
  sendBtn.blur();
});

async function init() {
  newScramble();
  setState('idle');

  if (!inDiscord) {
    baseStatus = 'Running outside Discord: timing and Copy result work, sending is off.';
    setStatus(baseStatus);
    return;
  }
  try {
    setStatus('Connecting to Discord…');
    await connectDiscord();
    const name = session.user.global_name || session.user.username;
    baseStatus = `Signed in as ${name}`;
    setStatus(baseStatus);
  } catch (err) {
    console.error(err);
    setStatus("Couldn't connect to Discord. Timing works, sending is off.", true);
  }
}

init();
