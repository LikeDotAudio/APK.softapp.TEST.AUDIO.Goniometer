// TEST.AUDIO.Goniometer — Standalone Audio Goniometer & Lissajous Phase Scope
// Replicates SPOG drawGonio from scopes-audio.ts with full standalone Web Audio API.

const canvas = document.getElementById('gonioCanvas');
const ctx = canvas.getContext('2d');
const corrVal = document.getElementById('corrVal');
const widthVal = document.getElementById('widthVal');
const btnMono = document.getElementById('btnMono');
const btnStereo = document.getElementById('btnStereo');
const btnAnti = document.getElementById('btnAnti');
const btnMic = document.getElementById('btnMic');
const fileIn = document.getElementById('fileIn');
const fadeSlider = document.getElementById('fadeSlider');
const fadeVal = document.getElementById('fadeVal');
const btnReset = document.getElementById('btnReset');

// ── Palette Constants (from SPOG domain/palette.ts) ──
const PAL = {
  sky13: '#0e2436',      // Graticule circle & crosshair axis
  sky44s20: '#5a6f88',   // M, L, R labels
  green70s74: '#78eb96', // Lissajous phosphor green trace
  bg: '#03060f',
};

function alpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

let persistence = 0.20;

// ── Exact Rendering Engine from scopes-audio.ts ──
function drawGonio(cv, L, R, fadeAlpha) {
  const W = cv.width, H = cv.height;
  const cx = W / 2, cy = H / 2;
  const R0 = Math.min(W, H) / 2 - 12;
  if (R0 < 4) return;

  // Persistence fade
  ctx.fillStyle = `rgba(3, 6, 15, ${fadeAlpha})`;
  ctx.fillRect(0, 0, W, H);

  // Outer Graticule Ring
  ctx.strokeStyle = PAL.sky13;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, R0, 0, Math.PI * 2);
  ctx.stroke();

  // Crosshairs (M / S axis)
  ctx.beginPath();
  ctx.moveTo(cx, cy - R0);
  ctx.lineTo(cx, cy + R0);
  ctx.moveTo(cx - R0, cy);
  ctx.lineTo(cx + R0, cy);
  ctx.stroke();

  // Typography
  ctx.fillStyle = PAL.sky44s20;
  ctx.font = '10px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('M', cx, cy - R0 + 12);
  ctx.fillText('L', cx - R0 * 0.62, cy - R0 * 0.55);
  ctx.fillText('R', cx + R0 * 0.62, cy - R0 * 0.55);

  // Phosphor Plot (45° rotated Lissajous)
  if (L && R) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = alpha(PAL.green70s74, 0.55);
    const n = Math.min(L.length, R.length);
    const k = R0 / Math.SQRT2;

    for (let i = 0; i < n; i++) {
      const l = (L[i] ?? 128) / 128 - 1;
      const r = (R[i] ?? 128) / 128 - 1;
      const px = cx + (l - r) * k;
      const py = cy - (l + r) * k;
      ctx.fillRect(px, py, 1.5, 1.5);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ── Web Audio API Engine & Phase Generator ──
let audioCtx = null;
let masterGain = null;
let analyserL = null;
let analyserR = null;
let currentSource = null;

function initAudio() {
  if (audioCtx) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContext();

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.35;

  const splitter = audioCtx.createChannelSplitter(2);
  analyserL = audioCtx.createAnalyser();
  analyserR = audioCtx.createAnalyser();
  analyserL.fftSize = 1024;
  analyserR.fftSize = 1024;

  masterGain.connect(splitter);
  splitter.connect(analyserL, 0);
  splitter.connect(analyserR, 1);
}

function setMonoInPhase() {
  initAudio();
  if (currentSource) { try { currentSource.stop(); } catch(e){} currentSource.disconnect(); }

  // Mono sine wave fed identically to Left and Right (L = R)
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 440;
  const merger = audioCtx.createChannelMerger(2);
  osc.connect(merger, 0, 0); // L
  osc.connect(merger, 0, 1); // R
  merger.connect(masterGain);
  osc.start();
  currentSource = osc;

  updateToolbar('mono');
}

function setStereoPhase() {
  initAudio();
  if (currentSource) { try { currentSource.stop(); } catch(e){} currentSource.disconnect(); }

  // Sine & Cosine pair (90° phase shift) producing circular/elliptical Lissajous
  const oscL = audioCtx.createOscillator();
  const oscR = audioCtx.createOscillator();
  oscL.type = 'sine';
  oscR.type = 'triangle'; // different harmonics for rich shape
  oscL.frequency.value = 330;
  oscR.frequency.value = 330;

  const merger = audioCtx.createChannelMerger(2);
  oscL.connect(merger, 0, 0);
  oscR.connect(merger, 0, 1);
  merger.connect(masterGain);

  oscL.start();
  oscR.start();
  currentSource = {
    stop: () => { oscL.stop(); oscR.stop(); },
    disconnect: () => { oscL.disconnect(); oscR.disconnect(); merger.disconnect(); }
  };

  updateToolbar('stereo');
}

function setAntiPhase() {
  initAudio();
  if (currentSource) { try { currentSource.stop(); } catch(e){} currentSource.disconnect(); }

  // L and R are 180° out-of-phase (L = -R) -> horizontal trace on Side axis
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 440;

  const invert = audioCtx.createGain();
  invert.gain.value = -1.0;
  osc.connect(invert);

  const merger = audioCtx.createChannelMerger(2);
  osc.connect(merger, 0, 0);    // L = +1
  invert.connect(merger, 0, 1); // R = -1
  merger.connect(masterGain);

  osc.start();
  currentSource = osc;

  updateToolbar('anti');
}

async function setMic() {
  initAudio();
  if (currentSource) { try { currentSource.stop(); } catch(e){} currentSource.disconnect(); }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const micSource = audioCtx.createMediaStreamSource(stream);
    micSource.connect(masterGain);
    currentSource = {
      stop: () => stream.getTracks().forEach(t => t.stop()),
      disconnect: () => micSource.disconnect()
    };
    updateToolbar('mic');
  } catch (err) {
    alert("Microphone access unavailable: " + err.message);
  }
}

fileIn.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  initAudio();
  if (currentSource) { try { currentSource.stop(); } catch(e){} currentSource.disconnect(); }

  const url = URL.createObjectURL(file);
  const audio = new Audio(url);
  audio.loop = true;
  await audio.play();
  const fileSource = audioCtx.createMediaElementSource(audio);
  fileSource.connect(masterGain);
  currentSource = {
    stop: () => { audio.pause(); URL.revokeObjectURL(url); },
    disconnect: () => fileSource.disconnect()
  };
  updateToolbar('file');
});

function updateToolbar(active) {
  btnMono.classList.toggle('on', active === 'mono');
  btnStereo.classList.toggle('on', active === 'stereo');
  btnAnti.classList.toggle('on', active === 'anti');
  btnMic.classList.toggle('on', active === 'mic');
}

btnMono.addEventListener('click', setMonoInPhase);
btnStereo.addEventListener('click', setStereoPhase);
btnAnti.addEventListener('click', setAntiPhase);
btnMic.addEventListener('click', setMic);

fadeSlider.addEventListener('input', () => {
  persistence = parseFloat(fadeSlider.value);
  fadeVal.textContent = persistence.toFixed(2);
});

btnReset.addEventListener('click', () => {
  ctx.fillStyle = PAL.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
});

// ── Render & Correlation Analysis ──
const byteL = new Uint8Array(512);
const byteR = new Uint8Array(512);

function calcCorrelation(L, R) {
  let dot = 0, sumL = 0, sumR = 0;
  const n = Math.min(L.length, R.length);
  for (let i = 0; i < n; i++) {
    const l = L[i] / 128 - 1;
    const r = R[i] / 128 - 1;
    dot += l * r;
    sumL += l * l;
    sumR += r * r;
  }
  const denom = Math.sqrt(sumL * sumR);
  return denom > 0.0001 ? Math.max(-1, Math.min(1, dot / denom)) : 1.0;
}

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(120, rect.width * dpr);
  canvas.height = Math.max(120, rect.height * dpr);
  ctx.fillStyle = PAL.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

function loop() {
  if (analyserL && analyserR) {
    analyserL.getByteTimeDomainData(byteL);
    analyserR.getByteTimeDomainData(byteR);
    drawGonio(canvas, byteL, byteR, persistence);

    const r = calcCorrelation(byteL, byteR);
    corrVal.textContent = (r >= 0 ? '+' : '') + r.toFixed(2);
    if (r > 0.8) {
      corrVal.style.color = '#78eb96';
      widthVal.textContent = '0% (Mono)';
    } else if (r > 0.2) {
      corrVal.style.color = '#6FC8F0';
      widthVal.textContent = '50% (Stereo)';
    } else if (r >= -0.2) {
      corrVal.style.color = '#e6e23a';
      widthVal.textContent = '100% (Wide)';
    } else {
      corrVal.style.color = '#ff3b3b';
      widthVal.textContent = 'Phase Inverted';
    }
  } else {
    // Simulated mono in-phase sine wave before click
    const simTime = performance.now() * 0.005;
    for (let i = 0; i < byteL.length; i++) {
      const v = Math.round(128 + Math.sin(simTime + i * 0.08) * 80);
      byteL[i] = v;
      byteR[i] = v;
    }
    drawGonio(canvas, byteL, byteR, persistence);
  }

  requestAnimationFrame(loop);
}

// Start interactive audio on first click
window.addEventListener('pointerdown', () => {
  if (!audioCtx) setMonoInPhase();
}, { once: true });

requestAnimationFrame(loop);
