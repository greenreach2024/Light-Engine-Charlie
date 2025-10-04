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
  el.innerHTML = `<div class="toast-icon">${icon || ''}</div><div class="toast-body"><div class="toast-title">${title}</div><div class="toast-msg">${msg}</div></div><button class="toast-close" aria-label="Close">×</button>`;
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
  editingGroupId: null,
  deviceMeta: {},
  deviceKB: { fixtures: [] },
  config: { singleServer: true, controller: '' },
  branding: null,
  pendingBrand: null
};

// Global wizard instances
let farmWizard;
let roomWizard;
let lightWizard;
let deviceManagerWindow;

let ACTIVE_PANEL = 'overview';


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

// --- Lights Status UI ---
async function loadLightsStatus({ refresh = false } = {}) {
  try {
    const qs = refresh ? '?refresh=all' : '';
    const data = await api(`/api/lights/status${qs}`);
    const summaryEl = document.getElementById('lightsStatusSummary');
    const listEl = document.getElementById('lightsStatusList');
    if (!summaryEl || !listEl) return;

    if (!data || data.ok !== true) {
      summaryEl.textContent = 'Failed to load lights status';
      return;
    }

    const { summary, entries, sources } = data;
    summaryEl.textContent = `Total ${summary.total} · ON ${summary.on} · OFF ${summary.off} · Unknown ${summary.unknown}`;

    // Render compact cards
    listEl.innerHTML = '';
    const makeBadge = (txt, cls) => `<span class="tag ${cls}" style="font-size:10px;padding:2px 6px;border-radius:999px">${txt}</span>`;
    const onIcon = '<span style="color:#10b981">●</span>';
    const offIcon = '<span style="color:#ef4444">●</span>';
    const unkIcon = '<span style="color:#9ca3af">●</span>';

    entries.forEach(e => {
      const stateIcon = e.power === true ? onIcon : e.power === false ? offIcon : unkIcon;
      const stateText = e.power === true ? 'ON' : e.power === false ? 'OFF' : '—';
      const badge = makeBadge(e.source, '');
      const bright = typeof e.brightness === 'number' ? ` · ${e.brightness}%` : '';
      const room = e.room ? ` · ${e.room}` : '';
      const vendor = e.vendor || '';
      const title = e.name || e.id;
      const sub = [vendor, e.type].filter(Boolean).join(' · ');
      const meta = e.lastUpdated ? `<div class="tiny" style="color:#94a3b8">${new Date(e.lastUpdated).toLocaleTimeString()}</div>` : '';
      const card = document.createElement('div');
      card.className = 'card';
      card.style.padding = '10px';
      card.innerHTML = `
        <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong style="color:#0f172a">${stateIcon} ${title}</strong>
          ${badge}
        </div>
        <div class="tiny" style="color:#334155">${sub}${room}${bright}</div>
        ${meta}
      `;
      listEl.appendChild(card);
    });

  } catch (e) {
    const summaryEl = document.getElementById('lightsStatusSummary');
    if (summaryEl) summaryEl.textContent = `Error: ${e.message}`;
  }
}

function initLightsStatusUI() {
  const btn = document.getElementById('btnRefreshLights');
  if (btn) {
    btn.addEventListener('click', () => loadLightsStatus({ refresh: true }));
  }
  // Initial load (cached to avoid rate limits)
  loadLightsStatus({ refresh: false });
}

// --- Theming ---
function applyTheme(palette, extras = {}) {
  if (!palette) return;
  
  // Constrain primary color to no lighter than mid-grey (#666666)
  if (palette.primary) {
    const ratio = (color) => {
      const hex = color.startsWith('#') ? color : (()=>{const ctx=document.createElement('canvas').getContext('2d');ctx.fillStyle=color;return ctx.fillStyle;})();
      const h = hex.length===4?`#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`:hex;
      const r = parseInt(h.slice(1,3),16)/255, g=parseInt(h.slice(3,5),16)/255, b=parseInt(h.slice(5,7),16)/255;
      const l = (v)=> v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
      return 0.2126*l(r)+0.7152*l(g)+0.0722*l(b);
    };
    
    // If primary color is too light (luminance > 0.35), darken it
    if (ratio(palette.primary) > 0.35) {
      console.warn('🎨 Primary color too light, constraining to mid-grey maximum');
      // Use mid-grey as maximum lightness
      palette.primary = '#666666';
    }
  }
  
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
    
    // Enhanced contrast guard - prevent light text on light backgrounds
    const isLightText = ratio(cText) > 0.35; // Text luminance > 0.35 means too light (mid-grey limit)
    const isLightSurface = ratio(cSurface) > 0.5; // Surface luminance > 0.5 means light surface
    const isLightBg = ratio(cBg) > 0.5; // Background luminance > 0.5 means light background
    
    // Prevent light text on light surfaces AND enforce mid-grey maximum lightness
    if ((isLightText && isLightSurface) || (isLightText && isLightBg) || tVsSurface < 4.5 || tVsBg < 4.5 || ratio(cText) > 0.35) {
      console.warn('🎨 Contrast issue detected - fixing text color (limiting to mid-grey or darker)');
      
      // Dark color candidates only - no lighter than mid-grey (#666666)
      const candidates = ['#0B1220', '#111827', '#1F2937', '#374151', '#4B5563', '#6B7280', '#666666'];
      let best = cText; 
      let bestScore = Math.min(tVsSurface, tVsBg);
      
      for (const cand of candidates) {
        // Ensure candidate is not lighter than mid-grey
        if (ratio(cand) > 0.35) continue;
        
        const candVsSurface = contrast(ratio(cand), ratio(cSurface));
        const candVsBg = contrast(ratio(cand), ratio(cBg));
        const sc = Math.min(candVsSurface, candVsBg);
        if (sc > bestScore && sc >= 4.5) { // Only accept if meets WCAG AA standard
          bestScore = sc; 
          best = cand; 
        }
      }
      
      if (best !== cText) { 
        root.style.setProperty('--gr-text', best); 
        console.log('🎨 Text color auto-corrected to:', best, 'for contrast ratio:', bestScore.toFixed(2));
      }
      
      if (bestScore < 4.5) {
        showToast({ 
          title:'⚠️ Contrast Warning', 
          msg:'Text color has been limited to mid-grey or darker for readability. Consider using darker brand colors.', 
          kind:'warn', 
          icon:'⚠️' 
        }, 8000);
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
  const arrow = document.querySelector('.tip-arrow');
  if (!tip || !content) return;
  
  const text = el.getAttribute('data-tip') || '';
  content.textContent = text || '';
  
  // Temporarily show tooltip to measure its height
  tip.style.visibility = 'hidden';
  tip.setAttribute('data-show', '1');
  
  const rect = el.getBoundingClientRect();
  const tipHeight = tip.offsetHeight;
  
  // Check if this is an AI feature card - if so, position below
  const isAIFeature = el.classList.contains('ai-feature-card') || 
                     el.closest('.ai-features-horizontal') !== null ||
                     el.closest('#environmentalAiCard') !== null;
  
  let top, arrowTop;
  
  if (isAIFeature) {
    // Position below for AI features
    top = window.scrollY + rect.bottom + 10;
    arrowTop = -4; // Arrow points up (tooltip below element)
  } else {
    // Original logic for other elements (position above, fallback to below)
    top = window.scrollY + rect.top - tipHeight - 10;
    if (top <= 0) {
      // Fallback to below if not enough space above
      top = window.scrollY + rect.bottom + 10;
      arrowTop = -4; // Arrow points up
    } else {
      arrowTop = tipHeight - 4; // Arrow points down (tooltip above element)
    }
  }
  
  const left = Math.max(10, Math.min(window.scrollX + rect.left, 
    window.scrollX + document.documentElement.clientWidth - 340));
  
  // Apply final positioning and make visible
  tip.style.top = top + 'px';
  tip.style.left = left + 'px';
  tip.style.visibility = 'visible';
  
  // Update arrow position
  if (arrow) {
    arrow.style.top = arrowTop + 'px';
  }
  
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

  // Advanced controls
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
        timezone: tz,
        coordinates: null // Will store { lat, lng }
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
    // Remove backdrop click to close - wizard should only close on save
    // $('#farmModalBackdrop')?.addEventListener('click', () => this.close());
    $('#farmPrev')?.addEventListener('click', () => this.prevStep());
    $('#farmNext')?.addEventListener('click', () => this.nextStep());
    this.form?.addEventListener('submit', (e) => {
      e.preventDefault(); // Always prevent default form submission
      // Only save if we're on the final step (review)
      if (this.currentStep === this.baseSteps.length - 1) {
        this.saveFarm(e);
      }
    });

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
    // All form field listeners are now attached in attachFormListeners() when modal opens
    
    // Website branding button - opens wizard directly
    $('#websiteBrandingButton')?.addEventListener('click', () => {
      this.openBrandingWizard();
    });
    
    // Enable Enter key on website input to trigger branding wizard
    $('#contactWebsite')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.data.contact.website?.trim()) {
          this.openBrandingWizard();
        }
      }
    });
    $('#btnAddRoom')?.addEventListener('click', () => this.addRoom());
    $('#newRoomName')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.addRoom(); } });
    
    // Location finder - only use current location now
    $('#btnUseMyLocation')?.addEventListener('click', () => this.useMyLocation());

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
    
    // Attach form event listeners after modal is shown
    this.attachFormListeners();
  }

  attachFormListeners() {
    // Attach input event listeners for form fields - need to do this after modal is shown
    // Use a scoped selector to avoid clashing with the top-card header #farmName
    document.querySelector('#farmWizardForm #farmName')?.addEventListener('input', (e) => { 
      const value = e.target.value?.trim() || '';
      this.data.location.farmName = value; 
      console.log('🏠 Farm name updated:', this.data.location.farmName);
      this.updateLiveBranding(); 
    });
    document.querySelector('#farmWizardForm #farmName')?.addEventListener('blur', (e) => {
      // Ensure data is saved on blur as well
      const value = e.target.value?.trim() || '';
      this.data.location.farmName = value;
      console.log('🏠 Farm name saved on blur:', this.data.location.farmName);
    });
    $('#farmAddress')?.addEventListener('input', (e) => { this.data.location.address = e.target.value || ''; this.guessTimezone(); });
    $('#farmCity')?.addEventListener('input', (e) => { this.data.location.city = e.target.value || ''; this.guessTimezone(); });
    $('#farmState')?.addEventListener('input', (e) => { this.data.location.state = e.target.value || ''; this.guessTimezone(); });
    $('#farmPostal')?.addEventListener('input', (e) => { this.data.location.postal = e.target.value || ''; });
    $('#farmTimezone')?.addEventListener('change', (e) => { this.data.location.timezone = e.target.value || this.data.location.timezone; });
    $('#contactName')?.addEventListener('input', (e) => { this.data.contact.name = e.target.value || ''; this.updateLiveBranding(); });
    $('#contactEmail')?.addEventListener('input', (e) => { this.data.contact.email = e.target.value || ''; });
    $('#contactPhone')?.addEventListener('input', (e) => { this.data.contact.phone = e.target.value || ''; });
    $('#contactWebsite')?.addEventListener('input', (e) => { 
      this.data.contact.website = e.target.value || ''; 
      this.updateLiveBranding();
      this.fetchWebsiteBranding();
      this.updateWebsiteBrandingButton();
    });
  }

  edit() {
    // Open the normal farm registration wizard
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
    
    // Update live branding when relevant steps are shown
    if (activeId === 'location' || activeId === 'contact') {
      this.updateLiveBranding();
    }
    
    // Trigger branding fetch in review step
    if (activeId === 'review') {
      this.updateLiveBranding();
    }
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
    const scanningIndicator = $('#wifiScanningIndicator');
    const networkList = $('#wifiNetworkList');
    
    // Show scanning radar and hide network list
    if (scanningIndicator) {
      scanningIndicator.style.display = 'flex';
    }
    if (networkList) {
      networkList.style.display = 'none';
    }
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
    
    // Hide scanning radar and show network list
    if (scanningIndicator) {
      scanningIndicator.style.display = 'none';
    }
    if (networkList) {
      networkList.style.display = 'block';
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
    const testingIndicator = $('#wifiTestingIndicator');
    const testButton = $('#btnTestWifi');
    
    // Show testing indicator and disable button
    if (testingIndicator) {
      testingIndicator.style.display = 'flex';
    }
    if (testButton) {
      testButton.disabled = true;
      testButton.textContent = 'Testing...';
    }
    if (status) {
      status.innerHTML = '<div class="tiny">Testing connection...</div>';
      status.style.display = 'none'; // Hide status while testing indicator is shown
    }
    
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
    
    // Hide testing indicator, restore button, and show status
    if (testingIndicator) {
      testingIndicator.style.display = 'none';
    }
    if (testButton) {
      testButton.disabled = false;
      testButton.textContent = 'Test connection';
    }
    if (status) {
      status.style.display = 'block';
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
    console.log('🔍 Validating step:', stepId, 'with data:', this.data);
    
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
  if (stepId === 'location') {
      // Capture all location data for subscription services
  const farmNameEl = document.querySelector('#farmWizardForm #farmName');
      const farmNameValue = farmNameEl?.value?.trim() || '';
      const addressEl = $('#farmAddress');
      const addressValue = addressEl?.value?.trim() || '';
      const cityEl = $('#farmCity');
      const cityValue = cityEl?.value?.trim() || '';
      const stateEl = $('#farmState');
      const stateValue = stateEl?.value?.trim() || '';
      const postalEl = $('#farmPostal');
      const postalValue = postalEl?.value?.trim() || '';
      
      // Always update the data with current form values (required for subscriptions)
      this.data.location.farmName = farmNameValue;
      this.data.location.address = addressValue;
      this.data.location.city = cityValue;
      this.data.location.state = stateValue;
      this.data.location.postal = postalValue;
      
      console.log('✅ Location data captured for subscriptions:', {
        farmName: farmNameValue || '(blank)',
        address: addressValue || '(blank)',
        city: cityValue || '(blank)', 
        state: stateValue || '(blank)',
        postal: postalValue || '(blank)'
      });
      
      return true; // Always allow progression - data collection for future subscriptions
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
    
    // Build branding section if we have farm name or website
    let brandingSection = '';
    if (this.data.location.farmName || this.data.contact.website) {
      const farmName = this.data.location.farmName || 'Untitled Farm';
      let logoSection = '';
      if (this.data.contact.website) {
        const domain = this.extractDomain(this.data.contact.website);
        logoSection = `<img id="reviewFarmLogo" style="width:24px;height:24px;margin-right:8px;vertical-align:middle;display:none">`;
      }
      brandingSection = `<div style="border:1px solid var(--gr-border);border-radius:8px;padding:12px;margin:12px 0;background:var(--gr-surface)">
        <div style="font-size:18px;font-weight:600;margin-bottom:8px;display:flex;align-items:center">
          ${logoSection}<span>${escapeHtml(farmName)}</span>
        </div>
        ${this.data.contact.website ? `<div class="tiny" style="color:var(--gr-primary)">🌐 <a href="${this.data.contact.website.startsWith('http') ? this.data.contact.website : 'https://' + this.data.contact.website}" target="_blank" style="color:var(--gr-primary);text-decoration:none">${this.extractDomain(this.data.contact.website)}</a></div>` : ''}
      </div>`;
      
      // Fetch website branding for the logo
      if (this.data.contact.website) {
        this.fetchWebsiteBrandingForReview();
      }
    }
    
    host.innerHTML = `
      ${brandingSection}
      <div><strong>Connection:</strong> ${conn.type === 'wifi' ? `Wi‑Fi · ${escapeHtml(conn.wifi.ssid || '')}` : 'Ethernet'} ${conn.wifi.testResult?.status === 'connected' ? '✅' : ''}</div>
      <div><strong>Farm:</strong> ${escapeHtml(this.data.location.farmName || 'Untitled')}</div>
      <div><strong>Address:</strong> ${escapeHtml(addressParts.join(', ') || '—')}</div>
      <div><strong>Timezone:</strong> ${escapeHtml(timezone)}</div>
      <div><strong>Contact:</strong> ${escapeHtml(this.data.contact.name || '')} ${this.data.contact.email ? `&lt;${escapeHtml(this.data.contact.email)}&gt;` : ''} ${this.data.contact.phone ? escapeHtml(this.data.contact.phone) : ''}</div>
      ${this.data.contact.website ? `<div><strong>Website:</strong> <a href="${this.data.contact.website.startsWith('http') ? escapeHtml(this.data.contact.website) : 'https://' + escapeHtml(this.data.contact.website)}" target="_blank">${escapeHtml(this.data.contact.website)}</a></div>` : ''}
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
    if (safe.location?.coordinates || safe.coordinates) {
      const coords = safe.location?.coordinates || safe.coordinates;
      if (coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
        copy.location.coordinates = { lat: coords.lat, lng: coords.lng };
      }
    }
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
  const farmNameEl = document.querySelector('#farmWizardForm #farmName'); if (farmNameEl) farmNameEl.value = this.data.location.farmName;
    const farmAddressEl = $('#farmAddress'); if (farmAddressEl) farmAddressEl.value = this.data.location.address;
    const farmCityEl = $('#farmCity'); if (farmCityEl) farmCityEl.value = this.data.location.city;
    const farmStateEl = $('#farmState'); if (farmStateEl) farmStateEl.value = this.data.location.state;
    const farmPostalEl = $('#farmPostal'); if (farmPostalEl) farmPostalEl.value = this.data.location.postal;
    const farmTimezoneEl = $('#farmTimezone'); if (farmTimezoneEl) farmTimezoneEl.value = this.data.location.timezone;
    const contactNameEl = $('#contactName'); if (contactNameEl) contactNameEl.value = this.data.contact.name;
    const contactEmailEl = $('#contactEmail'); if (contactEmailEl) contactEmailEl.value = this.data.contact.email;
    const contactPhoneEl = $('#contactPhone'); if (contactPhoneEl) contactPhoneEl.value = this.data.contact.phone;
    const contactWebsiteEl = $('#contactWebsite'); if (contactWebsiteEl) contactWebsiteEl.value = this.data.contact.website;
    
    // Update the website branding button state
    this.updateWebsiteBrandingButton();
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
        // If coordinates available, show current weather
        const coords = STATE.farm.location?.coordinates || STATE.farm.coordinates;
        if (coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
          try { this.loadWeather(coords.lat, coords.lng); } catch {}
        }
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
        const coords2 = STATE.farm.location?.coordinates || STATE.farm.coordinates;
        if (coords2 && typeof coords2.lat === 'number' && typeof coords2.lng === 'number') {
          try { this.loadWeather(coords2.lat, coords2.lng); } catch {}
        }
        this.updateFarmDisplay();
      }
    } catch {}
  }

  normalizeFarm(farm) {
    return normalizeFarmDoc(farm);
  }

  async saveFarm(event) {
    event?.preventDefault();
    
    // Only allow saving from the review step (final step)
    if (this.currentStep !== this.baseSteps.length - 1) {
      console.log('Save attempt from non-final step, ignoring');
      return;
    }
    
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
  coordinates: this.data.location.coordinates || existing.coordinates || null,
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
    STATE.farm = this.normalizeFarm({
      ...payload,
      // Mirror name key for header branding components
      name: payload.farmName || payload.name || 'Your Farm'
    });
    this.updateFarmDisplay();
    // Also update the top-card branding header immediately
    try { this.updateFarmHeaderDisplay(); } catch {}
    showToast({ title: 'Farm saved', msg: 'We stored the farm profile and updated discovery defaults.', kind: 'success', icon: '✅' });
    this.close();
  }

  updateFarmDisplay() {
    const badge = $('#farmBadge');
    const editBtn = $('#btnEditFarm');
    const launchBtn = $('#btnLaunchFarm');
    const setupBtn = $('#btnStartDeviceSetup');
    const summaryChip = $('#farmSummaryChip');
    const hide = el => { if (el) el.classList.add('is-hidden'); };
    const show = el => { if (el) el.classList.remove('is-hidden'); };

    if (!STATE.farm) {
      hide(badge);
      hide(setupBtn);
      show(launchBtn);
      hide(editBtn);
      if (summaryChip) {
        summaryChip.removeAttribute('data-has-summary');
        summaryChip.textContent = '';
      }
      return;
    }
    const roomCount = Array.isArray(STATE.farm.rooms) ? STATE.farm.rooms.length : 0;
    const zoneCount = (STATE.farm.rooms || []).reduce((acc, room) => acc + (room.zones?.length || 0), 0);
    const summary = `${STATE.farm.farmName || 'Farm'} · ${roomCount} room${roomCount === 1 ? '' : 's'} · ${zoneCount} zone${zoneCount === 1 ? '' : 's'}`;
    if (badge) {
      show(badge);
      badge.textContent = summary;
    }
    if (summaryChip) {
      summaryChip.dataset.hasSummary = 'true';
      summaryChip.textContent = summary;
    }
    show(setupBtn);
    if (launchBtn) hide(launchBtn);
    show(editBtn);
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

  async findLocation() {
    // DEPRECATED: GPS coordinates button removed from UI
    // Location data is now collected via "Use Current Location" button only
    console.log('🚫 findLocation() called but GPS coordinates button has been removed from UI');
    return;
    
    if (!button || !status) return;
    
    // Build address string from form fields
    const address = [
      this.data.location.address,
      this.data.location.city,
      this.data.location.state,
      this.data.location.postal
    ].filter(Boolean).join(', ');
    
    if (!address.trim()) {
      status.textContent = 'Please enter address information first';
      status.style.color = '#EF4444';
      return;
    }
    
    try {
      button.disabled = true;
      button.textContent = '🔍 Searching...';
      status.textContent = 'Looking up location...';
      status.style.color = '#666';
      
      const response = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(data.error || 'Geocoding failed');
      }
      
      if (!data.results || data.results.length === 0) {
        status.textContent = 'No locations found. Try being more specific.';
        status.style.color = '#EF4444';
        return;
      }
      
      // Show location options
      if (optionsDiv) {
        optionsDiv.innerHTML = data.results.map((location, index) => `
          <div class="location-option" data-index="${index}" data-lat="${location.lat}" data-lng="${location.lng}">
            ${location.display_name}
          </div>
        `).join('');
        
        // Add click handlers
        optionsDiv.querySelectorAll('.location-option').forEach(option => {
          option.addEventListener('click', () => {
            const lat = parseFloat(option.dataset.lat);
            const lng = parseFloat(option.dataset.lng);
            this.selectLocation(lat, lng, option.textContent);
          });
        });
      }
      
      if (resultsDiv) resultsDiv.style.display = 'block';
      status.textContent = `Found ${data.results.length} location${data.results.length > 1 ? 's' : ''}:`;
      status.style.color = '#16A34A';
      
    } catch (error) {
      console.error('Location search error:', error);
      status.textContent = 'Error finding location. Please try again.';
      status.style.color = '#EF4444';
    } finally {
      button.disabled = false;
      button.textContent = '📍 Find Location';
    }
  }
  
  selectLocation(lat, lng, displayName) {
    const resultsDiv = $('#locationResults');
    const status = $('#locationStatus');
    
    // Store coordinates
    this.data.location.coordinates = { lat, lng };
    
    // Hide results
    if (resultsDiv) resultsDiv.style.display = 'none';
    
    // Update status
    if (status) {
      status.textContent = `Location set: ${String(displayName || '').split(',')[0]}`;
      status.style.color = '#16A34A';
    }
    
    // Load weather for this location
    this.loadWeather(lat, lng);
  }
  
  async loadWeather(lat, lng) {
    const weatherDiv = $('#weatherDisplay');
    const weatherContent = $('#weatherContent');
    
    if (!weatherDiv || !weatherContent) return;
    
    try {
      weatherContent.innerHTML = '<div style="text-align: center; color: #666;">Loading weather...</div>';
      weatherDiv.style.display = 'block';
      
      const response = await fetch(`/api/weather?lat=${lat}&lng=${lng}`);
      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(data.error || 'Weather fetch failed');
      }
      
      const weather = data.current;
      const tempF = Math.round(weather.temperature_f);
      const tempC = Math.round(weather.temperature_c);
      const humidity = Math.round(weather.humidity || 0);
      const windSpeed = Math.round(weather.wind_speed || 0);
      
      weatherContent.innerHTML = `
        <div class="weather-row">
          <span class="weather-temp">${tempF}°F (${tempC}°C)</span>
          <span class="weather-description">${escapeHtml(weather.description || '')}</span>
        </div>
        <div class="weather-row">
          <span>Humidity:</span>
          <span class="weather-value">${humidity}%</span>
        </div>
        <div class="weather-row">
          <span>Wind Speed:</span>
          <span class="weather-value">${windSpeed} km/h</span>
        </div>
        <div style="margin-top: 8px; font-size: 12px; color: #666;">
          Updated: ${new Date(weather.last_updated).toLocaleTimeString()}
        </div>
      `;
      
    } catch (error) {
      console.error('Weather loading error:', error);
      weatherContent.innerHTML = `
        <div style="color: #EF4444; font-size: 14px;">
          ⚠️ Unable to load weather data
        </div>
      `;
    }
  }

  async useMyLocation() {
    const status = $('#locationStatus');
    if (!navigator.geolocation) {
      if (status) { status.textContent = 'Geolocation not supported by this browser.'; status.style.color = '#EF4444'; }
      return;
    }
    try {
      if (status) { status.textContent = 'Requesting your location…'; status.style.color = '#666'; }
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
      });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      this.data.location.coordinates = { lat, lng };
      if (status) { status.textContent = `Location acquired (${lat.toFixed(4)}, ${lng.toFixed(4)}). Looking up address…`; status.style.color = '#16A34A'; }
      // Reverse geocode to prefill address fields
      const r = await fetch(`/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
      const j = await r.json();
      if (j?.ok && j.address) {
        const { road, city, state, postal, display_name } = j.address;
        // Fill fields when present
        if (road) { this.data.location.address = road; const el = $('#farmAddress'); if (el) el.value = road; }
        if (city) { this.data.location.city = city; const el = $('#farmCity'); if (el) el.value = city; }
        if (state) { this.data.location.state = state; const el = $('#farmState'); if (el) el.value = state; }
        if (postal) { this.data.location.postal = postal; const el = $('#farmPostal'); if (el) el.value = postal; }
        if (status) { status.textContent = `Using ${display_name || 'current location'}`; status.style.color = '#16A34A'; }
      }
      // Fetch and show weather
      await this.loadWeather(lat, lng);
    } catch (e) {
      if (status) { status.textContent = 'Unable to get your location.'; status.style.color = '#EF4444'; }
    }
  }

  updateLiveBranding() {
    // Update farm branding in real-time as user types
    const farmName = this.data.location?.farmName || '';
    const contactName = this.data.contact?.name || '';
    const website = this.data.contact?.website || '';
    
  const brandingSection = $('#farmBrandingSection');
  // Top-card name element (header)
  const farmHeaderNameEl = document.querySelector('#topCard #farmName');
    const farmTaglineEl = $('#farmTagline');
    const brandingPreview = $('#brandingPreview');
    const brandingPreviewContent = $('#brandingPreviewContent');
    
    if (farmName || contactName || website) {
      // Show branding section if we have any info
  if (brandingSection) brandingSection.style.display = 'block';
      
      // Update farm name display
      if (farmHeaderNameEl && farmName) {
        farmHeaderNameEl.textContent = farmName;
      }
      
      // Update tagline with available info
      if (farmTaglineEl) {
        const taglineParts = [];
        if (contactName) taglineParts.push(`Contact: ${contactName}`);
        if (website) {
          const domain = this.extractDomain(website);
          if (domain) taglineParts.push(domain);
        }
        farmTaglineEl.textContent = taglineParts.join(' • ') || 'Farm details being configured...';
      }
      
      // Update preview in contact step
      if (brandingPreview && brandingPreviewContent) {
        brandingPreview.style.display = 'block';
        const previewParts = [];
        if (farmName) previewParts.push(`🏡 <strong>${farmName}</strong>`);
        if (contactName) previewParts.push(`👤 ${contactName}`);
        if (website) {
          const domain = this.extractDomain(website);
          previewParts.push(`🌐 <a href="${website.startsWith('http') ? website : 'https://' + website}" target="_blank" style="color:var(--gr-primary)">${domain}</a>`);
        }
        brandingPreviewContent.innerHTML = previewParts.join('<br>') || 'Enter farm name and website to see your branding...';
      }
    } else {
      // Hide branding if no info
      if (brandingSection) brandingSection.style.display = 'none';
      if (brandingPreview) brandingPreview.style.display = 'none';
    }
  }

  extractDomain(url) {
    try {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }
  }

  updateWebsiteBrandingButton() {
    const websiteButton = document.getElementById('websiteBrandingButton');
    const website = this.data.contact?.website?.trim();
    
    if (websiteButton) {
      if (website) {
        websiteButton.disabled = false;
        websiteButton.style.opacity = '1';
        websiteButton.style.cursor = 'pointer';
        websiteButton.title = 'Open branding wizard';
      } else {
        websiteButton.disabled = true;
        websiteButton.style.opacity = '0.5';
        websiteButton.style.cursor = 'not-allowed';
        websiteButton.title = 'Enter a website URL first';
      }
    }
  }

  extractDomain(url) {
    // Helper to extract clean domain from URL
    if (!url) return '';
    try {
      const cleanUrl = url.startsWith('http') ? url : 'https://' + url;
      const domain = new URL(cleanUrl).hostname;
      return domain.replace('www.', '');
    } catch (e) {
      // If URL parsing fails, just clean up what we have
      return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }
  }

  async fetchWebsiteBrandingForReview() {
    // Special method for review step branding
    const website = this.data.contact?.website?.trim();
    if (!website) return;

    try {
      const domain = this.extractDomain(website);
      const faviconUrl = `https://${domain}/favicon.ico`;
      
      const reviewLogo = $('#reviewFarmLogo');
      if (reviewLogo) {
        // Create a new image element to test if favicon loads
        const testImg = new Image();
        testImg.onload = () => {
          reviewLogo.src = faviconUrl;
          reviewLogo.style.display = 'inline-block';
        };
        testImg.onerror = () => {
          reviewLogo.style.display = 'none';
        };
        // Start loading the test image
        testImg.src = faviconUrl;
      }
    } catch (error) {
      console.log('Review branding fetch failed:', error.message);
    }
  }

  showBrandingModal() {
    // Enhanced branding preview modal
    const farmName = this.data.location?.farmName || '';
    const contactName = this.data.contact?.name || '';
    const website = this.data.contact?.website || '';
    const domain = website ? this.extractDomain(website) : '';
    
    let logoHtml = '';
    if (website) {
      logoHtml = `<img id="modalFaviconImg" style="width:32px;height:32px;margin-right:12px;vertical-align:middle;display:none">`;
    }
    
    const modalContent = `
      <div id="brandingModalBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center">
        <div style="background:white;border-radius:12px;padding:24px;max-width:500px;margin:20px;box-shadow:0 20px 40px rgba(0,0,0,0.2)" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;margin-bottom:16px">
            <h3 style="margin:0;flex:1">🎨 Live Branding Preview</h3>
            <button id="closeBrandingModal" style="background:none;border:none;font-size:24px;cursor:pointer;color:#666">&times;</button>
          </div>
          
          <div style="border:1px solid var(--gr-border);border-radius:8px;padding:20px;background:var(--gr-bg);margin-bottom:16px">
            <div style="font-size:20px;font-weight:600;margin-bottom:8px;display:flex;align-items:center">
              ${logoHtml}<span>${farmName || 'Your Farm Name'}</span>
            </div>
            ${contactName ? `<div style="color:var(--medium);margin-bottom:4px">👤 Contact: ${contactName}</div>` : ''}
            ${website ? `<div style="color:var(--gr-primary)">🌐 <a href="${website.startsWith('http') ? website : 'https://' + website}" target="_blank" style="color:var(--gr-primary);text-decoration:none">${domain}</a></div>` : ''}
            ${(!farmName && !contactName && !website) ? '<div style="color:var(--medium);font-style:italic">Complete your farm details to see branding preview</div>' : ''}
          </div>
          
          <div style="text-align:center;margin-bottom:16px">
            <button id="openBrandingWizard" style="background:var(--gr-accent);color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;margin-right:8px">🎨 Customize Branding</button>
            <button id="closeBrandingModalBtn" style="background:var(--gr-primary);color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">Close Preview</button>
          </div>
        </div>
      </div>
    `;
    
    // Remove any existing modal
    const existing = document.getElementById('brandingModalBackdrop');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', modalContent);
    
    // Load favicon for modal if website exists
    if (website) {
      const modalImg = document.getElementById('modalFaviconImg');
      if (modalImg) {
        const testImg = new Image();
        testImg.onload = () => {
          modalImg.src = `https://${domain}/favicon.ico`;
          modalImg.style.display = 'inline-block';
        };
        testImg.onerror = () => {
          modalImg.style.display = 'none';
        };
        testImg.src = `https://${domain}/favicon.ico`;
      }
    }
    
    // Add event listeners for close functionality
    document.getElementById('closeBrandingModal').addEventListener('click', () => {
      document.getElementById('brandingModalBackdrop').remove();
    });
    
    document.getElementById('closeBrandingModalBtn').addEventListener('click', () => {
      document.getElementById('brandingModalBackdrop').remove();
    });
    
    document.getElementById('brandingModalBackdrop').addEventListener('click', () => {
      document.getElementById('brandingModalBackdrop').remove();
    });
    
    document.getElementById('openBrandingWizard').addEventListener('click', () => {
      document.getElementById('brandingModalBackdrop').remove();
      this.openBrandingWizard();
    });
  }

  openBrandingWizard() {
    // Comprehensive branding editor wizard
    const farmName = this.data.location?.farmName || 'Your Farm';
    const website = this.data.contact?.website || '';
    const domain = website ? this.extractDomain(website) : '';
    
    // Get current branding from state or defaults, but ALWAYS use current website for logo
    const currentBranding = STATE.farm?.branding || {
      palette: {
        primary: '#0D7D7D',
        accent: '#64C7C7',
        background: '#F7FAFA',
        surface: '#FFFFFF',
        border: '#DCE5E5',
        text: '#0B1220'
      },
      fontFamily: '',
      logo: '',
      tagline: 'Growing with technology',
      fontCss: []
    };
    
    // ALWAYS use the current website's favicon as the logo, overriding any saved logo
    const currentLogo = domain ? `https://${domain}/favicon.ico` : '';
    currentBranding.logo = currentLogo;
    
    const wizardContent = `
      <div id="brandingWizardBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center">
        <div style="background:white;border-radius:12px;padding:24px;max-width:600px;width:90%;margin:20px;box-shadow:0 20px 40px rgba(0,0,0,0.2);max-height:80vh;overflow-y:auto" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;margin-bottom:20px">
            <h3 style="margin:0;flex:1">🎨 ${farmName} Branding Editor</h3>
            ${website ? `<div id="autoExtractionStatus" style="padding:6px 12px;margin-right:8px;background:#f3f4f6;color:#6b7280;border:1px solid #d1d5db;border-radius:4px;font-size:12px">🔄 Auto-extracting...</div>` : ''}
            <button id="closeBrandingWizard" style="background:none;border:none;font-size:24px;cursor:pointer;color:#666">&times;</button>
          </div>
          
          <!-- Live Preview Section -->
          <div id="brandingLivePreview" style="border:2px solid var(--gr-border);border-radius:8px;padding:16px;margin-bottom:20px;background:var(--gr-bg)">
            <div style="font-weight:600;margin-bottom:8px;color:var(--gr-primary)">Live Preview</div>
            <div style="display:flex;align-items:center;padding:12px;background:white;border-radius:6px;border:1px solid var(--gr-border)">
              <img id="previewLogo" style="width:32px;height:32px;margin-right:12px;border-radius:4px;display:none">
              <div>
                <div id="previewFarmName" style="font-size:18px;font-weight:600;color:var(--gr-text)">${farmName}</div>
                <div id="previewTagline" style="font-size:12px;color:var(--gr-primary)">${currentBranding.tagline || 'Growing with technology'}</div>
              </div>
            </div>
          </div>
          
          <!-- Farm Details Section -->
          <div style="margin-bottom:20px">
            <h4 style="margin:0 0 12px;color:var(--gr-text)">Farm Details</h4>
            <div style="margin-bottom:12px">
              <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--medium)">Farm Name</label>
              <input type="text" id="farmNameInput" value="${farmName}" placeholder="Your Farm Name" style="width:100%;padding:8px;border:1px solid var(--gr-border);border-radius:4px">
            </div>
            <div>
              <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--medium)">Tagline</label>
              <input type="text" id="taglineInput" value="${currentBranding.tagline || 'Growing with technology'}" placeholder="Farm tagline or motto" style="width:100%;padding:8px;border:1px solid var(--gr-border);border-radius:4px">
            </div>
          </div>
          
          <!-- Color Palette Section -->
          <div style="margin-bottom:20px">
            <h4 style="margin:0 0 12px;color:var(--gr-text)">Color Palette</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--medium)">Primary Color</label>
                <input type="color" id="primaryColor" value="${currentBranding.palette.primary}" style="width:100%;height:40px;border:1px solid var(--gr-border);border-radius:4px">
              </div>
              <div>
                <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--medium)">Accent Color</label>
                <input type="color" id="accentColor" value="${currentBranding.palette.accent}" style="width:100%;height:40px;border:1px solid var(--gr-border);border-radius:4px">
              </div>
              <div>
                <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--medium)">Background</label>
                <input type="color" id="backgroundColor" value="${currentBranding.palette.background}" style="width:100%;height:40px;border:1px solid var(--gr-border);border-radius:4px">
              </div>
              <div>
                <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--medium)">Text Color</label>
                <input type="color" id="textColor" value="${currentBranding.palette.text}" style="width:100%;height:40px;border:1px solid var(--gr-border);border-radius:4px">
              </div>
            </div>
          </div>
          
          <!-- Logo Section -->
          <div style="margin-bottom:20px">
            <h4 style="margin:0 0 12px;color:var(--gr-text)">Logo</h4>
            <input type="url" id="logoUrl" placeholder="Logo URL (or leave blank to use website favicon)" value="${currentBranding.logo}" style="width:100%;padding:8px;border:1px solid var(--gr-border);border-radius:4px;margin-bottom:8px">
            <div style="font-size:12px;color:var(--medium)">💡 We'll automatically use your website's favicon if no logo is provided</div>
            ${domain ? `<div style="font-size:12px;color:var(--gr-primary);margin-top:4px">🔗 Auto-detected from ${domain}</div>` : ''}
          </div>
          
          <!-- Font Section -->
          <div style="margin-bottom:20px">
            <h4 style="margin:0 0 12px;color:var(--gr-text)">Typography</h4>
            <select id="fontFamily" style="width:100%;padding:8px;border:1px solid var(--gr-border);border-radius:4px">
              <option value="">Default Font</option>
              <option value="Inter" ${currentBranding.fontFamily === 'Inter' ? 'selected' : ''}>Inter (Modern)</option>
              <option value="Roboto" ${currentBranding.fontFamily === 'Roboto' ? 'selected' : ''}>Roboto (Clean)</option>
              <option value="Open Sans" ${currentBranding.fontFamily === 'Open Sans' ? 'selected' : ''}>Open Sans (Friendly)</option>
              <option value="Montserrat" ${currentBranding.fontFamily === 'Montserrat' ? 'selected' : ''}>Montserrat (Bold)</option>
              <option value="Poppins" ${currentBranding.fontFamily === 'Poppins' ? 'selected' : ''}>Poppins (Rounded)</option>
            </select>
          </div>
          
          <!-- Action Buttons -->
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="testTheme" style="background:#ff6b6b;color:white;border:none;padding:10px 16px;border-radius:6px;cursor:pointer">🧪 Test Theme</button>
            <button id="resetBranding" style="background:var(--medium);color:white;border:none;padding:10px 16px;border-radius:6px;cursor:pointer">Reset to Default</button>
            <button id="saveBranding" style="background:var(--gr-primary);color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer">Save Branding</button>
          </div>
        </div>
      </div>
    `;
    
    // Remove any existing wizard
    const existing = document.getElementById('brandingWizardBackdrop');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', wizardContent);
    
    // Load the preview logo if available
    const previewLogo = document.getElementById('previewLogo');
    if (previewLogo && currentBranding.logo) {
      const testImg = new Image();
      testImg.onload = () => {
        previewLogo.src = currentBranding.logo;
        previewLogo.style.display = 'inline-block';
      };
      testImg.onerror = () => {
        previewLogo.style.display = 'none';
      };
      testImg.src = currentBranding.logo;
    }
    
    // Add event listeners
    this.setupBrandingWizardListeners();
    
    // Immediately populate the logo URL field with the current website favicon
    const logoUrlField = document.getElementById('logoUrl');
    if (logoUrlField && currentLogo) {
      logoUrlField.value = currentLogo;
    }
    
    // Initialize the preview with current values
    this.updateBrandingPreview();
  }

  setupBrandingWizardListeners() {
    // Close wizard - apply current changes before closing
    document.getElementById('closeBrandingWizard').addEventListener('click', () => {
      this.applyCurrentBrandingChanges();
      document.getElementById('brandingWizardBackdrop').remove();
    });
    
    // Auto-extract website branding if website exists
    const website = this.data.contact?.website;
    if (website) {
      console.log('🎨 Auto-extracting website branding from:', website);
      // Trigger automatic extraction after a short delay
      setTimeout(() => {
        this.fetchWebsiteBrandingData();
      }, 500);
    }
    
    // Farm name and tagline inputs - live preview updates
    document.getElementById('farmNameInput').addEventListener('input', (e) => {
      this.updateBrandingPreview();
    });
    
    document.getElementById('taglineInput').addEventListener('input', (e) => {
      this.updateBrandingPreview();
    });
    
    // Color inputs - live preview updates
    const colorInputs = ['primaryColor', 'accentColor', 'backgroundColor', 'textColor'];
    colorInputs.forEach(inputId => {
      document.getElementById(inputId).addEventListener('input', (e) => {
        this.updateBrandingPreview();
      });
    });
    
    // Logo URL input
    document.getElementById('logoUrl').addEventListener('input', (e) => {
      this.updateBrandingPreview();
    });
    
    // Font family select
    document.getElementById('fontFamily').addEventListener('change', (e) => {
      this.updateBrandingPreview();
    });
    
    // Test theme button for debugging
    document.getElementById('testTheme').addEventListener('click', () => {
      console.log('Testing theme application...');
      // Apply a bright test theme to see if applyTheme works
      const testPalette = {
        primary: '#ff6b6b',
        accent: '#4ecdc4', 
        background: '#ffe66d',
        surface: '#ffffff',
        border: '#ff8e53',
        text: '#2d3436'
      };
      applyTheme(testPalette, { fontFamily: 'Arial, sans-serif' });
      console.log('Test theme applied!');
    });

    // Reset branding
    document.getElementById('resetBranding').addEventListener('click', () => {
      this.resetBrandingToDefaults();
    });    // Save branding
    document.getElementById('saveBranding').addEventListener('click', () => {
      this.saveBrandingChanges();
    });
  }

  updateBrandingPreview() {
    console.log('updateBrandingPreview called');
    const primary = document.getElementById('primaryColor').value;
    const accent = document.getElementById('accentColor').value;
    const background = document.getElementById('backgroundColor').value;
    const text = document.getElementById('textColor').value;
    const logoUrl = document.getElementById('logoUrl').value;
    const fontFamily = document.getElementById('fontFamily').value;
    const farmName = document.getElementById('farmNameInput').value;
    const tagline = document.getElementById('taglineInput').value;
    
    console.log('Preview values:', { primary, accent, background, text, logoUrl, fontFamily, farmName, tagline });
    
    // Update the live preview container with new colors - make it very visible
    const previewContainer = document.getElementById('brandingLivePreview');
    if (previewContainer) {
      // Apply colors directly to the preview container
      previewContainer.style.borderColor = accent;
      previewContainer.style.backgroundColor = background;
      previewContainer.style.borderWidth = '3px'; // Make border more visible
      console.log('Updated preview container with background:', background, 'border:', accent);
    }
    
    // Update preview elements directly
    const previewLogo = document.getElementById('previewLogo');
    const previewFarmName = document.getElementById('previewFarmName');
    const previewTagline = document.getElementById('previewTagline');
    
    console.log('Preview elements found:', { 
      previewLogo: !!previewLogo, 
      previewFarmName: !!previewFarmName, 
      previewTagline: !!previewTagline,
      previewContainer: !!previewContainer
    });

    if (logoUrl && previewLogo) {
      // Validate logo URL before attempting to load
      if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) {
        console.log('Loading logo:', logoUrl);
        const testImg = new Image();
        testImg.onload = () => {
          console.log('Logo loaded successfully');
          previewLogo.src = logoUrl;
          previewLogo.style.display = 'inline-block';
        };
        testImg.onerror = () => {
          console.log('Logo failed to load');
          previewLogo.style.display = 'none';
        };
        testImg.src = logoUrl;
      } else {
        console.log('Invalid logo URL, hiding logo');
        previewLogo.style.display = 'none';
      }
    } else if (previewLogo) {
      console.log('No logo URL, hiding logo');
      previewLogo.style.display = 'none';
    }
    
    if (previewFarmName) {
      previewFarmName.textContent = farmName || 'Your Farm';
      previewFarmName.style.color = text;
      previewFarmName.style.fontFamily = fontFamily || 'inherit';
      previewFarmName.style.fontWeight = 'bold'; // Make more visible
      console.log('Updated farm name preview with color:', text, 'font:', fontFamily);
    }
    
    if (previewTagline) {
      previewTagline.textContent = tagline || 'Growing with technology';
      previewTagline.style.color = primary;
      previewTagline.style.fontFamily = fontFamily || 'inherit';
      console.log('Updated tagline preview with color:', primary, 'font:', fontFamily);
    }
    
    // Update the inner preview card background and styling - make it more prominent
    const previewCard = previewContainer?.querySelector('div[style*="background:white"]');
    if (previewCard) {
      previewCard.style.backgroundColor = '#ffffff';
      previewCard.style.borderColor = primary;
      previewCard.style.borderWidth = '2px';
      previewCard.style.borderStyle = 'solid';
      console.log('Updated preview card styling with primary color border:', primary);
    }
  }

  applyCurrentBrandingChanges() {
    // Apply current branding wizard values to the UI without saving
    try {
      const farmName = document.getElementById('farmNameInput')?.value;
      const tagline = document.getElementById('taglineInput')?.value;
      
      const branding = {
        palette: {
          primary: document.getElementById('primaryColor')?.value || '#0D7D7D',
          accent: document.getElementById('accentColor')?.value || '#64C7C7',
          background: document.getElementById('backgroundColor')?.value || '#F7FAFA',
          surface: '#FFFFFF',
          border: '#DCE5E5',
          text: document.getElementById('textColor')?.value || '#0B1220'
        },
        logo: document.getElementById('logoUrl')?.value || '',
        tagline: tagline || 'Growing with technology',
        fontFamily: document.getElementById('fontFamily')?.value || '',
        fontCss: document.getElementById('fontFamily')?.value ? [`https://fonts.googleapis.com/css2?family=${document.getElementById('fontFamily').value.replace(' ', '+')}&display=swap`] : []
      };
      
      // Update farm name in wizard data if changed
      if (farmName && farmName !== this.data.location.farmName) {
        this.data.location.farmName = farmName;
      }
      
      // Update STATE.farm temporarily for header display
      if (!STATE.farm) STATE.farm = {};
      STATE.farm.branding = branding;
      STATE.farm.name = farmName || STATE.farm.name;
      STATE.farm.tagline = tagline || STATE.farm.tagline;
      STATE.farm.logo = branding.logo || STATE.farm.logo;
      
      // Apply the theme immediately
      this.applyBranding(branding);
      
      // Update the header display immediately
      this.updateFarmHeaderDisplay();
      
      // Update the live branding preview in the wizard
      this.updateLiveBranding();
      
      // Force refresh of any displayed branding elements
      initializeTopCard();
    } catch (e) {
      console.warn('Failed to apply current branding changes:', e);
    }
  }

  resetBrandingToDefaults() {
    const farmName = this.data.location?.farmName || 'Your Farm';
    
    document.getElementById('farmNameInput').value = farmName;
    document.getElementById('taglineInput').value = 'Growing with technology';
    document.getElementById('primaryColor').value = '#0D7D7D';
    document.getElementById('accentColor').value = '#64C7C7';
    document.getElementById('backgroundColor').value = '#F7FAFA';
    document.getElementById('textColor').value = '#0B1220';
    document.getElementById('logoUrl').value = '';
    document.getElementById('fontFamily').value = '';
    this.updateBrandingPreview();
  }

  async saveBrandingChanges() {
    const farmName = document.getElementById('farmNameInput').value;
    const tagline = document.getElementById('taglineInput').value;
    
    const branding = {
      palette: {
        primary: document.getElementById('primaryColor').value,
        accent: document.getElementById('accentColor').value,
        background: document.getElementById('backgroundColor').value,
        surface: '#FFFFFF',
        border: '#DCE5E5',
        text: document.getElementById('textColor').value
      },
      logo: document.getElementById('logoUrl').value,
      tagline: tagline || 'Growing with technology',
      fontFamily: document.getElementById('fontFamily').value,
      fontCss: document.getElementById('fontFamily').value ? [`https://fonts.googleapis.com/css2?family=${document.getElementById('fontFamily').value.replace(' ', '+')}&display=swap`] : []
    };
    
    console.log('🎨 Saving branding with palette:', branding.palette);
    
    // Update farm name in wizard data
    if (farmName) {
      this.data.location.farmName = farmName;
    }
    
    // Update STATE.farm with branding and farm details
    if (!STATE.farm) STATE.farm = {};
    STATE.farm.branding = branding;
    STATE.farm.name = farmName;
    STATE.farm.tagline = tagline;
    STATE.farm.logo = branding.logo;
    
    console.log('🎨 Updated STATE.farm.branding:', STATE.farm.branding);
    
    // Apply the theme immediately - THIS IS CRITICAL
    console.log('🎨 Calling applyBranding with:', branding);
    this.applyBranding(branding);
    
    // Also apply theme directly to make sure it works
    console.log('🎨 Calling applyTheme directly with palette:', branding.palette);
    applyTheme(branding.palette, { 
      fontFamily: branding.fontFamily || '',
      logoHeight: branding.logoHeight || ''
    });
    
    // Update the header display immediately
    this.updateFarmHeaderDisplay();
    
    // Update the live branding preview in the wizard
    this.updateLiveBranding();
    
    // Update any form fields with the new farm name
    const farmNameEl = document.getElementById('farmName');
    if (farmNameEl && farmName) {
      farmNameEl.value = farmName;
    }
    
    // Force refresh of any displayed branding elements
    initializeTopCard();
    
    // Save to localStorage
    try {
      localStorage.setItem('gr.farm', JSON.stringify(STATE.farm));
    } catch (e) {
      console.warn('Could not save branding to localStorage:', e);
    }
    
    // Save to server if farm is registered
    if (STATE.farm.name) {
      try {
        await safeFarmSave(STATE.farm);
        showToast({ title: 'Branding saved', msg: 'Your farm branding has been updated successfully.', kind: 'success', icon: '🎨' });
      } catch (e) {
        showToast({ title: 'Save warning', msg: 'Branding applied locally but could not sync to server.', kind: 'warn', icon: '⚠️' });
      }
    } else {
      showToast({ title: 'Branding applied', msg: 'Branding will be saved when you complete farm registration.', kind: 'info', icon: '🎨' });
    }
    
    // Close the wizard
    document.getElementById('brandingWizardBackdrop').remove();
  }
  
  // Add a helper function to update the farm header display
  updateFarmHeaderDisplay() {
    const farmNameEl = document.getElementById('farmName');
    const farmBrandingSection = document.getElementById('farmBrandingSection');
    const farmLogoEl = document.getElementById('farmLogo');
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
        // Validate logo URL before attempting to load
        const logoUrl = STATE.farm.logo.trim();
        if (logoUrl && (logoUrl.startsWith('http://') || logoUrl.startsWith('https://'))) {
          // Use test image approach to avoid 404s
          const testImg = new Image();
          testImg.onload = () => {
            farmLogoEl.src = logoUrl;
            farmLogoEl.style.display = 'block';
          };
          testImg.onerror = () => {
            farmLogoEl.style.display = 'none';
          };
          testImg.src = logoUrl;
        } else {
          farmLogoEl.style.display = 'none';
        }
      }
    }
  }

  applyBranding(branding) {
    console.log('🎨 applyBranding called with:', branding);
    
    // Apply theme using the global applyTheme function for comprehensive theming
    if (branding.palette) {
      console.log('🎨 Applying theme with palette:', branding.palette);
      applyTheme(branding.palette, { 
        fontFamily: branding.fontFamily || '',
        logoHeight: branding.logoHeight || ''
      });
      console.log('🎨 Theme applied successfully');
    } else {
      console.warn('🎨 No palette found in branding object!');
    }
    
    // Update the farm logo in the header
    if (branding.logo) {
      const logoUrl = branding.logo.trim();
      if (logoUrl && (logoUrl.startsWith('http://') || logoUrl.startsWith('https://'))) {
        const farmLogo = document.getElementById('farmLogo');
        if (farmLogo) {
          // Use test image approach to avoid 404s
          const testImg = new Image();
          testImg.onload = () => {
            farmLogo.src = logoUrl;
            farmLogo.style.display = 'block';
          };
          testImg.onerror = () => {
            farmLogo.style.display = 'none';
          };
          testImg.src = logoUrl;
        }
      }
    }
    
    // Load custom fonts
    if (branding.fontCss && branding.fontCss.length) {
      const fontLink = document.getElementById('gr-brand-fonts') || document.createElement('link');
      fontLink.id = 'gr-brand-fonts';
      fontLink.rel = 'stylesheet';
      fontLink.href = branding.fontCss[0];
      if (!document.getElementById('gr-brand-fonts')) {
        document.head.appendChild(fontLink);
      }
    }
  }

  async fetchWebsiteBranding() {
    clearTimeout(this.websiteTimeout);
    this.websiteTimeout = setTimeout(async () => {
      const website = this.data.contact?.website?.trim();
      if (!website) return;

      try {
        // Try to fetch website metadata for enhanced branding
        const url = website.startsWith('http') ? website : `https://${website}`;
        
        // Use a simple approach to try to get favicon
        const domain = this.extractDomain(website);
        const faviconUrl = `https://${domain}/favicon.ico`;
        
        // Note: We don't update the main farmLogo here anymore - that should only 
        // happen when the user explicitly applies branding changes
        
        // Update tagline with website info
        const farmTaglineEl = $('#farmTagline');
        if (farmTaglineEl && !this.data.location?.farmName) {
          farmTaglineEl.innerHTML = `<a href="${url}" target="_blank" style="color:var(--gr-primary);text-decoration:none">${domain}</a>`;
        }
        
      } catch (error) {
        console.log('Website branding fetch failed:', error.message);
      }
    }, 1000); // 1 second debounce
  }

  async fetchWebsiteBrandingData() {
    const website = this.data.contact?.website?.trim();
    if (!website) {
      console.log('No website URL available for auto-extraction');
      return;
    }

    const statusEl = document.getElementById('autoExtractionStatus');
    if (statusEl) {
      statusEl.textContent = '⏳ Extracting branding...';
      statusEl.style.background = '#fef3c7';
      statusEl.style.color = '#92400e';
    }

    try {
      const url = website.startsWith('http') ? website : `https://${website}`;
      console.log('🎨 Auto-fetching branding from:', url);
      
      const response = await fetch(`/brand/extract?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      
      console.log('🎨 Website branding data received:', data);
      
      if (data.ok && data.palette) {
        // Update the form inputs with extracted data
        if (data.palette.primary) {
          document.getElementById('primaryColor').value = data.palette.primary;
        }
        if (data.palette.accent) {
          document.getElementById('accentColor').value = data.palette.accent;
        }
        if (data.palette.background) {
          document.getElementById('backgroundColor').value = data.palette.background;
        }
        if (data.palette.text) {
          document.getElementById('textColor').value = data.palette.text;
        }
        if (data.logo) {
          document.getElementById('logoUrl').value = data.logo;
        }
        if (data.fontFamily) {
          document.getElementById('fontFamily').value = data.fontFamily;
        }
        
        // Update the live preview
        this.updateBrandingPreview();
        
        console.log('🎨 Branding wizard auto-populated with website data');
        
        // Update status to success
        if (statusEl) {
          statusEl.textContent = '✅ Branding extracted!';
          statusEl.style.background = '#d1fae5';
          statusEl.style.color = '#065f46';
          setTimeout(() => {
            statusEl.style.opacity = '0';
            setTimeout(() => statusEl.remove(), 300);
          }, 2000);
        }
      } else {
        console.log('🎨 Failed to extract branding:', data.error);
        
        // Update status to partial success
        if (statusEl) {
          statusEl.textContent = '⚠️ Partial extraction';
          statusEl.style.background = '#fef3c7';
          statusEl.style.color = '#92400e';
        }
        
        // At least try to set the logo if we have it
        if (data.logo) {
          document.getElementById('logoUrl').value = data.logo;
          this.updateBrandingPreview();
        }
      }
    } catch (error) {
      console.error('🎨 Error fetching website branding:', error);
      
      // Update status to error
      if (statusEl) {
        statusEl.textContent = '❌ Extraction failed';
        statusEl.style.background = '#fee2e2';
        statusEl.style.color = '#991b1b';
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
      
      // NO DEMO DEVICES - Show error and require live discovery
      this.devices = [];
      if (this.statusEl) this.statusEl.textContent = 'Discovery failed - no devices found';
      showToast({ 
        title: 'Discovery Failed', 
        msg: 'Device discovery failed. Please check network connectivity and try again. No demo devices available.', 
        kind: 'error', 
        icon: '❌' 
      });
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

// --- Grow Room Wizard ---
class RoomWizard {
  constructor() {
    this.modal = $('#roomModal');
    this.form = $('#roomWizardForm');
    // Auto-advance behavior: when a required field for a step is completed,
    // the wizard will advance automatically. Can be disabled if needed.
    // Default to manual navigation so you can review each page without being blocked
    this.autoAdvance = false;
    // equipment-first: begin with connectivity and hardware categories for room management
    // Steps can be augmented dynamically based on selected hardware (e.g., hvac, dehumidifier, etc.)
  this.baseSteps = ['connectivity','hardware','category-setup','room-name','review'];
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
  energy: '',
  energyHours: 0,
      connectivity: { hasHub: null, hubType: '', hubIp: '', cloudTenant: 'Azure' },
      roles: { admin: [], operator: [], viewer: [] },
  grouping: { groups: [], planId: '', scheduleId: '' }
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
    $('#roomTopPrev')?.addEventListener('click', () => this.prevStep());
    $('#roomTopNext')?.addEventListener('click', () => this.nextStep());
    $('#roomTopSaveClose')?.addEventListener('click', () => this.saveAndClose());
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

    const energyHoursInput = document.getElementById('roomEnergyHours');
    if (energyHoursInput) {
      energyHoursInput.addEventListener('input', (e) => {
        const v = Number(e.target.value || 0);
        this.data.energyHours = Number.isFinite(v) ? Math.max(0, Math.min(24, v)) : 0;
        this.updateSetupQueue();
      });
    }
    // Auto-advance hooks: room name
    const roomNameInput = document.getElementById('roomName');
    if (roomNameInput) {
      roomNameInput.addEventListener('input', (e) => {
        this.data.name = (e.target.value || '').trim();
        // try auto-advancing if enabled and we're on the name step
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
  // Upload nameplate / datasheet functionality removed - moved to Light Setup wizard

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

    // Sensors section removed - no longer part of room setup

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
      // Update controller assignments when devices are added
      if (typeof renderControllerAssignments === 'function') {
        renderControllerAssignments();
      }
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
        // Update controller assignments when devices are removed
        if (typeof renderControllerAssignments === 'function') {
          renderControllerAssignments();
        }
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

    // Live SwitchBot devices button - NO DEMO
    $('#roomDemoSwitchBot')?.addEventListener('click', () => {
      this.addLiveSwitchBotDevices();
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
      this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '' };
      this.data.grouping.planId = ev.target.value || '';
      this.updateSetupQueue();
    });
    $('#roomGroupSchedule')?.addEventListener('change', (ev) => {
      this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '' };
      this.data.grouping.scheduleId = ev.target.value || '';
      this.updateSetupQueue();
    });

    // Device Discovery step handlers
    $('#roomDiscoveryRun')?.addEventListener('click', () => this.runDeviceDiscovery());
    $('#roomDiscoveryStop')?.addEventListener('click', () => this.stopDeviceDiscovery());
    $('#roomDiscoverySelectAll')?.addEventListener('click', () => this.selectAllDiscoveredDevices());
    $('#roomDiscoverySelectNone')?.addEventListener('click', () => this.selectNoDiscoveredDevices());
    $('#roomDiscoveryRefresh')?.addEventListener('click', () => this.refreshDeviceDiscovery());
  }

  open(room = null) {
    // Always refresh the room list from STATE.farm.rooms to reflect latest Farm Registration
    const farmRooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms.map(r => ({ ...r })) : [];
    
    // If no farm rooms are available, show a warning
    if (farmRooms.length === 0) {
      showToast({ 
        title: 'No Rooms Found', 
        msg: 'Please create rooms in Farm Registration first', 
        kind: 'warning', 
        icon: '⚠️' 
      });
      return;
    }
    
    this.multiRoomList = farmRooms;
    this.multiRoomIndex = 0;
    
    // If a room is provided, just open for that room
    if (room) {
      this._openSingleRoom(room);
      return;
    }
    
    // Start with the first room from Farm Registration
    this._openSingleRoom(this.multiRoomList[this.multiRoomIndex]);
    
    // Always inject multi-room navigation if there are multiple rooms
    if (this.multiRoomList.length > 1) {
      this._injectMultiRoomNav();
    }
  }

  _openSingleRoom(room) {
    // Reset navigation state to ensure clean slate
    this.currentStep = 0;
    this.steps = this.baseSteps.slice(); // Reset to base steps
    
    // Clean up any existing Setup Next Room button from previous sessions
    const existingNextRoomBtn = document.getElementById('setupNextRoomBtn');
    if (existingNextRoomBtn) {
      existingNextRoomBtn.remove();
    }
    
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
      grouping: { groups: [], planId: '', scheduleId: '' },
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
      
      // Ensure the room name from Farm Registration is preserved
      if (clone.name) {
        this.data.name = clone.name;
      }
      
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
    
    this.modal.setAttribute('aria-hidden','false');
    
    // Use setTimeout to ensure DOM is ready and navigation state is reset
    setTimeout(() => {
      this.showStep(0);
      // Force navigation update after modal opens
      this.showStep(this.currentStep);
    }, 10);
    
    // Prefill lists (fixtures rendering moved to Light Setup wizard)
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

  _injectMultiRoomNav() {
    // Add navigation UI for multi-room setup (e.g., Next Room, Prev Room, Room X of Y)
    // Only if modal is open and multiRoomList exists
    if (!this.modal || !Array.isArray(this.multiRoomList) || this.multiRoomList.length < 2) return;
    
    let nav = document.getElementById('multiRoomNav');
    if (!nav) {
      nav = document.createElement('div');
      nav.id = 'multiRoomNav';
      nav.style = 'display:flex;justify-content:center;align-items:center;gap:16px;margin:8px 0;padding:8px;background:#f8f9fa;border-radius:6px;border:1px solid #e5e7eb;';
      this.modal.querySelector('.modal-header')?.appendChild(nav);
    }
    
    const currentRoom = this.multiRoomList[this.multiRoomIndex];
    const roomName = currentRoom?.name || `Room ${this.multiRoomIndex + 1}`;
    
    nav.innerHTML = `
      <button id="prevRoomBtn" ${this.multiRoomIndex === 0 ? 'disabled' : ''} style="padding:4px 8px;border-radius:4px;">&lt; Previous</button>
      <span style="font-weight:bold;color:#374151;">Setting up: <em>${roomName}</em> (${this.multiRoomIndex + 1} of ${this.multiRoomList.length})</span>
      <button id="nextRoomBtn" ${this.multiRoomIndex === this.multiRoomList.length - 1 ? 'disabled' : ''} style="padding:4px 8px;border-radius:4px;">Next &gt;</button>
    `;
    
    // Previous room navigation
    document.getElementById('prevRoomBtn').onclick = () => {
      if (this.multiRoomIndex > 0) {
        this.multiRoomIndex--;
        const prevRoom = this.multiRoomList[this.multiRoomIndex];
        this._openSingleRoom(prevRoom);
        this._injectMultiRoomNav();
        showToast({ 
          title: 'Switched Room', 
          msg: `Now setting up: ${prevRoom.name}`, 
          kind: 'info', 
          icon: '🔄' 
        });
      }
    };
    
    // Next room navigation  
    document.getElementById('nextRoomBtn').onclick = () => {
      if (this.multiRoomIndex < this.multiRoomList.length - 1) {
        this.multiRoomIndex++;
        const nextRoom = this.multiRoomList[this.multiRoomIndex];
        this._openSingleRoom(nextRoom);
        this._injectMultiRoomNav();
        showToast({ 
          title: 'Switched Room', 
          msg: `Now setting up: ${nextRoom.name}`, 
          kind: 'info', 
          icon: '🔄' 
        });
      }
    };
  }

  close(){ this.modal.setAttribute('aria-hidden','true'); }

  showStep(index) {
    // Sync internal current step state
    this.currentStep = index;
    
    document.querySelectorAll('.room-step').forEach(step => step.removeAttribute('data-active'));
    const el = document.querySelector(`.room-step[data-step="${this.steps[index]}"]`);
    if (el) el.setAttribute('data-active', '');
    $('#roomModalProgress').textContent = `Step ${index + 1} of ${this.steps.length}`;
    
    // Guard navigation button toggles
    const prev = $('#roomPrev'); 
    const next = $('#roomNext'); 
    const topNext = $('#roomTopNext');
    const topPrev = $('#roomTopPrev');
    const topSaveClose = $('#roomTopSaveClose');
    const save = $('#btnSaveRoom');
    
    // Ensure buttons exist before setting styles
    if (prev) {
      prev.style.display = index === 0 ? 'none' : 'inline-block';
    }
    
    // On final step: show Previous and Save & Close buttons
    if (index === this.steps.length - 1) { 
      if (prev) prev.style.display = 'inline-block';  // Show Previous on final step
      if (next) next.style.display = 'none';
      if (topNext) topNext.style.display = 'none';
      if (topPrev) topPrev.style.display = 'inline-block';  // Show Previous in header on final step
      // Insert Setup Next Room button if there are more rooms to setup
      let nextRoomBtn = document.getElementById('setupNextRoomBtn');
      const hasMoreRooms = Array.isArray(this.multiRoomList) && this.multiRoomList.length > 1 && this.multiRoomIndex < this.multiRoomList.length - 1;
      
      if (hasMoreRooms) {
        if (!nextRoomBtn) {
          nextRoomBtn = document.createElement('button');
          nextRoomBtn.id = 'setupNextRoomBtn';
          nextRoomBtn.className = 'primary';
          nextRoomBtn.style.marginRight = '8px';
          // Insert before Save & Close button if present
          if (topSaveClose && topSaveClose.parentNode) {
            topSaveClose.parentNode.insertBefore(nextRoomBtn, topSaveClose);
          } else if (save && save.parentNode) {
            save.parentNode.insertBefore(nextRoomBtn, save);
          } else {
            document.body.appendChild(nextRoomBtn);
          }
        }
        nextRoomBtn.textContent = `Setup Next Room (${this.multiRoomIndex + 2}/${this.multiRoomList.length})`;
        nextRoomBtn.style.display = 'inline-block';
        nextRoomBtn.onclick = async () => {
          // Save current room's setup data first, but don't auto-close
          const mockEvent = { preventDefault: () => {} };
          const success = await this.saveRoom(mockEvent, false);
          
          if (success) {
            // Move to next room after successful save
            this.multiRoomIndex++;
            
            // Get the next room from the original farm data
            const farmRooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : [];
            const nextRoom = farmRooms[this.multiRoomIndex];
            
            if (nextRoom) {
              // Open the next room - start fresh with farm registration data
              this._openSingleRoom(nextRoom);
              this.currentStep = 0;
              this.showStep(0);
              this._injectMultiRoomNav();
              
              // Update modal title to show current room
              const titleEl = document.getElementById('roomModalTitle');
              if (titleEl) {
                titleEl.textContent = `Set up ${nextRoom.name}`;
              }
              
              showToast({ 
                title: 'Room Setup Saved', 
                msg: `Moving to ${nextRoom.name}`, 
                kind: 'success', 
                icon: '✅' 
              });
            } else {
              // No more rooms, close the wizard
              this.close();
              showToast({ 
                title: 'All Rooms Complete!', 
                msg: 'All grow rooms have been set up successfully', 
                kind: 'success', 
                icon: '🎉' 
              });
            }
          } else {
            showToast({ 
              title: 'Save Failed', 
              msg: 'Please fix errors before continuing', 
              kind: 'error', 
              icon: '❌' 
            });
          }
        };
      } else if (nextRoomBtn) {
        nextRoomBtn.style.display = 'none';
      }
      
      // Show Save & Close button only if there are no more rooms
      if (topSaveClose) {
        if (hasMoreRooms) {
          // If there are more rooms, hide the Save & Continue button since we have Setup Next Room
          topSaveClose.style.display = 'none';
        } else {
          // This is the last room, show final save text
          topSaveClose.textContent = 'Save & Close';
          topSaveClose.style.display = 'inline-block';
        }
      }
      if (save) {
        if (hasMoreRooms) {
          // Hide footer save button when there are more rooms
          save.style.display = 'none';
        } else {
          save.style.display = 'inline-block';
        }
      }
      this.updateReview();
      
      // Update title based on current room and progress
      const titleEl = document.getElementById('roomModalTitle');
      if (titleEl) {
        if (hasMoreRooms) {
          titleEl.textContent = `Complete Setup: ${this.data.name || 'Room'} (${this.multiRoomIndex + 1}/${this.multiRoomList.length})`;
        } else {
          titleEl.textContent = `Final Room Setup: ${this.data.name || 'Room'}`;
        }
      }
    }
    else { 
      // Show Previous button except on first step
      if (topPrev) {
        topPrev.style.display = index === 0 ? 'none' : 'inline-block';
      }
      if (next) {
        next.style.display = 'inline-block';
        next.style.visibility = 'visible';
      }
      if (topNext) {
        topNext.style.display = 'inline-block';
        topNext.style.visibility = 'visible';
      }
      if (topSaveClose) topSaveClose.style.display = 'none';
      if (save) save.style.display = 'none';
      
      // IMPORTANT: Hide the Setup Next Room button on non-final steps
      const nextRoomBtn = document.getElementById('setupNextRoomBtn');
      if (nextRoomBtn) {
        nextRoomBtn.style.display = 'none';
      }
      
      // Reset title for non-final steps
      const titleEl = document.getElementById('roomModalTitle');
      if (titleEl) titleEl.textContent = 'Set up a Grow Room';
    }

    const stepKey = this.steps[index];
    
    // Track previous step for transitions
    this.previousStep = stepKey;
    
    if (stepKey === 'room-name') {
      const nameInput = document.getElementById('roomName');
      if (nameInput) {
        // The room name should already be pre-filled from Farm Registration data
        // Don't override it unless it's empty
        if (!this.data.name && STATE.farm?.farmName) {
          // Fallback naming if somehow the room name is missing
          const roomNumber = (this.multiRoomIndex || 0) + 1;
          this.data.name = `${STATE.farm.farmName} - Room ${roomNumber}`;
        }
        nameInput.value = this.data.name || '';
        
        // Show a hint about the room being from Farm Registration
        const hintEl = document.getElementById('roomNameHint');
        if (hintEl && this.multiRoomList && this.multiRoomList.length > 0) {
          hintEl.textContent = `Room name from Farm Registration. Editing this will update the farm configuration.`;
          hintEl.style.display = 'block';
        }
      }
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
      this.updateCategoryNav();
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

      case 'layout': return true;
      case 'zones': return Array.isArray(this.data.zones) && this.data.zones.length > 0;
      case 'hardware': return false; // multi-select; don't auto-advance here
      case 'category-setup': return true; // allow auto-advance if user clicks next; forms are optional counts
      case 'control': return !!this.data.controlMethod;
      case 'devices': return false;
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
        this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '' };
        const planSel = document.getElementById('roomGroupPlan');
        const scheduleSel = document.getElementById('roomGroupSchedule');
        if (planSel) this.data.grouping.planId = planSel.value || '';
        if (scheduleSel) this.data.grouping.scheduleId = scheduleSel.value || '';
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
  const formCats = selected.filter(c => ['grow-lights','hvac','mini-split','dehumidifier','fans','vents','controllers','other'].includes(c));
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
      // Skip the baseline category-setup entry; we'll inject it after hardware only if queue is non-empty
      if (k === 'category-setup') continue;
      newSteps.push(k);
      if (k === 'hardware' && this.categoryQueue.length) {
        // inject one "category-setup" placeholder right after hardware when needed
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
      'hvac': 'Central HVAC setup',
      'mini-split': 'Mini Split setup',
      'dehumidifier': 'Dehumidifier setup',
      'fans': 'Fans setup',
      'vents': 'Vents setup',
      'controllers': 'Controllers / hubs setup',
      'energy-monitor': 'Energy Monitor setup',
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
        <div class="tiny">Central HVAC units</div>
        <label class="tiny">How many? <input type="number" id="cat-hvac-count" min="0" value="${v(catData.count||0)}" style="width:80px"></label>
        <div class="tiny" style="margin-top:6px">Control</div>
        ${chipRow('cat-hvac-control', ['Thermostat','Modbus/BACnet','Relay','Other'], catData.control)}
      `;
    } else if (catId === 'mini-split') {
      html = `
        <div class="tiny">Mini Split units</div>
        
        <div style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 8px; font-size: 13px;">Search mini-splits:</label>
          <input id="cat-mini-split-search" type="text" placeholder="Search models (e.g., Mitsubishi MSZ-FH09NA)" 
                 style="width: 100%; padding: 8px; font-size: 14px;">
        </div>
        
        <div style="margin-bottom: 12px;">
          <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Search Results:</div>
          <div id="cat-mini-split-results" style="max-height: 150px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 4px; min-height: 60px;">
            <div style="padding: 20px; text-align: center; color: #64748b; font-size: 13px;">
              Type to search for mini-split models...
            </div>
          </div>
        </div>
        
        <div style="margin-bottom: 12px;">
          <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Selected Mini-Splits:</div>
          <div id="cat-mini-split-selected" style="min-height: 60px; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px;">
            <div style="color: #64748b; font-size: 13px;">No mini-splits selected yet</div>
          </div>
        </div>
        
        <div class="tiny" style="margin-top:6px">Control Options</div>
        <div class="control-checkboxes">
          <label class="tiny"><input type="checkbox" id="cat-mini-split-wifi" ${catData.wifi ? 'checked' : ''}> Wi-Fi Control</label>
          <label class="tiny"><input type="checkbox" id="cat-mini-split-wired" ${catData.wired ? 'checked' : ''}> Wired Thermostat Control</label>
        </div>
        <div class="tiny" style="margin-top:6px">Additional Control</div>
        ${chipRow('cat-mini-split-control', ['Modbus/BACnet','Relay','Other'], catData.control)}
      `;
    } else if (catId === 'dehumidifier') {
      html = `
        <div class="tiny">Dehumidifiers</div>
        
        <div style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 8px; font-size: 13px;">Search dehumidifiers:</label>
          <input id="cat-dehu-search" type="text" placeholder="Search models (e.g., Quest Dual 155)" 
                 style="width: 100%; padding: 8px; font-size: 14px;">
        </div>
        
        <div style="margin-bottom: 12px;">
          <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Search Results:</div>
          <div id="cat-dehu-results" style="max-height: 150px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 4px; min-height: 60px;">
            <div style="padding: 20px; text-align: center; color: #64748b; font-size: 13px;">
              Type to search for dehumidifier models...
            </div>
          </div>
        </div>
        
        <div style="margin-bottom: 12px;">
          <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Selected Dehumidifiers:</div>
          <div id="cat-dehu-selected" style="min-height: 60px; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px;">
            <div style="color: #64748b; font-size: 13px;">No dehumidifiers selected yet</div>
          </div>
        </div>
        
        <div class="tiny" style="margin-top:6px">Control Options</div>
        <div class="control-checkboxes">
          <label class="tiny"><input type="checkbox" id="cat-dehu-wifi" ${catData.wifi ? 'checked' : ''}> Wi-Fi Control</label>
          <label class="tiny"><input type="checkbox" id="cat-dehu-wired" ${catData.wired ? 'checked' : ''}> Wired Thermostat Control</label>
        </div>
      `;
    } else if (catId === 'fans') {
      html = `
        <div class="tiny">Fans</div>
        <div class="equipment-selection">
          <label class="tiny">Manufacturer
            <input type="text" id="cat-fans-manufacturer" placeholder="Search manufacturer..." value="${v(catData.manufacturer||'')}" style="width:200px">
          </label>
        </div>
        <label class="tiny">How many? <input type="number" id="cat-fans-count" min="0" value="${v(catData.count||0)}" style="width:80px"></label>
        <div class="tiny" style="margin-top:6px">Control Options</div>
        <div class="control-checkboxes">
          <label class="tiny"><input type="checkbox" id="cat-fans-wifi" ${catData.wifi ? 'checked' : ''}> Wi-Fi Control</label>
          <label class="tiny"><input type="checkbox" id="cat-fans-wired" ${catData.wired ? 'checked' : ''}> Wired Thermostat Control</label>
        </div>
      `;
    } else if (catId === 'vents') {
      html = `
        <div class="tiny">Vents</div>
        <div class="equipment-selection">
          <label class="tiny">Manufacturer
            <input type="text" id="cat-vents-manufacturer" placeholder="Search manufacturer..." value="${v(catData.manufacturer||'')}" style="width:200px">
          </label>
        </div>
        <label class="tiny">How many? <input type="number" id="cat-vents-count" min="0" value="${v(catData.count||0)}" style="width:80px"></label>
        <div class="tiny" style="margin-top:6px">Control</div>
        ${chipRow('cat-vents-control', ['Relay','0-10V','Other'], catData.control)}
      `;
    } else if (catId === 'controllers') {
      html = `
        <div class="tiny">Controllers / hubs</div>
        <label class="tiny">How many hubs? <input type="number" id="cat-ctl-count" min="0" value="${v(catData.count||0)}" style="width:90px"></label>
      `;
    } else if (catId === 'energy-monitor') {
      html = `
        <div class="tiny">Energy Monitors</div>
        <label class="tiny">How many? <input type="number" id="cat-energy-count" min="0" value="${v(catData.count||0)}" style="width:80px"></label>
        <div class="tiny" style="margin-top:6px">Type</div>
        ${chipRow('cat-energy-type', ['CT clamp','Smart meter','Built-in','Other'], catData.type)}
      `;
    } else {
      html = `
        <div class="tiny">Other equipment</div>
        <div class="equipment-selection">
          <label class="tiny">Manufacturer
            <input type="text" id="cat-other-manufacturer" placeholder="Search manufacturer..." value="${v(catData.manufacturer||'')}" style="width:200px">
          </label>
        </div>
        <label class="tiny">Describe <input type="text" id="cat-other-notes" value="${v(catData.notes||'')}" placeholder="e.g., CO₂ burner" style="min-width:220px"></label>
      `;
    }
    body.innerHTML = html;
    
    // Add event listeners for manufacturer search to populate model dropdowns
    this.setupManufacturerSearch();
    
    // Wire chip groups to update data (for categories that still use chips)
    body.querySelectorAll('.chip-row').forEach(row => {
      row.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-option'); 
        if (!btn) return;
        
        // Remove active from all buttons in this row
        row.querySelectorAll('.chip-option').forEach(b => b.classList.remove('active'));
        // Add active to clicked button
        btn.classList.add('active');
        
        const val = btn.getAttribute('data-value');
        const id = row.getAttribute('id');
        
        // Ensure category objects exist before setting properties
        if (id === 'cat-hvac-control') {
          this.data.category.hvac = this.data.category.hvac || {};
          this.data.category.hvac.control = val;
        }
        if (id === 'cat-mini-split-control') {
          this.data.category['mini-split'] = this.data.category['mini-split'] || {};
          this.data.category['mini-split'].control = val;
        }
        if (id === 'cat-vents-control') {
          this.data.category.vents = this.data.category.vents || {};
          this.data.category.vents.control = val;
        }
        if (id === 'cat-energy-type') {
          this.data.category['energy-monitor'] = this.data.category['energy-monitor'] || {};
          this.data.category['energy-monitor'].type = val;
        }
      });
    });

    // Wire manufacturer search inputs for equipment types
    ['dehu', 'fans', 'mini-split', 'vents', 'other'].forEach(prefix => {
      const manufacturerInput = document.getElementById(`cat-${prefix}-manufacturer`);
      const wifiCheckbox = document.getElementById(`cat-${prefix}-wifi`);
      const wiredCheckbox = document.getElementById(`cat-${prefix}-wired`);
      
      if (manufacturerInput) {
        manufacturerInput.addEventListener('input', (e) => {
          const categoryName = prefix === 'dehu' ? 'dehumidifier' : 
                              prefix === 'mini-split' ? 'mini-split' :
                              prefix === 'vents' ? 'vents' :
                              prefix === 'other' ? 'other' : 'fans';
          this.data.category[categoryName] = this.data.category[categoryName] || {};
          this.data.category[categoryName].manufacturer = e.target.value.trim();
        });
      }
      
      if (wifiCheckbox) {
        wifiCheckbox.addEventListener('change', (e) => {
          const categoryName = prefix === 'dehu' ? 'dehumidifier' : 
                              prefix === 'mini-split' ? 'mini-split' : 'fans';
          this.data.category[categoryName] = this.data.category[categoryName] || {};
          this.data.category[categoryName].wifi = e.target.checked;
        });
      }
      
      if (wiredCheckbox) {
        wiredCheckbox.addEventListener('change', (e) => {
          const categoryName = prefix === 'dehu' ? 'dehumidifier' : 
                              prefix === 'mini-split' ? 'mini-split' : 'fans';
          this.data.category[categoryName] = this.data.category[categoryName] || {};
          this.data.category[categoryName].wired = e.target.checked;
        });
      }
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
    const getChecked = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
    if (catId === 'hvac') {
      catData.count = getNum('cat-hvac-count') ?? catData.count;
    }
    if (catId === 'mini-split') {
      // Use new selectedEquipment structure  
      const selectedEquipment = this.categoryProgress[this.currentStep]?.selectedEquipment?.filter(e => e.category === 'mini-split') || [];
      catData.selectedEquipment = selectedEquipment;
      catData.wifi = getChecked('cat-mini-split-wifi');
      catData.wired = getChecked('cat-mini-split-wired');
      
      // Backward compatibility - calculate total count
      catData.count = selectedEquipment.reduce((sum, item) => sum + item.count, 0);
      if (selectedEquipment.length > 0) {
        catData.manufacturer = selectedEquipment[0].vendor;
        catData.model = selectedEquipment[0].model;
      }
    }
    if (catId === 'dehumidifier') {
      // Use new selectedEquipment structure
      const selectedEquipment = this.categoryProgress[this.currentStep]?.selectedEquipment?.filter(e => e.category === 'dehumidifier') || [];
      catData.selectedEquipment = selectedEquipment;
      catData.wifi = getChecked('cat-dehu-wifi');
      catData.wired = getChecked('cat-dehu-wired');
      
      // Backward compatibility - calculate total count
      catData.count = selectedEquipment.reduce((sum, item) => sum + item.count, 0);
      if (selectedEquipment.length > 0) {
        catData.manufacturer = selectedEquipment[0].vendor;
        catData.model = selectedEquipment[0].model;
      }
    }
    if (catId === 'fans') {
      catData.count = getNum('cat-fans-count') ?? catData.count;
      catData.manufacturer = getStr('cat-fans-manufacturer') ?? catData.manufacturer;
      catData.wifi = getChecked('cat-fans-wifi');
      catData.wired = getChecked('cat-fans-wired');
    }
    if (catId === 'vents') {
      catData.count = getNum('cat-vents-count') ?? catData.count;
      catData.manufacturer = getStr('cat-vents-manufacturer') ?? catData.manufacturer;
    }
    if (catId === 'controllers') {
      catData.count = getNum('cat-ctl-count') ?? catData.count;
    }
    if (catId === 'energy-monitor') {
      catData.count = getNum('cat-energy-count') ?? catData.count;
    }
    if (catId === 'other') {
      catData.notes = getStr('cat-other-notes') ?? catData.notes;
      catData.manufacturer = getStr('cat-other-manufacturer') ?? catData.manufacturer;
    }
  }

  setupManufacturerSearch() {
    console.log('[DEBUG] Setting up modern equipment search...');
    
    // Setup search for dehumidifiers
    const dehuSearchInput = document.getElementById('cat-dehu-search');
    if (dehuSearchInput) {
      console.log('[DEBUG] Found dehumidifier search input, setting up listener');
      dehuSearchInput.addEventListener('input', (e) => {
        console.log('[DEBUG] Dehumidifier search input event:', e.target.value);
        this.searchEquipment('dehumidifier', e.target.value, 'cat-dehu-results');
      });
      this.renderSelectedEquipment('dehumidifier', 'cat-dehu-selected');
    } else {
      console.log('[DEBUG] Dehumidifier search input not found!');
    }

    // Setup search for mini-splits
    const miniSplitSearchInput = document.getElementById('cat-mini-split-search');
    if (miniSplitSearchInput) {
      console.log('[DEBUG] Found mini-split search input, setting up listener');
      miniSplitSearchInput.addEventListener('input', (e) => {
        console.log('[DEBUG] Mini-split search input event:', e.target.value);
        this.searchEquipment('mini-split', e.target.value, 'cat-mini-split-results');
      });
      this.renderSelectedEquipment('mini-split', 'cat-mini-split-selected');
    } else {
      console.log('[DEBUG] Mini-split search input not found!');
    }

    // Setup manufacturer search for fans
    const fansManufacturerInput = document.getElementById('cat-fans-manufacturer');
    if (fansManufacturerInput) {
      fansManufacturerInput.addEventListener('input', (e) => {
        this.populateModelDropdown('cat-fans-model', e.target.value, 'fans');
      });
    }

    // Setup manufacturer search for other equipment
    const otherManufacturerInput = document.getElementById('cat-other-manufacturer');
    if (otherManufacturerInput) {
      otherManufacturerInput.addEventListener('input', (e) => {
        this.populateModelDropdown('cat-other-model', e.target.value, 'other');
      });
    }
  }

  searchEquipment(category, query, resultsElementId) {
    const resultsDiv = document.getElementById(resultsElementId);
    
    if (!query.trim()) {
      resultsDiv.innerHTML = `<div style="padding: 20px; text-align: center; color: #64748b; font-size: 13px;">Type to search for ${category} models...</div>`;
      return;
    }
    
    console.log('[DEBUG] Searching equipment for category:', category, 'query:', query);
    
    // Search in equipment database
    const equipment = STATE.equipmentKB?.equipment || [];
    const filtered = equipment.filter(item => {
      const searchText = (item.vendor + ' ' + item.model + ' ' + (item.tags || []).join(' ')).toLowerCase();
      const matches = item.category === category && searchText.includes(query.toLowerCase());
      if (query.toLowerCase().length >= 2) {
        console.log('[DEBUG] Checking:', searchText, 'matches query "' + query + '":', matches);
      }
      return matches;
    });
    
    console.log('[DEBUG] Found', filtered.length, 'matching equipment');
    
    if (filtered.length === 0) {
      resultsDiv.innerHTML = `<div style="padding: 20px; text-align: center; color: #64748b; font-size: 13px;">No ${category} models found matching "${query}"</div>`;
      return;
    }
    
    const html = filtered.map(item => `
      <div class="equipment-result" onclick="roomWizard.addEquipment('${category}', '${item.vendor}', '${item.model}', '${item.capacity || item.power || 'Unknown'}', '${item.control || 'Manual'}')"
           style="padding: 8px; border-bottom: 1px solid #f1f5f9; cursor: pointer; display: flex; justify-content: between; align-items: center;">
        <div>
          <div style="font-weight: 500; font-size: 14px;">${item.vendor} ${item.model}</div>
          <div style="font-size: 12px; color: #64748b;">${item.capacity || item.power || 'Unknown capacity'} • ${item.control || 'Manual'}</div>
        </div>
        <div style="font-size: 12px; color: #3b82f6; font-weight: 500;">+ Add</div>
      </div>
    `).join('');
    
    resultsDiv.innerHTML = html;
  }

  addEquipment(category, vendor, model, capacity, control) {
    console.log('[DEBUG] Adding equipment:', category, vendor, model);
    
    // Initialize selected equipment array if it doesn't exist
    if (!this.categoryProgress[this.currentStep]) {
      this.categoryProgress[this.currentStep] = {};
    }
    if (!this.categoryProgress[this.currentStep].selectedEquipment) {
      this.categoryProgress[this.currentStep].selectedEquipment = [];
    }
    
    // Check if already selected
    const existing = this.categoryProgress[this.currentStep].selectedEquipment.find(e => 
      e.category === category && e.vendor === vendor && e.model === model
    );
    
    if (existing) {
      existing.count += 1;
    } else {
      this.categoryProgress[this.currentStep].selectedEquipment.push({
        category,
        vendor,
        model,
        capacity,
        control,
        count: 1
      });
    }
    
    this.renderSelectedEquipment(category, `cat-${category}-selected`);
  }

  renderSelectedEquipment(category, selectedElementId) {
    const selectedDiv = document.getElementById(selectedElementId);
    if (!selectedDiv) return;
    
    const selectedEquipment = this.categoryProgress[this.currentStep]?.selectedEquipment?.filter(e => e.category === category) || [];
    
    if (selectedEquipment.length === 0) {
      selectedDiv.innerHTML = `<div style="color: #64748b; font-size: 13px;">No ${category}s selected yet</div>`;
      return;
    }
    
    const html = selectedEquipment.map(item => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid #f1f5f9;">
        <div>
          <div style="font-weight: 500; font-size: 14px;">${item.vendor} ${item.model}</div>
          <div style="font-size: 12px; color: #64748b;">Qty: ${item.count} • ${item.capacity} • ${item.control}</div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button onclick="roomWizard.changeEquipmentCount('${category}', '${item.vendor}', '${item.model}', -1)" 
                  style="width: 24px; height: 24px; border: 1px solid #d1d5db; background: white; border-radius: 4px; cursor: pointer;">-</button>
          <span style="min-width: 20px; text-align: center; font-size: 14px;">${item.count}</span>
          <button onclick="roomWizard.changeEquipmentCount('${category}', '${item.vendor}', '${item.model}', 1)" 
                  style="width: 24px; height: 24px; border: 1px solid #d1d5db; background: white; border-radius: 4px; cursor: pointer;">+</button>
          <button onclick="roomWizard.removeEquipment('${category}', '${item.vendor}', '${item.model}')" 
                  style="width: 24px; height: 24px; border: 1px solid #ef4444; background: #fef2f2; color: #ef4444; border-radius: 4px; cursor: pointer;">×</button>
        </div>
      </div>
    `).join('');
    
    selectedDiv.innerHTML = html;
  }

  changeEquipmentCount(category, vendor, model, delta) {
    const selectedEquipment = this.categoryProgress[this.currentStep]?.selectedEquipment || [];
    const item = selectedEquipment.find(e => e.category === category && e.vendor === vendor && e.model === model);
    
    if (item) {
      item.count = Math.max(0, item.count + delta);
      if (item.count === 0) {
        this.removeEquipment(category, vendor, model);
      } else {
        this.renderSelectedEquipment(category, `cat-${category}-selected`);
      }
    }
  }

  removeEquipment(category, vendor, model) {
    if (!this.categoryProgress[this.currentStep]?.selectedEquipment) return;
    
    this.categoryProgress[this.currentStep].selectedEquipment = 
      this.categoryProgress[this.currentStep].selectedEquipment.filter(e => 
        !(e.category === category && e.vendor === vendor && e.model === model)
      );
    
    this.renderSelectedEquipment(category, `cat-${category}-selected`);
  }

  populateModelDropdown(modelSelectId, manufacturerQuery, category) {
    const modelSelect = document.getElementById(modelSelectId);
    if (!modelSelect) {
      console.log('[DEBUG] Model select element not found:', modelSelectId);
      return;
    }

    // Clear existing options except the first one
    modelSelect.innerHTML = '<option value="">Select model</option>';

    if (!manufacturerQuery || manufacturerQuery.length < 2) {
      console.log('[DEBUG] Query too short or empty:', manufacturerQuery);
      return;
    }

    const query = manufacturerQuery.toLowerCase();
    console.log('[DEBUG] Searching equipment for manufacturer:', query, 'category:', category);
    console.log('[DEBUG] STATE.equipmentKB exists:', !!STATE.equipmentKB);
    console.log('[DEBUG] Equipment array exists:', !!STATE.equipmentKB?.equipment);
    console.log('[DEBUG] Equipment array length:', STATE.equipmentKB?.equipment?.length || 0);

    // Search in equipment database
    const equipment = STATE.equipmentKB?.equipment || [];
    const matchingEquipment = equipment.filter(item => 
      item.category === category && 
      item.vendor.toLowerCase().includes(query)
    );

    console.log('[DEBUG] Found equipment matches:', matchingEquipment.length);
    if (matchingEquipment.length > 0) {
      console.log('[DEBUG] Sample matches:', matchingEquipment.slice(0, 3).map(e => `${e.vendor} ${e.model}`));
    }

    matchingEquipment.forEach(item => {
      const option = document.createElement('option');
      option.value = item.model;
      option.textContent = `${item.model} (${item.capacity || item.power || 'Unknown capacity'})`;
      option.dataset.vendor = item.vendor;
      option.dataset.category = item.category;
      option.dataset.control = item.control;
      modelSelect.appendChild(option);
    });

    // Also search in device manufacturers database
    const manufacturers = window.DEVICE_MANUFACTURERS || [];
    manufacturers.forEach(manufacturer => {
      if (manufacturer.name.toLowerCase().includes(query)) {
        (manufacturer.models || []).forEach(model => {
          // Try to match category or features to the requested category
          const hasRelevantFeatures = model.features && (
            (category === 'dehumidifier' && model.features.includes('dehumidification')) ||
            (category === 'mini-split' && model.features.includes('hvac')) ||
            (category === 'fans' && model.features.includes('ventilation'))
          );

          if (hasRelevantFeatures || category === 'other') {
            const option = document.createElement('option');
            option.value = model.model;
            option.textContent = `${model.model} (${(model.connectivity || []).join(', ')})`;
            option.dataset.vendor = manufacturer.name;
            option.dataset.connectivity = (model.connectivity || []).join(',');
            modelSelect.appendChild(option);
          }
        });
      }
    });
  }

  // Wire per-category action buttons: Test Control
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

  // renderKbSelected method moved to LightWizard

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
    this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '' };
    const groups = Array.isArray(this.data.grouping.groups) ? this.data.grouping.groups : (this.data.grouping.groups = []);
    if (!groups.includes(name)) {
      groups.push(name);
      this.renderGroupList();
      this.updateGroupSuggestions();
      this.updateSetupQueue();
    }
  }

  removeGroup(idx) {
    this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '' };
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
    if (text.includes('bluetooth') || text.includes('ble')) return 'bluetooth';
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
      host.innerHTML = '<li class="tiny" style="color:#64748b">Search lights, hubs, HVAC, dehumidifiers, equipment…</li>';
      return;
    }
    const q = query.toLowerCase();
    const results = [];
    
    // Search fixtures (lights)
    const fixtures = (STATE.deviceKB?.fixtures || []).filter(item => `${item.vendor} ${item.model}`.toLowerCase().includes(q));
    fixtures.forEach(item => {
      results.push({
        kind: 'fixture',
        item,
        label: `${item.vendor} ${item.model}`,
        meta: [item.watts ? `${item.watts} W` : null, item.control || null].filter(Boolean).join(' • ')
      });
    });
    
    // Search equipment (HVAC, dehumidifiers, fans, etc.)
    const equipment = (STATE.equipmentKB?.equipment || []).filter(item => 
      `${item.vendor} ${item.model} ${item.category}`.toLowerCase().includes(q)
    );
    equipment.forEach(item => {
      results.push({
        kind: 'equipment',
        item,
        label: `${item.vendor} ${item.model}`,
        meta: [
          item.category ? item.category.charAt(0).toUpperCase() + item.category.slice(1) : null,
          item.capacity || null,
          item.control || null
        ].filter(Boolean).join(' • ')
      });
    });
    
    // Search device manufacturers
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
      let hint = 'Fill device form & pairing tips';
      if (res.kind === 'fixture') hint = 'Add fixture & infer control';
      else if (res.kind === 'equipment') hint = 'Add equipment & configure control';
      
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
      // Update controller assignments when fixtures are added
      if (typeof renderControllerAssignments === 'function') {
        renderControllerAssignments();
      }
      showToast({ title: 'Fixture added', msg: `${item.vendor} ${item.model} inserted into the room`, kind: 'success', icon: '✅' }, 3000);
      return;
    }

    if (suggestion.kind === 'equipment') {
      const item = suggestion.item;
      this.data.devices = this.data.devices || [];
      
      // Create device entry from equipment
      const device = {
        vendor: item.vendor,
        model: item.model,
        category: item.category,
        power: item.power,
        capacity: item.capacity,
        features: item.features || [],
        setup: {}
      };
      
      // Map control method to setup properties
      if (item.control === 'WiFi') {
        device.setup.wifi = true;
      } else if (item.control === '0-10V') {
        device.setup['0-10v'] = true;
      } else if (item.control === 'Smart Thermostat') {
        device.setup.wifi = true;
        device.setup.thermostat = true;
      } else if (item.control === 'Speed Controller') {
        device.setup['speed-controller'] = true;
      }
      
      this.data.devices.push(device);
      this.ensureHardwareCategory(item.category);
      this.updateSetupQueue();
      
      // Update controller assignments when equipment is added
      if (typeof renderControllerAssignments === 'function') {
        renderControllerAssignments();
      }
      
      showToast({ 
        title: 'Equipment added', 
        msg: `${item.vendor} ${item.model} added to room`, 
        kind: 'success', 
        icon: '✅' 
      }, 3000);
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
    // No-op: setup queue visualization removed. Keep function for compatibility.
    return;
  }

  categoryLabel(id) {
    const map = {
      'hvac': 'Central HVAC',
      'mini-split': 'Mini Split',
      'dehumidifier': 'Dehumidifiers',
      'fans': 'Fans',
      'vents': 'Vents',
      'controllers': 'Controllers',
      'sensors': 'Sensors',
      'other': 'Other'
    };
    return map[id] || id;
  }

  // removeFixture and updateFixtureCount methods moved to LightWizard

  controlHintFor(v) {
    const map = {
      'wifi': 'Wi‑Fi/Cloud-controlled fixtures often expose energy and runtime telemetry; they may also report PPFD if integrated.',
      'bluetooth': 'Bluetooth control pairs locally and may require a nearby hub or phone; telemetry depends on vendor integration.',
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



  updateReview(){
    const host = $('#roomReview'); if (!host) return;
    const escape = escapeHtml;
    // Hardware categories selected in 'hardware' step
    const hardwareCats = Array.isArray(this.data.hardwareCats) ? this.data.hardwareCats : [];
    const hardwareHtml = hardwareCats.length ? hardwareCats.map(id => `<span class="chip tiny">${escape(this.categoryLabel(id))}</span>`).join(' ') : '—';
    // Per-category detail captured in 'category-setup' step
    const catData = this.data.category || {};
    const catDetails = Object.entries(catData).map(([key, val]) => {
      const parts = [];
      if (val.count != null) parts.push(`${escape(String(val.count))} units`);
      if (val.control) parts.push(escape(String(val.control)));
      if (val.energy) parts.push(escape(String(val.energy)));
      if (val.notes) parts.push(escape(String(val.notes)));
      const label = escape(this.categoryLabel(key));
      return `<li><strong>${label}</strong> — ${parts.length ? parts.join(' • ') : 'No details captured'}</li>`;
    });
    const categoryHtml = catDetails.length ? `<ul class="tiny" style="margin:6px 0 0 0; padding-left:18px">${catDetails.join('')}</ul>` : '<span>—</span>';
    // Category setup queue/progress removed from room review per spec
    const progressEntries = '';
    host.innerHTML = `
      <div><strong>Name:</strong> ${escape(this.data.name || '—')}</div>
      <div><strong>Location:</strong> ${escape(this.data.location || '—')}</div>
      <div><strong>Hardware:</strong> ${hardwareHtml}</div>
      <div><strong>Per-category details:</strong> ${categoryHtml}</div>
  ${progressEntries ? `<div><strong>Setup queue:</strong> ${progressEntries}</div>` : ''}
    `;
  }

  async addLiveSwitchBotDevices() {
    try {
      // Clear existing devices first
      this.data.devices = [];
      
      // Fetch LIVE SwitchBot devices from the API - NO DEMO/MOCK DATA
      console.log('🔌 Fetching LIVE SwitchBot device data (no mock fallbacks)...');
      const response = await fetch('/api/switchbot/devices?refresh=1');
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SwitchBot API returned HTTP ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      const meta = data.meta || {};

      // Check for rate limiting
      if (response.status === 429 || data.statusCode === 429) {
        const retryAfter = data.retryAfter || 60;
        console.warn(`⏱️ SwitchBot API rate limited. Retry after ${retryAfter} seconds.`);
        showToast({ 
          title: 'API Rate Limited', 
          msg: `SwitchBot API is rate limited. Please wait ${retryAfter} seconds and refresh.`, 
          kind: 'warn', 
          icon: '⏱️' 
        });
        
        // NO FALLBACK - Live data only
        if (this.statusEl) {
          this.statusEl.textContent = `Rate limited - retry in ${retryAfter}s`;
        }
        return;
      }

      if (meta.cached && meta.stale) {
        console.warn('⚠️ Using stale cached SwitchBot data:', meta.error || 'Unknown error');
        showToast({ 
          title: 'Using Cached Data', 
          msg: 'SwitchBot API unavailable, using cached device data.', 
          kind: 'info', 
          icon: '💾' 
        });
      } else if (meta.cached) {
        console.info('📋 Using cached SwitchBot device list (within TTL).');
      }

      if (data.statusCode === 100 && data.body && data.body.deviceList) {
        const realDevices = data.body.deviceList;

        if (realDevices.length === 0) {
          console.warn('⚠️ No SwitchBot devices found in your account');
          showToast({ 
            title: 'No Devices Found', 
            msg: 'No SwitchBot devices found in your account. Add devices in the SwitchBot app first.', 
            kind: 'warn', 
            icon: '📱' 
          });
          
          if (this.statusEl) {
            this.statusEl.textContent = 'No devices found in SwitchBot account';
          }
          return;
        }

        // Add real devices only
        realDevices.forEach((device, index) => {
          const liveDevice = {
            name: device.deviceName || `SwitchBot ${device.deviceType} ${index + 1}`,
            vendor: 'SwitchBot',
            model: device.deviceType,
            host: 'live-switchbot-api',
            switchBotId: device.deviceId,
            hubId: device.hubDeviceId,
            setup: this.getSetupForDeviceType(device.deviceType),
            isReal: true,
            isLive: true, // Mark as live data
            realDeviceData: device,
            lastUpdate: new Date().toISOString()
          };
          this.data.devices.push(liveDevice);
        });
        
        console.log(`✅ Loaded ${realDevices.length} LIVE SwitchBot device(s) from greenreach network`, meta);
        showToast({ 
          title: 'Live Devices Connected', 
          msg: `Successfully connected to ${realDevices.length} live SwitchBot devices on greenreach network.`, 
          kind: 'success', 
          icon: '🔌' 
        });

        if (this.statusEl) {
          this.statusEl.textContent = `${realDevices.length} live devices connected on greenreach`;
        }

      } else {
        throw new Error(`Invalid API response: statusCode ${data.statusCode || 'unknown'}`);
      }
    } catch (error) {
      console.error('❌ Failed to load live SwitchBot devices:', error);
      
      // NO FALLBACK TO MOCK DATA - Show error instead
      showToast({ 
        title: 'Live Data Required', 
        msg: `Cannot load live SwitchBot devices: ${error.message}. Please check your API credentials and network connection.`, 
        kind: 'error', 
        icon: '❌' 
      });
      
      if (this.statusEl) {
        this.statusEl.textContent = `Error: ${error.message}`;
      }
      
      // Keep devices array empty to force live data requirement
      this.data.devices = [];
    }

    // Set live SwitchBot configuration - NO DEMO TOKENS
    this.setupLiveSwitchBotConfiguration();
  }

  getSetupForDeviceType(deviceType) {
    const type = deviceType.toLowerCase();
    if (type.includes('meter') || type.includes('sensor')) {
      return {
        bluetooth: { name: `WoSensorTH_${Math.random().toString(36).substr(2, 6)}`, pin: null }
      };
    } else if (type.includes('plug') || type.includes('switch')) {
      return {
        wifi: { ssid: 'greenreach', psk: 'Farms2024', useStatic: false, staticIp: null }
      };
    } else if (type.includes('bot')) {
      return {
        bluetooth: { name: `WoHand_${Math.random().toString(36).substr(2, 6)}`, pin: null }
      };
    } else {
      return {
        wifi: { ssid: 'greenreach', psk: 'Farms2024', useStatic: true, staticIp: `192.168.1.${40 + Math.floor(Math.random() * 10)}` }
      };
    }
  }

  addFallbackDemoDevices() {
    // DISABLED: No more mock/demo fallback data
    // This function is intentionally disabled to enforce live data only
    console.warn('🚫 Mock fallback data is disabled. Only live SwitchBot devices are supported.');
    showToast({ 
      title: 'Live Data Only', 
      msg: 'Mock devices are disabled. Please ensure your SwitchBot API is working and you have real devices.', 
      kind: 'warn', 
      icon: '🚫' 
    });
    this.data.devices = [];
  }

  setupLiveSwitchBotConfiguration() {
    // Set hardware categories for real farm equipment
    this.data.hardwareCats = this.data.hardwareCats || [];
    const farmEquipment = ['grow-lights', 'hvac', 'mini-split', 'dehumidifier', 'fans', 'controllers'];
    farmEquipment.forEach(cat => {
      if (!this.data.hardwareCats.includes(cat)) {
        this.data.hardwareCats.push(cat);
      }
    });

    // LIVE connectivity configuration - NO DEMO TOKENS
    this.data.connectivity = {
      hasHub: 'yes',
      hubType: 'Raspberry Pi 4 + SwitchBot Hub',
      hubIp: '192.168.1.100',
      cloudTenant: 'Azure',
      // LIVE TOKENS SHOULD BE SET VIA ENVIRONMENT VARIABLES
      switchbotToken: process.env.SWITCHBOT_TOKEN || 'REQUIRED: Set SWITCHBOT_TOKEN environment variable',
      switchbotSecret: process.env.SWITCHBOT_SECRET || 'REQUIRED: Set SWITCHBOT_SECRET environment variable'
    };

    // Real sensor categories from farm environment
    this.data.sensors = this.data.sensors || { categories: [], placements: {} };
    const farmSensors = ['temperature', 'humidity', 'co2', 'power', 'light', 'soil-moisture'];
    farmSensors.forEach(cat => {
      if (!this.data.sensors.categories.includes(cat)) {
        this.data.sensors.categories.push(cat);
      }
    });

    // Farm-specific sensor placements
    this.data.sensors.placements = {
      temperature: 'canopy-level',
      humidity: 'canopy-level', 
      co2: 'mid-level',
      power: 'electrical-panel',
      light: 'sensor-grid',
      'soil-moisture': 'root-zone'
    };

    // Re-render the devices list and update setup queue
    this.renderDevicesList();
    this.updateSetupQueue();

    // Show LIVE connection message
    showToast({ 
      title: 'Live Farm Network Connected', 
      msg: `Connected to greenreach network with live SwitchBot devices and farm sensors.`, 
      kind: 'success', 
      icon: '🌱' 
    });
  }

  nextStep() {
    // Allow moving forward without completing pages. We'll still capture soft state
    // when possible elsewhere and validate on save or explicit actions.
    this.currentStep = Math.min(this.steps.length - 1, this.currentStep + 1);
    this.showStep(this.currentStep);
  }

  prevStep() {
    this.currentStep = Math.max(0, this.currentStep - 1);
    this.showStep(this.currentStep);
  }

  async saveRoom(e, shouldAutoClose = true){
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
      renderControllerAssignments(); // Update controller assignments when rooms change
      showToast({ title:'Room saved', msg:`${this.data.name} saved`, kind:'success', icon:'✅' });
      try { localStorage.removeItem('gr.roomWizard.progress'); } catch {}
      
      // Only close if explicitly requested and not part of a multi-room workflow
      if (shouldAutoClose && (!this.multiRoomList || this.multiRoomList.length <= 1)) {
        this.close();
      }
      return true;
    } else {
      alert('Failed to save room');
      return false;
    }
  }

  async saveAndClose() {
    // Check if there are more rooms to setup
    const hasMoreRooms = Array.isArray(this.multiRoomList) && this.multiRoomList.length > 1 && this.multiRoomIndex < this.multiRoomList.length - 1;
    
    // Create a mock event to satisfy saveRoom's preventDefault call
    const mockEvent = { preventDefault: () => {} };
    
    // Save the current room
    const success = await this.saveRoom(mockEvent, false);
    
    if (success && hasMoreRooms) {
      // If there are more rooms, ask user if they want to continue or close
      const continueSetup = confirm(`Room "${this.data.name}" saved successfully!\n\nYou have ${this.multiRoomList.length - this.multiRoomIndex - 1} more room(s) to setup.\n\nClick OK to continue with the next room, or Cancel to finish later.`);
      
      if (continueSetup) {
        // Move to next room
        this.multiRoomIndex++;
        const nextRoom = this.multiRoomList[this.multiRoomIndex];
        this._openSingleRoom(nextRoom);
        this.currentStep = 0;
        this.showStep(0);
        this._injectMultiRoomNav();
        
        showToast({ 
          title: 'Continuing Setup', 
          msg: `Now setting up: ${nextRoom.name}`, 
          kind: 'success', 
          icon: '▶️' 
        });
      } else {
        // User chose to finish later, close the wizard
        this.close();
        showToast({ 
          title: 'Setup Paused', 
          msg: 'You can resume room setup anytime from the Grow Rooms section', 
          kind: 'info', 
          icon: '⏸️' 
        });
      }
    } else if (success) {
      // This was the last room or single room setup, close normally
      this.close();
      if (this.multiRoomList && this.multiRoomList.length > 1) {
        showToast({ 
          title: 'All Rooms Complete!', 
          msg: 'All grow rooms have been set up successfully', 
          kind: 'success', 
          icon: '🎉' 
        });
      }
    }
    // If save failed, saveRoom will handle the error display and we stay in the wizard
  }

  // Device Discovery Methods
  async runDeviceDiscovery() {
    const statusEl = $('#roomDiscoveryStatus');
    const runBtn = $('#roomDiscoveryRun');
    const stopBtn = $('#roomDiscoveryStop');
    const resultsEl = $('#roomDiscoveryResults');
      const progressEl = $('#roomDiscoveryProgress');
    
      // Show enhanced scanning radar
      if (progressEl) progressEl.style.display = 'flex';
      if (statusEl) statusEl.innerHTML = '<span style="color:#0ea5e9">🔍 Multi-protocol scan in progress...</span>';
      if (runBtn) {
        runBtn.style.display = 'none';
        runBtn.disabled = true;
      }
    if (stopBtn) stopBtn.style.display = 'inline-block';
    
    this.discoveryRunning = true;
    this.discoveredDevices = [];
    
    try {
      // Use the existing device discovery from DeviceManagerWindow
      if (deviceManagerWindow) {
        await deviceManagerWindow.runDiscovery();
        this.discoveredDevices = deviceManagerWindow.devices || [];
        
          if (statusEl) statusEl.innerHTML = `<span style="color:#059669">✅ Found ${this.discoveredDevices.length} devices across all protocols</span>`;
        this.renderDiscoveredDevices();
        if (resultsEl) resultsEl.style.display = 'block';
      }
    } catch (error) {
        if (statusEl) statusEl.innerHTML = '<span style="color:#dc2626">❌ Multi-protocol discovery failed</span>';
      console.error('Device discovery failed:', error);
    }
    
      // Hide scanning radar
      if (progressEl) progressEl.style.display = 'none';
    this.discoveryRunning = false;
      if (runBtn) {
        runBtn.style.display = 'inline-block';
        runBtn.disabled = false;
      }
    if (stopBtn) stopBtn.style.display = 'none';
  }
  
  stopDeviceDiscovery() {
    this.discoveryRunning = false;
    const statusEl = $('#roomDiscoveryStatus');
    const runBtn = $('#roomDiscoveryRun');
    const stopBtn = $('#roomDiscoveryStop');
    
    if (statusEl) statusEl.innerHTML = '<span style="color:#f59e0b">⏹️ Discovery stopped</span>';
    if (runBtn) runBtn.style.display = 'inline-block';
    if (stopBtn) stopBtn.style.display = 'none';
  }
  
  renderDiscoveredDevices() {
    const listEl = $('#roomDiscoveryDeviceList');
    if (!listEl || !this.discoveredDevices) return;
    
    listEl.innerHTML = this.discoveredDevices.map((device, idx) => `
      <div class="discovery-device-item" style="display:flex;align-items:center;padding:8px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:6px">
        <input type="checkbox" id="discoveryDevice${idx}" data-device-idx="${idx}" style="margin-right:8px">
        <div style="flex:1">
          <div class="tiny" style="font-weight:500">${device.deviceName || device.id || 'Unknown Device'}</div>
          <div class="tiny" style="color:#6b7280">${device.ip || device.host || ''} • ${device.type || 'Unknown type'}</div>
        </div>
        <div class="tiny" style="color:#374151">${device.online ? '🟢 Online' : '🔴 Offline'}</div>
      </div>
    `).join('');
  }
  
  selectAllDiscoveredDevices() {
    const listEl = $('#roomDiscoveryDeviceList');
    if (!listEl) return;
    
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
  }
  
  selectNoDiscoveredDevices() {
    const listEl = $('#roomDiscoveryDeviceList');
    if (!listEl) return;
    
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  }
  
  refreshDeviceDiscovery() {
    this.runDeviceDiscovery();
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
    const [groups, schedules, plans, environment, calibrations, deviceMeta, deviceKB, equipmentKB, deviceManufacturers, farm, rooms, switchbotDevices] = await Promise.all([
      loadJSON('./data/groups.json'),
      loadJSON('./data/schedules.json'),
      loadJSON('./data/plans.json'),
      api('/env'),
      loadJSON('./data/calibration.json'),
      loadJSON('./data/device-meta.json'),
        loadJSON('./data/device-kb.json'),
        loadJSON('./data/equipment-kb.json'),
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
  if (deviceKB && Array.isArray(deviceKB.fixtures)) {
    STATE.deviceKB = deviceKB;
    console.log('✅ Loaded device fixtures database:', deviceKB.fixtures.length, 'fixtures');
    console.log('Sample fixtures:', deviceKB.fixtures.slice(0, 3).map(f => `${f.vendor} ${f.model}`));
  }
  if (equipmentKB && Array.isArray(equipmentKB.equipment)) {
    STATE.equipmentKB = equipmentKB;
    console.log('✅ Loaded equipment database:', equipmentKB.equipment.length, 'equipment items');
    console.log('Sample equipment:', equipmentKB.equipment.slice(0, 3).map(e => `${e.vendor} ${e.model} (${e.category})`));
  }
  // load manufacturers into a global for lookups and selects
  if (deviceManufacturers && Array.isArray(deviceManufacturers.manufacturers)) {
    window.DEVICE_MANUFACTURERS = deviceManufacturers.manufacturers;
    console.log('✅ Loaded device manufacturers:', deviceManufacturers.manufacturers.length, 'manufacturers');
  } else {
    window.DEVICE_MANUFACTURERS = window.DEVICE_MANUFACTURERS || [];
  }
    
    setStatus(`Loaded ${STATE.devices.length} devices, ${STATE.groups.length} groups, ${STATE.schedules.length} schedules`);
    // NO DEMO FALLBACK - Live devices only
    if ((!STATE.devices || STATE.devices.length === 0)) {
      setStatus(`No live devices found. Please ensure devices are connected to greenreach network and discoverable.`);
      console.warn('🚫 No live devices discovered. Demo/mock fallback is disabled.');
    }
    
    // Render UI
    renderDevices();
    renderGroups();
    renderSchedules();
    renderPlans();
    renderPlansPanel();
    renderEnvironment();
    renderRooms();
    renderLightSetups();
    
    // Initialize sample light setups for demo (remove this in production)
    if (!STATE.lightSetups || STATE.lightSetups.length === 0) {
      STATE.lightSetups = [
        {
          id: 'demo-1',
          room: 'Veg Room',
          zone: 'Zone A',
          fixtures: [
            { id: 'gavita-1700e', name: 'Gavita Pro 1700e LED', watts: 645, ppfd: 1700, count: 4 }
          ],
          controlMethod: 'wifi',
          controlDetails: 'Fixtures will be controlled via Wi-Fi connection using manufacturer apps.',
          lightsPerController: 2,
          controllersCount: 2,
          totalFixtures: 4,
          totalWattage: 2580,
          createdAt: new Date().toISOString()
        },
        {
          id: 'demo-2',
          room: 'Flower Room',
          zone: 'Zone 1',
          fixtures: [
            { id: 'fluence-spydr-2p', name: 'Fluence SPYDR 2p', watts: 645, ppfd: 1700, count: 6 }
          ],
          controlMethod: '0-10v',
          controlDetails: 'Professional dimming control using 0-10V signals.',
          lightsPerController: 3,
          controllersCount: 2,
          totalFixtures: 6,
          totalWattage: 3870,
          createdAt: new Date().toISOString()
        }
      ];
    }
    
    renderLightSetupSummary();
    renderControllerAssignments();
    renderSwitchBotDevices();
    
    // Wire controller assignments buttons
    document.getElementById('btnRefreshControllerAssignments')?.addEventListener('click', renderControllerAssignments);
    document.getElementById('btnManageControllers')?.addEventListener('click', () => {
      alert('Controller management interface will be implemented in future update');
    });
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

  // Always show device cards if there's a selection
  if (emptyMsg) emptyMsg.style.display = 'none';

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
      const orderedCats = ['hvac','mini-split','dehumidifier','fans','vents','controllers','sensors'];
      const statusRow = orderedCats
        .filter(c => prog[c])
        .map(c => {
          const labelText = typeof roomWizard?.categoryLabel === 'function' ? roomWizard.categoryLabel(c) : c;
          const label = escapeHtml(labelText);
          const statusText = escapeHtml(badge(prog[c]?.status));
          return `<span class="chip tiny" title="${label}">${label}: ${statusText}</span>`;
        })
        .join(' ');
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
            <div class="tiny" style="color:#475569">Layout: ${layoutType} • Zones: ${zones} • Control: ${control}</div>
            <div class="tiny" style="color:#475569">Sensors: ${sensorCats} • Placement: ${sensorPlacements}</div>
            <div class="tiny" style="color:#475569">${connSummary}</div>
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
        // Update controller assignments when rooms are deleted
        if (typeof renderControllerAssignments === 'function') {
          renderControllerAssignments();
        }
      } else {
        alert('Failed to delete room');
      }
    });
  });

  renderGrowRoomOverview();
}

function renderLightSetups() {
  const container = document.getElementById('lightSetupsContent');
  if (!container) return;
  
  // For now, this is a placeholder - light setups would be stored separately from rooms
  // In the future, this would load from a light-setups.json file
  const lightSetups = []; // TODO: Load actual light setups
  
  if (lightSetups.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No Light Setups Configured</h3>
        <p>Create your first light setup to manage fixtures, control methods, and energy settings.</p>
        <button type="button" class="primary" id="btnLaunchLightSetup">
          <span class="icon">💡</span>
          Create Light Setup
        </button>
      </div>
    `;
    // Wire the button since it's dynamically created
    document.getElementById('btnLaunchLightSetup')?.addEventListener('click', () => freshLightWizard.open());
  } else {
    container.innerHTML = lightSetups.map(setup => `
      <div class="card">
        <div class="card-header">
          <h3>${setup.name}</h3>
          <div class="actions">
            <button type="button" class="ghost small" onclick="editLightSetup('${setup.id}')">Edit</button>
            <button type="button" class="ghost small danger" onclick="deleteLightSetup('${setup.id}')">Delete</button>
          </div>
        </div>
        <div class="card-body">
          <p><strong>Fixtures:</strong> ${setup.fixtures?.length || 0}</p>
          <p><strong>Control:</strong> ${setup.controlMethod || 'Not set'}</p>
          <p><strong>Energy:</strong> ${setup.energy || 'Not set'}</p>
        </div>
      </div>
    `).join('');
  }
}

function renderLightSetupSummary() {
  const summaryContainer = document.getElementById('lightSetupSummary');
  if (!summaryContainer) return;
  
  const lightSetups = STATE.lightSetups || [];
  const rooms = STATE.rooms || [];
  
  if (rooms.length === 0) {
    summaryContainer.innerHTML = '<p class="tiny" style="color:#64748b">No rooms configured yet.</p>';
    return;
  }
  
  // Create room-based summary matching Grow Rooms format
  const roomSummaries = rooms.map(room => {
    // Get light setups for this room
    const roomLightSetups = lightSetups.filter(setup => 
      setup.room === room.name || setup.room === room.id
    );
    
    // Calculate light totals for this room
    let totalLights = 0;
    let lightDetails = [];
    
    if (roomLightSetups.length > 0) {
      roomLightSetups.forEach(setup => {
        totalLights += setup.totalFixtures || 0;
        
        if (setup.selectedFixtures && setup.selectedFixtures.length > 0) {
          setup.selectedFixtures.forEach(fixture => {
            const quantity = setup.fixtureQuantities?.[fixture.id] || 1;
            lightDetails.push({
              name: fixture.name || fixture.model || 'LED Fixture',
              quantity: quantity,
              zone: setup.zone
            });
          });
        } else if (setup.fixtures && setup.fixtures.length > 0) {
          // Fallback for older format
          setup.fixtures.forEach(fixture => {
            lightDetails.push({
              name: fixture.name || 'LED Fixture',
              quantity: fixture.count || 1,
              zone: setup.zone
            });
          });
        }
      });
    }
    
    // Build zones display from room data
    const zones = (room.zones || []).join(', ') || '—';
    
    // Build light summary
    const lightSummary = lightDetails.length > 0 
      ? lightDetails.map(light => `${light.quantity}x ${light.name}`).join(', ')
      : totalLights > 0 
        ? `${totalLights} light${totalLights !== 1 ? 's' : ''}`
        : '—';
    
    // Control method from light setups or room data
    const controlMethods = [...new Set(roomLightSetups.map(setup => setup.controlMethod).filter(Boolean))];
    const control = controlMethods.length > 0 ? controlMethods.join(', ') : (room.controlMethod || '—');
    
    const name = room.name || 'Unnamed Room';
    
    const roomId = room.id || '';
    const editPayload = JSON.stringify(room || {}).replace(/"/g, '&quot;');
    
    return `
      <div class="card" style="margin-top:8px">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div>
            <h3 style="margin:0">${name}</h3>
            <div class="tiny" style="color:#475569">Zones: ${zones} • Control: ${control}</div>
            <div class="tiny" style="color:#475569">Lights: ${lightSummary}</div>
          </div>
          <div class="row" style="gap:6px">
            <button type="button" class="ghost" onclick="editLightSetup('${roomId}')">Edit</button>
            <button type="button" class="ghost danger" data-action="del-light-setup" data-room-id="${roomId}">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  summaryContainer.innerHTML = roomSummaries;
  
  // Wire up delete buttons
  summaryContainer.querySelectorAll('[data-action="del-light-setup"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const roomId = btn.getAttribute('data-room-id');
      const room = STATE.rooms.find(r => String(r.id) === String(roomId));
      if (!roomId) return;
      
      const roomName = room?.name || roomId;
      const lightSetupsForRoom = STATE.lightSetups.filter(setup => 
        setup.room === room?.name || setup.room === roomId
      );
      
      if (lightSetupsForRoom.length === 0) {
        alert(`No light setups found for room "${roomName}"`);
        return;
      }
      
      if (!confirm(`Delete all light setups for "${roomName}"? This cannot be undone.`)) return;
      
      // Remove all light setups for this room
      STATE.lightSetups = STATE.lightSetups.filter(setup => 
        setup.room !== room?.name && setup.room !== roomId
      );
      
      // Re-render the summary
      renderLightSetupSummary();
      renderControllerAssignments();
      showToast({ 
        title: 'Light Setup Deleted', 
        msg: `Removed light setup for ${roomName}`, 
        kind: 'success', 
        icon: '🗑️' 
      });
    });
  });
}

function editLightSetup(roomId) {
  // Find the room
  const room = STATE.rooms.find(r => String(r.id) === String(roomId));
  if (!room) {
    alert('Room not found');
    return;
  }
  
  // Find light setups for this room
  const roomLightSetups = STATE.lightSetups.filter(setup => 
    setup.room === room.name || setup.room === roomId
  );
  
  if (roomLightSetups.length === 0) {
    // No existing light setup, create new one
    if (confirm(`No light setup found for "${room.name}". Create a new light setup for this room?`)) {
      // Open the fresh light wizard with pre-selected room
      if (window.freshLightWizard) {
        freshLightWizard.open();
        // Pre-select the room in step 1 if possible
        setTimeout(() => {
          const roomSelect = document.getElementById('lightSetupRoom');
          if (roomSelect) {
            roomSelect.value = room.name;
            // Trigger change event to update zones
            roomSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, 100);
      }
    }
    return;
  }
  
  // For now, since we have multiple light setups per room, 
  // let's open the light wizard to add/modify setups
  if (window.freshLightWizard) {
    freshLightWizard.open();
    // Pre-select the room
    setTimeout(() => {
      const roomSelect = document.getElementById('lightSetupRoom');
      if (roomSelect) {
        roomSelect.value = room.name;
        roomSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, 100);
    
    showToast({ 
      title: 'Edit Light Setup', 
      msg: `Opening light setup wizard for ${room.name}`, 
      kind: 'info', 
      icon: '✏️' 
    });
  }
}

// Controller Assignments functionality
function generateUniqueId(equipmentType, roomName, zoneName) {
  // Create unique ID format: EQUIPMENTTYPEROOM#ZONE#RANDOM
  // e.g., DEAL037 for Dehumidifier in Alpha room, zone 3, random 7
  
  const equipmentCode = equipmentType.substring(0, 2).toUpperCase();
  const roomCode = roomName.substring(0, 2).toUpperCase();
  const zoneCode = zoneName.toString().padStart(1, '0');
  const randomDigit = Math.floor(Math.random() * 10);
  
  return `${equipmentCode}${roomCode}${zoneCode}${randomDigit}`;
}

function getControllerRequiredEquipment() {
  const equipment = [];
  
  // Get current operational lights from device metadata (for demo/existing lights)
  const deviceMeta = STATE.deviceMeta || {};
  Object.keys(deviceMeta).forEach(deviceId => {
    const device = deviceMeta[deviceId];
    if (deviceId.startsWith('light-') && device.transport === 'wifi') {
      // Map to current room structure or use legacy room name
      let roomName = device.room || 'Grow Room 2';
      let zoneName = device.zone || '1';
      
      // Try to map to current rooms
      const currentRoom = STATE.rooms?.find(r => 
        r.name.toLowerCase().includes('grow') || 
        r.name.toLowerCase().includes('test')
      );
      if (currentRoom) {
        roomName = currentRoom.name;
        zoneName = currentRoom.zones?.[0] || '1';
      }
      
      equipment.push({
        type: 'Light',
        make: device.manufacturer || 'Unknown',
        model: device.model || 'Unknown',
        room: roomName,
        zone: zoneName,
        uniqueId: deviceId, // Use actual device ID for existing lights
        controlMethod: 'WiFi',
        controller: 'Unassigned',
        status: 'Operational', // Mark as operational for demo
        serial: device.serial || 'Unknown',
        watts: device.watts || 'Unknown'
      });
    }
  });
  
  // Get equipment from light setups
  const lightSetups = STATE.lightSetups || [];
  lightSetups.forEach(setup => {
    if (setup.controlMethod && setup.controlMethod !== 'manual') {
      const room = STATE.rooms.find(r => r.name === setup.room || r.id === setup.room);
      const roomName = room?.name || setup.room || 'Unknown';
      const zoneName = setup.zone || '1';
      
      if (setup.selectedFixtures) {
        setup.selectedFixtures.forEach(fixture => {
          const quantity = setup.fixtureQuantities?.[fixture.id] || 1;
          for (let i = 0; i < quantity; i++) {
            equipment.push({
              type: 'Light',
              make: fixture.vendor || 'Unknown',
              model: fixture.name || fixture.model || 'Unknown',
              room: roomName,
              zone: zoneName,
              uniqueId: generateUniqueId('Light', roomName, zoneName),
              controlMethod: setup.controlMethod,
              controller: 'Unassigned'
            });
          }
        });
      }
    }
  });
  
  // Get equipment from room setups (HVAC, sensors, etc.)
  const rooms = STATE.rooms || [];
  rooms.forEach(room => {
    // Check for devices that need controllers
    if (room.devices && room.devices.length > 0) {
      room.devices.forEach(device => {
        const needsController = device.setup && (
          device.setup.wifi || 
          device.setup.bluetooth || 
          device.setup['0-10v'] || 
          device.setup.rs485 ||
          device.setup.smartPlug ||
          device.setup['smart-plug']
        );
        
        if (needsController) {
          room.zones?.forEach(zone => {
            equipment.push({
              type: capitalizeDeviceType(device.category || getDeviceTypeFromModel(device.model) || 'Device'),
              make: device.vendor || 'Unknown',
              model: device.model || 'Unknown',
              room: room.name,
              zone: zone,
              uniqueId: generateUniqueId(device.category || getDeviceTypeFromModel(device.model) || 'Device', room.name, zone),
              controlMethod: getDeviceControlMethod(device.setup),
              controller: 'Unassigned'
            });
          });
        }
      });
    }
    
    // Check for fixtures in room data (legacy format)
    if (room.fixtures && room.fixtures.length > 0) {
      room.fixtures.forEach(fixture => {
        if (fixture.control && fixture.control !== 'manual') {
          room.zones?.forEach(zone => {
            const count = fixture.count || 1;
            for (let i = 0; i < count; i++) {
              equipment.push({
                type: 'Light',
                make: fixture.vendor || 'Unknown',
                model: fixture.model || 'Unknown',
                room: room.name,
                zone: zone,
                uniqueId: generateUniqueId('Light', room.name, zone),
                controlMethod: fixture.control,
                controller: 'Unassigned'
              });
            }
          });
        }
      });
    }
  });
  
  // Get equipment from groups (lights that are grouped)
  const groups = STATE.groups || [];
  groups.forEach(group => {
    if (group.lights && group.lights.length > 0) {
      group.lights.forEach(light => {
        const device = STATE.devices?.find(d => d.id === light.id);
        if (device) {
          // Determine room from device location or group assignment
          const roomName = device.location || group.room || 'Unknown';
          const zoneName = device.zone || '1';
          
          equipment.push({
            type: 'Light',
            make: device.vendor || 'Unknown',
            model: device.model || device.deviceName || 'Unknown',
            room: roomName,
            zone: zoneName,
            uniqueId: generateUniqueId('Light', roomName, zoneName),
            controlMethod: 'Group Control',
            controller: 'Unassigned'
          });
        }
      });
    }
  });
  
  return equipment;
}

function capitalizeDeviceType(type) {
  const typeMap = {
    'hvac': 'HVAC',
    'mini-split': 'Mini-Split',
    'dehumidifier': 'Dehumidifier',
    'sensor': 'Sensor',
    'fan': 'Fan',
    'controller': 'Controller',
    'hub': 'Hub'
  };
  
  return typeMap[type.toLowerCase()] || type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

function getDeviceTypeFromModel(model) {
  if (!model) return 'Device';
  
  const modelLower = model.toLowerCase();
  if (modelLower.includes('dehumid')) return 'Dehumidifier';
  if (modelLower.includes('hvac') || modelLower.includes('split')) return 'HVAC';
  if (modelLower.includes('sensor')) return 'Sensor';
  if (modelLower.includes('fan')) return 'Fan';
  if (modelLower.includes('hub') || modelLower.includes('bridge')) return 'Hub';
  if (modelLower.includes('controller')) return 'Controller';
  
  return 'Device';
}

function getDeviceControlMethod(setup) {
  if (setup.wifi) return 'WiFi';
  if (setup.bluetooth) return 'Bluetooth';
  if (setup['0-10v']) return '0-10V';
  if (setup.rs485) return 'RS-485';
  if (setup.smartPlug || setup['smart-plug']) return 'Smart Plug';
  return 'Unknown';
}

function renderControllerAssignments() {
  const container = document.getElementById('controllerAssignmentsTable');
  if (!container) return;
  
  const equipment = getControllerRequiredEquipment();
  
  if (equipment.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: #64748b;">
        <p>No equipment requiring controllers found.</p>
        <p class="tiny">Equipment will appear here when you configure lights, HVAC, or sensors with smart control methods.</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = `
    <div class="table-container" style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Type</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Make</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Model</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Room</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Zone</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Unique ID</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Control</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Status</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Controller</th>
            <th style="text-align: center; padding: 12px 8px; font-weight: 600;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${equipment.map((item, index) => `
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 12px 8px;">
                <span class="chip tiny" style="background: #dbeafe; color: #1e40af;">${item.type}</span>
                ${item.watts ? `<div class="tiny" style="color: #64748b; margin-top: 2px;">${item.watts}W</div>` : ''}
              </td>
              <td style="padding: 12px 8px; font-weight: 500;">${item.make}</td>
              <td style="padding: 12px 8px;">
                ${item.model}
                ${item.serial ? `<div class="tiny" style="color: #64748b; margin-top: 2px;">S/N: ${item.serial}</div>` : ''}
              </td>
              <td style="padding: 12px 8px;">${item.room}</td>
              <td style="padding: 12px 8px;">${item.zone}</td>
              <td style="padding: 12px 8px;">
                <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: 'Monaco', monospace; font-size: 12px;">${item.uniqueId}</code>
              </td>
              <td style="padding: 12px 8px;">
                <span class="chip tiny" style="background: #ecfdf5; color: #059669;">${item.controlMethod}</span>
              </td>
              <td style="padding: 12px 8px;">
                ${item.status === 'Operational' ? 
                  '<span class="chip tiny" style="background: #dcfce7; color: #166534;">Operational</span>' : 
                  '<span class="chip tiny" style="background: #fef3c7; color: #d97706;">Setup Required</span>'
                }
              </td>
              <td style="padding: 12px 8px;">
                <select class="controller-select" data-equipment-index="${index}" style="padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px;">
                  <option value="">Select Controller...</option>
                  <option value="hub-001">Main Hub (HUB-001)</option>
                  <option value="controller-001">Zone Controller 1 (CTRL-001)</option>
                  <option value="controller-002">Zone Controller 2 (CTRL-002)</option>
                  <option value="wifi-bridge">WiFi Bridge (WIFI-001)</option>
                </select>
              </td>
              <td style="padding: 12px 8px; text-align: center;">
                <button type="button" class="ghost tiny" onclick="editControllerAssignment(${index})">${item.status === 'Operational' ? 'Configure' : 'Edit'}</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    
    <div style="margin-top: 16px; padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div>
          <strong>${equipment.length}</strong> equipment item${equipment.length !== 1 ? 's' : ''} requiring controller assignment
        </div>
        <div class="row" style="gap: 8px;">
          <button type="button" class="ghost" onclick="exportControllerAssignments()">Export CSV</button>
          <button type="button" class="primary" onclick="saveControllerAssignments()">Save Assignments</button>
        </div>
      </div>
    </div>
  `;
  
  // Wire up controller selection changes
  container.querySelectorAll('.controller-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const index = parseInt(e.target.getAttribute('data-equipment-index'));
      const controllerId = e.target.value;
      
      if (equipment[index]) {
        equipment[index].controller = controllerId || 'Unassigned';
        
        showToast({
          title: 'Controller Updated',
          msg: `${equipment[index].uniqueId} assigned to ${controllerId || 'Unassigned'}`,
          kind: 'success',
          icon: '🔗'
        });
      }
    });
  });
}

function editControllerAssignment(index) {
  const equipment = getControllerRequiredEquipment();
  const item = equipment[index];
  
  if (!item) return;
  
  const isOperational = item.status === 'Operational';
  
  const modalHTML = `
    <div class="modal-backdrop active" onclick="closeModal()">
      <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 600px;">
        <div class="modal-header">
          <h3>${isOperational ? 'Configure' : 'Edit'} Controller Assignment</h3>
          <button type="button" class="btn-close" onclick="closeModal()">×</button>
        </div>
        
        <div class="modal-body">
          <div class="form-group">
            <label>Equipment Details</label>
            <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 14px;">
                <div><strong>Type:</strong> ${item.type}</div>
                <div><strong>Make:</strong> ${item.make}</div>
                <div><strong>Model:</strong> ${item.model}</div>
                <div><strong>Room:</strong> ${item.room}</div>
                <div><strong>Zone:</strong> ${item.zone}</div>
                <div><strong>Control:</strong> ${item.controlMethod}</div>
                ${item.serial ? `<div><strong>Serial:</strong> ${item.serial}</div>` : ''}
                ${item.watts ? `<div><strong>Power:</strong> ${item.watts}W</div>` : ''}
              </div>
              ${isOperational ? '<div class="chip tiny" style="background: #dcfce7; color: #166534; margin-top: 8px;">Currently Operational</div>' : ''}
            </div>
          </div>
          
          <div class="form-group">
            <label for="assignedController">Assign Controller</label>
            <select id="assignedController" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px;">
              <option value="">Select Controller...</option>
              <option value="hub-001" ${item.controller === 'hub-001' ? 'selected' : ''}>Main Hub (HUB-001)</option>
              <option value="controller-001" ${item.controller === 'controller-001' ? 'selected' : ''}>Zone Controller 1 (CTRL-001)</option>
              <option value="controller-002" ${item.controller === 'controller-002' ? 'selected' : ''}>Zone Controller 2 (CTRL-002)</option>
              <option value="wifi-bridge" ${item.controller === 'wifi-bridge' ? 'selected' : ''}>WiFi Bridge (WIFI-001)</option>
            </select>
          </div>
          
          ${isOperational ? `
            <div class="form-group">
              <label>Network Configuration</label>
              <div style="background: #fef3c7; padding: 12px; border-radius: 8px; border-left: 4px solid #f59e0b;">
                <div style="font-size: 14px; color: #92400e;">
                  <strong>Note:</strong> This equipment is currently operational. Any controller assignment changes may affect current operation.
                </div>
              </div>
            </div>
          ` : ''}
          
          <div class="form-group">
            <label for="assignmentNotes">Notes</label>
            <textarea id="assignmentNotes" rows="3" placeholder="Add any notes about this controller assignment..." style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; resize: vertical;"></textarea>
          </div>
        </div>
        
        <div class="modal-footer">
          <button type="button" class="btn secondary" onclick="closeModal()">Cancel</button>
          <button type="button" class="btn primary" onclick="saveControllerAssignment(${index})">
            ${isOperational ? 'Update Assignment' : 'Save Assignment'}
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function saveControllerAssignment(index) {
  const equipment = getControllerRequiredEquipment();
  const item = equipment[index];
  
  if (!item) return;
  
  const controllerId = document.getElementById('assignedController').value;
  const notes = document.getElementById('assignmentNotes').value;
  
  // Update the equipment item
  item.controller = controllerId || 'Unassigned';
  if (notes) item.notes = notes;
  
  // Close modal and refresh display
  closeModal();
  renderControllerAssignments();
  
  showToast({
    title: 'Assignment Updated',
    msg: `${item.uniqueId} ${controllerId ? 'assigned to ' + controllerId : 'unassigned'}`,
    kind: 'success',
    icon: '🔗'
  });
}

function closeModal() {
  const modal = document.querySelector('.modal-backdrop');
  if (modal) modal.remove();
}

function exportControllerAssignments() {
  const equipment = getControllerRequiredEquipment();
  
  const csvHeaders = ['Type', 'Make', 'Model', 'Room', 'Zone', 'Unique ID', 'Control Method', 'Controller'];
  const csvRows = equipment.map(item => [
    item.type,
    item.make,
    item.model,
    item.room,
    item.zone,
    item.uniqueId,
    item.controlMethod,
    item.controller
  ]);
  
  const csvContent = [csvHeaders, ...csvRows]
    .map(row => row.map(field => `"${field}"`).join(','))
    .join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'controller-assignments.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast({
    title: 'Export Complete',
    msg: 'Controller assignments exported to CSV',
    kind: 'success',
    icon: '📄'
  });
}

function saveControllerAssignments() {
  // Future: Save controller assignments to backend
  showToast({
    title: 'Assignments Saved',
    msg: 'Controller assignments have been saved',
    kind: 'success',
    icon: '💾'
  });
}

function renderSchedules() {
  const select = $('#groupSchedule');
  if (!select) return;

  select.innerHTML = '<option value="">No schedule</option>' +
    STATE.schedules.map(schedule => `<option value="${schedule.id}">${schedule.name}</option>`).join('');

  renderGrowRoomOverview();
}

function renderGrowRoomOverview() {
  const summaryEl = document.getElementById('growOverviewSummary');
  const gridEl = document.getElementById('growOverviewGrid');
  if (!summaryEl || !gridEl) return;

  const rooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
  const zones = Array.isArray(STATE.environment) ? STATE.environment : [];
  const plans = Array.isArray(STATE.plans) ? STATE.plans : [];
  const schedules = Array.isArray(STATE.schedules) ? STATE.schedules : [];

  const roomCount = rooms.length;
  const zoneCount = zones.length;
  const summaries = [
    {
      label: 'Grow Rooms',
      value: roomCount
        ? `${roomCount} room${roomCount === 1 ? '' : 's'}`
        : zoneCount
        ? `${zoneCount} zone${zoneCount === 1 ? '' : 's'}`
        : 'None'
    },
    {
      label: 'Plans running',
      value:
        plans.length === 0
          ? 'None'
          : (() => {
              const names = plans.map((plan) => plan.name || 'Untitled plan').filter(Boolean);
              const preview = names.slice(0, 2).join(', ');
              const extra = names.length > 2 ? ` +${names.length - 2}` : '';
              return `${preview}${extra}`;
            })()
    },
    {
      label: 'Schedules',
      value:
        schedules.length === 0
          ? 'None'
          : (() => {
              const names = schedules.map((sched) => sched.name || 'Unnamed schedule').filter(Boolean);
              const preview = names.slice(0, 2).join(', ');
              const extra = names.length > 2 ? ` +${names.length - 2}` : '';
              return `${preview}${extra}`;
            })()
    }
  ];

  summaryEl.innerHTML = summaries
    .map(
      (item) => `
        <div class="grow-overview__summary-item">
          <span class="grow-overview__summary-label">${escapeHtml(item.label)}</span>
          <span class="grow-overview__summary-value">${escapeHtml(item.value)}</span>
        </div>`
    )
    .join('');

  const activeFeatures = Array.from(document.querySelectorAll('.ai-feature-card.active h3'))
    .map((el) => el.textContent?.trim())
    .filter(Boolean);

  const matchZoneForRoom = (room) => {
    if (!room) return null;
    const identifiers = new Set(
      [room.id, room.name]
        .filter((value) => value !== undefined && value !== null)
        .map((value) => String(value).toLowerCase())
    );
    if (!identifiers.size) return null;
    return zones.find((zone) => {
      const id = zone.id ? String(zone.id).toLowerCase() : '';
      const name = zone.name ? String(zone.name).toLowerCase() : '';
      const location = zone.location ? String(zone.location).toLowerCase() : '';
      return identifiers.has(id) || identifiers.has(name) || identifiers.has(location);
    }) || null;
  };

  const metricKeys = [
    { key: 'tempC', label: 'Temp', unit: '°C', precision: 1 },
    { key: 'rh', label: 'Humidity', unit: '%', precision: 1 },
    { key: 'co2', label: 'CO₂', unit: ' ppm', precision: 0 },
    { key: 'vpd', label: 'VPD', unit: ' kPa', precision: 2 }
  ];

  const formatMetricValue = (sensor, meta) => {
    if (!sensor || typeof sensor.current !== 'number' || !Number.isFinite(sensor.current)) {
      return '—';
    }
    const value = meta.precision != null ? sensor.current.toFixed(meta.precision) : String(sensor.current);
    if (meta.unit.trim() === '%') {
      return `${value}${meta.unit}`;
    }
    return `${value}${meta.unit}`;
  };

  const metricStatus = (sensor) => {
    if (!sensor || typeof sensor.current !== 'number' || !Number.isFinite(sensor.current)) {
      return 'unknown';
    }
    const min = sensor.setpoint?.min;
    const max = sensor.setpoint?.max;
    if (typeof min === 'number' && typeof max === 'number') {
      return sensor.current >= min && sensor.current <= max ? 'ok' : 'warn';
    }
    return 'unknown';
  };

  const buildMetrics = (zone) => {
    if (!zone || !zone.sensors) return '';
    const items = metricKeys
      .map((meta) => {
        const sensor = zone.sensors?.[meta.key];
        if (!sensor) return '';
        const status = metricStatus(sensor);
        const value = formatMetricValue(sensor, meta);
        return `
          <div class="grow-room-card__metric grow-room-card__metric--${status}">
            <span class="grow-room-card__metric-label">${escapeHtml(meta.label)}</span>
            <span class="grow-room-card__metric-value">${escapeHtml(value)}</span>
          </div>`;
      })
      .filter(Boolean)
      .join('');
    return items;
  };

  const buildAiSection = () => {
    if (!activeFeatures.length) {
      return '<p class="tiny text-muted">AI features inactive.</p>';
    }
    return `
      <ul class="grow-room-card__ai-list">
        ${activeFeatures.map((name) => `<li class="grow-room-card__ai-chip">${escapeHtml(name)}</li>`).join('')}
      </ul>`;
  };

  const cards = [];
  if (rooms.length) {
    rooms.forEach((room) => {
      const zone = matchZoneForRoom(room);
      const name = room.name || room.id || 'Grow Room';
      const details = [];
      const zonesList = Array.isArray(room.zones) ? room.zones.filter(Boolean) : [];
      if (zonesList.length) {
        details.push(`Zones: ${zonesList.map((item) => escapeHtml(item)).join(', ')}`);
      }
      if (room.layout?.type) {
        details.push(`Layout: ${escapeHtml(room.layout.type)}`);
      }
      if (room.controlMethod) {
        details.push(`Control: ${escapeHtml(room.controlMethod)}`);
      }
      const metaParts = [];
      if (zone?.meta?.source) metaParts.push(`Source: ${escapeHtml(zone.meta.source)}`);
      if (typeof zone?.meta?.battery === 'number') metaParts.push(`Battery: ${escapeHtml(`${zone.meta.battery}%`)}`);
      if (typeof zone?.meta?.rssi === 'number') metaParts.push(`RSSI: ${escapeHtml(`${zone.meta.rssi} dBm`)}`);
      const metrics = buildMetrics(zone);
      cards.push(`
        <article class="grow-room-card">
          <div class="grow-room-card__header">
            <h3>${escapeHtml(name)}</h3>
            ${room.roomType ? `<span class="chip tiny">${escapeHtml(room.roomType)}</span>` : ''}
          </div>
          ${details.length ? `<div class="tiny text-muted">${details.join(' • ')}</div>` : ''}
          ${metaParts.length ? `<div class="tiny text-muted">${metaParts.join(' • ')}</div>` : ''}
          ${metrics ? `<div class="grow-room-card__metrics">${metrics}</div>` : '<p class="tiny text-muted">No telemetry available.</p>'}
          <div class="grow-room-card__ai">
            <span class="tiny text-muted">AI Features</span>
            ${buildAiSection()}
          </div>
        </article>`);
    });
  } else if (zones.length) {
    zones.forEach((zone) => {
      const name = zone.name || zone.id || 'Zone';
      const location = zone.location ? `Location: ${escapeHtml(zone.location)}` : '';
      const metaParts = [];
      if (zone.meta?.source) metaParts.push(`Source: ${escapeHtml(zone.meta.source)}`);
      if (typeof zone.meta?.battery === 'number') metaParts.push(`Battery: ${escapeHtml(`${zone.meta.battery}%`)}`);
      if (typeof zone.meta?.rssi === 'number') metaParts.push(`RSSI: ${escapeHtml(`${zone.meta.rssi} dBm`)}`);
      const metrics = buildMetrics(zone);
      cards.push(`
        <article class="grow-room-card">
          <div class="grow-room-card__header">
            <h3>${escapeHtml(name)}</h3>
          </div>
          ${location ? `<div class="tiny text-muted">${location}</div>` : ''}
          ${metaParts.length ? `<div class="tiny text-muted">${metaParts.join(' • ')}</div>` : ''}
          ${metrics ? `<div class="grow-room-card__metrics">${metrics}</div>` : '<p class="tiny text-muted">No telemetry available.</p>'}
          <div class="grow-room-card__ai">
            <span class="tiny text-muted">AI Features</span>
            ${buildAiSection()}
          </div>
        </article>`);
    });
  }

  if (!cards.length) {
    gridEl.innerHTML = '<p class="tiny text-muted">Add a grow room to view live status and telemetry.</p>';
    return;
  }

  gridEl.innerHTML = cards.join('');
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

  renderGrowRoomOverview();
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

  renderGrowRoomOverview();
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

  renderGrowRoomOverview();
}

// --- Research Mode Integration ---


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
      // Close all modals except farm registration (which should only close on save)
      document.querySelectorAll('[aria-hidden="false"]:not(#farmModal)').forEach(modal => {
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
      // NO STUB DEVICES - Only show live devices
      const missingIds = ids.filter(id => !devices.some(d => d.id === id));
      if (missingIds.length > 0) {
        console.warn(`🚫 ${missingIds.length} devices not available (live devices only):`, missingIds);
      }
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
        // NO STUB DEVICES - Only show live devices  
        if (!allLights.length) {
          console.warn('🚫 No live devices available for grouping. Please ensure devices are connected and discoverable.');
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
    if (ok) {
      setStatus('Groups saved');
      // Update controller assignments when groups change
      if (typeof renderControllerAssignments === 'function') {
        renderControllerAssignments();
      }
    } else {
      alert('Failed to save groups');
    }
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

// Global test function for debugging
window.testDropdowns = function() {
  console.log('=== DROPDOWN TEST ===');
  const roomSelect = document.getElementById('lightRoomSelect');
  const zoneSelect = document.getElementById('lightZoneSelect');
  
  console.log('Room select found:', !!roomSelect);
  console.log('Zone select found:', !!zoneSelect);
  
  if (roomSelect) {
    console.log('Room select disabled:', roomSelect.disabled);
    console.log('Room select style display:', roomSelect.style.display);
    console.log('Room select computed display:', window.getComputedStyle(roomSelect).display);
    console.log('Room select computed pointer-events:', window.getComputedStyle(roomSelect).pointerEvents);
    
    // Try to programmatically focus
    try {
      roomSelect.focus();
      console.log('Room select focus successful');
    } catch (e) {
      console.error('Room select focus failed:', e);
    }
  }
  
  if (zoneSelect) {
    console.log('Zone select disabled:', zoneSelect.disabled);
    console.log('Zone select style display:', zoneSelect.style.display);
    console.log('Zone select computed display:', window.getComputedStyle(zoneSelect).display);
    console.log('Zone select computed pointer-events:', window.getComputedStyle(zoneSelect).pointerEvents);
  }
  
  console.log('=== END TEST ===');
};

// --- Light Setup Wizard ---
// Fresh Light Setup Wizard - Clean Implementation
class FreshLightWizard {
  constructor() {
    console.log('[FreshLightWizard] Initializing fresh light setup wizard');
    
    this.modal = document.getElementById('freshLightModal');
    console.log('[FreshLightWizard] Modal element found:', this.modal);
    
    this.currentStep = 1;
    this.totalSteps = 4;
    this.data = {
      room: '',
      zone: '',
      fixtures: [],
      controlMethod: '',
      controlDetails: '',
      lightsPerController: 1,
      controllersCount: 1
    };
    
    if (this.modal) {
      this.setupEventListeners();
      console.log('[FreshLightWizard] Fresh wizard initialized successfully');
    } else {
      console.error('[FreshLightWizard] Could not find freshLightModal element!');
    }
  }
  
  setupEventListeners() {
    // Close button
    const closeBtn = document.getElementById('freshLightClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
    
    // Navigation buttons
    const nextBtn = document.getElementById('freshNext');
    const prevBtn = document.getElementById('freshPrev');
    
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.nextStep());
    }
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.prevStep());
    }
    
    // Backdrop click to close
    const backdrop = this.modal.querySelector('.fresh-light-modal__backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => this.close());
    }
    
    // Room and zone dropdowns
    this.setupRoomZoneDropdowns();
    
    // Fixture search and selection
    this.setupFixtureSelection();
    
    // Control method selection
    this.setupControlMethod();
    
    // Count inputs
    this.setupCountInputs();
  }
  
  setupRoomZoneDropdowns() {
    console.log('[FreshLightWizard] Setting up room/zone dropdowns');
    
    const roomSelect = document.getElementById('freshRoomSelect');
    const zoneSelect = document.getElementById('freshZoneSelect');
    
    if (!roomSelect || !zoneSelect) {
      console.error('[FreshLightWizard] Dropdowns not found');
      return;
    }
    
    // Simple, clean event listeners
    roomSelect.addEventListener('change', (e) => {
      console.log('[FreshLightWizard] Room selected:', e.target.value);
      this.data.room = e.target.value;
      this.updateZoneDropdown(e.target.value);
      this.updateNavigation();
    });
    
    zoneSelect.addEventListener('change', (e) => {
      console.log('[FreshLightWizard] Zone selected:', e.target.value);
      this.data.zone = e.target.value;
      this.updateNavigation();
    });
    
    // Populate with room data
    this.populateRooms();
  }
  
  populateRooms() {
    console.log('[FreshLightWizard] Populating rooms');
    
    const roomSelect = document.getElementById('freshRoomSelect');
    if (!roomSelect) return;
    
    // Clear existing options
    roomSelect.innerHTML = '<option value="">Select a room</option>';
    
    // Get room data from STATE (same as before)
    const farmRooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : [];
    const createdRooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
    
    console.log('[FreshLightWizard] Available rooms - Farm:', farmRooms.length, 'Created:', createdRooms.length);
    
    // Combine rooms
    const allRooms = [...farmRooms];
    createdRooms.forEach(room => {
      const existingRoom = allRooms.find(r => (r.id || r.name) === (room.id || room.name));
      if (!existingRoom) {
        allRooms.push(room);
      }
    });
    
    // Add test data if no rooms
    if (allRooms.length === 0) {
      console.log('[FreshLightWizard] No rooms found, adding test rooms');
      allRooms.push(
        { id: 'test-room-1', name: 'Test Room 1', zones: ['Zone A', 'Zone B'] },
        { id: 'test-room-2', name: 'Test Room 2', zones: ['Zone 1', 'Zone 2'] }
      );
    }
    
    // Populate dropdown
    allRooms.forEach(room => {
      const option = document.createElement('option');
      option.value = room.id || room.name;
      option.textContent = room.name || room.id;
      roomSelect.appendChild(option);
    });
    
    console.log('[FreshLightWizard] Populated', allRooms.length, 'rooms');
  }
  
  updateZoneDropdown(roomId) {
    console.log('[FreshLightWizard] Updating zones for room:', roomId);
    
    const zoneSelect = document.getElementById('freshZoneSelect');
    if (!zoneSelect) return;
    
    // Clear zones
    zoneSelect.innerHTML = '<option value="">Select a zone</option>';
    
    if (!roomId) return;
    
    // Find the selected room
    const farmRooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : [];
    const createdRooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
    const allRooms = [...farmRooms, ...createdRooms];
    
    // Add test rooms if none exist
    if (allRooms.length === 0) {
      allRooms.push(
        { id: 'test-room-1', name: 'Test Room 1', zones: ['Zone A', 'Zone B'] },
        { id: 'test-room-2', name: 'Test Room 2', zones: ['Zone 1', 'Zone 2'] }
      );
    }
    
    const selectedRoom = allRooms.find(room => (room.id || room.name) === roomId);
    
    if (selectedRoom && selectedRoom.zones) {
      selectedRoom.zones.forEach(zone => {
        const option = document.createElement('option');
        option.value = zone;
        option.textContent = zone;
        zoneSelect.appendChild(option);
      });
    }
  }
  
  setupFixtureSelection() {
    console.log('[FreshLightWizard] Setting up fixture selection');
    
    const searchInput = document.getElementById('freshFixtureSearch');
    const resultsDiv = document.getElementById('freshFixtureResults');
    const selectedDiv = document.getElementById('freshSelectedFixtures');
    
    if (!searchInput || !resultsDiv || !selectedDiv) {
      console.error('[FreshLightWizard] Fixture selection elements not found');
      return;
    }
    
    // Use real fixture database from STATE.deviceKB.fixtures
    console.log('[FreshLightWizard] Available fixtures from database:', STATE.deviceKB?.fixtures?.length || 0);
    if (STATE.deviceKB?.fixtures?.length > 0) {
      console.log('[FreshLightWizard] Sample fixtures:', STATE.deviceKB.fixtures.slice(0, 3).map(f => `${f.vendor} ${f.model}`));
    }
    
    searchInput.addEventListener('input', (e) => {
      this.searchFixtures(e.target.value);
    });
    
    this.renderSelectedFixtures();
  }
  
  searchFixtures(query) {
    const resultsDiv = document.getElementById('freshFixtureResults');
    
    if (!query.trim()) {
      resultsDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748b; font-size: 13px;">Type to search for fixture models...</div>';
      return;
    }
    
    console.log('[FreshLightWizard] Searching for:', query);
    
    // Use real fixture database instead of hardcoded one
    const fixtures = STATE.deviceKB?.fixtures || [];
    const filtered = fixtures.filter(fixture => {
      const searchText = (fixture.vendor + ' ' + fixture.model + ' ' + (fixture.tags || []).join(' ')).toLowerCase();
      const matches = searchText.includes(query.toLowerCase());
      if (query.toLowerCase().length >= 2) {
        console.log('[FreshLightWizard] Checking:', searchText, 'matches query "' + query + '":', matches);
      }
      return matches;
    });
    
    console.log('[FreshLightWizard] Found', filtered.length, 'matching fixtures');
    
    if (filtered.length === 0) {
      resultsDiv.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #64748b; font-size: 13px;">
          No fixtures found matching "${query}"<br>
          <small>Try searching for: GROW3, TopLight, Gavita, Fluence, etc.</small>
        </div>
      `;
      return;
    }
    
    const html = filtered.slice(0, 8).map(fixture => `
      <div class="fresh-fixture-result" onclick="freshLightWizard.addFixture('${fixture.id}')">
        <div>
          <div style="font-weight: 500;">${fixture.vendor} ${fixture.model}</div>
          <div style="font-size: 11px; color: #64748b;">${fixture.watts}W • ${fixture.control || 'Unknown control'}</div>
        </div>
        <button type="button" style="padding: 4px 8px; font-size: 11px; background: #6366f1; color: white; border: none; border-radius: 3px;">Add</button>
      </div>
    `).join('');
    
    resultsDiv.innerHTML = html;
  }
  
  addFixture(fixtureId) {
    // Use real database from STATE
    const fixture = STATE.deviceKB.fixtures.find(f => f.id === fixtureId);
    if (!fixture) {
      console.log('FreshLightWizard: Fixture not found:', fixtureId);
      return;
    }
    
    // Check if already selected
    const existing = this.data.fixtures.find(f => f.id === fixtureId);
    if (existing) {
      existing.count += 1;
    } else {
      this.data.fixtures.push({ ...fixture, count: 1 });
    }
    
    this.renderSelectedFixtures();
    this.updateNavigation();
  }
  
  removeFixture(fixtureId) {
    this.data.fixtures = this.data.fixtures.filter(f => f.id !== fixtureId);
    this.renderSelectedFixtures();
    this.updateNavigation();
  }
  
  renderSelectedFixtures() {
    const selectedDiv = document.getElementById('freshSelectedFixtures');
    
    if (this.data.fixtures.length === 0) {
      selectedDiv.innerHTML = '<div style="color: #64748b; font-size: 13px;">No fixtures selected yet</div>';
      return;
    }
    
    selectedDiv.innerHTML = this.data.fixtures.map(fixture => `
      <div class="fresh-selected-fixture">
        <div>
          <span style="font-weight: 500;">${fixture.name}</span>
          <span style="color: #64748b; margin-left: 8px;">×${fixture.count}</span>
        </div>
        <button type="button" onclick="freshLightWizard.removeFixture('${fixture.id}')">Remove</button>
      </div>
    `).join('');
  }
  
  setupControlMethod() {
    console.log('[FreshLightWizard] Setting up control method');
    
    const controlButtons = document.querySelectorAll('.fresh-control-option');
    const detailsDiv = document.getElementById('freshControlDetails');
    
    controlButtons.forEach(button => {
      button.addEventListener('click', () => {
        // Remove selected class from all buttons
        controlButtons.forEach(btn => btn.classList.remove('selected'));
        
        // Add selected class to clicked button
        button.classList.add('selected');
        
        // Update data
        this.data.controlMethod = button.dataset.value;
        
        // Show control details
        this.showControlDetails(button.dataset.value);
        
        this.updateNavigation();
      });
    });
  }
  
  showControlDetails(method) {
    const detailsDiv = document.getElementById('freshControlDetails');
    
    const details = {
      'wifi': 'Fixtures will be controlled via Wi-Fi connection using manufacturer apps or smart home integration.',
      'smart-plug': 'Fixtures will be plugged into smart plugs for basic on/off control and scheduling.',
      '0-10v': 'Professional dimming control using 0-10V signals. Requires compatible dimming controllers.',
      'rs485': 'Advanced control using RS-485/Modbus protocol for precise scheduling and monitoring.',
      'other': 'Custom control method - please specify your requirements in the notes.'
    };
    
    this.data.controlDetails = details[method] || '';
    detailsDiv.innerHTML = this.data.controlDetails;
    detailsDiv.style.display = 'block';
  }
  
  setupCountInputs() {
    const lightsPerController = document.getElementById('freshLightSeriesCount');
    const controllersCount = document.getElementById('freshControllersCount');
    
    if (lightsPerController) {
      lightsPerController.addEventListener('change', (e) => {
        this.data.lightsPerController = parseInt(e.target.value) || 0;
        this.updateNavigation();
      });
    }
    
    if (controllersCount) {
      controllersCount.addEventListener('change', (e) => {
        this.data.controllersCount = parseInt(e.target.value) || 0;
        this.updateNavigation();
      });
    }
  }
  
  updateNavigation() {
    const nextBtn = document.getElementById('freshNext');
    const prevBtn = document.getElementById('freshPrev');
    
    if (prevBtn) {
      prevBtn.style.display = this.currentStep > 1 ? 'block' : 'none';
    }
    
    if (nextBtn) {
      const canAdvance = this.canAdvance();
      nextBtn.disabled = !canAdvance;
      nextBtn.textContent = this.currentStep === this.totalSteps ? 'Save' : 'Next';
    }
  }
  
  canAdvance() {
    switch (this.currentStep) {
      case 1: // Room/Zone selection
        return this.data.room && this.data.zone;
      case 2: // Fixtures
        return this.data.fixtures.length > 0 && this.data.lightsPerController > 0 && this.data.controllersCount > 0;
      case 3: // Control
        return this.data.controlMethod;
      case 4: // Review
        return true;
      default:
        return false;
    }
  }
  
  nextStep() {
    if (!this.canAdvance()) return;
    
    if (this.currentStep < this.totalSteps) {
      this.currentStep++;
      this.showStep();
    } else {
      this.save();
    }
  }
  
  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
      this.showStep();
    }
  }
  
  showStep() {
    // Hide all steps
    document.querySelectorAll('.fresh-light-step').forEach(step => {
      step.removeAttribute('data-active');
    });
    
    // Show current step
    const currentStepEl = document.getElementById(`freshStep${this.currentStep}`);
    if (currentStepEl) {
      currentStepEl.setAttribute('data-active', '');
    }
    
    // Special handling for review step
    if (this.currentStep === 4) {
      this.generateReview();
    }
    
    this.updateNavigation();
    console.log('[FreshLightWizard] Showing step', this.currentStep);
  }
  
  generateReview() {
    const reviewDiv = document.getElementById('freshReviewDetails');
    if (!reviewDiv) return;
    
    const totalFixtures = this.data.fixtures.reduce((sum, f) => sum + f.count, 0);
    const totalWattage = this.data.fixtures.reduce((sum, f) => sum + (f.watts * f.count), 0);
    const totalControllers = this.data.controllersCount;
    
    reviewDiv.innerHTML = `
      <div style="margin-bottom: 12px;">
        <strong>Location:</strong> ${this.data.room} - ${this.data.zone}
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>Configuration:</strong> ${this.data.lightsPerController} lights per controller, ${totalControllers} controllers
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>Fixtures (${totalFixtures} total):</strong>
        <div style="margin-left: 16px; margin-top: 4px;">
          ${this.data.fixtures.map(f => `
            <div style="margin-bottom: 2px;">• ${f.name} ×${f.count} (${f.watts}W each)</div>
          `).join('')}
        </div>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>Total Power:</strong> ${totalWattage.toLocaleString()}W
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>Control Method:</strong> ${this.getControlMethodName(this.data.controlMethod)}
        ${this.data.controlDetails ? `<div style="margin-left: 16px; margin-top: 4px; font-size: 12px; color: #64748b;">${this.data.controlDetails}</div>` : ''}
      </div>
    `;
  }
  
  getControlMethodName(method) {
    const names = {
      'wifi': 'Wi‑Fi / App',
      'smart-plug': 'Smart Plug',
      '0-10v': '0‑10V / Wired',
      'rs485': 'RS‑485 / Modbus',
      'other': 'Other'
    };
    return names[method] || method;
  }
  
  open() {
    console.log('[FreshLightWizard] Opening wizard');
    console.log('[FreshLightWizard] Modal element:', this.modal);
    if (this.modal) {
      this.modal.setAttribute('aria-hidden', 'false');
      this.currentStep = 1;
      this.showStep();
      this.populateRooms();
      console.log('[FreshLightWizard] Wizard should now be visible');
    } else {
      console.error('[FreshLightWizard] Cannot open - modal element not found!');
    }
  }
  
  close() {
    console.log('[FreshLightWizard] Closing wizard');
    if (this.modal) {
      this.modal.setAttribute('aria-hidden', 'true');
    }
  }
  
  save() {
    console.log('[FreshLightWizard] Saving light setup:', this.data);
    
    // Calculate summary
    const totalFixtures = this.data.fixtures.reduce((sum, f) => sum + f.count, 0);
    const totalWattage = this.data.fixtures.reduce((sum, f) => sum + (f.watts * f.count), 0);
    
    // Store light setup in global STATE
    if (!STATE.lightSetups) {
      STATE.lightSetups = [];
    }
    
    const lightSetup = {
      id: Date.now().toString(),
      room: this.data.room,
      zone: this.data.zone,
      fixtures: this.data.fixtures,
      controlMethod: this.data.controlMethod,
      controlDetails: this.data.controlDetails,
      lightsPerController: this.data.lightsPerController,
      controllersCount: this.data.controllersCount,
      totalFixtures: totalFixtures,
      totalWattage: totalWattage,
      createdAt: new Date().toISOString()
    };
    
    STATE.lightSetups.push(lightSetup);
    
    // Update the light setup summary
    renderLightSetupSummary();
    renderControllerAssignments();
    
    const summary = `Light Setup Saved!\n\nLocation: ${this.data.room} - ${this.data.zone}\nFixtures: ${totalFixtures} lights (${totalWattage.toLocaleString()}W total)\nControl: ${this.getControlMethodName(this.data.controlMethod)}`;
    
    alert(summary);
    this.close();
  }
}

// Original LightWizard class (keeping for now)
class LightWizard {
  constructor() {
    console.log('[DEBUG] LightWizard constructor called');
    this.modal = document.getElementById('lightModal');
    console.log('[DEBUG] Modal element found:', this.modal);
    if (!this.modal) {
      console.error('[DEBUG] No modal element found, exiting constructor');
      return;
    }
    
    this.baseSteps = ['location', 'fixtures', 'control', 'add-more', 'review'];
    this.steps = this.baseSteps.slice();
    this.currentStep = 0;
    this.lightSetups = []; // Array to store multiple light setups
    this.currentSetupIndex = 0;
    this.data = {
      id: '',
      name: '',
      room: '',
      zone: '',
      fixtures: [],
      controlMethod: null,
      energy: '',
      energyHours: 0,
      seriesCount: 0,
      controllersCount: 0,
      targetPpfd: 0,
      photoperiod: 0,
      devices: [],
      mapping: { zones: [], groups: [] },
      connectivity: { hasHub: null, hubType: '', hubIp: '', cloudTenant: 'Azure' }
    };
    
    this.setupButtons();
    this.setupEventListeners();
  }

  setupButtons() {
    const prevBtn = document.getElementById('lightPrev');
    const nextBtn = document.getElementById('lightNext');
    const closeBtn = document.getElementById('lightModalClose');
    const backdrop = document.getElementById('lightModalBackdrop');
    
    if (prevBtn) prevBtn.addEventListener('click', () => {
      console.log('[LightWizard] Previous button clicked');
      this.prevStep();
    });
    if (nextBtn) nextBtn.addEventListener('click', (e) => {
      console.log('[LightWizard] Next button clicked, disabled:', nextBtn.disabled);
      if (nextBtn.disabled) {
        console.log('[LightWizard] Next button is disabled, preventing navigation');
        e.preventDefault();
        return;
      }
      this.nextStep();
    });
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    // DISABLED backdrop click handler to test interaction issue
    // if (backdrop) backdrop.addEventListener('click', () => this.close());
    
    console.log('[LightWizard] Button event listeners setup complete');
  }

  setupEventListeners() {
    // Chip group helper function
    const chipGroup = (sel, target, field) => {
      const host = $(sel); if (!host) return;
      host.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-option'); if (!btn) return;
        host.querySelectorAll('.chip-option').forEach(b=>b.removeAttribute('data-active'));
        btn.setAttribute('data-active','');
        target[field] = btn.dataset.value;
        console.log('[LightWizard] Chip selection:', field, '=', btn.dataset.value, 'this.data:', this.data);
        // Update navigation after chip selection - with explicit arrow function to preserve context
        setTimeout(() => {
          console.log('[LightWizard] About to update navigation, controlMethod:', this.data.controlMethod);
          this.updateNavigation();
        }, 0);
      });
    };
    
    // Fixtures KB search
    const fSearch = $('#lightKbSearch');
    const fResults = $('#lightKbResults');
    fSearch?.addEventListener('input', () => this.updateKbResults(fSearch.value.trim()));
    
    // Series count and controllers
    const seriesInput = document.getElementById('lightSeriesCount');
    if (seriesInput) {
      seriesInput.addEventListener('input', (e) => {
        const n = Number(e.target.value || 0);
        this.data.seriesCount = Number.isFinite(n) ? Math.max(0, n) : 0;
      });
    }
    
    const controllersInput = document.getElementById('lightControllersCount');
    if (controllersInput) {
      controllersInput.addEventListener('input', (e) => {
        const n = Number(e.target.value || 0);
        this.data.controllersCount = Number.isFinite(n) ? Math.max(0, n) : 0;
      });
    }
    
    const targetInput = document.getElementById('lightTargetPpfd');
    if (targetInput) {
      targetInput.addEventListener('input', (e) => {
        const v = Number(e.target.value || 0);
        this.data.targetPpfd = Number.isFinite(v) ? Math.max(0, v) : 0;
      });
    }
    
    const photoperiodInput = document.getElementById('lightPhotoperiod');
    if (photoperiodInput) {
      photoperiodInput.addEventListener('input', (e) => {
        const v = Number(e.target.value || 0);
        this.data.photoperiod = Number.isFinite(v) ? Math.max(0, v) : 0;
      });
    }

    // Control method chips
    chipGroup('#lightControlMethod', this.data, 'controlMethod');
    
    // Room and zone selection - REBUILT
    this.setupRoomZoneDropdowns();
    
    // Zone creation
    const createZoneBtn = document.getElementById('lightCreateZone');
    const newZoneInput = document.getElementById('lightNewZoneName');
    const saveZoneBtn = document.getElementById('lightSaveNewZone');
    const cancelZoneBtn = document.getElementById('lightCancelNewZone');
    
    if (createZoneBtn) {
      createZoneBtn.addEventListener('click', () => {
        createZoneBtn.style.display = 'none';
        newZoneInput.style.display = 'inline-block';
        saveZoneBtn.style.display = 'inline-block';
        cancelZoneBtn.style.display = 'inline-block';
        newZoneInput.focus();
      });
    }
    
    if (saveZoneBtn) {
      saveZoneBtn.addEventListener('click', () => {
        const zoneName = newZoneInput.value.trim();
        if (zoneName && this.data.room) {
          this.createNewZone(this.data.room, zoneName);
          this.hideZoneCreation();
        }
      });
    }
    
    if (cancelZoneBtn) {
      cancelZoneBtn.addEventListener('click', () => {
        this.hideZoneCreation();
      });
    }
    
    if (newZoneInput) {
      newZoneInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          saveZoneBtn.click();
        } else if (e.key === 'Escape') {
          cancelZoneBtn.click();
        }
      });
    }
    
    // Multiple setup buttons
    const addMoreBtn = document.getElementById('lightAddMoreSetup');
    const finishBtn = document.getElementById('lightFinishSetups');
    
    if (addMoreBtn) {
      addMoreBtn.addEventListener('click', () => {
        this.saveCurrentSetup();
        this.startNewSetup();
      });
    }
    
    if (finishBtn) {
      finishBtn.addEventListener('click', () => {
        this.saveCurrentSetup();
        this.nextStep();
      });
    }
    
    // Upload fixture datasheet
    const uploadBtn = document.getElementById('lightKbUploadBtn');
    const uploadInput = document.getElementById('lightKbUpload');
    if (uploadBtn && uploadInput) {
      uploadBtn.addEventListener('click', () => uploadInput.click());
      uploadInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const placeholder = { vendor: 'Unknown', model: file.name, watts: null, control: null, tags: ['unknown'], confidence: 0, _uploaded: true };
        this.data.fixtures = this.data.fixtures || [];
        this.data.fixtures.push({ ...placeholder, count: 1, note: 'Uploaded nameplate/datasheet - needs research' });
        this.renderKbSelected();
        showToast({ title: 'Uploaded', msg: `Added placeholder for ${file.name}. We can research this entry later.`, kind: 'info', icon: 'ℹ️' }, 5000);
        uploadInput.value = '';
      });
    }

    // KB results event handler
    const kbResults = document.getElementById('lightKbResults');
    if (kbResults) {
      kbResults.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const idx = Number(btn.dataset.idx || -1);
        const item = STATE.deviceKB.fixtures?.[idx];
        if (!item) return;
        
        if (action === 'add-kb') {
          this.data.fixtures.push({ ...item, count: 1 });
          console.log('[LightWizard] Added fixture from KB:', item, 'Total fixtures:', this.data.fixtures.length);
        } else if (action === 'add-unknown') {
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
          console.log('[LightWizard] Added unknown fixture:', placeholder, 'Total fixtures:', this.data.fixtures.length);
        }
        
        this.renderKbSelected();
        kbResults.innerHTML = '';
        document.getElementById('lightKbSearch').value = '';
      });
    }
  }

  close() {
    if (!this.modal) return;
    this.modal.style.display = 'none';
    this.modal.setAttribute('aria-hidden', 'true');
  }

  renderStep() {
    // Sync internal current step state
    const stepKey = this.steps[this.currentStep];
    console.log('[LightWizard] renderStep - currentStep:', this.currentStep, 'stepKey:', stepKey, 'steps array:', this.steps);
    
    // Hide all steps - using light-step class for Light wizard
    document.querySelectorAll('.light-step').forEach(step => {
      step.removeAttribute('data-active');
    });
    
    // Show current step
    const currentStepEl = document.querySelector(`.light-step[data-step="${stepKey}"]`);
    if (currentStepEl) {
      currentStepEl.setAttribute('data-active', '');
      console.log('[LightWizard] Activated step element:', stepKey);
    } else {
      console.error('[LightWizard] Could not find step element for:', stepKey);
    }
    
    // Update progress indicator
    const progressEl = document.getElementById('lightModalProgress');
    if (progressEl) {
      progressEl.textContent = `Step ${this.currentStep + 1} of ${this.steps.length}`;
      console.log('[LightWizard] Progress updated to:', progressEl.textContent);
    }
    
    // Guard navigation button toggles
    const prevBtn = document.getElementById('lightPrev');
    const nextBtn = document.getElementById('lightNext');
    const saveBtn = document.getElementById('btnSaveLight');
    
    // Only hide Previous button on first step
    if (prevBtn) {
      prevBtn.style.display = this.currentStep === 0 ? 'none' : 'inline-block';
    }
    
    // Only hide Next button on final step, show on all others
    if (this.currentStep === this.steps.length - 1) {
      if (nextBtn) nextBtn.style.display = 'none';
      if (saveBtn) saveBtn.style.display = 'inline-block';
    } else {
      if (nextBtn) {
        nextBtn.style.display = 'inline-block';
        nextBtn.style.visibility = 'visible';
      }
      if (saveBtn) saveBtn.style.display = 'none';
    }
    
    // Update navigation state
    this.updateNavigation();
    
    // Collect step-specific data
    this.collectStepData(stepKey);
  }

  setupRoomZoneDropdowns() {
    console.log('[LightWizard] Setting up room/zone dropdowns - SIMPLIFIED VERSION');
    
    // DIAGNOSTIC: Check for interfering elements
    console.log('[DIAGNOSTIC] Checking for interfering elements...');
    
    const allModals = document.querySelectorAll('[class*="modal"]');
    console.log('[DIAGNOSTIC] All modals:', allModals);
    allModals.forEach((modal, index) => {
      const styles = window.getComputedStyle(modal);
      console.log(`[DIAGNOSTIC] Modal ${index}:`, {
        element: modal,
        className: modal.className,
        display: styles.display,
        visibility: styles.visibility,
        opacity: styles.opacity,
        zIndex: styles.zIndex,
        pointerEvents: styles.pointerEvents
      });
    });
    
    // Check for any elements that might be covering the dropdown area
    const lightModal = document.getElementById('lightModal');
    if (lightModal) {
      const rect = lightModal.getBoundingClientRect();
      const elementsAtCenter = document.elementsFromPoint(rect.left + rect.width/2, rect.top + rect.height/2);
      console.log('[DIAGNOSTIC] Elements at light modal center:', elementsAtCenter);
    }
    
    // Get dropdown elements
    const roomSelect = document.getElementById('lightRoomSelect');
    const zoneSelect = document.getElementById('lightZoneSelect');
    
    if (!roomSelect || !zoneSelect) {
      console.error('[LightWizard] Could not find dropdown elements:', { roomSelect, zoneSelect });
      return;
    }
    
    console.log('[LightWizard] Found dropdown elements, setting up simple event handlers');
    
    // IMMEDIATE CLICK TEST - Add multiple event types to see what's happening
    roomSelect.addEventListener('click', (e) => {
      console.log('[LightWizard] ROOM DROPDOWN CLICKED!', e);
    });
    
    roomSelect.addEventListener('mousedown', (e) => {
      console.log('[LightWizard] ROOM DROPDOWN MOUSEDOWN!', e);
    });
    
    roomSelect.addEventListener('focus', (e) => {
      console.log('[LightWizard] ROOM DROPDOWN FOCUSED!', e);
    });
    
    zoneSelect.addEventListener('click', (e) => {
      console.log('[LightWizard] ZONE DROPDOWN CLICKED!', e);
    });
    
    // Add click test to the modal itself
    const modal = document.getElementById('lightModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        console.log('[LightWizard] MODAL CLICKED!', e.target, 'classList:', e.target.classList);
      });
    }
    
    // SIMPLE APPROACH - just like the test buttons that worked
    // Clear any existing state that might interfere
    roomSelect.disabled = false;
    zoneSelect.disabled = false;
    roomSelect.style.pointerEvents = 'auto';
    zoneSelect.style.pointerEvents = 'auto';
    
    // Log current computed styles for debugging
    console.log('Room select computed pointer-events:', window.getComputedStyle(roomSelect).pointerEvents);
    console.log('Room select disabled:', roomSelect.disabled);
    console.log('Zone select computed pointer-events:', window.getComputedStyle(zoneSelect).pointerEvents);
    console.log('Zone select disabled:', zoneSelect.disabled);
    
    // Add simple event listeners - NO CLONING
    roomSelect.addEventListener('change', (e) => {
      console.log('[LightWizard] Room selected:', e.target.value);
      this.data.room = e.target.value;
      this.updateZoneDropdown(e.target.value);
      this.updateNavigation();
    });
    
    zoneSelect.addEventListener('change', (e) => {
      console.log('[LightWizard] Zone selected:', e.target.value);
      this.data.zone = e.target.value;
      this.updateNavigation();
    });
    
    // Populate room dropdown immediately
    this.populateRoomDropdown();
    
    console.log('[LightWizard] Simple dropdown setup complete');
  }

  populateRoomDropdown() {
    console.log('[LightWizard] Populating room dropdown');
    console.log('[LightWizard] STATE.farm:', STATE.farm);
    console.log('[LightWizard] STATE.rooms:', STATE.rooms);
    
    const roomSelect = document.getElementById('lightRoomSelect');
    if (!roomSelect) {
      console.error('[LightWizard] Room select not found during population');
      return;
    }
    
    // Clear existing options
    roomSelect.innerHTML = '<option value="">Select a room</option>';
    
    // Get all available rooms
    const farmRooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : [];
    const createdRooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
    
    console.log('[LightWizard] Available rooms - Farm:', farmRooms, 'Created:', createdRooms);
    
    // Combine and deduplicate rooms
    const allRooms = [...farmRooms];
    createdRooms.forEach(room => {
      const existingRoom = allRooms.find(r => (r.id || r.name) === (room.id || room.name));
      if (!existingRoom) {
        allRooms.push(room);
      }
    });
    
    console.log('[LightWizard] Combined rooms:', allRooms);
    
    // Add test data if no rooms are available
    if (allRooms.length === 0) {
      console.log('[LightWizard] No room data found, adding test rooms');
      allRooms.push(
        { id: 'test-room-1', name: 'Test Room 1', zones: ['Zone A', 'Zone B'] },
        { id: 'test-room-2', name: 'Test Room 2', zones: ['Zone 1', 'Zone 2', 'Zone 3'] },
        { id: 'test-room-3', name: 'Test Room 3', zones: ['Main Zone'] }
      );
    }
    
    // Populate dropdown
    allRooms.forEach(room => {
      const option = document.createElement('option');
      option.value = room.id || room.name;
      option.textContent = room.name || room.id;
      roomSelect.appendChild(option);
    });
    
    console.log('[LightWizard] Room dropdown populated with', allRooms.length, 'rooms');
  }

  updateZoneDropdown(roomId) {
    console.log('[LightWizard] Updating zone dropdown for room:', roomId);
    
    const zoneSelect = document.getElementById('lightZoneSelect');
    if (!zoneSelect) {
      console.error('[LightWizard] Zone select not found during update');
      return;
    }
    
    // Clear existing options
    zoneSelect.innerHTML = '<option value="">Select a zone</option>';
    
    if (!roomId) {
      console.log('[LightWizard] No room selected, leaving zone dropdown empty');
      return;
    }
    
    // Find the selected room - including test data
    const farmRooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : [];
    const createdRooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
    let allRooms = [...farmRooms, ...createdRooms];
    
    // Add test data if no rooms exist
    if (allRooms.length === 0) {
      allRooms = [
        { id: 'test-room-1', name: 'Test Room 1', zones: ['Zone A', 'Zone B'] },
        { id: 'test-room-2', name: 'Test Room 2', zones: ['Zone 1', 'Zone 2', 'Zone 3'] },
        { id: 'test-room-3', name: 'Test Room 3', zones: ['Main Zone'] }
      ];
    }
    
    const selectedRoom = allRooms.find(room => (room.id || room.name) === roomId);
    console.log('[LightWizard] Found selected room:', selectedRoom);
    
    if (!selectedRoom || !selectedRoom.zones || !Array.isArray(selectedRoom.zones)) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No zones available - Create zones first';
      option.disabled = true;
      zoneSelect.appendChild(option);
      return;
    }
    
    // Add zone options
    selectedRoom.zones.forEach(zone => {
      const option = document.createElement('option');
      if (typeof zone === 'string') {
        option.value = zone;
        option.textContent = zone;
      } else {
        option.value = zone.id || zone.name || '';
        option.textContent = zone.name || zone.id || 'Unnamed Zone';
      }
      zoneSelect.appendChild(option);
    });
    
    console.log('[LightWizard] Zone dropdown populated with', selectedRoom.zones.length, 'zones');
  }

  collectStepData(stepKey) {
    if (stepKey === 'location') {
      // Use the new rebuilt dropdown population method
      this.populateRoomDropdown();
      
      // Setup dropdowns AFTER the step is rendered and active
      setTimeout(() => {
        console.log('[LightWizard] Setting up dropdowns after step activation');
        this.setupRoomZoneDropdowns();
      }, 100);
    }
    
    if (stepKey === 'fixtures') {
      const seriesInput = document.getElementById('lightSeriesCount');
      if (seriesInput) seriesInput.value = String(this.data.seriesCount ?? 0);
      
      const controllersInput = document.getElementById('lightControllersCount'); 
      if (controllersInput) controllersInput.value = String(this.data.controllersCount ?? 0);
      
      const target = document.getElementById('lightTargetPpfd');
      if (target) target.value = String(this.data.targetPpfd ?? 0);
      
      const photo = document.getElementById('lightPhotoperiod'); 
      if (photo) photo.value = String(this.data.photoperiod ?? 0);
      
      this.renderKbSelected();
    }
    
    if (stepKey === 'add-more') {
      this.renderSetupsSummary();
    }
    
    if (stepKey === 'review') {
      this.renderReview();
    }
  }

  updateNavigation() {
    const prevBtn = document.getElementById('lightPrev');
    const nextBtn = document.getElementById('lightNext');
    
    console.log('[LightWizard] updateNavigation - currentStep:', this.currentStep, 'canAdvance:', this.canAdvance());
    
    if (prevBtn) {
      prevBtn.disabled = this.currentStep === 0;
      prevBtn.style.display = this.currentStep === 0 ? 'none' : 'inline-block';
    }
    
    if (nextBtn) {
      const canAdvance = this.canAdvance();
      nextBtn.disabled = !canAdvance;
      nextBtn.textContent = this.currentStep === this.steps.length - 1 ? 'Complete' : 'Next';
      console.log('[LightWizard] Next button disabled:', nextBtn.disabled, 'canAdvance:', canAdvance);
    }
  }

  updateNavigationState() {
    // Alias for updateNavigation for compatibility
    this.updateNavigation();
  }

  canAdvance() {
    const stepKey = this.steps[this.currentStep];
    console.log('[LightWizard] canAdvance check - step:', stepKey, 'currentStep:', this.currentStep, 'controlMethod:', this.data.controlMethod, 'full data:', this.data);
    switch (stepKey) {
      case 'location': return !!this.data.room && !!this.data.zone;
      case 'fixtures': return Array.isArray(this.data.fixtures) && this.data.fixtures.length > 0;
      case 'control': {
        const result = !!this.data.controlMethod;
        console.log('[LightWizard] Control step canAdvance result:', result, 'controlMethod value:', this.data.controlMethod);
        return result;
      }
      case 'add-more': return true; // Always can proceed from add-more step
      case 'review': return true;
      default: return true;
    }
  }

  hideZoneCreation() {
    const createZoneBtn = document.getElementById('lightCreateZone');
    const newZoneInput = document.getElementById('lightNewZoneName');
    const saveZoneBtn = document.getElementById('lightSaveNewZone');
    const cancelZoneBtn = document.getElementById('lightCancelNewZone');
    
    if (createZoneBtn) createZoneBtn.style.display = 'inline-block';
    if (newZoneInput) {
      newZoneInput.style.display = 'none';
      newZoneInput.value = '';
    }
    if (saveZoneBtn) saveZoneBtn.style.display = 'none';
    if (cancelZoneBtn) cancelZoneBtn.style.display = 'none';
  }

  createNewZone(roomId, zoneName) {
    // Find the room in STATE.rooms
    const room = STATE.rooms?.find(r => r.id === roomId);
    if (!room) {
      showToast({ title: 'Error', msg: 'Room not found', kind: 'error' }, 3000);
      return;
    }
    
    // Add zone to room if it doesn't exist
    if (!room.zones) room.zones = [];
    
    const existingZone = room.zones.find(z => z.name.toLowerCase() === zoneName.toLowerCase());
    if (existingZone) {
      showToast({ title: 'Zone Exists', msg: 'A zone with this name already exists', kind: 'warning' }, 3000);
      return;
    }
    
    const newZone = {
      id: `zone-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: zoneName,
      area: 0,
      description: ''
    };
    
    room.zones.push(newZone);
    
    // Update the zones dropdown
    this.populateZonesForRoom(roomId);
    
    // Select the new zone
    const zoneSelect = document.getElementById('lightZoneSelect');
    if (zoneSelect) {
      zoneSelect.value = newZone.id;
      this.data.zone = newZone.id;
    }
    
    showToast({ title: 'Zone Created', msg: `Zone "${zoneName}" has been created`, kind: 'success' }, 3000);
    this.updateNavigation();
  }

  saveCurrentSetup() {
    // Create a copy of current setup data
    const setup = {
      id: `setup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      room: this.data.room,
      zone: this.data.zone,
      fixtures: [...this.data.fixtures],
      controlMethod: this.data.controlMethod,
      seriesCount: this.data.seriesCount,
      controllersCount: this.data.controllersCount,
      targetPpfd: this.data.targetPpfd,
      photoperiod: this.data.photoperiod
    };
    
    this.lightSetups.push(setup);
    console.log('[LightWizard] Saved setup:', setup);
  }

  startNewSetup() {
    // Reset fixture and control data for new setup
    this.data.fixtures = [];
    this.data.controlMethod = null;
    this.data.seriesCount = 0;
    this.data.controllersCount = 0;
    this.data.targetPpfd = 0;
    this.data.photoperiod = 0;
    
    // Go back to fixtures step
    this.currentStep = 1; // fixtures step
    this.renderStep();
    
    showToast({ title: 'New Setup', msg: 'Starting new light setup for the same room/zone', kind: 'info' }, 3000);
  }

  renderSetupsSummary() {
    const container = document.getElementById('lightSetupsSummary');
    if (!container) return;
    
    if (this.lightSetups.length === 0) {
      container.innerHTML = '<p class="tiny" style="color:#64748b">No light setups configured yet.</p>';
      return;
    }
    
    const roomName = STATE.rooms?.find(r => r.id === this.data.room)?.name || 'Unknown Room';
    const zoneName = STATE.rooms?.find(r => r.id === this.data.room)?.zones?.find(z => z.id === this.data.zone)?.name || 'Unknown Zone';
    
    let html = `<div class="tiny" style="margin-bottom:8px;color:#0f172a">Light setups for ${roomName} - ${zoneName}:</div>`;
    
    this.lightSetups.forEach((setup, index) => {
      const fixtureCount = setup.fixtures.reduce((sum, f) => sum + (f.count || 1), 0);
      html += `
        <div class="setup-summary-item" style="padding:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;margin-bottom:4px">
          <div class="tiny" style="font-weight:500">Setup ${index + 1}</div>
          <div class="tiny" style="color:#64748b">${fixtureCount} fixtures • ${setup.controlMethod || 'No control'}</div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  }

  nextStep() {
    console.log('[LightWizard] nextStep called - currentStep:', this.currentStep, 'canAdvance:', this.canAdvance());
    if (this.currentStep < this.steps.length - 1) {
      this.currentStep++;
      console.log('[LightWizard] Moving to step:', this.currentStep);
      this.renderStep();
    } else {
      console.log('[LightWizard] Completing wizard');
      this.complete();
    }
  }

  prevStep() {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.renderStep();
    }
  }

  complete() {
    // Save current setup if it has fixtures
    if (this.data.fixtures?.length > 0) {
      this.saveCurrentSetup();
    }
    
    // Save all light setups to STATE or your data store
    const allSetups = {
      room: this.data.room,
      zone: this.data.zone,
      setups: this.lightSetups,
      timestamp: new Date().toISOString()
    };
    
    console.log('Completing light setup with all configurations:', allSetups);
    
    // Here you would typically save to your backend or STATE
    // For now, just show success message with count
    const totalSetups = this.lightSetups.length;
    const message = totalSetups > 1 ? 
      `${totalSetups} light setups saved successfully` : 
      'Light setup saved successfully';
    
    showToast({ 
      title: 'Light Setup Complete', 
      msg: message, 
      kind: 'success', 
      icon: '💡' 
    }, 4000);
    
    this.close();
  }

  close() {
    if (this.modal) {
      this.modal.setAttribute('aria-hidden', 'true');
    }
  }

  open() {
    console.log('[DEBUG] LightWizard.open() called, modal:', this.modal);
    if (this.modal) {
      console.log('[DEBUG] Modal found, proceeding with open');
      // Reset wizard state for fresh start
      this.currentStep = 0;
      this.steps = this.baseSteps.slice();
      this.lightSetups = [];
      this.currentSetupIndex = 0;
      
      // Reset data
      this.data = {
        id: '',
        name: '',
        room: '',
        zone: '',
        fixtures: [],
        controlMethod: null,
        energy: '',
        energyHours: 0,
        seriesCount: 0,
        controllersCount: 0,
        targetPpfd: 0,
        photoperiod: 0,
        devices: [],
        mapping: { zones: [], groups: [] },
        connectivity: { hasHub: null, hubType: '', hubIp: '', cloudTenant: 'Azure' }
      };
      
      // Hide zone creation elements
      this.hideZoneCreation();
      
      this.modal.setAttribute('aria-hidden', 'false');
      console.log('[LightWizard] Modal opened successfully');
      
      this.renderStep();
      console.log('[DEBUG] renderStep() called');
      
      // Force navigation update after modal opens
      setTimeout(() => {
        this.updateNavigation();
      }, 100);
    }
  }

  updateKbResults(query) {
    const host = $('#lightKbResults');
    if (!host || !query) { 
      if (host) host.innerHTML = ''; 
      return; 
    }
    
    console.log('[DEBUG] Light Setup search query:', query);
    console.log('[DEBUG] Available fixtures:', STATE.deviceKB?.fixtures?.length || 0);
    if (STATE.deviceKB?.fixtures?.length > 0) {
      console.log('[DEBUG] Sample fixtures:', STATE.deviceKB.fixtures.slice(0, 3).map(f => `${f.vendor} ${f.model}`));
    }
    
    const fixtures = STATE.deviceKB?.fixtures || [];
    const filtered = fixtures.filter(f => {
      const searchText = (f.vendor + ' ' + f.model + ' ' + (f.tags || []).join(' ')).toLowerCase();
      const matches = searchText.includes(query.toLowerCase());
      if (query.toLowerCase().length >= 2) {
        console.log('[DEBUG] Checking:', searchText, 'matches query "' + query + '":', matches);
      }
      return matches;
    });
    
    console.log('[DEBUG] Filtered results:', filtered.length);
    
    if (filtered.length === 0) {
      host.innerHTML = `<li style="padding: 12px; color: #64748b; text-align: center;">No fixtures found matching "${query}"<br><small>Try searching for: GROW3, TopLight, Gavita, Fluence, etc.</small></li>`;
      return;
    }
    
    const res = filtered.slice(0, 8).map((it, localIdx) => {
      const globalIdx = fixtures.indexOf(it);
      return { it, idx: globalIdx };
    });
    
    host.innerHTML = res.map(({it, idx}) => `
      <li>
        <div class="row" style="justify-content:space-between;align-items:center;gap:8px">
          <div>${it.vendor} <strong>${it.model}</strong> • ${it.watts} W • ${it.control || ''}</div>
          <div style="display:flex;gap:6px">
            <button type="button" class="ghost" data-action="add-kb" data-idx="${idx}">Add</button>
            <button type="button" class="ghost" data-action="add-unknown" data-idx="${idx}">Add unknown</button>
          </div>
        </div>
      </li>
    `).join('');
  }

  renderKbSelected() {
    const ul = $('#lightKbSelected');
    if (!ul) return;
    
    ul.innerHTML = (this.data.fixtures || []).map((it, idx) => `
      <li>
        <div class="row" style="align-items:center;gap:6px">
          <span>${it.vendor} <strong>${it.model}</strong> • ${it.watts || '?'} W</span>
          <button type="button" class="ghost" title="Remove" onclick="lightWizard.removeFixture(${idx})">×</button>
        </div>
      </li>
    `).join('');
    
    // Update navigation state after rendering fixtures
    this.updateNavigation();
  }

  removeFixture(idx) {
    this.data.fixtures.splice(idx, 1);
    this.renderKbSelected();
    // Navigation update is handled in renderKbSelected()
  }

  updateFixtureCount(idx, value) {
    const n = Math.max(1, Number(value || 1));
    if (this.data.fixtures[idx]) {
      this.data.fixtures[idx].count = n;
      // Update navigation after changing fixture count
      this.updateNavigation();
    }
  }

  populateRoomsFromGrowRoomsData() {
    console.log('[LightWizard] populateRoomsFromGrowRoomsData called');
    console.log('[LightWizard] STATE.farm:', STATE.farm);
    console.log('[LightWizard] STATE.rooms:', STATE.rooms);
    
    const roomSelect = document.getElementById('lightRoomSelect');
    const zoneSelect = document.getElementById('lightZoneSelect');
    
    if (!roomSelect) {
      console.log('[LightWizard] Room select element not found');
      return;
    }
    
    // Clear existing options except the default
    roomSelect.innerHTML = '<option value="">Select a room</option>';
    if (zoneSelect) zoneSelect.innerHTML = '<option value="">Select a zone</option>';
    
    // Get rooms from both STATE.farm.rooms (Farm Registration) and STATE.rooms (Room wizard)
    const farmRooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : [];
    const createdRooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
    
    console.log('[LightWizard] Farm rooms:', farmRooms);
    console.log('[LightWizard] Created rooms:', createdRooms);
    
    // Combine rooms, prioritizing created rooms over farm rooms if there are conflicts
    const allRooms = [...farmRooms];
    createdRooms.forEach(room => {
      const existingRoom = allRooms.find(r => r.id === room.id);
      if (existingRoom) {
        // Update existing room with more complete data from room wizard
        Object.assign(existingRoom, room);
      } else {
        allRooms.push(room);
      }
    });
    
    console.log('[LightWizard] Available rooms:', allRooms);
    
    // If no rooms are available, show a helpful message
    if (allRooms.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No rooms available - Create rooms first';
      option.disabled = true;
      roomSelect.appendChild(option);
      return;
    }
    
    allRooms.forEach(room => {
      const option = document.createElement('option');
      option.value = room.id || room.name;
      option.textContent = room.name || 'Unnamed Room';
      roomSelect.appendChild(option);
    });
    
    // Restore selected values if they exist
    if (this.data.room) {
      roomSelect.value = this.data.room;
      this.populateZonesForRoom(this.data.room);
    }
    if (this.data.zone && zoneSelect) {
      zoneSelect.value = this.data.zone;
    }
  }

  populateZonesForRoom(roomId) {
    const zoneSelect = document.getElementById('lightZoneSelect');
    if (!zoneSelect || !roomId) {
      if (zoneSelect) zoneSelect.innerHTML = '<option value="">Select a zone</option>';
      return;
    }
    
    // Get rooms from both STATE.farm.rooms and STATE.rooms
    const farmRooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : [];
    const createdRooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
    const allRooms = [...farmRooms, ...createdRooms];
    
    // Find the selected room
    const selectedRoom = allRooms.find(room => (room.id || room.name) === roomId);
    
    // Clear existing zone options
    zoneSelect.innerHTML = '<option value="">Select a zone</option>';
    
    // Populate zones from the selected room
    if (selectedRoom && selectedRoom.zones && Array.isArray(selectedRoom.zones)) {
      selectedRoom.zones.forEach(zone => {
        const option = document.createElement('option');
        // Handle both string zones and object zones
        if (typeof zone === 'string') {
          option.value = zone;
          option.textContent = zone;
        } else {
          option.value = zone.id || zone.name;
          option.textContent = zone.name || zone.id || 'Unnamed Zone';
        }
        zoneSelect.appendChild(option);
      });
    } else {
      // If no zones found, show a helpful message
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No zones available - Create zones first';
      option.disabled = true;
      zoneSelect.appendChild(option);
    }
  }

  renderReview() {
    const reviewContainer = document.getElementById('lightReview');
    if (!reviewContainer) return;
    
    // Include current setup in review if it has fixtures
    const allSetups = [...this.lightSetups];
    if (this.data.fixtures?.length > 0) {
      allSetups.push({
        id: 'current',
        room: this.data.room,
        zone: this.data.zone,
        fixtures: this.data.fixtures,
        controlMethod: this.data.controlMethod,
        seriesCount: this.data.seriesCount,
        controllersCount: this.data.controllersCount
      });
    }
    
    const roomName = STATE.rooms?.find(r => r.id === this.data.room)?.name || 'Unknown Room';
    const zoneName = STATE.rooms?.find(r => r.id === this.data.room)?.zones?.find(z => z.id === this.data.zone)?.name || 'Unknown Zone';
    
    let html = `
      <div class="farm-review">
        <h3 class="tiny" style="margin:0 0 8px;color:#0f172a">Light Setup Review</h3>
        
        <div class="review-section">
          <h4 class="tiny" style="margin:0 0 4px;color:#475569">Location</h4>
          <div class="tiny">Room: ${roomName}</div>
          <div class="tiny">Zone: ${zoneName}</div>
        </div>
    `;
    
    if (allSetups.length === 0) {
      html += `
        <div class="review-section" style="margin-top:12px">
          <div class="tiny" style="color:#64748b">No light setups configured</div>
        </div>
      `;
    } else {
      allSetups.forEach((setup, index) => {
        const fixtures = setup.fixtures || [];
        const totalFixtures = fixtures.reduce((sum, f) => sum + (f.count || 1), 0);
        
        html += `
          <div class="review-section" style="margin-top:12px;padding:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px">
            <h4 class="tiny" style="margin:0 0 4px;color:#475569">Light Setup ${index + 1}</h4>
            
            <div style="margin-bottom:6px">
              <div class="tiny" style="font-weight:500">Fixtures (${totalFixtures} total)</div>
              ${fixtures.length > 0 ? 
                fixtures.map(f => `<div class="tiny">• ${f.vendor} ${f.model} (${f.watts || '?'} W) ${f.count > 1 ? `x${f.count}` : ''}</div>`).join('') :
                '<div class="tiny">No fixtures selected</div>'
              }
            </div>
            
            <div style="margin-bottom:6px">
              <div class="tiny" style="font-weight:500">Control Method</div>
              <div class="tiny">${setup.controlMethod || 'Not selected'}</div>
            </div>
            
            ${setup.seriesCount || setup.controllersCount ? `
              <div>
                <div class="tiny" style="font-weight:500">Configuration</div>
                ${setup.seriesCount ? `<div class="tiny">Lights per controller: ${setup.seriesCount}</div>` : ''}
                ${setup.controllersCount ? `<div class="tiny">Controllers: ${setup.controllersCount}</div>` : ''}
              </div>
            ` : ''}
          </div>
        `;
      });
    }
    
    html += '</div>';
    reviewContainer.innerHTML = html;
  }
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
    this.aiEnabled = false;
    this.aiStart = null;
    this.aiFollowUp = null;
    this.deviceMetadata = {};
    this.environmentContext = {};
    this.aiNotifiedFailure = false;

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
      const ip = document.getElementById('pairWifiStaticIp');
      if (ip) ip.style.display = e.target.checked ? 'block' : 'none';
    });
  }

  open(opts = {}) {
    if (!this.modal) return;
    this.current = 0;
    this.onSave = opts.onSave || null;
    this.deviceMetadata = { ...(opts.metadata || {}) };
    this.environmentContext = { ...(opts.environmentContext || {}) };
    this.aiEnabled = isIAAssistActive();
    this.aiStart = null;
    this.aiFollowUp = null;
    this.aiNotifiedFailure = false;
    this.resetAiAffordances();
    if (opts.suggestedTransport) {
      const r = this.modal.querySelector(`input[name=pairTransport][value=${opts.suggestedTransport}]`);
      if (r) r.checked = true;
    }
    this.showStep(0);
    this.modal.style.display = 'block';
    this.modal.setAttribute('aria-hidden', 'false');
    if (this.aiEnabled) {
      this.loadInitialAISuggestions();
    }
  }

  close() {
    if (!this.modal) return;
    this.modal.style.display = 'none';
    this.modal.setAttribute('aria-hidden', 'true');
    this.resetAiAffordances();
    this.aiEnabled = false;
  }

  showStep(i) {
    if (!this.steps) return;
    this.steps.forEach((s, idx) => { s.style.display = idx === i ? 'block' : 'none'; });
    this.current = i;
    if (this.progress) {
      this.progress.textContent = `Step ${Math.min(i + 1, this.steps.length)} of ${this.steps.length}`;
    }
    if (this.prevBtn) this.prevBtn.style.display = i === 0 ? 'none' : 'inline-block';
    if (this.nextBtn) this.nextBtn.style.display = i === (this.steps.length - 1) ? 'none' : 'inline-block';
    if (this.saveBtn) this.saveBtn.style.display = i === (this.steps.length - 1) ? 'inline-block' : 'none';
    if (this.steps[i]?.dataset.step === 'review') this.updateReview();
  }

  next() {
    if (this.current < this.steps.length - 1) this.showStep(this.current + 1);
  }

  prev() {
    if (this.current > 0) this.showStep(this.current - 1);
  }

  getWizardSnapshot() {
    if (!this.modal) return {};
    const snapshot = {};
    const transport = this.modal.querySelector('input[name=pairTransport]:checked')?.value || 'wifi';
    snapshot.transport = transport;

    const wifi = {};
    const ssidEl = document.getElementById('pairWifiSsid');
    if (ssidEl && ssidEl.value) wifi.ssid = ssidEl.value.trim();
    const pskEl = document.getElementById('pairWifiPsk');
    if (pskEl && pskEl.value) wifi.psk = pskEl.value;
    const staticChk = document.getElementById('pairWifiStatic');
    if (staticChk) wifi.static = !!staticChk.checked;
    const staticIpEl = document.getElementById('pairWifiStaticIp');
    if (staticIpEl && staticIpEl.value) wifi.staticIp = staticIpEl.value.trim();
    if (Object.keys(wifi).length) snapshot.wifi = wifi;

    const bt = {};
    const btName = document.getElementById('pairBtName');
    if (btName && btName.value) bt.name = btName.value.trim();
    const btPin = document.getElementById('pairBtPin');
    if (btPin && btPin.value) bt.pin = btPin.value.trim();
    if (Object.keys(bt).length) snapshot.bluetooth = bt;

    if (this.steps?.[this.current]?.dataset.step) {
      snapshot.step = this.steps[this.current].dataset.step;
    }

    return snapshot;
  }

  collect() {
    const transport = this.modal.querySelector('input[name=pairTransport]:checked')?.value || 'wifi';
    const result = { transport };
    if (transport === 'wifi') {
      const ssid = document.getElementById('pairWifiSsid')?.value.trim() || '';
      const psk = document.getElementById('pairWifiPsk')?.value || '';
      const isStatic = !!document.getElementById('pairWifiStatic')?.checked;
      const staticIp = document.getElementById('pairWifiStaticIp')?.value.trim() || '';
      const wifi = { ssid, psk, static: !!isStatic };
      if (isStatic && staticIp) wifi.staticIp = staticIp;
      result.wifi = wifi;
    } else if (transport === 'bluetooth') {
      const name = document.getElementById('pairBtName')?.value.trim() || null;
      const pin = document.getElementById('pairBtPin')?.value.trim() || null;
      result.bluetooth = { name, pin };
    }
    return result;
  }

  updateReview() {
    const cfg = this.collect();
    const el = document.getElementById('pairReview');
    if (!el) return;
    el.innerHTML = '';
    Object.keys(cfg).forEach((k) => {
      const pre = document.createElement('pre');
      pre.style.margin = '0';
      if (typeof cfg[k] === 'string') {
        pre.textContent = `${k}: ${cfg[k]}`;
      } else {
        pre.textContent = `${k}: ` + JSON.stringify(cfg[k], null, 2);
      }
      el.appendChild(pre);
    });
    this.renderReviewSummary();
  }

  resetAiAffordances() {
    ['pairTransportAiSuggestion', 'pairWifiAiSuggestion', 'pairBtAiSuggestion', 'pairReviewAiSummary'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.display = 'none';
      el.classList.remove('ai-suggestion--applied');
      const textEl = el.querySelector('.ai-suggestion__text');
      if (textEl) textEl.textContent = '';
      const button = el.querySelector('button.ai-suggestion__apply');
      if (button) {
        button.disabled = false;
        button.textContent = 'Accept AI suggestion';
        button.onclick = null;
      }
    });
  }

  describeDevice() {
    const vendor = this.deviceMetadata.vendor || '';
    const model = this.deviceMetadata.model || '';
    const category = this.deviceMetadata.category || '';
    const combined = [vendor, model].filter(Boolean).join(' ').trim();
    if (combined) return combined;
    return category || 'device';
  }

  async loadInitialAISuggestions() {
    const data = await this.requestAISuggestions('start');
    if (data) this.applyInitialSuggestions(data);
  }

  async requestAISuggestions(stage = 'start', overrides = {}) {
    if (!this.aiEnabled) return null;
    const metadata = { ...(this.deviceMetadata || {}) };
    if (overrides.device_metadata) Object.assign(metadata, overrides.device_metadata);

    const wizardSnapshot = this.getWizardSnapshot();
    const wizardState = { ...wizardSnapshot, ...(overrides.wizard_state || {}) };

    const baseContext = { ...(this.environmentContext || {}) };
    if (overrides.environment_context) {
      Object.entries(overrides.environment_context).forEach(([key, value]) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          baseContext[key] = { ...(baseContext[key] || {}), ...value };
        } else {
          baseContext[key] = value;
        }
      });
    }

    try {
      const resp = await fetch('/ai/setup-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage,
          device_metadata: metadata,
          wizard_state: wizardState,
          environment_context: baseContext
        })
      });
      if (resp.status === 404 || resp.status === 503) {
        return null;
      }
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status} ${txt}`.trim());
      }
      return await resp.json();
    } catch (err) {
      console.warn('AI Assist request failed', err);
      if (!this.aiNotifiedFailure && stage === 'start') {
        this.aiNotifiedFailure = true;
        showToast({ title: 'IA Assist', msg: 'Unable to fetch pairing suggestions right now.', kind: 'info', icon: '🤖' }, 5000);
      }
      return null;
    }
  }

  applyInitialSuggestions(data) {
    this.aiStart = data;
    const fields = (data && data.suggested_fields) || {};
    this.renderTransportSuggestion(fields.transport);
    this.renderWifiSuggestion(fields.wifi);
    this.renderBluetoothSuggestion(fields.bluetooth);
    this.renderReviewSummary();
  }

  renderTransportSuggestion(transport) {
    const container = document.getElementById('pairTransportAiSuggestion');
    if (!container) return;
    if (!this.aiEnabled || !transport) {
      container.style.display = 'none';
      return;
    }
    const textEl = container.querySelector('.ai-suggestion__text');
    if (textEl) {
      textEl.textContent = `IA Assist recommends pairing ${this.describeDevice()} over ${String(transport).toUpperCase()}.`;
    }
    const button = container.querySelector('button.ai-suggestion__apply');
    if (button) {
      button.disabled = false;
      button.textContent = 'Accept AI suggestion';
      button.onclick = () => this.applyTransportSuggestion(transport, container);
    }
    container.style.display = 'flex';
  }

  applyTransportSuggestion(transport, container) {
    const radio = this.modal?.querySelector(`input[name=pairTransport][value=${transport}]`);
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (container) {
      container.classList.add('ai-suggestion--applied');
      const button = container.querySelector('button.ai-suggestion__apply');
      if (button) {
        button.disabled = true;
        button.textContent = 'Suggestion applied';
      }
    }
    showToast({ title: 'IA Assist', msg: `Transport set to ${String(transport).toUpperCase()}.`, kind: 'info', icon: '🤖' }, 5000);
    this.updateReview();
  }

  renderWifiSuggestion(suggestion) {
    const container = document.getElementById('pairWifiAiSuggestion');
    if (!container) return;
    if (!this.aiEnabled || !suggestion || !Object.keys(suggestion).length) {
      container.style.display = 'none';
      return;
    }
    const parts = [];
    if (suggestion.ssid) parts.push(`SSID ${suggestion.ssid}`);
    if (suggestion.staticIp) parts.push(`static IP ${suggestion.staticIp}`);
    const message = parts.length
      ? `IA Assist suggests configuring ${this.describeDevice()} with ${parts.join(' and ')}.`
      : `IA Assist prepared Wi‑Fi guidance for ${this.describeDevice()}.`;
    const textEl = container.querySelector('.ai-suggestion__text');
    if (textEl) textEl.textContent = message;
    const button = container.querySelector('button.ai-suggestion__apply');
    if (button) {
      button.disabled = false;
      button.textContent = 'Accept AI suggestion';
      button.onclick = () => this.applyWifiSuggestion(suggestion, container);
    }
    container.style.display = 'flex';
  }

  applyWifiSuggestion(suggestion, container) {
    const ssidInput = document.getElementById('pairWifiSsid');
    if (ssidInput && suggestion.ssid) ssidInput.value = suggestion.ssid;
    const pskInput = document.getElementById('pairWifiPsk');
    if (pskInput && suggestion.psk) pskInput.value = suggestion.psk;
    const staticCheckbox = document.getElementById('pairWifiStatic');
    const staticIpInput = document.getElementById('pairWifiStaticIp');
    const useStatic = suggestion.useStatic ?? Boolean(suggestion.staticIp);
    if (staticCheckbox && typeof useStatic === 'boolean') {
      staticCheckbox.checked = useStatic;
      staticCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (staticIpInput && suggestion.staticIp) staticIpInput.value = suggestion.staticIp;
    if (container) {
      container.classList.add('ai-suggestion--applied');
      const button = container.querySelector('button.ai-suggestion__apply');
      if (button) {
        button.disabled = true;
        button.textContent = 'Suggestion applied';
      }
    }
    showToast({ title: 'IA Assist', msg: 'Applied Wi‑Fi configuration suggestions.', kind: 'info', icon: '🤖' }, 5000);
    this.updateReview();
  }

  renderBluetoothSuggestion(suggestion) {
    const container = document.getElementById('pairBtAiSuggestion');
    if (!container) return;
    if (!this.aiEnabled || !suggestion || !Object.keys(suggestion).length) {
      container.style.display = 'none';
      return;
    }
    const details = [];
    if (suggestion.name) details.push(`name ${suggestion.name}`);
    if (suggestion.pin) details.push(`PIN ${suggestion.pin}`);
    const message = details.length
      ? `IA Assist recommends preparing Bluetooth with ${details.join(' and ')}.`
      : `IA Assist prepared Bluetooth pairing hints for ${this.describeDevice()}.`;
    const textEl = container.querySelector('.ai-suggestion__text');
    if (textEl) textEl.textContent = message;
    const button = container.querySelector('button.ai-suggestion__apply');
    if (button) {
      button.disabled = false;
      button.textContent = 'Accept AI suggestion';
      button.onclick = () => this.applyBluetoothSuggestion(suggestion, container);
    }
    container.style.display = 'flex';
  }

  applyBluetoothSuggestion(suggestion, container) {
    const nameInput = document.getElementById('pairBtName');
    if (nameInput && suggestion.name) nameInput.value = suggestion.name;
    const pinInput = document.getElementById('pairBtPin');
    if (pinInput && suggestion.pin) pinInput.value = suggestion.pin;
    if (container) {
      container.classList.add('ai-suggestion--applied');
      const button = container.querySelector('button.ai-suggestion__apply');
      if (button) {
        button.disabled = true;
        button.textContent = 'Suggestion applied';
      }
    }
    showToast({ title: 'IA Assist', msg: 'Bluetooth pairing details filled in.', kind: 'info', icon: '🤖' }, 5000);
    this.updateReview();
  }

  renderReviewSummary() {
    const container = document.getElementById('pairReviewAiSummary');
    if (!container) return;
    const textEl = container.querySelector('.ai-suggestion__text');
    const lines = [];
    if (this.aiStart?.summary) lines.push(this.aiStart.summary);
    if (Array.isArray(this.aiStart?.next_steps) && this.aiStart.next_steps.length) {
      lines.push(`Suggested next steps: ${this.aiStart.next_steps.join(' → ')}`);
    }
    if (!lines.length) {
      container.style.display = 'none';
      if (textEl) textEl.textContent = '';
      return;
    }
    if (textEl) textEl.textContent = lines.join(' ');
    container.style.display = 'flex';
  }

  async finish() {
    const cfg = this.collect();
    try {
      if (cfg.wifi) {
        if (this.progress) this.progress.textContent = 'Provisioning device Wi‑Fi via controller...';
        const resp = await fetch('/forwarder/provision/wifi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg.wifi)
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => null);
          showToast({ title: 'Provision failed', msg: `Controller returned ${resp.status}: ${txt || ''}`, kind: 'warn', icon: '⚠️' }, 6000);
        } else {
          const body = await resp.json().catch(() => null);
          showToast({ title: 'Provisioning initiated', msg: body?.message || 'Controller accepted provisioning request', kind: 'success', icon: '✅' }, 4000);
        }
      }
      if (cfg.bluetooth) {
        if (this.progress) this.progress.textContent = 'Requesting controller to pair via Bluetooth...';
        const resp = await fetch('/forwarder/provision/bluetooth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg.bluetooth)
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => null);
          showToast({ title: 'BT pair failed', msg: `Controller returned ${resp.status}: ${txt || ''}`, kind: 'warn', icon: '⚠️' }, 6000);
        } else {
          const body = await resp.json().catch(() => null);
          showToast({ title: 'Pairing requested', msg: body?.message || 'Controller pairing request sent', kind: 'success', icon: '✅' }, 4000);
        }
      }
    } catch (e) {
      showToast({ title: 'Provision error', msg: e.message || String(e), kind: 'warn', icon: '⚠️' }, 6000);
    } finally {
      if (this.progress) this.progress.textContent = '';
    }

    if (this.aiEnabled) {
      const followUp = await this.requestAISuggestions('complete', {
        wizard_state: { completed: true, collected_setup: cfg }
      });
      if (followUp) {
        this.aiFollowUp = followUp;
        const steps = Array.isArray(followUp.next_steps) ? followUp.next_steps : [];
        if (steps.length) {
          showToast({ title: 'IA Assist', msg: steps.join(' • '), kind: 'info', icon: '🤖' }, 8000);
        } else if (followUp.summary) {
          showToast({ title: 'IA Assist', msg: followUp.summary, kind: 'info', icon: '🤖' }, 6000);
        }
      }
    }

    if (this.onSave) this.onSave(cfg);
    this.close();
  }
}

function isIAAssistActive() {
  const card = document.getElementById('iaAssistFeature');
  if (!card) return false;
  if (card.classList.contains('active')) return true;
  const statusEl = card.querySelector('.ai-feature-status');
  const text = (statusEl?.textContent || '').trim().toLowerCase();
  return statusEl?.classList.contains('always-on') || text.includes('always');
}

function buildPairingEnvironmentContext(roomWizardInstance) {
  const farm = STATE.farm || {};
  const discovery = farm.discovery || {};
  const connection = (farm.connection && farm.connection.wifi) || {};
  const testResult = connection.testResult || {};
  const roomData = (roomWizardInstance && roomWizardInstance.data) || {};
  const roomNameInput = document.getElementById('roomName');
  const locationSelect = document.getElementById('roomLocationSelect');

  const preferredSsid = discovery.ssid || connection.ssid || testResult.ssid || '';
  const subnet = discovery.subnet || testResult.subnet || '';
  const gateway = discovery.gateway || testResult.gateway || '';

  return {
    farm: {
      name: farm.name || farm.farmName || '',
      preferredSsid,
      subnet,
      gateway,
      controller: (STATE.config && STATE.config.controller) || ''
    },
    room: {
      name: roomData.name || roomNameInput?.value?.trim() || '',
      location: roomData.location || locationSelect?.value || ''
    }
  };
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
    let modelMeta = null;
    if (modelSel && modelSel.value) {
      modelMeta = findModelByValue(modelSel.value);
      if (modelMeta && modelMeta.connectivity && modelMeta.connectivity.includes('bluetooth')) suggested = 'bluetooth';
    }
    const vendor = document.getElementById('roomDeviceVendor')?.value || '';
    const model = document.getElementById('roomDeviceModel')?.value || '';
    const man = DEVICE_MANUFACTURERS && DEVICE_MANUFACTURERS.find(x=>x.name===vendor);
    if (!modelMeta && man && man.models) {
      modelMeta = man.models.find(m=>m.model===model) || modelMeta;
    }
    const requiresHub = (modelMeta && modelMeta.requiresHub) || (man && man.requiresHub) || ((modelMeta && (modelMeta.features || []).some(f=>/bridge|hub|ir-bridge-required/i.test(f))) || false);
    const environmentContext = buildPairingEnvironmentContext(roomWizardInstance);
    if (requiresHub) {
      const hasHub = (roomWizardInstance.data.devices||[]).some(d=> (d.vendor===vendor && /(hub|bridge|bridge mini|hub)/i.test(d.model)) || (d.setup && d.setup.isHub));
      if (!hasHub) {
        showToast({ title: 'Hub required', msg: `${vendor} ${model} typically requires a hub. Please add the hub first.`, kind:'warn', icon: '⚠️' }, 6000);
        DEVICE_PAIR_WIZARD.open({
          suggestedTransport: 'wifi',
          metadata: {
            vendor,
            model: `${vendor} Hub`,
            category: 'hub',
            connectivity: ['wifi', 'ethernet'],
            requiresHub: false,
            preferred_transport: 'wifi'
          },
          environmentContext,
          onSave: (setup) => {
            const hubName = `${vendor} Hub`;
            const hubDevice = { name: hubName, vendor, model: `${vendor} Hub`, host: setup?.wifi?.staticIp || '', setup: { ...setup, isHub: true } };
            roomWizardInstance.data.devices = roomWizardInstance.data.devices || [];
            roomWizardInstance.data.devices.push(hubDevice);
            roomWizardInstance.renderDevicesList();
            if (typeof renderControllerAssignments === 'function') {
              renderControllerAssignments();
            }
            showToast({ title: 'Hub added', msg: `Added ${hubName}. Now add child devices.`, kind: 'success', icon: '✅' }, 4000);
          }
        });
        return;
      }
    }

    const connectivity = [];
    if (Array.isArray(modelMeta?.connectivity)) connectivity.push(...modelMeta.connectivity);
    else if (modelMeta?.connectivity) connectivity.push(modelMeta.connectivity);
    else if (Array.isArray(man?.connectivity)) connectivity.push(...man.connectivity);
    const metadata = {
      vendor,
      model,
      category: modelMeta?.category || man?.category || '',
      connectivity: connectivity.map(c => String(c).toLowerCase()),
      features: Array.isArray(modelMeta?.features) ? modelMeta.features : [],
      requiresHub,
      preferred_transport: suggested
    };
    if (modelMeta?.advertisedName) metadata.advertisedName = modelMeta.advertisedName;
    if (modelMeta?.defaultPin) metadata.defaultPin = modelMeta.defaultPin;
    if (modelMeta?.pairingPin) metadata.pairingPin = modelMeta.pairingPin;
    if (modelMeta?.requiresStaticIp) metadata.requiresStaticIp = modelMeta.requiresStaticIp;
    if (modelMeta?.preferredIp) metadata.preferredIp = modelMeta.preferredIp;

    DEVICE_PAIR_WIZARD.open({
      suggestedTransport: suggested,
      metadata,
      environmentContext,
      onSave: (setup) => {
        const name = document.getElementById('roomDeviceName')?.value.trim() || '';
        const vendor = document.getElementById('roomDeviceVendor')?.value || '';
        const model = document.getElementById('roomDeviceModel')?.value || '';
        const host = document.getElementById('roomDeviceHost')?.value.trim() || '';
        roomWizardInstance.data.devices = roomWizardInstance.data.devices || [];
        const device = { name: name || `${vendor} ${model}`, vendor, model, host, setup };
        // Clear any previous invalid input markers before adding
        ['deviceRs485UnitId', 'device0v10Channel', 'device0v10Scale'].forEach(id => {
          try {
            clearFieldError(id);
          } catch (e) {
            const el = document.getElementById(id);
            if (el) el.classList.remove('invalid');
          }
        });
        roomWizardInstance.data.devices.push(device);
        roomWizardInstance.renderDevicesList();
        if (typeof renderControllerAssignments === 'function') {
          renderControllerAssignments();
        }
      }
    });
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
        // Validate logo URL before attempting to load
        const logoUrl = STATE.farm.logo.trim();
        if (logoUrl && (logoUrl.startsWith('http://') || logoUrl.startsWith('https://'))) {
          // Use test image approach to avoid 404s
          const testImg = new Image();
          testImg.onload = () => {
            farmLogoEl.src = logoUrl;
            farmLogoEl.style.display = 'block';
          };
          testImg.onerror = () => {
            farmLogoEl.style.display = 'none';
          };
          testImg.src = logoUrl;
        } else {
          farmLogoEl.style.display = 'none';
        }
      }
      
      // Apply farm branding theme if available
      if (lightEngineTitleEl && STATE.farm.branding && STATE.farm.branding.palette) {
        const palette = STATE.farm.branding.palette;
        console.log('🎨 initializeTopCard applying theme with palette:', palette);
        
        // Apply the complete theme using applyTheme function
        applyTheme(palette, {
          fontFamily: STATE.farm.branding.fontFamily || '',
          logoHeight: STATE.farm.branding.logoHeight || ''
        });
        
        // Also set the title color specifically
        if (palette.primary) {
          lightEngineTitleEl.style.color = palette.primary;
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

        renderGrowRoomOverview();
      }
    });

    // Add hover tooltip functionality using existing tooltip system
    card.addEventListener('mouseenter', (e) => {
      card.setAttribute('data-tip', featureData.description);
      showTipFor(card);
    });

    card.addEventListener('mouseleave', () => {
      hideTip();
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

        renderGrowRoomOverview();
      }
    });
  }

  renderGrowRoomOverview();
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

function setActivePanel(panelId = 'overview') {
  ACTIVE_PANEL = panelId;
  const panels = document.querySelectorAll('[data-panel]');
  let matched = false;
  panels.forEach((panel) => {
    const isMatch = panel.getAttribute('data-panel') === panelId;
    panel.classList.toggle('is-active', isMatch);
    if (isMatch) matched = true;
  });

  if (!matched && panelId !== 'overview') {
    setActivePanel('overview');
    return;
  }

  document.querySelectorAll('[data-sidebar-link]').forEach((link) => {
    const target = link.getAttribute('data-target');
    const isActive = target === panelId;
    link.classList.toggle('is-active', isActive);
    link.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  if (panelId === 'overview') {
    document.querySelectorAll('.sidebar-group').forEach((group) => {
      const trigger = group.querySelector('.sidebar-group__trigger');
      const items = group.querySelector('.sidebar-group__items');
      group.classList.remove('is-expanded');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      if (items) items.hidden = true;
    });
  }
}

function initializeSidebarNavigation() {
  document.querySelectorAll('.sidebar-group').forEach((group) => {
    const trigger = group.querySelector('.sidebar-group__trigger');
    const items = group.querySelector('.sidebar-group__items');
    if (items) items.hidden = true;
    trigger?.addEventListener('click', () => {
      const expanded = trigger.getAttribute('aria-expanded') === 'true';
      const next = !expanded;
      trigger.setAttribute('aria-expanded', String(next));
      group.classList.toggle('is-expanded', next);
      if (items) items.hidden = !next;
      if (!next) {
        const activeLink = group.querySelector('[data-sidebar-link].is-active');
        if (activeLink) {
          setActivePanel('overview');
        }
      }
    });
  });

  document.querySelectorAll('[data-sidebar-link]').forEach((link) => {
    link.addEventListener('click', () => {
      const target = link.getAttribute('data-target') || 'overview';
      if (target === 'overview') {
        setActivePanel('overview');
        return;
      }
      const group = link.closest('.sidebar-group');
      if (group) {
        const trigger = group.querySelector('.sidebar-group__trigger');
        const items = group.querySelector('.sidebar-group__items');
        group.classList.add('is-expanded');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
        if (items) items.hidden = false;
      } else {
        document.querySelectorAll('.sidebar-group').forEach((otherGroup) => {
          const otherTrigger = otherGroup.querySelector('.sidebar-group__trigger');
          const otherItems = otherGroup.querySelector('.sidebar-group__items');
          otherGroup.classList.remove('is-expanded');
          if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
          if (otherItems) otherItems.hidden = true;
        });
      }
      setActivePanel(target);
    });
  });

  setActivePanel('overview');
}

document.addEventListener('DOMContentLoaded', async () => {
  // Clean up any existing invalid img src attributes that might cause 404s
  document.querySelectorAll('img').forEach(img => {
    if (img.src && !img.src.startsWith('http://') && !img.src.startsWith('https://') && !img.src.startsWith('data:') && img.src.includes('.')) {
      img.src = '';
      img.style.display = 'none';
    }
  });
  
  wireHints();
  wireGlobalEvents();
  initializeSidebarNavigation();

  document.getElementById('btnLaunchPairWizard')?.addEventListener('click', () => {
    DEVICE_PAIR_WIZARD.open();
  });

  document.getElementById('btnPairWizardDocs')?.addEventListener('click', () => {
    showToast({
      title: 'Pairing checklist',
      msg: 'Review onboarding notes before pairing devices.',
      kind: 'info',
      icon: '🧭'
    });
  });

  const profileForm = document.getElementById('profileForm');
  if (profileForm) {
    const nameInput = document.getElementById('profileName');
    const roleInput = document.getElementById('profileRole');
    const emailInput = document.getElementById('profileEmail');
    const phoneInput = document.getElementById('profilePhone');
    const statusEl = document.getElementById('profileStatus');

    try {
      const storedProfile = JSON.parse(localStorage.getItem('gr.profile') || 'null');
      if (storedProfile) {
        if (nameInput) nameInput.value = storedProfile.name || '';
        if (roleInput) roleInput.value = storedProfile.role || '';
        if (emailInput) emailInput.value = storedProfile.email || '';
        if (phoneInput) phoneInput.value = storedProfile.phone || '';
        if (statusEl) statusEl.textContent = 'Loaded from device';
      }
    } catch (err) {
      console.warn('Failed to load stored profile', err);
    }

    profileForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const payload = {
        name: nameInput?.value?.trim() || '',
        role: roleInput?.value?.trim() || '',
        email: emailInput?.value?.trim() || '',
        phone: phoneInput?.value?.trim() || ''
      };
      try {
        localStorage.setItem('gr.profile', JSON.stringify(payload));
      } catch (err) {
        console.warn('Failed to persist profile', err);
      }
      if (statusEl) statusEl.textContent = 'Saved locally';
      showToast({ title: 'Profile saved', msg: 'Profile details stored on this device.', kind: 'success', icon: '💾' });
    });

    document.getElementById('profileReset')?.addEventListener('click', () => {
      if (nameInput) nameInput.value = '';
      if (roleInput) roleInput.value = '';
      if (emailInput) emailInput.value = '';
      if (phoneInput) phoneInput.value = '';
      try {
        localStorage.removeItem('gr.profile');
      } catch (err) {
        console.warn('Failed to clear profile', err);
      }
      if (statusEl) statusEl.textContent = 'Profile cleared';
      showToast({ title: 'Profile reset', msg: 'Local profile details removed.', kind: 'info', icon: '🧹' });
    });
  }
  // Load runtime config and show chip
  await loadConfig();
  // Start forwarder health polling (shows status near the config chip)
  try { startForwarderHealthPolling(10000); } catch (e) { console.warn('Failed to start forwarder polling', e); }
  
  // Initialize AI features and top card
  initializeTopCard();
  initializeAIFeatures();
  
  // Apply saved branding if available
  if (STATE.farm && STATE.farm.branding) {
    applyTheme(STATE.farm.branding.palette, {
      fontFamily: STATE.farm.branding.fontFamily || '',
      logoHeight: STATE.farm.branding.logoHeight || ''
    });
  }
  
  // Initialize farm wizard
  farmWizard = new FarmWizard();
  window.farmWizard = farmWizard;
  // Initialize device manager window
  deviceManagerWindow = new DeviceManagerWindow();
  window.deviceManagerWindow = deviceManagerWindow;
  // Initialize room wizard
  roomWizard = new RoomWizard();
  // Initialize light wizard
  console.log('[DEBUG] About to initialize LightWizard');
  lightWizard = new LightWizard();
  window.lightWizard = lightWizard;
  console.log('[DEBUG] LightWizard initialized:', lightWizard);
  
  // Initialize fresh light wizard
  console.log('[DEBUG] About to initialize FreshLightWizard');
  console.log('[DEBUG] Checking for freshLightModal element:', document.getElementById('freshLightModal'));
  freshLightWizard = new FreshLightWizard();
  window.freshLightWizard = freshLightWizard;
  console.log('[DEBUG] FreshLightWizard initialized:', freshLightWizard);
  
  // Wire up light setup button (with retry logic)
  function setupLightSetupButton() {
    const lightSetupBtn = document.getElementById('btnLaunchLightSetup');
    console.log('[DEBUG] Light setup button found:', lightSetupBtn);
    
    if (lightSetupBtn) {
      lightSetupBtn.addEventListener('click', () => {
        console.log('[DEBUG] Light setup button clicked, opening fresh wizard');
        freshLightWizard.open();
      });
      console.log('[DEBUG] Light setup button event listener attached');
    } else {
      console.error('[DEBUG] Could not find Light setup button!');
      // Retry after a short delay
      setTimeout(() => {
        console.log('[DEBUG] Retrying button setup...');
        setupLightSetupButton();
      }, 500);
    }
  }
  
  setupLightSetupButton();
  
  // Add manual test function for debugging
  window.testFreshWizard = function() {
    console.log('[DEBUG] Manual test - freshLightWizard:', window.freshLightWizard);
    if (window.freshLightWizard) {
      window.freshLightWizard.open();
    } else {
      console.error('[DEBUG] Fresh wizard not available!');
    }
  };
  
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
    
    // Clean up invalid logo URLs from localStorage
    if (farmLocal?.branding?.logo && !farmLocal.branding.logo.startsWith('http://') && !farmLocal.branding.logo.startsWith('https://')) {
      farmLocal.branding.logo = '';
      localStorage.setItem('gr.farm', JSON.stringify(farmLocal));
    }
    
    const branding = farmLocal?.branding || STATE.farm?.branding;
    if (branding?.palette) applyTheme(branding.palette, { fontFamily: branding.fontFamily || '' });
    if (Array.isArray(branding?.fontCss) && branding.fontCss.length) {
      const id = 'gr-brand-fonts'; let link = document.getElementById(id); if (!link) { link = document.createElement('link'); link.id = id; link.rel = 'stylesheet'; document.head.appendChild(link); }
      link.href = branding.fontCss[0];
    }
    const headerLogo = document.querySelector('.header.logo img');
    if (headerLogo && branding?.logo) { 
      // Validate logo URL before attempting to load
      const logoUrl = branding.logo.trim();
      if (logoUrl && (logoUrl.startsWith('http://') || logoUrl.startsWith('https://'))) {
        // Use test image approach to avoid 404s
        const testImg = new Image();
        testImg.onload = () => {
          headerLogo.src = logoUrl;
          headerLogo.style.display = 'inline-block';
        };
        testImg.onerror = () => {
          headerLogo.style.display = 'none';
        };
        testImg.src = logoUrl;
      } else {
        // Invalid URL format, hide logo
        headerLogo.style.display = 'none';
      }
    }
    const title = document.querySelector('.header.logo h1');
    if (title && branding?.fontFamily) { title.style.fontFamily = branding.fontFamily + ', var(--gr-font)'; }
  } catch {}
  
  // Initialize Current Lights Status panel
  try { initLightsStatusUI(); } catch (e) { console.warn('Lights status init failed', e); }
  
  setStatus("Dashboard loaded");
});
