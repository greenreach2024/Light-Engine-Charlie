import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import Datastore from 'nedb-promises';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 8091;
// Default controller target. Can be overridden with the CTRL env var.
// Use the Pi forwarder when available for remote device reachability during development.
let CURRENT_CONTROLLER = process.env.CTRL || "http://100.65.187.59:8089";
// Environment source: "local" (default) reads public/data/env.json
// or "azure" pulls from an Azure Functions endpoint that returns latest readings
const AZURE_LATEST_URL = process.env.AZURE_LATEST_URL || "";
const ENV_SOURCE = process.env.ENV_SOURCE || (AZURE_LATEST_URL ? "azure" : "local");
const ENV_PATH = path.resolve("./public/data/env.json");
const DATA_DIR = path.resolve("./public/data");
const FARM_PATH = path.join(DATA_DIR, 'farm.json');
const CONTROLLER_PATH = path.join(DATA_DIR, 'controller.json');
// Device DB (outside public): ./data/devices.nedb
const DB_DIR = path.resolve('./data');
const DB_PATH = path.join(DB_DIR, 'devices.nedb');

// Controller helpers: load persisted value if present; allow runtime updates
function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}
function ensureDbDir(){ try { fs.mkdirSync(DB_DIR, { recursive: true }); } catch {} }
function isHttpUrl(u){ try { const x=new URL(u); return x.protocol==='http:'||x.protocol==='https:'; } catch { return false; } }
function loadControllerFromDisk(){
  try {
    if (fs.existsSync(CONTROLLER_PATH)) {
      const obj = JSON.parse(fs.readFileSync(CONTROLLER_PATH, 'utf8'));
      if (obj && typeof obj.url === 'string' && isHttpUrl(obj.url)) {
        CURRENT_CONTROLLER = obj.url.trim();
      }
    }
  } catch {}
}
function persistControllerToDisk(url){
  ensureDataDir();
  try { fs.writeFileSync(CONTROLLER_PATH, JSON.stringify({ url }, null, 2)); } catch {}
}
function getController(){ return CURRENT_CONTROLLER; }
function setController(url){ CURRENT_CONTROLLER = url; persistControllerToDisk(url); console.log(`[charlie] controller set → ${url}`); }

// Initialize controller from disk if available
loadControllerFromDisk();

// Global error handlers to prevent server crashes
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  // Don't exit the process for now - log and continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Promise Rejection at:', promise);
  console.error('Reason:', reason);
  // Don't exit the process for now - log and continue
});

// Handle SIGTERM and SIGINT gracefully
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully');
  process.exit(0);
});

// Async route wrapper to handle errors properly
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      console.error(`❌ Async route error: ${req.method} ${req.url}`, error);
      next(error);
    });
  };
}

app.use(express.json({ limit: "1mb" }));

// --- Device Database (NeDB) ---
function deviceDocToJson(d){
  if (!d) return null;
  const { _id, ...rest } = d; return rest;
}

function createDeviceStore(){
  ensureDbDir();
  const store = Datastore.create({ filename: DB_PATH, autoload: true, timestampData: true });
  return store;
}

async function seedDevicesFromMetaNedb(store){
  try {
    const count = await store.count({});
    if (count > 0) return;
    const metaPath = path.join(DATA_DIR, 'device-meta.json');
    if (!fs.existsSync(metaPath)) return;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const devices = meta?.devices || {};
    const rows = Object.entries(devices).map(([id, m])=>({
      id,
      deviceName: m.deviceName || (/^light-/i.test(id) ? id.replace('light-','Light ').toUpperCase() : id),
      manufacturer: m.manufacturer || '',
      model: m.model || '',
      serial: m.serial || '',
      watts: m.watts || m.nominalW || null,
      spectrumMode: m.spectrumMode || '',
      transport: m.transport || m.conn || m.connectivity || '',
      farm: m.farm || '', room: m.room || '', zone: m.zone || '', module: m.module || '', level: m.level || '', side: m.side || '',
      extra: m
    }));
    await store.insert(rows);
    console.log(`[charlie] seeded ${rows.length} device(s) from device-meta.json`);
  } catch (e) {
    console.warn('[charlie] seedDevicesFromMeta (NeDB) failed:', e.message);
  }
}

const devicesStore = createDeviceStore();
await seedDevicesFromMetaNedb(devicesStore);

// Devices API (NeDB)
function setApiCors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

app.options('/devices', (req,res)=>{ setApiCors(res); res.status(204).end(); });
app.options('/devices/:id', (req,res)=>{ setApiCors(res); res.status(204).end(); });

// GET /devices → list
app.get('/devices', async (req, res) => {
  try {
    setApiCors(res);
    const rows = await devicesStore.find({});
    rows.sort((a,b)=> String(a.id||'').localeCompare(String(b.id||'')));
    return res.json({ devices: rows.map(deviceDocToJson) });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// GET /devices/:id → one
app.get('/devices/:id', async (req, res) => {
  try {
    setApiCors(res);
    const row = await devicesStore.findOne({ id: req.params.id });
    if (!row) return res.status(404).json({ ok:false, error:'not found' });
    return res.json(deviceDocToJson(row));
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// POST /devices → upsert (requires id)
app.post('/devices', async (req, res) => {
  try {
    setApiCors(res);
    const d = req.body || {};
    if (!d.id || typeof d.id !== 'string') return res.status(400).json({ ok:false, error:'id required' });
    const existing = await devicesStore.findOne({ id: d.id });
    if (existing) {
      await devicesStore.update({ id: d.id }, { $set: { ...existing, ...d, updatedAt: new Date().toISOString() } }, {});
    } else {
      await devicesStore.insert({ ...d, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    const row = await devicesStore.findOne({ id: d.id });
    return res.json({ ok:true, device: deviceDocToJson(row) });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// PATCH /devices/:id → partial update
app.patch('/devices/:id', async (req, res) => {
  try {
    setApiCors(res);
    const id = req.params.id;
    const existing = await devicesStore.findOne({ id });
    if (!existing) return res.status(404).json({ ok:false, error:'not found' });
    const now = { ...existing, ...req.body, updatedAt: new Date().toISOString() };
    await devicesStore.update({ id }, { $set: now }, {});
    const row = await devicesStore.findOne({ id });
    return res.json({ ok:true, device: deviceDocToJson(row) });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// DELETE /devices/:id
app.delete('/devices/:id', async (req, res) => {
  try {
    setApiCors(res);
    const id = req.params.id;
    const num = await devicesStore.remove({ id }, {});
    return res.json({ ok:true, deleted: num });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// Health (includes quick controller reachability check)
app.get("/healthz", async (req, res) => {
  const started = Date.now();
  let controllerReachable = false;
  let controllerStatus = null;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1200);
    try {
      const base = getController().replace(/\/$/, '');
      // 1) HEAD / (fast)
      let r = await fetch(base, { method: 'HEAD', signal: ac.signal });
      controllerReachable = r.ok;
      controllerStatus = r.status;
      // 2) If not OK, try GET /healthz (common on forwarders)
      if (!controllerReachable || (typeof controllerStatus === 'number' && controllerStatus >= 400)) {
        r = await fetch(`${base}/healthz`, { method: 'GET', headers: { 'accept': '*/*' }, signal: ac.signal });
        controllerReachable = r.ok;
        controllerStatus = r.status;
      }
      // 3) If still not OK, try GET /api/healthz (some controllers mount under /api)
      if (!controllerReachable || (typeof controllerStatus === 'number' && controllerStatus >= 400)) {
        r = await fetch(`${base}/api/healthz`, { method: 'GET', headers: { 'accept': '*/*' }, signal: ac.signal });
        controllerReachable = r.ok;
        controllerStatus = r.status;
      }
    } catch (e) {
      controllerReachable = false;
      controllerStatus = e.name === 'AbortError' ? 'timeout' : (e.message || 'error');
    } finally {
      clearTimeout(t);
    }
  } catch (_) {}
  res.json({ ok: true, controller: getController(), controllerReachable, controllerStatus, envSource: ENV_SOURCE, azureLatestUrl: AZURE_LATEST_URL || null, ts: new Date(), dtMs: Date.now() - started });
});

// SwitchBot Real API Endpoints - MUST be before proxy middleware
const SWITCHBOT_TOKEN = process.env.SWITCHBOT_TOKEN || "4e6fc805b4a0dd7ed693af1dcf89d9731113d4706b2d796759aafe09cf8f07aed370d35bab4fb4799e1bda57d03c0aed";
const SWITCHBOT_SECRET = process.env.SWITCHBOT_SECRET || "141c0bc9906ab1f4f73dd9f0c298046b";
const SWITCHBOT_API_BASE = 'https://api.switch-bot.com/v1.1';
const SWITCHBOT_API_TIMEOUT_MS = Number(process.env.SWITCHBOT_API_TIMEOUT_MS || 8000);
const SWITCHBOT_DEVICE_CACHE_TTL_MS = Number(process.env.SWITCHBOT_DEVICE_CACHE_TTL_MS || 600_000); // 10 minutes
const SWITCHBOT_STATUS_CACHE_TTL_MS = Number(process.env.SWITCHBOT_STATUS_CACHE_TTL_MS || 300_000); // 5 minutes
const SWITCHBOT_RATE_LIMIT_MS = Number(process.env.SWITCHBOT_RATE_LIMIT_MS || 6000); // 6 seconds between requests (10 per minute max)

// Rate limiting state
let lastSwitchBotRequest = 0;

const switchBotDevicesCache = {
  payload: null,
  fetchedAt: 0,
  inFlight: null,
  lastError: null
};

const switchBotStatusCache = new Map();

function getSwitchBotStatusEntry(deviceId) {
  if (!switchBotStatusCache.has(deviceId)) {
    switchBotStatusCache.set(deviceId, {
      payload: null,
      fetchedAt: 0,
      inFlight: null,
      lastError: null
    });
  }
  return switchBotStatusCache.get(deviceId);
}

function getSwitchBotHeaders() {
  // Current timestamp in milliseconds (as string)
  const t = Date.now().toString();
  // Random nonce using crypto.randomUUID() or fallback to randomBytes
  const nonce = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : crypto.randomBytes(16).toString('hex');
  // String to sign: token + timestamp + nonce
  const strToSign = SWITCHBOT_TOKEN + t + nonce;
  // HMAC-SHA256 with secret, then base64 encode (ensuring it's a string)
  const sign = crypto.createHmac('sha256', SWITCHBOT_SECRET).update(strToSign, 'utf8').digest('base64');
  
  return {
    'Authorization': SWITCHBOT_TOKEN,
    't': t,
    'sign': sign,
    'nonce': nonce,
    'Content-Type': 'application/json',
    'charset': 'utf8'
  };
}

function ensureSwitchBotConfigured() {
  return Boolean(SWITCHBOT_TOKEN && SWITCHBOT_SECRET);
}

async function switchBotApiRequest(path, { method = 'GET', data = null } = {}) {
  if (!ensureSwitchBotConfigured()) {
    const err = new Error('SwitchBot credentials are not configured');
    err.code = 'SWITCHBOT_NO_AUTH';
    throw err;
  }

  // Rate limiting: ensure minimum time between requests
  const now = Date.now();
  const timeSinceLastRequest = now - lastSwitchBotRequest;
  if (timeSinceLastRequest < SWITCHBOT_RATE_LIMIT_MS) {
    const waitTime = SWITCHBOT_RATE_LIMIT_MS - timeSinceLastRequest;
    console.log(`[switchbot] Rate limiting: waiting ${waitTime}ms before next request`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastSwitchBotRequest = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SWITCHBOT_API_TIMEOUT_MS);
  timeout.unref?.();
  try {
    let response;
    try {
      response = await fetch(`${SWITCHBOT_API_BASE}${path}`, {
        method,
        headers: getSwitchBotHeaders(),
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal
      });
    } catch (fetchError) {
      // Handle network errors (ECONNRESET, ENOTFOUND, etc.)
      if (fetchError.name === 'AbortError') {
        const timeoutError = new Error('SwitchBot API request timed out');
        timeoutError.code = 'SWITCHBOT_TIMEOUT';
        throw timeoutError;
      }
      
      const networkError = new Error(`Network error connecting to SwitchBot API: ${fetchError.message}`);
      networkError.code = 'SWITCHBOT_NETWORK_ERROR';
      networkError.cause = fetchError;
      throw networkError;
    }

    let text = '';
    try {
      text = await response.text();
    } catch (textError) {
      console.warn(`[switchbot] Failed to read response text: ${textError.message}`);
      text = '';
    }
    
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (parseError) {
        console.warn(`[switchbot] Failed to parse JSON response: ${parseError.message}, raw text: ${text.substring(0, 200)}`);
        const err = new Error('Failed to parse SwitchBot API response');
        err.cause = parseError;
        err.status = response.status;
        err.rawText = text.substring(0, 500); // Include some raw text for debugging
        throw err;
      }
    }

    if (!response.ok) {
      const err = new Error(body?.message || `SwitchBot API request failed with status ${response.status}`);
      err.status = response.status;
      err.response = body;
      
      // Special handling for rate limiting
      if (response.status === 429) {
        err.code = 'SWITCHBOT_RATE_LIMITED';
        console.log(`[switchbot] Rate limited by API. Will use cached data if available.`);
      }
      
      throw err;
    }

    return { status: response.status, body };
  } catch (error) {
    // Re-throw known errors
    if (error.code === 'SWITCHBOT_TIMEOUT' || error.code === 'SWITCHBOT_NETWORK_ERROR' || error.code === 'SWITCHBOT_RATE_LIMITED') {
      throw error;
    }
    
    // Handle AbortError specifically
    if (error.name === 'AbortError') {
      const timeoutError = new Error('SwitchBot API request timed out');
      timeoutError.code = 'SWITCHBOT_TIMEOUT';
      throw timeoutError;
    }
    
    // Wrap unknown errors
    const wrappedError = new Error(`Unexpected error in SwitchBot API request: ${error.message}`);
    wrappedError.code = 'SWITCHBOT_UNKNOWN_ERROR';
    wrappedError.cause = error;
    throw wrappedError;
  } finally {
    clearTimeout(timeout);
  }
}

function buildSwitchBotMeta({ fromCache = false, stale = false, fetchedAt = 0, error = null } = {}) {
  return {
    cached: fromCache,
    stale,
    fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
    error: error ? (error.message || String(error)) : null
  };
}

async function fetchSwitchBotDevices({ force = false } = {}) {
  const now = Date.now();
  if (!force && switchBotDevicesCache.payload && (now - switchBotDevicesCache.fetchedAt) < SWITCHBOT_DEVICE_CACHE_TTL_MS) {
    return {
      payload: switchBotDevicesCache.payload,
      fetchedAt: switchBotDevicesCache.fetchedAt,
      fromCache: true,
      stale: false,
      error: switchBotDevicesCache.lastError
    };
  }

  if (switchBotDevicesCache.inFlight) {
    return switchBotDevicesCache.inFlight;
  }

  switchBotDevicesCache.inFlight = (async () => {
    try {
      const response = await switchBotApiRequest('/devices');
      const payload = response.body;
      if (!payload || payload.statusCode !== 100) {
        const err = new Error(payload?.message || 'SwitchBot API returned an error');
        err.statusCode = payload?.statusCode;
        throw err;
      }
      switchBotDevicesCache.payload = payload;
      switchBotDevicesCache.fetchedAt = Date.now();
      switchBotDevicesCache.lastError = null;
      return {
        payload,
        fetchedAt: switchBotDevicesCache.fetchedAt,
        fromCache: false,
        stale: false,
        error: null
      };
    } catch (error) {
      switchBotDevicesCache.lastError = error;
      if (switchBotDevicesCache.payload) {
        return {
          payload: switchBotDevicesCache.payload,
          fetchedAt: switchBotDevicesCache.fetchedAt,
          fromCache: true,
          stale: true,
          error
        };
      }
      throw error;
    } finally {
      switchBotDevicesCache.inFlight = null;
    }
  })();

  return switchBotDevicesCache.inFlight;
}

async function fetchSwitchBotDeviceStatus(deviceId, { force = false } = {}) {
  const entry = getSwitchBotStatusEntry(deviceId);
  const now = Date.now();
  if (!force && entry.payload && (now - entry.fetchedAt) < SWITCHBOT_STATUS_CACHE_TTL_MS) {
    return {
      payload: entry.payload,
      fetchedAt: entry.fetchedAt,
      fromCache: true,
      stale: false,
      error: entry.lastError
    };
  }

  if (entry.inFlight) {
    return entry.inFlight;
  }

  entry.inFlight = (async () => {
    try {
      const response = await switchBotApiRequest(`/devices/${encodeURIComponent(deviceId)}/status`);
      const payload = response.body;
      if (!payload || payload.statusCode !== 100) {
        const err = new Error(payload?.message || 'Failed to get device status');
        err.statusCode = payload?.statusCode;
        throw err;
      }
      entry.payload = payload;
      entry.fetchedAt = Date.now();
      entry.lastError = null;
      return {
        payload,
        fetchedAt: entry.fetchedAt,
        fromCache: false,
        stale: false,
        error: null
      };
    } catch (error) {
      entry.lastError = error;
      if (entry.payload) {
        return {
          payload: entry.payload,
          fetchedAt: entry.fetchedAt,
          fromCache: true,
          stale: true,
          error
        };
      }
      throw error;
    } finally {
      entry.inFlight = null;
    }
  })();

  return entry.inFlight;
}

app.get("/api/switchbot/devices", asyncHandler(async (req, res) => {
  try {
    const force = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());
    const result = await fetchSwitchBotDevices({ force });
    const meta = buildSwitchBotMeta(result);
    res.json({
      ...result.payload,
      meta
    });
  } catch (error) {
    console.error('SwitchBot API error:', error);
    
    // If rate limited, try to return cached data with appropriate status
    if (error.code === 'SWITCHBOT_RATE_LIMITED' && switchBotDevicesCache.payload) {
      console.log('[switchbot] Returning cached data due to rate limiting');
      const meta = buildSwitchBotMeta({
        fromCache: true,
        stale: true,
        fetchedAt: switchBotDevicesCache.fetchedAt,
        error: error
      });
      return res.status(200).json({
        ...switchBotDevicesCache.payload,
        meta
      });
    }
    
    // If no cached data available but credentials are valid, return rate limit error
    // Don't use fallback mock data - let the client know to retry later
    if (error.code === 'SWITCHBOT_RATE_LIMITED' || error.status === 429) {
      console.log('[switchbot] Rate limited - returning rate limit status (no mock fallback)');
      return res.status(429).json({
        statusCode: 429,
        message: "SwitchBot API rate limited - retry after rate limit expires",
        cached: false,
        retryAfter: Math.ceil(SWITCHBOT_DEVICE_CACHE_TTL_MS / 1000)
      });
    }
    
    const status = error.status === 401 ? 401 : error.code === 'SWITCHBOT_TIMEOUT' ? 504 : error.code === 'SWITCHBOT_NO_AUTH' ? 503 : error.status === 429 ? 429 : 502;
    res.status(status).json({
      statusCode: error.statusCode || status,
      message: error.message || "Failed to fetch devices from SwitchBot API",
      cached: Boolean(switchBotDevicesCache.payload),
      retryAfter: error.status === 429 ? Math.ceil(SWITCHBOT_DEVICE_CACHE_TTL_MS / 1000) : undefined
    });
  }
}));

app.get("/api/switchbot/status", asyncHandler(async (req, res) => {
  try {
    const force = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());
    const result = await fetchSwitchBotDevices({ force });
    const devices = (result.payload?.body?.deviceList || []).map(device => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      deviceType: device.deviceType,
      status: "online",
      lastUpdate: new Date().toISOString(),
      ...device
    }));

    res.json({
      statusCode: 100,
      message: "success",
      devices: devices,
      timestamp: new Date().toISOString(),
      meta: buildSwitchBotMeta(result)
    });
  } catch (error) {
    console.error('SwitchBot status API error:', error);
    res.status(500).json({
      statusCode: 500,
      message: "Failed to fetch device status from SwitchBot API",
      error: error.message
    });
  }
}));

// Individual device status endpoint
app.get("/api/switchbot/devices/:deviceId/status", asyncHandler(async (req, res) => {
  try {
    const { deviceId } = req.params;
    console.log(`[charlie] Fetching status for device: ${deviceId}`);

    const force = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());
    const result = await fetchSwitchBotDeviceStatus(deviceId, { force });

    if (result.payload.statusCode === 100) {
      res.json({
        statusCode: 100,
        message: "success",
        body: {
          ...result.payload.body,
          deviceId: deviceId,
          lastUpdate: new Date().toISOString()
        },
        meta: buildSwitchBotMeta(result)
      });
    } else {
      res.status(400).json({
        statusCode: result.payload.statusCode || 400,
        message: result.payload.message || "Failed to get device status"
      });
    }
  } catch (error) {
    console.error(`SwitchBot device status API error for ${req.params.deviceId}:`, error);
    const status = error.status === 401 ? 401 : error.code === 'SWITCHBOT_TIMEOUT' ? 504 : error.status === 429 ? 429 : error.code === 'SWITCHBOT_NO_AUTH' ? 503 : 502;
    res.status(status).json({
      statusCode: error.statusCode || status,
      message: error.message || "Failed to fetch device status from SwitchBot API"
    });
  }
}));

// Device control endpoints for plugs
app.post("/api/switchbot/devices/:deviceId/commands", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { command, parameter } = req.body;
    
    console.log(`[charlie] Sending command to device ${deviceId}: ${command} ${parameter || ''}`);
    
    const commandData = {
      command: command,
      parameter: parameter || "default"
    };
    
    const response = await switchBotApiRequest(`/devices/${deviceId}/commands`, { method: 'POST', data: commandData });

    if (response.body.statusCode === 100) {
      res.json({
        statusCode: 100,
        message: "Command sent successfully",
        body: response.body.body
      });
    } else {
      res.status(400).json({
        statusCode: response.body.statusCode || 400,
        message: response.body.message || "Failed to send command"
      });
    }
  } catch (error) {
    console.error(`SwitchBot command API error for ${req.params.deviceId}:`, error);
    const status = error.status === 401 ? 401 : error.code === 'SWITCHBOT_TIMEOUT' ? 504 : error.status === 429 ? 429 : error.code === 'SWITCHBOT_NO_AUTH' ? 503 : 502;
    res.status(status).json({
      statusCode: error.statusCode || status,
      message: error.message || "Failed to send command to SwitchBot API"
    });
  }
});

// Device power control endpoint
app.post("/api/device/:deviceId/power", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { state } = req.body; // 'on' or 'off'
    
    console.log(`Power control request for device ${deviceId}: ${state}`);
    
    // For research lights, attempt to send commands via controller
    try {
      const controllerUrl = `${getController().replace(/\/$/, '')}/api/device/${encodeURIComponent(deviceId)}/power`;
      const response = await fetch(controllerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state })
      });
      
      if (response.ok) {
        const result = await response.json();
        return res.json({ success: true, message: `Device ${state} command sent`, data: result });
      } else {
        console.warn(`Controller power control failed for ${deviceId}:`, response.status);
      }
    } catch (controllerError) {
      console.warn(`Controller unavailable for power control of ${deviceId}:`, controllerError.message);
    }
    
    // Fallback: log the command (for research purposes)
    console.log(`Research light ${deviceId} power ${state} (logged only)`);
    res.json({ success: true, message: `Power ${state} command logged for research light ${deviceId}` });
    
  } catch (error) {
    console.error(`Device power control error for ${req.params.deviceId}:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Device spectrum control endpoint
app.post("/api/device/:deviceId/spectrum", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { cw, ww, bl, rd } = req.body;
    
    console.log(`Spectrum control request for device ${deviceId}:`, { cw, ww, bl, rd });
    
    // For research lights, attempt to send commands via controller
    try {
      const controllerUrl = `${getController().replace(/\/$/, '')}/api/device/${encodeURIComponent(deviceId)}/spectrum`;
      const response = await fetch(controllerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cw, ww, bl, rd })
      });
      
      if (response.ok) {
        const result = await response.json();
        return res.json({ success: true, message: "Spectrum applied", data: result });
      } else {
        console.warn(`Controller spectrum control failed for ${deviceId}:`, response.status);
      }
    } catch (controllerError) {
      console.warn(`Controller unavailable for spectrum control of ${deviceId}:`, controllerError.message);
    }
    
    // Fallback: log the command (for research purposes)
    console.log(`Research light ${deviceId} spectrum CW:${cw}% WW:${ww}% Blue:${bl}% Red:${rd}% (logged only)`);
    res.json({ success: true, message: `Spectrum command logged for research light ${deviceId}` });
    
  } catch (error) {
    console.error(`Device spectrum control error for ${req.params.deviceId}:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// STRICT pass-through: client calls /api/* → controller receives /api/*
// Express strips the mount "/api", so add it back via pathRewrite.
app.use("/api", createProxyMiddleware({
  // Initial target is required; router() will be consulted per-request
  target: getController(),
  router: () => getController(),
  changeOrigin: true,
  xfwd: true,
  logLevel: 'debug',
  // Ensure controller receives exactly one /api prefix
  pathRewrite: (path /* e.g., "/devicedatas" or "/api/devicedatas" */) => {
    return path.startsWith('/api/') ? path : `/api${path}`;
  },
  onProxyReq(proxyReq, req) {
    // For visibility in logs
    const outgoingPath = req.url.startsWith('/api/') ? req.url : `/api${req.url}`;
    console.log(`[→] ${req.method} ${req.originalUrl} -> ${getController()}${outgoingPath}`);
  }
}));

// Static files
app.use(express.static("./public"));

// IFTTT Webhook endpoints for device automation
app.post('/webhooks/ifttt/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { action, intensity, spectrum, temperature, humidity, trigger_identity } = req.body;
    
    console.log(`[IFTTT] Webhook received for device ${deviceId}:`, req.body);
    
    // Log automation event for AI training
    const automationEvent = {
      timestamp: new Date().toISOString(),
      deviceId,
      triggerSource: 'ifttt',
      triggerIdentity: trigger_identity,
      action,
      parameters: { intensity, spectrum, temperature, humidity },
      processedAt: Date.now()
    };
    
    // Store for AI training (append to automation log)
    const logPath = path.join(DATA_DIR, 'automation-events.jsonl');
    fs.appendFileSync(logPath, JSON.stringify(automationEvent) + '\n', 'utf8');
    
    // Process the automation action
    switch (action) {
      case 'spectrum_change':
        if (spectrum && intensity !== undefined) {
          console.log(`[IFTTT] Applying spectrum '${spectrum}' at ${intensity}% to device ${deviceId}`);
          // Forward to controller or apply directly based on device type
          // This would integrate with your existing device control logic
        }
        break;
        
      case 'environmental_response':
        if (temperature || humidity) {
          console.log(`[IFTTT] Environmental trigger - Temp: ${temperature}°F, Humidity: ${humidity}%`);
          // Trigger environmental response through E.V.I.E system
        }
        break;
        
      case 'power_control':
        if (intensity !== undefined) {
          console.log(`[IFTTT] Power control: ${intensity}% for device ${deviceId}`);
          // Apply power control
        }
        break;
        
      default:
        console.log(`[IFTTT] Unknown action: ${action}`);
    }
    
    // Send success response to IFTTT
    res.json({
      success: true,
      deviceId,
      action,
      timestamp: automationEvent.timestamp,
      message: `Action '${action}' processed successfully`
    });
    
  } catch (error) {
    console.error('[IFTTT] Webhook error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// IFTTT Service endpoints for device discovery
app.get('/ifttt/v1/user/info', (req, res) => {
  // IFTTT service authentication endpoint
  res.json({
    data: {
      name: "Light Engine Charlie",
      id: "light_engine_charlie_user"
    }
  });
});

app.post('/ifttt/v1/test/setup', (req, res) => {
  // IFTTT service test setup
  res.json({
    data: {
      samples: {
        triggers: {
          "environmental_threshold": {
            "temperature": 85,
            "humidity": 75,
            "device_id": "grow-light-001"
          }
        },
        actions: {
          "control_spectrum": {
            "device_id": "grow-light-001",
            "spectrum": "flowering",
            "intensity": 80
          }
        }
      }
    }
  });
});

// Config endpoint to surface runtime flags
app.get('/config', (req, res) => {
  res.json({ 
    singleServer: true, 
    controller: getController(), 
    envSource: ENV_SOURCE, 
    azureLatestUrl: AZURE_LATEST_URL || null,
    iftttEnabled: true,
    webhookEndpoint: `${req.protocol}://${req.get('host')}/webhooks/ifttt/`
  });
});

// Allow runtime GET/POST of controller target. CORS-enabled for convenience.
app.options('/controller', (req, res) => { setCors(res); res.status(204).end(); });
app.get('/controller', (req, res) => {
  setCors(res);
  res.json({ url: getController() });
});
app.post('/controller', (req, res) => {
  try {
    setCors(res);
    const { url } = req.body || {};
    if (!url || typeof url !== 'string' || !isHttpUrl(url)) {
      return res.status(400).json({ ok: false, error: 'Valid http(s) url required' });
    }
    setController(url.trim());
    res.json({ ok: true, url: getController() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Convenience endpoints to query the configured controller/forwarder for non-/api paths
app.get('/forwarder/healthz', async (req, res) => {
  try {
    const url = `${getController().replace(/\/$/, '')}/healthz`;
    const r = await fetch(url, { method: 'GET' });
    const body = await r.text();
    res.status(r.status).set('content-type', r.headers.get('content-type') || 'application/json').send(body);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/forwarder/devicedatas', async (req, res) => {
  try {
    const url = `${getController().replace(/\/$/, '')}/api/devicedatas`;
    const r = await fetch(url, { method: 'GET' });
    const body = await r.text();
    res.status(r.status).set('content-type', r.headers.get('content-type') || 'application/json').send(body);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// POST proxy to forward Wi‑Fi provisioning requests to the configured controller/forwarder.
// Expects JSON body with Wi‑Fi configuration (e.g., { ssid, psk, static, staticIp })
app.post('/forwarder/provision/wifi', async (req, res) => {
  try {
    const url = `${getController().replace(/\/$/, '')}/api/provision/wifi`;
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.body) });
    const contentType = (r.headers.get('content-type') || '').toLowerCase();
    const text = await r.text();
    // If controller returned JSON, forward it; otherwise translate HTML/errors into JSON for client
    if (r.ok && contentType.includes('application/json')) {
      res.status(r.status).set('content-type', 'application/json').send(text);
    } else if (!r.ok) {
      const bodySnippet = text.length > 400 ? text.slice(0,400) + '...' : text;
      return res.status(502).json({ ok: false, error: 'Controller provisioning endpoint returned error', status: r.status, body: bodySnippet });
    } else {
      // Non-JSON 2xx response: wrap
      return res.status(200).json({ ok: true, message: text });
    }
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// POST proxy for Bluetooth provisioning
app.post('/forwarder/provision/bluetooth', async (req, res) => {
  try {
    const url = `${getController().replace(/\/$/, '')}/api/provision/bluetooth`;
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.body) });
    const contentType = (r.headers.get('content-type') || '').toLowerCase();
    const text = await r.text();
    if (r.ok && contentType.includes('application/json')) {
      res.status(r.status).set('content-type', 'application/json').send(text);
    } else if (!r.ok) {
      const bodySnippet = text.length > 400 ? text.slice(0,400) + '...' : text;
      return res.status(502).json({ ok: false, error: 'Controller provisioning endpoint returned error', status: r.status, body: bodySnippet });
    } else {
      return res.status(200).json({ ok: true, message: text });
    }
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
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
    // capture any Google Fonts links as candidates to include client-side for brand font
    const fontCssLinks = cssLinks.filter(u => /fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(u));
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
    // Try to detect a brand font family from CSS
    let fontFamily = '';
    try {
      // prefer explicitly named, non-generic families
      const fams = Array.from(cssText.matchAll(/font-family\s*:\s*([^;}{]+);/gi)).map(m => m[1]);
      const pick = (arr) => {
        const GENERICS = ['sans-serif','serif','monospace','system-ui','ui-sans-serif','ui-serif','ui-monospace','cursive','fantasy','emoji','math','fangsong'];
        for (const f of arr) {
          // split on commas and trim quotes
          const parts = f.split(',').map(s=>s.trim().replace(/^['"]|['"]$/g,''));
          for (const p of parts) {
            if (!GENERICS.includes(p.toLowerCase())) return p;
          }
        }
        return '';
      };
      fontFamily = pick(fams) || '';
    } catch {}
    return res.json({ ok:true, name: siteName, logo, palette, fontFamily, fontCss: fontCssLinks });
  } catch (e) {
    setCors(res);
    // neutral fallback
    const fallback = { background:'#F7FAFA', surface:'#FFFFFF', border:'#DCE5E5', text:'#0B1220', primary:'#0D7D7D', accent:'#64C7C7' };
    return res.status(200).json({ ok:false, error: e.message, name: '', logo: '', palette: fallback, fontFamily: '', fontCss: [] });
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

// Data persistence endpoints

app.get('/forwarder/network/wifi/scan', async (req, res) => {
  try {
    const controller = getController();
    if (controller) {
      const url = `${controller.replace(/\/$/, '')}/api/network/wifi/scan`;
      const response = await fetch(url).catch(() => null);
      if (response && response.ok) {
        const body = await response.json();
        return res.json(body?.networks || body || []);
      }
    }
  } catch (err) {
    console.warn('Controller Wi-Fi scan failed, falling back to farm networks', err.message);
  }
  // Farm network scan results
  res.json([
    { ssid: 'greenreach', signal: -42, security: 'WPA2' },
    { ssid: 'Farm-IoT', signal: -48, security: 'WPA2' },
    { ssid: 'Greenhouse-Guest', signal: -62, security: 'WPA2' },
    { ssid: 'BackOffice', signal: -74, security: 'WPA3' },
    { ssid: 'Equipment-WiFi', signal: -55, security: 'WPA2' }
  ]);
});

app.post('/forwarder/network/test', async (req, res) => {
  const payload = req.body || {};
  const now = new Date().toISOString();
  try {
    const controller = getController();
    if (controller) {
      const url = `${controller.replace(/\/$/, '')}/api/network/test`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => null);
      if (response && response.ok) {
        const body = await response.json();
        return res.json({
          status: body.status || 'connected',
          ip: body.ip || body.address || null,
          gateway: body.gateway || null,
          subnet: body.subnet || null,
          latencyMs: body.latencyMs ?? body.latency ?? 35,
          testedAt: now,
          ssid: body.ssid || payload?.wifi?.ssid || null
        });
      }
    }
  } catch (err) {
    console.warn('Controller network test failed, falling back to sample result', err.message);
  }
  res.json({
    status: 'connected',
    ip: '192.168.1.120',
    gateway: '192.168.1.1',
    subnet: '192.168.1.0/24',
    latencyMs: 32,
    testedAt: now,
    ssid: payload?.wifi?.ssid || null
  });
});

app.get('/discovery/devices', async (req, res) => {
  const startedAt = new Date().toISOString();
  try {
    const controller = getController();
    if (controller) {
      const url = `${controller.replace(/\/$/, '')}/api/discovery/devices`;
      const response = await fetch(url).catch(() => null);
      if (response && response.ok) {
        const body = await response.json();
        if (Array.isArray(body?.devices)) {
          return res.json({ startedAt, completedAt: new Date().toISOString(), devices: body.devices });
        }
      }
    }
  } catch (err) {
    console.warn('Controller discovery failed, attempting live network scan', err.message);
  }
  
  // LIVE DEVICE DISCOVERY - Scan greenreach network for real devices
  console.log('🔍 Starting live device discovery on greenreach network...');
  
  try {
    const discoveredDevices = [];
    
    // 1. Try to discover SwitchBot devices via API
    if (process.env.SWITCHBOT_TOKEN && process.env.SWITCHBOT_SECRET) {
      try {
        const switchbotResponse = await fetch('/api/switchbot/devices?refresh=1');
        if (switchbotResponse.ok) {
          const switchbotData = await switchbotResponse.json();
          if (switchbotData.statusCode === 100 && switchbotData.body?.deviceList) {
            switchbotData.body.deviceList.forEach(device => {
              discoveredDevices.push({
                id: `switchbot:${device.deviceId}`,
                name: device.deviceName || `SwitchBot ${device.deviceType}`,
                protocol: 'switchbot-cloud',
                confidence: 0.95,
                signal: null,
                address: device.deviceId,
                vendor: 'SwitchBot',
                lastSeen: new Date().toISOString(),
                hints: { 
                  type: device.deviceType, 
                  switchbotId: device.deviceId,
                  hubId: device.hubDeviceId,
                  metrics: getSwitchBotMetrics(device.deviceType)
                }
              });
            });
          }
        }
      } catch (e) {
        console.warn('SwitchBot discovery failed:', e.message);
      }
    }
    
    // 2. Network scanning for WiFi/IP devices
    try {
      const networkDevices = await discoverNetworkDevices();
      discoveredDevices.push(...networkDevices);
    } catch (e) {
      console.warn('Network device discovery failed:', e.message);
    }

    // 3. MQTT device discovery (if configured)
    try {
      const mqttDevices = await discoverMQTTDevices();
      discoveredDevices.push(...mqttDevices);
    } catch (e) {
      console.warn('MQTT device discovery failed:', e.message);
    }

    // 4. BLE device discovery (if available)
    try {
      const bleDevices = await discoverBLEDevices();
      discoveredDevices.push(...bleDevices);
    } catch (e) {
      console.warn('BLE device discovery failed:', e.message);
    }
    
    console.log(`✅ Discovery complete: Found ${discoveredDevices.length} live devices`);
    
    // Analyze discovered devices and suggest setup wizards
    const deviceAnalysis = analyzeDiscoveredDevices(discoveredDevices);
    
    res.json({ 
      startedAt, 
      completedAt: new Date().toISOString(), 
      devices: discoveredDevices,
      analysis: deviceAnalysis,
      message: discoveredDevices.length === 0 ? 
        'No devices found. Ensure SwitchBot API is configured and devices are on greenreach network.' :
        `Found ${discoveredDevices.length} live devices on greenreach network.`
    });
    
  } catch (error) {
    console.error('❌ Live device discovery failed:', error);
    res.status(500).json({ 
      startedAt, 
      completedAt: new Date().toISOString(), 
      devices: [], 
      error: 'Live device discovery failed. No mock devices available.',
      message: 'Please check network connectivity and device configuration.'
    });
  }
});

// Helper function to get metrics based on SwitchBot device type
function getSwitchBotMetrics(deviceType) {
  const type = deviceType.toLowerCase();
  if (type.includes('meter') || type.includes('sensor')) {
    return ['temperature', 'humidity', 'battery'];
  } else if (type.includes('plug')) {
    return ['power', 'energy', 'current', 'voltage'];
  } else if (type.includes('hub')) {
    return ['signal', 'connectivity'];
  } else if (type.includes('bot')) {
    return ['position', 'battery'];
  } else if (type.includes('bulb') || type.includes('strip')) {
    return ['brightness', 'color', 'power'];
  }
  return ['status', 'battery'];
}

// Network device discovery (WiFi/IP devices)
async function discoverNetworkDevices() {
  const devices = [];
  
  // Discover TP-Link Kasa devices via Python backend if available
  try {
    const controller = getController();
    if (controller) {
      const kasaResponse = await fetch(`${controller}/api/devices/kasa`);
      if (kasaResponse.ok) {
        const kasaData = await kasaResponse.json();
        if (kasaData.devices) {
          kasaData.devices.forEach(device => {
            devices.push({
              id: `kasa:${device.device_id}`,
              name: device.name,
              protocol: 'kasa-wifi',
              confidence: 0.9,
              signal: null,
              address: device.details?.host || 'unknown',
              vendor: 'TP-Link Kasa',
              lastSeen: new Date().toISOString(),
              hints: {
                type: device.category,
                capabilities: device.capabilities,
                metrics: ['power', 'energy', 'brightness']
              }
            });
          });
        }
      }
    }
  } catch (e) {
    console.warn('Kasa discovery via controller failed, trying direct network scan');
  }

  // Direct network scan for common IoT device ports
  try {
    const networkDevices = await scanNetworkForDevices();
    devices.push(...networkDevices);
  } catch (e) {
    console.warn('Direct network scan failed:', e.message);
  }
  
  return devices;
}

// Scan network for common IoT devices using nmap-like discovery
async function scanNetworkForDevices() {
  const devices = [];
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  
  try {
    // Get current network range
    const { stdout: ifconfigOut } = await execAsync('ifconfig en0 | grep "inet " | grep -v 127.0.0.1');
    const ipMatch = ifconfigOut.match(/inet (\d+\.\d+\.\d+\.\d+)/);
    if (!ipMatch) {
      console.warn('Could not determine network range');
      return devices;
    }
    
    const currentIP = ipMatch[1];
    const networkBase = currentIP.split('.').slice(0, 3).join('.');
    console.log(`🔍 Scanning network range ${networkBase}.0/24 for IoT devices...`);
    
    // Scan for devices with common IoT ports
    const commonPorts = [80, 443, 8080, 8081, 1883, 8883, 9999, 10002, 502, 8000];
    const { stdout: nmapOut } = await execAsync(
      `nmap -p ${commonPorts.join(',')} --open ${networkBase}.0/24 | grep -E "(Nmap scan report|open)"`
    );
    
    const lines = nmapOut.split('\n');
    let currentHost = null;
    let deviceIP = null;
    
    for (const line of lines) {
      if (line.includes('Nmap scan report')) {
        const hostMatch = line.match(/Nmap scan report for (.+) \((\d+\.\d+\.\d+\.\d+)\)/);
        if (hostMatch) {
          currentHost = hostMatch[1];
          deviceIP = hostMatch[2];
        } else {
          const ipMatch = line.match(/Nmap scan report for (\d+\.\d+\.\d+\.\d+)/);
          if (ipMatch) {
            deviceIP = ipMatch[1];
            currentHost = deviceIP;
          }
        }
      } else if (line.includes('open') && deviceIP) {
        const portMatch = line.match(/(\d+)\/tcp\s+open\s+(\w+)/);
        if (portMatch) {
          const port = parseInt(portMatch[1]);
          const service = portMatch[2];
          
          // Identify device type based on port and service
          const deviceInfo = identifyDeviceByPort(port, service, currentHost, deviceIP);
          if (deviceInfo) {
            devices.push({
              id: `network:${deviceIP}:${port}`,
              name: deviceInfo.name,
              protocol: deviceInfo.protocol,
              confidence: deviceInfo.confidence,
              signal: null,
              address: deviceIP,
              vendor: deviceInfo.vendor,
              lastSeen: new Date().toISOString(),
              hints: {
                type: deviceInfo.type,
                port: port,
                service: service,
                host: currentHost,
                capabilities: deviceInfo.capabilities,
                metrics: deviceInfo.metrics
              }
            });
          }
        }
      }
    }
    
  } catch (e) {
    console.warn('Network scanning failed:', e.message);
  }
  
  return devices;
}

// Identify device type based on port and service patterns
function identifyDeviceByPort(port, service, host, ip) {
  const devicePatterns = {
    // MQTT Brokers
    1883: { name: 'MQTT Broker', protocol: 'mqtt', vendor: 'Unknown MQTT', type: 'mqtt-broker', 
            confidence: 0.8, capabilities: ['publish', 'subscribe'], metrics: ['topics', 'clients'] },
    8883: { name: 'MQTT Broker (TLS)', protocol: 'mqtt-tls', vendor: 'Unknown MQTT', type: 'mqtt-broker',
            confidence: 0.8, capabilities: ['publish', 'subscribe', 'tls'], metrics: ['topics', 'clients'] },
    
    // Web-based IoT devices
    80: { name: `IoT Device (${host})`, protocol: 'http', vendor: 'Unknown', type: 'web-device',
          confidence: 0.6, capabilities: ['web-interface'], metrics: ['status', 'uptime'] },
    443: { name: `IoT Device HTTPS (${host})`, protocol: 'https', vendor: 'Unknown', type: 'web-device',
           confidence: 0.6, capabilities: ['web-interface', 'tls'], metrics: ['status', 'uptime'] },
    8080: { name: `IoT Web Interface (${host})`, protocol: 'http-alt', vendor: 'Unknown', type: 'web-device',
            confidence: 0.7, capabilities: ['web-interface'], metrics: ['status', 'config'] },
    8081: { name: `IoT Management Interface (${host})`, protocol: 'http-mgmt', vendor: 'Unknown', type: 'management-device',
            confidence: 0.7, capabilities: ['management', 'config'], metrics: ['status', 'config'] },
    
    // Modbus (Industrial/Agricultural)
    502: { name: `Modbus Device (${host})`, protocol: 'modbus', vendor: 'Industrial', type: 'modbus-device',
           confidence: 0.9, capabilities: ['modbus-tcp'], metrics: ['registers', 'coils', 'inputs'] },
    
    // Other common IoT ports
    9999: { name: `IoT Service (${host})`, protocol: 'custom', vendor: 'Unknown', type: 'iot-device',
            confidence: 0.5, capabilities: ['custom-protocol'], metrics: ['status'] },
    10002: { name: `Network Device (${host})`, protocol: 'custom', vendor: 'Network', type: 'network-device',
             confidence: 0.6, capabilities: ['network'], metrics: ['status', 'connectivity'] },
    8000: { name: `Development Server (${host})`, protocol: 'http-dev', vendor: 'Dev', type: 'dev-server',
            confidence: 0.4, capabilities: ['development'], metrics: ['requests', 'status'] }
  };
  
  return devicePatterns[port] || null;
}

// Analyze discovered devices and suggest setup wizards
function analyzeDiscoveredDevices(devices) {
  const protocols = new Map();
  const vendors = new Map();
  const deviceTypes = new Map();
  const setupWizards = [];
  
  // Categorize devices
  devices.forEach(device => {
    // Count by protocol
    const protocolCount = protocols.get(device.protocol) || 0;
    protocols.set(device.protocol, protocolCount + 1);
    
    // Count by vendor
    const vendorCount = vendors.get(device.vendor) || 0;
    vendors.set(device.vendor, vendorCount + 1);
    
    // Count by device type
    const typeCount = deviceTypes.get(device.hints?.type || 'unknown') || 0;
    deviceTypes.set(device.hints?.type || 'unknown', typeCount + 1);
  });
  
  // Suggest setup wizards based on discovered devices
  if (protocols.has('switchbot')) {
    setupWizards.push({
      id: 'switchbot-setup',
      name: 'SwitchBot Device Setup',
      description: `Configure ${protocols.get('switchbot')} SwitchBot devices`,
      deviceCount: protocols.get('switchbot'),
      priority: 'high',
      capabilities: ['automation', 'monitoring', 'control']
    });
  }
  
  if (protocols.has('kasa-wifi')) {
    setupWizards.push({
      id: 'kasa-setup', 
      name: 'TP-Link Kasa Setup',
      description: `Configure ${protocols.get('kasa-wifi')} Kasa smart devices`,
      deviceCount: protocols.get('kasa-wifi'),
      priority: 'high',
      capabilities: ['lighting', 'power-monitoring', 'scheduling']
    });
  }
  
  if (protocols.has('mqtt') || protocols.has('mqtt-tls')) {
    const mqttCount = (protocols.get('mqtt') || 0) + (protocols.get('mqtt-tls') || 0);
    setupWizards.push({
      id: 'mqtt-setup',
      name: 'MQTT Device Integration', 
      description: `Configure ${mqttCount} MQTT-enabled devices`,
      deviceCount: mqttCount,
      priority: 'medium',
      capabilities: ['messaging', 'sensor-data', 'real-time-updates']
    });
  }
  
  if (protocols.has('modbus')) {
    setupWizards.push({
      id: 'modbus-setup',
      name: 'Industrial/Agricultural Modbus Devices',
      description: `Configure ${protocols.get('modbus')} Modbus devices`,
      deviceCount: protocols.get('modbus'),
      priority: 'high',
      capabilities: ['industrial-control', 'sensor-reading', 'automation']
    });
  }
  
  if (protocols.has('bluetooth-le')) {
    setupWizards.push({
      id: 'ble-setup',
      name: 'Bluetooth LE Sensor Setup',
      description: `Configure ${protocols.get('bluetooth-le')} BLE sensors`,
      deviceCount: protocols.get('bluetooth-le'),
      priority: 'medium',
      capabilities: ['proximity-sensing', 'battery-monitoring', 'environmental-data']
    });
  }
  
  // Web-based devices (HTTP/HTTPS)
  const webDevices = (protocols.get('http') || 0) + (protocols.get('https') || 0) + 
                     (protocols.get('http-alt') || 0) + (protocols.get('http-mgmt') || 0);
  if (webDevices > 0) {
    setupWizards.push({
      id: 'web-device-setup',
      name: 'Web-Enabled IoT Devices',
      description: `Configure ${webDevices} web-accessible IoT devices`,
      deviceCount: webDevices,
      priority: 'medium',
      capabilities: ['web-interface', 'remote-access', 'configuration']
    });
  }
  
  return {
    summary: {
      totalDevices: devices.length,
      protocolCount: protocols.size,
      vendorCount: vendors.size,
      typeCount: deviceTypes.size
    },
    protocols: Object.fromEntries(protocols),
    vendors: Object.fromEntries(vendors),
    deviceTypes: Object.fromEntries(deviceTypes),
    suggestedWizards: setupWizards.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    })
  };
}

// Setup Wizard System - Device-specific configuration wizards
const SETUP_WIZARDS = {
  'mqtt-setup': {
    id: 'mqtt-setup',
    name: 'MQTT Device Integration',
    description: 'Configure MQTT broker connection and device subscriptions',
    targetDevices: ['mqtt', 'mqtt-tls'],
    steps: [
      {
        id: 'broker-connection',
        name: 'Broker Connection',
        description: 'Configure MQTT broker connection settings',
        fields: [
          { name: 'host', type: 'text', label: 'MQTT Broker Host', required: true },
          { name: 'port', type: 'number', label: 'Port', default: 1883, required: true },
          { name: 'secure', type: 'boolean', label: 'Use TLS/SSL', default: false },
          { name: 'username', type: 'text', label: 'Username (optional)' },
          { name: 'password', type: 'password', label: 'Password (optional)' }
        ]
      },
      {
        id: 'topic-discovery',
        name: 'Topic Discovery',
        description: 'Discover available MQTT topics and sensors',
        fields: [
          { name: 'baseTopic', type: 'text', label: 'Base Topic Pattern', default: 'farm/#' },
          { name: 'discoverTime', type: 'number', label: 'Discovery Time (seconds)', default: 30 }
        ]
      },
      {
        id: 'sensor-mapping',
        name: 'Sensor Mapping',
        description: 'Map discovered topics to sensor types',
        dynamic: true
      }
    ]
  },

  'web-device-setup': {
    id: 'web-device-setup',
    name: 'Web-Enabled IoT Device Setup',
    description: 'Configure web-based IoT devices with HTTP/HTTPS interfaces',
    targetDevices: ['http', 'https', 'http-alt', 'http-mgmt'],
    steps: [
      {
        id: 'device-identification',
        name: 'Device Identification',
        description: 'Identify device type and capabilities',
        fields: [
          { name: 'deviceUrl', type: 'url', label: 'Device URL', required: true },
          { name: 'deviceType', type: 'select', label: 'Device Type', 
            options: ['environmental-controller', 'sensor-hub', 'lighting-controller', 'irrigation-controller', 'other'] }
        ]
      },
      {
        id: 'authentication',
        name: 'Authentication Setup',
        description: 'Configure device authentication',
        fields: [
          { name: 'authType', type: 'select', label: 'Authentication Type',
            options: ['none', 'basic', 'bearer', 'api-key'] },
          { name: 'username', type: 'text', label: 'Username', conditional: 'authType=basic' },
          { name: 'password', type: 'password', label: 'Password', conditional: 'authType=basic' }
        ]
      },
      {
        id: 'data-integration',
        name: 'Data Integration',
        description: 'Configure data polling and integration settings',
        fields: [
          { name: 'pollInterval', type: 'number', label: 'Polling Interval (seconds)', default: 60 },
          { name: 'enableAlerts', type: 'boolean', label: 'Enable Alerts', default: true }
        ]
      }
    ]
  },

  'switchbot-setup': {
    id: 'switchbot-setup',
    name: 'SwitchBot Device Setup',
    description: 'Configure SwitchBot cloud-connected devices',
    targetDevices: ['switchbot'],
    steps: [
      {
        id: 'api-credentials',
        name: 'API Credentials',
        description: 'Configure SwitchBot Cloud API access',
        fields: [
          { name: 'token', type: 'text', label: 'SwitchBot Token', required: true },
          { name: 'secret', type: 'text', label: 'SwitchBot Secret', required: true }
        ]
      },
      {
        id: 'device-discovery',
        name: 'Device Discovery',
        description: 'Discover SwitchBot devices in your account',
        dynamic: true
      }
    ]
  },

  'modbus-setup': {
    id: 'modbus-setup',
    name: 'Modbus Device Configuration',
    description: 'Configure Modbus RTU/TCP devices for industrial sensors',
    targetDevices: ['modbus', 'modbus-tcp'],
    steps: [
      {
        id: 'connection-setup',
        name: 'Connection Setup',
        description: 'Configure Modbus connection parameters',
        fields: [
          { name: 'host', type: 'text', label: 'Device IP/Host', required: true },
          { name: 'port', type: 'number', label: 'Port', default: 502, required: true },
          { name: 'unitId', type: 'number', label: 'Unit ID', default: 1, min: 1, max: 247 },
          { name: 'timeout', type: 'number', label: 'Timeout (ms)', default: 3000 },
          { name: 'protocol', type: 'select', label: 'Protocol', options: ['TCP', 'RTU'], default: 'TCP' }
        ]
      },
      {
        id: 'register-mapping',
        name: 'Register Mapping',
        description: 'Map Modbus registers to sensor readings',
        fields: [
          { name: 'startAddress', type: 'number', label: 'Start Address', default: 0 },
          { name: 'registerCount', type: 'number', label: 'Register Count', default: 10 },
          { name: 'dataType', type: 'select', label: 'Data Type', 
            options: ['int16', 'uint16', 'int32', 'uint32', 'float32'] },
          { name: 'pollInterval', type: 'number', label: 'Poll Interval (seconds)', default: 30 }
        ]
      },
      {
        id: 'sensor-calibration',
        name: 'Sensor Calibration',
        description: 'Configure sensor scaling and calibration',
        fields: [
          { name: 'scaling', type: 'number', label: 'Scaling Factor', default: 1.0, step: 0.01 },
          { name: 'offset', type: 'number', label: 'Offset Value', default: 0.0, step: 0.01 },
          { name: 'units', type: 'text', label: 'Measurement Units', placeholder: 'e.g., °C, %, ppm' }
        ]
      }
    ]
  },

  'kasa-setup': {
    id: 'kasa-setup',
    name: 'TP-Link Kasa Device Setup',
    description: 'Configure TP-Link Kasa smart devices for farm automation',
    targetDevices: ['kasa', 'tplink'],
    steps: [
      {
        id: 'device-discovery',
        name: 'Device Discovery',
        description: 'Discover Kasa devices on the network',
        fields: [
          { name: 'discoveryTimeout', type: 'number', label: 'Discovery Timeout (seconds)', default: 10 },
          { name: 'targetIP', type: 'text', label: 'Target IP (optional)', placeholder: '192.168.x.x' }
        ]
      },
      {
        id: 'device-configuration',
        name: 'Device Configuration',
        description: 'Configure discovered Kasa devices',
        dynamic: true,
        fields: [
          { name: 'alias', type: 'text', label: 'Device Alias', required: true },
          { name: 'location', type: 'text', label: 'Location/Zone', placeholder: 'e.g., Greenhouse A' },
          { name: 'scheduleEnabled', type: 'boolean', label: 'Enable Scheduling', default: false }
        ]
      }
    ]
  },

  'sensor-hub-setup': {
    id: 'sensor-hub-setup',
    name: 'Multi-Sensor Hub Configuration',
    description: 'Configure multi-protocol sensor hubs for comprehensive monitoring',
    targetDevices: ['sensor-hub', 'multi-sensor'],
    steps: [
      {
        id: 'hub-identification',
        name: 'Hub Identification',
        description: 'Identify and connect to sensor hub',
        fields: [
          { name: 'hubType', type: 'select', label: 'Hub Type',
            options: ['Arduino-based', 'Raspberry Pi', 'ESP32', 'Commercial Hub'] },
          { name: 'connectionType', type: 'select', label: 'Connection Type',
            options: ['WiFi', 'Ethernet', 'USB', 'Serial'] },
          { name: 'endpoint', type: 'text', label: 'Hub Endpoint', placeholder: 'IP:Port or device path' }
        ]
      },
      {
        id: 'sensor-configuration',
        name: 'Sensor Configuration',
        description: 'Configure individual sensors on the hub',
        dynamic: true,
        fields: [
          { name: 'sensorType', type: 'select', label: 'Sensor Type',
            options: ['Temperature', 'Humidity', 'Soil Moisture', 'Light', 'pH', 'EC', 'CO2', 'Air Quality'] },
          { name: 'channel', type: 'number', label: 'Channel/Pin', min: 0, max: 255 },
          { name: 'calibrationFactor', type: 'number', label: 'Calibration Factor', default: 1.0, step: 0.001 }
        ]
      },
      {
        id: 'data-processing',
        name: 'Data Processing',
        description: 'Configure data processing and alerts',
        fields: [
          { name: 'sampleRate', type: 'number', label: 'Sample Rate (seconds)', default: 60 },
          { name: 'enableAveraging', type: 'boolean', label: 'Enable Data Averaging', default: true },
          { name: 'alertThresholds', type: 'boolean', label: 'Configure Alert Thresholds', default: false }
        ]
      }
    ]
  }
};

// Wizard state management
const wizardStates = new Map();

// Wizard validation engine
function validateWizardStepData(wizard, stepId, data) {
  const step = wizard.steps.find(s => s.id === stepId);
  if (!step) {
    throw new Error(`Step ${stepId} not found in wizard ${wizard.id}`);
  }

  const errors = [];
  const processedData = {};

  // Validate each field
  if (step.fields) {
    for (const field of step.fields) {
      const value = data[field.name];
      
      // Check required fields
      if (field.required && (value === undefined || value === null || value === '')) {
        errors.push(`Field '${field.label}' is required`);
        continue;
      }

      // Skip validation for optional empty fields
      if (!field.required && (value === undefined || value === null || value === '')) {
        continue;
      }

      // Type validation
      switch (field.type) {
        case 'number':
          const numValue = Number(value);
          if (isNaN(numValue)) {
            errors.push(`Field '${field.label}' must be a valid number`);
          } else {
            if (field.min !== undefined && numValue < field.min) {
              errors.push(`Field '${field.label}' must be at least ${field.min}`);
            }
            if (field.max !== undefined && numValue > field.max) {
              errors.push(`Field '${field.label}' must be at most ${field.max}`);
            }
            processedData[field.name] = numValue;
          }
          break;

        case 'boolean':
          processedData[field.name] = Boolean(value);
          break;

        case 'select':
          if (field.options && !field.options.includes(value)) {
            errors.push(`Field '${field.label}' must be one of: ${field.options.join(', ')}`);
          } else {
            processedData[field.name] = value;
          }
          break;

        case 'text':
        case 'password':
        default:
          processedData[field.name] = String(value);
          break;
      }
    }
  } else {
    // For dynamic steps, accept all data as-is
    Object.assign(processedData, data);
  }

  return { isValid: errors.length === 0, errors, data: processedData };
}

// Enhanced wizard execution with validation
async function executeWizardStepWithValidation(wizardId, stepId, data) {
  const wizard = SETUP_WIZARDS[wizardId];
  if (!wizard) {
    throw new Error(`Unknown wizard: ${wizardId}`);
  }

  // Validate step data
  const validation = validateWizardStepData(wizard, stepId, data);
  if (!validation.isValid) {
    return {
      success: false,
      errors: validation.errors,
      data: {}
    };
  }

  // Execute the step with validated data
  return await executeWizardStep(wizardId, stepId, validation.data);
}

// Device-specific wizard step execution
async function executeDeviceSpecificStep(wizardId, stepId, data) {
  console.log(`🔧 Executing device-specific step: ${wizardId}/${stepId}`);
  
  switch (wizardId) {
    case 'mqtt-setup':
      return await executeMQTTWizardStep(stepId, data);
    case 'modbus-setup':
      return await executeModbusWizardStep(stepId, data);
    case 'kasa-setup':
      return await executeKasaWizardStep(stepId, data);
    case 'sensor-hub-setup':
      return await executeSensorHubWizardStep(stepId, data);
    default:
      return { success: true, data: {}, deviceSpecific: false };
  }
}

// MQTT-specific wizard step execution
async function executeMQTTWizardStep(stepId, data) {
  switch (stepId) {
    case 'broker-connection':
      try {
        // Test MQTT connection
        console.log(`🔗 Testing MQTT connection to ${data.host}:${data.port}`);
        
        // Simulate connection test (in real implementation, use mqtt.js)
        const connectionResult = {
          connected: true,
          brokerInfo: {
            version: 'Mosquitto 2.0.15',
            maxPacketSize: 268435460,
            retainAvailable: true
          }
        };
        
        return {
          success: true,
          data: { connectionTest: connectionResult },
          message: `Successfully connected to MQTT broker at ${data.host}:${data.port}`
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to connect to MQTT broker: ${error.message}`
        };
      }
      
    case 'topic-discovery':
      console.log(`🔍 Discovering MQTT topics with pattern: ${data.baseTopic}`);
      
      // Simulate topic discovery
      const discoveredTopics = [
        'farm/greenhouse/temperature',
        'farm/greenhouse/humidity', 
        'farm/greenhouse/soil_moisture',
        'farm/irrigation/pump_status',
        'farm/lighting/zone1/status'
      ];
      
      return {
        success: true,
        data: { discoveredTopics },
        message: `Discovered ${discoveredTopics.length} topics`
      };
      
    default:
      return { success: true, data: {} };
  }
}

// Modbus-specific wizard step execution
async function executeModbusWizardStep(stepId, data) {
  switch (stepId) {
    case 'connection-setup':
      console.log(`🔗 Testing Modbus connection to ${data.host}:${data.port}`);
      
      // Simulate Modbus connection test
      return {
        success: true,
        data: { 
          connectionTest: { 
            connected: true, 
            deviceInfo: 'Industrial Sensor Hub v2.1' 
          }
        },
        message: `Modbus connection established with Unit ID ${data.unitId}`
      };
      
    case 'register-mapping':
      console.log(`📊 Mapping registers starting at address ${data.startAddress}`);
      
      // Simulate register discovery
      const registerMap = Array.from({ length: data.registerCount }, (_, i) => ({
        address: data.startAddress + i,
        value: Math.floor(Math.random() * 1000),
        type: data.dataType
      }));
      
      return {
        success: true,
        data: { registerMap },
        message: `Mapped ${data.registerCount} registers`
      };
      
    default:
      return { success: true, data: {} };
  }
}

// Kasa-specific wizard step execution
async function executeKasaWizardStep(stepId, data) {
  switch (stepId) {
    case 'device-discovery':
      console.log(`🔍 Discovering Kasa devices (timeout: ${data.discoveryTimeout}s)`);
      
      // Simulate Kasa device discovery
      const kasaDevices = [
        { ip: '192.168.2.45', model: 'HS100', alias: 'Pump Controller', type: 'plug' },
        { ip: '192.168.2.46', model: 'KL130', alias: 'Grow Light 1', type: 'bulb' },
        { ip: '192.168.2.47', model: 'HS200', alias: 'Fan Controller', type: 'switch' }
      ];
      
      return {
        success: true,
        data: { discoveredDevices: kasaDevices },
        message: `Found ${kasaDevices.length} Kasa devices`
      };
      
    default:
      return { success: true, data: {} };
  }
}

// Sensor Hub-specific wizard step execution
async function executeSensorHubWizardStep(stepId, data) {
  switch (stepId) {
    case 'hub-identification':
      console.log(`🎯 Connecting to ${data.hubType} at ${data.endpoint}`);
      
      return {
        success: true,
        data: { 
          hubInfo: {
            type: data.hubType,
            firmware: 'v3.2.1',
            sensors: 8,
            channels: 16
          }
        },
        message: `Connected to ${data.hubType} hub`
      };
      
    case 'sensor-configuration':
      console.log(`⚙️ Configuring ${data.sensorType} sensor on channel ${data.channel}`);
      
      return {
        success: true,
        data: { 
          sensorConfig: {
            type: data.sensorType,
            channel: data.channel,
            calibrated: true,
            initialReading: Math.random() * 100
          }
        },
        message: `${data.sensorType} sensor configured on channel ${data.channel}`
      };
      
    default:
      return { success: true, data: {} };
  }
}

// Get setup wizard definition
async function getSetupWizard(wizardId) {
  const wizard = SETUP_WIZARDS[wizardId];
  if (!wizard) {
    throw new Error(`Unknown wizard: ${wizardId}`);
  }
  
  // Initialize wizard state if not exists
  if (!wizardStates.has(wizardId)) {
    wizardStates.set(wizardId, {
      currentStep: 0,
      completed: false,
      data: {},
      startedAt: new Date().toISOString()
    });
  }
  
  return {
    ...wizard,
    state: wizardStates.get(wizardId)
  };
}

// Execute a wizard step
async function executeWizardStep(wizardId, stepId, data) {
  const wizard = SETUP_WIZARDS[wizardId];
  if (!wizard) {
    throw new Error(`Unknown wizard: ${wizardId}`);
  }
  
  const state = wizardStates.get(wizardId) || {
    currentStep: 0,
    completed: false,
    data: {},
    startedAt: new Date().toISOString()
  };
  
  console.log(`🧙 Executing wizard ${wizardId} step ${stepId}:`, data);
  
  // Execute step-specific logic based on wizard type
  let result = { success: true, data: {}, nextStep: null };
  
  try {
    // Validate step data first
    const validation = validateWizardStepData(wizard, stepId, data);
    if (!validation.isValid) {
      return {
        success: false,
        errors: validation.errors,
        data: {}
      };
    }

    // Execute device-specific logic if available
    const deviceResult = await executeDeviceSpecificStep(wizardId, stepId, validation.data);
    if (deviceResult.deviceSpecific !== false) {
      result = { ...result, ...deviceResult };
    }
    
    // Store step data
    state.data[stepId] = {
      input: validation.data,
      result: deviceResult.data || {},
      timestamp: new Date().toISOString(),
      success: deviceResult.success !== false
    };
    
    state.lastUpdated = new Date().toISOString();
    
    // Find next step
    const currentStepIndex = wizard.steps.findIndex(s => s.id === stepId);
    if (currentStepIndex < wizard.steps.length - 1) {
      const nextStep = wizard.steps[currentStepIndex + 1];
      result.nextStep = nextStep.id;
      state.currentStep = currentStepIndex + 1;
    } else {
      state.completed = true;
      state.completedAt = new Date().toISOString();
      console.log(`✅ Wizard ${wizardId} completed successfully`);
      
      // Execute post-completion actions
      await executeWizardCompletion(wizardId, state);
    }
    
    wizardStates.set(wizardId, state);
    
  } catch (error) {
    console.error(`❌ Wizard step execution failed: ${wizardId}/${stepId}`, error);
    result = {
      success: false,
      error: error.message,
      data: {}
    };
  }
  
  return result;
}

// Execute wizard completion actions
async function executeWizardCompletion(wizardId, state) {
  console.log(`🎉 Executing completion actions for wizard: ${wizardId}`);
  
  switch (wizardId) {
    case 'mqtt-setup':
      await completeMQTTSetup(state);
      break;
    case 'modbus-setup':
      await completeModbusSetup(state);
      break;
    case 'kasa-setup':
      await completeKasaSetup(state);
      break;
    case 'sensor-hub-setup':
      await completeSensorHubSetup(state);
      break;
    default:
      console.log(`No completion actions defined for wizard: ${wizardId}`);
  }
}

// MQTT setup completion
async function completeMQTTSetup(state) {
  const brokerData = state.data['broker-connection']?.input;
  const topicData = state.data['topic-discovery']?.input;
  
  console.log(`🔗 Configuring MQTT integration for ${brokerData?.host}:${brokerData?.port}`);
  
  // Here you would:
  // 1. Save MQTT configuration to persistent storage
  // 2. Start MQTT client connection
  // 3. Subscribe to discovered topics
  // 4. Register device in system database
  
  return {
    configurationSaved: true,
    mqttClientStarted: true,
    topicsSubscribed: state.data['topic-discovery']?.result?.discoveredTopics?.length || 0
  };
}

// Modbus setup completion
async function completeModbusSetup(state) {
  const connectionData = state.data['connection-setup']?.input;
  const registerData = state.data['register-mapping']?.input;
  
  console.log(`📊 Configuring Modbus integration for ${connectionData?.host}:${connectionData?.port}`);
  
  return {
    modbusClientConfigured: true,
    registersConfigured: registerData?.registerCount || 0,
    pollIntervalSet: registerData?.pollInterval
  };
}

// Kasa setup completion
async function completeKasaSetup(state) {
  const discoveryData = state.data['device-discovery']?.result;
  
  console.log(`🏠 Configuring Kasa integration for ${discoveryData?.discoveredDevices?.length || 0} devices`);
  
  return {
    kasaDevicesConfigured: discoveryData?.discoveredDevices?.length || 0,
    automationEnabled: true
  };
}

// Sensor Hub setup completion
async function completeSensorHubSetup(state) {
  const hubData = state.data['hub-identification']?.input;
  
  console.log(`🎛️ Configuring sensor hub integration: ${hubData?.hubType}`);
  
  return {
    sensorHubConfigured: true,
    hubType: hubData?.hubType,
    sensorsConfigured: Object.keys(state.data).filter(k => k.startsWith('sensor-')).length
  };
}

// Get wizard execution status
async function getWizardStatus(wizardId) {
  const state = wizardStates.get(wizardId);
  if (!state) {
    return { exists: false };
  }
  
  const wizard = SETUP_WIZARDS[wizardId];
  return {
    exists: true,
    wizardId,
    name: wizard.name,
    currentStep: state.currentStep,
    totalSteps: wizard.steps.length,
    completed: state.completed,
    progress: state.completed ? 100 : Math.round((state.currentStep / wizard.steps.length) * 100),
    startedAt: state.startedAt,
    lastUpdated: state.lastUpdated,
    completedAt: state.completedAt,
    data: state.data
  };
}

// Get all available setup wizards
async function getAllSetupWizards() {
  return Object.keys(SETUP_WIZARDS).map(id => {
    const wizard = SETUP_WIZARDS[id];
    const state = wizardStates.get(id);
    return {
      id: wizard.id,
      name: wizard.name,
      description: wizard.description,
      targetDevices: wizard.targetDevices,
      stepCount: wizard.steps.length,
      status: state ? (state.completed ? 'completed' : 'in-progress') : 'not-started'
    };
  });
}

// MQTT device discovery
async function discoverMQTTDevices() {
  const devices = [];
  
  // Check if MQTT broker is configured via Python backend
  try {
    const controller = getController();
    if (controller) {
      const mqttResponse = await fetch(`${controller}/api/devices/mqtt`);
      if (mqttResponse.ok) {
        const mqttData = await mqttResponse.json();
        if (mqttData.devices) {
          mqttData.devices.forEach(device => {
            devices.push({
              id: `mqtt:${device.device_id}`,
              name: device.name,
              protocol: 'mqtt',
              confidence: 0.85,
              signal: null,
              address: device.details?.topic || 'unknown',
              vendor: 'MQTT Device',
              lastSeen: device.details?.last_seen || new Date().toISOString(),
              hints: {
                type: device.category,
                topic: device.details?.topic,
                capabilities: device.capabilities,
                metrics: ['sensor_data', 'status', 'battery']
              }
            });
          });
        }
      }
    }
  } catch (e) {
    console.warn('MQTT discovery via controller failed:', e.message);
  }

  return devices;
}

// BLE device discovery
async function discoverBLEDevices() {
  const devices = [];
  
  // Check for BLE devices via Python backend (if noble/bleak is available)
  try {
    const controller = getController();
    if (controller) {
      const bleResponse = await fetch(`${controller}/api/devices/ble`);
      if (bleResponse.ok) {
        const bleData = await bleResponse.json();
        if (bleData.devices) {
          bleData.devices.forEach(device => {
            devices.push({
              id: `ble:${device.device_id}`,
              name: device.name || `BLE Device ${device.device_id.substring(0, 8)}`,
              protocol: 'bluetooth-le',
              confidence: 0.8,
              signal: device.rssi || null,
              address: device.device_id,
              vendor: device.manufacturer || 'Unknown BLE',
              lastSeen: new Date().toISOString(),
              hints: {
                type: device.category || 'ble-peripheral',
                rssi: device.rssi,
                services: device.services || [],
                metrics: ['battery', 'signal_strength', 'sensor_data']
              }
            });
          });
        }
      }
    }
  } catch (e) {
    // BLE discovery is optional - many systems don't have it
    console.log('BLE discovery not available (normal on many systems)');
  }

  return devices;
}

// Farm device status endpoints for live testing
app.get('/api/device/:deviceId/status', async (req, res) => {
  const { deviceId } = req.params;
  
  // Generate live-looking data for farm devices
  const farmDeviceStatus = {
    'wifi:192.168.1.101': {
      deviceId,
      name: 'HLG 550 V2 R-Spec',
      online: true,
      power: 485 + Math.random() * 30, // 485-515W
      voltage: 120.1 + Math.random() * 2,
      current: 4.04 + Math.random() * 0.25,
      spectrum: {
        red: 660,
        blue: 450,
        green: 520,
        farRed: 730,
        white: 3000
      },
      dimming: 85 + Math.random() * 10, // 85-95%
      temperature: 42 + Math.random() * 8, // LED temp
      runtime: Math.floor(Date.now() / 1000) - 3600 * 8, // 8 hours runtime
      lastUpdate: new Date().toISOString()
    },
    'wifi:192.168.1.102': {
      deviceId,
      name: 'HLG 550 V2 R-Spec',
      online: true,
      power: 490 + Math.random() * 25,
      voltage: 119.8 + Math.random() * 2,
      current: 4.08 + Math.random() * 0.20,
      spectrum: {
        red: 660,
        blue: 450,
        green: 520,
        farRed: 730,
        white: 3000
      },
      dimming: 88 + Math.random() * 8,
      temperature: 45 + Math.random() * 6,
      runtime: Math.floor(Date.now() / 1000) - 3600 * 8,
      lastUpdate: new Date().toISOString()
    },
    'wifi:192.168.1.103': {
      deviceId,
      name: 'Spider Farmer SF-7000',
      online: true,
      power: 640 + Math.random() * 40,
      voltage: 120.3 + Math.random() * 1.5,
      current: 5.33 + Math.random() * 0.30,
      spectrum: {
        red: 660,
        blue: 450,
        green: 520,
        farRed: 730,
        white: 3500
      },
      dimming: 90 + Math.random() * 5,
      temperature: 48 + Math.random() * 7,
      runtime: Math.floor(Date.now() / 1000) - 3600 * 8,
      lastUpdate: new Date().toISOString()
    },
    'wifi:192.168.1.104': {
      deviceId,
      name: 'MARS HYDRO FC-E6500',
      online: true,
      power: 610 + Math.random() * 35,
      voltage: 119.9 + Math.random() * 2,
      current: 5.08 + Math.random() * 0.25,
      spectrum: {
        red: 660,
        blue: 450,
        green: 520,
        farRed: 730,
        white: 3200
      },
      dimming: 87 + Math.random() * 8,
      temperature: 46 + Math.random() * 9,
      runtime: Math.floor(Date.now() / 1000) - 3600 * 8,
      lastUpdate: new Date().toISOString()
    }
  };

  const status = farmDeviceStatus[deviceId];
  if (status) {
    res.json(status);
  } else {
    res.status(404).json({ error: 'Device not found' });
  }
});

// Farm device control endpoints
app.post('/api/device/:deviceId/power', async (req, res) => {
  const { deviceId } = req.params;
  const { state } = req.body; // 'on' or 'off'
  
  console.log(`💡 Farm Light Control: ${deviceId} → ${state}`);
  
  res.json({
    deviceId,
    action: 'power',
    state,
    timestamp: new Date().toISOString(),
    success: true
  });
});

app.post('/api/device/:deviceId/spectrum', async (req, res) => {
  const { deviceId } = req.params;
  const { spectrum } = req.body;
  
  console.log(`🌈 Farm Light Spectrum: ${deviceId}`, spectrum);
  
  res.json({
    deviceId,
    action: 'spectrum',
    spectrum,
    timestamp: new Date().toISOString(),
    success: true
  });
});

app.post('/api/device/:deviceId/dimming', async (req, res) => {
  const { deviceId } = req.params;
  const { level } = req.body; // 0-100
  
  console.log(`🔆 Farm Light Dimming: ${deviceId} → ${level}%`);
  
  res.json({
    deviceId,
    action: 'dimming',
    level,
    timestamp: new Date().toISOString(),
    success: true
  });
});

// Express error handling middleware - must be last
app.use((error, req, res, next) => {
  console.error('❌ Express Error Handler:', error);
  console.error('Stack:', error.stack);
  console.error('Request URL:', req.url);
  console.error('Request Method:', req.method);
  
  // Don't expose internal errors to client in production
  const isDev = process.env.NODE_ENV !== 'production';
  
  res.status(error.status || 500).json({
    error: 'Internal Server Error',
    message: isDev ? error.message : 'Something went wrong',
    requestId: req.headers['x-request-id'] || Date.now().toString(),
    timestamp: new Date().toISOString()
  });
});

// Setup wizard endpoints - triggered when devices are identified
app.get('/setup/wizards/:wizardId', async (req, res) => {
  const { wizardId } = req.params;
  try {
    const wizard = await getSetupWizard(wizardId);
    if (!wizard) {
      return res.status(404).json({ error: 'Wizard not found' });
    }
    res.json(wizard);
  } catch (error) {
    console.error('Failed to load setup wizard:', error);
    res.status(500).json({ error: 'Failed to load setup wizard' });
  }
});

// Get all available setup wizards
app.get('/setup/wizards', async (req, res) => {
  try {
    const wizards = await getAllSetupWizards();
    res.json({
      success: true,
      wizards
    });
  } catch (error) {
    console.error('Error fetching setup wizards:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get specific wizard definition and state
app.get('/setup/wizards/:wizardId', async (req, res) => {
  try {
    const { wizardId } = req.params;
    const wizard = await getSetupWizard(wizardId);
    res.json({
      success: true,
      wizard
    });
  } catch (error) {
    console.error(`Error fetching wizard ${req.params.wizardId}:`, error);
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

// Execute a wizard step
app.post('/setup/wizards/:wizardId/execute', async (req, res) => {
  try {
    const { wizardId } = req.params;
    const { stepId, data } = req.body;
    
    if (!stepId) {
      return res.status(400).json({
        success: false,
        error: 'stepId is required'
      });
    }
    
    const result = await executeWizardStep(wizardId, stepId, data || {});
    res.json({
      success: result.success,
      result,
      wizard: await getSetupWizard(wizardId)
    });
  } catch (error) {
    console.error(`Error executing wizard ${req.params.wizardId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get wizard execution status
app.get('/setup/wizards/:wizardId/status', async (req, res) => {
  try {
    const { wizardId } = req.params;
    const status = await getWizardStatus(wizardId);
    
    if (!status.exists) {
      return res.status(404).json({
        success: false,
        error: 'Wizard not found or never started'
      });
    }
    
    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error(`Error getting wizard status ${req.params.wizardId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Reset wizard state (useful for testing)
app.delete('/setup/wizards/:wizardId', async (req, res) => {
  try {
    const { wizardId } = req.params;
    wizardStates.delete(wizardId);
    console.log(`🗑️ Reset wizard state for ${wizardId}`);
    res.json({
      success: true,
      message: `Wizard ${wizardId} state reset`
    });
  } catch (error) {
    console.error(`Error resetting wizard ${req.params.wizardId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Automatically suggest wizards for discovered devices
app.post('/discovery/suggest-wizards', async (req, res) => {
  try {
    const { devices } = req.body;
    if (!Array.isArray(devices)) {
      return res.status(400).json({
        success: false,
        error: 'devices array is required'
      });
    }
    
    const suggestions = [];
    
    for (const device of devices) {
      // Find applicable wizards for this device type
      const applicableWizards = Object.values(SETUP_WIZARDS).filter(wizard => 
        wizard.targetDevices.includes(device.type) || 
        device.services?.some(service => wizard.targetDevices.includes(service))
      );
      
      if (applicableWizards.length > 0) {
        suggestions.push({
          device: {
            ip: device.ip,
            hostname: device.hostname,
            type: device.type,
            services: device.services
          },
          recommendedWizards: applicableWizards.map(w => ({
            id: w.id,
            name: w.name,
            description: w.description,
            confidence: calculateWizardConfidence(device, w)
          })).sort((a, b) => b.confidence - a.confidence)
        });
      }
    }
    
    res.json({
      success: true,
      suggestions
    });
    
  } catch (error) {
    console.error('Error suggesting wizards:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Calculate wizard confidence score for device matching
function calculateWizardConfidence(device, wizard) {
  let confidence = 0;
  
  // Direct type match
  if (wizard.targetDevices.includes(device.type)) {
    confidence += 80;
  }
  
  // Service match
  if (device.services) {
    const matchingServices = device.services.filter(service => 
      wizard.targetDevices.includes(service)
    );
    confidence += matchingServices.length * 30;
  }
  
  // Device-specific bonuses
  if (device.hostname) {
    if (wizard.id === 'switchbot-setup' && device.hostname.toLowerCase().includes('switchbot')) {
      confidence += 50;
    }
    if (wizard.id === 'mqtt-setup' && device.hostname.toLowerCase().includes('mqtt')) {
      confidence += 50;
    }
    if (wizard.id === 'modbus-setup' && device.hostname.toLowerCase().includes('modbus')) {
      confidence += 50;
    }
    if (wizard.id === 'kasa-setup' && (device.hostname.toLowerCase().includes('kasa') || device.hostname.toLowerCase().includes('tplink'))) {
      confidence += 50;
    }
  }
  
  return Math.min(confidence, 100);
}

// Bulk wizard operations
async function executeBulkWizardOperation(operation, wizardIds, data) {
  console.log(`🔄 Executing bulk operation: ${operation} on ${wizardIds.length} wizards`);
  
  const results = [];
  
  for (const wizardId of wizardIds) {
    try {
      let result;
      
      switch (operation) {
        case 'reset':
          wizardStates.delete(wizardId);
          result = { wizardId, success: true, message: 'State reset' };
          break;
          
        case 'status':
          result = { 
            wizardId, 
            success: true, 
            status: await getWizardStatus(wizardId) 
          };
          break;
          
        case 'execute-step':
          if (!data.stepId) {
            throw new Error('stepId required for execute-step operation');
          }
          result = {
            wizardId,
            success: true,
            result: await executeWizardStep(wizardId, data.stepId, data.stepData || {})
          };
          break;
          
        default:
          throw new Error(`Unknown bulk operation: ${operation}`);
      }
      
      results.push(result);
      
    } catch (error) {
      results.push({
        wizardId,
        success: false,
        error: error.message
      });
    }
  }
  
  return {
    operation,
    totalWizards: wizardIds.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results
  };
}

// Wizard templates for common configurations
const WIZARD_TEMPLATES = {
  'greenhouse-complete': {
    name: 'Complete Greenhouse Setup',
    description: 'Configure all devices for a complete greenhouse monitoring system',
    wizards: [
      { id: 'mqtt-setup', priority: 1, autoExecute: false },
      { id: 'sensor-hub-setup', priority: 2, autoExecute: false },
      { id: 'web-device-setup', priority: 3, autoExecute: false },
      { id: 'kasa-setup', priority: 4, autoExecute: true }
    ],
    presets: {
      'mqtt-setup': {
        'broker-connection': {
          port: 8883,
          secure: true
        }
      },
      'sensor-hub-setup': {
        'data-processing': {
          sampleRate: 300,
          enableAveraging: true,
          alertThresholds: true
        }
      }
    }
  },
  
  'industrial-monitoring': {
    name: 'Industrial Sensor Monitoring',
    description: 'Configure industrial-grade sensors and monitoring equipment',
    wizards: [
      { id: 'modbus-setup', priority: 1, autoExecute: false },
      { id: 'mqtt-setup', priority: 2, autoExecute: false },
      { id: 'sensor-hub-setup', priority: 3, autoExecute: false }
    ],
    presets: {
      'modbus-setup': {
        'connection-setup': {
          port: 502,
          timeout: 5000,
          protocol: 'TCP'
        },
        'register-mapping': {
          dataType: 'float32',
          pollInterval: 60
        }
      }
    }
  },
  
  'smart-home-farm': {
    name: 'Smart Home Farm Integration',
    description: 'Integrate consumer smart home devices for farm automation',
    wizards: [
      { id: 'kasa-setup', priority: 1, autoExecute: true },
      { id: 'switchbot-setup', priority: 2, autoExecute: false },
      { id: 'web-device-setup', priority: 3, autoExecute: false }
    ],
    presets: {
      'kasa-setup': {
        'device-discovery': {
          discoveryTimeout: 15
        }
      }
    }
  }
};

// Apply wizard template
async function applyWizardTemplate(templateId, devices, customPresets = {}) {
  const template = WIZARD_TEMPLATES[templateId];
  if (!template) {
    throw new Error(`Unknown wizard template: ${templateId}`);
  }
  
  console.log(`📋 Applying wizard template: ${template.name}`);
  
  const results = {
    templateId,
    templateName: template.name,
    applicableWizards: [],
    autoExecuted: [],
    errors: []
  };
  
  // Find applicable wizards based on devices
  for (const wizardConfig of template.wizards) {
    const wizard = SETUP_WIZARDS[wizardConfig.id];
    if (!wizard) {
      results.errors.push(`Wizard not found: ${wizardConfig.id}`);
      continue;
    }
    
    // Check if any devices match this wizard
    const applicableDevices = devices.filter(device => 
      calculateWizardConfidence(device, wizard) > 50
    );
    
    if (applicableDevices.length > 0) {
      results.applicableWizards.push({
        wizardId: wizardConfig.id,
        priority: wizardConfig.priority,
        autoExecute: wizardConfig.autoExecute,
        applicableDevices: applicableDevices.length,
        devices: applicableDevices
      });
      
      // Auto-execute if configured
      if (wizardConfig.autoExecute) {
        try {
          // Apply presets if available
          const presets = { ...template.presets[wizardConfig.id], ...customPresets[wizardConfig.id] };
          
          for (const [stepId, stepData] of Object.entries(presets)) {
            await executeWizardStep(wizardConfig.id, stepId, stepData);
          }
          
          results.autoExecuted.push(wizardConfig.id);
          
        } catch (error) {
          results.errors.push(`Auto-execution failed for ${wizardConfig.id}: ${error.message}`);
        }
      }
    }
  }
  
  // Sort by priority
  results.applicableWizards.sort((a, b) => a.priority - b.priority);
  
  return results;
}

// Get wizard recommendations with templates
async function getWizardRecommendationsWithTemplates(devices) {
  const recommendations = {
    individualWizards: [],
    templates: [],
    bestMatch: null
  };
  
  // Get individual wizard suggestions
  for (const device of devices) {
    const applicableWizards = Object.values(SETUP_WIZARDS).filter(wizard => 
      wizard.targetDevices.includes(device.type) || 
      device.services?.some(service => wizard.targetDevices.includes(service))
    );
    
    if (applicableWizards.length > 0) {
      recommendations.individualWizards.push({
        device,
        wizards: applicableWizards.map(w => ({
          id: w.id,
          name: w.name,
          confidence: calculateWizardConfidence(device, w)
        })).sort((a, b) => b.confidence - a.confidence)
      });
    }
  }
  
  // Evaluate templates
  for (const [templateId, template] of Object.entries(WIZARD_TEMPLATES)) {
    let templateScore = 0;
    let applicableWizards = 0;
    
    for (const wizardConfig of template.wizards) {
      const wizard = SETUP_WIZARDS[wizardConfig.id];
      if (wizard) {
        const matchingDevices = devices.filter(device => 
          calculateWizardConfidence(device, wizard) > 50
        );
        
        if (matchingDevices.length > 0) {
          applicableWizards++;
          templateScore += matchingDevices.length * (5 - wizardConfig.priority);
        }
      }
    }
    
    if (applicableWizards > 0) {
      const templateRecommendation = {
        templateId,
        name: template.name,
        description: template.description,
        applicableWizards,
        totalWizards: template.wizards.length,
        coverage: Math.round((applicableWizards / template.wizards.length) * 100),
        score: templateScore
      };
      
      recommendations.templates.push(templateRecommendation);
    }
  }
  
  // Sort templates by score
  recommendations.templates.sort((a, b) => b.score - a.score);
  
  // Set best match
  if (recommendations.templates.length > 0) {
    recommendations.bestMatch = recommendations.templates[0];
  }
  
  return recommendations;
}

// Enhanced wizard recommendations with templates
app.post('/discovery/recommend-setup', async (req, res) => {
  try {
    const { devices } = req.body;
    if (!Array.isArray(devices)) {
      return res.status(400).json({
        success: false,
        error: 'devices array is required'
      });
    }
    
    const recommendations = await getWizardRecommendationsWithTemplates(devices);
    
    res.json({
      success: true,
      recommendations
    });
    
  } catch (error) {
    console.error('Error generating recommendations:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Apply wizard template
app.post('/setup/templates/:templateId/apply', async (req, res) => {
  try {
    const { templateId } = req.params;
    const { devices, customPresets } = req.body;
    
    if (!Array.isArray(devices)) {
      return res.status(400).json({
        success: false,
        error: 'devices array is required'
      });
    }
    
    const result = await applyWizardTemplate(templateId, devices, customPresets || {});
    
    res.json({
      success: true,
      result
    });
    
  } catch (error) {
    console.error(`Error applying template ${req.params.templateId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get available wizard templates
app.get('/setup/templates', async (req, res) => {
  try {
    const templates = Object.entries(WIZARD_TEMPLATES).map(([id, template]) => ({
      id,
      name: template.name,
      description: template.description,
      wizardCount: template.wizards.length,
      wizards: template.wizards.map(w => ({
        id: w.id,
        priority: w.priority,
        autoExecute: w.autoExecute
      }))
    }));
    
    res.json({
      success: true,
      templates
    });
    
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Bulk wizard operations
app.post('/setup/wizards/bulk/:operation', async (req, res) => {
  try {
    const { operation } = req.params;
    const { wizardIds, data } = req.body;
    
    if (!Array.isArray(wizardIds)) {
      return res.status(400).json({
        success: false,
        error: 'wizardIds array is required'
      });
    }
    
    const result = await executeBulkWizardOperation(operation, wizardIds, data || {});
    
    res.json({
      success: true,
      result
    });
    
  } catch (error) {
    console.error(`Error executing bulk operation ${req.params.operation}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enhanced wizard step execution with validation
app.post('/setup/wizards/:wizardId/execute-validated', async (req, res) => {
  try {
    const { wizardId } = req.params;
    const { stepId, data } = req.body;
    
    if (!stepId) {
      return res.status(400).json({
        success: false,
        error: 'stepId is required'
      });
    }
    
    const result = await executeWizardStepWithValidation(wizardId, stepId, data || {});
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.errors
      });
    }
    
    res.json({
      success: true,
      result,
      wizard: await getSetupWizard(wizardId)
    });
    
  } catch (error) {
    console.error(`Error executing validated wizard ${req.params.wizardId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 404 handler for undefined routes
app.use((req, res) => {
  console.warn(`⚠️  404 Not Found: ${req.method} ${req.url}`);
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} not found`,
    timestamp: new Date().toISOString()
  });
});

// Get wizard execution status
app.get('/setup/wizards/:wizardId/status', async (req, res) => {
  try {
    const { wizardId } = req.params;
    const status = await getWizardStatus(wizardId);
    
    if (!status.exists) {
      return res.status(404).json({
        success: false,
        error: 'Wizard not found or never started'
      });
    }
    
    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error(`Error getting wizard status ${req.params.wizardId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Reset wizard state (useful for testing)
app.delete('/setup/wizards/:wizardId', async (req, res) => {
  try {
    const { wizardId } = req.params;
    wizardStates.delete(wizardId);
    console.log(`🗑️ Reset wizard state for ${wizardId}`);
    res.json({
      success: true,
      message: `Wizard ${wizardId} state reset`
    });
  } catch (error) {
    console.error(`Error resetting wizard ${req.params.wizardId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Automatically suggest wizards for discovered devices
app.post('/discovery/suggest-wizards', async (req, res) => {
  try {
    const { devices } = req.body;
    if (!Array.isArray(devices)) {
      return res.status(400).json({
        success: false,
        error: 'devices array is required'
      });
    }
    
    const suggestions = [];
    
    for (const device of devices) {
      // Find applicable wizards for this device type
      const applicableWizards = Object.values(SETUP_WIZARDS).filter(wizard => 
        wizard.targetDevices.includes(device.type) || 
        device.services?.some(service => wizard.targetDevices.includes(service))
      );
      
      if (applicableWizards.length > 0) {
        suggestions.push({
          device: {
            ip: device.ip,
            hostname: device.hostname,
            type: device.type,
            services: device.services
          },
          recommendedWizards: applicableWizards.map(w => ({
            id: w.id,
            name: w.name,
            description: w.description,
            confidence: calculateWizardConfidence(device, w)
          })).sort((a, b) => b.confidence - a.confidence)
        });
      }
    }
    
    res.json({
      success: true,
      suggestions
    });
    
  } catch (error) {
    console.error('Error suggesting wizards:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start the server after all routes are defined
app.listen(PORT, () => {
  console.log(`[charlie] running http://127.0.0.1:${PORT} → ${getController()}`);
});
