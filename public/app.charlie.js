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
  rooms: [],
  farm: null,
  environment: [],
  calibrations: [],
  currentGroup: null,
  currentSchedule: null,
  researchMode: false,
  editingGroupId: null,
  deviceMeta: {},
  deviceKB: { fixtures: [] },
  config: { singleServer: true, controller: '' },
  branding: null,
  pendingBrand: null
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

// --- Theming ---
function applyTheme(palette) {
  if (!palette) return;
  const root = document.documentElement;
  const map = {
    '--gr-bg': palette.background,
    '--gr-surface': palette.surface || '#FFFFFF',
    '--gr-border': palette.border || '#DCE5E5',
    '--gr-text': palette.text || '#0B1220',
    '--gr-primary': palette.primary,
    '--gr-accent': palette.accent
  };
  Object.entries(map).forEach(([k,v]) => { if (v) root.style.setProperty(k, v); });
  // Basic contrast check for text vs surfaces
  try {
    const cText = getComputedStyle(root).getPropertyValue('--gr-text').trim() || '#0B1220';
    const cSurface = getComputedStyle(root).getPropertyValue('--gr-surface').trim() || '#FFFFFF';
    const cBg = getComputedStyle(root).getPropertyValue('--gr-bg').trim() || '#F7FAFA';
    const ratio = (a, b) => {
      const hex = (x) => x.startsWith('#') ? x : (()=>{const ctx=document.createElement('canvas').getContext('2d');ctx.fillStyle=x;return ctx.fillStyle;})();
      const h = hex(a);
      const hh = h.length===4?`#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`:h;
      const r = parseInt(hh.slice(1,3),16)/255, g=parseInt(hh.slice(3,5),16)/255, b2=parseInt(hh.slice(5,7),16)/255;
      const l = (v)=> v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
      const L = 0.2126*l(r)+0.7152*l(g)+0.0722*l(b2);
      return L;
    };
    const contrast = (L1, L2) => {
      const [a,b] = L1>L2?[L1,L2]:[L2,L1];
      return (a+0.05)/(b+0.05);
    };
    const tVsSurface = contrast(ratio(cText), ratio(cSurface));
    const tVsBg = contrast(ratio(cText), ratio(cBg));
    if (tVsSurface < 4.5 || tVsBg < 4.5) {
      showToast({ title:'Low contrast warning', msg:'Some text may be hard to read with the current theme. Consider adjusting Text/Background colors.', kind:'warn', icon:'\u26a0\ufe0f' }, 6000);
    }
  } catch {}
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
  const primary = getComputedStyle(document.documentElement).getPropertyValue('--gr-primary').trim() || '#10B981';
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--gr-bg').trim() || '#F3F4F6';
  const gradient = blocks.map(seg => `${primary} ${seg.startPct}%, ${primary} ${seg.endPct}%`).join(', ');
  el.style.background = `linear-gradient(to right, ${bg} 0%, ${bg} 100%), linear-gradient(to right, ${gradient})`;
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

// --- Farm Registration System (admin-only) ---
class FarmWizard {
  constructor() {
    this.modal = $('#farmModal');
    this.form = $('#farmWizardForm');
    // Simplified admin-only steps
    this.steps = ['farm-name', 'locations', 'contact-name', 'contact-email', 'contact-phone', 'address', 'review'];
    this.currentStep = 0;
    this.data = {
      farmName: '',
      locations: [],
      contact: { name: '', email: '', phone: '' },
      address: ''
    };
    this.init();
  }

  init() {
    // Modal wiring
    $('#btnLaunchFarm')?.addEventListener('click', () => this.open());
    $('#farmModalClose')?.addEventListener('click', () => this.close());
    $('#farmModalBackdrop')?.addEventListener('click', () => this.close());

    // Navigation
    $('#farmPrev')?.addEventListener('click', () => this.prevStep());
    $('#farmNext')?.addEventListener('click', () => this.nextStep());
    $('#btnSaveFarm')?.addEventListener('click', (e) => this.saveFarm(e));

    // Locations
    $('#addFarmLocation')?.addEventListener('click', () => this.addLocation());
    $('#farmLocation')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.addLocation(); }
    });

    // Load existing farm if present
    this.loadExistingFarm();
  }

  async loadExistingFarm() {
    const farmData = await loadJSON('./data/farm.json');
    if (farmData) {
      STATE.farm = farmData;
      // copy known fields into local data for editing
      this.data.farmName = farmData.farmName || '';
      this.data.locations = farmData.locations || [];
      this.data.contact = farmData.contact || { name: '', email: '', phone: '' };
      this.data.address = farmData.address || '';
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
      badge.innerHTML = `<strong>${STATE.farm.farmName}</strong> • ${STATE.farm.locations?.[0] || ''} • ${STATE.farm.contact?.name || ''}`;
      launchBtn.style.display = 'none';
      editBtn.style.display = 'inline-block';
      editBtn.addEventListener('click', () => this.edit());
    }
  }

  open() {
    this.currentStep = 0;
    this.showStep(0);
    this.modal.setAttribute('aria-hidden', 'false');
    this.renderLocations();
  }

  edit() {
    // populate editor from STATE.farm
    this.data = {
      farmName: STATE.farm?.farmName || '',
      locations: STATE.farm?.locations || [],
      contact: STATE.farm?.contact || { name: '', email: '', phone: '' },
      address: STATE.farm?.address || ''
    };
    this.open();
  }

  close() { this.modal.setAttribute('aria-hidden', 'true'); }

  showStep(index) {
    document.querySelectorAll('.farm-step').forEach(step => step.removeAttribute('data-active'));
    const el = document.querySelector(`[data-step="${this.steps[index]}"]`);
    if (el) el.setAttribute('data-active', '');
    $('#farmModalProgress').textContent = `Step ${index+1} of ${this.steps.length}`;
    const prevBtn = $('#farmPrev'); const nextBtn = $('#farmNext'); const saveBtn = $('#btnSaveFarm');
    prevBtn.style.display = index === 0 ? 'none' : 'inline-block';
    if (index === this.steps.length - 1) { nextBtn.style.display = 'none'; saveBtn.style.display = 'inline-block'; this.updateReview(); }
    else { nextBtn.style.display = 'inline-block'; saveBtn.style.display = 'none'; }
    // populate inputs for the current step
    if (this.steps[index] === 'farm-name') { const elName = $('#farmName'); if (elName) elName.value = this.data.farmName || ''; }
    if (this.steps[index] === 'contact-name') { const el = $('#farmContact'); if (el) el.value = this.data.contact?.name || ''; }
    if (this.steps[index] === 'contact-email') { const el = $('#farmContactEmail'); if (el) el.value = this.data.contact?.email || ''; }
    if (this.steps[index] === 'contact-phone') { const el = $('#farmContactPhone'); if (el) el.value = this.data.contact?.phone || ''; }
    if (this.steps[index] === 'address') { const el = $('#farmAddress'); if (el) el.value = this.data.address || ''; }
  }

  nextStep() { if (this.validateCurrentStep()) { this.currentStep++; this.showStep(this.currentStep); } }
  prevStep() { this.currentStep = Math.max(0, this.currentStep - 1); this.showStep(this.currentStep); }

  validateCurrentStep() {
    const step = this.steps[this.currentStep];
    switch (step) {
      case 'farm-name': {
        const v = ($('#farmName')?.value || '').trim(); if (!v) { alert('Please enter a farm name'); return false; } this.data.farmName = v; break;
      }
      case 'locations': {
        if (!this.data.locations || this.data.locations.length === 0) { alert('Please add at least one location'); return false; } break;
      }
      case 'contact-name': {
        const v = ($('#farmContact')?.value || '').trim(); if (!v) { alert('Please enter a contact name'); return false; } this.data.contact.name = v; break;
      }
      case 'contact-email': {
        const v = ($('#farmContactEmail')?.value || '').trim(); if (!v || !v.includes('@')) { alert('Please enter a valid email'); return false; } this.data.contact.email = v; break;
      }
      case 'contact-phone': {
        const v = ($('#farmContactPhone')?.value || '').trim(); if (!v) { alert('Please enter a phone number'); return false; } this.data.contact.phone = v; break;
      }
      case 'address': {
        const v = ($('#farmAddress')?.value || '').trim(); if (!v) { alert('Please enter an address'); return false; } this.data.address = v; break;
      }
    }
    return true;
  }

  addLocation() {
    const input = $('#farmLocation'); if (!input) return; const location = input.value.trim();
    if (location && !this.data.locations.includes(location)) { this.data.locations.push(location); this.renderLocations(); input.value = ''; }
  }

  renderLocations() {
    const list = $('#farmLocationList'); if (!list) return;
    list.innerHTML = this.data.locations.map(location => `<li>${location} <button type="button" onclick="farmWizard.removeLocation('${location}')">×</button></li>`).join('');
  }

  removeLocation(location) { this.data.locations = this.data.locations.filter(l => l !== location); this.renderLocations(); }

  updateReview() {
    const review = $('#farmReview'); if (!review) return;
    review.innerHTML = `
      <div><strong>Farm Name:</strong> ${this.data.farmName}</div>
      <div><strong>Locations:</strong> ${this.data.locations.join(', ')}</div>
      <div><strong>Contact:</strong> ${this.data.contact.name}</div>
      <div><strong>Email:</strong> ${this.data.contact.email}</div>
      <div><strong>Phone:</strong> ${this.data.contact.phone}</div>
      <div><strong>Address:</strong> ${this.data.address || '—'}</div>
    `;
  }

  async saveFarm(e) {
    e.preventDefault();
    const farmData = {
      farmName: this.data.farmName,
      locations: this.data.locations,
      contact: this.data.contact,
      address: this.data.address,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      registered: new Date().toISOString()
    };
    STATE.farm = farmData;
    localStorage.setItem('gr.farm', JSON.stringify(farmData));
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

// --- Grow Room Wizard ---
class RoomWizard {
  constructor() {
    this.modal = $('#roomModal');
    this.form = $('#roomWizardForm');
    // equipment-first: capture control method before sensors
  this.steps = ['room-name','location','layout','fixtures','control','devices','sensors','energy','review'];
    this.currentStep = 0;
    this.data = {
      id: '',
      name: '',
      layout: { type: '', rows: 0, racks: 0, levels: 0 },
      fixtures: [],
      controlMethod: null,
      sensors: { categories: [] },
      energy: ''
    };
    this.init();
  }

  init() {
    $('#btnLaunchRoom')?.addEventListener('click', () => this.open());
    $('#roomModalClose')?.addEventListener('click', () => this.close());
    $('#roomModalBackdrop')?.addEventListener('click', () => this.close());
    $('#roomPrev')?.addEventListener('click', () => this.prevStep());
    $('#roomNext')?.addEventListener('click', () => this.nextStep());
    this.form?.addEventListener('submit', (e)=> this.saveRoom(e));

    // Chip groups
    const chipGroup = (sel, target, field) => {
      const host = $(sel); if (!host) return;
      host.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-option'); if (!btn) return;
        host.querySelectorAll('.chip-option').forEach(b=>b.removeAttribute('data-active'));
        btn.setAttribute('data-active','');
        target[field] = btn.dataset.value;
        if (field === 'type') this.data.layout.type = btn.dataset.value;
      });
    };
    chipGroup('#roomLayoutType', this.data.layout, 'type');
    chipGroup('#roomEnergy', this.data, 'energy');
    $('#roomRows')?.addEventListener('input', (e)=> this.data.layout.rows = Number(e.target.value||0));
    $('#roomRacks')?.addEventListener('input', (e)=> this.data.layout.racks = Number(e.target.value||0));
    $('#roomLevels')?.addEventListener('input', (e)=> this.data.layout.levels = Number(e.target.value||0));

    // Fixtures KB reuse
    const fSearch = $('#roomKbSearch');
    const fResults = $('#roomKbResults');
    const fSelected = $('#roomKbSelected');
    fSearch?.addEventListener('input', ()=> this.updateKbResults(fSearch.value.trim()));
    fResults?.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-action="add-kb"]'); if (!btn) return;
      const idx = Number(btn.dataset.idx||-1);
      const item = STATE.deviceKB.fixtures?.[idx]; if (!item) return;
      this.data.fixtures.push({ ...item, count: 1 });
      this.renderKbSelected();
      fResults.innerHTML = ''; fSearch.value='';
      // After adding fixtures, re-run inference
      this.inferSensors();
    });

    // Sensors
    $('#roomSensorCats')?.addEventListener('change', () => {
      const cats = Array.from(document.querySelectorAll('#roomSensorCats input[type="checkbox"]:checked')).map(i=>i.value);
      this.data.sensors.categories = cats;
    });

    // Devices management (for smart devices / hubs)
    $('#roomAddDeviceBtn')?.addEventListener('click', () => {
      const name = ($('#roomDeviceName')?.value || '').trim();
      const vendor = ($('#roomDeviceVendor')?.value || '').trim();
      const model = ($('#roomDeviceModel')?.value || '').trim();
      const host = ($('#roomDeviceHost')?.value || '').trim();
      if (!name) return alert('Enter a device name');
      // Collect setup subform values if present
      const setup = {};
      // WiFi
      if (document.getElementById('deviceSetup-wifi')?.style.display !== 'none') {
        const ssid = ($('#deviceWifiSsid')?.value || '').trim();
        const psk = ($('#deviceWifiPsk')?.value || '').trim();
        const useStatic = !!($('#deviceWifiStatic')?.checked);
        const staticIp = ($('#deviceWifiStaticIp')?.value || '').trim();
        if (ssid) setup.wifi = { ssid, psk: psk || null, useStatic, staticIp: staticIp || null };
      }
      // Bluetooth
      if (document.getElementById('deviceSetup-bluetooth')?.style.display !== 'none') {
        const btName = ($('#deviceBtName')?.value || '').trim();
        const btPin = ($('#deviceBtPin')?.value || '').trim();
        if (btName || btPin) setup.bluetooth = { name: btName || null, pin: btPin || null };
      }
      // RS-485
      if (document.getElementById('deviceSetup-rs485')?.style.display !== 'none') {
        const rsHost = ($('#deviceRs485Host')?.value || '').trim();
        const rsUnit = Number($('#deviceRs485UnitId')?.value || 0) || null;
        const rsBaud = ($('#deviceRs485Baud')?.value || '').trim() || null;
        if (rsHost || rsUnit) setup.rs485 = { host: rsHost || null, unitId: rsUnit, baud: rsBaud };
      }
      // 0-10V
      if (document.getElementById('deviceSetup-0-10v')?.style.display !== 'none') {
        const ch = ($('#device0v10Channel')?.value || '').trim();
        const scale = ($('#device0v10Scale')?.value || '').trim();
        if (ch || scale) setup['0-10v'] = { channel: ch || null, scale: scale || null };
      }

      this.data.devices = this.data.devices || [];
      this.data.devices.push({ name, vendor, model, host, setup });
      ($('#roomDeviceName')?.value) && ($('#roomDeviceName').value = '');
      ($('#roomDeviceVendor')?.value) && ($('#roomDeviceVendor').value = '');
      ($('#roomDeviceModel')?.value) && ($('#roomDeviceModel').value = '');
      ($('#roomDeviceHost')?.value) && ($('#roomDeviceHost').value = '');
      // Clear subforms
      ['deviceWifiSsid','deviceWifiPsk','deviceWifiStatic','deviceWifiStaticIp','deviceBtName','deviceBtPin','deviceRs485Host','deviceRs485UnitId','deviceRs485Baud','device0v10Channel','device0v10Scale'].forEach(id=>{ const el = document.getElementById(id); if(el) { if(el.type==='checkbox') el.checked=false; else el.value=''; } });
      this.renderDevicesList();
    });

    // Device list remove handler (delegated)
    const devList = $('#roomDevicesList');
    devList?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action="remove-device"]');
      if (!btn) return;
      const idx = Number(btn.dataset.idx);
      if (!Number.isNaN(idx) && this.data.devices && this.data.devices[idx]) {
        this.data.devices.splice(idx,1);
        this.renderDevicesList();
      }
    });

    // Toggle static IP input
    const wifiStatic = $('#deviceWifiStatic');
    wifiStatic?.addEventListener('change', (e)=>{
      const ip = $('#deviceWifiStaticIp'); if (!ip) return;
      ip.style.display = wifiStatic.checked ? 'inline-block' : 'none';
    });

    // When model select changes we also toggle relevant setup forms (safety: also do this on vendor change when model list is built)
    const modelSelect = $('#roomDeviceModel');
    modelSelect?.addEventListener('change', (e)=>{
      const modelName = e.target.value;
      const vendor = ($('#roomDeviceVendor')?.value||'');
      const man = DEVICE_MANUFACTURERS && DEVICE_MANUFACTURERS.find(x=>x.name===vendor);
      const md = man?.models?.find(m=>m.model===modelName);
      toggleSetupFormsForModel(md);
    });

    // Control method chips (buttons wired dynamically when showing control step)
  }

  open(room = null) {
    this.currentStep = 0;
    this.data = room ? JSON.parse(JSON.stringify(room)) : {
      id: '', name: '', location: '', layout: { type:'', rows:0, racks:0, levels:0 }, fixtures: [], controlMethod: null, devices: [], sensors:{ categories:[] }, energy:''
    };
    this.showStep(0);
    this.modal.setAttribute('aria-hidden','false');
    // Prefill lists
    this.renderKbSelected();
    this.populateLocationSelect();
    this.renderDevicesList();
  }

  close(){ this.modal.setAttribute('aria-hidden','true'); }

  showStep(index){
    document.querySelectorAll('.room-step').forEach(step => step.removeAttribute('data-active'));
    const el = document.querySelector(`.room-step[data-step="${this.steps[index]}"]`);
    if (el) el.setAttribute('data-active','');
    $('#roomModalProgress').textContent = `Step ${index+1} of ${this.steps.length}`;
    const prev = $('#roomPrev'); const next=$('#roomNext'); const save=$('#btnSaveRoom');
    prev.style.display = index===0 ? 'none':'inline-block';
    if (index === this.steps.length - 1) { next.style.display='none'; save.style.display='inline-block'; this.updateReview(); }
    else { next.style.display='inline-block'; save.style.display='none'; }

    // Step-specific behaviors
    const stepKey = this.steps[index];
    if (stepKey === 'control') {
      const container = document.getElementById('roomControlMethod');
      if (!container) return;
      container.querySelectorAll('.chip-option').forEach(b=>{
        b.classList.remove('active');
        if (this.data.controlMethod && b.dataset.value === this.data.controlMethod) b.classList.add('active');
        b.onclick = () => {
          const v = b.dataset.value;
          this.data.controlMethod = v;
          container.querySelectorAll('.chip-option').forEach(x=>x.classList.remove('active'));
          b.classList.add('active');
          document.getElementById('roomControlDetails').textContent = this.controlHintFor(v);
          // Re-run inference when control changes
            this.inferSensors();
            // If control method likely implies smart devices, ensure devices step available
            const smart = ['wifi','smart-plug','rs485','other'].includes(v);
            const devicesStepEl = document.querySelector('.room-step[data-step="devices"]');
            if (devicesStepEl) devicesStepEl.style.display = smart ? 'block' : 'none';
        };
      });
      // ensure hint shown for preselected
      if (this.data.controlMethod) document.getElementById('roomControlDetails').textContent = this.controlHintFor(this.data.controlMethod);
    }

    if (stepKey === 'sensors') {
      // pre-check any inferred sensors
      const container = document.getElementById('roomSensorCats');
      if (!container) return;
      container.querySelectorAll('input[type=checkbox]').forEach(cb=>{
        cb.checked = (this.data.sensors.categories||[]).includes(cb.value);
        cb.onchange = ()=>{
          this.data.sensors.categories = Array.from(container.querySelectorAll('input:checked')).map(i=>i.value);
        };
      });
    }
    // Show or hide devices step based on current controlMethod
    if (stepKey === 'devices') {
      const cm = this.data.controlMethod;
      const smart = ['wifi','smart-plug','rs485','other'].includes(cm);
      const devicesStepEl = document.querySelector('.room-step[data-step="devices"]');
      if (devicesStepEl) devicesStepEl.style.display = smart ? 'block' : 'none';
      this.renderDevicesList();
    }
  }

  nextStep(){ if (this.validateCurrentStep()) { this.currentStep++; this.showStep(this.currentStep); } }
  prevStep(){ this.currentStep = Math.max(0, this.currentStep-1); this.showStep(this.currentStep); }

  validateCurrentStep(){
    const step = this.steps[this.currentStep];
    switch(step){
      case 'room-name': {
        const v = ($('#roomName')?.value||'').trim(); if (!v) { alert('Enter a room name'); return false; }
        this.data.name = v; break; }
      case 'location': {
        const v = ($('#roomLocationSelect')?.value || '').trim(); if (!v) { alert('Select a location'); return false; }
        this.data.location = v; break;
      }
      case 'layout': {
        // no strict validation
        break; }
      case 'fixtures': {
        // optional
        break; }
      case 'control': {
        // require at least a choice of control method so we can infer sensors
        if (!this.data.controlMethod) { const ok = confirm('No control method selected. Continue without control info?'); if (!ok) return false; }
        break; }
      case 'devices': {
        // no strict validation; device list optional but preferred when smart control used
        break; }
    }
    return true;
  }

  updateKbResults(q){
    const host = $('#roomKbResults'); if (!host) return;
    host.innerHTML = '';
    if (!q) return;
    const fixtures = STATE.deviceKB.fixtures || [];
    const res = fixtures.map((it, idx)=>({it, idx}))
      .filter(({it})=>`${it.vendor} ${it.model}`.toLowerCase().includes(q.toLowerCase()));
    if (!res.length) { host.innerHTML = '<li class="tiny" style="color:#64748b">No matches in knowledge base.</li>'; return; }
    host.innerHTML = res.map(({it, idx})=>`<li><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><div>${it.vendor} <strong>${it.model}</strong> • ${it.watts} W • ${it.control || ''}</div><button type="button" class="ghost" data-action="add-kb" data-idx="${idx}">Add</button></div></li>`).join('');
  }

  renderKbSelected(){
    const ul = $('#roomKbSelected'); if (!ul) return;
    ul.innerHTML = (this.data.fixtures||[]).map((it, idx)=>`
      <li>
        <div class="row" style="align-items:center;gap:6px">
          <span>${it.vendor} <strong>${it.model}</strong> • ${it.watts} W</span>
          <label class="tiny">x <input type="number" min="1" value="${it.count||1}" style="width:64px" onchange="roomWizard.updateFixtureCount(${idx}, this.value)"></label>
          <button type="button" class="ghost" title="Remove" onclick="roomWizard.removeFixture(${idx})">×</button>
        </div>
      </li>
    `).join('');
  }

  renderDevicesList() {
    const ul = $('#roomDevicesList'); if (!ul) return;
    ul.innerHTML = (this.data.devices||[]).map((d, i) => `
      <li>
        <div class="row" style="align-items:center;gap:6px">
          <span>${d.name} ${d.vendor||''} ${d.model||''} ${d.host?`• ${d.host}`:''}</span>
          <button type="button" class="ghost" data-action="remove-device" data-idx="${i}">×</button>
        </div>
      </li>
    `).join('');
  }

  removeFixture(idx){ this.data.fixtures.splice(idx,1); this.renderKbSelected(); this.inferSensors(); }
  updateFixtureCount(idx, value){ const n=Math.max(1, Number(value||1)); if (this.data.fixtures[idx]) this.data.fixtures[idx].count=n; this.inferSensors(); }

  controlHintFor(v) {
    const map = {
      'wifi': 'Wi‑Fi/Cloud-controlled fixtures often expose energy and runtime telemetry; they may also report PPFD if integrated.',
      'smart-plug': 'Smart plugs give power/energy telemetry but typically do not provide PPFD or temperature readings.',
      '0-10v': '0‑10V wired control usually implies no integrated sensors; external PPFD or temp sensors are commonly used.',
      'rs485': 'RS‑485/Modbus fixtures or drivers may expose metering and diagnostics depending on vendor.',
      'other': 'Other control method — sensor availability depends on the specific device.'
    };
    return map[v] || '';
  }

  inferSensors(){
    // Simple heuristic: combine fixture-declared sensors and control-method hints
    const inferred = new Set();
    (this.data.fixtures||[]).forEach(f => {
      if (Array.isArray(f.sensors)) f.sensors.forEach(s=>inferred.add(s));
      // some KB entries may list capabilities in f.capabilities or f.control
      if (f.capabilities && Array.isArray(f.capabilities)) f.capabilities.forEach(s=>inferred.add(s));
      if (typeof f.control === 'string' && /meter|power|energy/i.test(f.control)) inferred.add('energy');
      if (typeof f.control === 'string' && /ppfd|light|par/i.test(f.control)) inferred.add('ppfd');
    });
    // control method mapping
    const cm = this.data.controlMethod;
    if (cm === 'smart-plug') inferred.add('energy');
    if (cm === 'wifi') inferred.add('energy');
    if (cm === 'rs485') inferred.add('energy');
    // 0-10v tends not to expose sensors directly

    // Normalize known category keys to match checkboxes: tempRh, co2, vpd, ppfd, energy
    // If fixture mentions temp or rh words, map to tempRh
    // already handled by sensors strings if present

    this.data.sensors.categories = Array.from(inferred);

    // Update UI checkboxes if sensors step present
    const container = document.getElementById('roomSensorCats');
    if (container) {
      container.querySelectorAll('input[type=checkbox]').forEach(cb=>{
        cb.checked = this.data.sensors.categories.includes(cb.value);
      });
    }
  }

  populateLocationSelect() {
    const sel = $('#roomLocationSelect'); if (!sel) return;
    sel.innerHTML = '<option value="">Select location...</option>' + (STATE.farm?.locations || []).map(l => `<option value="${l}">${l}</option>`).join('');
    // If editing an existing room with location, preselect
    if (this.data.location) sel.value = this.data.location;
  }

  updateReview(){
    const host = $('#roomReview'); if (!host) return;
    host.innerHTML = `
      <div><strong>Name:</strong> ${this.data.name}</div>
      <div><strong>Layout:</strong> ${this.data.layout.type || '—'} • rows ${this.data.layout.rows||0}, racks ${this.data.layout.racks||0}, levels ${this.data.layout.levels||0}</div>
      <div><strong>Fixtures:</strong> ${(this.data.fixtures||[]).map(f=>`${f.vendor} ${f.model} x${f.count||1}`).join(', ') || '—'}</div>
      <div><strong>Control method:</strong> ${this.data.controlMethod || '—'}</div>
      <div><strong>Sensors:</strong> ${(this.data.sensors.categories||[]).join(', ') || '—'}</div>
      <div><strong>Energy:</strong> ${this.data.energy || '—'}</div>
    `;
  }

  async saveRoom(e){
    e.preventDefault();
    // Assign id if new
    if (!this.data.id) this.data.id = `room-${Math.random().toString(36).slice(2,8)}`;
    // Upsert into STATE.rooms and persist
    const idx = STATE.rooms.findIndex(r => r.id === this.data.id);
    if (idx >= 0) STATE.rooms[idx] = { ...STATE.rooms[idx], ...this.data };
    else STATE.rooms.push({ ...this.data });
    const ok = await saveJSON('./data/rooms.json', { rooms: STATE.rooms });
    if (ok) {
      renderRooms();
      showToast({ title:'Room saved', msg:`${this.data.name} saved`, kind:'success', icon:'✅' });
      this.close();
    } else {
      alert('Failed to save room');
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
    const [groups, schedules, plans, environment, calibrations, deviceMeta, deviceKB, rooms] = await Promise.all([
      loadJSON('./data/groups.json'),
      loadJSON('./data/schedules.json'), 
      loadJSON('./data/plans.json'),
      api('/env'),
      loadJSON('./data/calibration.json'),
      loadJSON('./data/device-meta.json'),
      loadJSON('./data/device-kb.json'),
      loadJSON('./data/rooms.json')
    ]);
    
    STATE.groups = groups?.groups || [];
    STATE.schedules = schedules?.schedules || [];
    STATE.plans = plans?.plans || [];
  STATE.environment = environment?.zones || [];
    STATE.calibrations = calibrations?.calibrations || [];
  STATE.deviceMeta = deviceMeta?.devices || {};
  STATE.rooms = rooms?.rooms || [];
  if (deviceKB && Array.isArray(deviceKB.fixtures)) STATE.deviceKB = deviceKB;
    
    setStatus(`Loaded ${STATE.devices.length} devices, ${STATE.groups.length} groups, ${STATE.schedules.length} schedules`);
    
    // Render UI
    renderDevices();
    renderGroups();
    renderSchedules();
  renderEnvironment();
  renderPlans();
  renderRooms();
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

function renderRooms() {
  const host = $('#roomsList'); if (!host) return;
  if (!STATE.rooms.length) {
    host.innerHTML = '<p class="tiny" style="color:#64748b">No rooms yet. Create one to get started.</p>';
    return;
  }
  host.innerHTML = STATE.rooms.map(r => {
    const fixtures = (r.fixtures||[]).reduce((sum,f)=> sum + (Number(f.count)||0), 0);
    const sensors = (r.sensors?.categories||[]).join(', ') || '—';
    return `<div class="card" style="margin-top:8px">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div>
          <h3 style="margin:0">${r.name}</h3>
          <div class="tiny" style="color:#475569">Layout: ${r.layout?.type || '—'} • Fixtures: ${fixtures} • Control: ${r.controlMethod || '—'} • Sensors: ${sensors}</div>
        </div>
        <div class="row" style="gap:6px">
          <button type="button" class="ghost" onclick="roomWizard.open(${JSON.stringify(r).replace(/"/g,'&quot;')})">Edit</button>
        </div>
      </div>
    </div>`;
  }).join('');
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
    STATE.config = { singleServer: !!cfg?.singleServer, controller: cfg?.controller || '', envSource: cfg?.envSource || 'local', azureLatestUrl: cfg?.azureLatestUrl || null };
    const chip = document.getElementById('configChip');
    if (chip) {
      const mode = STATE.config.singleServer ? 'Local' : 'Controller';
      const envTag = STATE.config.envSource === 'azure' ? 'ENV: Azure' : 'ENV: Local';
      chip.textContent = `${mode} • ${envTag}`;
      const parts = [`Controller: ${STATE.config.controller || 'n/a'}`];
      if (STATE.config.envSource === 'azure' && STATE.config.azureLatestUrl) parts.push(`Azure: ${STATE.config.azureLatestUrl}`);
      chip.title = parts.join(' | ');
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
let roomWizard;

// Device manufacturers KB (loaded at startup)
let DEVICE_MANUFACTURERS = null;
async function loadDeviceManufacturers(){
  try {
    const j = await loadJSON('./data/device-manufacturers.json');
    DEVICE_MANUFACTURERS = (j && j.manufacturers) ? j.manufacturers : [];
    populateVendorSelect();
  } catch (err) {
    console.warn('Failed to load device manufacturers KB', err);
    DEVICE_MANUFACTURERS = [];
  }
}

function populateVendorSelect(){
  const sel = $('#roomDeviceVendor'); if (!sel) return;
  sel.innerHTML = '<option value="">Vendor</option>' + DEVICE_MANUFACTURERS.map(m=>`<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join('');
  sel.addEventListener('change', (e)=>{
    const name = e.target.value;
    const man = DEVICE_MANUFACTURERS.find(x=>x.name===name);
    const modelSel = $('#roomDeviceModel'); if (!modelSel) return;
    modelSel.innerHTML = '<option value="">Model</option>' + ((man?.models||[]).map(md=>`<option value="${escapeHtml(md.model)}" data-connectivity='${JSON.stringify(md.connectivity)}'>${escapeHtml(md.model)}</option>`).join(''));
  });
  const modelSel = $('#roomDeviceModel');
  modelSel?.addEventListener('change', (e)=>{
    const modelName = e.target.value;
    const vendor = ($('#roomDeviceVendor')?.value||'');
    const man = DEVICE_MANUFACTURERS.find(x=>x.name===vendor);
    const md = man?.models?.find(m=>m.model===modelName);
    if (md) {
      const nameInput = $('#roomDeviceName');
      if (nameInput && !nameInput.value) nameInput.value = `${md.model}`;
      const hostInput = $('#roomDeviceHost');
      if (hostInput) {
        const hint = (md.connectivity || []).includes('wifi') ? 'IP or MAC (if known)' : ((md.connectivity||[]).includes('zigbee') ? 'Zigbee hub / Bridge' : 'Host / IP / MAC (optional)');
        hostInput.placeholder = hint;
      }
    }
  });
}

function escapeHtml(s){ return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function toggleSetupFormsForModel(md){
  // md.connectivity is an array like ['wifi','zigbee']
  const has = (k)=> Array.isArray(md?.connectivity) && md.connectivity.includes(k);
  const wifiEl = document.getElementById('deviceSetup-wifi'); if (wifiEl) wifiEl.style.display = has('wifi') ? 'block' : 'none';
  const btEl = document.getElementById('deviceSetup-bluetooth'); if (btEl) btEl.style.display = has('bluetooth') ? 'block' : 'none';
  const rsEl = document.getElementById('deviceSetup-rs485'); if (rsEl) rsEl.style.display = has('rs485') ? 'block' : 'none';
  const v10El = document.getElementById('deviceSetup-0-10v'); if (v10El) v10El.style.display = has('0-10v') ? 'block' : 'none';
}

// --- Device Pairing Wizard (lightweight) ---
class DevicePairWizard {
  constructor() {
    this.modal = document.getElementById('devicePairModal');
    if (!this.modal) return;
    this.form = document.getElementById('devicePairForm');
    this.progress = document.getElementById('devicePairProgress');
    this.steps = Array.from(this.modal.querySelectorAll('.pair-step'));
    this.current = 0;
    this.onSave = null;

    this.nextBtn = document.getElementById('pairNext');
    this.prevBtn = document.getElementById('pairPrev');
    this.saveBtn = document.getElementById('pairSave');
    this.closeBtn = document.getElementById('devicePairClose');

    this.nextBtn?.addEventListener('click', () => this.next());
    this.prevBtn?.addEventListener('click', () => this.prev());
    this.closeBtn?.addEventListener('click', () => this.close());
    this.form?.addEventListener('submit', (ev) => { ev.preventDefault(); this.finish(); });

    const wifiStatic = document.getElementById('pairWifiStatic');
    wifiStatic?.addEventListener('change', (e) => {
      const ip = document.getElementById('pairWifiStaticIp'); if (ip) ip.style.display = e.target.checked ? 'block' : 'none';
    });
  }

  open(opts = {}) {
    if (!this.modal) return;
    this.current = 0; this.onSave = opts.onSave || null;
    if (opts.suggestedTransport) {
      const r = this.modal.querySelector(`input[name=pairTransport][value=${opts.suggestedTransport}]`);
      if (r) r.checked = true;
    }
    this.showStep(0);
    this.modal.style.display = 'block';
    this.modal.setAttribute('aria-hidden','false');
  }

  close() { if (!this.modal) return; this.modal.style.display = 'none'; this.modal.setAttribute('aria-hidden','true'); }

  showStep(i) {
    if (!this.steps) return;
    this.steps.forEach((s, idx) => s.style.display = idx === i ? 'block' : 'none');
    this.current = i;
    this.progress.textContent = `Step ${Math.min(i+1, this.steps.length)} of ${this.steps.length}`;
    this.prevBtn.style.display = i === 0 ? 'none' : 'inline-block';
    this.nextBtn.style.display = i === (this.steps.length - 1) ? 'none' : 'inline-block';
    this.saveBtn.style.display = i === (this.steps.length - 1) ? 'inline-block' : 'none';
    if (this.steps[i]?.dataset.step === 'review') this.updateReview();
  }

  next() { if (this.current < this.steps.length - 1) this.showStep(this.current + 1); }
  prev() { if (this.current > 0) this.showStep(this.current - 1); }

  collect() {
    const transport = this.modal.querySelector('input[name=pairTransport]:checked')?.value || 'wifi';
    if (transport === 'wifi') {
      const ssid = document.getElementById('pairWifiSsid')?.value.trim() || '';
      const psk = document.getElementById('pairWifiPsk')?.value || '';
      const isStatic = !!document.getElementById('pairWifiStatic')?.checked;
      const staticIp = document.getElementById('pairWifiStaticIp')?.value.trim() || '';
      const wifi = { ssid, psk, static: !!isStatic };
      if (isStatic && staticIp) wifi.staticIp = staticIp;
      return { wifi };
    }
    if (transport === 'bluetooth') {
      const name = document.getElementById('pairBtName')?.value.trim() || null;
      const pin = document.getElementById('pairBtPin')?.value.trim() || null;
      return { bluetooth: { name, pin } };
    }
    return {};
  }

  updateReview() {
    const cfg = this.collect();
    const el = document.getElementById('pairReview'); if (!el) return; el.innerHTML = '';
    Object.keys(cfg).forEach(k => { const pre = document.createElement('pre'); pre.style.margin='0'; pre.textContent = `${k}: ` + JSON.stringify(cfg[k], null, 2); el.appendChild(pre); });
  }

  finish() { const cfg = this.collect(); if (this.onSave) this.onSave(cfg); this.close(); }
}

const DEVICE_PAIR_WIZARD = new DevicePairWizard();

function findModelByValue(value) {
  if (!DEVICE_MANUFACTURERS) return null;
  for (const m of DEVICE_MANUFACTURERS) {
    const md = (m.models || []).find(x => x.id === value || x.model === value);
    if (md) return md;
  }
  return null;
}

function hookRoomDevicePairing(roomWizardInstance) {
  const addBtn = document.getElementById('roomAddDeviceBtn'); if (!addBtn) return;
  addBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    let suggested = 'wifi';
    const modelSel = document.getElementById('roomDeviceModel');
    if (modelSel && modelSel.value) {
      const md = findModelByValue(modelSel.value);
      if (md && md.connectivity && md.connectivity.includes('bluetooth')) suggested = 'bluetooth';
    }
    DEVICE_PAIR_WIZARD.open({ suggestedTransport: suggested, onSave: (setup) => {
      const name = document.getElementById('roomDeviceName')?.value.trim() || '';
      const vendor = document.getElementById('roomDeviceVendor')?.value || '';
      const model = document.getElementById('roomDeviceModel')?.value || '';
      const host = document.getElementById('roomDeviceHost')?.value.trim() || '';
      roomWizardInstance.data.devices = roomWizardInstance.data.devices || [];
      const device = { name: name || `${vendor} ${model}`, vendor, model, host, setup };
      roomWizardInstance.data.devices.push(device);
      roomWizardInstance.renderDevicesList();
    }});
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  wireHints();
  wireGlobalEvents();
  // Load runtime config and show chip
  await loadConfig();
  
  // Initialize farm wizard
  farmWizard = new FarmWizard();
  // Initialize room wizard
  roomWizard = new RoomWizard();
  // Wire pairing hook so Add Device opens the DevicePairWizard
  try { hookRoomDevicePairing(roomWizard); } catch (e) { console.warn('Failed to hook device pairing', e); }
  
  // Load all data
  await loadAllData();
  // Load device KB for vendor/model selects
  await loadDeviceManufacturers();
  // Apply saved branding if present
  try {
    const farmLocal = JSON.parse(localStorage.getItem('gr.farm') || 'null') || STATE.farm;
    const branding = farmLocal?.branding || STATE.farm?.branding;
    if (branding?.palette) applyTheme(branding.palette);
    const headerLogo = document.querySelector('.header.logo img');
    if (headerLogo && branding?.logo) { headerLogo.src = branding.logo; headerLogo.style.display = 'inline-block'; }
  } catch {}
  
  setStatus("Dashboard loaded");
});
