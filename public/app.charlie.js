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
  switchbotDevices: [],
  currentGroup: null,
  currentSchedule: null,
  researchMode: false,
  deviceResearchLocal: true,
  editingGroupId: null,
  deviceMeta: {},
  deviceKB: { fixtures: [] },
  config: { singleServer: true, controller: '' },
  branding: null,
  pendingBrand: null
};

// --- Research Mode Feature Flag ---
const RESEARCH_MODE_KEY = 'gr.researchMode';
const DEVICES_LOCAL_RESEARCH_KEY = 'gr.devices.localResearch';
const DEVICE_SCOPE_KEY = 'gr.deviceScope';
const DEVICE_SELECTION_KEY = 'gr.deviceSelection';
function getResearchMode() {
  const raw = localStorage.getItem(RESEARCH_MODE_KEY);
  return raw === 'true';
}
function setResearchMode(val) {
  localStorage.setItem(RESEARCH_MODE_KEY, val ? 'true' : 'false');
  STATE.researchMode = val;
}

function getDevicesLocalResearch() {
  const raw = localStorage.getItem(DEVICES_LOCAL_RESEARCH_KEY);
  return raw === null ? true : raw === 'true';
}
function setDevicesLocalResearch(val) {
  localStorage.setItem(DEVICES_LOCAL_RESEARCH_KEY, val ? 'true' : 'false');
  STATE.deviceResearchLocal = !!val;
}

// Persisted Devices picks (scope + selected ids)
function getDevicePickState() {
  try {
    const scope = localStorage.getItem(DEVICE_SCOPE_KEY) || 'devices';
    const ids = JSON.parse(localStorage.getItem(DEVICE_SELECTION_KEY) || '[]');
    return { scope, ids: Array.isArray(ids) ? ids : [] };
  } catch { return { scope: 'devices', ids: [] }; }
}
function setDevicePickState(scope, ids) {
  try {
    if (scope) localStorage.setItem(DEVICE_SCOPE_KEY, scope);
    if (ids) localStorage.setItem(DEVICE_SELECTION_KEY, JSON.stringify(ids));
  } catch {}
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

// Safe farm persistence: read existing farm.json, shallow-merge patch, then POST full doc back
async function safeFarmSave(farmPatch = {}) {
  try {
    const current = (await loadJSON('./data/farm.json')) || {};
    const merged = { ...current, ...farmPatch };
    const ok = await saveJSON('./data/farm.json', merged);
    if (ok) {
      STATE.farm = normalizeFarmDoc(merged);
      try { localStorage.setItem('gr.farm', JSON.stringify(STATE.farm)); } catch {}
    }
    return ok;
  } catch (err) {
    console.error('safeFarmSave error', err);
    return false;
  }
}

function normalizeFarmDoc(doc) {
  if (!doc) return {};
  const copy = { ...doc };
  const rawRooms = Array.isArray(copy.rooms)
    ? copy.rooms
    : (Array.isArray(copy.locations) ? copy.locations.map((name, idx) => ({ id: `room-${idx}`, name, zones: [] })) : []);
  copy.rooms = rawRooms.map((room, idx) => {
    if (typeof room === 'string') {
      return { id: `room-${idx}`, name: room, zones: [] };
    }
    return {
      id: room.id || `room-${idx}`,
      name: room.name || room.title || `Room ${idx + 1}`,
      zones: Array.isArray(room.zones) ? room.zones.slice() : []
    };
  });
  copy.locations = copy.rooms.map(r => r.name);
  return copy;
}

// Safe rooms persistence: read existing rooms.json, merge the room by id, then POST the full file back.
async function safeRoomsSave(room) {
  try {
    // Read the current file from the server
    const current = await loadJSON('./data/rooms.json') || { rooms: [] };
    const rooms = Array.isArray(current.rooms) ? current.rooms.slice() : [];
    const idx = rooms.findIndex(r => r.id === room.id);
    if (idx >= 0) rooms[idx] = { ...rooms[idx], ...room };
    else rooms.push(room);
    const payload = { rooms };
    const ok = await saveJSON('./data/rooms.json', payload);
    if (!ok) {
      console.error('safeRoomsSave: failed to POST merged rooms.json');
      return false;
    }
    // Update local STATE to reflect authoritative copy
    STATE.rooms = rooms;
    return true;
  } catch (err) {
    console.error('safeRoomsSave error', err);
    return false;
  }
}

// Safe rooms delete: read existing rooms.json, remove by id, then POST the full file back.
async function safeRoomsDelete(roomId) {
  try {
    const current = await loadJSON('./data/rooms.json') || { rooms: [] };
    const before = Array.isArray(current.rooms) ? current.rooms : [];
    const after = before.filter(r => String(r.id) !== String(roomId));
    const payload = { rooms: after };
    const ok = await saveJSON('./data/rooms.json', payload);
    if (!ok) {
      console.error('safeRoomsDelete: failed to POST merged rooms.json');
      return false;
    }
    STATE.rooms = after;
    return true;
  } catch (err) {
    console.error('safeRoomsDelete error', err);
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
function applyTheme(palette, extras = {}) {
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
  // Derive hover/active shades from primary and set brand font if provided
  try {
    const basePrimary = palette.primary || getComputedStyle(root).getPropertyValue('--gr-primary').trim() || '#0D7D7D';
    const toRgb = (h)=>{ h=(h||'').toString().replace('#',''); if(h.length===3) h=h.split('').map(ch=>ch+ch).join(''); const r=parseInt(h.slice(0,2)||'00',16), g=parseInt(h.slice(2,4)||'00',16), b=parseInt(h.slice(4,6)||'00',16); return { r, g, b }; };
    const darken = (hex, t=0.08) => { const {r,g,b} = toRgb(hex); const mix = (c)=> Math.max(0, Math.min(255, Math.round(c*(1-t)))); const toHex = (v)=> v.toString(16).padStart(2,'0'); return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`; };
    const mixWith = (hex, other = '#ffffff', t = 0.85) => { // t=0..1 fraction of other
      const a = toRgb(hex), b = toRgb(other);
      const m = (x,y)=> Math.max(0, Math.min(255, Math.round(x*(1-t) + y*t)));
      const toHex = (v)=> v.toString(16).padStart(2,'0');
      return `#${toHex(m(a.r,b.r))}${toHex(m(a.g,b.g))}${toHex(m(a.b,b.b))}`;
    };
    root.style.setProperty('--gr-primary-hover', darken(basePrimary, 0.06));
    root.style.setProperty('--gr-primary-active', darken(basePrimary, 0.12));
    // Soft variants for backgrounds/chips
    const baseAccent = palette.accent || getComputedStyle(root).getPropertyValue('--gr-accent').trim() || '#64C7C7';
    root.style.setProperty('--gr-primary-soft', mixWith(palette.primary || basePrimary, '#ffffff', 0.86));
    root.style.setProperty('--gr-accent-soft', mixWith(baseAccent, '#ffffff', 0.88));
  } catch {}
  if (extras.fontFamily) {
    root.style.setProperty('--gr-font', extras.fontFamily);
  }
  if (extras.logoHeight) {
    root.style.setProperty('--gr-logo-height', typeof extras.logoHeight === 'number' ? `${extras.logoHeight}px` : String(extras.logoHeight));
  }
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
      // Attempt auto-fix by nudging text towards a better contrast color
      const candidates = ['#0B1220', '#111827', '#FFFFFF'];
      let best = cText; let bestScore = Math.min(tVsSurface, tVsBg);
      for (const cand of candidates) {
        const sc = Math.min(contrast(ratio(cand), ratio(cSurface)), contrast(ratio(cand), ratio(cBg)));
        if (sc > bestScore) { bestScore = sc; best = cand; }
      }
      if (best !== cText) { root.style.setProperty('--gr-text', best); }
      if (bestScore < 4.5) {
        showToast({ title:'Low contrast warning', msg:'Some text may be hard to read with the current theme. Consider adjusting Text/Background colors.', kind:'warn', icon:'\u26a0\ufe0f' }, 6000);
      }
    }
  } catch {}
}

// Default theme palette used for reset and initial state
const DEFAULT_PALETTE = {
  primary: '#0D7D7D',
  accent: '#64C7C7',
  text: '#0B1220',
  surface: '#FFFFFF',
  background: '#F7FAFA',
  border: '#DCE5E5'
};

// --- Branding helpers: color sampling and soft palette derivation ---
function toHexColor(input) {
  try {
    if (!input) return null;
    if (typeof input === 'string' && input.startsWith('#')) {
      const h = input.length === 4 ? `#${input[1]}${input[1]}${input[2]}${input[2]}${input[3]}${input[3]}` : input;
      return h.toUpperCase();
    }
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = input; const v = ctx.fillStyle; // resolves named/rgba
    return v && v.startsWith('#') ? v.toUpperCase() : null;
  } catch { return null; }
}

function hexToRgb(hex){
  if (!hex) return null; const h = hex.replace('#','');
  const hh = h.length===3 ? h.split('').map(c=>c+c).join('') : h;
  const r = parseInt(hh.slice(0,2),16), g = parseInt(hh.slice(2,4),16), b = parseInt(hh.slice(4,6),16);
  return { r, g, b };
}

function rgbToHex(r,g,b){
  const to = (v)=> Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2,'0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

function mixHex(a, b = '#FFFFFF', t = 0.85) {
  const A = hexToRgb(toHexColor(a)||'#000000'); const B = hexToRgb(toHexColor(b)||'#FFFFFF');
  const m = (x,y)=> x*(1-t) + y*t; return rgbToHex(m(A.r,B.r), m(A.g,B.g), m(A.b,B.b));
}

function relativeLuminance(hex) {
  const rgb = hexToRgb(hex); if (!rgb) return 0;
  const l = (v)=> { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
  return 0.2126*l(rgb.r)+0.7152*l(rgb.g)+0.0722*l(rgb.b);
}
function contrastRatio(a,b){
  const L1 = relativeLuminance(a), L2 = relativeLuminance(b);
  const [hi,lo] = L1>L2?[L1,L2]:[L2,L1]; return (hi+0.05)/(lo+0.05);
}

async function extractDominantColorFromImage(url, sample = 5) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const w = img.naturalWidth, h = img.naturalHeight;
          const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0);
          const data = ctx.getImageData(0,0,w,h).data;
          // Skip fully transparent/near-white/near-black pixels; simple grid sampling
          const stepX = Math.max(1, Math.floor(w / (10*sample)));
          const stepY = Math.max(1, Math.floor(h / (10*sample)));
          const accum = {};
          for (let y=0; y<h; y+=stepY) {
            for (let x=0; x<w; x+=stepX) {
              const i = (y*w + x) * 4;
              const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
              if (a < 200) continue; // ignore transparent
              // ignore near-white/near-black to avoid BG/transparent PNG edges
              const max = Math.max(r,g,b), min = Math.min(r,g,b);
              if (max > 245 || min < 10) continue;
              const key = `${Math.round(r/8)*8},${Math.round(g/8)*8},${Math.round(b/8)*8}`;
              accum[key] = (accum[key]||0) + 1;
            }
          }
          const top = Object.entries(accum).sort((a,b)=>b[1]-a[1])[0];
          if (top) {
            const [rr,gg,bb] = top[0].split(',').map(Number);
            resolve(rgbToHex(rr,gg,bb));
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    } catch { resolve(null); }
  });
}

function deriveSoftPalette(base) {
  const primary = toHexColor(base.primary) || DEFAULT_PALETTE.primary;
  const accent = toHexColor(base.accent) || DEFAULT_PALETTE.accent;
  return {
    primarySoft: mixHex(primary, '#FFFFFF', 0.86),
    accentSoft: mixHex(accent, '#FFFFFF', 0.88)
  };
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
  const fmt = (on, off) => {
    const durH = (computeCycleDuration(on, off) / 60);
    const h = durH % 1 === 0 ? `${durH|0}h` : `${durH.toFixed(1)}h`;
    return `${on} · ${h}`;
  };
  if (s.mode === 'two' && s.cycles?.length >= 2) {
    const a = s.cycles[0];
    const b = s.cycles[1];
    return `2C · A: ${fmt(a.on, a.off)} | B: ${fmt(b.on, b.off)}`;
  }
  if (s.cycles?.length) {
    const c = s.cycles[0];
    return `1C · Start ${fmt(c.on, c.off)}`;
  }
  return 'No schedule';
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
  if (device.nominalW || device.maxW || device.wattage) return device.nominalW || device.maxW || device.wattage;
  // Fallback to device-meta if available
  try {
    const meta = getDeviceMeta(device.id);
    if (meta && (meta.watts || meta.nominalW)) return meta.watts || meta.nominalW;
  } catch {}
  return 240;
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
  // Default device registry fields plus spectrum configuration
  return STATE.deviceMeta?.[id] || {
    farm: STATE.farm?.farmName || '',
    room: '', zone: '', module: '', level: '', side: '',
    spectrumMode: 'dynamic', // 'dynamic' | 'static'
    factorySpectrum: { cw: 45, ww: 45, bl: 0, rd: 0, fr: 0, uv: 0 }
  };
}
function setDeviceMeta(id, meta) {
  STATE.deviceMeta[id] = { ...getDeviceMeta(id), ...meta };
}
async function saveDeviceMeta() {
  const ok = await saveJSON('./data/device-meta.json', { devices: STATE.deviceMeta });
  if (ok) setStatus('Device locations saved'); else alert('Failed to save device locations');
}

// Build a minimal stub device when no live device data is available (demo mode)
function buildStubDevice(id) {
  const suffix = (id || '').split('-').pop()?.toUpperCase() || (id || '');
  return {
    id,
    deviceName: /^light-/i.test(id) ? `Light ${suffix}` : id,
    type: 'light',
    onOffStatus: true,
    online: true,
    cwPct: 45, wwPct: 45, blPct: 0, rdPct: 0,
    nominalW: 240,
    stats: { measured: false }
  };
}

function deviceCard(device, options = {}) {
  const card = document.createElement('div');
  card.className = 'card device-card';
  card.dataset.deviceId = device.id;

  // Compact Light Card: minimal at-a-glance info (Name, Location, Spectrum Mode, Wattage, Connectivity)
  if (options.compact) {
    // Header with status and name
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
    const onlineBadge = document.createElement('span');
    onlineBadge.className = 'device-online';
    onlineBadge.textContent = device.online ? 'Online' : 'Offline';
    header.append(titleWrap, onlineBadge);
    card.appendChild(header);

    // Location line
    const loc = getDeviceMeta(device.id);
    const locRow = document.createElement('div');
    locRow.className = 'tiny';
    locRow.style.color = '#475569';
    locRow.textContent = [loc.room||'—', loc.zone||'—'].filter(Boolean).join(' / ') || '—';
    card.appendChild(locRow);

    // Spectrum Mode chip (prefer device channels; fall back to meta.spectrumMode)
    const metaInit = getDeviceMeta(device.id) || {};
    let isDynamic = ['cwPct','wwPct','blPct','rdPct'].some(k => device[k] !== undefined);
    if (!isDynamic) {
      try { isDynamic = String(metaInit.spectrumMode||'').toLowerCase()==='dynamic'; } catch {}
    }
    const modeChip = document.createElement('span');
    modeChip.className = 'chip tiny';
    modeChip.textContent = isDynamic ? 'Dynamic' : 'Static';
    modeChip.title = isDynamic ? 'Spectrum driven by device/driver mix (can vary)' : 'Fixed spectrum ratios';

    // Wattage chip (prefer measured trend, fallback to nominal)
    const wattSeries = getWattSeries(device, 6);
    const curW = wattSeries.length ? wattSeries[wattSeries.length - 1] : getNominalWatts(device);
    const hasMeasured = Array.isArray(device.stats?.watts) || Array.isArray(device.stats?.power) || Array.isArray(device.stats?.powerW);
    const wattChip = document.createElement('span');
    wattChip.className = 'chip tiny';
    wattChip.textContent = hasMeasured ? `≈ ${Math.round(curW)} W` : `Rated ${Math.round(getNominalWatts(device))} W`;
    wattChip.title = hasMeasured ? 'Approximate current draw' : 'Nameplate/rated wattage';

    // Connectivity chip (infer from hints)
    const inferConnectivity = (d) => {
      const t = (d.transport || d.conn || '').toString().toLowerCase();
      if (t.includes('wifi')) return 'Wi‑Fi';
      if (t.includes('ble') || t.includes('bluetooth')) return 'BLE';
      if (t.includes('rs485')) return 'Wired';
      if (t.includes('0-10')) return 'Wired (0–10 V)';
      if (d.host || d.ip) return 'Wi‑Fi';
      if (/switchbot|kasa|tp-link|tuya/i.test(d.vendor||d.deviceName||'')) return 'Smart Hub';
      if (d.rs485UnitId || d.gateway) return 'Wired';
      return '—';
    };
    const connChip = document.createElement('span');
    connChip.className = 'chip tiny';
    // Merge meta to improve inference (e.g., transport: 'wifi')
    try {
      const meta = getDeviceMeta(device.id) || {};
      connChip.textContent = inferConnectivity({ ...device, ...meta });
    } catch {
      connChip.textContent = inferConnectivity(device);
    }
    connChip.title = 'Connectivity';

    const chipRow = document.createElement('div');
    chipRow.className = 'row';
    chipRow.style.gap = '6px';
    chipRow.style.marginTop = '6px';
    chipRow.append(modeChip, wattChip, connChip);
    card.appendChild(chipRow);

    // Spectrum bar preview (compact)
    const spectrumWrap = document.createElement('div');
    spectrumWrap.className = 'device-spectrum';
    const spectrumCanvas = document.createElement('canvas');
    spectrumCanvas.className = 'device-spectrum__canvas';
    spectrumWrap.appendChild(spectrumCanvas);
    const meta = metaInit; // reuse
    // Choose percentages: dynamic from device fields; static from meta.factorySpectrum
    const pct = isDynamic
      ? {
          cw: device.cwPct ?? device.cw ?? 45,
          ww: device.wwPct ?? device.ww ?? 45,
          bl: device.blPct ?? device.bl ?? 0,
          rd: device.rdPct ?? device.rd ?? 0
        }
      : {
          cw: Number(meta.factorySpectrum?.cw ?? 45),
          ww: Number(meta.factorySpectrum?.ww ?? 45),
          bl: Number(meta.factorySpectrum?.bl ?? 0),
          rd: Number(meta.factorySpectrum?.rd ?? 0)
        };
    const spd = computeWeightedSPD(pct);
    renderSpectrumCanvas(spectrumCanvas, spd, { width: 300, height: 36 });
    spectrumWrap.setAttribute('data-tip', isDynamic ? 'Dynamic spectrum preview (driver mix)' : 'Static spectrum preview (factory)');
    spectrumWrap.classList.add('hint');
    card.appendChild(spectrumWrap);

    // Inline editor for spectrum mode + static spectrum (hidden behind an Edit link)
    const advRow = document.createElement('div');
    advRow.className = 'row tiny';
    advRow.style.gap = '8px';
    const editBtn = document.createElement('button');
    editBtn.type = 'button'; editBtn.className = 'ghost'; editBtn.textContent = 'Spectrum…';
    advRow.appendChild(editBtn);
    card.appendChild(advRow);

    const editor = document.createElement('div');
    editor.className = 'row tiny';
    editor.style.display = 'none';
    editor.style.flexWrap = 'wrap';
    editor.style.gap = '6px';
    editor.innerHTML = `
      <label>Mode
        <select class="dev-mode">
          <option value="dynamic">Dynamic</option>
          <option value="static">Static</option>
        </select>
      </label>
      <label>CW <input class="dev-cw" type="number" min="0" max="100" step="1" style="width:64px"></label>
      <label>WW <input class="dev-ww" type="number" min="0" max="100" step="1" style="width:64px"></label>
      <label>Blue <input class="dev-bl" type="number" min="0" max="100" step="1" style="width:64px"></label>
      <label>Red <input class="dev-rd" type="number" min="0" max="100" step="1" style="width:64px"></label>
      <button type="button" class="primary dev-save">Save</button>
      <button type="button" class="ghost dev-cancel">Cancel</button>
    `;
    card.appendChild(editor);
    // Seed editor values from meta
    const modeSel = editor.querySelector('select.dev-mode');
    const cwI = editor.querySelector('input.dev-cw');
    const wwI = editor.querySelector('input.dev-ww');
    const blI = editor.querySelector('input.dev-bl');
    const rdI = editor.querySelector('input.dev-rd');
    const seed = () => {
      try {
        if (modeSel) modeSel.value = String(meta.spectrumMode || 'dynamic');
        if (cwI) cwI.value = String(meta.factorySpectrum?.cw ?? 45);
        if (wwI) wwI.value = String(meta.factorySpectrum?.ww ?? 45);
        if (blI) blI.value = String(meta.factorySpectrum?.bl ?? 0);
        if (rdI) rdI.value = String(meta.factorySpectrum?.rd ?? 0);
      } catch {}
    };
    seed();
    editBtn.addEventListener('click', () => {
      editor.style.display = editor.style.display === 'none' ? 'flex' : 'none';
      if (editor.style.display !== 'none') seed();
    });
    editor.querySelector('.dev-cancel')?.addEventListener('click', () => { editor.style.display = 'none'; });
    editor.querySelector('.dev-save')?.addEventListener('click', async () => {
      const mode = modeSel?.value || 'dynamic';
      const newSpec = {
        cw: Math.max(0, Math.min(100, Number(cwI?.value || 45))),
        ww: Math.max(0, Math.min(100, Number(wwI?.value || 45))),
        bl: Math.max(0, Math.min(100, Number(blI?.value || 0))),
        rd: Math.max(0, Math.min(100, Number(rdI?.value || 0))),
        fr: Number(meta.factorySpectrum?.fr || 0),
        uv: Number(meta.factorySpectrum?.uv || 0)
      };
      setDeviceMeta(device.id, { spectrumMode: mode, factorySpectrum: newSpec });
      const ok = await saveDeviceMeta();
      if (ok !== false) {
        modeChip.textContent = mode === 'dynamic' ? 'Dynamic' : 'Static';
        // Redraw preview using chosen mode
        const dyn = mode === 'dynamic' || ['cwPct','wwPct','blPct','rdPct'].some(k => device[k] !== undefined);
        const pct2 = dyn ? {
          cw: device.cwPct ?? device.cw ?? 45,
          ww: device.wwPct ?? device.ww ?? 45,
          bl: device.blPct ?? device.bl ?? 0,
          rd: device.rdPct ?? device.rd ?? 0
        } : newSpec;
        renderSpectrumCanvas(spectrumCanvas, computeWeightedSPD(pct2), { width: 300, height: 36 });
        editor.style.display = 'none';
        setStatus('Device spectrum settings saved');
      }
    });

    // Research Mode Controls (similar to group controls)
    if (STATE.researchMode && STATE.deviceResearchLocal) {
      // Power controls
      const powerRow = document.createElement('div');
      powerRow.className = 'row';
      powerRow.style.gap = '6px';
      powerRow.style.marginTop = '8px';
      
      const onBtn = document.createElement('button');
      onBtn.type = 'button';
      onBtn.className = 'ghost';
      onBtn.textContent = 'ON';
      onBtn.style.fontSize = '12px';
      onBtn.style.padding = '4px 8px';
      
      const offBtn = document.createElement('button');
      offBtn.type = 'button';
      offBtn.className = 'ghost';
      offBtn.textContent = 'OFF';
      offBtn.style.fontSize = '12px';
      offBtn.style.padding = '4px 8px';

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'primary';
      applyBtn.textContent = 'Apply';
      applyBtn.style.fontSize = '12px';
      applyBtn.style.padding = '4px 8px';
      
      powerRow.append(onBtn, offBtn, applyBtn);
      card.appendChild(powerRow);

      // Spectrum sliders for research mode
      const spectrumControls = document.createElement('div');
      spectrumControls.className = 'device-research-controls';
      spectrumControls.style.display = 'none';
      spectrumControls.style.marginTop = '8px';
      spectrumControls.innerHTML = `
        <div class="tiny" style="margin-bottom:4px">Live Spectrum Control</div>
        <div style="display:grid;grid-template-columns:auto 1fr auto;gap:4px;align-items:center;font-size:11px">
          <span>CW</span><input class="dev-cw-live" type="range" min="0" max="100" value="${device.cwPct ?? device.cw ?? 45}" style="margin:0"><span class="dev-cw-val">${Math.round(device.cwPct ?? device.cw ?? 45)}%</span>
          <span>WW</span><input class="dev-ww-live" type="range" min="0" max="100" value="${device.wwPct ?? device.ww ?? 45}" style="margin:0"><span class="dev-ww-val">${Math.round(device.wwPct ?? device.ww ?? 45)}%</span>
          <span>Blue</span><input class="dev-bl-live" type="range" min="0" max="100" value="${device.blPct ?? device.bl ?? 0}" style="margin:0"><span class="dev-bl-val">${Math.round(device.blPct ?? device.bl ?? 0)}%</span>
          <span>Red</span><input class="dev-rd-live" type="range" min="0" max="100" value="${device.rdPct ?? device.rd ?? 0}" style="margin:0"><span class="dev-rd-val">${Math.round(device.rdPct ?? device.rd ?? 0)}%</span>
        </div>
      `;
      card.appendChild(spectrumControls);

      // Toggle spectrum controls with edit button
      editBtn.addEventListener('click', () => {
        const isVisible = spectrumControls.style.display !== 'none';
        spectrumControls.style.display = isVisible ? 'none' : 'block';
        editor.style.display = 'none'; // Hide the old editor
      });

      // Live spectrum control event handlers
      const cwSlider = spectrumControls.querySelector('.dev-cw-live');
      const wwSlider = spectrumControls.querySelector('.dev-ww-live');
      const blSlider = spectrumControls.querySelector('.dev-bl-live');
      const rdSlider = spectrumControls.querySelector('.dev-rd-live');
      const cwVal = spectrumControls.querySelector('.dev-cw-val');
      const wwVal = spectrumControls.querySelector('.dev-ww-val');
      const blVal = spectrumControls.querySelector('.dev-bl-val');
      const rdVal = spectrumControls.querySelector('.dev-rd-val');

      [cwSlider, wwSlider, blSlider, rdSlider].forEach((slider, idx) => {
        const valSpan = [cwVal, wwVal, blVal, rdVal][idx];
        slider?.addEventListener('input', () => {
          if (valSpan) valSpan.textContent = `${slider.value}%`;
          // Update spectrum preview
          const pct = {
            cw: Number(cwSlider?.value || 45),
            ww: Number(wwSlider?.value || 45),
            bl: Number(blSlider?.value || 0),
            rd: Number(rdSlider?.value || 0)
          };
          renderSpectrumCanvas(spectrumCanvas, computeWeightedSPD(pct), { width: 300, height: 36 });
        });
      });

      // Power control handlers
      onBtn.addEventListener('click', async () => {
        try {
          const resp = await fetch(`/api/device/${encodeURIComponent(device.id)}/power`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: 'on' })
          });
          if (resp.ok) {
            setStatus(`${device.deviceName || device.id} turned ON`);
          } else {
            setStatus(`Failed to turn ON ${device.deviceName || device.id}`);
          }
        } catch (err) {
          setStatus(`Error controlling ${device.deviceName || device.id}`);
        }
      });

      offBtn.addEventListener('click', async () => {
        try {
          const resp = await fetch(`/api/device/${encodeURIComponent(device.id)}/power`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: 'off' })
          });
          if (resp.ok) {
            setStatus(`${device.deviceName || device.id} turned OFF`);
          } else {
            setStatus(`Failed to turn OFF ${device.deviceName || device.id}`);
          }
        } catch (err) {
          setStatus(`Error controlling ${device.deviceName || device.id}`);
        }
      });

      applyBtn.addEventListener('click', async () => {
        try {
          const pct = {
            cw: Number(cwSlider?.value || 45),
            ww: Number(wwSlider?.value || 45),
            bl: Number(blSlider?.value || 0),
            rd: Number(rdSlider?.value || 0)
          };
          const resp = await fetch(`/api/device/${encodeURIComponent(device.id)}/spectrum`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pct)
          });
          if (resp.ok) {
            setStatus(`Spectrum applied to ${device.deviceName || device.id}`);
          } else {
            setStatus(`Failed to apply spectrum to ${device.deviceName || device.id}`);
          }
        } catch (err) {
          setStatus(`Error applying spectrum to ${device.deviceName || device.id}`);
        }
      });
    }

    return card;
  }

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
  // Apply Now button only (plans/schedules managed in Groups)
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
    // Also patch server DB (best-effort)
    await patchDeviceDb(device.id, { room: roomI.value.trim(), zone: zoneI.value.trim(), module: moduleI.value.trim(), level: levelI.value.trim(), side: sideI.value.trim() });
    locText.textContent = [roomI.value||'—', zoneI.value||'—', moduleI.value||'—', levelI.value||'—', sideI.value||'—'].join(' · ');
    locForm.style.display = 'none';
  });

  // Spectrum bar (physics-based SPD) + channel breakdown
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
  // Channel percentages
  const chRow = document.createElement('div');
  chRow.className = 'row tiny';
  const mkChip = (label, val, color) => {
    const s = document.createElement('span');
    s.className = 'chip';
    s.style.background = color; s.style.color = '#0f172a';
    s.textContent = `${label} ${Math.round(val)}%`;
    return s;
  };
  chRow.append(
    mkChip('CW', pct.cw, 'var(--channel-cw)'),
    mkChip('WW', pct.ww, 'var(--channel-ww)'),
    mkChip('Blue', pct.bl, 'var(--channel-bl)'),
    mkChip('Red', pct.rd, 'var(--channel-rd)')
  );
  spectrumWrap.appendChild(chRow);
  card.appendChild(spectrumWrap);

  // Research Mode conditional rendering (respect global + local toggles)
  if (!STATE.researchMode || !STATE.deviceResearchLocal) { badgeRow.style.display = 'none'; }

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

  // Context line: Room/Zone, last calibration, provenance
  const ctx = document.createElement('div');
  ctx.className = 'tiny';
  const meta = getDeviceMeta(device.id);
  const lastCal = (STATE.calibrations || []).filter(c => c.applied && (c.location ? (c.location === meta.room) : (c.gains && c.gains[device.id]))).sort((a,b)=> (b.timestamp||'').localeCompare(a.timestamp||''))[0];
  const prov = device.stats?.measured ? 'Measured power' : 'Estimated power';
  ctx.textContent = `${meta.room || '—'} / ${meta.zone || '—'} • ${lastCal ? `Cal: ${new Date(lastCal.timestamp).toLocaleDateString()}` : 'Cal: —'} • ${prov}`;
  card.appendChild(ctx);

  return card;
}

// --- Field error helpers ---
function setFieldError(fieldId, msg) {
  try {
    const el = document.getElementById(fieldId);
    if (el) el.classList.add('invalid');
    const node = document.getElementById('err-' + fieldId);
    if (node) { node.textContent = msg || ''; node.style.display = msg ? 'block' : 'none'; }
  } catch (e) { /* ignore */ }
}
function clearFieldError(fieldId) {
  try {
    const el = document.getElementById(fieldId);
    if (el) el.classList.remove('invalid');
    const node = document.getElementById('err-' + fieldId);
    if (node) { node.textContent = ''; node.style.display = 'none'; }
  } catch (e) { /* ignore */ }
}


// --- Farm Registration System (admin-only) ---
class FarmWizard {
  constructor() {
    this.modal = $('#farmModal');
    this.form = $('#farmWizardForm');
    this.progressEl = $('#farmModalProgress');
    this.titleEl = $('#farmModalTitle');
    this.currentStep = 0;
    this.baseSteps = ['connection-choice', 'wifi-select', 'wifi-password', 'wifi-test', 'location', 'contact', 'spaces', 'review'];
    this.wifiNetworks = [];
    this.data = this.defaultData();
    this.discoveryStorageKeys = {
      reuse: 'gr.discovery.useSameNetwork',
      subnet: 'gr.discovery.subnet',
      gateway: 'gr.discovery.gateway',
      ssid: 'gr.discovery.ssid'
    };
    this.init();
  }

  defaultData() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    const reuse = this.readDiscoveryPreference();
    return {
      connection: {
        type: 'wifi',
        wifi: {
          ssid: '',
          password: '',
          reuseDiscovery: reuse,
          tested: false,
          testResult: null
        }
      },
      location: {
        farmName: '',
        address: '',
        city: '',
        state: '',
        postal: '',
        timezone: tz
      },
      contact: {
        name: '',
        email: '',
        phone: '',
        website: ''
      },
      rooms: []
    };
  }

  readDiscoveryPreference() {
    try {
      const raw = localStorage.getItem(this.discoveryStorageKeys.reuse);
      return raw === null ? true : raw === 'true';
    } catch { return true; }
  }

  init() {
    $('#btnLaunchFarm')?.addEventListener('click', () => { this.data = this.defaultData(); this.open(); });
    $('#btnEditFarm')?.addEventListener('click', () => this.edit());
    $('#farmModalClose')?.addEventListener('click', () => this.close());
    $('#farmModalBackdrop')?.addEventListener('click', () => this.close());
    $('#farmPrev')?.addEventListener('click', () => this.prevStep());
    $('#farmNext')?.addEventListener('click', () => this.nextStep());
    this.form?.addEventListener('submit', (e) => this.saveFarm(e));

    $('#btnScanWifi')?.addEventListener('click', () => this.scanWifiNetworks(true));
    $('#btnManualSsid')?.addEventListener('click', () => this.handleManualSsid());
    $('#wifiShowPassword')?.addEventListener('change', (e) => {
      const input = $('#wifiPassword');
      if (input) input.type = e.target.checked ? 'text' : 'password';
    });
    $('#wifiPassword')?.addEventListener('input', (e) => {
      this.data.connection.wifi.password = e.target.value || '';
      this.data.connection.wifi.tested = false;
      this.data.connection.wifi.testResult = null;
      this.updateWifiPasswordUI();
    });
    $('#wifiReuseDevices')?.addEventListener('change', (e) => {
      const reuse = !!e.target.checked;
      this.data.connection.wifi.reuseDiscovery = reuse;
      try { localStorage.setItem(this.discoveryStorageKeys.reuse, reuse ? 'true' : 'false'); } catch {}
    });
    $('#btnTestWifi')?.addEventListener('click', () => this.testWifi());
    $('#farmName')?.addEventListener('input', (e) => { this.data.location.farmName = e.target.value || ''; });
    $('#farmAddress')?.addEventListener('input', (e) => { this.data.location.address = e.target.value || ''; this.guessTimezone(); });
    $('#farmCity')?.addEventListener('input', (e) => { this.data.location.city = e.target.value || ''; this.guessTimezone(); });
    $('#farmState')?.addEventListener('input', (e) => { this.data.location.state = e.target.value || ''; this.guessTimezone(); });
    $('#farmPostal')?.addEventListener('input', (e) => { this.data.location.postal = e.target.value || ''; });
    $('#farmTimezone')?.addEventListener('change', (e) => { this.data.location.timezone = e.target.value || this.data.location.timezone; });
    $('#contactName')?.addEventListener('input', (e) => { this.data.contact.name = e.target.value || ''; });
    $('#contactEmail')?.addEventListener('input', (e) => { this.data.contact.email = e.target.value || ''; });
    $('#contactPhone')?.addEventListener('input', (e) => { this.data.contact.phone = e.target.value || ''; });
    $('#contactWebsite')?.addEventListener('input', (e) => { this.data.contact.website = e.target.value || ''; });
    $('#btnAddRoom')?.addEventListener('click', () => this.addRoom());
    $('#newRoomName')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.addRoom(); } });

    document.querySelectorAll('#farmConnectionChoice .chip-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.value;
        if (!choice) return;
        this.data.connection.type = choice;
        document.querySelectorAll('#farmConnectionChoice .chip-option').forEach(b => b.classList.toggle('is-active', b === btn));
        this.steps = this.getVisibleSteps();
        if (choice === 'wifi' && !this.wifiNetworks.length) this.scanWifiNetworks();
        if (choice !== 'wifi') {
          this.data.connection.wifi.testResult = null;
          this.data.connection.wifi.tested = false;
        }
        this.renderWifiNetworks();
        this.updateWifiPasswordUI();
      });
    });

    this.populateTimezones();
    this.loadExistingFarm();
  }

  populateTimezones() {
    const select = $('#farmTimezone');
    if (!select) return;
    const common = [
      'America/Toronto','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Vancouver',
      'America/Sao_Paulo','Europe/London','Europe/Amsterdam','Europe/Berlin','Asia/Tokyo','Asia/Kolkata','Australia/Sydney'
    ];
    const current = this.data.location.timezone;
    select.innerHTML = common.map(tz => `<option value="${tz}">${tz}</option>`).join('');
    if (!common.includes(current)) {
      const opt = document.createElement('option');
      opt.value = current;
      opt.textContent = current;
      opt.selected = true;
      select.appendChild(opt);
    } else {
      select.value = current;
    }
  }

  getVisibleSteps() {
    if (this.data.connection.type === 'wifi') return this.baseSteps.slice();
    return this.baseSteps.filter(step => !step.startsWith('wifi-'));
  }

  open() {
    this.currentStep = 0;
    this.steps = this.getVisibleSteps();
    this.showStep(0);
    this.modal?.setAttribute('aria-hidden', 'false');
    this.updateConnectionButtons();
    this.renderWifiNetworks();
    this.updateWifiPasswordUI();
    this.renderRoomsEditor();
  }

  edit() {
    if (!STATE.farm) return this.open();
    this.hydrateFromFarm(STATE.farm);
    this.steps = this.getVisibleSteps();
    this.open();
  }

  close() {
    this.modal?.setAttribute('aria-hidden', 'true');
  }

  showStep(index) {
    this.steps = this.getVisibleSteps();
    if (index >= this.steps.length) index = this.steps.length - 1;
    if (index < 0) index = 0;
    this.currentStep = index;
    const activeId = this.steps[index];
    document.querySelectorAll('.farm-step').forEach(step => {
      if (!activeId) { step.removeAttribute('data-active'); return; }
      step.toggleAttribute('data-active', step.dataset.step === activeId);
    });
    if (this.progressEl) this.progressEl.textContent = `Step ${index + 1} of ${this.steps.length}`;
    if (this.titleEl) {
      if (activeId === 'location') this.titleEl.textContent = 'Where is this farm?';
      else if (activeId === 'contact') this.titleEl.textContent = 'Contact information';
      else if (activeId === 'spaces') this.titleEl.textContent = 'Add rooms and zones';
      else if (activeId === 'review') this.titleEl.textContent = 'Review and save';
      else this.titleEl.textContent = 'Let’s get you online';
    }
    const prevBtn = $('#farmPrev');
    const nextBtn = $('#farmNext');
    const saveBtn = $('#btnSaveFarm');
    if (prevBtn) prevBtn.style.display = index === 0 ? 'none' : 'inline-block';
    if (activeId === 'review') {
      nextBtn.style.display = 'none';
      saveBtn.style.display = 'inline-block';
      this.updateReview();
    } else {
      nextBtn.style.display = 'inline-block';
      saveBtn.style.display = 'none';
    }
    if (activeId === 'wifi-select' && this.wifiNetworks.length === 0) this.scanWifiNetworks();
    if (activeId === 'wifi-password') this.updateWifiPasswordUI();
  }

  handleManualSsid() {
    const ssid = prompt('Enter the Wi‑Fi network name (SSID)');
    if (!ssid) return;
    this.wifiNetworks = [{ ssid, signal: null, security: 'Manual' }, ...this.wifiNetworks.filter(n => n.ssid !== ssid)];
    this.selectSsid(ssid);
    this.renderWifiNetworks();
  }

  selectSsid(ssid) {
    this.data.connection.wifi.ssid = ssid;
    this.data.connection.wifi.tested = false;
    this.data.connection.wifi.testResult = null;
    const label = $('#wifiChosenSsid');
    if (label) label.textContent = ssid || 'your network';
    this.renderWifiNetworks();
    this.updateWifiPasswordUI();
  }

  updateWifiPasswordUI() {
    const status = $('#wifiTestStatus');
    if (!status) return;
    const result = this.data.connection.wifi.testResult;
    if (!result) {
      status.innerHTML = '<div class="tiny" style="color:#475569">Run a quick connectivity test to confirm.</div>';
    } else if (result.status === 'connected') {
      status.innerHTML = `<div class="badge badge--success">Success</div><div class="tiny">IP ${result.ip || '—'} • latency ${result.latencyMs ?? '—'} ms</div>`;
    } else {
      status.innerHTML = `<div class="badge badge--warn">${result.status || 'Failed'}</div><div class="tiny">${result.message || 'Try again or re-enter the password.'}</div>`;
    }
  }

  async scanWifiNetworks(force = false) {
    const status = $('#wifiScanStatus');
    if (status) status.textContent = 'Scanning…';
    try {
      const resp = await fetch(`/forwarder/network/wifi/scan${force ? '?force=1' : ''}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.json();
      const list = Array.isArray(body.networks) ? body.networks : body;
      this.wifiNetworks = list.map(n => ({
        ssid: n.ssid || n.name || 'Hidden network',
        signal: n.signal ?? n.rssi ?? null,
        security: n.security || n.auth || 'Unknown'
      }));
      if (status) status.textContent = this.wifiNetworks.length ? `${this.wifiNetworks.length} networks found` : 'No networks found';
    } catch (err) {
      console.warn('Wi‑Fi scan failed', err);
      this.wifiNetworks = [
        { ssid: 'Farm-IoT', signal: -48, security: 'WPA2' },
        { ssid: 'Greenhouse-Guest', signal: -61, security: 'WPA2' },
        { ssid: 'BackOffice', signal: -72, security: 'WPA3' }
      ];
      if (status) status.textContent = 'Using cached sample networks';
    }
    this.renderWifiNetworks();
  }

  renderWifiNetworks() {
    const host = $('#wifiNetworkList');
    if (!host) return;
    host.innerHTML = '';
    if (this.data.connection.type !== 'wifi') {
      host.innerHTML = '<p class="tiny">Ethernet selected—skip Wi‑Fi.</p>';
      return;
    }
    this.wifiNetworks.forEach(net => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-option';
      btn.setAttribute('role', 'option');
      btn.dataset.value = net.ssid;
      btn.innerHTML = `<span>${escapeHtml(net.ssid)}</span><span class="tiny">${net.signal != null ? `${net.signal} dBm` : ''} ${net.security}</span>`;
      if (this.data.connection.wifi.ssid === net.ssid) btn.classList.add('is-active');
      btn.addEventListener('click', () => this.selectSsid(net.ssid));
      host.appendChild(btn);
    });
  }

  async testWifi() {
    if (this.data.connection.type !== 'wifi') return;
    if (!this.data.connection.wifi.ssid) { alert('Pick a Wi‑Fi network first.'); return; }
    const status = $('#wifiTestStatus');
    if (status) status.innerHTML = '<div class="tiny">Testing…</div>';
    try {
      const resp = await fetch('/forwarder/network/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'wifi',
          wifi: {
            ssid: this.data.connection.wifi.ssid,
            password: this.data.connection.wifi.password
          }
        })
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.json();
      this.data.connection.wifi.tested = true;
      this.data.connection.wifi.testResult = body;
      if (body.status === 'connected') {
        if (this.data.connection.wifi.reuseDiscovery) {
          try {
            if (body.subnet) localStorage.setItem(this.discoveryStorageKeys.subnet, body.subnet);
            if (body.gateway) localStorage.setItem(this.discoveryStorageKeys.gateway, body.gateway);
            if (body.ssid) localStorage.setItem(this.discoveryStorageKeys.ssid, body.ssid);
          } catch {}
        }
        showToast({ title: 'Wi‑Fi connected', msg: `IP ${body.ip || '—'} • gateway ${body.gateway || '—'}`, kind: 'success', icon: '✅' });
      } else {
        showToast({ title: 'Wi‑Fi test failed', msg: body.message || 'Check the password or move closer to the AP.', kind: 'warn', icon: '⚠️' });
      }
    } catch (err) {
      console.error('Wi‑Fi test error', err);
      this.data.connection.wifi.testResult = { status: 'error', message: err.message };
      showToast({ title: 'Wi‑Fi test error', msg: err.message || String(err), kind: 'warn', icon: '⚠️' });
    }
    this.updateWifiPasswordUI();
  }

  addRoom() {
    const input = $('#newRoomName');
    if (!input) return;
    const name = (input.value || '').trim();
    if (!name) return;
    const id = `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
    this.data.rooms.push({ id, name, zones: [] });
    input.value = '';
    this.renderRoomsEditor();
  }

  removeRoom(roomId) {
    this.data.rooms = this.data.rooms.filter(r => r.id !== roomId);
    this.renderRoomsEditor();
  }

  addZone(roomId, zoneName) {
    const room = this.data.rooms.find(r => r.id === roomId);
    if (!room || !zoneName) return;
    if (!room.zones.includes(zoneName)) room.zones.push(zoneName);
    this.renderRoomsEditor();
  }

  removeZone(roomId, zoneName) {
    const room = this.data.rooms.find(r => r.id === roomId);
    if (!room) return;
    room.zones = room.zones.filter(z => z !== zoneName);
    this.renderRoomsEditor();
  }

  renderRoomsEditor() {
    const host = $('#roomsEditor');
    if (!host) return;
    if (!this.data.rooms.length) {
      host.innerHTML = '<p class="tiny">Add your first room to get started. Zones can be canopy, bench, or bay labels.</p>';
      return;
    }
    host.innerHTML = '';
    this.data.rooms.forEach(room => {
      const card = document.createElement('div');
      card.className = 'farm-room-card';
      card.innerHTML = `
        <div class="farm-room-card__header">
          <strong>${escapeHtml(room.name)}</strong>
          <button type="button" class="ghost tiny" data-action="remove-room" data-room="${room.id}">Remove</button>
        </div>
        <div class="farm-room-card__zones" data-room="${room.id}">${room.zones.map(z => `<span class="chip tiny" data-zone="${escapeHtml(z)}">${escapeHtml(z)} <button type="button" data-action="remove-zone" data-room="${room.id}" data-zone="${escapeHtml(z)}">×</button></span>`).join('')}</div>
        <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">
          <input type="text" class="tiny farm-zone-input" data-room="${room.id}" placeholder="Add zone">
          <button type="button" class="ghost tiny" data-action="add-zone" data-room="${room.id}">Add zone</button>
        </div>`;
      host.appendChild(card);
    });
    host.querySelectorAll('[data-action="remove-room"]').forEach(btn => btn.addEventListener('click', (e) => {
      const roomId = e.currentTarget.dataset.room;
      this.removeRoom(roomId);
    }));
    host.querySelectorAll('[data-action="add-zone"]').forEach(btn => btn.addEventListener('click', (e) => {
      const roomId = e.currentTarget.dataset.room;
      const input = host.querySelector(`.farm-zone-input[data-room="${roomId}"]`);
      const value = (input?.value || '').trim();
      if (value) {
        this.addZone(roomId, value);
        if (input) input.value = '';
      }
    }));
    host.querySelectorAll('.farm-zone-input').forEach(input => {
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          const roomId = ev.target.dataset.room;
          this.addZone(roomId, (ev.target.value || '').trim());
          ev.target.value = '';
        }
      });
    });
    host.querySelectorAll('[data-action="remove-zone"]').forEach(btn => btn.addEventListener('click', (e) => {
      const roomId = e.currentTarget.dataset.room;
      const zone = e.currentTarget.dataset.zone;
      this.removeZone(roomId, zone);
    }));
  }

  validateCurrentStep() {
    const stepId = this.steps[this.currentStep];
    if (stepId === 'connection-choice' && !['wifi','ethernet'].includes(this.data.connection.type)) {
      alert('Pick Wi‑Fi or Ethernet to continue.');
      return false;
    }
    if (stepId === 'wifi-select' && !this.data.connection.wifi.ssid) {
      alert('Choose a Wi‑Fi network.');
      return false;
    }
    if (stepId === 'wifi-test' && (!this.data.connection.wifi.testResult || this.data.connection.wifi.testResult.status !== 'connected')) {
      alert('Run the Wi‑Fi test so we know the credentials work.');
      return false;
    }
    if (stepId === 'location' && !this.data.location.farmName) {
      alert('Add a farm name so we can label the site.');
      return false;
    }
    if (stepId === 'contact' && (!this.data.contact.name || !this.data.contact.email)) {
      alert('Contact name and email are required.');
      return false;
    }
    if (stepId === 'spaces' && !this.data.rooms.length) {
      alert('Add at least one room.');
      return false;
    }
    return true;
  }

  nextStep() {
    if (!this.validateCurrentStep()) return;
    const next = Math.min(this.currentStep + 1, this.steps.length - 1);
    this.showStep(next);
  }

  prevStep() {
    const prev = Math.max(this.currentStep - 1, 0);
    this.showStep(prev);
  }

  updateReview() {
    const host = $('#farmReview');
    if (!host) return;
    const conn = this.data.connection;
    const rooms = this.data.rooms;
    const timezone = this.data.location.timezone;
    const addressParts = [this.data.location.address, this.data.location.city, this.data.location.state, this.data.location.postal].filter(Boolean);
    host.innerHTML = `
      <div><strong>Connection:</strong> ${conn.type === 'wifi' ? `Wi‑Fi · ${escapeHtml(conn.wifi.ssid || '')}` : 'Ethernet'} ${conn.wifi.testResult?.status === 'connected' ? '✅' : ''}</div>
      <div><strong>Farm:</strong> ${escapeHtml(this.data.location.farmName || 'Untitled')}</div>
      <div><strong>Address:</strong> ${escapeHtml(addressParts.join(', ') || '—')}</div>
      <div><strong>Timezone:</strong> ${escapeHtml(timezone)}</div>
      <div><strong>Contact:</strong> ${escapeHtml(this.data.contact.name || '')} ${this.data.contact.email ? `&lt;${escapeHtml(this.data.contact.email)}&gt;` : ''} ${this.data.contact.phone ? escapeHtml(this.data.contact.phone) : ''}</div>
      ${this.data.contact.website ? `<div><strong>Website:</strong> <a href="${escapeHtml(this.data.contact.website)}" target="_blank">${escapeHtml(this.data.contact.website)}</a></div>` : ''}
      <div><strong>Rooms:</strong> ${rooms.map(r => `${escapeHtml(r.name)} (${r.zones.length || 0} zones)`).join(', ')}</div>`;
  }

  hydrateFromFarm(farmData) {
    const safe = farmData || {};
    const copy = this.defaultData();
    copy.connection.type = safe.connection?.type === 'ethernet' ? 'ethernet' : 'wifi';
    if (safe.connection?.wifi) {
      copy.connection.wifi.ssid = safe.connection.wifi.ssid || '';
      copy.connection.wifi.reuseDiscovery = safe.connection.wifi.reuseDiscovery ?? this.readDiscoveryPreference();
      copy.connection.wifi.tested = !!safe.connection.wifi.tested;
      copy.connection.wifi.testResult = safe.connection.wifi.testResult || null;
    }
    copy.location.farmName = safe.farmName || '';
    copy.location.address = safe.address || '';
    copy.location.city = safe.city || '';
    copy.location.state = safe.state || '';
    copy.location.postal = safe.postalCode || safe.postal || '';
    copy.location.timezone = safe.timezone || copy.location.timezone;
    if (safe.contact) {
      copy.contact.name = safe.contact.name || '';
      copy.contact.email = safe.contact.email || '';
      copy.contact.phone = safe.contact.phone || '';
      copy.contact.website = safe.contact.website || '';
    }
    copy.rooms = Array.isArray(safe.rooms) ? safe.rooms.map(room => ({
      id: room.id || `room-${Math.random().toString(36).slice(2,8)}`,
      name: room.name || room.title || 'Room',
      zones: Array.isArray(room.zones) ? room.zones.slice() : []
    })) : [];
    if (!copy.rooms.length && Array.isArray(safe.locations)) {
      copy.rooms = safe.locations.map((name, idx) => ({ id: `room-${idx}`, name, zones: [] }));
    }
    this.data = copy;
    this.renderRoomsEditor();
    this.renderWifiNetworks();
    this.updateWifiPasswordUI();
    this.updateConnectionButtons();
    this.populateTimezones();
    // Populate form fields
    const farmNameEl = $('#farmName'); if (farmNameEl) farmNameEl.value = this.data.location.farmName;
    const farmAddressEl = $('#farmAddress'); if (farmAddressEl) farmAddressEl.value = this.data.location.address;
    const farmCityEl = $('#farmCity'); if (farmCityEl) farmCityEl.value = this.data.location.city;
    const farmStateEl = $('#farmState'); if (farmStateEl) farmStateEl.value = this.data.location.state;
    const farmPostalEl = $('#farmPostal'); if (farmPostalEl) farmPostalEl.value = this.data.location.postal;
    const farmTimezoneEl = $('#farmTimezone'); if (farmTimezoneEl) farmTimezoneEl.value = this.data.location.timezone;
    const contactNameEl = $('#contactName'); if (contactNameEl) contactNameEl.value = this.data.contact.name;
    const contactEmailEl = $('#contactEmail'); if (contactEmailEl) contactEmailEl.value = this.data.contact.email;
    const contactPhoneEl = $('#contactPhone'); if (contactPhoneEl) contactPhoneEl.value = this.data.contact.phone;
    const contactWebsiteEl = $('#contactWebsite'); if (contactWebsiteEl) contactWebsiteEl.value = this.data.contact.website;
  }

  updateConnectionButtons() {
    document.querySelectorAll('#farmConnectionChoice .chip-option').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.value === this.data.connection.type);
    });
  }

  async loadExistingFarm() {
    try {
      const farm = await loadJSON('./data/farm.json');
      if (farm) {
        STATE.farm = this.normalizeFarm(farm);
        this.hydrateFromFarm(STATE.farm);
        this.updateFarmDisplay();
        return;
      }
    } catch (err) {
      console.warn('Failed to load farm.json', err);
    }
    try {
      const cached = JSON.parse(localStorage.getItem('gr.farm') || 'null');
      if (cached) {
        STATE.farm = this.normalizeFarm(cached);
        this.hydrateFromFarm(STATE.farm);
        this.updateFarmDisplay();
      }
    } catch {}
  }

  normalizeFarm(farm) {
    return normalizeFarmDoc(farm);
  }

  async saveFarm(event) {
    event?.preventDefault();
    if (!this.validateCurrentStep()) { this.showStep(this.currentStep); return; }
    const existing = STATE.farm || {};
    const payload = {
      ...existing,
      farmName: this.data.location.farmName,
      address: this.data.location.address,
      city: this.data.location.city,
      state: this.data.location.state,
      postalCode: this.data.location.postal,
      timezone: this.data.location.timezone,
      contact: {
        name: this.data.contact.name,
        email: this.data.contact.email,
        phone: this.data.contact.phone,
        website: this.data.contact.website
      },
      connection: {
        type: this.data.connection.type,
        wifi: {
          ssid: this.data.connection.wifi.ssid,
          reuseDiscovery: this.data.connection.wifi.reuseDiscovery,
          tested: this.data.connection.wifi.tested,
          testResult: this.data.connection.wifi.testResult
        }
      },
      discovery: {
        subnet: (() => { try { return localStorage.getItem(this.discoveryStorageKeys.subnet) || ''; } catch { return ''; } })(),
        gateway: (() => { try { return localStorage.getItem(this.discoveryStorageKeys.gateway) || ''; } catch { return ''; } })(),
        reuseNetwork: this.data.connection.wifi.reuseDiscovery,
        ssid: this.data.connection.wifi.ssid
      },
      rooms: this.data.rooms.map((room, idx) => ({
        id: room.id || `room-${idx}`,
        name: room.name,
        zones: Array.isArray(room.zones) ? room.zones.slice() : []
      })),
      locations: this.data.rooms.map(r => r.name),
      registered: existing.registered || new Date().toISOString()
    };
    const saved = await safeFarmSave(payload);
    if (!saved) { alert('Failed to save farm. Please try again.'); return; }
    STATE.farm = this.normalizeFarm(payload);
    this.updateFarmDisplay();
    showToast({ title: 'Farm saved', msg: 'We stored the farm profile and updated discovery defaults.', kind: 'success', icon: '✅' });
    this.close();
  }

  updateFarmDisplay() {
    const badge = $('#farmBadge');
    const editBtn = $('#btnEditFarm');
    const launchBtn = $('#btnLaunchFarm');
    const setupBtn = $('#btnStartDeviceSetup');
    const summaryChip = $('#farmSummaryChip');
    if (!STATE.farm) {
      if (badge) badge.style.display = 'none';
      if (setupBtn) setupBtn.style.display = 'none';
      if (summaryChip) summaryChip.style.display = 'none';
      return;
    }
    const roomCount = Array.isArray(STATE.farm.rooms) ? STATE.farm.rooms.length : 0;
    const zoneCount = (STATE.farm.rooms || []).reduce((acc, room) => acc + (room.zones?.length || 0), 0);
    const summary = `${STATE.farm.farmName || 'Farm'} · ${roomCount} room${roomCount === 1 ? '' : 's'} · ${zoneCount} zone${zoneCount === 1 ? '' : 's'}`;
    if (badge) {
      badge.style.display = 'block';
      badge.textContent = summary;
    }
    if (summaryChip) {
      summaryChip.style.display = 'inline-flex';
      summaryChip.textContent = summary;
    }
    if (setupBtn) {
      setupBtn.style.display = 'inline-flex';
    }
    if (launchBtn) launchBtn.style.display = 'none';
    if (editBtn) editBtn.style.display = 'inline-flex';
  }

  guessTimezone() {
    const state = (this.data.location.state || '').toLowerCase();
    const map = {
      'ca': 'America/Los_Angeles', 'california': 'America/Los_Angeles',
      'or': 'America/Los_Angeles', 'oregon': 'America/Los_Angeles',
      'wa': 'America/Los_Angeles', 'washington': 'America/Los_Angeles',
      'bc': 'America/Vancouver', 'british columbia': 'America/Vancouver',
      'ab': 'America/Edmonton', 'alberta': 'America/Edmonton',
      'on': 'America/Toronto', 'ontario': 'America/Toronto',
      'qc': 'America/Toronto', 'quebec': 'America/Toronto',
      'ny': 'America/New_York', 'new york': 'America/New_York',
      'il': 'America/Chicago', 'illinois': 'America/Chicago',
      'fl': 'America/New_York', 'florida': 'America/New_York'
    };
    const guess = map[state];
    if (guess) {
      this.data.location.timezone = guess;
      const select = $('#farmTimezone');
      if (select) {
        if (![...select.options].some(opt => opt.value === guess)) {
          const opt = document.createElement('option');
          opt.value = guess;
          opt.textContent = guess;
          select.appendChild(opt);
        }
        select.value = guess;
      }
    }
  }
}


// --- Device Discovery & Manager ---
class DeviceManagerWindow {
  constructor() {
    this.host = $('#deviceManager');
    this.backdrop = $('#deviceManagerBackdrop');
    this.closeBtn = $('#deviceManagerClose');
    this.resultsEl = $('#deviceDiscoveryResults');
    this.statusEl = $('#discoveryStatus');
    this.summaryEl = $('#deviceManagerSummary');
    this.runBtn = $('#btnRunDiscovery');
    this.filterButtons = Array.from(document.querySelectorAll('#deviceManager [data-filter]'));
    this.automationBtn = $('#btnOpenAutomation');
    this.devices = [];
    this.activeFilter = 'all';
    this.discoveryRun = null;
    this.bind();
  }

  bind() {
    $('#btnStartDeviceSetup')?.addEventListener('click', () => this.open());
    $('#btnDiscover')?.addEventListener('click', () => this.open());
    this.closeBtn?.addEventListener('click', () => this.close());
    this.backdrop?.addEventListener('click', () => this.close());
    this.runBtn?.addEventListener('click', () => this.runDiscovery());
    this.filterButtons.forEach(btn => btn.addEventListener('click', () => this.setFilter(btn.dataset.filter)));
    this.automationBtn?.addEventListener('click', () => {
      showToast({ title: 'Automation card', msg: 'Coming soon — natural language rules for any sensor to control any device.', kind: 'info', icon: '🧠' }, 5000);
    });
  }

  open() {
    if (!this.host) return;
    this.host.setAttribute('aria-hidden', 'false');
    if (!this.devices.length) this.runDiscovery();
    this.render();
  }

  close() {
    if (!this.host) return;
    this.host.setAttribute('aria-hidden', 'true');
  }

  setFilter(filter) {
    this.activeFilter = filter || 'all';
    this.filterButtons.forEach(btn => btn.setAttribute('aria-selected', btn.dataset.filter === this.activeFilter ? 'true' : 'false'));
    this.render();
  }

  async runDiscovery() {
    if (this.statusEl) this.statusEl.textContent = 'Scanning local network, BLE hub, and MQTT broker…';
    try {
      const resp = await fetch('/discovery/devices');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.json();
      this.discoveryRun = body;
      const list = Array.isArray(body.devices) ? body.devices : [];
      this.devices = list.map(dev => ({
        id: dev.id || `${dev.protocol}:${dev.address || dev.name || Math.random().toString(36).slice(2,8)}`,
        name: dev.name || dev.label || 'Unknown device',
        protocol: dev.protocol || 'wifi',
        confidence: typeof dev.confidence === 'number' ? dev.confidence : 0.6,
        signal: dev.signal ?? dev.rssi ?? null,
        address: dev.address || dev.ip || dev.mac || null,
        vendor: dev.vendor || dev.brand || 'Unknown',
        lastSeen: dev.lastSeen || body.completedAt || new Date().toISOString(),
        hints: dev.hints || {},
        status: 'new',
        assignment: null
      }));
      if (this.statusEl) this.statusEl.textContent = `Found ${this.devices.length} device${this.devices.length === 1 ? '' : 's'}`;
      showToast({ title: 'Discovery complete', msg: `Found ${this.devices.length} potential devices`, kind: 'success', icon: '🔍' });
    } catch (err) {
      console.error('Discovery failed', err);
      this.devices = [
        { id: 'wifi:192.168.1.50', name: 'Shelly Pro 4PM', protocol: 'wifi', confidence: 0.92, signal: -51, address: '192.168.1.50', vendor: 'Shelly', lastSeen: new Date().toISOString(), hints: { type: 'Light' }, status: 'new', assignment: null },
        { id: 'ble:SwitchBot-Meter-01', name: 'SwitchBot Meter Plus', protocol: 'ble', confidence: 0.8, signal: -42, address: 'DF:11:02:AA:CD:01', vendor: 'SwitchBot', lastSeen: new Date().toISOString(), hints: { type: 'Sensor', metrics: ['temp','rh'] }, status: 'new', assignment: null },
        { id: 'mqtt:sensor:co2', name: 'SenseCAP CO₂', protocol: 'mqtt', confidence: 0.7, signal: null, address: 'sensors/co2/01', vendor: 'Seeed', lastSeen: new Date().toISOString(), hints: { type: 'Sensor', metrics: ['co2'] }, status: 'new', assignment: null }
      ];
      if (this.statusEl) this.statusEl.textContent = 'Offline mode — showing demo devices';
      showToast({ title: 'Discovery offline', msg: 'Showing demo devices because the scan failed.', kind: 'warn', icon: '⚠️' });
    }
    this.render();
  }

  filteredDevices() {
    if (this.activeFilter === 'added') return this.devices.filter(d => d.status === 'added');
    if (this.activeFilter === 'ignored') return this.devices.filter(d => d.status === 'ignored');
    return this.devices;
  }

  render() {
    if (!this.resultsEl) return;
    const devices = this.filteredDevices();
    this.resultsEl.innerHTML = '';
    if (!devices.length) {
      this.resultsEl.innerHTML = '<p class="tiny">No devices to show. Run discovery or adjust filters.</p>';
    } else {
      devices.forEach(dev => this.resultsEl.appendChild(this.renderDeviceCard(dev)));
    }
    const added = this.devices.filter(d => d.status === 'added').length;
    const ignored = this.devices.filter(d => d.status === 'ignored').length;
    const total = this.devices.length;
    if (this.summaryEl) this.summaryEl.textContent = `${total} found · ${added} added · ${ignored} ignored`;
  }

  renderDeviceCard(device) {
    const card = document.createElement('article');
    card.className = 'device-manager__card';
    card.dataset.deviceId = device.id;
    const signal = device.signal != null ? `${device.signal} dBm` : '—';
    const confidencePct = Math.round(device.confidence * 100);
    const statusBadge = device.status === 'added' ? '<span class="badge badge--success">Added</span>' : (device.status === 'ignored' ? '<span class="badge badge--muted">Ignored</span>' : '');
    card.innerHTML = `
      <header class="device-manager__card-header">
        <div>
          <div class="device-manager__name">${escapeHtml(device.name)}</div>
          <div class="tiny">${escapeHtml(device.vendor)} • ${escapeHtml(device.address || 'No address')}</div>
        </div>
        <div class="device-manager__badges">
          <span class="badge badge--protocol">${device.protocol.toUpperCase()}</span>
          <span class="badge">RSSI ${signal}</span>
          <span class="badge">Confidence ${confidencePct}%</span>
          ${statusBadge}
        </div>
      </header>
      <div class="device-manager__card-body">
        <div class="tiny">Last seen ${new Date(device.lastSeen).toLocaleString()}</div>
        ${device.hints?.metrics ? `<div class="tiny">Metrics: ${device.hints.metrics.join(', ')}</div>` : ''}
        ${device.hints?.type ? `<div class="tiny">Suggested type: ${device.hints.type}</div>` : ''}
      </div>
      <div class="device-manager__actions">
        <button type="button" class="primary" data-action="add">${device.status === 'added' ? 'Edit assignment' : 'Add to Farm'}</button>
        <button type="button" class="ghost" data-action="ignore">${device.status === 'ignored' ? 'Undo ignore' : 'Ignore'}</button>
      </div>
      <div class="device-manager__assignment" data-assignment></div>
    `;
    const actions = card.querySelector('.device-manager__actions');
    actions.querySelector('[data-action="add"]').addEventListener('click', () => this.toggleAssignment(card, device));
    actions.querySelector('[data-action="ignore"]').addEventListener('click', () => this.toggleIgnore(device));
    this.renderAssignment(card, device);
    return card;
  }

  toggleAssignment(card, device) {
    const slot = card.querySelector('[data-assignment]');
    if (!slot) return;
    if (slot.querySelector('form')) {
      slot.innerHTML = '';
      return;
    }
    const form = this.buildAssignmentForm(device);
    slot.innerHTML = '';
    slot.appendChild(form);
  }

  buildAssignmentForm(device) {
    const form = document.createElement('form');
    form.className = 'device-manager__assign-form';
    const rooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : [];
    if (!rooms.length) {
      form.innerHTML = '<p class="tiny">Add rooms in the Farm setup to assign devices.</p>';
      return form;
    }
    const roomOptions = rooms.map(room => `<option value="${room.id}">${escapeHtml(room.name)}</option>`).join('');
    form.innerHTML = `
      <label class="tiny">Room
        <select name="room" required>
          <option value="">Select room</option>
          ${roomOptions}
        </select>
      </label>
      <label class="tiny">Zone
        <select name="zone">
          <option value="">Whole room</option>
        </select>
      </label>
      <label class="tiny">Type
        <select name="type" required>
          <option value="light">Light</option>
          <option value="sensor">Sensor</option>
          <option value="plug">Plug</option>
          <option value="hvac">HVAC</option>
          <option value="other">Other</option>
        </select>
      </label>
      <button type="submit" class="primary">Save</button>
    `;
    const roomSelect = form.querySelector('select[name="room"]');
    const zoneSelect = form.querySelector('select[name="zone"]');
    roomSelect.addEventListener('change', () => {
      const room = rooms.find(r => r.id === roomSelect.value);
      zoneSelect.innerHTML = '<option value="">Whole room</option>' + (room?.zones || []).map(z => `<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join('');
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const roomId = roomSelect.value;
      if (!roomId) { alert('Choose a room'); return; }
      const zone = zoneSelect.value || null;
      const type = form.querySelector('select[name="type"]').value;
      device.assignment = { roomId, zone, type };
      device.status = 'added';
      showToast({ title: 'Device added', msg: `${device.name} mapped to ${type} in room ${rooms.find(r => r.id === roomId)?.name || roomId}`, kind: 'success', icon: '✅' });
      this.render();
    });
    if (device.assignment) {
      roomSelect.value = device.assignment.roomId || '';
      roomSelect.dispatchEvent(new Event('change'));
      zoneSelect.value = device.assignment.zone || '';
      form.querySelector('select[name="type"]').value = device.assignment.type || 'other';
    }
    return form;
  }

  renderAssignment(card, device) {
    const slot = card.querySelector('[data-assignment]');
    if (!slot) return;
    if (device.status !== 'added' || !device.assignment) {
      slot.innerHTML = '';
      return;
    }
    const rooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : [];
    const room = rooms.find(r => r.id === device.assignment.roomId);
    slot.innerHTML = `<div class="tiny">Assigned to <strong>${escapeHtml(room?.name || 'Room')}</strong>${device.assignment.zone ? ` · Zone ${escapeHtml(device.assignment.zone)}` : ''} as ${device.assignment.type}</div>`;
  }

  toggleIgnore(device) {
    if (device.status === 'ignored') {
      device.status = 'new';
    } else {
      device.status = 'ignored';
      device.assignment = null;
    }
    this.render();
  }
}

let deviceManagerWindow;
// --- Grow Room Wizard ---
class RoomWizard {
  constructor() {
    this.modal = $('#roomModal');
    this.form = $('#roomWizardForm');
    // Auto-advance behavior: when a required field for a step is completed,
    // the wizard will advance automatically. Can be disabled if needed.
    this.autoAdvance = true;
    // equipment-first: begin with hardware categories before fixtures/control
    // Steps can be augmented dynamically based on selected hardware (e.g., hvac, dehumidifier, etc.)
    this.baseSteps = ['connectivity','devices','hardware','category-setup','sensors','room-name','location','layout','zones','fixtures','control','energy','grouping','review'];
    this.steps = this.baseSteps.slice();
    this.currentStep = 0;
    this.data = {
      id: '',
      name: '',
      location: '',
      hardwareCats: [],
      hardwareOrder: [],
      layout: { type: '', rows: 0, racks: 0, levels: 0 },
      zones: [],
      fixtures: [],
      controlMethod: null,
      devices: [],
      sensors: { categories: [], placements: {} },
      energy: '',
      energyHours: 0,
      targetPpfd: 0,
      photoperiod: 0,
      connectivity: { hasHub: null, hubType: '', hubIp: '', cloudTenant: 'Azure' },
      roles: { admin: [], operator: [], viewer: [] },
      grouping: { groups: [], planId: '', scheduleId: '', spectraSync: true },
      seriesCount: 0
    };
    this.hardwareSearchResults = [];
    // dynamic category setup state
    this.categoryQueue = []; // ordered list of categories to visit
    this.categoryIndex = -1; // index within categoryQueue for current category-setup step
    // Per-category progress and status map. Keys are category ids, values: { status: 'not-started'|'needs-hub'|'needs-setup'|'needs-energy'|'complete', controlConfirmed: bool, notes: string }
    this.categoryProgress = {};
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
        if (sel === '#roomEnergy') this.updateSetupQueue();
        if (sel === '#roomLayoutType') this.updateSetupQueue();
      });
    };
    chipGroup('#roomLayoutType', this.data.layout, 'type');
    chipGroup('#roomEnergy', this.data, 'energy');
    $('#roomRows')?.addEventListener('input', (e)=> { this.data.layout.rows = Number(e.target.value||0); this.updateSetupQueue(); });
    $('#roomRacks')?.addEventListener('input', (e)=> { this.data.layout.racks = Number(e.target.value||0); this.updateSetupQueue(); });
    $('#roomLevels')?.addEventListener('input', (e)=> { this.data.layout.levels = Number(e.target.value||0); this.updateSetupQueue(); });

    // Fixtures KB reuse
    const fSearch = $('#roomKbSearch');
    const fResults = $('#roomKbResults');
    const fSelected = $('#roomKbSelected');
    fSearch?.addEventListener('input', ()=> this.updateKbResults(fSearch.value.trim()));
    // Series count wiring
    const seriesInput = document.getElementById('roomSeriesCount');
    if (seriesInput) {
      seriesInput.addEventListener('input', (e)=> {
        const n = Number(e.target.value || 0);
        this.data.seriesCount = Number.isFinite(n) ? Math.max(0, n) : 0;
        this.updateSetupQueue();
      });
    }
    const targetInput = document.getElementById('roomTargetPpfd');
    if (targetInput) {
      targetInput.addEventListener('input', (e) => {
        const v = Number(e.target.value || 0);
        this.data.targetPpfd = Number.isFinite(v) ? Math.max(0, v) : 0;
        this.updateSetupQueue();
      });
    }
    const photoperiodInput = document.getElementById('roomPhotoperiod');
    if (photoperiodInput) {
      photoperiodInput.addEventListener('input', (e) => {
        const v = Number(e.target.value || 0);
        this.data.photoperiod = Number.isFinite(v) ? Math.max(0, v) : 0;
        this.updateSetupQueue();
      });
    }
    const energyHoursInput = document.getElementById('roomEnergyHours');
    if (energyHoursInput) {
      energyHoursInput.addEventListener('input', (e) => {
        const v = Number(e.target.value || 0);
        this.data.energyHours = Number.isFinite(v) ? Math.max(0, Math.min(24, v)) : 0;
        this.updateSetupQueue();
      });
    }
    // Auto-advance hooks: room name and location
    const roomNameInput = document.getElementById('roomName');
    if (roomNameInput) {
      roomNameInput.addEventListener('input', (e) => {
        this.data.name = (e.target.value || '').trim();
        // try auto-advancing if enabled and we're on the name step
        this.tryAutoAdvance();
        this.updateSetupQueue();
      });
    }
    const roomLocationSelect = document.getElementById('roomLocationSelect');
    if (roomLocationSelect) {
      roomLocationSelect.addEventListener('change', (e) => {
        this.data.location = (e.target.value || '').trim();
        this.tryAutoAdvance();
        this.updateSetupQueue();
      });
    }
    const zoneInput = document.getElementById('roomZoneInput');
    const zoneAdd = document.getElementById('roomZoneAdd');
    if (zoneAdd) zoneAdd.addEventListener('click', () => this.handleZoneAdd());
    if (zoneInput) {
      zoneInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.handleZoneAdd(); }
      });
    }
    const zoneList = document.getElementById('roomZoneList');
    if (zoneList) {
      zoneList.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-zone-idx]');
        if (!btn) return;
        const idx = Number(btn.getAttribute('data-zone-idx'));
        if (!Number.isNaN(idx)) this.removeZone(idx);
      });
    }
  // Upload nameplate / datasheet to create unknown device placeholder
    const uploadBtn = document.getElementById('roomKbUploadBtn');
    const uploadInput = document.getElementById('roomKbUpload');
    if (uploadBtn && uploadInput) {
      uploadBtn.addEventListener('click', () => uploadInput.click());
      uploadInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        // Create a placeholder KB entry and mark as 'needs-research'
        const placeholder = { vendor: 'Unknown', model: file.name, watts: null, control: null, tags: ['unknown'], confidence: 0, _uploaded: true };
        // push into selected fixtures for this room
        this.data.fixtures = this.data.fixtures || [];
        this.data.fixtures.push({ ...placeholder, count: 1, note: 'Uploaded nameplate/datasheet - needs research' });
        this.renderKbSelected();
        showToast({ title: 'Uploaded', msg: `Added placeholder for ${file.name}. We can research this entry later.`, kind: 'info', icon: 'ℹ️' }, 5000);
        this.updateSetupQueue();
        // clear input
        uploadInput.value = '';
      });
    }
    fResults?.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-action]'); if (!btn) return;
      const action = btn.dataset.action;
      const idx = Number(btn.dataset.idx||-1);
      const item = STATE.deviceKB.fixtures?.[idx]; if (!item) return;
      if (action === 'add-kb') {
        this.data.fixtures.push({ ...item, count: 1 });
      } else if (action === 'add-unknown') {
        // Create a placeholder variant of the KB item for later research
        const placeholder = {
          vendor: item.vendor || 'Unknown',
          model: item.model || 'Unknown',
          watts: item.watts || null,
          control: item.control || null,
          tags: Array.from(new Set([...(item.tags||[]), 'unknown'])),
          confidence: 0,
          _uploaded: true,
          count: 1,
          note: 'Added as unknown from KB - needs research'
        };
        this.data.fixtures.push(placeholder);
      }
      else if (action === 'add-research') {
        // Create research queue placeholder and persist to ./data/research-queue.json
        const placeholder = {
          id: `rq-${Date.now().toString(36)}`,
          vendor: item.vendor || 'Unknown',
          model: item.model || 'Unknown',
          watts: item.watts || null,
          control: item.control || null,
          tags: Array.from(new Set([...(item.tags||[]), 'research'])),
          confidence: item.confidence || 0,
          source: 'kb',
          created_at: new Date().toISOString(),
          note: 'Added to research queue from KB results'
        };
        // Append to in-memory research queue (for UI if needed)
        window.RESEARCH_QUEUE = window.RESEARCH_QUEUE || [];
        window.RESEARCH_QUEUE.push(placeholder);
        // Persist via saveJSON to the server-side data folder
        (async () => {
          // Load existing queue if any
          let current = await loadJSON('./data/research-queue.json') || { items: [] };
          current.items = current.items || [];
          current.items.push(placeholder);
          const ok = await saveJSON('./data/research-queue.json', current);
          if (ok) showToast({ title: 'Queued', msg: `${placeholder.vendor} ${placeholder.model} added to research queue`, kind: 'info', icon: '📝' }, 4000);
          else showToast({ title: 'Queue save failed', msg: 'Could not persist research item; it will remain in memory for this session', kind: 'warn', icon: '⚠️' }, 6000);
        })();
      }
      this.renderKbSelected();
      fResults.innerHTML = ''; fSearch.value='';
      // After adding fixtures, re-run inference
      this.inferSensors();
      this.updateSetupQueue();
      // If auto-advance is enabled, attempt to progress when fixtures have been added
      if (this.autoAdvance) setTimeout(()=> this.tryAutoAdvance(), 120);
    });

    const hwSearch = document.getElementById('roomDeviceSearch');
    const hwResults = document.getElementById('roomDeviceSearchResults');
    if (hwSearch) {
      hwSearch.addEventListener('input', () => this.updateHardwareSearch(hwSearch.value.trim()));
    }
    if (hwResults) {
      hwResults.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-idx]');
        if (!btn) return;
        const idx = Number(btn.dataset.idx || -1);
        if (Number.isNaN(idx)) return;
        const suggestion = this.hardwareSearchResults[idx];
        if (suggestion) this.applyHardwareSuggestion(suggestion);
      });
    }

    // Sensors (multi-select checkboxes). Keep labels visually in sync by toggling data-active on the parent label.
    const roomSensorHost = $('#roomSensorCats');
    if (roomSensorHost) {
      roomSensorHost.addEventListener('change', () => {
        const boxes = Array.from(roomSensorHost.querySelectorAll('input[type="checkbox"]'));
        boxes.forEach(cb => {
          const lbl = cb.closest('.chip-option') || cb.parentElement;
          if (!lbl) return;
          if (cb.checked) lbl.setAttribute('data-active',''); else lbl.removeAttribute('data-active');
        });
        const cats = boxes.filter(b=>b.checked).map(i=>i.value);
        this.data.sensors.categories = cats;
        this.updateSetupQueue();
      });
      // Also support clicking the label area to toggle the checkbox and update state visually
      roomSensorHost.querySelectorAll('.chip-option').forEach(lbl => {
        lbl.addEventListener('click', (e) => {
          const cb = lbl.querySelector('input[type="checkbox"]');
          if (!cb) return;
          // allow native toggle to occur then sync on next tick
          setTimeout(()=> {
            if (cb.checked) lbl.setAttribute('data-active',''); else lbl.removeAttribute('data-active');
            const cats = Array.from(roomSensorHost.querySelectorAll('input[type="checkbox"]:checked')).map(i=>i.value);
            this.data.sensors.categories = cats;
            this.updateSetupQueue();
          }, 0);
        });
      });
      roomSensorHost.querySelectorAll('.sensor-location').forEach(sel => {
        sel.addEventListener('change', () => {
          const key = sel.getAttribute('data-sensor');
          if (!key) return;
          this.data.sensors = this.data.sensors || { categories: [], placements: {} };
          this.data.sensors.placements = this.data.sensors.placements || {};
          this.data.sensors.placements[key] = sel.value || '';
          this.updateSetupQueue();
        });
      });
    }

    // Devices management (for smart devices / hubs)
    $('#roomAddDeviceBtn')?.addEventListener('click', () => {
      const name = ($('#roomDeviceName')?.value || '').trim();
      const vendor = ($('#roomDeviceVendor')?.value || '').trim();
      const model = ($('#roomDeviceModel')?.value || '').trim();
      const host = ($('#roomDeviceHost')?.value || '').trim();
      if (!name) return alert('Enter a device name');
      // Collect setup subform values if present
      const setup = {};
      // Clear any previous inline errors and invalid markers
      const errHost = document.getElementById('roomDeviceInlineError'); if (errHost) errHost.textContent = '';
      let fatalError = false;
      const invalidEls = [];
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
        // Validate RS-485 unit id (Modbus: 1-247) and baud
        if (rsHost || rsUnit) {
          const validUnit = (rsUnit === null) || (Number.isInteger(rsUnit) && rsUnit >= 1 && rsUnit <= 247);
          const commonBaud = ['9600','19200','38400','115200','4800','57600'];
          const validBaud = !rsBaud || commonBaud.includes(String(rsBaud));
          // Clear previous field errors
          clearFieldError('deviceRs485UnitId');
          if (!validUnit) {
            // Block adding device on invalid unit id
            fatalError = true;
            const msg = 'RS-485 Unit ID must be an integer between 1 and 247';
            showToast({ title: 'RS-485 invalid', msg, kind: 'warn', icon: '⚠️' });
            setFieldError('deviceRs485UnitId', msg);
            const el = document.getElementById('deviceRs485UnitId'); if (el) invalidEls.push(el);
          }
          if (!validBaud) {
            // Non-fatal advisory for uncommon baud
            showToast({ title: 'RS-485 baud', msg: `Uncommon baud rate: ${rsBaud}. Examples: ${commonBaud.join(', ')}`, kind: 'info', icon: 'ℹ️' });
          }
          if (validUnit && !fatalError) setup.rs485 = { host: rsHost || null, unitId: rsUnit, baud: rsBaud || null };
        }
      }
      // 0-10V
      if (document.getElementById('deviceSetup-0-10v')?.style.display !== 'none') {
        const ch = ($('#device0v10Channel')?.value || '').trim();
        const scale = ($('#device0v10Scale')?.value || '').trim();
        // Validate channel (non-empty) and numeric scale (e.g., 0-100)
        if (ch || scale) {
          const validCh = !!ch;
          const scaleNum = Number(scale || NaN);
          const validScale = !scale || (!Number.isNaN(scaleNum) && scaleNum >= 0 && scaleNum <= 1000);
          // Clear previous field errors
          clearFieldError('device0v10Channel'); clearFieldError('device0v10Scale');
          if (!validCh) {
            fatalError = true;
            const msg = '0-10V channel is required for 0-10V setup';
            showToast({ title: '0-10V invalid', msg, kind: 'warn', icon: '⚠️' });
            setFieldError('device0v10Channel', msg);
            const el = document.getElementById('device0v10Channel'); if (el) invalidEls.push(el);
          }
          if (!validScale) {
            fatalError = true;
            const msg = '0-10V scale must be numeric (e.g., 0-100)';
            showToast({ title: '0-10V scale', msg, kind: 'warn', icon: '⚠️' });
            setFieldError('device0v10Scale', msg);
            const el2 = document.getElementById('device0v10Scale'); if (el2) invalidEls.push(el2);
          }
          if (validCh && validScale && !fatalError) setup['0-10v'] = { channel: ch || null, scale: scale || null };
        }
      }

      if (fatalError) {
        // Mark invalid inputs and focus the first one
        invalidEls.forEach(el => el.classList.add('invalid'));
        if (invalidEls.length) {
          const firstInvalid = invalidEls[0];
          firstInvalid.focus();
          try { firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e) { /* ignore */ }
        }
        // Do not add device if fatal validation failed
        setStatus('Device not added due to validation errors');
        return;
      }
      this.data.devices = this.data.devices || [];
      this.data.devices.push({ name, vendor, model, host, setup });
      ($('#roomDeviceName')?.value) && ($('#roomDeviceName').value = '');
      ($('#roomDeviceVendor')?.value) && ($('#roomDeviceVendor').value = '');
      ($('#roomDeviceModel')?.value) && ($('#roomDeviceModel').value = '');
      ($('#roomDeviceHost')?.value) && ($('#roomDeviceHost').value = '');
      // Clear subforms and invalid markers (also clear inline error nodes)
      ['deviceWifiSsid','deviceWifiPsk','deviceWifiStatic','deviceWifiStaticIp','deviceBtName','deviceBtPin','deviceRs485Host','deviceRs485UnitId','deviceRs485Baud','device0v10Channel','device0v10Scale'].forEach(id=>{
        const el = document.getElementById(id);
        if (el) {
          if (el.type === 'checkbox') el.checked = false; else el.value = '';
          // remove visual invalid marker and inline error message
          try { clearFieldError(id); } catch(e){ if (el.classList) el.classList.remove('invalid'); }
        }
      });
      this.renderDevicesList();
      this.updateSetupQueue();
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
        this.updateSetupQueue();
      }
    });

    // Toggle static IP input
    const wifiStatic = $('#deviceWifiStatic');
    wifiStatic?.addEventListener('change', (e)=>{
      const ip = $('#deviceWifiStaticIp'); if (!ip) return;
      ip.style.display = wifiStatic.checked ? 'inline-block' : 'none';
    });

    // Clear invalid class on input/change/focus for device setup fields so users get immediate feedback removal
    const clearOnInput = (id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => clearFieldError(id));
      el.addEventListener('change', () => clearFieldError(id));
      el.addEventListener('focus', () => clearFieldError(id));
    };
    ['deviceRs485UnitId','device0v10Channel','device0v10Scale','deviceRs485Host','deviceWifiSsid','deviceWifiPsk','deviceBtName','deviceBtPin'].forEach(clearOnInput);

    // Demo SwitchBot devices button
    $('#roomDemoSwitchBot')?.addEventListener('click', () => {
      this.addDemoSwitchBotDevices();
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

    $('#catPrevType')?.addEventListener('click', () => this.stepCategory(-1));
    $('#catNextType')?.addEventListener('click', () => this.stepCategory(1));

    // Control method chips (buttons wired dynamically when showing control step)
    // Hardware categories (new step)
    // Use delegated click handling on the container so handlers are robust and not overwritten later.
    const hwHost = document.getElementById('roomHardwareCats');
    if (hwHost) {
      hwHost.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-option');
        if (!btn || !hwHost.contains(btn)) return;
        // Toggle visual active state
        if (btn.hasAttribute('data-active')) btn.removeAttribute('data-active'); else btn.setAttribute('data-active','');
        // normalize selections into this.data.hardwareCats
        const active = Array.from(hwHost.querySelectorAll('.chip-option[data-active]')).map(b=>b.dataset.value);
        // Preserve selection order by tracking the sequence in data.hardwareOrder
        this.data.hardwareOrder = this.data.hardwareOrder || [];
        // Rebuild order: keep prior order for any still-active, then append newly active at the end
        const prior = Array.isArray(this.data.hardwareOrder) ? this.data.hardwareOrder.filter(v => active.includes(v)) : [];
        const newly = active.filter(v => !prior.includes(v));
        this.data.hardwareOrder = [...prior, ...newly];
        this.data.hardwareCats = active;
        // Debug help: visible in browser console to trace clicks
        console.debug('[RoomWizard] hardware toggle', { value: btn.dataset.value, active });
        // Recompute dynamic steps as categories change (only when we're on or past hardware step)
        this.rebuildDynamicSteps();
        this.updateSetupQueue();
      });
    }

    const hubRadios = document.querySelectorAll('input[name="roomHubPresence"]');
    if (hubRadios && hubRadios.length) {
      hubRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
          const val = e.target.value;
          this.data.connectivity = this.data.connectivity || { hasHub: null, hubType: '', hubIp: '', cloudTenant: 'Azure' };
          this.data.connectivity.hasHub = val === 'yes' ? true : val === 'no' ? false : null;
          this.updateSetupQueue();
        });
      });
    }
    $('#roomHubDetect')?.addEventListener('click', () => this.detectHub());
    $('#roomHubVerify')?.addEventListener('click', () => this.verifyHub());
    $('#roomDeviceScan')?.addEventListener('click', () => this.scanLocalDevices());

    $('#roomHubType')?.addEventListener('input', (e) => {
      this.data.connectivity = this.data.connectivity || {};
      this.data.connectivity.hubType = (e.target.value || '').trim();
      this.updateSetupQueue();
    });
    $('#roomHubIp')?.addEventListener('input', (e) => {
      this.data.connectivity = this.data.connectivity || {};
      this.data.connectivity.hubIp = (e.target.value || '').trim();
      this.updateSetupQueue();
    });
    $('#roomCloudTenant')?.addEventListener('input', (e) => {
      this.data.connectivity = this.data.connectivity || {};
      this.data.connectivity.cloudTenant = (e.target.value || '').trim();
      this.updateSetupQueue();
    });

    const bindRoleInput = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        this.setRoleList(key, el.value);
        this.updateSetupQueue();
      });
    };
    bindRoleInput('roomRoleAdmin', 'admin');
    bindRoleInput('roomRoleOperator', 'operator');
    bindRoleInput('roomRoleViewer', 'viewer');

    const groupInput = document.getElementById('roomGroupNameInput');
    if (groupInput) {
      groupInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); this.addGroupFromInput(); }
      });
    }
    $('#roomGroupAdd')?.addEventListener('click', () => this.addGroupFromInput());
    const groupSuggestions = document.getElementById('roomGroupSuggestions');
    if (groupSuggestions) {
      groupSuggestions.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-group]');
        if (!btn) return;
        this.addGroup(btn.getAttribute('data-group') || '');
      });
    }
    const groupList = document.getElementById('roomGroupList');
    if (groupList) {
      groupList.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-group-idx]');
        if (!btn) return;
        const idx = Number(btn.getAttribute('data-group-idx'));
        if (!Number.isNaN(idx)) this.removeGroup(idx);
      });
    }
    $('#roomGroupPlan')?.addEventListener('change', (ev) => {
      this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '', spectraSync: true };
      this.data.grouping.planId = ev.target.value || '';
      this.updateSetupQueue();
    });
    $('#roomGroupSchedule')?.addEventListener('change', (ev) => {
      this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '', spectraSync: true };
      this.data.grouping.scheduleId = ev.target.value || '';
      this.updateSetupQueue();
    });
    const spectraChk = document.getElementById('roomGroupSpectraSync');
    if (spectraChk) {
      spectraChk.addEventListener('change', (ev) => {
        this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '', spectraSync: true };
        this.data.grouping.spectraSync = !!ev.target.checked;
      });
    }
  }

  open(room = null) {
    this.currentStep = 0;
    const base = {
      id: '',
      name: '',
      location: '',
      hardwareCats: [],
      hardwareOrder: [],
      layout: { type: '', rows: 0, racks: 0, levels: 0 },
      zones: [],
      fixtures: [],
      controlMethod: null,
      devices: [],
      sensors: { categories: [], placements: {} },
      energy: '',
      energyHours: 0,
      targetPpfd: 0,
      photoperiod: 0,
      connectivity: { hasHub: null, hubType: '', hubIp: '', cloudTenant: 'Azure' },
      roles: { admin: [], operator: [], viewer: [] },
      grouping: { groups: [], planId: '', scheduleId: '', spectraSync: true },
      seriesCount: 0
    };
    if (room) {
      const clone = JSON.parse(JSON.stringify(room));
      this.data = {
        ...base,
        ...clone,
        layout: { ...base.layout, ...(clone.layout || {}) },
        sensors: { ...base.sensors, ...(clone.sensors || {}) },
        connectivity: { ...base.connectivity, ...(clone.connectivity || {}) },
        roles: { ...base.roles, ...(clone.roles || {}) },
        grouping: { ...base.grouping, ...(clone.grouping || {}) }
      };
      if (!Array.isArray(this.data.hardwareOrder) || !this.data.hardwareOrder.length) {
        this.data.hardwareOrder = Array.isArray(this.data.hardwareCats) ? this.data.hardwareCats.slice() : [];
      }
      if (!this.data.sensors.placements) this.data.sensors.placements = {};
    } else {
      this.data = { ...base };
    }
    // Restore per-category progress if present on room record or local storage
    this.categoryProgress = (this.data._categoryProgress && JSON.parse(JSON.stringify(this.data._categoryProgress))) || (()=>{ try { const s = JSON.parse(localStorage.getItem('gr.roomWizard.progress')||'null'); return s?.categoryProgress||{}; } catch { return {}; } })();
    // If categories were already chosen, build the dynamic steps and position to first incomplete category
    try { this.rebuildDynamicSteps(); } catch {}
    this.showStep(0);
    this.modal.setAttribute('aria-hidden','false');
    // Prefill lists
    this.renderKbSelected();
    this.populateLocationSelect();
    this.renderDevicesList();
    this.renderZoneList();
    this.renderGroupList();
    this.updateGroupSuggestions();
    this.updateHardwareSearch('');
    this.updateSetupQueue();
    // If we have a queue and any incomplete categories, jump to category-setup at first incomplete
    try {
      if ((this.data.hardwareCats||[]).length) {
        const queue = this.categoryQueue || [];
        const firstIncompleteIdx = queue.findIndex(c => (this.categoryProgress?.[c]?.status || 'not-started') !== 'complete');
        if (firstIncompleteIdx >= 0) {
          const stepIdx = this.steps.indexOf('category-setup');
          if (stepIdx >= 0) { this.currentStep = stepIdx; this.categoryIndex = firstIncompleteIdx; this.showStep(stepIdx); }
        }
      }
    } catch {}
  }

  close(){ this.modal.setAttribute('aria-hidden','true'); }

  showStep(index) {
    document.querySelectorAll('.room-step').forEach(step => step.removeAttribute('data-active'));
    const el = document.querySelector(`.room-step[data-step="${this.steps[index]}"]`);
    if (el) el.setAttribute('data-active', '');
    $('#roomModalProgress').textContent = `Step ${index + 1} of ${this.steps.length}`;
    const prev = $('#roomPrev'); const next = $('#roomNext'); const save = $('#btnSaveRoom');
    prev.style.display = index === 0 ? 'none' : 'inline-block';
    if (index === this.steps.length - 1) { next.style.display = 'none'; save.style.display = 'inline-block'; this.updateReview(); }
    else { next.style.display = 'inline-block'; save.style.display = 'none'; }

    const stepKey = this.steps[index];
    if (stepKey === 'room-name') {
      const nameInput = document.getElementById('roomName');
      if (nameInput) nameInput.value = this.data.name || '';
    }
    if (stepKey === 'location') {
      const sel = document.getElementById('roomLocationSelect');
      if (sel) sel.value = this.data.location || '';
    }
    if (stepKey === 'layout') {
      const type = this.data.layout?.type || '';
      document.querySelectorAll('#roomLayoutType .chip-option').forEach(btn => {
        if (btn.dataset.value === type) btn.setAttribute('data-active', ''); else btn.removeAttribute('data-active');
      });
      const rows = document.getElementById('roomRows'); if (rows) rows.value = String(this.data.layout?.rows ?? 0);
      const racks = document.getElementById('roomRacks'); if (racks) racks.value = String(this.data.layout?.racks ?? 0);
      const levels = document.getElementById('roomLevels'); if (levels) levels.value = String(this.data.layout?.levels ?? 0);
    }
    if (stepKey === 'zones') {
      this.renderZoneList();
    }
    if (stepKey === 'hardware') {
      const hwContainer = document.getElementById('roomHardwareCats');
      if (hwContainer) {
        const active = this.data.hardwareCats || [];
        hwContainer.querySelectorAll('.chip-option').forEach(b => {
          if (active.includes(b.dataset.value)) b.setAttribute('data-active', ''); else b.removeAttribute('data-active');
        });
      }
    }
    if (stepKey === 'category-setup') {
      if (this.categoryIndex < 0) this.categoryIndex = 0;
      this.renderCurrentCategoryForm();
      this.wireCategoryActions();
      this.updateCategoryNav();
    }
    if (stepKey === 'fixtures') {
      const seriesInput = document.getElementById('roomSeriesCount');
      if (seriesInput) seriesInput.value = String(this.data.seriesCount ?? 0);
      const target = document.getElementById('roomTargetPpfd'); if (target) target.value = String(this.data.targetPpfd ?? 0);
      const photo = document.getElementById('roomPhotoperiod'); if (photo) photo.value = String(this.data.photoperiod ?? 0);
    }
    if (stepKey === 'control') {
      const container = document.getElementById('roomControlMethod');
      if (!container) return;
      container.querySelectorAll('.chip-option').forEach(b => {
        b.classList.remove('active');
        if (this.data.controlMethod && b.dataset.value === this.data.controlMethod) b.classList.add('active');
        b.onclick = () => {
          const v = b.dataset.value;
          this.data.controlMethod = v;
          container.querySelectorAll('.chip-option').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          document.getElementById('roomControlDetails').textContent = this.controlHintFor(v);
          this.inferSensors();
          const smart = ['wifi', 'smart-plug', 'rs485', 'other'].includes(v);
          const devicesStepEl = document.querySelector('.room-step[data-step="devices"]');
          if (devicesStepEl) devicesStepEl.style.display = smart ? 'block' : 'none';
          if (this.autoAdvance) setTimeout(() => this.tryAutoAdvance(), 80);
        };
      });
      if (this.data.controlMethod) document.getElementById('roomControlDetails').textContent = this.controlHintFor(this.data.controlMethod);
    }
    if (stepKey === 'sensors') {
      const container = document.getElementById('roomSensorCats');
      if (!container) return;
      container.querySelectorAll('input[type=checkbox]').forEach(cb => {
        const lbl = cb.closest('.chip-option') || cb.parentElement;
        cb.checked = (this.data.sensors.categories || []).includes(cb.value);
        if (cb.checked) lbl?.setAttribute('data-active', ''); else lbl?.removeAttribute('data-active');
        cb.onchange = () => {
          if (cb.checked) lbl?.setAttribute('data-active', ''); else lbl?.removeAttribute('data-active');
          this.data.sensors.categories = Array.from(container.querySelectorAll('input:checked')).map(i => i.value);
        };
        lbl?.addEventListener('click', () => setTimeout(() => cb.dispatchEvent(new Event('change')), 0));
      });
      container.querySelectorAll('.sensor-location').forEach(sel => {
        const key = sel.getAttribute('data-sensor');
        if (!key) return;
        const val = this.data.sensors?.placements?.[key] || '';
        sel.value = val;
      });
    }
    if (stepKey === 'devices') {
      const cm = this.data.controlMethod;
      const smart = ['wifi', 'smart-plug', 'rs485', 'other'].includes(cm);
      const devicesStepEl = document.querySelector('.room-step[data-step="devices"]');
      if (devicesStepEl) devicesStepEl.style.display = smart ? 'block' : 'none';
      this.renderDevicesList();
    }
    if (stepKey === 'connectivity') {
      const hub = this.data.connectivity || {};
      document.querySelectorAll('input[name="roomHubPresence"]').forEach(radio => {
        if (hub.hasHub === null) radio.checked = false;
        else radio.checked = (hub.hasHub && radio.value === 'yes') || (!hub.hasHub && radio.value === 'no');
      });
      const hubType = document.getElementById('roomHubType'); if (hubType) hubType.value = hub.hubType || '';
      const hubIp = document.getElementById('roomHubIp'); if (hubIp) hubIp.value = hub.hubIp || '';
      const tenant = document.getElementById('roomCloudTenant'); if (tenant) tenant.value = hub.cloudTenant || '';
      const roles = this.data.roles || {};
      const adminInput = document.getElementById('roomRoleAdmin'); if (adminInput) adminInput.value = (roles.admin || []).join(', ');
      const opInput = document.getElementById('roomRoleOperator'); if (opInput) opInput.value = (roles.operator || []).join(', ');
      const viewerInput = document.getElementById('roomRoleViewer'); if (viewerInput) viewerInput.value = (roles.viewer || []).join(', ');
      const statusEl = document.getElementById('roomHubStatus');
      if (statusEl) {
        if (hub.hasHub) statusEl.textContent = hub.hubIp ? `Hub recorded at ${hub.hubIp}. Verify Node-RED when ready.` : 'Hub recorded. Add IP to enable edge control.';
        else statusEl.textContent = '';
      }
    }
    if (stepKey === 'energy') {
      document.querySelectorAll('#roomEnergy .chip-option').forEach(btn => {
        if (btn.dataset.value === this.data.energy) btn.setAttribute('data-active', ''); else btn.removeAttribute('data-active');
      });
      const hours = document.getElementById('roomEnergyHours');
      if (hours) hours.value = String(this.data.energyHours ?? 0);
    }
    if (stepKey === 'grouping') {
      this.populateGroupingSelectors();
    }
    if (stepKey === 'review') {
      this.updateReview();
    }
  }

  // Silent validation used by auto-advance (no alerts/confirms)
  silentValidateCurrentStep(){
    const step = this.steps[this.currentStep];
    switch(step){
      case 'room-name': {
        const v = ($('#roomName')?.value||'').trim(); return !!v; }
      case 'location': {
        const v = ($('#roomLocationSelect')?.value || '').trim(); return !!v; }
      case 'layout': return true;
      case 'zones': return Array.isArray(this.data.zones) && this.data.zones.length > 0;
      case 'hardware': return false; // multi-select; don't auto-advance here
      case 'category-setup': return true; // allow auto-advance if user clicks next; forms are optional counts
      case 'fixtures': return (Array.isArray(this.data.fixtures) && this.data.fixtures.length>0);
      case 'control': return !!this.data.controlMethod;
      case 'devices': return false;
      case 'sensors': return Array.isArray(this.data.sensors?.categories) && this.data.sensors.categories.length > 0;
      case 'connectivity': {
        const conn = this.data.connectivity || {};
        return conn.hasHub !== null;
      }
      case 'energy': return !!this.data.energy;
      case 'grouping': return Array.isArray(this.data.grouping?.groups) && this.data.grouping.groups.length > 0;
      case 'review': return false;
    }
    return false;
  }

  // Attempt to auto-advance when silent validation passes for the current step
  tryAutoAdvance(){
    if (!this.autoAdvance) return;
    // Only advance if not at last step
    if (this.currentStep >= this.steps.length - 1) return;
    try {
      if (this.silentValidateCurrentStep()) {
        // Use normal validateCurrentStep to preserve any needed confirmations
        // but defer slightly so the UI can update first.
        setTimeout(()=>{ if (this.validateCurrentStep()) { this.currentStep++; this.showStep(this.currentStep); } }, 150);
      }
    } catch(e) { /* ignore auto-advance errors */ }
  }

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
      case 'zones': {
        const zones = Array.isArray(this.data.zones) ? this.data.zones : [];
        if (!zones.length) {
          const ok = confirm('No zones defined yet. Continue without zones?');
          if (!ok) return false;
        }
        break; }
      case 'hardware': {
        const cats = this.data.hardwareCats || [];
        if (!cats.length) { alert('Select at least one hardware category (e.g., lights, sensors)'); return false; }
        // When leaving hardware, build dynamic category queue and insert a single category-setup step if needed
        this.rebuildDynamicSteps();
        break; }
      case 'category-setup': {
        // Persist current category form values into this.data.
        this.captureCurrentCategoryForm();
        // Enforce completion before allowing Next to move to another step/category
        const catId = this.getCurrentCategoryId();
        const st = this.categoryProgress?.[catId]?.status;
        if (!st || st !== 'complete') {
          alert('This category is not confirmed yet. Run Test Control and confirm before proceeding.');
          return false;
        }
        void this.persistProgress();
        break; }
      case 'fixtures': {
        const needsLights = (this.data.hardwareCats || []).includes('grow-lights');
        const fixtures = Array.isArray(this.data.fixtures) ? this.data.fixtures : [];
        if (needsLights && fixtures.length === 0) {
          const ok = confirm('No fixtures have been added yet. Continue without capturing them?');
          if (!ok) return false;
        }
        break; }
      case 'control': {
        const needsLights = (this.data.hardwareCats || []).includes('grow-lights');
        if (!this.data.controlMethod && needsLights) {
          const ok = confirm('No control method selected. Continue without control info?');
          if (!ok) return false;
        }
        break; }
      case 'devices': {
        const smartControl = ['wifi','smart-plug','rs485'].includes(this.data.controlMethod);
        if (smartControl && !(Array.isArray(this.data.devices) && this.data.devices.length)) {
          const ok = confirm('No connected devices were added for this control method. Continue?');
          if (!ok) return false;
        }
        break; }
      case 'sensors': {
        const selected = Array.isArray(this.data.sensors?.categories) ? this.data.sensors.categories : [];
        if (!selected.length) {
          const ok = confirm('No sensor categories selected. Continue without sensors?');
          if (!ok) return false;
        }
        break; }
      case 'connectivity': {
        const conn = this.data.connectivity || (this.data.connectivity = { hasHub: null, hubType: '', hubIp: '', cloudTenant: 'Azure' });
        const radios = document.querySelector('input[name="roomHubPresence"]:checked');
        if (radios) {
          conn.hasHub = radios.value === 'yes' ? true : radios.value === 'no' ? false : null;
        }
        if (conn.hasHub === null) { alert('Let us know if a local hub is present.'); return false; }
        conn.hubType = ($('#roomHubType')?.value || '').trim();
        conn.hubIp = ($('#roomHubIp')?.value || '').trim();
        conn.cloudTenant = ($('#roomCloudTenant')?.value || '').trim() || 'Azure';
        if (conn.hasHub && !conn.hubIp) { alert('Enter the hub IP address so we can link automations.'); return false; }
        if (!conn.hasHub && (this.data.hardwareCats || []).includes('controllers')) {
          const ok = confirm('Controllers were selected, but no hub is configured. Continue?');
          if (!ok) return false;
        }
        this.setRoleList('admin', ($('#roomRoleAdmin')?.value || ''));
        this.setRoleList('operator', ($('#roomRoleOperator')?.value || ''));
        this.setRoleList('viewer', ($('#roomRoleViewer')?.value || ''));
        break; }
      case 'grouping': {
        this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '', spectraSync: true };
        const planSel = document.getElementById('roomGroupPlan');
        const scheduleSel = document.getElementById('roomGroupSchedule');
        const spectraChk = document.getElementById('roomGroupSpectraSync');
        if (planSel) this.data.grouping.planId = planSel.value || '';
        if (scheduleSel) this.data.grouping.scheduleId = scheduleSel.value || '';
        if (spectraChk) this.data.grouping.spectraSync = !!spectraChk.checked;
        const groups = Array.isArray(this.data.grouping.groups) ? this.data.grouping.groups : [];
        if (!groups.length) {
          const needsGroups = (Array.isArray(this.data.zones) && this.data.zones.length) || (Array.isArray(this.data.devices) && this.data.devices.length);
          if (needsGroups) {
            const ok = confirm('No groups defined yet. Groups make it easier to assign plans and schedules. Continue without groups?');
            if (!ok) return false;
          }
        }
        break; }
      case 'energy': {
        const energy = this.data.energy;
        if (!energy) { alert('Select how energy will be monitored.'); return false; }
        const hours = Number(this.data.energyHours);
        if (energy !== 'none' && (!Number.isFinite(hours) || hours <= 0)) {
          const ok = confirm('Runtime hours are blank. Continue without estimating daily runtime?');
          if (!ok) return false;
        }
        break; }
    }
    return true;
  }

  // Build the dynamic category steps/queue based on selected hardware
  rebuildDynamicSteps() {
    const selected = Array.isArray(this.data.hardwareCats) ? this.data.hardwareCats.slice() : [];
    // Define which categories have micro-forms; order them after hardware and before fixtures
    const formCats = selected.filter(c => ['hvac','dehumidifier','fans','vents','irrigation','controllers','other'].includes(c));
    // Preserve user selection order using hardwareOrder we maintain on toggles
    const chipOrder = (Array.isArray(this.data.hardwareOrder) ? this.data.hardwareOrder : [])
      .filter(v => formCats.includes(v));
    this.categoryQueue = chipOrder;
    // Compute new steps list: replace any existing category-setup appearances with a single placeholder when queue non-empty
    const before = this.steps.slice();
    const idxHardware = this.baseSteps.indexOf('hardware');
    const idxFixtures = this.baseSteps.indexOf('fixtures');
    const newSteps = [];
    for (let i = 0; i < this.baseSteps.length; i++) {
      const k = this.baseSteps[i];
      newSteps.push(k);
      if (k === 'hardware' && this.categoryQueue.length) {
        // inject one "category-setup" placeholder right after hardware
        newSteps.push('category-setup');
      }
    }
    this.steps = newSteps;
    // Reset category index if we are at/after hardware
    if (this.currentStep >= this.steps.indexOf('hardware')) {
      // Map current step: if we're in category-setup, keep categoryIndex; else reset
      if (this.steps[this.currentStep] !== 'category-setup') this.categoryIndex = (this.categoryQueue.length ? 0 : -1);
    }
    // Update progress label to reflect potential step count change
    $('#roomModalProgress').textContent = `Step ${this.currentStep+1} of ${this.steps.length}`;
  }

  // Determine the current category id from categoryIndex
  getCurrentCategoryId() {
    if (this.categoryIndex < 0) return null;
    return this.categoryQueue[this.categoryIndex] || null;
  }

  // Render the micro-form for the current category
  renderCurrentCategoryForm() {
    const catId = this.getCurrentCategoryId();
    const titleEl = document.getElementById('catSetupTitle');
    const body = document.getElementById('catSetupBody');
    if (!titleEl || !body) return;
    if (!catId) {
      titleEl.textContent = 'Category setup';
      body.innerHTML = '<p class="tiny" style="color:#64748b">No categories selected that require setup.</p>';
      return;
    }
    const titles = {
      'hvac': 'HVAC setup',
      'dehumidifier': 'Dehumidifier setup',
      'fans': 'Fans setup',
      'vents': 'Vents setup',
      'irrigation': 'Irrigation setup',
      'controllers': 'Controllers / hubs setup',
      'other': 'Other equipment setup'
    };
    titleEl.textContent = titles[catId] || 'Category setup';
    // Render category-specific micro-forms (3-tap style where applicable)
    const v = (x)=> x==null? '' : String(x);
    const data = (this.data.category || (this.data.category = {}));
    const catData = (data[catId] || (data[catId] = {}));
    // Template helpers for chip groups
    const chipRow = (id, values, selected) => {
      return `<div class="chip-row" id="${id}">` + values.map(opt => `<button type="button" class="chip-option${selected===opt? ' active':''}" data-value="${opt}">${opt}</button>`).join('') + `</div>`;
    };
    let html = '';
    if (catId === 'hvac') {
      html = `
        <div class="tiny">HVAC units</div>
        <label class="tiny">How many? <input type="number" id="cat-hvac-count" min="0" value="${v(catData.count||0)}" style="width:80px"></label>
        <div class="tiny" style="margin-top:6px">Control</div>
        ${chipRow('cat-hvac-control', ['Thermostat','Modbus/BACnet','Relay','Other'], catData.control)}
        <div class="tiny" style="margin-top:6px">Energy</div>
        ${chipRow('cat-hvac-energy', ['Built-in','CT/branch','None'], catData.energy)}
      `;
    } else if (catId === 'dehumidifier') {
      html = `
        <div class="tiny">Dehumidifiers</div>
        <label class="tiny">How many? <input type="number" id="cat-dehu-count" min="0" value="${v(catData.count||0)}" style="width:80px"></label>
        <div class="tiny" style="margin-top:6px">Control</div>
        ${chipRow('cat-dehu-control', ['Smart plug','Relay','Other'], catData.control)}
        <div class="tiny" style="margin-top:6px">Energy</div>
        ${chipRow('cat-dehu-energy', ['Built-in','CT/branch','None'], catData.energy)}
      `;
    } else if (catId === 'fans') {
      html = `
        <div class="tiny">Fans</div>
        <label class="tiny">How many? <input type="number" id="cat-fans-count" min="0" value="${v(catData.count||0)}" style="width:80px"></label>
        <div class="tiny" style="margin-top:6px">Control</div>
        ${chipRow('cat-fans-control', ['Smart plug','0-10V/VFD','Other'], catData.control)}
      `;
    } else if (catId === 'vents') {
      html = `
        <div class="tiny">Vents</div>
        <label class="tiny">How many? <input type="number" id="cat-vents-count" min="0" value="${v(catData.count||0)}" style="width:80px"></label>
        <div class="tiny" style="margin-top:6px">Control</div>
        ${chipRow('cat-vents-control', ['Relay','0-10V','Other'], catData.control)}
      `;
    } else if (catId === 'irrigation') {
      html = `
        <div class="tiny">Irrigation / pumps</div>
        <label class="tiny">Zones <input type="number" id="cat-irr-zones" min="0" value="${v(catData.zones||0)}" style="width:100px"></label>
        <div class="tiny" style="margin-top:6px">Control</div>
        ${chipRow('cat-irr-control', ['Relay','Smart plug','Other'], catData.control)}
      `;
    } else if (catId === 'controllers') {
      html = `
        <div class="tiny">Controllers / hubs</div>
        <div class="tiny" style="color:#64748b;margin-bottom:4px">If fixtures require a hub, set it up first in the next Devices step.</div>
        <label class="tiny">How many hubs? <input type="number" id="cat-ctl-count" min="0" value="${v(catData.count||0)}" style="width:90px"></label>
      `;
    } else {
      html = `
        <div class="tiny">Other equipment</div>
        <label class="tiny">Describe <input type="text" id="cat-other-notes" value="${v(catData.notes||'')}" placeholder="e.g., CO₂ burner" style="min-width:220px"></label>
      `;
    }
    body.innerHTML = html;
    // Wire chip groups to update data
    body.querySelectorAll('.chip-row').forEach(row => {
      row.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-option'); if (!btn) return;
        row.querySelectorAll('.chip-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const val = btn.getAttribute('data-value');
        const id = row.getAttribute('id');
        if (id === 'cat-hvac-control') this.data.category.hvac.control = val;
        if (id === 'cat-hvac-energy') this.data.category.hvac.energy = val;
        if (id === 'cat-dehu-control') this.data.category.dehumidifier.control = val;
        if (id === 'cat-dehu-energy') this.data.category.dehumidifier.energy = val;
        if (id === 'cat-fans-control') this.data.category.fans.control = val;
        if (id === 'cat-vents-control') this.data.category.vents.control = val;
        if (id === 'cat-irr-control') this.data.category.irrigation.control = val;
      }, { once: false });
    });
  }

  // Capture inputs for the current category
  captureCurrentCategoryForm() {
    const catId = this.getCurrentCategoryId();
    if (!catId) return;
    const data = (this.data.category || (this.data.category = {}));
    const catData = (data[catId] || (data[catId] = {}));
    const getNum = (id) => { const el = document.getElementById(id); if (!el) return undefined; const n = Number(el.value||0); return Number.isFinite(n)? n: undefined; };
    const getStr = (id) => { const el = document.getElementById(id); return el ? (el.value||'').trim() : undefined; };
    if (catId === 'hvac') {
      catData.count = getNum('cat-hvac-count') ?? catData.count;
    }
    if (catId === 'dehumidifier') {
      catData.count = getNum('cat-dehu-count') ?? catData.count;
    }
    if (catId === 'fans') {
      catData.count = getNum('cat-fans-count') ?? catData.count;
    }
    if (catId === 'vents') {
      catData.count = getNum('cat-vents-count') ?? catData.count;
    }
    if (catId === 'irrigation') {
      catData.zones = getNum('cat-irr-zones') ?? catData.zones;
    }
    if (catId === 'controllers') {
      catData.count = getNum('cat-ctl-count') ?? catData.count;
    }
    if (catId === 'other') {
      catData.notes = getStr('cat-other-notes') ?? catData.notes;
    }
  }

  // Wire per-category action buttons: Test Control, Save & Continue, Save Done, Skip
  wireCategoryActions() {
    const status = document.getElementById('catSetupStatus');
    const statusLine = document.getElementById('catSetupStatusLine');
    const testBtn = document.getElementById('catTestControl');
    const saveCont = document.getElementById('catSaveContinue');
    const saveDone = document.getElementById('catSaveDone');
    const skip = document.getElementById('catSkip');
    const addNew = document.getElementById('catAddNew');
    const catId = this.getCurrentCategoryId();
    const mark = (st, note='', opts = {}) => {
      this.categoryProgress[catId] = this.categoryProgress[catId] || {};
      this.categoryProgress[catId].status = st;
      this.categoryProgress[catId].notes = note;
      if (status) status.textContent = this.categoryStatusMessage(st, note);
      if (statusLine && catId) statusLine.textContent = `Configuring ${this.categoryLabel(catId)} (${this.categoryIndex + 1} of ${this.categoryQueue.length || 1})`;
      this.updateCategoryNav();
      this.updateSetupQueue();
      if (opts.persist !== false) void this.persistProgress();
    };
    if (status) {
      const st = this.categoryProgress[catId]?.status || 'not-started';
      mark(st, this.categoryProgress[catId]?.notes || '', { persist: false });
    }

    testBtn?.addEventListener('click', async () => {
      // Minimal test flow per category. If lights present, send 45% HEX12 then revert.
      try {
        if (catId === 'grow-lights') {
          const lights = (STATE.devices||[]).filter(d=>d.type==='light' || /light|fixture/i.test(d.deviceName||''));
          const ids = lights.slice(0, Math.max(1, Math.min(3, lights.length))).map(d=>d.id);
          const onHex = buildHex12(45);
          await Promise.all(ids.map(id => patch(id, { status: 'on', value: onHex })));
          setTimeout(async ()=>{ try { await Promise.all(ids.map(id => patch(id, { status:'off' }))); } catch(e){} }, 1200);
          mark('complete');
        } else if (catId === 'sensors') {
          // Show a live sample if available
          mark('complete', 'Live values visible in Environment');
        } else if (catId === 'controllers') {
          // Probe forwarder health as a proxy for hub presence
          try {
            const r = await fetch('/forwarder/healthz');
            if (r.ok) { mark('complete', 'Hub reachable'); }
            else { mark('needs-hub', 'Hub not reachable'); }
          } catch {
            mark('needs-hub', 'Hub not reachable');
          }
        } else {
          // For HVAC/Dehu/Fans/Vents/Irrigation/Controllers, we can only mark as needs-setup unless devices added
          const hasDevices = Array.isArray(this.data.devices) && this.data.devices.length > 0;
          mark(hasDevices ? 'complete' : 'needs-setup');
        }
      } catch (e) {
        mark('needs-setup', e.message || String(e));
      }
    });

    saveCont?.addEventListener('click', () => {
      this.captureCurrentCategoryForm();
      // Enforce: every device must have a control method when applicable
      const requiresControl = ['hvac','dehumidifier','fans','vents','irrigation'].includes(catId);
      if (requiresControl) {
        const d = this.data.category?.[catId];
        if (!d || !d.control) { alert('Select a control method before continuing.'); return; }
      }
      // Require controlConfirmed for non-sensor categories unless user later resumes
      const st = this.categoryProgress[catId]?.status;
      if (!st || (st!=='complete')) { alert('Run Test Control and confirm before continuing.'); return; }
      // Advance within category queue
      this.nextStep();
    });

    saveDone?.addEventListener('click', async () => {
      this.captureCurrentCategoryForm();
      mark(this.categoryProgress[catId]?.status || 'needs-setup');
      this.close();
      showToast({ title:'Saved progress', msg:'You can resume this setup later from Grow Rooms.', kind:'info', icon:'📝' }, 4000);
    });

    skip?.addEventListener('click', async () => {
      mark('needs-setup');
      // Do not advance overall wizard step; allow user to proceed to next category only when they click Next
      showToast({ title:'Marked as skipped', msg:'This category is marked as Needs Setup.', kind:'warn', icon:'⚠️' }, 4000);
    });

    addNew?.addEventListener('click', () => {
      // Shortcut to devices step to add hardware, then return
      const targetIdx = this.steps.indexOf('devices');
      if (targetIdx >= 0) { this.currentStep = targetIdx; this.showStep(targetIdx); }
    });
  }

  async persistProgress() {
    try {
      const key = 'gr.roomWizard.progress';
      const state = { categoryProgress: this.categoryProgress, data: this.data, ts: Date.now() };
      localStorage.setItem(key, JSON.stringify(state));
      return true;
    } catch { return false; }
  }

  updateKbResults(q){
    const host = $('#roomKbResults'); if (!host) return;
    host.innerHTML = '';
    if (!q) return;
    const fixtures = STATE.deviceKB.fixtures || [];
    // Filter KB by query and by selected hardware categories (if any)
    const cats = this.data.hardwareCats || [];
    // Small category -> tag mapping to make category-first browsing deterministic
    const CATEGORY_TAG_MAP = {
      'grow-lights': ['led','bar','fixture','light'],
      'controllers': ['controller','driver','ballast'],
      'sensors': ['sensor','temp','humidity','ppfd','co2'],
      'hubs': ['hub','bridge']
    };
    const res = fixtures.map((it, idx)=>({it, idx}))
      .filter(({it})=>`${it.vendor} ${it.model}`.toLowerCase().includes(q.toLowerCase()))
      .filter(({it}) => {
        if (!cats.length) return true;
        const tagSet = new Set((it.tags||[]).map(t=>t.toLowerCase()));
        // If any selected category maps to tags that intersect the item tags, include it
        for (const c of cats) {
          const mapped = CATEGORY_TAG_MAP[c] || [c];
          if (mapped.some(t => tagSet.has(t))) return true;
        }
        // fallback: include if model or vendor contains category string
        return cats.every(c => (`${it.vendor} ${it.model}`.toLowerCase().includes(c.toLowerCase())));
      });
  if (!res.length) { host.innerHTML = '<li class="tiny" style="color:#64748b">No matches in knowledge base.</li>'; return; }
  host.innerHTML = res.map(({it, idx})=>`<li><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><div>${it.vendor} <strong>${it.model}</strong> • ${it.watts} W • ${it.control || ''}</div><div style="display:flex;gap:6px"><button type="button" class="ghost" data-action="add-kb" data-idx="${idx}">Add</button><button type="button" class="ghost" data-action="add-unknown" data-idx="${idx}">Add unknown</button><button type="button" class="ghost" data-action="add-research" data-idx="${idx}">Add to research queue</button></div></div></li>`).join('');
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
    const summarizeSetup = (s) => {
      if (!s) return '';
      const parts = [];
      if (s.wifi) parts.push(`Wi‑Fi: ${s.wifi.ssid || 'n/a'}`);
      if (s.bluetooth) parts.push(`BT: ${s.bluetooth.name || 'paired'}`);
      if (s['0-10v']) parts.push(`0‑10V: ch ${s['0-10v'].channel || '?'}${s['0-10v'].scale ? ` scale ${s['0-10v'].scale}` : ''}`);
      if (s.rs485) parts.push(`RS‑485: id ${s.rs485.unitId || '?'} @ ${s.rs485.baud || '?.?'} baud`);
      if (s.smartPlug || s['smart-plug']) parts.push('Smart‑plug');
      return parts.join(' • ');
    };

    ul.innerHTML = (this.data.devices||[]).map((d, i) => `
      <li>
        <div class="row" style="align-items:center;gap:6px">
          <div style="flex:1">
            <div><strong>${escapeHtml(d.name || '')}</strong> ${escapeHtml(d.vendor||'')} ${escapeHtml(d.model||'')} ${d.host?`• ${escapeHtml(d.host)}`:''}</div>
            <div class="tiny" style="color:#64748b;margin-top:4px">${escapeHtml(summarizeSetup(d.setup) || '')}</div>
          </div>
          <button type="button" class="ghost" data-action="remove-device" data-idx="${i}">×</button>
        </div>
      </li>
    `).join('');
    try {
      const statusEl = document.getElementById('deviceOnboardingStatus');
      if (statusEl) {
        const count = Array.isArray(this.data.devices) ? this.data.devices.length : 0;
        statusEl.textContent = count ? `${count} device${count === 1 ? '' : 's'} ready for mapping.` : 'No devices paired yet.';
      }
    } catch {}
    this.updateSetupQueue();
  }

  addGroupFromInput() {
    const input = document.getElementById('roomGroupNameInput');
    if (!input) return;
    const value = (input.value || '').trim();
    if (value) this.addGroup(value);
    input.value = '';
  }

  addGroup(name) {
    if (!name) return;
    this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '', spectraSync: true };
    const groups = Array.isArray(this.data.grouping.groups) ? this.data.grouping.groups : (this.data.grouping.groups = []);
    if (!groups.includes(name)) {
      groups.push(name);
      this.renderGroupList();
      this.updateGroupSuggestions();
      this.updateSetupQueue();
    }
  }

  removeGroup(idx) {
    this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '', spectraSync: true };
    const groups = Array.isArray(this.data.grouping.groups) ? this.data.grouping.groups : [];
    if (idx >= 0 && idx < groups.length) {
      groups.splice(idx, 1);
      this.renderGroupList();
      this.updateGroupSuggestions();
      this.updateSetupQueue();
    }
  }

  renderGroupList() {
    const list = document.getElementById('roomGroupList'); if (!list) return;
    const groups = Array.isArray(this.data.grouping?.groups) ? this.data.grouping.groups : [];
    if (!groups.length) {
      list.innerHTML = '<li class="tiny" style="color:#64748b">No groups yet.</li>';
      return;
    }
    list.innerHTML = groups.map((name, idx) => `
      <li class="row" style="align-items:center;justify-content:space-between">
        <span>${escapeHtml(name)}</span>
        <button type="button" class="ghost" data-group-idx="${idx}">Remove</button>
      </li>
    `).join('');
  }

  updateGroupSuggestions() {
    const host = document.getElementById('roomGroupSuggestions'); if (!host) return;
    const zones = Array.isArray(this.data.zones) ? this.data.zones : [];
    const current = new Set(Array.isArray(this.data.grouping?.groups) ? this.data.grouping.groups : []);
    const suggestions = zones.filter(z => !current.has(z));
    if (!suggestions.length) {
      host.innerHTML = '<span class="tiny" style="color:#94a3b8">No zone-based suggestions.</span>';
      return;
    }
    host.innerHTML = suggestions.map(z => `<button type="button" class="chip-option" data-group="${escapeHtml(z)}">${escapeHtml(z)}</button>`).join('');
  }

  populateGroupingSelectors() {
    const planSel = document.getElementById('roomGroupPlan');
    const schedSel = document.getElementById('roomGroupSchedule');
    if (planSel) {
      const plans = Array.isArray(STATE.plans) ? STATE.plans : [];
      const current = this.data.grouping?.planId || '';
      planSel.innerHTML = ['<option value="">Select plan…</option>', ...plans.map(p => `<option value="${escapeHtml(p.id || '')}">${escapeHtml(p.name || 'Plan')}</option>`)].join('');
      planSel.value = current || '';
    }
    if (schedSel) {
      const sched = Array.isArray(STATE.schedules) ? STATE.schedules : [];
      const current = this.data.grouping?.scheduleId || '';
      schedSel.innerHTML = ['<option value="">Select schedule…</option>', ...sched.map(s => `<option value="${escapeHtml(s.id || '')}">${escapeHtml(s.name || 'Schedule')}</option>`)].join('');
      schedSel.value = current || '';
    }
    const spectraChk = document.getElementById('roomGroupSpectraSync');
    if (spectraChk) spectraChk.checked = this.data.grouping?.spectraSync !== false;
    this.renderGroupList();
    this.updateGroupSuggestions();
  }

  async detectHub() {
    const status = document.getElementById('roomHubStatus');
    if (status) status.textContent = 'Detecting hub…';
    try {
      const resp = await fetch('/forwarder/healthz');
      if (resp.ok) {
        if (status) status.textContent = 'Controller reachable — hub likely online.';
        this.data.connectivity = this.data.connectivity || {};
        if (this.data.connectivity.hasHub !== false) this.data.connectivity.hasHub = true;
      } else {
        if (status) status.textContent = 'Hub not detected automatically. Enter IP manually.';
      }
    } catch (err) {
      if (status) status.textContent = 'Could not reach hub automatically. Enter the IP and tenant manually.';
    }
    this.updateSetupQueue();
  }

  async verifyHub() {
    const status = document.getElementById('roomHubStatus');
    if (status) status.textContent = 'Verifying Node-RED…';
    try {
      const resp = await fetch('/forwarder/healthz');
      if (resp.ok) {
        if (status) status.textContent = 'Forwarder healthy — confirm Node-RED flows are running on the hub for edge control.';
      } else {
        if (status) status.textContent = 'Forwarder returned an error. Ensure Node-RED is running on the local hub.';
      }
    } catch (err) {
      if (status) status.textContent = 'Unable to reach the hub right now. Check local connectivity and Node-RED status.';
    }
  }

  async scanLocalDevices() {
    const status = document.getElementById('deviceOnboardingStatus');
    if (status) status.textContent = 'Scanning local network for smart devices…';
    try {
      const resp = await fetch('/forwarder/network/scan');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json().catch(() => null);
      if (Array.isArray(data?.devices) && data.devices.length) {
        const summary = data.devices.slice(0, 5).map(d => `${d.vendor || d.brand || 'Device'} ${d.model || ''}`.trim()).join(', ');
        if (status) status.textContent = `Discovered ${data.devices.length} device(s): ${summary}${data.devices.length > 5 ? '…' : ''}`;
      } else {
        if (status) status.textContent = 'No known devices responded. Add them manually after completing vendor onboarding.';
      }
    } catch (err) {
      if (status) status.textContent = 'Scan unavailable in this environment. Enter tokens or IPs from the vendor apps.';
    }
  }

  handleZoneAdd() {
    const input = document.getElementById('roomZoneInput');
    if (!input) return;
    const value = (input.value || '').trim();
    if (!value) return;
    this.data.zones = Array.isArray(this.data.zones) ? this.data.zones : [];
    if (!this.data.zones.includes(value)) {
      this.data.zones.push(value);
      this.renderZoneList();
      this.updateSetupQueue();
    }
    input.value = '';
    try { input.focus(); } catch {}
  }

  removeZone(idx) {
    if (!Array.isArray(this.data.zones)) return;
    this.data.zones.splice(idx, 1);
    this.renderZoneList();
    this.updateSetupQueue();
  }

  renderZoneList() {
    const list = document.getElementById('roomZoneList');
    if (!list) return;
    const zones = Array.isArray(this.data.zones) ? this.data.zones : [];
    if (!zones.length) {
      list.innerHTML = '<li class="tiny" style="color:#64748b">No zones yet.</li>';
      this.updateGroupSuggestions();
      return;
    }
    list.innerHTML = zones.map((z, idx) => `
      <li class="row" style="align-items:center;justify-content:space-between">
        <span>${escapeHtml(z)}</span>
        <button type="button" class="ghost" data-zone-idx="${idx}">Remove</button>
      </li>
    `).join('');
    this.updateGroupSuggestions();
  }

  setRoleList(roleKey, raw) {
    this.data.roles = this.data.roles || { admin: [], operator: [], viewer: [] };
    const entries = (raw || '')
      .split(/[;,]/)
      .map(v => v.trim())
      .filter(Boolean);
    this.data.roles[roleKey] = entries;
  }

  mapControlToMethod(control) {
    if (!control) return null;
    const text = String(control).toLowerCase();
    if (text.includes('0-10')) return '0-10v';
    if (text.includes('modbus') || text.includes('rs485') || text.includes('bacnet')) return 'rs485';
    if (text.includes('smart plug') || text.includes('smart-plug') || text.includes('plug') || text.includes('kasa') || text.includes('switchbot')) return 'smart-plug';
    if (text.includes('wifi') || text.includes('wi-fi') || text.includes('cloud')) return 'wifi';
    return 'other';
  }

  ensureHardwareCategory(cat) {
    if (!cat) return;
    this.data.hardwareCats = Array.isArray(this.data.hardwareCats) ? this.data.hardwareCats : [];
    this.data.hardwareOrder = Array.isArray(this.data.hardwareOrder) ? this.data.hardwareOrder : [];
    if (!this.data.hardwareCats.includes(cat)) {
      this.data.hardwareCats.push(cat);
      if (!this.data.hardwareOrder.includes(cat)) this.data.hardwareOrder.push(cat);
      const host = document.getElementById('roomHardwareCats');
      if (host) {
        const btn = host.querySelector(`.chip-option[data-value="${cat}"]`);
        if (btn) btn.setAttribute('data-active', '');
      }
      this.rebuildDynamicSteps();
    } else {
      const host = document.getElementById('roomHardwareCats');
      if (host) {
        const btn = host.querySelector(`.chip-option[data-value="${cat}"]`);
        if (btn) btn.setAttribute('data-active', '');
      }
    }
    this.updateSetupQueue();
  }

  updateHardwareSearch(query) {
    const host = document.getElementById('roomDeviceSearchResults');
    if (!host) return;
    this.hardwareSearchResults = [];
    if (!query) {
      host.innerHTML = '<li class="tiny" style="color:#64748b">Search lights, hubs, smart plugs…</li>';
      return;
    }
    const q = query.toLowerCase();
    const results = [];
    const fixtures = (STATE.deviceKB?.fixtures || []).filter(item => `${item.vendor} ${item.model}`.toLowerCase().includes(q));
    fixtures.forEach(item => {
      results.push({
        kind: 'fixture',
        item,
        label: `${item.vendor} ${item.model}`,
        meta: [item.watts ? `${item.watts} W` : null, item.control || null].filter(Boolean).join(' • ')
      });
    });
    (DEVICE_MANUFACTURERS || []).forEach(man => {
      (man.models || []).forEach(model => {
        const label = `${man.name} ${model.model}`;
        if (!label.toLowerCase().includes(q)) return;
        results.push({
          kind: 'device',
          item: {
            vendor: man.name,
            model: model.model,
            connectivity: model.connectivity || [],
            features: model.features || [],
            requiresHub: model.requiresHub || man.requiresHub || false
          },
          label,
          meta: (model.connectivity || []).join(', ')
        });
      });
    });
    this.hardwareSearchResults = results.slice(0, 8);
    if (!this.hardwareSearchResults.length) {
      host.innerHTML = '<li class="tiny" style="color:#64748b">No matches found. Try another make/model.</li>';
      return;
    }
    host.innerHTML = this.hardwareSearchResults.map((res, idx) => {
      const meta = res.meta ? `<div class="tiny" style="color:#64748b">${escapeHtml(res.meta)}</div>` : '';
      const hint = res.kind === 'fixture' ? 'Add fixture & infer control' : 'Fill device form & pairing tips';
      return `<li><button type="button" class="ghost" data-idx="${idx}" style="width:100%;text-align:left"><div><div><strong>${escapeHtml(res.label)}</strong></div>${meta}<div class="tiny" style="color:#0f172a">${escapeHtml(hint)}</div></div></button></li>`;
    }).join('');
  }

  applyHardwareSuggestion(suggestion) {
    if (!suggestion) return;
    const host = document.getElementById('roomDeviceSearchResults');
    if (host) host.innerHTML = '';
    const searchInput = document.getElementById('roomDeviceSearch');
    if (searchInput) searchInput.value = '';
    if (suggestion.kind === 'fixture') {
      const item = suggestion.item;
      this.data.fixtures = this.data.fixtures || [];
      this.data.fixtures.push({ ...item, count: 1 });
      this.renderKbSelected();
      const method = this.mapControlToMethod(item.control || '');
      if (method) {
        this.data.controlMethod = method;
        const container = document.getElementById('roomControlMethod');
        if (container) {
          container.querySelectorAll('.chip-option').forEach(btn => {
            if (btn.dataset.value === method) btn.classList.add('active'); else btn.classList.remove('active');
          });
        }
        const details = document.getElementById('roomControlDetails');
        if (details) details.textContent = this.controlHintFor(method);
      }
      this.ensureHardwareCategory('grow-lights');
      this.inferSensors();
      this.updateSetupQueue();
      showToast({ title: 'Fixture added', msg: `${item.vendor} ${item.model} inserted into the room`, kind: 'success', icon: '✅' }, 3000);
      return;
    }

    if (suggestion.kind === 'device') {
      const item = suggestion.item;
      const vendorSel = document.getElementById('roomDeviceVendor');
      if (vendorSel) {
        if (!Array.from(vendorSel.options || []).some(opt => opt.value === item.vendor)) {
          const opt = document.createElement('option');
          opt.value = item.vendor;
          opt.textContent = item.vendor;
          vendorSel.appendChild(opt);
        }
        vendorSel.value = item.vendor;
        vendorSel.dispatchEvent(new Event('change'));
      }
      const modelSel = document.getElementById('roomDeviceModel');
      if (modelSel) {
        if (!Array.from(modelSel.options || []).some(opt => opt.value === item.model)) {
          const opt = document.createElement('option');
          opt.value = item.model;
          opt.textContent = item.model;
          modelSel.appendChild(opt);
        }
        modelSel.value = item.model;
        modelSel.dispatchEvent(new Event('change'));
      }
      const nameInput = document.getElementById('roomDeviceName');
      if (nameInput && !nameInput.value) nameInput.value = item.model;
      const cm = this.mapControlToMethod((item.connectivity || []).join(' '));
      if (cm) {
        this.data.controlMethod = cm;
        const container = document.getElementById('roomControlMethod');
        if (container) {
          container.querySelectorAll('.chip-option').forEach(btn => {
            if (btn.dataset.value === cm) btn.classList.add('active'); else btn.classList.remove('active');
          });
        }
        const details = document.getElementById('roomControlDetails');
        if (details) details.textContent = this.controlHintFor(cm);
      }
      if ((item.connectivity || []).some(c => /plug|smart/.test(String(c).toLowerCase())) || /plug|switch/.test(item.model.toLowerCase())) {
        this.ensureHardwareCategory('controllers');
      } else {
        this.ensureHardwareCategory('other');
      }
      if (typeof toggleSetupFormsForModel === 'function') toggleSetupFormsForModel(item);
      this.updateSetupQueue();
      showToast({ title: 'Device selected', msg: `${item.vendor} ${item.model} prefilled. Complete the device form to add it.`, kind: 'info', icon: 'ℹ️' }, 3500);
    }
  }

  stepCategory(direction) {
    if (!this.categoryQueue.length) return;
    const next = this.categoryIndex + direction;
    if (next < 0 || next >= this.categoryQueue.length) return;
    this.captureCurrentCategoryForm();
    this.categoryIndex = next;
    this.renderCurrentCategoryForm();
    this.updateCategoryNav();
  }

  categoryStatusMessage(status, note = '') {
    const map = {
      'complete': '✅ Ready',
      'needs-hub': '⚠ Needs hub',
      'needs-energy': '⚠ Needs energy meter',
      'needs-setup': '⚠ Needs setup',
      'needs-info': '• Needs info',
      'not-started': '• Needs info'
    };
    const label = map[status] || '• Needs info';
    return note ? `${label} — ${note}` : label;
  }

  updateCategoryNav() {
    const progress = document.getElementById('catSetupProgress');
    const total = this.categoryQueue.length;
    if (progress) {
      progress.textContent = total ? `Type ${this.categoryIndex + 1} of ${total}` : '';
    }
    const prev = document.getElementById('catPrevType');
    const next = document.getElementById('catNextType');
    if (prev) prev.disabled = this.categoryIndex <= 0;
    if (next) next.disabled = this.categoryIndex >= total - 1;
    const catId = this.getCurrentCategoryId();
    const statusLine = document.getElementById('catSetupStatusLine');
    const status = document.getElementById('catSetupStatus');
    if (statusLine && catId) {
      statusLine.textContent = `Configuring ${this.categoryLabel(catId)} (${this.categoryIndex + 1} of ${total || 1})`;
    }
    if (status && catId) {
      const st = this.categoryProgress?.[catId]?.status || 'needs-info';
      const note = this.categoryProgress?.[catId]?.notes || '';
      status.textContent = this.categoryStatusMessage(st, note);
    }
  }

  goToStep(stepKey) {
    const idx = this.steps.indexOf(stepKey);
    if (idx >= 0) {
      this.currentStep = idx;
      this.showStep(idx);
    }
  }

  updateSetupQueue() {
    const host = document.getElementById('roomSetupQueue');
    if (!host) return;
    const chips = [];
    const progressStates = [];
    const push = (step, label, status = 'todo', extra = {}) => {
      if (step !== 'review') progressStates.push(status);
      const emoji = status === 'done' ? '✅' : status === 'warn' ? '⚠️' : '•';
      const attrs = [`data-step="${step}"`];
      if (extra.cat) attrs.push(`data-cat="${extra.cat}"`);
      const cls = status === 'done' ? 'chip chip--success tiny' : status === 'warn' ? 'chip chip--warn tiny' : 'chip tiny';
      chips.push(`<button type="button" class="${cls}" ${attrs.join(' ')}>${emoji} ${escapeHtml(label)}</button>`);
    };

    const conn = this.data.connectivity || {};
    let connectivityStatus = 'todo';
    if (conn.hasHub === true) connectivityStatus = 'done';
    else if (conn.hasHub === false) connectivityStatus = (this.data.hardwareCats || []).includes('controllers') ? 'warn' : 'warn';
    push('connectivity', 'Connectivity', connectivityStatus);

    const smartControl = ['wifi', 'smart-plug', 'rs485', 'other'].includes(this.data.controlMethod);
    const devicesStatus = (this.data.devices || []).length ? 'done' : (smartControl ? 'warn' : 'todo');
    push('devices', 'Devices', devicesStatus);

    const hardwareStatus = (this.data.hardwareCats || []).length ? 'done' : 'todo';
    push('hardware', 'Hardware', hardwareStatus);
    (this.categoryQueue || []).forEach(catId => {
      const st = this.categoryProgress?.[catId]?.status || 'needs-info';
      const status = st === 'complete' ? 'done' : st && st.startsWith('needs') ? 'warn' : 'todo';
      push('category-setup', this.categoryLabel(catId), status, { cat: catId });
    });
    const fixtures = Array.isArray(this.data.fixtures) ? this.data.fixtures : [];
    const needsLights = (this.data.hardwareCats || []).includes('grow-lights');
    const needsSensors = ((this.data.hardwareCats || []).includes('sensors')) || fixtures.length > 0;
    const sensorsStatus = (this.data.sensors?.categories || []).length ? 'done' : (needsSensors ? 'warn' : 'todo');
    push('sensors', 'Sensors', sensorsStatus);

    push('room-name', 'Room name', this.data.name ? 'done' : 'todo');
    push('location', 'Location', this.data.location ? 'done' : 'todo');
    const hasLayout = this.data.layout && this.data.layout.type;
    push('layout', 'Layout', hasLayout ? 'done' : 'todo');
    push('zones', 'Zones', Array.isArray(this.data.zones) && this.data.zones.length ? 'done' : 'warn');

    const fixturesStatus = fixtures.length ? 'done' : (needsLights ? 'warn' : 'todo');
    push('fixtures', 'Fixtures', fixturesStatus);
    const controlStatus = this.data.controlMethod ? 'done' : (needsLights ? 'warn' : 'todo');
    push('control', 'Control', controlStatus);

    let energyStatus = this.data.energy ? 'done' : 'todo';
    if (this.data.energy && this.data.energy !== 'none') {
      const hrs = Number(this.data.energyHours);
      if (!Number.isFinite(hrs) || hrs <= 0) energyStatus = 'warn';
    }
    push('energy', 'Energy', energyStatus);
    const grouping = this.data.grouping || {};
    const groupList = Array.isArray(grouping.groups) ? grouping.groups : [];
    const groupingStatus = groupList.length ? 'done' : ((Array.isArray(this.data.zones) && this.data.zones.length) ? 'warn' : 'todo');
    push('grouping', 'Groups', groupingStatus);
    const hasTodo = progressStates.some(st => st === 'todo');
    const hasWarn = progressStates.some(st => st === 'warn');
    const reviewStatus = hasTodo ? 'todo' : hasWarn ? 'warn' : 'done';
    push('review', 'Review', reviewStatus);

    host.innerHTML = chips.join('');
    host.querySelectorAll('button[data-step]').forEach(btn => {
      btn.addEventListener('click', () => {
        const step = btn.getAttribute('data-step');
        if (step === 'category-setup') {
          const cat = btn.getAttribute('data-cat');
          if (cat) {
            const idx = this.categoryQueue.indexOf(cat);
            if (idx >= 0) {
              this.categoryIndex = idx;
              this.goToStep('category-setup');
            }
          }
        } else {
          this.goToStep(step);
        }
      });
    });
  }

  categoryLabel(id) {
    const map = {
      'grow-lights': 'Grow lights',
      'hvac': 'HVAC',
      'dehumidifier': 'Dehumidifiers',
      'fans': 'Fans',
      'vents': 'Vents',
      'irrigation': 'Irrigation',
      'controllers': 'Controllers',
      'sensors': 'Sensors',
      'other': 'Other'
    };
    return map[id] || id;
  }

  removeFixture(idx){ this.data.fixtures.splice(idx,1); this.renderKbSelected(); this.inferSensors(); this.updateSetupQueue(); }
  updateFixtureCount(idx, value){ const n=Math.max(1, Number(value||1)); if (this.data.fixtures[idx]) this.data.fixtures[idx].count=n; this.inferSensors(); this.updateSetupQueue(); }

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
    this.updateSetupQueue();
  }

  populateLocationSelect() {
    const sel = $('#roomLocationSelect'); if (!sel) return;
    const rooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : [];
    sel.innerHTML = '<option value="">Select room...</option>' + rooms.map(r => `<option value="${escapeHtml(r.name)}" data-room-id="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join('');
    // If editing an existing room with location, preselect
    if (this.data.location) sel.value = this.data.location;
  }

  updateReview(){
    const host = $('#roomReview'); if (!host) return;
    const escape = escapeHtml;
    const layout = this.data.layout || {};
    const layoutParts = [];
    if (layout.type) layoutParts.push(escape(layout.type));
    if (layout.rows) layoutParts.push(`${escape(String(layout.rows))} rows`);
    if (layout.racks) layoutParts.push(`${escape(String(layout.racks))} racks/row`);
    if (layout.levels) layoutParts.push(`${escape(String(layout.levels))} levels`);
    const layoutSummary = layoutParts.length ? layoutParts.join(' • ') : '—';
    const zones = Array.isArray(this.data.zones) ? this.data.zones : [];
    const zoneHtml = zones.length ? zones.map(z => `<span class="chip tiny">${escape(z)}</span>`).join(' ') : '—';
    const hardwareCats = Array.isArray(this.data.hardwareCats) ? this.data.hardwareCats : [];
    const hardwareHtml = hardwareCats.length ? hardwareCats.map(id => `<span class="chip tiny">${escape(this.categoryLabel(id))}</span>`).join(' ') : '—';
    const catData = this.data.category || {};
    const catDetails = Object.entries(catData).map(([key, val]) => {
      const parts = [];
      if (val.count != null) parts.push(`${escape(String(val.count))} units`);
      if (val.zones != null && String(val.zones)) parts.push(`${escape(String(val.zones))} zones`);
      if (val.control) parts.push(escape(String(val.control)));
      if (val.energy) parts.push(escape(String(val.energy)));
      if (val.notes) parts.push(escape(String(val.notes)));
      const label = escape(this.categoryLabel(key));
      return `<li><strong>${label}</strong> — ${parts.length ? parts.join(' • ') : 'No details captured'}</li>`;
    });
    const categoryHtml = catDetails.length ? `<ul class="tiny" style="margin:6px 0 0 0; padding-left:18px">${catDetails.join('')}</ul>` : '<span>—</span>';
    const progressEntries = Object.entries(this.categoryProgress || {}).map(([id, info]) => {
      const status = this.categoryStatusMessage(info?.status || 'needs-info', info?.notes || '');
      const title = info?.notes ? ` title="${escape(info.notes)}"` : '';
      return `<span class="chip tiny"${title}>${escape(this.categoryLabel(id))}: ${escape(status)}</span>`;
    }).join(' ');
    const fixtures = Array.isArray(this.data.fixtures) ? this.data.fixtures : [];
    const fixtureItems = fixtures.map(f => {
      const label = `${[f.vendor, f.model].filter(Boolean).map(v => escape(String(v))).join(' ')}${f.count ? ` × ${escape(String(f.count))}` : ''}`.trim();
      const watts = f.watts ? ` • ${escape(String(f.watts))} W` : '';
      return `<li>${label || 'Fixture'}${watts}</li>`;
    });
    const fixturesHtml = fixtureItems.length ? `<ul style="margin:6px 0 0 0; padding-left:18px">${fixtureItems.join('')}</ul>` : '<span>—</span>';
    const controlLabels = { 'wifi': 'Wi‑Fi / App', 'smart-plug': 'Smart plug', '0-10v': '0‑10V / Analog', 'rs485': 'RS‑485 / Modbus', 'other': 'Other' };
    const controlSummary = this.data.controlMethod ? escape(controlLabels[this.data.controlMethod] || this.data.controlMethod) : '—';
    const sensors = Array.isArray(this.data.sensors?.categories) ? this.data.sensors.categories : [];
    const placements = this.data.sensors?.placements || {};
    const sensorLabels = { tempRh: 'Temp/RH', co2: 'CO₂', vpd: 'Dewpoint/VPD', ppfd: 'Light/PPFD', energy: 'Energy/Power' };
    const sensorItems = sensors.map(key => {
      const label = escape(sensorLabels[key] || key);
      const loc = placements[key] ? ` <span style="color:#475569">@ ${escape(String(placements[key]))}</span>` : '';
      return `<li>${label}${loc}</li>`;
    });
    const sensorHtml = sensorItems.length ? `<ul style="margin:6px 0 0 0; padding-left:18px">${sensorItems.join('')}</ul>` : '<span>—</span>';
    const conn = this.data.connectivity || {};
    let hubSummary = '—';
    if (conn.hasHub === true) {
      const type = conn.hubType ? escape(conn.hubType) : 'Local hub';
      const ip = conn.hubIp ? ` • ${escape(conn.hubIp)}` : '';
      hubSummary = `${type}${ip}`;
    } else if (conn.hasHub === false) {
      hubSummary = 'No hub yet';
    }
    const tenant = conn.cloudTenant ? escape(conn.cloudTenant) : '—';
    const roles = this.data.roles || {};
    const formatRole = (key) => {
      const list = Array.isArray(roles[key]) ? roles[key].filter(Boolean) : [];
      return list.length ? escape(list.join(', ')) : '—';
    };
    const grouping = this.data.grouping || {};
    const groupList = Array.isArray(grouping.groups) ? grouping.groups : [];
    const groupHtml = groupList.length ? `<ul style="margin:6px 0 0 0; padding-left:18px">${groupList.map(g => `<li>${escape(g)}</li>`).join('')}</ul>` : '<span>—</span>';
    const planName = grouping.planId ? (STATE.plans || []).find(p => p.id === grouping.planId)?.name || grouping.planId : '—';
    const scheduleName = grouping.scheduleId ? (STATE.schedules || []).find(s => s.id === grouping.scheduleId)?.name || grouping.scheduleId : '—';
    const spectraSyncLabel = grouping.spectraSync === false ? 'Off' : 'On';
    const energyLabels = { 'ct-branch': 'CT / branch meters', 'smart-plugs': 'Smart plugs', 'built-in': 'Built-in meter', 'none': 'None' };
    const energyLabel = this.data.energy ? escape(energyLabels[this.data.energy] || this.data.energy) : '—';
    const energyHours = Number(this.data.energyHours) || 0;
    const runtimeLabel = energyHours ? `${escape(String(energyHours))} hr/day` : '—';
    const totalWatts = fixtures.reduce((sum, f) => sum + (Number(f.watts) || 0) * (Number(f.count) || 1), 0);
    const estimatedKwh = totalWatts > 0 && energyHours > 0 ? `${((totalWatts / 1000) * energyHours).toFixed(2)} kWh/day` : '—';
    const targetPpfd = Number(this.data.targetPpfd) || 0;
    const photoperiod = Number(this.data.photoperiod) || 0;
    const dli = targetPpfd > 0 && photoperiod > 0 ? ((targetPpfd * (3600 * photoperiod)) / 1_000_000).toFixed(1) : null;
    host.innerHTML = `
      <div><strong>Name:</strong> ${escape(this.data.name || '—')}</div>
      <div><strong>Location:</strong> ${escape(this.data.location || '—')}</div>
      <div><strong>Layout:</strong> ${layoutSummary}</div>
      <div><strong>Zones:</strong> ${zoneHtml}</div>
      <div><strong>Hardware:</strong> ${hardwareHtml}</div>
      <div><strong>Per-category details:</strong> ${categoryHtml}</div>
      ${progressEntries ? `<div><strong>Setup queue:</strong> ${progressEntries}</div>` : ''}
      <div><strong>Fixtures:</strong> ${fixturesHtml}</div>
      <div><strong>Series count:</strong> ${escape(String(this.data.seriesCount || 0))}</div>
      <div><strong>Control method:</strong> ${controlSummary}</div>
      <div><strong>Sensors:</strong> ${sensorHtml}</div>
      <div><strong>Groups:</strong> ${groupHtml}</div>
      <div><strong>Plan &amp; Schedule:</strong> Plan ${escape(planName)} • Schedule ${escape(scheduleName)} • SpectraSync ${escape(spectraSyncLabel)}</div>
      <div><strong>Connectivity:</strong> ${hubSummary} • Tenant ${tenant}</div>
      <div><strong>Roles:</strong> Admins ${formatRole('admin')} • Operators ${formatRole('operator')} • Viewers ${formatRole('viewer')}</div>
      <div><strong>Energy monitoring:</strong> ${energyLabel} • Runtime ${runtimeLabel} • Est. ${escape(estimatedKwh)}</div>
      <div><strong>Target PPFD:</strong> ${targetPpfd ? escape(String(targetPpfd)) + ' µmol·m⁻²·s⁻¹' : '—'} • Photoperiod ${photoperiod ? escape(String(photoperiod)) + ' h' : '—'} • DLI ${dli ? escape(String(dli)) + ' mol·m⁻²·day⁻¹' : '—'}</div>
    `;
  }

  async addDemoSwitchBotDevices() {
    try {
      // Fetch real SwitchBot devices from the API
      const response = await fetch('/api/switchbot/devices?refresh=1');
      if (!response.ok) {
        throw new Error(`SwitchBot API returned HTTP ${response.status}`);
      }
      const data = await response.json();
      const meta = data.meta || {};

      if (meta.cached && meta.stale) {
        console.warn('SwitchBot API returned stale cached data:', meta.error || 'Unknown error');
      } else if (meta.cached) {
        console.info('Using cached SwitchBot device list (within TTL).');
      }

      if (data.statusCode === 100 && data.body && data.body.deviceList) {
        const realDevices = data.body.deviceList;

        // Clear existing devices and add real ones
        this.data.devices = [];

        realDevices.forEach((device, index) => {
          const demoDevice = {
            name: device.deviceName || `Farm Device ${index + 1}`,
            vendor: 'SwitchBot',
            model: device.deviceType,
            host: 'switchbot-demo-token',
            switchBotId: device.deviceId,
            hubId: device.hubDeviceId,
            setup: this.getSetupForDeviceType(device.deviceType),
            isReal: true,
            realDeviceData: device
          };
          this.data.devices.push(demoDevice);
        });
        
        console.log(`✅ Loaded ${realDevices.length} SwitchBot device(s) for demo`, meta);

      } else {
        throw new Error('Failed to load real devices');
      }
    } catch (error) {
      console.error('Failed to load real SwitchBot devices, using fallback:', error);
      // Fallback to mock data if real API fails
      this.addFallbackDemoDevices();
    }

    // Set shared SwitchBot configuration regardless of real vs fallback
    this.setupSwitchBotConfiguration();
  }

  getSetupForDeviceType(deviceType) {
    const type = deviceType.toLowerCase();
    if (type.includes('meter') || type.includes('sensor')) {
      return {
        bluetooth: { name: `WoSensorTH_${Math.random().toString(36).substr(2, 6)}`, pin: null }
      };
    } else if (type.includes('plug') || type.includes('switch')) {
      return {
        wifi: { ssid: 'GrowFarm_IoT', psk: '********', useStatic: false, staticIp: null }
      };
    } else if (type.includes('bot')) {
      return {
        bluetooth: { name: `WoHand_${Math.random().toString(36).substr(2, 6)}`, pin: null }
      };
    } else {
      return {
        wifi: { ssid: 'GrowFarm_IoT', psk: '********', useStatic: true, staticIp: `192.168.1.${40 + Math.floor(Math.random() * 10)}` }
      };
    }
  }

  addFallbackDemoDevices() {
    // Original mock devices as fallback
    const demoDevices = [
      {
        name: 'Grow Room Temp/Humidity Sensor',
        vendor: 'SwitchBot',
        model: 'Meter Plus',
        host: 'switchbot-demo-token',
        setup: {
          bluetooth: { name: 'WoSensorTH_A1B2C3', pin: null }
        },
        mockData: { temperature: 24.3, humidity: 52, battery: 87 }
      },
      {
        name: 'Dehumidifier Smart Plug',
        vendor: 'SwitchBot',
        model: 'Plug Mini',
        host: 'switchbot-demo-token',
        setup: {
          wifi: { ssid: 'GrowFarm_IoT', psk: '********', useStatic: false, staticIp: null }
        },
        mockData: { power: 450, voltage: 120.1, current: 3.75, state: 'on' }
      },
      {
        name: 'Exhaust Fan Controller',
        vendor: 'SwitchBot',
        model: 'Bot',
        host: 'switchbot-demo-token',
        setup: {
          bluetooth: { name: 'WoHand_D4E5F6', pin: null }
        },
        mockData: { position: 75, battery: 92, state: 'auto' }
      },
      {
        name: 'CO2 Monitor',
        vendor: 'SwitchBot',
        model: 'Indoor Air Quality Monitor',
        host: 'switchbot-demo-token',
        setup: {
          wifi: { ssid: 'GrowFarm_IoT', psk: '********', useStatic: true, staticIp: '192.168.1.45' }
        },
        mockData: { co2: 820, temperature: 23.8, humidity: 48, battery: 78 }
      },
      {
        name: 'Water Pump Controller',
        vendor: 'SwitchBot',
        model: 'Plug',
        host: 'switchbot-demo-token',
        setup: {
          wifi: { ssid: 'GrowFarm_IoT', psk: '********', useStatic: true, staticIp: '192.168.1.47' }
        },
        mockData: { power: 125, voltage: 120.3, current: 1.04, state: 'off', schedule: 'irrigation-cycle-1' }
      }
    ];

    this.data.devices = this.data.devices || [];
    demoDevices.forEach(device => {
      this.data.devices.push(device);
    });
  }

  setupSwitchBotConfiguration() {
    // Also set some related wizard data to simulate a complete setup
    this.data.hardwareCats = this.data.hardwareCats || [];
    const newCategories = ['grow-lights', 'hvac', 'dehumidifier', 'fans', 'irrigation', 'controllers'];
    newCategories.forEach(cat => {
      if (!this.data.hardwareCats.includes(cat)) {
        this.data.hardwareCats.push(cat);
      }
    });

    // Set connectivity info for SwitchBot integration
    this.data.connectivity = {
      hasHub: 'yes',
      hubType: 'Raspberry Pi 4 + SwitchBot Hub',
      hubIp: '192.168.1.100',
      cloudTenant: 'Azure',
      switchbotToken: 'switchbot-demo-token',
      switchbotSecret: 'switchbot-demo-secret'
    };

    // Update sensor categories to include what SwitchBot provides
    this.data.sensors = this.data.sensors || { categories: [], placements: {} };
    const sensorCats = ['temperature', 'humidity', 'co2', 'power'];
    sensorCats.forEach(cat => {
      if (!this.data.sensors.categories.includes(cat)) {
        this.data.sensors.categories.push(cat);
      }
    });

    // Set default placements
    this.data.sensors.placements = {
      temperature: 'canopy-level',
      humidity: 'canopy-level', 
      co2: 'mid-level',
      power: 'electrical-panel'
    };

    // Re-render the devices list and update setup queue
    this.renderDevicesList();
    this.updateSetupQueue();

    // Show success message
    showToast({ 
      title: 'SwitchBot Demo Added', 
      msg: `Added ${demoDevices.length} SwitchBot devices with realistic sensor data and controls`, 
      kind: 'success', 
      icon: '🎮' 
    });

    // Auto-advance to next step if we're on devices step
    if (this.steps[this.currentStep] === 'devices') {
      setTimeout(() => {
        if (this.validateCurrentStep()) {
          this.currentStep++;
          this.showStep(this.currentStep);
        }
      }, 1500);
    }
  }

  nextStep() {
    if (this.validateCurrentStep()) {
      this.currentStep++;
      this.showStep(this.currentStep);
    }
  }

  prevStep() {
    this.currentStep = Math.max(0, this.currentStep - 1);
    this.showStep(this.currentStep);
  }

  async saveRoom(e){
    e.preventDefault();
    // Assign id if new
    if (!this.data.id) this.data.id = `room-${Math.random().toString(36).slice(2,8)}`;
    // Persist categoryProgress into room data for summary
    if (this.categoryProgress) this.data._categoryProgress = JSON.parse(JSON.stringify(this.categoryProgress));
    // Upsert into STATE.rooms and persist
    const idx = STATE.rooms.findIndex(r => r.id === this.data.id);
    if (idx >= 0) STATE.rooms[idx] = { ...STATE.rooms[idx], ...this.data };
    else STATE.rooms.push({ ...this.data });
    // Use safeRoomsSave to avoid overwriting manual edits
    const ok = await safeRoomsSave(this.data);
    if (ok) {
      renderRooms();
      showToast({ title:'Room saved', msg:`${this.data.name} saved`, kind:'success', icon:'✅' });
      try { localStorage.removeItem('gr.roomWizard.progress'); } catch {}
      this.close();
    } else {
      alert('Failed to save room');
    }
  }
}

// --- Data Loading and Initialization ---
async function loadAllData() {
  try {
    // 1) Try DB-backed devices first
    let dbDevices = null;
    try {
      dbDevices = await api('/devices');
    } catch (e) {
      console.warn('DB /devices fetch failed, will try forwarder/api', e);
    }
    if (dbDevices && Array.isArray(dbDevices.devices)) {
      STATE.devices = dbDevices.devices;
    } else {
      // 2) Load device data from controller via forwarder; fallback to /api/devicedatas
      let deviceResponse = null;
      try {
        deviceResponse = await api('/forwarder/devicedatas');
      } catch (e) {
        console.warn('forwarder devicedatas fetch failed, falling back to /api/devicedatas', e);
      }
      if (!deviceResponse || !deviceResponse.data) {
        try {
          deviceResponse = await api('/api/devicedatas');
        } catch (e) {
          console.error('Failed to load device list from /api/devicedatas', e);
          deviceResponse = { data: [] };
        }
      }
      STATE.devices = deviceResponse?.data || [];
    }
    
    // Ensure all devices have proper online status for research mode
    STATE.devices = STATE.devices.map(device => ({
      ...device,
      online: device.online !== false // Default to true unless explicitly false
    }));
    
    // Load static data files
    const [groups, schedules, plans, environment, calibrations, deviceMeta, deviceKB, deviceManufacturers, farm, rooms, switchbotDevices] = await Promise.all([
      loadJSON('./data/groups.json'),
      loadJSON('./data/schedules.json'),
      loadJSON('./data/plans.json'),
      api('/env'),
      loadJSON('./data/calibration.json'),
      loadJSON('./data/device-meta.json'),
        loadJSON('./data/device-kb.json'),
        loadJSON('./data/device-manufacturers.json'),
      loadJSON('./data/farm.json'),
      loadJSON('./data/rooms.json'),
      loadJSON('./data/switchbot-devices.json')
    ]);

  STATE.groups = groups?.groups || [];
    STATE.schedules = schedules?.schedules || [];
    STATE.plans = plans?.plans || [];
  STATE.environment = environment?.zones || [];
    STATE.calibrations = calibrations?.calibrations || [];
  STATE.deviceMeta = deviceMeta?.devices || {};
  STATE.switchbotDevices = switchbotDevices?.devices || [];
  const rawFarm = farm || (() => { try { return JSON.parse(localStorage.getItem('gr.farm') || 'null'); } catch { return null; } })() || {};
  STATE.farm = normalizeFarmDoc(rawFarm);
  try { if (STATE.farm && Object.keys(STATE.farm).length) localStorage.setItem('gr.farm', JSON.stringify(STATE.farm)); } catch {}
  STATE.rooms = rooms?.rooms || [];
  if (deviceKB && Array.isArray(deviceKB.fixtures)) STATE.deviceKB = deviceKB;
  // load manufacturers into a global for lookups and selects
  if (deviceManufacturers && Array.isArray(deviceManufacturers.manufacturers)) {
    window.DEVICE_MANUFACTURERS = deviceManufacturers.manufacturers;
  } else {
    window.DEVICE_MANUFACTURERS = window.DEVICE_MANUFACTURERS || [];
  }
    
    setStatus(`Loaded ${STATE.devices.length} devices, ${STATE.groups.length} groups, ${STATE.schedules.length} schedules`);
    // If no devices were discovered, seed a demo list from group rosters so UI isn't empty
    if ((!STATE.devices || STATE.devices.length === 0) && STATE.groups.length) {
      const ids = Array.from(new Set(STATE.groups.flatMap(g => (g.lights||[]).map(l=>l.id))));
      STATE.devices = ids.map(id => buildStubDevice(id));
      setStatus(`No live devices found — using ${STATE.devices.length} demo device(s) from groups`);
    } else if (!STATE.devices || STATE.devices.length === 0) {
      // Fallback: seed from device registry if present (device-meta)
      const metaIds = Object.keys(STATE.deviceMeta || {});
      if (metaIds.length) {
        STATE.devices = metaIds.map(id => buildStubDevice(id));
        setStatus(`No live devices found — using ${STATE.devices.length} device(s) from registry`);
      }
    }
    
    // Render UI
  renderDevices();
    renderGroups();
    renderSchedules();
    renderPlans();
    renderPlansPanel();
  renderEnvironment();
  renderRooms();
  renderSwitchBotDevices();
  // Start background polling for environment telemetry
  startEnvPolling();

  try { roomWizard.populateGroupingSelectors(); } catch {}

  } catch (error) {
    setStatus(`Error loading data: ${error.message}`);
    console.error('Data loading error:', error);
  }
}

// Patch a single device's location into the server DB (best-effort)
async function patchDeviceDb(id, fields){
  try {
    await fetch(`/devices/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fields)
    });
  } catch (e) {
    console.warn('patchDeviceDb failed', e);
  }
}

// Populate vendor/model selects used in RoomWizard
function populateVendorModelSelects() {
  const vendorSel = document.getElementById('roomDeviceVendor');
  const modelSel = document.getElementById('roomDeviceModel');
  if (!vendorSel || !modelSel) return;
  vendorSel.innerHTML = '<option value="">Vendor</option>' + (window.DEVICE_MANUFACTURERS || []).map(m => `<option value="${m.name}">${m.name}</option>`).join('');
  vendorSel.addEventListener('change', (e) => {
    const name = e.target.value;
    const man = (window.DEVICE_MANUFACTURERS || []).find(x => x.name === name);
    modelSel.innerHTML = '<option value="">Model</option>' + (man?.models || []).map(m => `<option value="${m.model}">${m.model}</option>`).join('');
    // toggle setup forms if model selected
    const md = man?.models?.[0] || null;
    toggleSetupFormsForModel(md);
  });
}

function findModelByValue(vendor, modelName) {
  const man = (window.DEVICE_MANUFACTURERS || []).find(x => x.name === vendor);
  if (!man) return null;
  return man.models?.find(m => m.model === modelName) || null;
}

function renderDevices() {
  const container = $('#devices');
  const emptyMsg = $('#devicesEmpty');
  const scopeSel = $('#deviceScope');
  const multiSel = $('#deviceSelect');
  const note = $('#devicesNote');
  if (!container) return;

  // Ensure selection lists are bound and hydrated (always do this, even if cards are gated off)
  if (scopeSel && multiSel && !multiSel.dataset.bound) {
    multiSel.dataset.bound = '1';
    // Initialize scope from saved state once
    const saved = getDevicePickState();
    if (scopeSel && !scopeSel.dataset.init) {
      scopeSel.value = saved.scope || 'devices';
      scopeSel.dataset.init = '1';
    }
    scopeSel.addEventListener('change', () => {
      setDevicePickState(scopeSel.value, []);
      hydrateDeviceSelect();
      renderDevices();
    });
    multiSel.addEventListener('change', () => {
      const ids = Array.from(multiSel.selectedOptions || []).map(o=>o.value);
      setDevicePickState(scopeSel.value, ids);
      renderDevices();
    });
  }
  hydrateDeviceSelect();

  // Farmer mode or local off: hide cards and show message, but keep the select populated
  if (!STATE.researchMode || !STATE.deviceResearchLocal) {
    // Auto-enable research toggles if there is a non-empty selection, so cards appear as soon as possible
    try {
      const sel = Array.from(multiSel?.selectedOptions || []).map(o => o.value);
      if (sel.length > 0) {
        if (!STATE.researchMode) { setResearchMode(true); const t = $('#researchModeToggle'); if (t) t.checked = true; }
        if (!STATE.deviceResearchLocal) { setDevicesLocalResearch(true); const t2 = $('#devicesResearchToggle'); if (t2) t2.checked = true; }
      }
    } catch {}
    if (!STATE.researchMode || !STATE.deviceResearchLocal) {
    container.innerHTML = '';
    if (emptyMsg) emptyMsg.style.display = 'block';
    if (note) note.textContent = '';
    return;
    }
  } else {
    if (emptyMsg) emptyMsg.style.display = 'none';
  }

  const scope = scopeSel?.value || 'devices';
  const selected = Array.from(multiSel?.selectedOptions || []).map(o => o.value);
  const cap = scope === 'groups' ? 5 : 10;
  const over = selected.length > cap;
  if (note) {
    note.textContent = selected.length ? `${selected.length} selected • showing up to ${cap}` : `Select up to ${cap} ${scope}`;
    note.style.color = over ? '#b91c1c' : '';
  }

  container.innerHTML = '';
  if (scope === 'groups') {
    const groups = STATE.groups.filter(g => selected.includes(g.id)).slice(0, cap);
    groups.forEach(g => {
      // Render one card summarizing the group; show first device as representative if present
      const ids = (g.lights || []).map(l => l.id);
      const devices = STATE.devices.filter(d => ids.includes(d.id));
      const rep = devices[0] || { id: g.id, deviceName: g.name, onOffStatus: true, online: true };
      const card = deviceCard(rep, { compact: true, context: { group: g, deviceCount: devices.length } });
      container.appendChild(card);
    });
  } else {
    const devices = STATE.devices.filter(d => selected.includes(d.id)).slice(0, cap);
    devices.forEach(device => {
      const card = deviceCard(device, { compact: true });
      container.appendChild(card);
    });
  }
}

function hydrateDeviceSelect() {
  const scopeSel = $('#deviceScope');
  const multiSel = $('#deviceSelect');
  if (!scopeSel || !multiSel) return;
  const scope = scopeSel.value || 'devices';
  const saved = getDevicePickState();
  if (scope === 'groups') {
    multiSel.innerHTML = STATE.groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
  } else {
    multiSel.innerHTML = STATE.devices.map(d => `<option value="${d.id}">${d.deviceName || d.id}</option>`).join('');
  }
  // Preselect saved ids that still exist under this scope
  const validIds = new Set((scope === 'groups' ? STATE.groups.map(g=>g.id) : STATE.devices.map(d=>d.id)));
  let toSelect = (saved.scope === scope ? saved.ids : []).filter(id => validIds.has(id));
  // If nothing saved, auto-select the first 1-3 items for a quick start
  if (!toSelect.length) {
    const max = scope === 'groups' ? 3 : 3;
    toSelect = Array.from(validIds).slice(0, max);
    if (toSelect.length) setDevicePickState(scope, toSelect);
  }
  Array.from(multiSel.options || []).forEach(opt => { opt.selected = toSelect.includes(opt.value); });
}

function renderGroups() {
  const select = $('#groupSelect');
  if (!select) return;
  
  const prev = STATE.currentGroup?.id || select.value || '';
  select.innerHTML = '<option value="">Select group...</option>' +
    STATE.groups.map(group => `<option value="${group.id}">${escapeHtml(group.name||group.id)}</option>`).join('');
  // Preserve prior selection when possible; else select first group
  const nextId = STATE.groups.some(g=>g.id===prev) ? prev : (STATE.groups[0]?.id || '');
  if (nextId) {
    select.value = nextId;
    STATE.currentGroup = STATE.groups.find(g=>g.id===nextId) || null;
    try { if (typeof updateGroupUI === 'function') updateGroupUI(STATE.currentGroup); } catch {}
    // Reflect name input
    const nameInput = $('#groupName'); if (nameInput) nameInput.value = STATE.currentGroup?.name || '';
  }
}

function renderRooms() {
  const host = $('#roomsList'); if (!host) return;
  if (!STATE.rooms.length) {
    host.innerHTML = '<p class="tiny" style="color:#64748b">No rooms yet. Create one to get started.</p>';
    return;
  }
    host.innerHTML = STATE.rooms.map(r => {
      const fixtures = (r.fixtures||[]).reduce((sum,f)=> sum + (Number(f.count)||0), 0);
      const sensorCats = (r.sensors?.categories||[]).map(s => escapeHtml(s)).join(', ') || '—';
      const sensorPlacements = Object.entries(r.sensors?.placements || {})
        .map(([cat, place]) => `${escapeHtml(cat)}@${escapeHtml(place || 'room')}`)
        .join(', ') || '—';
      const prog = r._categoryProgress || {};
      const badge = (st) => {
        if (st === 'complete') return '✅ Ready';
        if (st === 'needs-info') return '• Needs details';
        if (st === 'needs-hub' || st === 'needs-energy' || st === 'needs-setup') return '• Needs follow-up';
        return '';
      };
      const orderedCats = ['hvac','grow-lights','dehumidifier','fans','vents','irrigation','controllers','sensors'];
      const statusRow = orderedCats
        .filter(c => prog[c])
        .map(c => {
          const labelText = typeof roomWizard?.categoryLabel === 'function' ? roomWizard.categoryLabel(c) : c;
          const label = escapeHtml(labelText);
          const statusText = escapeHtml(badge(prog[c]?.status));
          return `<span class="chip tiny" title="${label}">${label}: ${statusText}</span>`;
        })
        .join(' ');
      const totalWatts = (r.fixtures||[]).reduce((sum, f) => sum + ((Number(f.watts)||0) * (Number(f.count)||1)), 0);
      const energyHours = Number(r.energyHours) || 0;
      const energyKwh = totalWatts > 0 && energyHours > 0 ? ((totalWatts/1000) * energyHours).toFixed(2) : '—';
      const dli = (Number(r.targetPpfd) > 0 && Number(r.photoperiod) > 0)
        ? ((Number(r.targetPpfd) * 3600 * Number(r.photoperiod)) / 1_000_000).toFixed(1)
        : '—';
      const zones = (r.zones || []).map(z => escapeHtml(z)).join(', ') || '—';
      const connectivity = r.connectivity || {};
      const connSummary = connectivity.hasHub === null
        ? 'Hub: ?'
        : connectivity.hasHub
          ? `Hub: ${connectivity.hubType ? escapeHtml(connectivity.hubType) : 'present'}${connectivity.hubIp ? ` @ ${escapeHtml(connectivity.hubIp)}` : ''}`
          : 'Hub: none';
      const layout = r.layout || {};
      const layoutType = escapeHtml(layout.type || '—');
      const name = escapeHtml(r.name || '');
      const control = escapeHtml(r.controlMethod || '—');
      const roomId = escapeHtml(r.id || '');
      const editPayload = escapeHtml(JSON.stringify(r || {}));
      return `<div class="card" style="margin-top:8px">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div>
            <h3 style="margin:0">${name}</h3>
            <div class="tiny" style="color:#475569">Layout: ${layoutType} • Zones: ${zones} • Fixtures: ${fixtures} • Control: ${control}</div>
            <div class="tiny" style="color:#475569">Sensors: ${sensorCats} • Placement: ${sensorPlacements}</div>
            <div class="tiny" style="color:#475569">DLI target: ${dli !== '—' ? `${dli} mol/m²/day` : '—'} • Energy (est.): ${energyKwh !== '—' ? `${energyKwh} kWh/day` : '—'} • ${connSummary}</div>
            ${statusRow ? `<div class="tiny" style="margin-top:4px">${statusRow}</div>` : ''}
          </div>
          <div class="row" style="gap:6px">
            <button type="button" class="ghost" onclick="roomWizard.open(${editPayload})">Edit</button>
            <button type="button" class="ghost danger" data-action="del-room" data-room-id="${roomId}">Delete</button>
          </div>
        </div>
      </div>`;
  }).join('');

  // Wire Delete actions
  host.querySelectorAll('[data-action="del-room"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = btn.getAttribute('data-room-id');
      const room = STATE.rooms.find(r => String(r.id) === String(id));
      if (!id) return;
      const name = room?.name || id;
      if (!confirm(`Delete grow room “${name}”? This cannot be undone.`)) return;
      const ok = await safeRoomsDelete(id);
      if (ok) {
        setStatus(`Deleted room ${name}`);
        renderRooms();
      } else {
        alert('Failed to delete room');
      }
    });
  });
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

// --- SwitchBot Devices Management ---
function renderSwitchBotDevices() {
  const container = document.getElementById('switchbotDevicesList');
  if (!container) return;

  // Show a summary view with a link to the full manager
  container.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center;padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
      <div>
        <div class="row" style="align-items:center;gap:8px;margin-bottom:4px">
          <div style="width:8px;height:8px;border-radius:50%;background:#10b981"></div>
          <strong>Live SwitchBot Integration Active</strong>
        </div>
        <p class="tiny" style="margin:0;color:#64748b">Real-time monitoring of environmental sensors and smart devices</p>
      </div>
      <button onclick="openSwitchBotManager()" class="primary">🏠 Open Manager</button>
    </div>
    <div class="tiny" style="margin-top:8px;color:#64748b;text-align:center">
      Click "Open Device Manager" above for full device control and live status monitoring
    </div>
  `;
}

function openSwitchBotManager() {
  const width = Math.min(1400, window.screen.width * 0.9);
  const height = Math.min(900, window.screen.height * 0.9);
  const left = (window.screen.width - width) / 2;
  const top = (window.screen.height - height) / 2;
  
  window.open(
    '/switchbot.html',
    'switchbot-manager',
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
  );
}

async function refreshSwitchBotDevices() {
  try {
    // Try to fetch live data from SwitchBot API
    const response = await fetch('/api/switchbot/devices?refresh=1');
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SwitchBot API request failed (${response.status}): ${text || 'No response body'}`);
    }

    const data = await response.json();
    const meta = data.meta || {};

    if (meta.cached && meta.stale) {
      console.warn('SwitchBot device refresh using stale cache because live request failed:', meta.error || 'Unknown error');
    }

    if (data.statusCode === 100 && data.body?.deviceList) {
      // Update the local data file with live data
      const devices = data.body.deviceList.map(device => ({
        id: device.deviceId,
        name: device.deviceName,
        type: device.deviceType,
        location: '', // This would need to be set by user
        equipment_controlled: '', // This would need to be set by user
        status: 'active',
        battery: null, // Would be fetched from individual device status
        lastSeen: new Date().toISOString(),
        readings: {} // Would be populated from device status
      }));
      
      // Save to local data file
      const ok = await saveJSON('./data/switchbot-devices.json', { devices });

      if (ok) {
        STATE.switchbotDevices = devices;
        renderSwitchBotDevices();
        const toastKind = meta.cached && meta.stale ? 'warn' : 'success';
        showToast({
          title: 'SwitchBot Sync Complete',
          msg: meta.cached && meta.stale
            ? `Loaded ${devices.length} cached device(s); live refresh failed`
            : `Found ${devices.length} device(s) from SwitchBot API`,
          kind: toastKind,
          icon: toastKind === 'warn' ? '⚠️' : '🏠'
        }, 3000);
      }
    } else {
      throw new Error(data.message || 'Failed to fetch devices');
    }
  } catch (error) {
    console.error('Failed to refresh SwitchBot devices:', error);
    showToast({
      title: 'SwitchBot Sync Failed',
      msg: 'Could not connect to SwitchBot API. Check connection.',
      kind: 'error',
      icon: '❌'
    }, 4000);
  }
}

// Make functions globally available
window.openSwitchBotManager = openSwitchBotManager;

function renderPlans() {
  // Populate the Group Plan select with current plans
  const select = $('#groupPlan');
  if (!select) return;
  select.innerHTML = '<option value="">No plan</option>' +
    STATE.plans.map(plan => `<option value="${plan.id}">${plan.name}</option>`).join('');
}

// Plans panel rendering and wiring
function renderPlansPanel() {
  const host = document.getElementById('plansList');
  if (!host) return;
  const groupsByPlan = STATE.groups.reduce((acc, g) => {
    if (g.plan) { (acc[g.plan] = acc[g.plan] || []).push(g); }
    return acc;
  }, {});
  const toRow = (plan, idx) => {
    const spectrum = plan.spectrum || { cw:45, ww:45, bl:0, rd:0 };
    const ppfd = Number(plan.ppfd || 0);
    const photoperiod = Number(plan.photoperiod || 12);
    const dli = ppfd > 0 ? (ppfd * 3600 * photoperiod) / 1e6 : (Number(plan.dli || 0));
    const usedIn = (groupsByPlan[plan.id] || []).map(g=>g.name).join(', ');
    const idSafe = `plan-${idx}`;
    return `
      <div class="card" data-plan-id="${plan.id}">
        <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
          <h3 style="margin:0">${escapeHtml(plan.name || 'Untitled plan')}</h3>
          <div class="row" style="gap:6px">
            <button type="button" class="ghost" data-action="dup">Duplicate</button>
            <button type="button" class="ghost" data-action="del">Delete</button>
          </div>
        </div>
        <div class="tiny" style="color:#475569;margin:-2px 0 6px">${escapeHtml(plan.description || '')}</div>
        <div class="grid cols-2" style="align-items:start">
          <div>
            <label class="tiny">Name <input data-field="name" type="text" value="${escapeHtml(plan.name||'')}" placeholder="Plan name"></label>
            <label class="tiny">Description <input data-field="description" type="text" value="${escapeHtml(plan.description||'')}" placeholder="Short description"></label>
            <div class="row tiny" style="gap:8px;align-items:center;margin-top:6px">
              <label>PPFD <input data-field="ppfd" type="number" min="0" step="1" value="${ppfd}" style="width:90px"></label>
              <label>Photoperiod (h) <input data-field="photoperiod" type="number" min="0" max="24" step="0.5" value="${photoperiod}" style="width:90px"></label>
              <span class="chip" title="DLI = PPFD × 3600 × h ÷ 1e6">DLI ≈ ${(dli||0).toFixed(2)}</span>
            </div>
            <div class="row tiny" style="gap:8px;align-items:center;margin-top:6px">
              <label>CW <input data-field="cw" type="number" min="0" max="100" step="1" value="${spectrum.cw||0}" style="width:70px"></label>
              <label>WW <input data-field="ww" type="number" min="0" max="100" step="1" value="${spectrum.ww||0}" style="width:70px"></label>
              <label>Blue <input data-field="bl" type="number" min="0" max="100" step="1" value="${spectrum.bl||0}" style="width:70px"></label>
              <label>Red <input data-field="rd" type="number" min="0" max="100" step="1" value="${spectrum.rd||0}" style="width:70px"></label>
            </div>
            <div class="tiny" style="color:#475569;margin-top:6px">Used in: ${usedIn || '—'}</div>
          </div>
          <div>
            <div class="tiny" style="margin-bottom:4px">Spectrum preview (400–700 nm)</div>
            <canvas class="plan-spd" width="300" height="36" data-idx="${idx}"></canvas>
          </div>
        </div>
      </div>`;
  };
  host.innerHTML = (STATE.plans || []).map(toRow).join('');
  // Draw spectrum canvases and bind input listeners
  host.querySelectorAll('canvas.plan-spd').forEach((cv) => {
    const i = Number(cv.getAttribute('data-idx')) || 0;
    const plan = STATE.plans[i];
    const spec = plan?.spectrum || { cw:45, ww:45, bl:0, rd:0 };
    const spd = computeWeightedSPD(spec);
    renderSpectrumCanvas(cv, spd, { width: 300, height: 36 });
  });
  // Wiring per-card
  host.querySelectorAll('[data-plan-id]').forEach((card) => {
    const pid = card.getAttribute('data-plan-id');
    const plan = STATE.plans.find(p => p.id === pid);
    if (!plan) return;
    const bindNum = (selector, path) => {
      const el = card.querySelector(selector);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = Number(el.value || 0);
        const safe = Number.isFinite(v) ? v : 0;
        if (path === 'ppfd') plan.ppfd = safe;
        if (path === 'photoperiod') plan.photoperiod = safe;
        if (['cw','ww','bl','rd'].includes(path)) {
          plan.spectrum = plan.spectrum || { cw:45, ww:45, bl:0, rd:0 };
          plan.spectrum[path] = Math.max(0, Math.min(100, safe));
          // redraw canvas
          const cv = card.querySelector('canvas.plan-spd');
          if (cv) renderSpectrumCanvas(cv, computeWeightedSPD(plan.spectrum), { width:300, height:36 });
        }
        // live DLI chip update
        const ppfd = Number(plan.ppfd || 0);
        const photoperiod = Number(plan.photoperiod || 12);
        const chip = card.querySelector('.chip');
        if (chip) chip.textContent = `DLI ≈ ${((ppfd*3600*photoperiod)/1e6 || 0).toFixed(2)}`;
      });
    };
    const bindText = (selector, path) => {
      const el = card.querySelector(selector);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = (el.value || '').trim();
        if (path === 'name') plan.name = v;
        if (path === 'description') plan.description = v;
        // reflect h3 title if name changes
        if (path === 'name') { const h = card.querySelector('h3'); if (h) h.textContent = v || 'Untitled plan'; }
      });
    };
    bindText('input[data-field=name]', 'name');
    bindText('input[data-field=description]', 'description');
    bindNum('input[data-field=ppfd]', 'ppfd');
    bindNum('input[data-field=photoperiod]', 'photoperiod');
    bindNum('input[data-field=cw]', 'cw');
    bindNum('input[data-field=ww]', 'ww');
    bindNum('input[data-field=bl]', 'bl');
    bindNum('input[data-field=rd]', 'rd');
    // Actions: delete, duplicate
    card.querySelector('[data-action=del]')?.addEventListener('click', () => {
      if (!confirm(`Delete plan “${plan.name}”?`)) return;
      STATE.plans = STATE.plans.filter(p => p.id !== pid);
      // Unlink from groups
      STATE.groups.forEach(g => { if (g.plan === pid) g.plan = ''; });
      renderPlansPanel(); renderPlans();
    });
    card.querySelector('[data-action=dup]')?.addEventListener('click', () => {
      const clone = JSON.parse(JSON.stringify(plan));
      clone.id = `plan-${Math.random().toString(36).slice(2,8)}`;
      clone.name = `${plan.name || 'Untitled'} (copy)`;
      STATE.plans.push(clone);
      renderPlansPanel(); renderPlans();
    });
  });
}

// --- Research Mode Integration ---
function refreshDeviceCards() { renderDevices(); }

// --- Config banner and modal helpers ---
async function loadConfig() {
  try {
    const cfg = await api('/config');
    STATE.config = { singleServer: !!cfg?.singleServer, controller: cfg?.controller || '', envSource: cfg?.envSource || 'local', azureLatestUrl: cfg?.azureLatestUrl || null };
    // Note: configChip UI element has been removed for cleaner interface
  } catch (e) {
    console.warn('Failed to load /config', e);
  }
}

// --- Forwarder health polling ---
let FORWARDER_POLL_TIMER = null;
async function checkForwarderOnce() {
  try {
    const r = await fetch('/forwarder/healthz');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = await r.json();
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function startForwarderHealthPolling(intervalMs = 10000) {
  // Create status node in header since configChip was removed
  let host = document.getElementById('forwarderStatus');
  const parent = document.querySelector('.top-header') || document.body;
  if (!host) {
    host = document.createElement('span');
    host.id = 'forwarderStatus';
    host.className = 'tiny';
    host.style.marginLeft = '12px';
    parent.appendChild(host);
  }
  async function tick() {
    const res = await checkForwarderOnce();
    if (res.ok) {
      host.textContent = `Forwarder: OK → ${res.body?.target || ''}`;
      host.style.color = '#16A34A';
    } else {
      host.textContent = `Forwarder: down (${res.error})`;
      host.style.color = '#EF4444';
    }
  }
  clearInterval(FORWARDER_POLL_TIMER);
  tick();
  FORWARDER_POLL_TIMER = setInterval(tick, intervalMs);
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

  // Local Devices research toggle
  const devToggle = $('#devicesResearchToggle');
  if (devToggle) {
    STATE.deviceResearchLocal = getDevicesLocalResearch();
    devToggle.checked = STATE.deviceResearchLocal;
    devToggle.addEventListener('change', () => {
      setDevicesLocalResearch(devToggle.checked);
      renderDevices();
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
  const groupName = $('#groupName');
  const btnSaveGroup = $('#btnSaveGroup');
  const btnReloadGroups = $('#btnReloadGroups');
  const groupPlan = $('#groupPlan');
  const groupSchedule = $('#groupSchedule');
  const groupChips = $('#groupSpectraChip')?.parentElement;
  const groupSchedulePreview = $('#groupSchedulePreview');
  const groupRosterBody = $('#groupRosterBody');
  const groupRosterEmpty = $('#groupRosterEmpty');
  const groupsStatus = $('#groupsStatus');
  // Group-level location editor (batch)
  const groupQuick = $('#groupQuick');
  if (groupQuick && !groupQuick.dataset.enhanced) {
    groupQuick.dataset.enhanced = '1';
    const roomSel = document.createElement('input'); roomSel.type='text'; roomSel.placeholder='Room'; roomSel.style.minWidth='120px';
    const zoneSel = document.createElement('input'); zoneSel.type='text'; zoneSel.placeholder='Zone'; zoneSel.style.minWidth='120px';
    const applyBtn = document.createElement('button'); applyBtn.type='button'; applyBtn.className='ghost'; applyBtn.textContent='Apply to Group';
    const importBtn = document.createElement('button'); importBtn.type='button'; importBtn.className='ghost'; importBtn.textContent='Import selection'; importBtn.title = 'Import Devices panel selection as roster';
    const clearBtn = document.createElement('button'); clearBtn.type='button'; clearBtn.className='ghost danger'; clearBtn.textContent='Clear roster';
    groupQuick.append(roomSel, zoneSel, applyBtn, importBtn, clearBtn);
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
    importBtn.addEventListener('click', async () => {
      if (!STATE.currentGroup) return alert('Select a group first');
      const { scope, ids } = getDevicePickState();
      if (scope !== 'devices' || !ids.length) { showToast({ title:'Nothing to import', msg:'Switch Devices panel scope to Devices and select fixtures.', kind:'info', icon:'ℹ️' }); return; }
      const unique = Array.from(new Set(ids));
      STATE.currentGroup.lights = unique.map(id => ({ id, name: (STATE.devices.find(d=>d.id===id)?.deviceName)||id }));
      await saveGroups();
      updateGroupUI(STATE.currentGroup);
      setStatus(`Imported ${unique.length} device(s) to group`);
    });
    clearBtn.addEventListener('click', async () => {
      if (!STATE.currentGroup) return alert('Select a group first');
      if (!confirm('Clear all lights from this group?')) return;
      STATE.currentGroup.lights = [];
      await saveGroups();
      updateGroupUI(STATE.currentGroup);
      setStatus('Cleared group roster');
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
  // Visual accent for sliders to match channels (supported in modern browsers)
  try {
    if (gInputs.cw) gInputs.cw.style.accentColor = getComputedStyle(document.documentElement).getPropertyValue('--channel-cw') || '#E0F2FE';
    if (gInputs.ww) gInputs.ww.style.accentColor = getComputedStyle(document.documentElement).getPropertyValue('--channel-ww') || '#FEF3C7';
    if (gInputs.bl) gInputs.bl.style.accentColor = getComputedStyle(document.documentElement).getPropertyValue('--channel-bl') || '#DBEAFE';
    if (gInputs.rd) gInputs.rd.style.accentColor = getComputedStyle(document.documentElement).getPropertyValue('--channel-rd') || '#FECACA';
    if (gInputs.master) gInputs.master.style.accentColor = getComputedStyle(document.documentElement).getPropertyValue('--gr-primary') || '#0D7D7D';
  } catch {}

  // Compute payload and visualization mix from HUD/plan with green split and optional master scaling
  function computeMixAndHex(group) {
    const hud = readHUD();
    const basePlan = STATE.plans.find(p => p.id === group?.plan);
    const base = basePlan?.spectrum || { cw: 45, ww: 45, bl: 0, rd: 0 };
    // If HUD differs from plan spectrum, treat HUD as current mix; else use plan
    const differs = ['cw','ww','bl','rd'].some(k => Number(hud[k]) !== Number(base[k]));
    let mix = differs ? { cw: hud.cw, ww: hud.ww, bl: hud.bl, rd: hud.rd } : { ...base };
    // Enforce canonical green split: split total white equally into CW/WW for payload (do not mutate HUD inputs)
    const white = Math.max(0, Math.min(100, (Number(mix.cw)||0) + (Number(mix.ww)||0)));
    const cwSplit = Math.round(white / 2);
    const wwSplit = white - cwSplit; // ensures integer sum
    const splitMix = { cw: cwSplit, ww: wwSplit, bl: Math.max(0, Math.min(100, Number(mix.bl)||0)), rd: Math.max(0, Math.min(100, Number(mix.rd)||0)) };
    const scaled = hud.lock ? scaleMix(splitMix, hud.master) : { ...splitMix };
    const clamp01 = v => Math.max(0, Math.min(100, Math.round(Number(v)||0)));
    const finalMix = { cw: clamp01(scaled.cw), ww: clamp01(scaled.ww), bl: clamp01(scaled.bl), rd: clamp01(scaled.rd) };
    const hex12 = buildHex12({ ...finalMix, fr: 0, uv: 0 });
    return { mix: finalMix, hex12 };
  }
  // HUD helpers
  function setHUD(values = {}) {
    try {
      if (typeof values.master === 'number') {
        if (gInputs.master) gInputs.master.value = String(values.master);
        if (gInputs.masterV) gInputs.masterV.value = String(values.master);
      }
      if (typeof values.cw === 'number') { if (gInputs.cw) gInputs.cw.value = String(values.cw); if (gInputs.cwV) gInputs.cwV.value = String(values.cw); }
      if (typeof values.ww === 'number') { if (gInputs.ww) gInputs.ww.value = String(values.ww); if (gInputs.wwV) gInputs.wwV.value = String(values.ww); }
      if (typeof values.bl === 'number') { if (gInputs.bl) gInputs.bl.value = String(values.bl); if (gInputs.blV) gInputs.blV.value = String(values.bl); }
      if (typeof values.rd === 'number') { if (gInputs.rd) gInputs.rd.value = String(values.rd); if (gInputs.rdV) gInputs.rdV.value = String(values.rd); }
      if (typeof values.lock === 'boolean' && gInputs.lock) { gInputs.lock.checked = values.lock; }
    } catch {}
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
  // Pair a range input with a numeric input, keep them in sync and call optional onChange
  function connectPair(rangeEl, numEl, onChange) {
    if (!rangeEl || !numEl) return;
    const handler = () => { numEl.value = rangeEl.value; if (onChange) onChange(Number(rangeEl.value)); };
    const handlerNum = () => { rangeEl.value = numEl.value; if (onChange) onChange(Number(numEl.value)); };
    rangeEl.addEventListener('input', handler);
    numEl.addEventListener('input', handlerNum);
    // initialize linkage
    handler();
  }
  function scaleMix(mix, scalePct) {
    const s = Math.max(0, Math.min(100, scalePct)) / 100;
    return { cw: Math.round(mix.cw * s), ww: Math.round(mix.ww * s), bl: Math.round(mix.bl * s), rd: Math.round(mix.rd * s) };
  }
  function getGroupSpectrum(group) {
    const plan = STATE.plans.find(p => p.id === group?.plan);
    const hud = readHUD();
    const base = plan?.spectrum || { cw: 45, ww: 45, bl: 0, rd: 0 };
    const differs = ['cw','ww','bl','rd'].some(k => Number(hud[k]) !== Number(base[k]));
    const mix = differs ? { cw: hud.cw, ww: hud.ww, bl: hud.bl, rd: hud.rd } : base;
    return hud.lock ? { ...scaleMix(mix, hud.master), master: hud.master } : { ...mix, master: hud.master };
  }
  // Live re-render of group spectrum preview from HUD
  function renderGroupSpectrumPreview(group) {
    const host = document.getElementById('groupSpectrumPreview');
    if (!host) return;
    host.innerHTML = '';
    const { mix } = computeMixAndHex(group);
    const spd = computeWeightedSPD(mix);
    const cv = document.createElement('canvas');
    cv.className = 'group-spectrum__canvas';
    host.appendChild(cv);
    
    // Use consistent fixed dimensions to prevent resizing issues
    const w = 420;
    const h = 40;
    renderSpectrumCanvas(cv, spd, { width: w, height: h });

    // Also render twin canvases beside HUD sliders when present
    try {
      const hudCv = document.getElementById('groupHudCanvas');
      const planCv = document.getElementById('groupPlanCanvas');
      if (hudCv) {
        // Use consistent dimensions for HUD canvas
        const hW = 260;
        const hH = 90;
        renderSpectrumCanvas(hudCv, spd, { width: hW, height: hH });
      }
      if (planCv) {
        const plan = STATE.plans.find(p => p.id === group?.plan);
        const planSpec = plan?.spectrum || { cw: 45, ww: 45, bl: 0, rd: 0 };
        const planSpd = computeWeightedSPD({
          cw: Number(planSpec.cw||0), ww: Number(planSpec.ww||0), bl: Number(planSpec.bl||0), rd: Number(planSpec.rd||0)
        });
        const pW = 260;
        const pH = 90;
        renderSpectrumCanvas(planCv, planSpd, { width: pW, height: pH });
      }
    } catch (e) { /* non-fatal */ }
  }
  // Wire HUD input pairs
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
      // Always update spectrum preview on master change
      if (STATE.currentGroup) renderGroupSpectrumPreview(STATE.currentGroup);
    });
  }
  // Also update preview when any channel slider changes
  ;[gInputs.cw, gInputs.ww, gInputs.bl, gInputs.rd, gInputs.lock].forEach(inp => {
    try { inp?.addEventListener('input', () => { if (STATE.currentGroup) renderGroupSpectrumPreview(STATE.currentGroup); }); } catch {}
  });
  // Render the selected group's UI and helpers
  function updateGroupUI(group) {
    // Local element lookups to avoid stale references
    const groupPlan = document.getElementById('groupPlan');
    const groupSchedule = document.getElementById('groupSchedule');
    const chipsHost = document.getElementById('groupSpectraChip')?.parentElement || null;
    const schedulePreview = document.getElementById('groupSchedulePreview');
    const spectrumPreview = document.getElementById('groupSpectrumPreview');
    const groupRosterBody = document.getElementById('groupRosterBody');
    const groupRosterEmpty = document.getElementById('groupRosterEmpty');
    const groupsStatus = document.getElementById('groupsStatus');
    const groupName = document.getElementById('groupName');
    const ungroupedList = document.getElementById('ungroupedList');
    const ungroupedStatus = document.getElementById('ungroupedStatus');
    const ungroupedEmpty = document.getElementById('ungroupedEmpty');

    if (!group) {
      if (groupPlan) groupPlan.value = '';
      if (groupSchedule) groupSchedule.value = '';
      if (schedulePreview) schedulePreview.innerHTML='';
      if (spectrumPreview) spectrumPreview.innerHTML='';
      if (chipsHost) chipsHost.querySelectorAll('.chip[data-kind]').forEach(n=>n.remove());
      if (groupsStatus) groupsStatus.textContent = '';
      if (groupName) groupName.value = '';
      if (ungroupedList) ungroupedList.innerHTML = '';
      if (ungroupedStatus) ungroupedStatus.textContent = '';
      if (ungroupedEmpty) ungroupedEmpty.style.display = 'none';
      return;
    }
    if (groupPlan) groupPlan.value = group.plan || '';
    if (groupSchedule) groupSchedule.value = group.schedule || '';
    if (groupName) groupName.value = group.name || '';
    // Chip
    if (chipsHost) {
      chipsHost.querySelectorAll('.chip[data-kind]').forEach(n=>n.remove());
      // Plan chip with PPFD/DLI
      const plan = STATE.plans.find(p => p.id === group.plan);
      if (plan) {
        const photoperiod = (()=>{ const s = STATE.schedules.find(x=>x.id===group.schedule); return s ? getDailyOnHours(s) : (Number(plan.photoperiod)||12); })();
        const dli = (Number(plan.ppfd||0) * 3600 * photoperiod) / 1e6;
        const pchip = document.createElement('span');
        pchip.className = 'chip';
        pchip.dataset.kind = 'plan';
        pchip.textContent = `${plan.name} • PPFD ${Math.round(Number(plan.ppfd||0))} • DLI ${dli.toFixed(2)}`;
        pchip.title = 'Assigned plan';
        chipsHost.appendChild(pchip);
      }
      const sched = STATE.schedules.find(s => s.id === group.schedule);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.kind = 'sched';
      chip.textContent = sched ? scheduleSummary(sched) : 'No schedule';
      chip.title = 'Click to edit schedule';
      chip.addEventListener('click', () => openScheduleEditorForGroup(group.id));
      chipsHost.appendChild(chip);
    }
    // Preview
    if (schedulePreview) schedulePreview.innerHTML = '<div class="schedule-preview__bar"></div>';
    const bar = schedulePreview?.querySelector('.schedule-preview__bar');
    const sched = STATE.schedules.find(s => s.id === group.schedule);
    if (sched && bar) renderScheduleBar(bar, sched.cycles || []);
    // Spectrum preview driven by HUD (with green split + master scaling if locked)
    renderGroupSpectrumPreview(group);
    // Meta status: roster count and online
    try {
      const ids = (group.lights||[]).map(l=>l.id);
      const targets = STATE.devices.filter(d=>ids.includes(d.id));
      const online = targets.filter(d=>d.online).length;
      const planName = STATE.plans.find(p=>p.id===group.plan)?.name || '—';
      const schedName = STATE.schedules.find(s=>s.id===group.schedule)?.name || '—';
      if (groupsStatus) groupsStatus.textContent = `${ids.length} light(s) • ${online} online • Plan: ${planName} • Schedule: ${schedName}`;
    } catch {}
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

    // Render light cards for this group below the roster for quick control/visibility
    const lightList = document.getElementById('groupLightList');
    if (lightList) {
      lightList.innerHTML = '';
      const ids = (group.lights || []).map(l => l.id);
      const devices = STATE.devices.filter(d => ids.includes(d.id));
      // If a device is missing from STATE.devices (no live data), render a stub
      const missingIds = ids.filter(id => !devices.some(d => d.id === id));
      missingIds.forEach(id => devices.push(buildStubDevice(id)));
      devices.forEach(d => {
        const card = deviceCard(d, { compact: true });
        // Adjust spectrum canvas coloring: dynamic lights use group mix; static use plan preset
        try {
          const cv = card.querySelector('.device-spectrum__canvas');
          if (cv) {
            const meta = getDeviceMeta(d.id) || {};
            const isDynamic = ['cwPct','wwPct','blPct','rdPct'].some(k => d[k] !== undefined) || String(meta.spectrumMode||'dynamic')==='dynamic';
            const mix = isDynamic
              ? computeMixAndHex(group).mix
              : (meta.factorySpectrum || (STATE.plans.find(p=>p.id===group.plan)?.spectrum) || { cw:45, ww:45, bl:0, rd:0 });
            const spd = computeWeightedSPD({ cw: mix.cw||0, ww: mix.ww||0, bl: mix.bl||0, rd: mix.rd||0 });
            renderSpectrumCanvas(cv, spd, { width: 300, height: 36 });
            card.title = isDynamic ? 'Dynamic: using driver spectrum' : 'Static: using device factory spectrum';
          }
        } catch {}
        // Append a small remove button for roster management
        const rm = document.createElement('button');
        rm.type = 'button'; rm.className = 'ghost'; rm.textContent = 'Remove from group';
        rm.style.marginTop = '6px';
        rm.addEventListener('click', async () => {
          const idx = (group.lights||[]).findIndex(x => x.id === d.id);
          if (idx >= 0) {
            group.lights.splice(idx, 1);
            await saveJSON('./data/groups.json', { groups: STATE.groups });
            updateGroupUI(group);
          }
        });
        const wrap = document.createElement('div');
        wrap.appendChild(card); wrap.appendChild(rm);
        lightList.appendChild(wrap);
      });
    }
    // Initialize HUD from plan when switching groups
  const plan = STATE.plans.find(p => p.id === group?.plan);
  const spec = plan?.spectrum || { cw: 45, ww: 45, bl: 0, rd: 0 };
  setHUD({ master: 60, ...spec });
  // After seeding HUD, render preview
  renderGroupSpectrumPreview(group);

    // Ungrouped lights list with Add buttons
    try {
      if (ungroupedList) {
        const assigned = new Set((STATE.groups||[]).flatMap(g => (g.lights||[]).map(l=>l.id)));
        let allLights = (STATE.devices||[]).filter(d => d.type === 'light' || /light|fixture/i.test(d.deviceName||''));
        // Fallback: if no live devices, derive candidates from device registry (device-meta)
        if (!allLights.length) {
          const metaIds = Object.keys(STATE.deviceMeta || {});
          if (metaIds.length) {
            allLights = metaIds.map(id => buildStubDevice(id));
          }
        }
        const ungrouped = allLights.filter(d => !assigned.has(d.id));
        ungroupedList.innerHTML = '';
        if (!ungrouped.length) {
          if (ungroupedEmpty) {
            ungroupedEmpty.style.display = 'block';
            const hasAnyKnown = allLights.length > 0;
            ungroupedEmpty.textContent = hasAnyKnown ? 'All lights are assigned to groups.' : 'No known lights yet. Pair devices or add them in Farm/Rooms.';
          }
        } else {
          if (ungroupedEmpty) ungroupedEmpty.style.display = 'none';
          ungrouped.forEach(d => {
            const card = deviceCard(d, { compact: true });
            // Apply spectrum canvas coloring similar to group roster
            try {
              const cv = card.querySelector('.device-spectrum__canvas');
              if (cv) {
                const meta = getDeviceMeta(d.id) || {};
                const isDynamic = ['cwPct','wwPct','blPct','rdPct'].some(k => d[k] !== undefined) || String(meta.spectrumMode||'dynamic')==='dynamic';
                const mix = isDynamic
                  ? computeMixAndHex(group).mix
                  : (meta.factorySpectrum || (STATE.plans.find(p=>p.id===group.plan)?.spectrum) || { cw:45, ww:45, bl:0, rd:0 });
                const spd = computeWeightedSPD({ cw: mix.cw||0, ww: mix.ww||0, bl: mix.bl||0, rd: mix.rd||0 });
                renderSpectrumCanvas(cv, spd, { width: 300, height: 36 });
                card.title = isDynamic ? 'Dynamic: using driver spectrum' : 'Static: using device factory spectrum';
              }
            } catch {}
            const add = document.createElement('button');
            add.type = 'button'; add.className = 'ghost'; add.textContent = 'Add to group';
            add.style.marginTop = '6px';
            add.addEventListener('click', async () => {
              group.lights = group.lights || [];
              if (!group.lights.some(x => x.id === d.id)) group.lights.push({ id: d.id, name: d.deviceName || d.id });
              await saveGroups();
              updateGroupUI(group);
            });
            const wrap = document.createElement('div');
            wrap.appendChild(card); wrap.appendChild(add);
            ungroupedList.appendChild(wrap);
          });
        }
        if (ungroupedStatus) ungroupedStatus.textContent = `${ungrouped.length} ungrouped`;
      }
    } catch {}
  }
  // Expose for callers outside this scope
  window.updateGroupUI = updateGroupUI;
  

  function openScheduleEditorForGroup(groupId) {
    STATE.editingGroupId = groupId;
    const group = STATE.groups.find(g => g.id === groupId);
    const editor = document.getElementById('groupScheduleEditor');
    if (!editor) return;
    editor.style.display = 'block';
    // Prefill from group's schedule
    const sched = STATE.schedules.find(s => s.id === group?.schedule) || { mode:'one', cycles:[{on:'08:00',off:'20:00'}] };
    const modeRadios = Array.from(document.querySelectorAll('input[name="groupSchedMode"]'));
    const c1Start = document.getElementById('gSchedC1Start');
    const c1Hours = document.getElementById('gSchedC1Hours');
    const c1End = document.getElementById('gSchedC1End');
    const c2Wrap = document.getElementById('gSchedC2');
    const c2Start = document.getElementById('gSchedC2Start');
    const c2Hours = document.getElementById('gSchedC2Hours');
    const c2End = document.getElementById('gSchedC2End');
    const warn = document.getElementById('groupSchedWarn');
    const bar = document.getElementById('gSchedBar');

    const setMode = (m)=>{ modeRadios.forEach(r=>r.checked = r.value===m); c2Wrap.style.display = m==='two'?'block':'none'; };
    const durToHours = (on,off)=> (computeCycleDuration(on,off)/60);
    const recompute = ()=>{
      // compute ends from start + hours
      const on1 = c1Start.value || '08:00';
      const h1 = Math.max(0, Math.min(24, Number(c1Hours.value)||0));
      const off1 = minutesToHHMM(toMinutes(on1) + Math.round(h1*60));
      c1End.textContent = `End: ${off1}`;
      let cycles = [{ on: on1, off: off1 }];
      if (c2Wrap.style.display !== 'none') {
        const on2 = c2Start.value || '00:00';
        const h2 = Math.max(0, Math.min(24, Number(c2Hours.value)||0));
        const off2 = minutesToHHMM(toMinutes(on2) + Math.round(h2*60));
        c2End.textContent = `End: ${off2}`;
        cycles.push({ on: on2, off: off2 });
      }
      const mode = modeRadios.find(r=>r.checked)?.value || 'one';
      const { errors, onTotal } = validateSchedule(mode, cycles);
      const over = onTotal > 24*60 + 1e-6; // guard
      warn.style.display = (errors.length || over) ? 'inline' : 'none';
      warn.textContent = over ? 'Total ON exceeds 24 h' : (errors[0]||'');
      renderScheduleBar(bar, cycles);
    };

    // Prefill
    const mode = sched?.mode || 'one';
    setMode(mode);
    c1Start.value = sched?.cycles?.[0]?.on || '08:00';
    c1Hours.value = String(durToHours(sched?.cycles?.[0]?.on||'08:00', sched?.cycles?.[0]?.off||'20:00'));
    if (mode==='two') {
      c2Start.value = sched?.cycles?.[1]?.on || '20:00';
      c2Hours.value = String(durToHours(sched?.cycles?.[1]?.on||'20:00', sched?.cycles?.[1]?.off||'00:00'));
    }
    // Wire
    modeRadios.forEach(r=> r.onchange = ()=>{ setMode(r.value); recompute(); });
    ;[c1Start,c1Hours,c2Start,c2Hours].forEach(inp=> inp && (inp.oninput = recompute));
  document.getElementById('groupSchedSplit')?.addEventListener('click', ()=>{
      // Split 24h evenly starting at C1 start
      const on1 = c1Start.value || '00:00';
      c1Hours.value = '12';
      c2Start.value = minutesToHHMM(toMinutes(on1) + 12*60);
      c2Hours.value = '12';
      setMode('two');
      recompute();
  });
  document.getElementById('groupSchedFix')?.addEventListener('click', ()=>{
      // Ensure total ≤ 24 and no overlap: set C2 to start at C1 end, keep its hours but clamp to remainder
      const on1 = c1Start.value || '00:00';
      const off1 = minutesToHHMM(toMinutes(on1) + Math.round((Number(c1Hours.value)||0)*60));
      const c1Dur = computeCycleDuration(on1, off1);
      const rem = Math.max(0, 24*60 - c1Dur);
      if (rem === 0) { setMode('one'); } else {
        const origH2 = Math.max(0, Math.min(24, Number(c2Hours.value)||12));
        const newH2 = Math.min(origH2, rem/60);
        c2Start.value = off1;
        c2Hours.value = String(newH2);
        setMode('two');
      }
      recompute();
    });
    recompute();

    // Save/Cancel/Done
    const save = async ()=>{
      const mode = modeRadios.find(r=>r.checked)?.value || 'one';
      const on1 = c1Start.value || '08:00';
      const off1 = minutesToHHMM(toMinutes(on1) + Math.round((Number(c1Hours.value)||0)*60));
      const cycles = [{ on: on1, off: off1 }];
      if (mode==='two') {
        const on2 = c2Start.value || '20:00';
        const off2 = minutesToHHMM(toMinutes(on2) + Math.round((Number(c2Hours.value)||0)*60));
        cycles.push({ on: on2, off: off2 });
      }
      const { errors, onTotal } = validateSchedule(mode, cycles);
      if (errors.length || onTotal > 24*60 + 1e-6) {
        showToast({ title:'Fix schedule', msg: errors[0] || 'Total ON exceeds 24 h', kind:'warn', icon:'⚠️' });
        return;
      }
      const edited = { id:`group:${groupId}`, name:`${group?.name||groupId} Schedule`, mode, timezone:'America/Toronto', cycles };
      const idx = STATE.schedules.findIndex(s=>s.id===edited.id);
      if (idx>=0) STATE.schedules[idx] = { ...STATE.schedules[idx], ...edited, active:true }; else STATE.schedules.push({ ...edited, active:true });
      if (group) group.schedule = edited.id;
      await Promise.all([
        saveJSON('./data/schedules.json', { schedules: STATE.schedules }),
        saveJSON('./data/groups.json', { groups: STATE.groups })
      ]);
      updateGroupUI(group);
      setStatus('Saved group schedule');
    };
    const done = ()=>{ editor.style.display = 'none'; STATE.editingGroupId = null; };
    document.getElementById('groupSchedSave')?.addEventListener('click', save, { once:true });
    document.getElementById('groupSchedDone')?.addEventListener('click', async ()=>{ await save(); done(); }, { once:true });
    document.getElementById('groupSchedCancel')?.addEventListener('click', done, { once:true });
    editor.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }

  groupSelect?.addEventListener('change', () => {
    const id = groupSelect.value;
    STATE.currentGroup = STATE.groups.find(g => g.id === id) || null;
    updateGroupUI(STATE.currentGroup);
  });
  // Group name live-edit binding (changes state but not persisted until Save)
  groupName?.addEventListener('input', () => {
    if (!STATE.currentGroup) return;
    STATE.currentGroup.name = groupName.value || '';
    // reflect in select option text
    const opt = Array.from(groupSelect?.options||[]).find(o=>o.value===STATE.currentGroup.id);
    if (opt) opt.textContent = STATE.currentGroup.name || STATE.currentGroup.id;
  });
  // Save/Reload groups
  btnSaveGroup?.addEventListener('click', async () => {
    const name = (groupName?.value || '').trim();
    if (!name) { alert('Enter a group name'); return; }
    // Use current or create new
    let g = STATE.currentGroup;
    const ensureId = (nm)=>{
      const base = (nm||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'group';
      let id = base.startsWith('group-') ? base : `group-${base}`;
      const ids = new Set(STATE.groups.map(x=>x.id)); let i=2; while (ids.has(id)) { id = `${base}-${i++}`; }
      return id;
    };
    if (!g) {
      // Seed roster from Devices panel selection if any
      const pick = getDevicePickState();
      const selIds = (pick.scope==='devices' ? pick.ids : []).filter(Boolean);
      const lights = selIds.map(id => ({ id, name: STATE.devices.find(d=>d.id===id)?.deviceName || id }));
      g = { id: ensureId(name), name, lights, plan: '', schedule: '' };
      STATE.groups.push(g);
      STATE.currentGroup = g;
      renderGroups();
      if (groupSelect) groupSelect.value = g.id;
    } else {
      g.name = name;
    }
    await saveGroups();
    updateGroupUI(STATE.currentGroup);
    if (groupsStatus) groupsStatus.textContent = 'Group saved';
  });
  btnReloadGroups?.addEventListener('click', async () => {
    const data = await loadJSON('./data/groups.json');
    STATE.groups = data?.groups || [];
    renderGroups();
    // Keep currentGroup selection if id still exists
    if (STATE.currentGroup) {
      const cur = STATE.groups.find(g=>g.id===STATE.currentGroup.id) || null;
      STATE.currentGroup = cur;
      if (groupSelect) groupSelect.value = cur?.id || '';
      updateGroupUI(cur);
    }
    if (groupsStatus) groupsStatus.textContent = 'Groups reloaded';
  });
  // Delete group
  document.getElementById('btnDeleteGroup')?.addEventListener('click', async () => {
    if (!STATE.currentGroup) { alert('Select a group'); return; }
    const g = STATE.currentGroup;
    if (!confirm(`Delete group "${g.name||g.id}"? This won’t affect devices.`)) return;
    STATE.groups = (STATE.groups||[]).filter(x => x.id !== g.id);
    STATE.currentGroup = null;
    await saveGroups();
    renderGroups();
    updateGroupUI(null);
    setStatus('Group deleted');
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
    document.getElementById('plansPanel')?.scrollIntoView({ behavior: 'smooth' });
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

  // Quick actions: import selection from Devices panel and clear roster
  if (groupQuick && !groupQuick.querySelector('#grpImportSelection')) {
    const importBtn = document.createElement('button'); importBtn.id='grpImportSelection'; importBtn.type='button'; importBtn.className='ghost'; importBtn.textContent='Import selection';
    const clearBtn = document.createElement('button'); clearBtn.id='grpClearRoster'; clearBtn.type='button'; clearBtn.className='ghost'; clearBtn.textContent='Clear roster';
    groupQuick.append(importBtn, clearBtn);
    importBtn.addEventListener('click', async () => {
      if (!STATE.currentGroup) return alert('Select a group first');
      const pick = getDevicePickState();
      if (pick.scope !== 'devices' || !Array.isArray(pick.ids) || !pick.ids.length) { showToast({title:'No selection', msg:'Choose Devices scope and select lights in the Devices panel first.', kind:'info', icon:'ℹ️'}); return; }
      const ids = Array.from(new Set(pick.ids));
      STATE.currentGroup.lights = ids.map(id => ({ id, name: STATE.devices.find(d=>d.id===id)?.deviceName || id }));
      await saveGroups();
      updateGroupUI(STATE.currentGroup);
      setStatus(`Imported ${ids.length} light(s) into group`);
    });
    clearBtn.addEventListener('click', async () => {
      if (!STATE.currentGroup) return alert('Select a group first');
      if (!confirm('Remove all lights from this group?')) return;
      STATE.currentGroup.lights = [];
      await saveGroups();
      updateGroupUI(STATE.currentGroup);
    });
  }

  // Schedules editor wiring (Section 4 & 5)
  const schedModeRadios = Array.from(document.querySelectorAll('input[name="schedMode"]'));
  const schedInputs = ['#schedCycle1On','#schedC1Hours','#schedCycle2On','#schedC2Hours'].map(s=>$(s));
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
    const name = ($('#schedName')?.value || '').trim();
    const tz = $('#schedTz')?.value || 'America/Toronto';
    const mode = schedModeRadios.find(r=>r.checked)?.value || 'one';
    const c1On = $('#schedCycle1On').value;
    const c1Hours = Math.max(0, Math.min(24, Number($('#schedC1Hours')?.value || 0)));
    const c1Off = minutesToHHMM(toMinutes(c1On) + Math.round(c1Hours*60));
    const cycles = [ { on: c1On, off: c1Off } ];
    if (mode === 'two') {
      const c2On = $('#schedCycle2On').value;
      const c2Hours = Math.max(0, Math.min(24, Number($('#schedC2Hours')?.value || 0)));
      const c2Off = minutesToHHMM(toMinutes(c2On) + Math.round(c2Hours*60));
      cycles.push({ on: c2On, off: c2Off });
    }
    return { id: '', name, mode, timezone: tz, cycles };
  }

  function slugifyName(name) {
    return (name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'schedule';
  }

  function updateScheduleMathUI() {
    const s = getEditorSchedule();
    const { errors, onTotal, offTotal, overlapTrim } = validateSchedule(s.mode, s.cycles);
    onTotalEl.textContent = `${(onTotal/60).toFixed(1)} h`;
    offTotalEl.textContent = `${(offTotal/60).toFixed(1)} h`;
    // Use delta to show trimmed overlap in hours (0.0 h when none)
    deltaEl.textContent = `${(Math.max(0, overlapTrim)/60).toFixed(1)} h overlap`;
    if (errors.length) { warningEl.style.display = 'block'; warningEl.textContent = errors.join(' ');} else { warningEl.style.display = 'none'; }
  // Reflect computed end labels
  const c1Cycle = s.cycles[0];
  const c2Cycle = s.cycles[1];
  const c1EndEl = document.getElementById('schedC1End');
  const c2EndEl = document.getElementById('schedC2End');
  if (c1EndEl && c1Cycle) c1EndEl.textContent = `End: ${c1Cycle.off}`;
  if (c2EndEl && c2Cycle) c2EndEl.textContent = `End: ${c2Cycle.off}`;
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
  schedInputs.forEach(inp => inp?.addEventListener('input', updateScheduleMathUI));
  // Initialize preview and math on load
  try { updateScheduleMathUI(); } catch (e) { console.warn('sched math init failed', e); }
  splitBtn.addEventListener('click', () => {
    // Split evenly into two cycles of 12h starting at Cycle 1 ON
    const start = toMinutes($('#schedCycle1On').value || '00:00');
    $('#schedC1Hours').value = '12';
    $('#schedCycle2On').value = minutesToHHMM(start + 12*60);
    $('#schedC2Hours').value = '12';
    // Switch mode to two
    schedModeRadios.forEach(r=> r.checked = r.value==='two');
    updateScheduleMathUI();
  });

  fixBtn.addEventListener('click', () => {
    const mode = schedModeRadios.find(r=>r.checked)?.value || 'one';
    const c1On = $('#schedCycle1On').value;
    const c1Hours = Math.max(0, Math.min(24, Number($('#schedC1Hours')?.value || 0)));
    const c1Off = minutesToHHMM(toMinutes(c1On) + Math.round(c1Hours*60));
    if (mode === 'one') {
      // Ensure ON duration equals target (set OFF 24h after ON?) For one cycle, just ensure off after on within 24h.
      // If zero duration, set to 12h as a sane default
      const dur = computeCycleDuration(c1On, c1Off);
      if (dur === 0) $('#schedC1Hours').value = '12';
    } else {
      // Reposition Cycle 2 to start at Cycle 1 OFF and trim to fit within remaining day to avoid overlap
      const c1Dur = computeCycleDuration(c1On, c1Off);
      const origC2Hours = Math.max(0, Math.min(24, Number($('#schedC2Hours')?.value || 12)));
      const c2On = c1Off;
      const remaining = Math.max(0, 24*60 - c1Dur);
      const targetC2Hours = Math.min(origC2Hours, remaining/60);
      $('#schedCycle2On').value = c2On;
      $('#schedC2Hours').value = String(targetC2Hours);
    }
    updateScheduleMathUI();
  });

  async function saveSchedules() {
    const ok = await saveJSON('./data/schedules.json', { schedules: STATE.schedules });
    if (ok) setStatus('Schedules saved'); else alert('Failed to save schedules');
  }

  $('#btnSaveSched')?.addEventListener('click', async () => {
    const edited = getEditorSchedule();
    // Validate basic fields
    const name = edited.name?.trim();
    if (!name) { showToast({ title:'Name required', msg:'Enter a schedule name before saving.', kind:'warn', icon:'⚠️' }); return; }
    const { errors, onTotal } = validateSchedule(edited.mode, edited.cycles);
    if (errors.length || onTotal > 24*60 + 1e-6) {
      showToast({ title:'Fix schedule', msg: errors[0] || 'Total ON exceeds 24 h', kind:'warn', icon:'⚠️' });
      return;
    }
    // Upsert by name; create id from slug, ensure uniqueness
    const existingByName = STATE.schedules.findIndex(s => (s.name||'').trim().toLowerCase() === name.toLowerCase());
    if (existingByName >= 0) {
      const id = STATE.schedules[existingByName].id;
      STATE.schedules[existingByName] = { ...STATE.schedules[existingByName], ...edited, id, active: true };
    } else {
      let base = slugifyName(name);
      let id = base.startsWith('schedule-') ? base : `schedule-${base}`;
      const existingIds = new Set(STATE.schedules.map(s=>s.id));
      let i = 2;
      while (existingIds.has(id)) { id = `${base}-${i++}`; }
      STATE.schedules.push({ ...edited, id, active: true });
    }
    await saveSchedules();
    renderSchedules();
    setStatus('Schedule saved');
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
  // Inject Live/File-only toggle next to Apply button if not present
  try {
    const applyBtn = document.getElementById('grpApply');
    if (applyBtn && !document.getElementById('grpLiveToggle')) {
      const lbl = document.createElement('label');
      lbl.className = 'row tiny';
      lbl.style.marginLeft = '8px';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = 'grpLiveToggle'; cb.checked = true;
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(' Live'));
      applyBtn.parentElement?.appendChild(lbl);
    }
  } catch {}

  $('#grpApply')?.addEventListener('click', async () => {
    if (!STATE.currentGroup) return alert('Select a group first');
    const { mix, hex12 } = computeMixAndHex(STATE.currentGroup);
    const hex = hex12;
    const live = !!document.getElementById('grpLiveToggle')?.checked;
    const ids = (STATE.currentGroup.lights||[]).map(l=>l.id);
    const targets = STATE.devices.filter(d=>ids.includes(d.id));
    const online = targets.filter(d=>d.online);
    const offline = targets.filter(d=>!d.online);
    if (live && !online.length) { setStatus('No online devices to apply spectrum'); showToast({title:'No devices online', msg:'Skipped Apply Spectrum. All devices offline.', kind:'warn', icon:'⚠️'}); return; }
    // Guardrail: basic power-cap autoscale (if any channel > 100, clamp and notify)
    const over = ['cw','ww','bl','rd'].filter(k => mix[k] > 100);
    let appliedHex = hex;
    if (over.length) {
      const scaled = { ...mix };
      over.forEach(k => scaled[k] = 100);
      appliedHex = buildHex12({ ...scaled, fr: 0, uv: 0 });
      showToast({title:'Autoscaled to cap', msg:`Channels ${over.join(', ')} capped at 100%.`, kind:'info', icon:'ℹ️'});
    }
    if (live) {
      await Promise.all(online.map(d => patch(d.id, { status: 'on', value: appliedHex })));
      setStatus(`Applied spectrum to ${online.length} device(s)${offline.length?`, skipped ${offline.length} offline`:''}`);
      if (offline.length) {
        showToast({title:'Skipped offline devices', msg:`${offline.length} device(s) were offline and skipped.`, kind:'warn', icon:'⚠️'});
      }
      showToast({title:'Spectrum applied', msg:`Sent to ${online.length} device(s)`, kind:'success', icon:'✅'});
    } else {
      // File-only: persist to groups.json as a pending mix so a Room Wizard or future apply can use it
      try {
        STATE.currentGroup.pendingSpectrum = { ...mix, updatedAt: new Date().toISOString() };
        await saveJSON('./data/groups.json', { groups: STATE.groups });
        setStatus('Saved spectrum to file only (pending)');
        showToast({ title: 'Saved to file only', msg: 'Pending spectrum saved to groups.json', kind: 'info', icon: '💾' });
      } catch (e) {
        console.warn('File-only save failed', e);
      }
    }
    const chip = document.getElementById('groupSpectraChip');
    if (chip) chip.setAttribute('title', `Last payload: ${appliedHex}`);
    document.getElementById('groupLastHex')?.replaceChildren(document.createTextNode(`Last payload: ${appliedHex}`));
  });


  // Save current HUD as a new Plan and assign to this group
  if (!document.getElementById('grpSaveAsPlan')) {
    const actionsRow = document.getElementById('grpApply')?.parentElement;
    if (actionsRow) {
      const savePlanBtn = document.createElement('button');
      savePlanBtn.id = 'grpSaveAsPlan'; savePlanBtn.type='button'; savePlanBtn.className='ghost'; savePlanBtn.textContent='Save as Plan';
      actionsRow.appendChild(savePlanBtn);
      savePlanBtn.addEventListener('click', async () => {
        if (!STATE.currentGroup) return alert('Select a group first');
        const hud = readHUD();
        const sched = STATE.schedules.find(s=>s.id===STATE.currentGroup.schedule) || null;
        const photoperiod = sched ? getDailyOnHours(sched) : 12;
        const ppfdStr = prompt('Target PPFD for this plan? (µmol·m⁻²·s⁻¹)', '200');
        const ppfd = Math.max(0, Number(ppfdStr||0) || 0);
        const id = `plan-${Math.random().toString(36).slice(2,8)}`;
        const name = `${STATE.currentGroup.name || 'Group'} — Manual`;
        const plan = { id, name, description: 'Saved from Group HUD', spectrum: { cw: hud.cw, ww: hud.ww, bl: hud.bl, rd: hud.rd }, ppfd, photoperiod };
        STATE.plans.push(plan);
        // Assign to group and persist
        STATE.currentGroup.plan = id;
        await Promise.all([
          saveJSON('./data/plans.json', { plans: STATE.plans }),
          saveGroups()
        ]);
        renderPlans(); renderPlansPanel(); updateGroupUI(STATE.currentGroup);
        showToast({ title: 'Plan saved', msg: `Created “${name}” and assigned to group`, kind: 'success', icon: '✅' });
      });
    }
  }
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
    // Mirror to window for other helpers and populate the vendor/model selects
    window.DEVICE_MANUFACTURERS = DEVICE_MANUFACTURERS;
    try { populateVendorModelSelects(); } catch (e) { try { populateVendorSelect(); } catch(e2) { /* ignore */ } }
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

  async finish() {
    const cfg = this.collect();
    // If Wi‑Fi transport, attempt provisioning through the forwarder/controller proxy
    try {
      if (cfg.wifi) {
        if (this.progress) this.progress.textContent = 'Provisioning device Wi‑Fi via controller...';
        const resp = await fetch('/forwarder/provision/wifi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg.wifi) });
        if (!resp.ok) {
          const txt = await resp.text().catch(()=>null);
          showToast({ title: 'Provision failed', msg: `Controller returned ${resp.status}: ${txt || ''}`, kind: 'warn', icon: '⚠️' }, 6000);
        } else {
          const body = await resp.json().catch(()=>null);
          showToast({ title: 'Provisioning initiated', msg: body?.message || 'Controller accepted provisioning request', kind: 'success', icon: '✅' }, 4000);
        }
      }
      if (cfg.bluetooth) {
        if (this.progress) this.progress.textContent = 'Requesting controller to pair via Bluetooth...';
        const resp = await fetch('/forwarder/provision/bluetooth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg.bluetooth) });
        if (!resp.ok) {
          const txt = await resp.text().catch(()=>null);
          showToast({ title: 'BT pair failed', msg: `Controller returned ${resp.status}: ${txt || ''}`, kind: 'warn', icon: '⚠️' }, 6000);
        } else {
          const body = await resp.json().catch(()=>null);
          showToast({ title: 'Pairing requested', msg: body?.message || 'Controller pairing request sent', kind: 'success', icon: '✅' }, 4000);
        }
      }
    } catch (e) {
      showToast({ title: 'Provision error', msg: e.message || String(e), kind: 'warn', icon: '⚠️' }, 6000);
    } finally {
      if (this.progress) this.progress.textContent = '';
    }

    if (this.onSave) this.onSave(cfg);
    this.close();
  }
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
    // If selected model/vendor indicates a hub requirement, enforce hub-first.
    const vendor = document.getElementById('roomDeviceVendor')?.value || '';
    const model = document.getElementById('roomDeviceModel')?.value || '';
    const man = DEVICE_MANUFACTURERS && DEVICE_MANUFACTURERS.find(x=>x.name===vendor);
    const md = man && man.models && man.models.find(m=>m.model===model);
  // Prefer explicit requiresHub flags on model or manufacturer; fall back to feature-text heuristic
  const requiresHub = (md && md.requiresHub) || (man && man.requiresHub) || ((md && (md.features || []).some(f=>/bridge|hub|ir-bridge-required/i.test(f))) || false);
    if (requiresHub) {
      // Check if a hub is already added to room devices
      const hasHub = (roomWizardInstance.data.devices||[]).some(d=> (d.vendor===vendor && /(hub|bridge|bridge mini|hub)/i.test(d.model)) || (d.setup && d.setup.isHub));
      if (!hasHub) {
        showToast({ title: 'Hub required', msg: `${vendor} ${model} typically requires a hub. Please add the hub first.`, kind: 'warn', icon: '⚠️' }, 6000);
        // Optionally open device pair modal pre-configured for a hub
        DEVICE_PAIR_WIZARD.open({ suggestedTransport: 'wifi', onSave: (setup) => {
          const hubName = `${vendor} Hub`;
          const hubDevice = { name: hubName, vendor, model: `${vendor} Hub`, host: setup?.wifi?.staticIp || '', setup: { ...setup, isHub: true } };
          roomWizardInstance.data.devices = roomWizardInstance.data.devices || [];
          roomWizardInstance.data.devices.push(hubDevice);
          roomWizardInstance.renderDevicesList();
          showToast({ title: 'Hub added', msg: `Added ${hubName}. Now add child devices.`, kind: 'success', icon: '✅' }, 4000);
        }});
        return;
      }
    }

    DEVICE_PAIR_WIZARD.open({ suggestedTransport: suggested, onSave: (setup) => {
      const name = document.getElementById('roomDeviceName')?.value.trim() || '';
      const vendor = document.getElementById('roomDeviceVendor')?.value || '';
      const model = document.getElementById('roomDeviceModel')?.value || '';
      const host = document.getElementById('roomDeviceHost')?.value.trim() || '';
      roomWizardInstance.data.devices = roomWizardInstance.data.devices || [];
      const device = { name: name || `${vendor} ${model}`, vendor, model, host, setup };
  // Clear any previous invalid input markers before adding
  ['deviceRs485UnitId','device0v10Channel','device0v10Scale'].forEach(id=>{ try{ clearFieldError(id); }catch(e){ const el=document.getElementById(id); if(el) el.classList.remove('invalid'); } });
      roomWizardInstance.data.devices.push(device);
      roomWizardInstance.renderDevicesList();
    }});
  });
}

// --- Top Card and AI Features Management ---
function initializeTopCard() {
  // Update farm name and logo when farm data is available
  const updateFarmDisplay = () => {
    const farmNameEl = document.getElementById('farmName');
    const farmBrandingSection = document.getElementById('farmBrandingSection');
    const farmLogoEl = document.getElementById('farmLogo');
    const lightEngineTitleEl = document.getElementById('lightEngineTitle');
    const farmTaglineEl = document.getElementById('farmTagline');
    
    if (STATE.farm && STATE.farm.name) {
      // Show farm branding section
      if (farmBrandingSection) {
        farmBrandingSection.style.display = 'block';
      }
      
      // Update farm name
      if (farmNameEl) {
        farmNameEl.textContent = STATE.farm.name;
      }
      
      // Update farm tagline if available
      if (farmTaglineEl && STATE.farm.tagline) {
        farmTaglineEl.textContent = STATE.farm.tagline;
        farmTaglineEl.style.display = 'block';
      }
      
      // Update farm logo
      if (farmLogoEl && STATE.farm.logo) {
        farmLogoEl.src = STATE.farm.logo;
        farmLogoEl.style.display = 'block';
      }
      
      // Apply farm brand colors to Light Engine Charlie title (colors only, not fonts)
      if (lightEngineTitleEl && STATE.farm.brandColors) {
        const brandColors = STATE.farm.brandColors;
        if (brandColors.primary) {
          lightEngineTitleEl.style.color = brandColors.primary;
          // Update CSS custom property for farm accent color
          document.documentElement.style.setProperty('--farm-accent', brandColors.primary);
        }
        
        // Set farm brand CSS variables for farm branding elements
        if (brandColors.primary) {
          document.documentElement.style.setProperty('--farm-primary', brandColors.primary);
        }
        if (brandColors.secondary) {
          document.documentElement.style.setProperty('--farm-secondary', brandColors.secondary);
        }
        if (STATE.farm.brandFont) {
          document.documentElement.style.setProperty('--farm-font', STATE.farm.brandFont);
        }
      }
    } else {
      // Hide farm branding section if no farm data
      if (farmBrandingSection) {
        farmBrandingSection.style.display = 'none';
      }
    }
  };
  
  // Call immediately and set up periodic updates
  updateFarmDisplay();
  setInterval(updateFarmDisplay, 5000);
}

function initializeAIFeatures() {
  const aiFeatures = {
    spectrasync: { 
      name: 'SpectraSync®', 
      status: 'on',
      description: 'SpectraSync dynamically adjusts light spectrum and intensity in response to farm environmental data, supporting temperature, humidity, and crop-specific management.'
    },
    evie: { 
      name: 'E.V.I.E', 
      status: 'off',
      description: 'E.V.I.E autonomously manages the growing environment, crop forecasting, and placement. Explores sales trends, updates planting schedules, and applies incremental micro-changes.'
    },
    'ia-training': { 
      name: 'IA In Training', 
      status: 'always-on',
      description: 'Uses farm and external environmental data to continuously learn and adapt to local growing conditions, preparing for autonomous optimization.'
    },
    'ia-assist': { 
      name: 'IA Assist', 
      status: 'always-on',
      description: 'Provides recommendations to growers, highlighting correlations and causal factors within the growing environment to support informed decisions.'
    },
    eii: { 
      name: 'E.I² Environmental Impact Index', 
      status: 'dev',
      description: 'Measures and reports environmental impact, providing transparency and shared knowledge on sustainability performance for both farm operators and the public.'
    }
  };

  // Add click handlers for AI feature cards
  document.querySelectorAll('.ai-feature-card').forEach(card => {
    const feature = card.dataset.feature;
    const featureData = aiFeatures[feature];
    
    if (!featureData) return;

    card.addEventListener('click', () => {
      // Toggle active state for toggleable features
      if (featureData.status === 'on' || featureData.status === 'off') {
        const isActive = card.classList.contains('active');
        if (isActive) {
          card.classList.remove('active');
          featureData.status = 'off';
          updateFeatureStatus(card, 'off');
        } else {
          card.classList.add('active');
          featureData.status = 'on';
          updateFeatureStatus(card, 'on');
        }
        
        // Show toast notification
        showToast({
          title: featureData.name,
          msg: `${featureData.name} is now ${featureData.status.toUpperCase()}`,
          kind: featureData.status === 'on' ? 'success' : 'info',
          icon: featureData.status === 'on' ? '✅' : '⏸️'
        });
      }
    });

    // Add hover tooltip functionality using existing tooltip system
    card.addEventListener('mouseenter', (e) => {
      card.setAttribute('data-tip', featureData.description);
      showTipFor(card);
    });

    card.addEventListener('mouseleave', () => {
      const tooltip = document.getElementById('tooltip');
      if (tooltip) {
        tooltip.setAttribute('aria-hidden', 'true');
      }
    });
  });

  // Connect SpectraSync to Research Mode
  const researchToggle = document.getElementById('researchModeToggle');
  if (researchToggle) {
    researchToggle.addEventListener('change', () => {
      const spectraSyncCard = document.getElementById('spectraSyncFeature');
      if (spectraSyncCard) {
        if (researchToggle.checked) {
          spectraSyncCard.classList.add('active');
          updateFeatureStatus(spectraSyncCard, 'on');
        } else {
          spectraSyncCard.classList.remove('active');
          updateFeatureStatus(spectraSyncCard, 'off');
        }
      }
    });
  }
}

function updateFeatureStatus(card, status) {
  const statusEl = card.querySelector('.ai-feature-status');
  if (!statusEl) return;
  
  statusEl.className = `ai-feature-status ${status}`;
  statusEl.textContent = status === 'on' ? 'ON' : 
                        status === 'off' ? 'OFF' : 
                        status === 'always-on' ? 'ALWAYS ON' : 
                        status === 'dev' ? 'DEV' : status.toUpperCase();
}

document.addEventListener('DOMContentLoaded', async () => {
  wireHints();
  wireGlobalEvents();
  // Load runtime config and show chip
  await loadConfig();
  // Start forwarder health polling (shows status near the config chip)
  try { startForwarderHealthPolling(10000); } catch (e) { console.warn('Failed to start forwarder polling', e); }
  
  // Initialize AI features and top card
  initializeTopCard();
  initializeAIFeatures();
  
  // Initialize farm wizard
  farmWizard = new FarmWizard();
  // Initialize device manager window
  deviceManagerWindow = new DeviceManagerWindow();
  window.deviceManagerWindow = deviceManagerWindow;
  // Initialize room wizard
  roomWizard = new RoomWizard();
  // Wire pairing hook so Add Device opens the DevicePairWizard
  try { hookRoomDevicePairing(roomWizard); } catch (e) { console.warn('Failed to hook device pairing', e); }
  
  // Load all data (devices will be fetched preferring the forwarder proxy)
  await loadAllData();
  // Wire Plans panel buttons
  try {
    document.getElementById('btnAddPlan')?.addEventListener('click', () => {
      const id = `plan-${Math.random().toString(36).slice(2,8)}`;
      STATE.plans.push({ id, name: 'New plan', description: '', spectrum: { cw:45, ww:45, bl:0, rd:10 }, ppfd: 200, photoperiod: 12 });
      renderPlans();
      renderPlansPanel();
      const status = document.getElementById('plansStatus'); if (status) status.textContent = 'Draft plan added';
    });
    document.getElementById('btnSavePlans')?.addEventListener('click', async () => {
      try {
        const ok = await saveJSON('./data/plans.json', { plans: STATE.plans });
        const status = document.getElementById('plansStatus'); if (status) status.textContent = ok ? 'Saved' : 'Save failed';
        renderPlans();
        renderPlansPanel();
        if (typeof renderGroups === 'function') renderGroups();
      } catch (e) {
        const status = document.getElementById('plansStatus'); if (status) status.textContent = 'Save failed';
      }
    });
    document.getElementById('btnDownloadPlans')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ plans: STATE.plans }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'plans.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
    });
    document.getElementById('btnUploadPlans')?.addEventListener('click', () => {
      document.getElementById('plansUpload')?.click();
    });
    document.getElementById('plansUpload')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        const incoming = Array.isArray(data) ? data : (data.plans || []);
        if (!Array.isArray(incoming)) throw new Error('Invalid format');
        // merge by id or append
        const map = new Map(STATE.plans.map(p => [p.id, p]));
        for (const p of incoming) {
          const id = p.id || `plan-${Math.random().toString(36).slice(2,8)}`;
          map.set(id, { ...map.get(p.id), ...p, id });
        }
        STATE.plans = Array.from(map.values());
        renderPlans();
        renderPlansPanel();
        const status = document.getElementById('plansStatus'); if (status) status.textContent = 'Imported';
      } catch (err) {
        const status = document.getElementById('plansStatus'); if (status) status.textContent = 'Import failed';
      }
      e.target.value = '';
    });
  } catch (e) { console.warn('Plans panel wiring failed', e); }
  
  // Wire SwitchBot panel buttons
  try {
    document.getElementById('btnOpenSwitchBotManager')?.addEventListener('click', openSwitchBotManager);
    document.getElementById('btnRefreshSwitchBot')?.addEventListener('click', refreshSwitchBotDevices);
  } catch (e) { console.warn('SwitchBot panel wiring failed', e); }
  
  // Load device KB for vendor/model selects
  await loadDeviceManufacturers();
  // Apply saved branding if present
  try {
    const farmLocal = JSON.parse(localStorage.getItem('gr.farm') || 'null') || STATE.farm;
    const branding = farmLocal?.branding || STATE.farm?.branding;
    if (branding?.palette) applyTheme(branding.palette, { fontFamily: branding.fontFamily || '' });
    if (Array.isArray(branding?.fontCss) && branding.fontCss.length) {
      const id = 'gr-brand-fonts'; let link = document.getElementById(id); if (!link) { link = document.createElement('link'); link.id = id; link.rel = 'stylesheet'; document.head.appendChild(link); }
      link.href = branding.fontCss[0];
    }
    const headerLogo = document.querySelector('.header.logo img');
    if (headerLogo && branding?.logo) { headerLogo.src = branding.logo; headerLogo.style.display = 'inline-block'; }
    const title = document.querySelector('.header.logo h1');
    if (title && branding?.fontFamily) { title.style.fontFamily = branding.fontFamily + ', var(--gr-font)'; }
  } catch {}
  
  setStatus("Dashboard loaded");
});
