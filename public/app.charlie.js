// Light Engine Charlie - Comprehensive Dashboard Application
const $ = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>r.querySelectorAll(s);
const setStatus = m => { const el=$("#status"); if(el) el.textContent = m; };
// Toast system
function showToast({ title = '', msg = '', kind = 'info', icon = '' }, ttlMs = 4000) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.innerHTML = `<div class="toast-icon">${icon||''}</div><div class="toast-body"><div class="toast-title">${title}</div><div class="toast-msg">${msg}</div></div><button class="toast-close" aria-label="Close">×</button>`;
  host.appendChild(el);
  const closer = el.querySelector('.toast-close');
  closer?.addEventListener('click', ()=> el.remove());
  if (ttlMs > 0) setTimeout(()=> el.remove(), ttlMs);
}

// Global State Management
const STATE = {
  devices: [],
  groups: [],
  schedules: [],
  plans: [],
  farm: null,
  environment: [],
  calibrations: [],
  currentGroup: null,
  currentSchedule: null,
  researchMode: false,
  editingGroupId: null,
  deviceMeta: {},
  config: { singleServer: true, controller: '' }
};

// --- Research Mode Feature Flag ---
const RESEARCH_MODE_KEY = 'gr.researchMode';
function getResearchMode() {
  const raw = localStorage.getItem(RESEARCH_MODE_KEY);
  return raw === 'true';
}
function setResearchMode(val) {
  localStorage.setItem(RESEARCH_MODE_KEY, val ? 'true' : 'false');
  STATE.researchMode = val;
}

// --- Data Loading Utilities ---
async function loadJSON(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    console.warn(`Failed to load ${path}:`, err);
    return null;
  }
}

async function saveJSON(path, data) {
  try {
    // For client -> server saves, POST to /data/:name when targeting public/data
    if (path.startsWith('./data/')) {
      const name = path.split('/').pop();
      const response = await fetch(`/data/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data, null, 2)
      });
      return response.ok;
    }
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data, null, 2) });
    return response.ok;
  } catch (err) {
    console.error(`Failed to save ${path}:`, err);
    return false;
  }
}

// --- API Utilities ---
async function api(path, opts = {}) {
  const response = await fetch(`${location.origin}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers }
  });
  return response.json();
}

async function patch(id, body) {
  const response = await fetch(`/api/devicedatas/device/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}

// Build HEX12 payload (CW, WW, BL, RD, FR, UV)
function buildHex12(arg1, wwArg, blArg, rdArg, frArg = 0, uvArg = 0) {
  const v = x => Math.round(Math.max(0, Math.min(100, x)) * 255 / 100).toString(16).padStart(2, '0').toUpperCase();
  if (typeof arg1 === 'number' && wwArg === undefined) {
    const p = arg1;
    return `${v(p)}${v(p)}${v(p)}${v(p)}${v(0)}${v(0)}`;
  }
  if (typeof arg1 === 'object' && arg1 !== null) {
    const { cw = 0, ww = 0, bl = 0, rd = 0, fr = 0, uv = 0 } = arg1;
    return `${v(cw)}${v(ww)}${v(bl)}${v(rd)}${v(fr)}${v(uv)}`;
  }
  const cw = arg1 ?? 0, ww = wwArg ?? 0, bl = blArg ?? 0, rd = rdArg ?? 0, fr = frArg ?? 0, uv = uvArg ?? 0;
  return `${v(cw)}${v(ww)}${v(bl)}${v(rd)}${v(fr)}${v(uv)}`;
}

// --- Time & Schedule Utilities ---
const toMinutes = (hhmm) => {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return (h % 24) * 60 + (m % 60);
};
const minutesToHHMM = (min) => {
  const m = ((min % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const mm = (m % 60).toString().padStart(2, '0');
  return `${h}:${mm}`;
};
function computeCycleDuration(on, off) {
  const a = toMinutes(on);
  const b = toMinutes(off);
  // wraps over midnight if off <= on
  return (b - a + 24 * 60) % (24 * 60);
}
function scheduleSummary(s) {
  if (!s) return 'No schedule';
  const mode = s.mode === 'two' ? '2-cycle' : '1-cycle';
  if (s.mode === 'two' && s.cycles?.length >= 2) {
    const d1 = computeCycleDuration(s.cycles[0].on, s.cycles[0].off) / 60;
    const d2 = computeCycleDuration(s.cycles[1].on, s.cycles[1].off) / 60;
    return `${mode} ${d1}h/${d2}h`;
  }
  if (s.cycles?.length) {
    const d = computeCycleDuration(s.cycles[0].on, s.cycles[0].off) / 60;
    return `${mode} ${d}h starting at ${s.cycles[0].on}`;
  }
  return mode;
}
function cyclesOverlap(c1, c2) {
  // convert to [start,end) minutes normalized timeline 0..1440
  const range = ({ on, off }) => {
    const s = toMinutes(on);
    const e = toMinutes(off);
    if (e > s) return [[s, e]]; // same day
    return [[s, 1440], [0, e]]; // wraps
  };
  const r1 = range(c1);
  const r2 = range(c2);
  return r1.some(([a1, b1]) => r2.some(([a2, b2]) => Math.max(a1, a2) < Math.min(b1, b2)));
}
// Merge ON intervals across 24h to compute effective coverage and detect overlaps
function splitIntervals(c) {
  const s = toMinutes(c.on);
  const e = toMinutes(c.off);
  if (e > s) return [[s, e]];
  return [[s, 1440], [0, e]];
}
function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = intervals.slice().sort((a,b)=>a[0]-b[0]);
  const merged = [sorted[0].slice()];
  for (let i=1;i<sorted.length;i++) {
    const [s,e] = sorted[i];
    const last = merged[merged.length-1];
    if (s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s,e]);
    }
  }
  return merged;
}
function validateSchedule(mode, cycles) {
  const errors = [];
  const naiveOnTotal = cycles.reduce((sum, c) => sum + computeCycleDuration(c.on, c.off), 0);
  // Basic checks
  cycles.forEach((c, idx) => {
    const dur = computeCycleDuration(c.on, c.off);
    if (dur === 0) errors.push(`Cycle ${idx+1} has zero duration.`);
  });
  if (mode === 'two' && cycles.length >= 2 && cyclesOverlap(cycles[0], cycles[1])) {
    errors.push('Cycles overlap in time. Click “Fix to 24 h” to auto-resolve.');
  }
  // Effective ON coverage by merging intervals
  const merged = mergeIntervals(cycles.flatMap(splitIntervals));
  const onTotal = merged.reduce((sum,[s,e])=>sum+(e-s),0);
  const offTotal = 24 * 60 - onTotal;
  const overlapTrim = naiveOnTotal - onTotal;
  return { errors, onTotal, offTotal, overlapTrim };
}
function renderScheduleBar(el, cycles) {
  if (!el) return;
  const blocks = [];
  const toPct = (min) => (min / (24 * 60)) * 100;
  cycles.forEach(c => {
    let s = toMinutes(c.on);
    let e = toMinutes(c.off);
    if (e <= s) e += 24 * 60; // wrap
    // If wraps beyond 24h, split
    const addSeg = (a, b) => blocks.push({ startPct: toPct(a % (24 * 60)), endPct: toPct(b % (24 * 60)) });
    if (e <= 24 * 60) addSeg(s, e); else { addSeg(s, 24 * 60); addSeg(0, e - 24 * 60); }
  });
  // Build gradient segments on white background
  const segs = blocks
    .sort((a, b) => a.startPct - b.startPct)
    .map(seg => `color-stop(${seg.startPct}%, transparent), color-stop(${seg.startPct}%, var(--primary-green)), color-stop(${seg.endPct}%, var(--primary-green)), color-stop(${seg.endPct}%, transparent)`)
    .join(',');
  // Fallback: simpler gradient using repeating-linear-gradient
  const gradient = blocks.map(seg => `#10B981 ${seg.startPct}%, #10B981 ${seg.endPct}%`).join(', ');
  el.style.background = `linear-gradient(to right, #F3F4F6 0%, #F3F4F6 100%), linear-gradient(to right, ${gradient})`;
}

// --- DLI and Energy Calculation Utilities ---
const CHANNELS = {
  cw: { nm: 570, factor: 0.85 },
  ww: { nm: 620, factor: 0.75 },
  bl: { nm: 450, factor: 1.0 },
  rd: { nm: 660, factor: 1.0 }
};

function estimateDLI(spectrum, powerW, hoursOn) {
  let par = 0;
  for (const ch in CHANNELS) {
    if (spectrum[ch] !== undefined) {
      par += (spectrum[ch] / 100) * CHANNELS[ch].factor;
    }
  }
  const parUmol = powerW * par * 4.6;
  const dli = (parUmol * 3600 * hoursOn) / 1e6;
  return dli;
}

function estimateEnergy(powerW, hoursOn) {
  return (powerW * hoursOn) / 1000;
}

// --- Tiny Sparkline Utility ---
function drawSparkline(canvas, values = [], opts = {}) {
  if (!canvas) return;
  const w = (opts.width || 80);
  const h = (opts.height || 22);
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,w,h);
  if (!values.length) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 2;
  const scaleX = (i) => pad + (i * (w - pad*2) / Math.max(1, values.length - 1));
  const scaleY = (v) => h - pad - (max === min ? 0.5*h : ((v - min) / (max - min)) * (h - pad*2));
  // Background line
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, scaleY(values[0]));
  for (let i=1;i<values.length;i++) ctx.lineTo(scaleX(i), scaleY(values[i]));
  ctx.stroke();
  // Foreground line
  const color = opts.color || getComputedStyle(document.documentElement).getPropertyValue('--primary-green') || '#16A34A';
  ctx.strokeStyle = color.trim() || '#16A34A';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad, scaleY(values[0]));
  for (let i=1;i<values.length;i++) ctx.lineTo(scaleX(i), scaleY(values[i]));
  ctx.stroke();
}

// --- SPD Presets and Spectrum Utilities (Section 3) ---
// We model SPD as 31 bins (400..700 nm inclusive, 10 nm step)
const SPD_WAVELENGTHS = Array.from({ length: 31 }, (_, i) => 400 + i * 10);

// Gaussian helper for channel SPD shapes
function gaussian(x, mu, sigma) {
  const a = 1 / (sigma * Math.sqrt(2 * Math.PI));
  const z = (x - mu) / sigma;
  return a * Math.exp(-0.5 * z * z);
}

// Preset definitions per channel. Values chosen to approximate typical LED SPDs
const SPD_PRESET_PARAMS = {
  cw: { center: 550, width: 55 }, // cool white peaks around green-yellow
  ww: { center: 600, width: 70 }, // warm white tilts toward red
  bl: { center: 450, width: 20 }, // blue narrowband
  rd: { center: 660, width: 20 }  // deep red narrowband
};

// Generate normalized SPD array for a channel
function generateSPD({ center, width }) {
  const sigma = width / 2.355; // FWHM to sigma approximation
  const vals = SPD_WAVELENGTHS.map(w => gaussian(w, center, sigma));
  const max = Math.max(...vals, 1e-9);
  return vals.map(v => v / max); // normalize 0..1
}

// Cache generated SPDs per channel
const SPD_CACHE = {};
function getChannelSPD(ch) {
  if (!SPD_CACHE[ch]) {
    const params = SPD_PRESET_PARAMS[ch];
    SPD_CACHE[ch] = params ? generateSPD(params) : SPD_WAVELENGTHS.map(() => 0);
  }
  return SPD_CACHE[ch];
}

// Combine SPDs using channel percentages {cw, ww, bl, rd}
function computeWeightedSPD(percentages) {
  const pct = {
    cw: Math.max(0, Math.min(100, percentages?.cw ?? 45)) / 100,
    ww: Math.max(0, Math.min(100, percentages?.ww ?? 45)) / 100,
    bl: Math.max(0, Math.min(100, percentages?.bl ?? 0)) / 100,
    rd: Math.max(0, Math.min(100, percentages?.rd ?? 0)) / 100
  };
  const cw = getChannelSPD('cw');
  const ww = getChannelSPD('ww');
  const bl = getChannelSPD('bl');
  const rd = getChannelSPD('rd');
  const combined = SPD_WAVELENGTHS.map((_, i) =>
    cw[i] * pct.cw + ww[i] * pct.ww + bl[i] * pct.bl + rd[i] * pct.rd
  );
  const max = Math.max(...combined, 1e-9);
  return combined.map(v => v / max);
}

// Convert wavelength (nm) to approximate RGB color string
// Based on Dan Bruton's algorithm approximation
function wavelengthToRGB(wavelength) {
  let R = 0, G = 0, B = 0;
  if (wavelength >= 380 && wavelength < 440) {
    R = -(wavelength - 440) / (440 - 380);
    G = 0;
    B = 1;
  } else if (wavelength >= 440 && wavelength < 490) {
    R = 0;
    G = (wavelength - 440) / (490 - 440);
    B = 1;
  } else if (wavelength >= 490 && wavelength < 510) {
    R = 0;
    G = 1;
    B = -(wavelength - 510) / (510 - 490);
  } else if (wavelength >= 510 && wavelength < 580) {
    R = (wavelength - 510) / (580 - 510);
    G = 1;
    B = 0;
  } else if (wavelength >= 580 && wavelength < 645) {
    R = 1;
    G = -(wavelength - 645) / (645 - 580);
    B = 0;
  } else if (wavelength >= 645 && wavelength <= 780) {
    R = 1; G = 0; B = 0;
  }
  // Intensity correction at edges
  let factor = 0;
  if (wavelength >= 380 && wavelength < 420) {
    factor = 0.3 + 0.7 * (wavelength - 380) / (420 - 380);
  } else if (wavelength >= 420 && wavelength <= 700) {
    factor = 1;
  } else if (wavelength > 700 && wavelength <= 780) {
    factor = 0.3 + 0.7 * (780 - wavelength) / (780 - 700);
  }
  const gamma = 0.8;
  const to255 = c => Math.round(255 * Math.pow(c * factor, gamma));
  return `rgb(${to255(R)}, ${to255(G)}, ${to255(B)})`;
}

// Render a compact SPD bar into a canvas element
function renderSpectrumCanvas(canvas, spd, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const widthCss = opts.width || 280;
  const heightCss = opts.height || 36;
  canvas.width = Math.floor(widthCss * dpr);
  canvas.height = Math.floor(heightCss * dpr);
  canvas.style.width = widthCss + 'px';
  canvas.style.height = heightCss + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, widthCss, heightCss);

  const barWidth = widthCss / spd.length;
  for (let i = 0; i < spd.length; i++) {
    const w = SPD_WAVELENGTHS[i];
    const h = Math.max(2, spd[i] * heightCss);
    ctx.fillStyle = wavelengthToRGB(w);
    ctx.fillRect(i * barWidth, heightCss - h, Math.ceil(barWidth), h);
  }
  // Top border overlay for contrast
  ctx.strokeStyle = 'rgba(15,23,42,0.15)';
  ctx.strokeRect(0, 0, widthCss, heightCss);
}

// --- Tooltip System ---
function showTipFor(el) {
  const tip = document.getElementById('tooltip');
  const content = document.getElementById('tooltip-content');
  if (!tip || !content) return;
  
  const text = el.getAttribute('data-tip') || '';
  content.textContent = text || '';
  
  const rect = el.getBoundingClientRect();
  const top = window.scrollY + rect.top - tip.offsetHeight - 10;
  const left = Math.max(10, Math.min(window.scrollX + rect.left, 
    window.scrollX + document.documentElement.clientWidth - 340));
  
  tip.style.top = (top > 0 ? top : (window.scrollY + rect.bottom + 10)) + 'px';
  tip.style.left = left + 'px';
  tip.setAttribute('data-show', '1');
  tip.setAttribute('aria-hidden', 'false');
}

function hideTip() {
  const tip = document.getElementById('tooltip');
  if (!tip) return;
  tip.removeAttribute('data-show');
  tip.setAttribute('aria-hidden', 'true');
}

function wireHints() {
  document.querySelectorAll('.hint').forEach(hint => {
    hint.addEventListener('mouseenter', () => showTipFor(hint));
    hint.addEventListener('mouseleave', hideTip);
    hint.addEventListener('focus', () => showTipFor(hint));
    hint.addEventListener('blur', hideTip);
    hint.addEventListener('click', (e) => {
      e.preventDefault();
      showTipFor(hint);
      setTimeout(hideTip, 2000);
    });
    hint.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideTip();
    });
  });
  window.addEventListener('scroll', hideTip, { passive: true });
}

// --- Device Card Rendering ---
// Helpers to derive device context
function getGroupForDevice(deviceId) {
  return STATE.groups.find(g => g.lights?.some(l => l.id === deviceId));
}
function getScheduleForDevice(device) {
  const g = getGroupForDevice(device.id);
  return STATE.schedules.find(s => s.id === g?.schedule) || null;
}
function getDailyOnHours(schedule) {
  if (!schedule) return 12; // sane default
  const { onTotal } = validateSchedule(schedule.mode || 'one', schedule.cycles || []);
  return onTotal / 60;
}
function getNominalWatts(device) {
  // Prefer explicit fields if present; otherwise fallback to a reasonable default per fixture
  return device.nominalW || device.maxW || device.wattage || 240;
}
function isOnNow(schedule, now = new Date()) {
  if (!schedule) return false;
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const intervals = (schedule.cycles || []).flatMap(splitIntervals);
  return intervals.some(([s,e]) => {
    if (s <= e) return minutesNow >= s && minutesNow < e;
    // shouldn't happen after split, but keep for safety
    return minutesNow >= s || minutesNow < e;
  });
}
function estimateDriverPercent(device) {
  // Use master/intensity when available; else approximate from channel mix
  if (typeof device.masterPct === 'number') return Math.max(0, Math.min(1, device.masterPct / 100));
  if (typeof device.intensity === 'number') return Math.max(0, Math.min(1, device.intensity / 100));
  const cw = device.cwPct ?? device.cw ?? 45;
  const ww = device.wwPct ?? device.ww ?? 45;
  const bl = device.blPct ?? device.bl ?? 0;
  const rd = device.rdPct ?? device.rd ?? 0;
  // Sum relative to 200% baseline (CW+WW at 100 each) to approximate driver throttle
  return Math.max(0, Math.min(1, (cw + ww + bl + rd) / 200));
}
function getWattSeries(device, count = 20) {
  // Prefer measured series from stats
  const series = device.stats?.watts || device.stats?.power || device.stats?.powerW || null;
  if (Array.isArray(series) && series.length) return series.slice(-count);
  // Fallback: estimate from nominal watts and driver percent; add slight variance
  const base = getNominalWatts(device) * (device.onOffStatus ? estimateDriverPercent(device) : 0);
  const arr = [];
  for (let i = 0; i < count; i++) {
    const jitter = base * 0.04 * (Math.sin(i * 0.7) + Math.cos(i * 0.31)) * 0.5; // ±~4%
    arr.push(Math.max(0, base + jitter));
  }
  return arr;
}

// --- Device Location Metadata ---
function getDeviceMeta(id) {
  return STATE.deviceMeta?.[id] || { farm: STATE.farm?.farmName || '', room: '', zone: '', module: '', level: '', side: '' };
}
function setDeviceMeta(id, meta) {
  STATE.deviceMeta[id] = { ...getDeviceMeta(id), ...meta };
}
async function saveDeviceMeta() {
  const ok = await saveJSON('./data/device-meta.json', { devices: STATE.deviceMeta });
  if (ok) setStatus('Device locations saved'); else alert('Failed to save device locations');
}

function deviceCard(device) {
  const card = document.createElement('div');
  card.className = 'card device-card';
  card.dataset.deviceId = device.id;

  // DLI/Energy Metrics Section
  function getFarmPricePerKWh() {
    if (STATE.farm?.pricePerKWh) return STATE.farm.pricePerKWh;
    const raw = localStorage.getItem('gr.farmPriceKWh');
    return raw ? parseFloat(atob(raw)) : 0.18;
  }

  function addTooltip(el, text) {
    el.classList.add('hint');
    el.setAttribute('data-tip', text);
  }

  function getTimeSeriesStats() {
    const stats = device.stats || {};
    const dliArr = stats.dli || [14.4, 14.2, 14.6, 14.1, 14.3, 14.5, 14.0];
    const energyArr = stats.energy || [2.1, 2.0, 2.2, 1.9, 2.1, 2.0, 2.2];
    return {
      dliToday: dliArr[0] || 0,
      dli7d: dliArr.slice(0,7).reduce((a,b)=>a+b,0)/Math.max(1,Math.min(7,dliArr.length)),
      dli30d: dliArr.reduce((a,b)=>a+b,0)/Math.max(1,dliArr.length),
      energyToday: energyArr[0] || 0,
      energy7d: energyArr.slice(0,7).reduce((a,b)=>a+b,0)/Math.max(1,Math.min(7,energyArr.length)),
      energy30d: energyArr.reduce((a,b)=>a+b,0)/Math.max(1,energyArr.length),
      measured: !!stats.measured
    };
  }

  // Create metrics section
  const metricsSection = document.createElement('div');
  metricsSection.className = 'device-metrics';

  const tsStats = getTimeSeriesStats();
  const priceKWh = getFarmPricePerKWh();

  // PPFD tile with sparkline + DLI today (Step 2)
  const ppfdRow = document.createElement('div');
  ppfdRow.className = 'device-metric-row';
  const ppfdValues = (device.stats?.ppfd || [220, 230, 210, 240, 235, 245, 238]).slice(-20);
  const ppfdToday = ppfdValues[ppfdValues.length - 1] || 0;
  // Use actual schedule for DLI hours when available
  const schedForDevice = getScheduleForDevice(device);
  const hoursOnToday = getDailyOnHours(schedForDevice);
  const dliToday = (ppfdToday * 3600 * (hoursOnToday)) / 1e6;
  const ppfdType = device.stats?.measured ? 'Live' : 'Est.';
  ppfdRow.innerHTML = `<strong>PPFD</strong> <span>${ppfdToday.toFixed(0)} µmol·m⁻²·s⁻¹</span> <span>(${ppfdType})</span>`;
  const ppfdCanvas = document.createElement('canvas');
  ppfdCanvas.className = 'sparkline';
  drawSparkline(ppfdCanvas, ppfdValues);
  ppfdRow.appendChild(ppfdCanvas);
  addTooltip(ppfdRow, `PPFD ${ppfdType}. DLI today ≈ ${(dliToday).toFixed(2)} mol·m⁻²·day⁻¹. Hover trend shows recent PPFD (last ~20 samples).`);
  metricsSection.appendChild(ppfdRow);

  // DLI row
  const dliRow = document.createElement('div');
  dliRow.className = 'device-metric-row';
  dliRow.innerHTML = `<strong>DLI</strong> <span>${tsStats.dliToday.toFixed(2)} mol·m⁻²·day⁻¹</span> <span>(7d: ${tsStats.dli7d.toFixed(2)} | 30d: ${tsStats.dli30d.toFixed(2)})</span>`;
  addTooltip(dliRow, 'DLI = Σ(PPFD) × seconds ÷ 1e6. If PPFD is constant for h hours: DLI = PPFD × 3600 × h ÷ 1e6.');
  metricsSection.appendChild(dliRow);

  // Energy row with wattage sparkline and rollups
  const energyRow = document.createElement('div');
  energyRow.className = 'device-metric-row';
  const energyType = tsStats.measured ? 'Measured' : 'Est.';
  const wattSeries = getWattSeries(device, 20);
  const avgW = wattSeries.reduce((a,b)=>a+b,0) / Math.max(1, wattSeries.length);
  const peakW = Math.max(...wattSeries, 0);
  // Prefer provided energy stats; else estimate from avg watts and schedule hours
  const energyToday = (device.stats?.energy && device.stats.energy.length) ? (device.stats.energy[0] || 0) : (avgW * hoursOnToday / 1000);
  // Totals for 7 and 30 days (use arrays if present, else project)
  const energy7d = (device.stats?.energy && device.stats.energy.length >= 7)
    ? device.stats.energy.slice(0,7).reduce((a,b)=>a+(b||0),0)
    : energyToday * 7;
  const energy30d = (device.stats?.energy && device.stats.energy.length >= 30)
    ? device.stats.energy.slice(0,30).reduce((a,b)=>a+(b||0),0)
    : energyToday * 30;
  energyRow.innerHTML = `<strong>Energy</strong> <span>${energyToday.toFixed(2)} kWh</span> <span>(7d: ${energy7d.toFixed(1)} | 30d: ${energy30d.toFixed(1)})</span> <span class="chip" style="margin-left:4px">${energyType}</span>`;
  const energyCanvas = document.createElement('canvas');
  energyCanvas.className = 'sparkline';
  drawSparkline(energyCanvas, wattSeries, { width: 100, height: 22 });
  energyRow.appendChild(energyCanvas);
  addTooltip(energyRow, `Power trend (W) • avg ${avgW.toFixed(0)} W • peak ${peakW.toFixed(0)} W • Hours on today ${hoursOnToday.toFixed(1)} h`);
  metricsSection.appendChild(energyRow);

  // Cost row
  const costRow = document.createElement('div');
  costRow.className = 'device-metric-row';
  const costToday = tsStats.energyToday * priceKWh;
  costRow.innerHTML = `<strong>Cost</strong> <span>$${costToday.toFixed(2)} today</span> <span>(rate: $${priceKWh.toFixed(2)}/kWh)</span>`;
  addTooltip(costRow, 'Cost = kWh × electricity rate. Edit rate in farm settings.');
  metricsSection.appendChild(costRow);

  card.appendChild(metricsSection);

  // Device header
  const header = document.createElement('div');
  header.className = 'device-head';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'device-head__title';

  const statusDot = document.createElement('span');
  statusDot.className = 'device-status';
  titleWrap.appendChild(statusDot);

  const title = document.createElement('h3');
  title.className = 'device-title';
  title.textContent = device.deviceName || `Device ${device.id}`;
  titleWrap.appendChild(title);

  const powerBadge = document.createElement('span');
  powerBadge.className = 'device-power';
  powerBadge.textContent = device.onOffStatus ? 'ON' : 'OFF';
  if (!device.onOffStatus) powerBadge.setAttribute('data-status', 'off');
  titleWrap.appendChild(powerBadge);

  const onlineBadge = document.createElement('span');
  onlineBadge.className = 'device-online';
  onlineBadge.textContent = device.online ? 'Online' : 'Offline';

  header.append(titleWrap, onlineBadge);
  card.appendChild(header);

  // Advanced controls (Research Mode conditional)
  const badgeRow = document.createElement('div');
  badgeRow.className = 'device-badges';

  const spectraChip = document.createElement('span');
  spectraChip.className = 'device-spectra-chip';
  spectraChip.textContent = 'SpectraSync';
  badgeRow.appendChild(spectraChip);

  // Find device's group and plan
  const deviceGroup = getGroupForDevice(device.id);
  if (deviceGroup) {
    const groupChip = document.createElement('span');
    groupChip.className = 'chip';
    groupChip.title = 'Jump to group';
    groupChip.textContent = deviceGroup.name;
    groupChip.addEventListener('click', () => {
      // Select this group in the Groups section
      const select = document.getElementById('groupSelect');
      if (select) {
        select.value = deviceGroup.id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('section.card:nth-of-type(2)')?.scrollIntoView({ behavior: 'smooth' });
      }
    });
    badgeRow.appendChild(groupChip);

    // Plan chip
    const plan = STATE.plans.find(p => p.id === deviceGroup.plan);
    if (plan) {
      const planChip = document.createElement('span');
      planChip.className = 'chip';
      planChip.title = 'Edit plan';
      planChip.textContent = plan.name;
      planChip.addEventListener('click', () => {
        const select = document.getElementById('groupSelect');
        if (select) {
          select.value = deviceGroup.id;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        document.getElementById('btnGroupPlan')?.click();
        document.querySelector('section.card:nth-of-type(2)')?.scrollIntoView({ behavior: 'smooth' });
      });
      badgeRow.appendChild(planChip);
    }

    // Schedule chip
    const sched = STATE.schedules.find(s => s.id === deviceGroup.schedule);
    const schedChip = document.createElement('span');
    schedChip.className = 'chip';
    schedChip.title = 'Edit schedule';
    schedChip.textContent = sched ? scheduleSummary(sched) : 'No schedule';
    schedChip.addEventListener('click', () => {
      const select = document.getElementById('groupSelect');
      if (select) {
        select.value = deviceGroup.id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.getElementById('btnGroupSchedule')?.click();
      document.querySelector('section.card:nth-of-type(2)')?.scrollIntoView({ behavior: 'smooth' });
    });
    badgeRow.appendChild(schedChip);

    // Apply Now button
    const applyNow = document.createElement('button');
    applyNow.type = 'button';
    applyNow.className = 'ghost';
    applyNow.textContent = 'Now';
    applyNow.title = 'Apply current schedule state to this device';
    applyNow.addEventListener('click', async () => {
      const s = getScheduleForDevice(device);
      const shouldBeOn = isOnNow(s);
      if (shouldBeOn) {
        if (device.online === false) { showToast({title:'Offline', msg:`${device.deviceName || device.id} is offline; skipped`, kind:'warn', icon:'⚠️'}); return; }
        const hex = buildHex12(45);
        await patch(device.id, { status: 'on', value: hex });
        setStatus(`${device.deviceName || device.id} set ON by schedule`);
        showToast({title:'Applied schedule', msg:`Safe ON sent (${hex})`, kind:'success', icon:'✅'});
      } else {
        if (device.online === false) { showToast({title:'Offline', msg:`${device.deviceName || device.id} is offline; skipped`, kind:'warn', icon:'⚠️'}); return; }
        await patch(device.id, { status: 'off', value: null });
        setStatus(`${device.deviceName || device.id} set OFF by schedule`);
        showToast({title:'Applied schedule', msg:'Device turned OFF', kind:'success', icon:'✅'});
      }
    });
    badgeRow.appendChild(applyNow);
  }

  card.appendChild(badgeRow);

  // Location badges and inline editor
  const loc = getDeviceMeta(device.id);
  const locRow = document.createElement('div');
  locRow.className = 'row tiny';
  const locText = document.createElement('span');
  locText.textContent = [loc.room||'—', loc.zone||'—', loc.module||'—', loc.level||'—', loc.side||'—'].join(' · ');
  const locEditBtn = document.createElement('button');
  locEditBtn.type = 'button';
  locEditBtn.className = 'ghost';
  locEditBtn.textContent = 'Edit';
  locRow.append(locText, locEditBtn);
  card.appendChild(locRow);

  const locForm = document.createElement('div');
  locForm.className = 'row tiny';
  locForm.style.display = 'none';
  locForm.innerHTML = `
    <input type="text" placeholder="Room" style="width:100px" value="${loc.room||''}" />
    <input type="text" placeholder="Zone" style="width:100px" value="${loc.zone||''}" />
    <input type="text" placeholder="Module" style="width:110px" value="${loc.module||''}" />
    <input type="text" placeholder="Level" style="width:90px" value="${loc.level||''}" />
    <input type="text" placeholder="Side" style="width:80px" value="${loc.side||''}" />
    <button type="button" class="primary">Save</button>
    <button type="button" class="ghost">Cancel</button>
  `;
  card.appendChild(locForm);
  const [roomI, zoneI, moduleI, levelI, sideI, saveB, cancelB] = Array.from(locForm.querySelectorAll('input,button'));
  locEditBtn.addEventListener('click', () => {
    locForm.style.display = locForm.style.display === 'none' ? 'flex' : 'none';
  });
  cancelB.addEventListener('click', () => { locForm.style.display = 'none'; });
  saveB.addEventListener('click', async () => {
    setDeviceMeta(device.id, { room: roomI.value.trim(), zone: zoneI.value.trim(), module: moduleI.value.trim(), level: levelI.value.trim(), side: sideI.value.trim() });
    await saveDeviceMeta();
    locText.textContent = [roomI.value||'—', zoneI.value||'—', moduleI.value||'—', levelI.value||'—', sideI.value||'—'].join(' · ');
    locForm.style.display = 'none';
  });

  // Spectrum bar (physics-based SPD)
  const spectrumWrap = document.createElement('div');
  spectrumWrap.className = 'device-spectrum';
  const spectrumTitle = document.createElement('div');
  spectrumTitle.className = 'device-spectrum__title tiny';
  spectrumTitle.textContent = 'Spectrum (400–700 nm)';
  const spectrumCanvas = document.createElement('canvas');
  spectrumCanvas.className = 'device-spectrum__canvas';
  spectrumWrap.append(spectrumTitle, spectrumCanvas);
  const pct = {
    cw: device.cwPct ?? device.cw ?? 45,
    ww: device.wwPct ?? device.ww ?? 45,
    bl: device.blPct ?? device.bl ?? 0,
    rd: device.rdPct ?? device.rd ?? 0
  };
  const spd = computeWeightedSPD(pct);
  renderSpectrumCanvas(spectrumCanvas, spd, { width: 300, height: 36 });
  spectrumWrap.setAttribute('data-tip', 'Weighted SPD = sum(channelSPD × channel%). Colors reflect wavelength; height shows relative power.');
  spectrumWrap.classList.add('hint');
  card.appendChild(spectrumWrap);

  // Research Mode conditional rendering
  if (!STATE.researchMode) {
    badgeRow.style.display = 'none';
  }

  // Control buttons
  const controls = document.createElement('div');
  controls.className = 'device-controls';

  const onBtn = document.createElement('button');
  onBtn.textContent = 'ON (Safe)';
  onBtn.onclick = async () => {
    if (device.online === false) { setStatus(`${device.deviceName || device.id} is offline; write blocked`); showToast({title:'Offline', msg:'Write blocked for offline device', kind:'warn', icon:'⚠️'}); return; }
    const hex = buildHex12(45);
    await patch(device.id, {status: 'on', value: hex});
    spectrumWrap?.setAttribute('title', `Last payload: ${hex}`);
    setStatus(`${device.deviceName || device.id} ON`);
    showToast({title:'Device ON', msg:`Sent safe ON (${hex})`, kind:'success', icon:'✅'});
  };

  const offBtn = document.createElement('button');
  offBtn.textContent = 'OFF';
  offBtn.onclick = async () => {
    if (device.online === false) { setStatus(`${device.deviceName || device.id} is offline; write blocked`); showToast({title:'Offline', msg:'Write blocked for offline device', kind:'warn', icon:'⚠️'}); return; }
    await patch(device.id, {status: 'off', value: null});
    setStatus(`${device.deviceName || device.id} OFF`);
    showToast({title:'Device OFF', msg:'Turned off device', kind:'success', icon:'✅'});
  };

  controls.append(onBtn, offBtn);
  card.appendChild(controls);

  return card;
}

// --- Farm Registration System ---
class FarmWizard {
  constructor() {
    this.modal = $('#farmModal');
    this.form = $('#farmWizardForm');
  this.steps = ['farm-name', 'locations', 'contact-name', 'contact-email', 'contact-phone', 'crops', 'device-catalog', 'env-equipment', 'sensor-pick', 'connectivity', 'review'];
    this.currentStep = 0;
    this.data = {
      farmName: '',
      locations: [],
      contact: { name: '', email: '', phone: '' },
      crops: [],
      devices: [],
      env: { hvac: { count: 0, control: '', energy: '' }, dehu: { count: 0, control: '', energy: '' }, fans: { count: 0, control: '' } },
      sensors: { categories: [], defaultLocation: '' },
      connectivity: { hub: { present: 'unknown', host: '', nodeRed: 'unknown' }, cloudTenant: '', roles: [] }
    };
    this.init();
  }

  init() {
    // Wire up modal controls
    $('#btnLaunchFarm')?.addEventListener('click', () => this.open());
    $('#farmModalClose')?.addEventListener('click', () => this.close());
    $('#farmModalBackdrop')?.addEventListener('click', () => this.close());
    
    // Navigation
    $('#farmPrev')?.addEventListener('click', () => this.prevStep());
    $('#farmNext')?.addEventListener('click', () => this.nextStep());
    $('#btnSaveFarm')?.addEventListener('click', (e) => this.saveFarm(e));

    // Step-specific handlers
  this.wireStepHandlers();
    
    // Load existing farm data
    this.loadExistingFarm();
  }

  wireStepHandlers() {
    // Location management
    $('#addFarmLocation')?.addEventListener('click', () => this.addLocation());
    $('#farmLocation')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addLocation();
      }
    });

    // Crop selection
    document.querySelectorAll('.farmCropOption').forEach(checkbox => {
      checkbox.addEventListener('change', () => this.updateCrops());
    });

    $('#farmCropOtherToggle')?.addEventListener('change', (e) => {
      const textInput = $('#farmCropOtherText');
      if (textInput) {
        textInput.style.display = e.target.checked ? 'block' : 'none';
        if (e.target.checked) textInput.focus();
      }
    });
    // Knowledge base typeahead (simple local filter from plans/groups for now)
    const kbSearch = $('#kbSearch');
    const kbResults = $('#kbResults');
    const kbSelected = $('#kbSelected');
    if (kbSearch && kbResults && kbSelected) {
      kbSearch.addEventListener('input', () => this.updateKbResults(kbSearch.value.trim()));
      kbResults.addEventListener('click', (e) => {
        const li = e.target.closest('li[data-model]');
        if (!li) return;
        const item = JSON.parse(li.dataset.payload || '{}');
        this.data.devices.push(item);
        this.renderKbSelected();
      });
    }

    // Micro-forms
    const chipGroup = (id, target, field) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-option');
        if (!btn) return;
        el.querySelectorAll('.chip-option').forEach(b => b.removeAttribute('data-active'));
        btn.setAttribute('data-active','');
        target[field] = btn.dataset.value;
      });
    };
    // HVAC
    $('#mf-hvac-count')?.addEventListener('input', (e)=> this.data.env.hvac.count = Number(e.target.value||0));
    chipGroup('#mf-hvac-control', this.data.env.hvac, 'control');
    chipGroup('#mf-hvac-energy', this.data.env.hvac, 'energy');
    // Dehu
    $('#mf-dehu-count')?.addEventListener('input', (e)=> this.data.env.dehu.count = Number(e.target.value||0));
    chipGroup('#mf-dehu-control', this.data.env.dehu, 'control');
    chipGroup('#mf-dehu-energy', this.data.env.dehu, 'energy');
    // Fans
    $('#mf-fans-count')?.addEventListener('input', (e)=> this.data.env.fans.count = Number(e.target.value||0));
    chipGroup('#mf-fans-control', this.data.env.fans, 'control');

    // Sensors
    $('#sensorCats')?.addEventListener('change', () => {
      const cats = Array.from(document.querySelectorAll('#sensorCats input[type="checkbox"]:checked')).map(i=>i.value);
      this.data.sensors.categories = cats;
    });
    chipGroup('#sensorLocs', this.data.sensors, 'defaultLocation');

    // Connectivity
    chipGroup('#hubPresent', this.data.connectivity.hub, 'present');
    $('#hubHost')?.addEventListener('input', (e)=> this.data.connectivity.hub.host = e.target.value.trim());
    $('#hubNodeRed')?.addEventListener('change', (e)=> this.data.connectivity.hub.nodeRed = e.target.value);
    $('#cloudTenant')?.addEventListener('input', (e)=> this.data.connectivity.cloudTenant = e.target.value.trim());
    $('#addRole')?.addEventListener('click', () => {
      const name = $('#roleName').value.trim();
      const email = $('#roleEmail').value.trim();
      const type = $('#roleType').value;
      if (!name || !email) return alert('Enter name and email');
      this.data.connectivity.roles.push({ name, email, role: type });
      this.renderRoles();
      $('#roleName').value = '';
      $('#roleEmail').value = '';
    });
  }

  updateKbResults(q) {
    const kbResults = $('#kbResults');
    if (!kbResults) return;
    kbResults.innerHTML = '';
    if (!q) return;
    // Simple mock results from known plans/schedules names and sample fixtures
    const catalog = [
      { vendor: 'Gavita', model: 'Pro 1700e', watts: 645, control: '0-10V', spectrum: { cw: 45, ww: 45, bl: 5, rd: 5 } },
      { vendor: 'Fluence', model: 'Spyder X Plus', watts: 655, control: '0-10V', spectrum: { cw: 50, ww: 40, bl: 5, rd: 5 } },
      { vendor: 'GreenReach', model: 'Hex12 Controller', watts: 12, control: 'LAN API', spectrum: { cw: 45, ww: 45, bl: 0, rd: 0 } }
    ];
    const res = catalog.filter(it => `${it.vendor} ${it.model}`.toLowerCase().includes(q.toLowerCase()));
    kbResults.innerHTML = res.map(it => `<li data-model="${it.model}" data-payload='${JSON.stringify(it)}'>${it.vendor} ${it.model} • ${it.watts} W • ${it.control}</li>`).join('');
  }

  renderKbSelected() {
    const ul = $('#kbSelected');
    if (!ul) return;
    ul.innerHTML = this.data.devices.map((it, idx) => `<li>${it.vendor} ${it.model} • ${it.watts} W <button type="button" class="ghost" onclick="farmWizard.removeDevice(${idx})">×</button></li>`).join('');
  }

  removeDevice(idx) {
    this.data.devices.splice(idx, 1);
    this.renderKbSelected();
  }

  async loadExistingFarm() {
    const farmData = await loadJSON('./data/farm.json');
    if (farmData) {
      STATE.farm = farmData;
      this.updateFarmDisplay();
    }
  }

  updateFarmDisplay() {
    if (!STATE.farm) return;
    
    const badge = $('#farmBadge');
    const panel = $('#farmPanel');
    const launchBtn = $('#btnLaunchFarm');
    const editBtn = $('#btnEditFarm');
    
    if (badge && panel) {
      badge.style.display = 'block';
      badge.innerHTML = `<strong>${STATE.farm.farmName}</strong> • ${STATE.farm.locations[0]} • ${STATE.farm.contact.name}`;
      
      launchBtn.style.display = 'none';
      editBtn.style.display = 'inline-block';
      editBtn.addEventListener('click', () => this.edit());
    }
  }

  open() {
    this.currentStep = 0;
    this.showStep(0);
    this.modal.setAttribute('aria-hidden', 'false');
  }

  close() {
    this.modal.setAttribute('aria-hidden', 'true');
  }

  edit() {
    this.data = { ...STATE.farm };
    this.open();
  }

  showStep(index) {
    // Hide all steps
    document.querySelectorAll('.farm-step').forEach(step => {
      step.removeAttribute('data-active');
    });

    // Show current step
    const currentStepEl = document.querySelector(`[data-step="${this.steps[index]}"]`);
    if (currentStepEl) {
      currentStepEl.setAttribute('data-active', '');
    }

    // Update progress
    $('#farmModalProgress').textContent = `Step ${index + 1} of ${this.steps.length}`;

    // Update navigation buttons
    const prevBtn = $('#farmPrev');
    const nextBtn = $('#farmNext');
    const saveBtn = $('#btnSaveFarm');

    prevBtn.style.display = index === 0 ? 'none' : 'inline-block';
    
    if (index === this.steps.length - 1) {
      nextBtn.style.display = 'none';
      saveBtn.style.display = 'inline-block';
    } else {
      nextBtn.style.display = 'inline-block';
      saveBtn.style.display = 'none';
    }

    // Step-specific updates
    if (index === this.steps.length - 1) {
      this.updateReview();
    }
  }

  nextStep() {
    if (this.validateCurrentStep()) {
      this.currentStep++;
      this.showStep(this.currentStep);
    }
  }

  prevStep() {
    this.currentStep--;
    this.showStep(this.currentStep);
  }

  validateCurrentStep() {
    const stepName = this.steps[this.currentStep];
    
    switch (stepName) {
      case 'farm-name':
        const farmName = $('#farmName').value.trim();
        if (!farmName) {
          alert('Please enter a farm name');
          return false;
        }
        this.data.farmName = farmName;
        break;
      
      case 'locations':
        if (this.data.locations.length === 0) {
          alert('Please add at least one location');
          return false;
        }
        break;
      
      case 'contact-name':
        const contactName = $('#farmContact').value.trim();
        if (!contactName) {
          alert('Please enter a contact name');
          return false;
        }
        this.data.contact.name = contactName;
        break;
      
      case 'contact-email':
        const email = $('#farmContactEmail').value.trim();
        if (!email || !email.includes('@')) {
          alert('Please enter a valid email address');
          return false;
        }
        this.data.contact.email = email;
        break;
      
      case 'contact-phone':
        this.data.contact.phone = $('#farmContactPhone').value.trim();
        break;
      
      case 'crops':
        // Crops are updated via checkbox handlers
        break;
    }
    
    return true;
  }

  addLocation() {
    const input = $('#farmLocation');
    const location = input.value.trim();
    
    if (location && !this.data.locations.includes(location)) {
      this.data.locations.push(location);
      this.renderLocations();
      input.value = '';
    }
  }

  renderLocations() {
    const list = $('#farmLocationList');
    if (!list) return;
    
    list.innerHTML = this.data.locations.map(location => 
      `<li>${location} <button type="button" onclick="farmWizard.removeLocation('${location}')">×</button></li>`
    ).join('');
  }

  removeLocation(location) {
    this.data.locations = this.data.locations.filter(l => l !== location);
    this.renderLocations();
  }

  updateCrops() {
    this.data.crops = [];
    document.querySelectorAll('.farmCropOption:checked').forEach(checkbox => {
      if (checkbox.value === 'Other') {
        const otherText = $('#farmCropOtherText').value.trim();
        if (otherText) this.data.crops.push(otherText);
      } else {
        this.data.crops.push(checkbox.value);
      }
    });
  }

  updateReview() {
    const review = $('#farmReview');
    if (!review) return;
    
    review.innerHTML = `
      <div><strong>Farm Name:</strong> ${this.data.farmName}</div>
      <div><strong>Locations:</strong> ${this.data.locations.join(', ')}</div>
      <div><strong>Contact:</strong> ${this.data.contact.name}</div>
      <div><strong>Email:</strong> ${this.data.contact.email}</div>
      ${this.data.contact.phone ? `<div><strong>Phone:</strong> ${this.data.contact.phone}</div>` : ''}
      <div><strong>Crops:</strong> ${this.data.crops.join(', ')}</div>
      <div><strong>Devices:</strong> ${this.data.devices.map(d=>`${d.vendor} ${d.model}`).join(', ') || '—'}</div>
      <div><strong>Env:</strong> HVAC ${this.data.env.hvac.count} (${this.data.env.hvac.control||'—'}/${this.data.env.hvac.energy||'—'}), Dehu ${this.data.env.dehu.count} (${this.data.env.dehu.control||'—'}/${this.data.env.dehu.energy||'—'}), Fans ${this.data.env.fans.count} (${this.data.env.fans.control||'—'})</div>
      <div><strong>Sensors:</strong> ${this.data.sensors.categories.join(', ') || '—'} @ ${this.data.sensors.defaultLocation || '—'}</div>
      <div><strong>Connectivity:</strong> Hub ${this.data.connectivity.hub.present} ${this.data.connectivity.hub.host ? '• '+this.data.connectivity.hub.host : ''} (Node-RED: ${this.data.connectivity.hub.nodeRed}) • Cloud ${this.data.connectivity.cloudTenant || '—'}</div>
      <div><strong>Roles:</strong> ${this.data.connectivity.roles.map(r=>`${r.name} (${r.role})`).join(', ') || '—'}</div>
    `;
  }

  async saveFarm(e) {
    e.preventDefault();
    
    const farmData = {
      ...this.data,
      timezone: 'America/Toronto',
      pricePerKWh: 0.18,
      currency: 'CAD',
      registered: new Date().toISOString()
    };

    // Save to state and local storage
    STATE.farm = farmData;
    localStorage.setItem('gr.farm', JSON.stringify(farmData));
    
    // Save to server
    const saved = await saveJSON('./data/farm.json', farmData);
    
    if (saved) {
      setStatus('Farm registration saved successfully');
      this.updateFarmDisplay();
      this.close();
    } else {
      alert('Failed to save farm registration. Please try again.');
    }
  }
}

// --- Data Loading and Initialization ---
async function loadAllData() {
  try {
    // Load device data from API
    const deviceResponse = await api('/api/devicedatas');
    STATE.devices = deviceResponse?.data || [];
    
    // Load static data files
    const [groups, schedules, plans, environment, calibrations, deviceMeta] = await Promise.all([
      loadJSON('./data/groups.json'),
      loadJSON('./data/schedules.json'), 
      loadJSON('./data/plans.json'),
      api('/env'),
      loadJSON('./data/calibration.json'),
      loadJSON('./data/device-meta.json')
    ]);
    
    STATE.groups = groups?.groups || [];
    STATE.schedules = schedules?.schedules || [];
    STATE.plans = plans?.plans || [];
  STATE.environment = environment?.zones || [];
    STATE.calibrations = calibrations?.calibrations || [];
    STATE.deviceMeta = deviceMeta?.devices || {};
    
    setStatus(`Loaded ${STATE.devices.length} devices, ${STATE.groups.length} groups, ${STATE.schedules.length} schedules`);
    
    // Render UI
    renderDevices();
    renderGroups();
    renderSchedules();
  renderEnvironment();
    renderPlans();
  // Start background polling for environment telemetry
  startEnvPolling();
    
  } catch (error) {
    setStatus(`Error loading data: ${error.message}`);
    console.error('Data loading error:', error);
  }
}

function renderDevices() {
  const container = $('#devices');
  if (!container) return;
  
  container.innerHTML = '';
  STATE.devices.forEach(device => {
    const card = deviceCard(device);
    container.appendChild(card);
  });
}

function renderGroups() {
  const select = $('#groupSelect');
  if (!select) return;
  
  select.innerHTML = '<option value="">Select group...</option>' +
    STATE.groups.map(group => `<option value="${group.id}">${group.name}</option>`).join('');
}

function renderSchedules() {
  const select = $('#groupSchedule');
  if (!select) return;
  
  select.innerHTML = '<option value="">No schedule</option>' +
    STATE.schedules.map(schedule => `<option value="${schedule.id}">${schedule.name}</option>`).join('');
}

function renderEnvironment() {
  const container = document.getElementById('envZones');
  if (!container) return;
  
  container.innerHTML = STATE.environment.map(zone => `
    <div class="env-zone" data-zone-id="${zone.id}">
      <div class="env-zone__header">
        <h3 class="env-zone__name">${zone.name}</h3>
        <div class="env-zone__status" title="${zone.meta?.source ? `Source: ${zone.meta.source}` : 'Source unknown'}${typeof zone.meta?.battery === 'number' ? ` • Battery: ${zone.meta.battery}%` : ''}${typeof zone.meta?.rssi === 'number' ? ` • RSSI: ${zone.meta.rssi} dBm` : ''}">
          <span class="env-status-dot"></span>
          <span class="tiny">${zone.meta?.source || '—'}${typeof zone.meta?.battery === 'number' ? ` • ${zone.meta.battery}%` : ''}${typeof zone.meta?.rssi === 'number' ? ` • ${zone.meta.rssi} dBm` : ''}</span>
        </div>
      </div>
      <div class="env-metrics">
        ${Object.entries(zone.sensors).map(([key, sensor]) => `
          <div class="env-metric" data-metric="${key}">
            <div>
              <div class="env-metric__label">${key.toUpperCase()}</div>
              <div class="env-metric__value">${sensor.current}${key === 'tempC' ? '°C' : key === 'rh' ? '%' : key === 'vpd' ? ' kPa' : ' ppm'}</div>
            </div>
            <canvas class="env-metric__trend" width="60" height="20" aria-label="trend sparkline for ${key}"></canvas>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  // Draw sparklines and wire modal
  document.querySelectorAll('.env-zone').forEach(zoneEl => {
    const zoneId = zoneEl.getAttribute('data-zone-id');
    const zone = STATE.environment.find(z => String(z.id) === String(zoneId));
    if (!zone) return;
    zoneEl.querySelectorAll('.env-metric').forEach(metricEl => {
      const key = metricEl.getAttribute('data-metric');
      const sensor = zone.sensors?.[key];
      const canvas = metricEl.querySelector('canvas.env-metric__trend');
      if (!sensor || !canvas) return;
      const values = Array.isArray(sensor.history) ? sensor.history.slice(0, 60).reverse() : [];
      // Color by setpoint: green within, red outside, yellow when undefined
      let color = '#16A34A';
      const min = sensor.setpoint?.min;
      const max = sensor.setpoint?.max;
      const cur = sensor.current;
      if (typeof min === 'number' && typeof max === 'number' && typeof cur === 'number') {
        color = (cur >= min && cur <= max) ? '#16A34A' : '#EF4444';
      } else {
        color = '#EAB308';
      }
      drawSparkline(canvas, values, { width: 60, height: 20, color });
      // Click to open modal trend
      metricEl.style.cursor = 'zoom-in';
      metricEl.addEventListener('click', () => openEnvModal(zone, key));
    });
  });
}

// Environment polling and actions
let ENV_POLL_TIMER = null;
async function reloadEnvironment() {
  try {
    const env = await api('/env');
    STATE.environment = env?.zones || [];
    renderEnvironment();
    $('#envStatus')?.replaceChildren(document.createTextNode(`Updated ${new Date().toLocaleTimeString()}`));
  } catch (e) {
    $('#envStatus')?.replaceChildren(document.createTextNode(`Env load failed: ${e.message}`));
  }
}
function startEnvPolling(intervalMs = 10000) {
  clearInterval(ENV_POLL_TIMER);
  ENV_POLL_TIMER = setInterval(reloadEnvironment, intervalMs);
}

function renderPlans() {
  const select = $('#planSelect');
  if (!select) return;
  
  select.innerHTML = '<option value="">Select plan...</option>' +
    STATE.plans.map(plan => `<option value="${plan.id}">${plan.name}</option>`).join('');
}

// --- Research Mode Integration ---
function refreshDeviceCards() {
  renderDevices(); // Simple re-render for now
}

// --- Config banner and modal helpers ---
async function loadConfig() {
  try {
    const cfg = await api('/config');
    STATE.config = { singleServer: !!cfg?.singleServer, controller: cfg?.controller || '' };
    const chip = document.getElementById('configChip');
    if (chip) {
      chip.textContent = STATE.config.singleServer ? 'Local mode' : 'Controller mode';
      chip.title = `Controller: ${STATE.config.controller || 'n/a'}`;
    }
  } catch (e) {
    console.warn('Failed to load /config', e);
  }
}

function openEnvModal(zone, metricKey) {
  const modal = document.getElementById('envModal');
  if (!modal) return;
  const title = document.getElementById('envModalTitle');
  const sub = document.getElementById('envModalSubtitle');
  const chart = document.getElementById('envModalChart');
  const stats = document.getElementById('envModalStats');
  title.textContent = `${zone.name} — ${metricKey.toUpperCase()} trend`;
  const s = zone.sensors?.[metricKey];
  sub.textContent = s?.setpoint ? `Target: ${s.setpoint.min ?? '—'} to ${s.setpoint.max ?? '—'}` : '';
  chart.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = 520; canvas.height = 140; canvas.style.width = '520px'; canvas.style.height = '140px';
  chart.appendChild(canvas);
  const values = Array.isArray(s?.history) ? s.history.slice(0, 144).reverse() : [];
  drawSparkline(canvas, values, { width: 520, height: 140, color: '#0ea5e9' });
  // Simple stats
  if (values.length) {
    const last = values[values.length-1];
    const min = Math.min(...values).toFixed(2);
    const max = Math.max(...values).toFixed(2);
    const avg = (values.reduce((a,b)=>a+b,0)/values.length).toFixed(2);
    stats.textContent = `Now ${last} • Min ${min} • Max ${max} • Avg ${avg}`;
  } else {
    stats.textContent = 'No history yet.';
  }
  // Open
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('envModalBackdrop')?.addEventListener('click', closeEnvModal, { once: true });
  document.getElementById('envModalClose')?.addEventListener('click', closeEnvModal, { once: true });
}
function closeEnvModal() {
  document.getElementById('envModal')?.setAttribute('aria-hidden', 'true');
}

// --- Global Event Handlers ---
function wireGlobalEvents() {
  // Research Mode toggle
  const toggle = $('#researchModeToggle');
  if (toggle) {
    STATE.researchMode = getResearchMode();
    toggle.checked = STATE.researchMode;
    toggle.addEventListener('change', () => {
      STATE.researchMode = toggle.checked;
      setResearchMode(STATE.researchMode);
      refreshDeviceCards();
    });
  }

  // Global device controls
  $('#refresh')?.addEventListener('click', loadAllData);
  $('#allOn')?.addEventListener('click', async () => {
    const promises = STATE.devices.map(device => 
      patch(device.id, {status: "on", value: buildHex12(45)})
    );
    await Promise.all(promises);
    setStatus("All devices ON (Safe mode)");
    showToast({title:'All ON', msg:'Sent safe ON to all devices', kind:'success', icon:'✅'});
  });
  $('#allOff')?.addEventListener('click', async () => {
    const promises = STATE.devices.map(device => 
      patch(device.id, {status: "off", value: null})
    );
    await Promise.all(promises);
    setStatus("All devices OFF");
    showToast({title:'All OFF', msg:'Turned off all devices', kind:'success', icon:'✅'});
  });

  // Environment actions
  $('#btnReloadEnv')?.addEventListener('click', reloadEnvironment);
  $('#btnSaveEnv')?.addEventListener('click', async () => {
    // Persist current env targets (setpoints) back to file for now
    const payload = { zones: STATE.environment };
    const ok = await saveJSON('./data/env.json', payload);
    if (ok) setStatus('Environment targets saved');
    else alert('Failed to save environment');
  });

  // Modal close handlers
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('[aria-hidden="false"]').forEach(modal => {
        modal.setAttribute('aria-hidden', 'true');
      });
    }
  });

  // Group UI wiring (Section 4)
  const groupSelect = $('#groupSelect');
  const groupPlan = $('#groupPlan');
  const groupSchedule = $('#groupSchedule');
  const groupChips = $('#groupSpectraChip')?.parentElement;
  const groupSchedulePreview = $('#groupSchedulePreview');
  const groupRosterBody = $('#groupRosterBody');
  const groupRosterEmpty = $('#groupRosterEmpty');
  // Group-level location editor (batch)
  const groupQuick = $('#groupQuick');
  if (groupQuick && !groupQuick.dataset.enhanced) {
    groupQuick.dataset.enhanced = '1';
    const roomSel = document.createElement('input'); roomSel.type='text'; roomSel.placeholder='Room'; roomSel.style.minWidth='120px';
    const zoneSel = document.createElement('input'); zoneSel.type='text'; zoneSel.placeholder='Zone'; zoneSel.style.minWidth='120px';
    const applyBtn = document.createElement('button'); applyBtn.type='button'; applyBtn.className='ghost'; applyBtn.textContent='Apply to Group';
    groupQuick.append(roomSel, zoneSel, applyBtn);
    applyBtn.addEventListener('click', async () => {
      if (!STATE.currentGroup) return alert('Select a group first');
      const ids = (STATE.currentGroup.lights||[]).map(l=>l.id);
      ids.forEach(id => {
        const meta = getDeviceMeta(id);
        setDeviceMeta(id, { room: roomSel.value.trim() || meta.room, zone: zoneSel.value.trim() || meta.zone });
      });
      await saveDeviceMeta();
      renderDevices();
      setStatus('Applied Room/Zone to group devices');
    });
  }

  // Spectrum HUD controls
  const gInputs = {
    master: $('#gmaster'), masterV: $('#gmasterv'), lock: $('#gratios'),
    cw: $('#gcw'), cwV: $('#gcwv'),
    ww: $('#gww'), wwV: $('#gwwv'),
    bl: $('#gbl'), blV: $('#gblv'),
    rd: $('#grd'), rdV: $('#grdv')
  };
  function setHUD(values) {
    const { master, cw, ww, bl, rd } = values;
    if (typeof master === 'number' && gInputs.master && gInputs.masterV) { gInputs.master.value = master; gInputs.masterV.value = master; }
    if (typeof cw === 'number') { gInputs.cw.value = cw; gInputs.cwV.value = cw; }
    if (typeof ww === 'number') { gInputs.ww.value = ww; gInputs.wwV.value = ww; }
    if (typeof bl === 'number') { gInputs.bl.value = bl; gInputs.blV.value = bl; }
    if (typeof rd === 'number') { gInputs.rd.value = rd; gInputs.rdV.value = rd; }
  }
  function readHUD() {
    return {
      master: Number(gInputs.master?.value ?? 60),
      cw: Number(gInputs.cw?.value ?? 45),
      ww: Number(gInputs.ww?.value ?? 45),
      bl: Number(gInputs.bl?.value ?? 0),
      rd: Number(gInputs.rd?.value ?? 0),
      lock: !!gInputs.lock?.checked
    };
  }
  function connectPair(rangeEl, numEl, onChange) {
    if (!rangeEl || !numEl) return;
    const handler = () => { numEl.value = rangeEl.value; onChange?.(Number(rangeEl.value)); };
    const handlerNum = () => { rangeEl.value = numEl.value; onChange?.(Number(numEl.value)); };
    rangeEl.addEventListener('input', handler);
    numEl.addEventListener('input', handlerNum);
  }
  function scaleMix(mix, scalePct) {
    const s = Math.max(0, Math.min(100, scalePct)) / 100;
    return {
      cw: Math.round(mix.cw * s),
      ww: Math.round(mix.ww * s),
      bl: Math.round(mix.bl * s),
      rd: Math.round(mix.rd * s)
    };
  }
  function getGroupSpectrum(group) {
    const plan = STATE.plans.find(p => p.id === group?.plan);
    const hud = readHUD();
    const base = plan?.spectrum || { cw: 45, ww: 45, bl: 0, rd: 0 };
    const differs = ['cw','ww','bl','rd'].some(k => Number(hud[k]) !== Number(base[k]));
    const mix = differs ? { cw: hud.cw, ww: hud.ww, bl: hud.bl, rd: hud.rd } : base;
    return hud.lock ? { ...scaleMix(mix, hud.master), master: hud.master } : { ...mix, master: hud.master };
  }
  connectPair(gInputs.cw, gInputs.cwV);
  connectPair(gInputs.ww, gInputs.wwV);
  connectPair(gInputs.bl, gInputs.blV);
  connectPair(gInputs.rd, gInputs.rdV);
  if (gInputs.master && gInputs.masterV) {
    connectPair(gInputs.master, gInputs.masterV, (v) => {
      const hud = readHUD();
      if (hud.lock) {
        const mix = { cw: Number(gInputs.cw.value), ww: Number(gInputs.ww.value), bl: Number(gInputs.bl.value), rd: Number(gInputs.rd.value) };
        const scaled = scaleMix(mix, v);
        setHUD({ cw: scaled.cw, ww: scaled.ww, bl: scaled.bl, rd: scaled.rd });
      }
    });
  }

  function updateGroupUI(group) {
    if (!group) { groupPlan.value = ''; groupSchedule.value = ''; groupSchedulePreview.innerHTML=''; if (groupChips) groupChips.querySelectorAll('.chip[data-kind="sched"]').forEach(n=>n.remove()); return; }
    groupPlan.value = group.plan || '';
    groupSchedule.value = group.schedule || '';
    // Chip
    if (groupChips) {
      groupChips.querySelectorAll('.chip[data-kind="sched"]').forEach(n=>n.remove());
      const sched = STATE.schedules.find(s => s.id === group.schedule);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.kind = 'sched';
      chip.textContent = sched ? scheduleSummary(sched) : 'No schedule';
      chip.title = 'Click to edit schedule';
      chip.addEventListener('click', () => openScheduleEditorForGroup(group.id));
      groupChips.appendChild(chip);
    }
    // Preview
    groupSchedulePreview.innerHTML = '<div class="schedule-preview__bar"></div>';
    const bar = groupSchedulePreview.querySelector('.schedule-preview__bar');
    const sched = STATE.schedules.find(s => s.id === group.schedule);
    if (sched) renderScheduleBar(bar, sched.cycles || []);
    // Roster
    if (groupRosterBody) {
      groupRosterBody.innerHTML = (group.lights || []).map(l => {
        const meta = getDeviceMeta(l.id);
        const locStr = [meta.room||'', meta.zone||''].filter(Boolean).join(' / ');
        const levelStr = meta.level || '';
        const sideStr = meta.side || '';
        return `<tr><td>${l.name || 'Light'}</td><td>${l.id}</td><td>${locStr}</td><td>${meta.module||''}</td><td>${levelStr}</td><td>${sideStr}</td><td>—</td></tr>`;
      }).join('');
    }
    if (groupRosterEmpty) groupRosterEmpty.style.display = (group.lights||[]).length ? 'none' : 'block';
    // Initialize HUD from plan when switching groups
    const plan = STATE.plans.find(p => p.id === group?.plan);
    const spec = plan?.spectrum || { cw: 45, ww: 45, bl: 0, rd: 0 };
    setHUD({ master: 60, ...spec });
  }

  function openScheduleEditorForGroup(groupId) {
    STATE.editingGroupId = groupId;
    // Prefill schedule editor from current group schedule if exists
    const group = STATE.groups.find(g => g.id === groupId);
    const sched = STATE.schedules.find(s => s.id === group?.schedule) || STATE.schedules[0];
    // Apply fields
    const mode = sched?.mode || 'one';
    document.querySelectorAll('input[name="schedMode"]').forEach(r => r.checked = (r.value === mode));
    $('#schedCycle1On').value = sched?.cycles?.[0]?.on || '08:00';
    $('#schedCycle1Off').value = sched?.cycles?.[0]?.off || '20:00';
    $('#schedCycle2On').value = sched?.cycles?.[1]?.on || '00:00';
    $('#schedCycle2Off').value = sched?.cycles?.[1]?.off || '00:00';
    updateScheduleMathUI();
    // Scroll to Schedules section
    document.querySelector('section.card:nth-of-type(3)')?.scrollIntoView({ behavior: 'smooth' });
    setStatus(`Editing schedule for group ${group?.name}`);
  }

  groupSelect?.addEventListener('change', () => {
    const id = groupSelect.value;
    STATE.currentGroup = STATE.groups.find(g => g.id === id) || null;
    updateGroupUI(STATE.currentGroup);
  });
  // Plan: persist plan selection for current group
  groupPlan?.addEventListener('change', async () => {
    if (!STATE.currentGroup) return;
    STATE.currentGroup.plan = groupPlan.value || '';
    await saveGroups();
    updateGroupUI(STATE.currentGroup);
  });
  groupSchedule?.addEventListener('change', async () => {
    if (!STATE.currentGroup) return;
    STATE.currentGroup.schedule = groupSchedule.value || '';
    await saveGroups();
    updateGroupUI(STATE.currentGroup);
  });
  // Edit Plan button: focus plan select and scroll into view
  $('#btnGroupPlan')?.addEventListener('click', () => {
    document.querySelector('section.card:nth-of-type(2)')?.scrollIntoView({ behavior: 'smooth' });
    groupPlan?.focus();
  });
  $('#btnGroupSchedule')?.addEventListener('click', () => {
    if (!STATE.currentGroup) return;
    openScheduleEditorForGroup(STATE.currentGroup.id);
  });

  async function saveGroups() {
    const ok = await saveJSON('./data/groups.json', { groups: STATE.groups });
    if (ok) setStatus('Groups saved'); else alert('Failed to save groups');
  }

  // Schedules editor wiring (Section 4 & 5)
  const schedModeRadios = Array.from(document.querySelectorAll('input[name="schedMode"]'));
  const schedInputs = ['#schedCycle1On','#schedCycle1Off','#schedCycle2On','#schedCycle2Off'].map(s=>$(s));
  const onTotalEl = $('#schedOnTotal');
  const offTotalEl = $('#schedOffTotal');
  const deltaEl = $('#schedDelta');
  const warningEl = $('#schedMathWarning');
  const previewBar = $('#schedEditorBar');
  const splitBtn = document.createElement('button');
  splitBtn.type = 'button';
  splitBtn.className = 'ghost';
  splitBtn.textContent = 'Split 24 h evenly';
  $('.schedule-mode')?.appendChild(splitBtn);
  const fixBtn = document.createElement('button');
  fixBtn.type = 'button';
  fixBtn.className = 'ghost';
  fixBtn.textContent = 'Fix to 24 h';
  $('.schedule-mode')?.appendChild(fixBtn);

  function getEditorSchedule() {
    const mode = schedModeRadios.find(r=>r.checked)?.value || 'one';
    const cycles = [
      { on: $('#schedCycle1On').value, off: $('#schedCycle1Off').value }
    ];
    if (mode === 'two') cycles.push({ on: $('#schedCycle2On').value, off: $('#schedCycle2Off').value });
    return { id: '', name: '', mode, timezone: 'America/Toronto', cycles };
  }

  function updateScheduleMathUI() {
    const s = getEditorSchedule();
    const { errors, onTotal, offTotal, overlapTrim } = validateSchedule(s.mode, s.cycles);
    onTotalEl.textContent = `${(onTotal/60).toFixed(1)} h`;
    offTotalEl.textContent = `${(offTotal/60).toFixed(1)} h`;
    // Use delta to show trimmed overlap in hours (0.0 h when none)
    deltaEl.textContent = `${(Math.max(0, overlapTrim)/60).toFixed(1)} h overlap`;
    if (errors.length) { warningEl.style.display = 'block'; warningEl.textContent = errors.join(' ');} else { warningEl.style.display = 'none'; }
    renderScheduleBar(previewBar, s.cycles);
    // Show/hide cycle 2 controls based on mode
    const isTwo = s.mode === 'two';
    const c2 = document.querySelector('.schedule-cycle[data-cycle="2"]');
    if (c2) {
      c2.style.display = isTwo ? 'flex' : 'none';
      c2.querySelectorAll('input')?.forEach(inp => inp.disabled = !isTwo);
    }
  }

  schedModeRadios.forEach(r => r.addEventListener('change', updateScheduleMathUI));
  schedInputs.forEach(inp => inp?.addEventListener('change', updateScheduleMathUI));
  splitBtn.addEventListener('click', () => {
    // Split evenly into two cycles of 12h starting at Cycle 1 ON
    const start = toMinutes($('#schedCycle1On').value || '00:00');
    $('#schedCycle1Off').value = minutesToHHMM(start + 12*60);
    $('#schedCycle2On').value = minutesToHHMM(start + 12*60);
    $('#schedCycle2Off').value = minutesToHHMM(start + 24*60);
    // Switch mode to two
    schedModeRadios.forEach(r=> r.checked = r.value==='two');
    updateScheduleMathUI();
  });

  fixBtn.addEventListener('click', () => {
    const mode = schedModeRadios.find(r=>r.checked)?.value || 'one';
    const c1On = $('#schedCycle1On').value;
    const c1Off = $('#schedCycle1Off').value;
    if (mode === 'one') {
      // Ensure ON duration equals target (set OFF 24h after ON?) For one cycle, just ensure off after on within 24h.
      // If zero duration, set to 12h as a sane default
      const dur = computeCycleDuration(c1On, c1Off);
      if (dur === 0) $('#schedCycle1Off').value = minutesToHHMM(toMinutes(c1On) + 12*60);
    } else {
      // Reposition Cycle 2 to start at Cycle 1 OFF and trim to fit within remaining day to avoid overlap
      const c1Dur = computeCycleDuration(c1On, c1Off);
      const origC2Dur = computeCycleDuration($('#schedCycle2On').value, $('#schedCycle2Off').value);
      const c2On = minutesToHHMM(toMinutes(c1Off));
      const remaining = Math.max(0, 24*60 - c1Dur);
      const targetC2Dur = Math.min(origC2Dur || 12*60, remaining);
      $('#schedCycle2On').value = c2On;
      $('#schedCycle2Off').value = minutesToHHMM(toMinutes(c2On) + targetC2Dur);
    }
    updateScheduleMathUI();
  });

  async function saveSchedules() {
    const ok = await saveJSON('./data/schedules.json', { schedules: STATE.schedules });
    if (ok) setStatus('Schedules saved'); else alert('Failed to save schedules');
  }

  $('#btnSaveSched')?.addEventListener('click', async () => {
    const edited = getEditorSchedule();
    // Assign id and name
    if (STATE.editingGroupId) {
      const group = STATE.groups.find(g => g.id === STATE.editingGroupId);
      edited.id = `group:${STATE.editingGroupId}`;
      edited.name = `${group?.name || STATE.editingGroupId} Schedule`;
      // Upsert schedule
      const idx = STATE.schedules.findIndex(s => s.id === edited.id);
      if (idx >= 0) STATE.schedules[idx] = { ...STATE.schedules[idx], ...edited, active: true };
      else STATE.schedules.push({ ...edited, active: true });
      // Link to group
      if (group) group.schedule = edited.id;
      await Promise.all([saveSchedules(), saveJSON('./data/groups.json', { groups: STATE.groups })]);
      setStatus('Saved group schedule and linked to group');
      STATE.editingGroupId = null;
      renderSchedules();
      if (STATE.currentGroup?.id === group?.id) {
        updateGroupUI(STATE.currentGroup);
      }
    } else {
      // Save as a standalone schedule with generated id
      edited.id = edited.id || `schedule-${Math.random().toString(36).slice(2,8)}`;
      edited.name = edited.name || 'Custom Schedule';
      STATE.schedules.push({ ...edited, active: true });
      await saveSchedules();
      renderSchedules();
    }
  });

  $('#btnReloadSched')?.addEventListener('click', async () => {
    const sched = await loadJSON('./data/schedules.json');
    STATE.schedules = sched?.schedules || [];
    renderSchedules();
    setStatus('Schedules reloaded');
  });

  $('#btnDeleteSched')?.addEventListener('click', async () => {
    const id = prompt('Enter schedule id to delete');
    if (!id) return;
    STATE.schedules = STATE.schedules.filter(s => s.id !== id);
    // Unlink from any groups referencing it
    STATE.groups.forEach(g => { if (g.schedule === id) g.schedule = ''; });
    await Promise.all([saveSchedules(), saveJSON('./data/groups.json', { groups: STATE.groups })]);
    renderSchedules();
    setStatus(`Deleted schedule ${id}`);
  });

  // Group actions: ON, OFF, Apply Spectrum
  $('#grpOn')?.addEventListener('click', async () => {
    if (!STATE.currentGroup) return alert('Select a group first');
    const ids = (STATE.currentGroup.lights||[]).map(l=>l.id);
    const targets = STATE.devices.filter(d=>ids.includes(d.id));
    const online = targets.filter(d=>d.online);
    if (!online.length) { setStatus('No online devices to power ON'); showToast({title:'No devices online', msg:'Skipped group power ON. All devices offline.', kind:'warn', icon:'⚠️'}); return; }
    const hex = buildHex12(45);
    await Promise.all(online.map(d => patch(d.id, { status: 'on', value: hex })));
    const chip = document.getElementById('groupSpectraChip');
    if (chip) chip.setAttribute('title', `Last payload: ${hex}`);
    document.getElementById('groupLastHex')?.replaceChildren(document.createTextNode(`Last payload: ${hex}`));
    setStatus(`Powered ON ${online.length} device(s)`);
    showToast({title:'Powered ON', msg:`Sent safe ON to ${online.length} device(s)`, kind:'success', icon:'✅'});
  });
  $('#grpOff')?.addEventListener('click', async () => {
    if (!STATE.currentGroup) return alert('Select a group first');
    const ids = (STATE.currentGroup.lights||[]).map(l=>l.id);
    const targets = STATE.devices.filter(d=>ids.includes(d.id));
    const online = targets.filter(d=>d.online);
    if (!online.length) { setStatus('No online devices to power OFF'); showToast({title:'No devices online', msg:'Skipped group power OFF. All devices offline.', kind:'warn', icon:'⚠️'}); return; }
    await Promise.all(online.map(d => patch(d.id, { status: 'off', value: null })));
    setStatus(`Powered OFF ${online.length} device(s)`);
    showToast({title:'Powered OFF', msg:`Turned off ${online.length} device(s)`, kind:'success', icon:'✅'});
  });
  $('#grpApply')?.addEventListener('click', async () => {
    if (!STATE.currentGroup) return alert('Select a group first');
    const mix = getGroupSpectrum(STATE.currentGroup);
    const hex = buildHex12({ cw: mix.cw, ww: mix.ww, bl: mix.bl, rd: mix.rd });
    const ids = (STATE.currentGroup.lights||[]).map(l=>l.id);
    const targets = STATE.devices.filter(d=>ids.includes(d.id));
    const online = targets.filter(d=>d.online);
    const offline = targets.filter(d=>!d.online);
    if (!online.length) { setStatus('No online devices to apply spectrum'); showToast({title:'No devices online', msg:'Skipped Apply Spectrum. All devices offline.', kind:'warn', icon:'⚠️'}); return; }
    // Guardrail: basic power-cap autoscale (if any channel > 100, clamp and notify)
    const over = ['cw','ww','bl','rd'].filter(k => mix[k] > 100);
    let appliedHex = hex;
    if (over.length) {
      const scaled = { ...mix };
      over.forEach(k => scaled[k] = 100);
      appliedHex = buildHex12(scaled);
      showToast({title:'Autoscaled to cap', msg:`Channels ${over.join(', ')} capped at 100%.`, kind:'info', icon:'ℹ️'});
    }
    await Promise.all(online.map(d => patch(d.id, { status: 'on', value: appliedHex })));
    setStatus(`Applied spectrum to ${online.length} device(s)${offline.length?`, skipped ${offline.length} offline`:''}`);
    if (offline.length) {
      showToast({title:'Skipped offline devices', msg:`${offline.length} device(s) were offline and skipped.`, kind:'warn', icon:'⚠️'});
    }
    showToast({title:'Spectrum applied', msg:`Sent to ${online.length} device(s)`, kind:'success', icon:'✅'});
    const chip = document.getElementById('groupSpectraChip');
    if (chip) chip.setAttribute('title', `Last payload: ${appliedHex}`);
    document.getElementById('groupLastHex')?.replaceChildren(document.createTextNode(`Last payload: ${appliedHex}`));
  });
}

// --- Application Initialization ---
let farmWizard;

document.addEventListener('DOMContentLoaded', async () => {
  wireHints();
  wireGlobalEvents();
  // Load runtime config and show chip
  await loadConfig();
  
  // Initialize farm wizard
  farmWizard = new FarmWizard();
  
  // Load all data
  await loadAllData();
  
  setStatus("Dashboard loaded");
});
