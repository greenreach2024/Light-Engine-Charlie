import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 8091;
const CTRL = process.env.CTRL || "http://192.168.2.80:3000";
// Environment source: "local" (default) reads public/data/env.json
// or "azure" pulls from an Azure Functions endpoint that returns latest readings
const AZURE_LATEST_URL = process.env.AZURE_LATEST_URL || "";
const ENV_SOURCE = process.env.ENV_SOURCE || (AZURE_LATEST_URL ? "azure" : "local");
const ENV_PATH = path.resolve("./public/data/env.json");
const DATA_DIR = path.resolve("./public/data");
const FARM_PATH = path.join(DATA_DIR, 'farm.json');

app.use(express.json({ limit: "1mb" }));

// Health (includes quick controller reachability check)
app.get("/healthz", async (req, res) => {
  const started = Date.now();
  let controllerReachable = false;
  let controllerStatus = null;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1200);
    try {
      const r = await fetch(CTRL, { method: 'HEAD', signal: ac.signal });
      controllerReachable = r.ok;
      controllerStatus = r.status;
    } catch (e) {
      controllerReachable = false;
      controllerStatus = e.name === 'AbortError' ? 'timeout' : (e.message || 'error');
    } finally {
      clearTimeout(t);
    }
  } catch (_) {}
  res.json({ ok: true, controller: CTRL, controllerReachable, controllerStatus, envSource: ENV_SOURCE, azureLatestUrl: AZURE_LATEST_URL || null, ts: new Date(), dtMs: Date.now() - started });
});

// Proxy API
app.use("/api", createProxyMiddleware({
  target: CTRL,
  changeOrigin: true
}));

// Static files
app.use(express.static("./public"));

// Config endpoint to surface runtime flags
app.get('/config', (req, res) => {
  res.json({ singleServer: true, controller: CTRL, envSource: ENV_SOURCE, azureLatestUrl: AZURE_LATEST_URL || null });
});

// --- Branding and Farm Profile Endpoints ---
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

app.options('/brand/extract', (req, res) => { setCors(res); res.status(204).end(); });
app.options('/farm', (req, res) => { setCors(res); res.status(204).end(); });

// Helper: safe JSON read
function readJSONSafe(fullPath, fallback = null) {
  try {
    if (fs.existsSync(fullPath)) {
      const raw = fs.readFileSync(fullPath, 'utf8');
      return JSON.parse(raw);
    }
  } catch {}
  return fallback;
}

// Tiny color utils
function hexToRgb(hex) {
  if (!hex) return null;
  const m = hex.replace('#','').trim();
  if (m.length === 3) {
    const r = parseInt(m[0]+m[0],16), g=parseInt(m[1]+m[1],16), b=parseInt(m[2]+m[2],16);
    return {r,g,b};
  }
  if (m.length === 6) {
    const r = parseInt(m.slice(0,2),16), g=parseInt(m.slice(2,4),16), b=parseInt(m.slice(4,6),16);
    return {r,g,b};
  }
  return null;
}
function rgbToHex({r,g,b}) {
  const to = (v)=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
function luminance(hex){
  const c = hexToRgb(hex); if(!c) return 1;
  const srgb = ['r','g','b'].map(k=>{
    let v = c[k]/255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);
  });
  return 0.2126*srgb[0]+0.7152*srgb[1]+0.0722*srgb[2];
}
function contrastRatio(h1,h2){
  const L1 = luminance(h1), L2 = luminance(h2);
  const a = Math.max(L1,L2)+0.05, b = Math.min(L1,L2)+0.05; return a/b;
}
function mix(hex1, hex2, t){
  const a = hexToRgb(hex1)||{r:255,g:255,b:255};
  const b = hexToRgb(hex2)||{r:255,g:255,b:255};
  return rgbToHex({ r: a.r+(b.r-a.r)*t, g: a.g+(b.g-a.g)*t, b: a.b+(b.b-a.b)*t });
}
function isGrey(hex){
  const c = hexToRgb(hex); if(!c) return false;
  const max = Math.max(c.r,c.g,c.b), min=Math.min(c.r,c.g,c.b);
  return (max-min) < 16; // low chroma
}
function uniqueColors(colors){
  const set = new Set(); const out = [];
  for(const h of colors){ const k=h.toUpperCase(); if(!set.has(k)){ set.add(k); out.push(h);} }
  return out;
}
function extractColorsFromText(txt){
  const hexes = (txt.match(/#[0-9a-fA-F]{3,6}\b/g) || []).map(h=>h.length===4?`#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`:h);
  return uniqueColors(hexes);
}

async function fetchText(url, ac){
  const r = await fetch(url, { headers: { 'accept':'text/html, text/css, */*' }, signal: ac?.signal });
  if(!r.ok) throw new Error(`fetch ${r.status}`); return await r.text();
}

function resolveUrl(base, href){
  try { return new URL(href, base).toString(); } catch { return href; }
}

function normalizePalette(seed){
  const neutral = { background: '#F7FAFA', surface: '#FFFFFF', border: '#DCE5E5', text: '#0B1220', primary: '#0D7D7D', accent: '#64C7C7' };
  const p = { ...neutral, ...(seed||{}) };
  // Ensure light background
  if (luminance(p.background) < 0.35) p.background = mix(p.background, '#FFFFFF', 0.3);
  // Ensure contrast text/background
  if (contrastRatio(p.text, p.background) < 4.5) {
    // choose dark or white whichever passes
    p.text = contrastRatio('#0B1220', p.background) >= 4.5 ? '#0B1220' : '#FFFFFF';
  }
  // Surface slightly lighter than background
  if (contrastRatio(p.surface, p.background) < 1.2) p.surface = '#FFFFFF';
  // Border slightly darker than background
  p.border = contrastRatio(p.border, p.surface) < 1.2 ? mix(p.surface, '#000000', 0.08) : p.border;
  return p;
}

app.get('/brand/extract', async (req, res) => {
  try {
    setCors(res);
    const target = String(req.query.url || '').trim();
    if (!target) return res.status(400).json({ ok:false, error: 'url required' });
    const ac = new AbortController();
    const timer = setTimeout(()=>ac.abort(), 4000);
    let html = '';
    try {
      html = await fetchText(target, ac);
    } finally { clearTimeout(timer); }
    const origin = new URL(target).origin;
    const meta = {};
    // very small tag scraping
    const metaTag = (name, attr='name') => {
      const re = new RegExp(`<meta[^>]+${attr}=[\"\']${name}[\"\'][^>]*content=[\"\']([^\"\']+)[\"\']`, 'i');
      const m = html.match(re); return m ? m[1] : '';
    };
    const title = (()=>{ const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m? m[1].trim():''; })();
    const siteName = metaTag('og:site_name','property') || metaTag('application-name','name') || title || new URL(target).hostname;
    // logo candidates
    const links = Array.from(html.matchAll(/<link[^>]+>/gi)).map(m=>m[0]);
    const iconHrefs = [];
    for (const ln of links) {
      if (/rel=["'](?:icon|shortcut icon|apple-touch-icon)["']/i.test(ln)) {
        const m = ln.match(/href=["']([^"']+)["']/i); if (m) iconHrefs.push(resolveUrl(origin, m[1]));
      }
    }
    const metaLogo = metaTag('og:logo','property') || metaTag('logo','itemprop') || '';
    if (metaLogo) iconHrefs.unshift(resolveUrl(origin, metaLogo));
    // prefer svg, then png
    let logo = iconHrefs.find(u=>u.toLowerCase().endsWith('.svg')) || iconHrefs.find(u=>u.toLowerCase().endsWith('.png')) || iconHrefs[0] || '';

    // colors from meta theme-color
    const themeColor = metaTag('theme-color','name');
    // find stylesheets
    const cssLinks = links.filter(l=>/rel=["']stylesheet["']/i.test(l)).map(l=>{
      const m = l.match(/href=["']([^"']+)["']/i); return m? resolveUrl(origin, m[1]) : null; }).filter(Boolean).slice(0,2);
    let cssText = '';
    for (const cssUrl of cssLinks) {
      try { cssText += '\n' + await fetchText(cssUrl); } catch {}
    }
    // inline styles
    const inlineStyles = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || []).join('\n');
    cssText += '\n' + inlineStyles;
    const foundColors = extractColorsFromText(cssText);
    const nonGrey = foundColors.filter(c=>!isGrey(c));
    const primary = themeColor || nonGrey[0] || '#0D7D7D';
    const accent = nonGrey.find(c=>c.toUpperCase()!==primary.toUpperCase()) || mix(primary,'#FFFFFF',0.5);
    const lightCandidates = foundColors.filter(c=>luminance(c) > 0.8);
    const background = lightCandidates[0] || '#F7FAFA';
    const palette = normalizePalette({ primary, accent, background });
    return res.json({ ok:true, name: siteName, logo, palette });
  } catch (e) {
    setCors(res);
    // neutral fallback
    const fallback = { background:'#F7FAFA', surface:'#FFFFFF', border:'#DCE5E5', text:'#0B1220', primary:'#0D7D7D', accent:'#64C7C7' };
    return res.status(200).json({ ok:false, error: e.message, name: '', logo: '', palette: fallback });
  }
});

// GET current farm (including branding)
app.get('/farm', (req, res) => {
  try {
    setCors(res);
    const data = readJSONSafe(FARM_PATH, null) || { farmName:'', locations:[], contact:{}, crops:[], branding:null };
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// Save farm
app.post('/farm', (req, res) => {
  try {
    setCors(res);
    const body = req.body || {};
    // basic shape: store as-is
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FARM_PATH, JSON.stringify(body, null, 2));
    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// Simple reachability probe: GET /probe?url=http://host:port
app.get('/probe', async (req, res) => {
  try {
    const url = String(req.query.url || '').trim();
    if (!url) return res.status(400).json({ ok: false, error: 'url required' });
    const started = Date.now();
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    let status = null;
    let ok = false;
    try {
      let r = await fetch(url, { method: 'HEAD', signal: ac.signal });
      status = r.status;
      ok = r.ok;
      // Fallback to GET when HEAD not supported or non-OK
      if (!ok || (typeof status === 'number' && status >= 400)) {
        r = await fetch(url, { method: 'GET', headers: { 'accept': '*/*' }, signal: ac.signal });
        status = r.status;
        ok = r.ok;
      }
    } catch (e) {
      status = e.name === 'AbortError' ? 'timeout' : (e.message || 'error');
      ok = false;
    } finally {
      clearTimeout(t);
    }
    res.json({ ok, status, dtMs: Date.now() - started });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Environment Telemetry Endpoints (Azure-ready) ---
// Utility: compute VPD (kPa) from tempC and RH%
function computeVPDkPa(tempC, rhPercent) {
  if (typeof tempC !== 'number' || typeof rhPercent !== 'number' || Number.isNaN(tempC) || Number.isNaN(rhPercent)) return null;
  const svp = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3)); // kPa
  const rh = Math.min(Math.max(rhPercent / 100, 0), 1);
  const vpd = svp * (1 - rh);
  return Math.round(vpd * 100) / 100; // 2 decimals
}

// In-memory history cache for Azure mode: key => [values]
const azureHist = new Map();
const pushHist = (key, val, max = 100) => {
  if (val == null || Number.isNaN(val)) return;
  const arr = azureHist.get(key) || [];
  arr.unshift(val);
  if (arr.length > max) arr.length = max;
  azureHist.set(key, arr);
};

// GET: return current environment zones
app.get("/env", async (req, res) => {
  if (ENV_SOURCE === 'azure' && AZURE_LATEST_URL) {
    try {
      const params = new URLSearchParams();
      if (req.query.zone) params.set('zone', req.query.zone);
      if (req.query.deviceId) params.set('deviceId', req.query.deviceId);
      const url = params.toString() ? `${AZURE_LATEST_URL}?${params.toString()}` : AZURE_LATEST_URL;
      const r = await fetch(url, { method: 'GET', headers: { 'accept': 'application/json' } });
      if (!r.ok) throw new Error(`Azure endpoint ${r.status}`);
      const list = await r.json(); // [{ zone, deviceId, temperature, humidity, co2, battery, rssi, timestamp }]

      const zonesMap = new Map();
      for (const e of Array.isArray(list) ? list : []) {
        const zoneId = e.zone || 'DefaultZone';
        const z = zonesMap.get(zoneId) || { id: zoneId, name: zoneId, location: zoneId, sensors: {}, meta: {} };
        const t = Number(e.temperature);
        const h = Number(e.humidity);
        const c = Number(e.co2);
        const vpd = computeVPDkPa(t, h);

        // meta
        if (typeof e.battery === 'number') z.meta.battery = e.battery;
        if (typeof e.rssi === 'number') z.meta.rssi = e.rssi;
        if (e.timestamp) z.meta.lastUpdated = e.timestamp;

        // sensors
        const ensure = (k, val) => {
          z.sensors[k] = z.sensors[k] || { current: null, setpoint: { min: null, max: null }, history: [] };
          if (typeof val === 'number' && !Number.isNaN(val)) {
            z.sensors[k].current = val;
            // update history cache
            const histKey = `${zoneId}:${k}`;
            pushHist(histKey, val);
            z.sensors[k].history = azureHist.get(histKey) || [];
          }
        };
        ensure('tempC', t);
        ensure('rh', h);
        ensure('co2', c);
        if (vpd != null) ensure('vpd', vpd);

        zonesMap.set(zoneId, z);
      }

      const payload = { zones: Array.from(zonesMap.values()) };
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json(payload);
    } catch (e) {
      // Fallback to last known cache if available
      if (azureHist.size > 0) {
        const byZone = {};
        for (const [key, arr] of azureHist.entries()) {
          const [zoneId, metric] = key.split(':');
          byZone[zoneId] = byZone[zoneId] || { id: zoneId, name: zoneId, location: zoneId, sensors: {} };
          byZone[zoneId].sensors[metric] = { current: arr[0] ?? null, setpoint: { min: null, max: null }, history: arr };
        }
        const payload = { zones: Object.values(byZone) };
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json(payload);
      }
      return res.status(502).json({ ok: false, error: `Azure fetch failed: ${e.message}` });
    }
  }

  // Local file mode (default)
  try {
    const raw = fs.readFileSync(ENV_PATH, "utf8");
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(raw);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST: ingest a telemetry message and upsert into env.json
// Expected body: { zoneId, name, temperature, humidity, vpd, co2, battery, rssi, source }
app.post("/ingest/env", (req, res) => {
  try {
    const { zoneId, name, temperature, humidity, vpd, co2, battery, rssi, source } = req.body || {};
    if (!zoneId) return res.status(400).json({ ok: false, error: "zoneId required" });
    // Load existing
    const data = JSON.parse(fs.readFileSync(ENV_PATH, "utf8"));
    data.zones = data.zones || [];
    let zone = data.zones.find(z => z.id === zoneId);
    if (!zone) {
      zone = { id: zoneId, name: name || zoneId, location: name || zoneId, sensors: {} };
      data.zones.push(zone);
    }
    zone.name = name || zone.name;
    zone.location = zone.location || zone.name;
    zone.meta = zone.meta || {};
    if (source) zone.meta.source = source;
    if (typeof battery === "number") zone.meta.battery = battery;
    if (typeof rssi === "number") zone.meta.rssi = rssi;

    const ensure = (k, val, unit) => {
      zone.sensors[k] = zone.sensors[k] || { current: null, setpoint: { min: null, max: null }, history: [] };
      if (typeof val === "number" && !Number.isNaN(val)) {
        zone.sensors[k].current = val;
        zone.sensors[k].history = [val, ...(zone.sensors[k].history || [])].slice(0, 100);
      }
    };
    ensure("tempC", temperature);
    ensure("rh", humidity);
    ensure("vpd", vpd);
    ensure("co2", co2);

    fs.writeFileSync(ENV_PATH, JSON.stringify(data, null, 2));
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Generic save endpoint for JSON files in public/data (e.g., groups.json, schedules.json, device-meta.json)
app.post("/data/:name", (req, res) => {
  try {
    const name = req.params.name || "";
    if (!name.endsWith(".json")) return res.status(400).json({ ok: false, error: "Only .json files allowed" });
    const full = path.join(DATA_DIR, path.basename(name));
    fs.writeFileSync(full, JSON.stringify(req.body, null, 2));
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`[charlie] running http://127.0.0.1:${PORT} → ${CTRL}`);
});
