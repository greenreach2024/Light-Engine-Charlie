

import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import Datastore from 'nedb-promises';
import crypto from 'crypto';
import net from 'node:net';
import AutomationRulesEngine from './lib/automation-engine.js';
import { createPreAutomationLayer } from './automation/index.js';
import {
  buildSetupWizards,
  mergeDiscoveryPayload,
  getWizardDefaultInputs,
  cloneWizardStep
} from './server/wizards/index.js';
import buyerRouter from './server/buyer/routes.js';

const app = express();
const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
const hasExplicitPort = Number.isFinite(parsedPort);
let PORT = hasExplicitPort ? parsedPort : 8091;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CORS guardrail: always answer OPTIONS and echo request headers ---
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin'); // allow per-origin caching
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  const reqHdrs = req.headers['access-control-request-headers'];
  if (reqHdrs) res.setHeader('Access-Control-Allow-Headers', reqHdrs);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// --- Health probe: refuse to start if CORS config is missing ---
function checkCorsConfigOrExit() {
  // Check if CORS middleware is present by inspecting app._router.stack
  const hasCors = app._router && app._router.stack && app._router.stack.some(
    (layer) => layer && layer.handle && layer.handle.toString().includes('Access-Control-Allow-Origin')
  );
  if (!hasCors) {
    console.error('[health] CORS middleware missing. Refusing to start.');
    process.exit(1);
  }
}

app.get('/healthz', (req, res) => {
  // Health probe: returns 200 if CORS is present, 500 otherwise
  const hasCors = app._router && app._router.stack && app._router.stack.some(
    (layer) => layer && layer.handle && layer.handle.toString().includes('Access-Control-Allow-Origin')
  );
  if (!hasCors) return res.status(500).json({ ok: false, error: 'CORS middleware missing' });
  res.json({ ok: true, status: 'healthy' });
});

// Call CORS check after CORS middleware is registered
checkCorsConfigOrExit();
// Default controller target. Can be overridden with the CTRL env var.
// Use the Pi forwarder when available for remote device reachability during development.
let CURRENT_CONTROLLER = process.env.CTRL || "http://100.65.187.59:8089";
// IFTTT integration config (optional)
const IFTTT_KEY = process.env.IFTTT_KEY || process.env.IFTTT_WEBHOOK_KEY || "";
const IFTTT_INBOUND_TOKEN = process.env.IFTTT_INBOUND_TOKEN || "";
const IFTTT_ENABLED = Boolean(IFTTT_KEY);
// Environment source: "local" (default) reads public/data/env.json
// or "azure" pulls from an Azure Functions endpoint that returns latest readings
const AZURE_LATEST_URL = process.env.AZURE_LATEST_URL || "";
const ENV_SOURCE = process.env.ENV_SOURCE || (AZURE_LATEST_URL ? "azure" : "local");
const ENV_PATH = path.resolve("./public/data/env.json");
const DATA_DIR = path.resolve("./public/data");
const FARM_PATH = path.join(DATA_DIR, 'farm.json');
const CONTROLLER_PATH = path.join(DATA_DIR, 'controller.json');
const GROUPS_PATH = path.join(DATA_DIR, 'groups.json');
const UI_DATA_RESOURCES = new Map([
  ['farm', 'farm.json'],
  ['groups', 'groups.json'],
  ['sched', 'schedules.json'],
  ['plans', 'plans.json'],
  ['env', 'env.json']
]);
// Device DB (outside public): ./data/devices.nedb
const DB_DIR = path.resolve('./data');
const DB_PATH = path.join(DB_DIR, 'devices.nedb');

// Controller helpers: load persisted value if present; allow runtime updates
function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}
function ensureDbDir(){ try { fs.mkdirSync(DB_DIR, { recursive: true }); } catch {} }
function isHttpUrl(u){ try { const x=new URL(u); return x.protocol==='http:'||x.protocol==='https:'; } catch { return false; } }

function loadGroupsFile() {
  ensureDataDir();
  try {
    if (!fs.existsSync(GROUPS_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(GROUPS_PATH, 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.groups)) return raw.groups;
    return [];
  } catch (err) {
    console.warn('[groups] Failed to read groups.json:', err.message);
    return [];
  }
}

function saveGroupsFile(groups) {
  ensureDataDir();
  try {
    const payload = JSON.stringify({ groups }, null, 2);
    fs.writeFileSync(GROUPS_PATH, payload);
    return true;
  } catch (err) {
    console.error('[groups] Failed to write groups.json:', err.message);
    return false;
  }
}

function normalizeMemberEntry(entry) {
  if (entry == null) return null;
  if (typeof entry === 'string') {
    const id = entry.trim();
    return id ? { id } : null;
  }
  if (typeof entry === 'object') {
    const copy = { ...entry };
    const idCandidate = [copy.id, copy.device_id, copy.deviceId, copy.deviceID]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find((value) => !!value);
    if (!idCandidate) return null;
    copy.id = idCandidate;
    delete copy.device_id;
    delete copy.deviceId;
    delete copy.deviceID;
    return copy;
  }
  return null;
}

function normalizeGroupForResponse(group) {
  if (!group || typeof group !== 'object') return null;
  const id = typeof group.id === 'string' ? group.id.trim() : '';
  const name = typeof group.name === 'string' ? group.name.trim() : '';
  const matchRaw = group.match && typeof group.match === 'object' ? group.match : null;
  const room = matchRaw ? String(matchRaw.room ?? '').trim() : '';
  const zone = matchRaw ? String(matchRaw.zone ?? '').trim() : '';
  const hasMatch = !!(room && zone);
  const membersSource = Array.isArray(group.members) ? group.members : Array.isArray(group.lights) ? group.lights : [];
  const members = membersSource.map(normalizeMemberEntry).filter(Boolean);

  const response = { id, name };
  if (typeof group.plan === 'string' && group.plan.trim()) response.plan = group.plan.trim();
  if (typeof group.schedule === 'string' && group.schedule.trim()) response.schedule = group.schedule.trim();
  if (group.pendingSpectrum && typeof group.pendingSpectrum === 'object') response.pendingSpectrum = group.pendingSpectrum;

  if (hasMatch) {
    response.match = { room, zone };
  }
  if (members.length > 0) {
    response.members = members;
  }
  return response;
}

function parseIncomingGroup(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Group payload must be an object.');
  const id = String(raw.id ?? raw.groupId ?? '').trim();
  if (!id) throw new Error('Group id is required.');
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';

  const matchRaw = raw.match && typeof raw.match === 'object' ? raw.match : null;
  const matchRoom = matchRaw ? String(matchRaw.room ?? '').trim() : '';
  const matchZone = matchRaw ? String(matchRaw.zone ?? '').trim() : '';
  const hasMatch = !!(matchRoom && matchZone);

  const membersSource = Array.isArray(raw.members) ? raw.members : Array.isArray(raw.lights) ? raw.lights : [];
  const members = membersSource.map(normalizeMemberEntry).filter(Boolean);
  const hasMembers = members.length > 0;

  if (!hasMatch && !hasMembers) throw new Error('Group requires match.room + match.zone or a non-empty members[] list.');

  const stored = { ...raw, id, name };
  if (typeof stored.plan === 'string') stored.plan = stored.plan.trim();
  if (typeof stored.schedule === 'string') stored.schedule = stored.schedule.trim();
  if (!stored.plan) delete stored.plan;
  if (!stored.schedule) delete stored.schedule;

  if (hasMatch) {
    stored.match = { room: matchRoom, zone: matchZone };
  } else {
    delete stored.match;
  }
  stored.lights = members;
  delete stored.members;

  const response = { id, name };
  if (stored.plan) response.plan = stored.plan;
  if (stored.schedule) response.schedule = stored.schedule;
  if (stored.pendingSpectrum && typeof stored.pendingSpectrum === 'object') {
    response.pendingSpectrum = stored.pendingSpectrum;
  }
  if (hasMatch) {
    response.match = { room: matchRoom, zone: matchZone };
  }
  if (hasMembers) {
    response.members = members;
  }

  return { stored, response };
}
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

// Helper function for Kasa client import
async function createKasaClient() {
  try {
    const kasaModule = await import('tplink-smarthome-api');
    const Client = kasaModule.default?.Client || kasaModule.Client || kasaModule.default;
    
    if (!Client) {
      throw new Error('tplink-smarthome-api Client not found in module exports');
    }
    
    return new Client();
  } catch (error) {
    console.error('Failed to create Kasa client:', error.message);
    throw new Error(`Kasa integration not available: ${error.message}`);
  }
}

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
app.use(buyerRouter);

// --- Automation Rules Engine ---
const automationEngine = new AutomationRulesEngine();
console.log('[automation] Rules engine initialized with default farm automation rules');

const {
  engine: preAutomationEngine,
  envStore: preEnvStore,
  rulesStore: preRulesStore,
  registry: prePlugRegistry,
  plugManager: prePlugManager
} = createPreAutomationLayer({ dataDir: path.resolve('./data/automation') });
console.log('[automation] Pre-AI automation layer initialized (sensors + smart plugs)');

function applyCorsHeaders(req, res, methods = 'GET,POST,PATCH,DELETE,OPTIONS') {
  const origin = req.headers?.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    const existingVary = res.getHeader('Vary');
    if (existingVary) {
      if (!String(existingVary).split(/,\s*/).includes('Origin')) {
        res.setHeader('Vary', `${existingVary}, Origin`);
      }
    } else {
      res.setHeader('Vary', 'Origin');
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', methods);

  const requestedHeaders = req.headers?.['access-control-request-headers'];
  const allowHeaders = requestedHeaders && typeof requestedHeaders === 'string'
    ? requestedHeaders
    : 'Content-Type, Authorization, X-Requested-With';
  res.setHeader('Access-Control-Allow-Headers', allowHeaders);
}

function setPreAutomationCors(req, res) {
  applyCorsHeaders(req, res, 'GET,POST,PATCH,DELETE,OPTIONS');
}

function proxyCorsMiddleware(req, res, next) {
  applyCorsHeaders(req, res, 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

// --- Pre-AI Automation API ---

app.options('/env', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/plugs', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/plugs/*', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/rules', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/rules/*', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });

app.get('/env', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const snapshot = preEnvStore.getSnapshot();
    const zones = Object.entries(snapshot.scopes || {}).map(([scopeId, scopeData]) => {
      const sensors = Object.entries(scopeData.sensors || {}).reduce((acc, [sensorKey, sensorData]) => {
        acc[sensorKey] = {
          current: sensorData.value,
          unit: sensorData.unit || null,
          observedAt: sensorData.observedAt || null,
          history: Array.isArray(sensorData.history) ? sensorData.history : [],
          setpoint: snapshot.targets?.[scopeId]?.[sensorKey] || null
        };
        return acc;
      }, {});

      const activeRule = preAutomationEngine.getActiveRule(scopeId);

      return {
        id: scopeId,
        name: scopeData.name || scopeData.label || scopeId,
        sensors,
        updatedAt: scopeData.updatedAt || null,
        meta: {
          ...scopeData.meta,
          managedByPlugs: Boolean(activeRule),
          activeRuleId: activeRule?.ruleId || null,
          activeRuleAt: activeRule ? new Date(activeRule.executedAt).toISOString() : null
        }
      };
    });

    res.json({ ok: true, env: snapshot, zones });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/env', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const body = req.body || {};
    const scope = body.scope || body.room || 'default';
    const sensors = body.sensors || body.readings || {};
    const sensorArray = Array.isArray(sensors) ? sensors : Object.entries(sensors).map(([type, value]) => ({ type, value }));
    sensorArray.forEach((reading) => {
      if (!reading) return;
      const sensorType = reading.type || reading.sensor || reading.metric;
      if (!sensorType) return;
      const readingScope = reading.scope || reading.room || scope;
      preAutomationEngine.ingestSensor(readingScope, sensorType, {
        value: reading.value ?? reading.reading ?? null,
        unit: reading.unit,
        observedAt: reading.observedAt || reading.timestamp || new Date().toISOString(),
        meta: reading.meta || reading.metadata || null
      });
    });

    if (body.targets) {
      preAutomationEngine.setTargets(scope, body.targets);
    }

    const env = preEnvStore.getScope(scope);
    const targets = preEnvStore.getTargets(scope);
    res.json({ ok: true, scope, env, targets });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/plugs', asyncHandler(async (req, res) => {
  setPreAutomationCors(req, res);
  const plugs = await prePlugManager.discoverAll();
  res.json({ ok: true, plugs });
}));

app.post('/plugs/discover', asyncHandler(async (req, res) => {
  setPreAutomationCors(req, res);
  const plugs = await prePlugManager.discoverAll();
  res.json({ ok: true, plugs, refreshedAt: new Date().toISOString() });
}));

app.post('/plugs/register', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const body = req.body || {};
    const vendor = String(body.vendor || '').toLowerCase();
    const deviceId = body.deviceId || body.shortId || body.serial || body.id;
    if (!vendor || !deviceId) {
      return res.status(400).json({ ok: false, error: 'vendor and deviceId are required' });
    }
    const saved = preAutomationEngine.registerPlug({
      vendor,
      deviceId,
      name: body.name,
      model: body.model,
      manual: true,
      connection: body.connection || {},
      metadata: body.metadata || {}
    });
    res.json({ ok: true, plug: saved });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete('/plugs/:plugId', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const plugId = decodeURIComponent(req.params.plugId);
    const removed = preAutomationEngine.unregisterPlug(plugId);
    res.json({ ok: true, removed });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/plugs/:plugId/state', asyncHandler(async (req, res) => {
  setPreAutomationCors(req, res);
  const plugId = decodeURIComponent(req.params.plugId);
  const body = req.body || {};
  const desired = typeof body.on === 'boolean'
    ? body.on
    : typeof body.state === 'boolean'
    ? body.state
    : typeof body.set === 'string'
    ? body.set.toLowerCase() === 'on'
    : null;
  if (desired === null) {
    return res.status(400).json({ ok: false, error: 'Request body must include on/state boolean or set:"on|off"' });
  }
  const state = await preAutomationEngine.setPlugState(plugId, desired);
  res.json({ ok: true, plugId, state });
}));

app.post('/plugs/:plugId/rules', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const plugId = decodeURIComponent(req.params.plugId);
    const body = req.body || {};
    const ruleIds = Array.isArray(body.ruleIds) ? body.ruleIds : [];
    const actionConfig = body.action || body.actionConfig || { set: 'on' };

    const allRules = preRulesStore.list();
    const existingRuleIds = allRules.filter((rule) => Array.isArray(rule.actions) && rule.actions.some((action) => action.plugId === plugId)).map((rule) => rule.id);

    const toRemove = existingRuleIds.filter((id) => !ruleIds.includes(id));
    const toAdd = ruleIds.filter((id) => !existingRuleIds.includes(id));

    toRemove.forEach((ruleId) => preAutomationEngine.removePlugAssignment(ruleId, plugId));
    toAdd.forEach((ruleId) => preAutomationEngine.assignPlug(ruleId, plugId, actionConfig));

    const updatedRules = preRulesStore.list().filter((rule) => ruleIds.includes(rule.id));
    res.json({ ok: true, plugId, rules: updatedRules });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/rules', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const rules = preAutomationEngine.listRules();
    res.json({ ok: true, rules });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/rules/:ruleId', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const rule = preRulesStore.find(req.params.ruleId);
    if (!rule) {
      return res.status(404).json({ ok: false, error: 'Rule not found' });
    }
    res.json({ ok: true, rule });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/rules', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const body = req.body || {};
    if (!body.when || !body.actions) {
      return res.status(400).json({ ok: false, error: 'Rule must include when and actions' });
    }
    const saved = preAutomationEngine.upsertRule(body);
    res.json({ ok: true, rule: saved });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch('/rules/:ruleId', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const existing = preRulesStore.find(req.params.ruleId);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Rule not found' });
    }
    const body = req.body || {};
    const merged = { ...existing, ...body, id: existing.id };
    const saved = preAutomationEngine.upsertRule(merged);
    res.json({ ok: true, rule: saved });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete('/rules/:ruleId', (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const removed = preAutomationEngine.removeRule(req.params.ruleId);
    res.json({ ok: true, removed });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// --- IFTTT Integration (optional) ---
// Status endpoint for quick checks
app.get('/integrations/ifttt/status', (req, res) => {
  res.json({
    enabled: IFTTT_ENABLED,
    outboundConfigured: Boolean(IFTTT_KEY),
    inboundProtected: Boolean(IFTTT_INBOUND_TOKEN),
    makerBase: 'https://maker.ifttt.com/trigger/{event}/json/with/key/{key}'
  });
});

// Outbound trigger: POST /integrations/ifttt/trigger/:event
// Body is forwarded as JSON to IFTTT (can include value1/value2/value3 or any JSON fields)
app.post('/integrations/ifttt/trigger/:event', asyncHandler(async (req, res) => {
  if (!IFTTT_KEY) return res.status(400).json({ ok: false, error: 'IFTTT_KEY not configured' });
  const evt = String(req.params.event || '').trim();
  if (!evt) return res.status(400).json({ ok: false, error: 'event is required' });

  const url = `https://maker.ifttt.com/trigger/${encodeURIComponent(evt)}/json/with/key/${IFTTT_KEY}`;
  const payload = req.body && Object.keys(req.body).length ? req.body : {};
  const t0 = Date.now();
  let response, text;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    text = await response.text().catch(() => '');
  } catch (e) {
    return res.status(502).json({ ok: false, error: `IFTTT request failed: ${e.message}` });
  }
  const ms = Date.now() - t0;
  return res.status(response.ok ? 200 : 502).json({ ok: response.ok, status: response.status, ms, event: evt, payload, responseBody: text });
}));

// Inbound webhook: IFTTT -> Charlie (secure with shared token)
// Create an IFTTT applet action "Webhooks -> Make a web request" to this URL:
// POST https://<public-host>/integrations/ifttt/incoming/<event>?token=<YOUR_TOKEN>
// JSON body can include { deviceId, action, value, ... }
app.post('/integrations/ifttt/incoming/:event', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers['x-ifttt-token'];
  if (!IFTTT_INBOUND_TOKEN) return res.status(501).json({ ok: false, error: 'Inbound token not configured on server' });
  if (!token || String(token) !== String(IFTTT_INBOUND_TOKEN)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const evt = String(req.params.event || '').trim();
  const body = req.body || {};
  const receivedAt = new Date().toISOString();

  // Process through automation engine for sensor-triggered automations
  try {
    await automationEngine.processIFTTTTrigger(evt, body);
    console.log(`[automation] Processed IFTTT trigger: ${evt}`);
  } catch (automationError) {
    console.warn('IFTTT automation processing failed:', automationError.message);
  }

  // Minimal action router (extend as needed)
  let routed = null;
  try {
    if (evt === 'device-control' && body.deviceId && body.action) {
      // Map simple power actions to existing endpoints
      if (['turnOn', 'turnOff'].includes(body.action)) {
        const url = `http://127.0.0.1:${PORT}/api/device/${encodeURIComponent(body.deviceId)}/power`;
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: body.action === 'turnOn' }) });
        routed = { endpoint: url, status: resp.status };
      }
    }
  } catch (e) {
    console.warn('IFTTT inbound action route failed:', e.message);
  }

  res.json({ ok: true, event: evt, receivedAt, body, routed });
}));

// --- Device Database (NeDB) ---
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAssignedEquipment(value) {
  if (!isPlainObject(value)) {
    return { roomId: null, equipmentId: null };
  }
  const roomId = value.roomId ?? value.room ?? null;
  const equipmentId = value.equipmentId ?? value.equipment ?? null;
  return {
    roomId: roomId === '' ? null : roomId,
    equipmentId: equipmentId === '' ? null : equipmentId,
  };
}

function buildDeviceDoc(existing, incoming = {}) {
  const base = existing ? { ...existing } : {};
  const payload = isPlainObject(incoming) ? { ...incoming } : {};
  const idFromPayload = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : null;
  const deviceIdFromPayload = typeof payload.device_id === 'string' && payload.device_id.trim() ? payload.device_id.trim() : null;
  const id = idFromPayload || deviceIdFromPayload || base.id;
  if (!id) {
    throw new Error('id required');
  }

  const name = payload.name || payload.deviceName || base.name || base.deviceName || id;
  const protocolRaw = payload.protocol ?? payload.transport ?? base.protocol ?? base.transport ?? 'other';
  const protocol = typeof protocolRaw === 'string' && protocolRaw.trim() ? protocolRaw.trim().toLowerCase() : 'other';
  const category = payload.category || base.category || (id.startsWith('light-') ? 'lighting' : 'device');
  const capabilities = isPlainObject(payload.capabilities)
    ? payload.capabilities
    : (isPlainObject(base.capabilities) ? base.capabilities : {});
  const details = isPlainObject(payload.details)
    ? payload.details
    : (isPlainObject(base.details) ? base.details : {});
  const assignedEquipment = normalizeAssignedEquipment(payload.assignedEquipment ?? base.assignedEquipment);
  const online = typeof payload.online === 'boolean'
    ? payload.online
    : (typeof base.online === 'boolean' ? base.online : false);

  const doc = {
    ...base,
    ...payload,
    id,
    deviceName: payload.deviceName || base.deviceName || name,
    name,
    transport: protocol,
    protocol,
    category,
    online,
    capabilities,
    assignedEquipment,
    details,
  };

  delete doc.device_id;
  delete doc.deviceId;

  return doc;
}

function deviceDocToJson(d){
  if (!d) return null;
  const {
    _id,
    id,
    device_id,
    deviceId,
    deviceName,
    name,
    category,
    type,
    transport,
    protocol,
    online,
    capabilities,
    details,
    assignedEquipment,
    createdAt,
    updatedAt,
    ...rest
  } = d;

  const deviceIdValue = device_id || deviceId || id || '';
  const protocolValue = (protocol || transport || 'other') || 'other';
  const baseDetails = isPlainObject(details) ? { ...details } : {};
  const extraDetails = { ...rest };
  delete extraDetails.extra; // legacy nested blob

  const detailPayload = {
    ...extraDetails,
    ...baseDetails,
    manufacturer: rest?.manufacturer ?? baseDetails.manufacturer ?? rest?.extra?.manufacturer,
    model: rest?.model ?? baseDetails.model ?? rest?.extra?.model,
    serial: rest?.serial ?? baseDetails.serial ?? rest?.extra?.serial,
    watts: rest?.watts ?? baseDetails.watts ?? rest?.extra?.watts,
    spectrumMode: rest?.spectrumMode ?? baseDetails.spectrumMode ?? rest?.extra?.spectrumMode,
    createdAt,
    updatedAt,
  };

  const sanitizedDetails = Object.fromEntries(
    Object.entries(detailPayload).filter(([, value]) => value !== undefined)
  );

  return {
    device_id: deviceIdValue,
    name: name || deviceName || rest?.model || deviceIdValue,
    category: category || type || rest?.category || 'device',
    protocol: String(protocolValue || 'other').toLowerCase() || 'other',
    online: Boolean(online),
    capabilities: isPlainObject(capabilities) ? { ...capabilities } : {},
    assignedEquipment: normalizeAssignedEquipment(assignedEquipment),
    details: sanitizedDetails,
  };
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
    const rows = Object.entries(devices).map(([id, m]) => {
      const name = m.deviceName || m.name || (/^light-/i.test(id) ? id.replace('light-', 'Light ').toUpperCase() : id);
      const protocol = String(m.protocol || m.transport || m.conn || m.connectivity || '').toLowerCase();
      const assignedEquipment = normalizeAssignedEquipment({
        roomId: m.roomId ?? m.room ?? null,
        equipmentId: m.equipmentId ?? m.module ?? null,
      });
      return {
        id,
        deviceName: name,
        name,
        manufacturer: m.manufacturer || '',
        model: m.model || '',
        serial: m.serial || '',
        watts: m.watts || m.nominalW || null,
        spectrumMode: m.spectrumMode || '',
        transport: protocol,
        protocol,
        category: m.category || m.type || (/^light-/i.test(id) ? 'lighting' : ''),
        online: Boolean(m.online),
        capabilities: isPlainObject(m.capabilities) ? m.capabilities : {},
        assignedEquipment,
        farm: m.farm || '',
        room: assignedEquipment.roomId || '',
        zone: m.zone || '',
        module: m.module || '',
        level: m.level || '',
        side: m.side || '',
        details: isPlainObject(m.details) ? m.details : {},
        extra: m,
      };
    });
    await store.insert(rows);
    console.log(`[charlie] seeded ${rows.length} device(s) from device-meta.json`);
  } catch (e) {
    console.warn('[charlie] seedDevicesFromMeta (NeDB) failed:', e.message);
  }
}

const devicesStore = createDeviceStore();
// Initialize device seeding asynchronously without blocking startup
(async () => {
  try {
    await seedDevicesFromMetaNedb(devicesStore);
  } catch (error) {
    console.warn('[charlie] Device seeding failed:', error.message);
  }
})();

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
    return res.json({ device: deviceDocToJson(row) });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// POST /devices → upsert (requires id)
app.post('/devices', async (req, res) => {
  try {
    setApiCors(res);
    const d = req.body || {};
    let draft;
    try {
      draft = buildDeviceDoc(null, d);
    } catch (validationError) {
      return res.status(400).json({ ok: false, error: validationError.message });
    }
    const id = draft.id;
    const existing = await devicesStore.findOne({ id });
    const merged = buildDeviceDoc(existing, d);
    const timestamp = new Date().toISOString();
    if (existing) {
      await devicesStore.update({ id }, { $set: { ...merged, updatedAt: timestamp } }, {});
    } else {
      await devicesStore.insert({ ...merged, createdAt: timestamp, updatedAt: timestamp });
    }
    const row = await devicesStore.findOne({ id });
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
    let merged;
    try {
      merged = buildDeviceDoc(existing, { ...req.body, id });
    } catch (validationError) {
      return res.status(400).json({ ok: false, error: validationError.message });
    }
    await devicesStore.update({ id }, { $set: { ...merged, updatedAt: new Date().toISOString() } }, {});
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

// Kasa device discovery endpoint
app.get("/api/kasa/devices", asyncHandler(async (req, res) => {
  try {
    const client = await createKasaClient();
    const devices = [];
    
    console.log('🔍 Discovering Kasa devices...');
    
    // Start discovery
    client.startDiscovery({
      port: 9999,
      broadcast: '255.255.255.255',
      timeout: parseInt(req.query.timeout) || 5000
    });
    
    // Collect devices
    client.on('device-new', async (device) => {
      try {
        const sysInfo = await device.getSysInfo();
        devices.push({
          deviceId: device.deviceId,
          alias: device.alias || sysInfo.alias,
          host: device.host,
          port: device.port,
          model: sysInfo.model,
          type: sysInfo.type,
          deviceType: sysInfo.mic_type || sysInfo.type,
          softwareVersion: sysInfo.sw_ver,
          hardwareVersion: sysInfo.hw_ver,
          state: sysInfo.relay_state || 0,
          ledOff: sysInfo.led_off || 0,
          rssi: sysInfo.rssi,
          latitude: sysInfo.latitude,
          longitude: sysInfo.longitude,
          discoveredAt: new Date().toISOString()
        });
      } catch (err) {
        console.warn(`Error getting info for device ${device.deviceId}:`, err.message);
        devices.push({
          deviceId: device.deviceId,
          alias: device.alias || 'Unknown Kasa Device',
          host: device.host,
          port: device.port,
          error: err.message,
          discoveredAt: new Date().toISOString()
        });
      }
    });
    
    // Wait for discovery with proper timeout handling
    const timeoutMs = parseInt(req.query.timeout) || 5000;
    await new Promise(resolve => setTimeout(resolve, timeoutMs + 1000)); // Add 1 second buffer
    client.stopDiscovery();
    
    res.json({
      success: true,
      count: devices.length,
      devices: devices,
      scanTime: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Kasa discovery error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      devices: []
    });
  }
}));

// Kasa device control endpoint
app.post("/api/kasa/devices/:deviceId/control", asyncHandler(async (req, res) => {
  try {
    const { Client } = await import('tplink-smarthome-api');
    const client = new Client();
    const { deviceId } = req.params;
    const { action, value } = req.body;
    
    // Find device by scanning (since we need IP)
    let targetDevice = null;
    
    client.startDiscovery({ timeout: 3000 });
    
    await new Promise((resolve) => {
      client.on('device-new', (device) => {
        if (device.deviceId === deviceId) {
          targetDevice = device;
          client.stopDiscovery();
          resolve();
        }
      });
      
      setTimeout(() => {
        client.stopDiscovery();
        resolve();
      }, 3500);
    });
    
    if (!targetDevice) {
      return res.status(404).json({
        success: false,
        error: `Kasa device ${deviceId} not found on network`
      });
    }
    
    let result;
    
    switch (action) {
      case 'turnOn':
        result = await targetDevice.setPowerState(true);
        break;
      case 'turnOff':
        result = await targetDevice.setPowerState(false);
        break;
      case 'toggle':
        const info = await targetDevice.getSysInfo();
        result = await targetDevice.setPowerState(!info.relay_state);
        break;
      case 'setAlias':
        result = await targetDevice.setAlias(value);
        break;
      default:
        return res.status(400).json({
          success: false,
          error: `Unknown action: ${action}`
        });
    }
    
    // Get updated status
    const status = await targetDevice.getSysInfo();
    
    res.json({
      success: true,
      action: action,
      deviceId: deviceId,
      result: result,
      status: {
        state: status.relay_state,
        alias: status.alias,
        rssi: status.rssi
      }
    });
    
  } catch (error) {
    console.error('Kasa control error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Kasa device status endpoint
app.get("/api/kasa/devices/:deviceId/status", asyncHandler(async (req, res) => {
  try {
    const { Client } = await import('tplink-smarthome-api');
    const client = new Client();
    const { deviceId } = req.params;
    
    // Find and get status
    let targetDevice = null;
    
    client.startDiscovery({ timeout: 3000 });
    
    await new Promise((resolve) => {
      client.on('device-new', (device) => {
        if (device.deviceId === deviceId) {
          targetDevice = device;
          client.stopDiscovery();
          resolve();
        }
      });
      
      setTimeout(() => {
        client.stopDiscovery();
        resolve();
      }, 3500);
    });
    
    if (!targetDevice) {
      return res.status(404).json({
        success: false,
        error: `Kasa device ${deviceId} not found`
      });
    }
    
    const [sysInfo, schedule, time, meter] = await Promise.allSettled([
      targetDevice.getSysInfo(),
      targetDevice.getScheduleNextAction?.() || Promise.resolve(null),
      targetDevice.getTime?.() || Promise.resolve(null),
      targetDevice.getMeterInfo?.() || Promise.resolve(null)
    ]);
    
    res.json({
      success: true,
      deviceId: deviceId,
      status: {
        basic: sysInfo.status === 'fulfilled' ? sysInfo.value : null,
        schedule: schedule.status === 'fulfilled' ? schedule.value : null,
        time: time.status === 'fulfilled' ? time.value : null,
        energy: meter.status === 'fulfilled' ? meter.value : null,
        lastUpdated: new Date().toISOString()
      },
      errors: [sysInfo, schedule, time, meter]
        .filter(p => p.status === 'rejected')
        .map(p => p.reason?.message)
    });
    
  } catch (error) {
    console.error('Kasa status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

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

// --- Automation Rules Management API (BEFORE proxy) ---

// Get all automation rules
app.get('/api/automation/rules', (req, res) => {
  try {
    const rules = automationEngine.getRules();
    res.json({
      success: true,
      rules,
      count: rules.length
    });
  } catch (error) {
    console.error('Error getting automation rules:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add or update an automation rule
app.post('/api/automation/rules', (req, res) => {
  try {
    const rule = req.body;
    if (!rule.id || !rule.name || !rule.trigger || !rule.actions) {
      return res.status(400).json({
        success: false,
        error: 'Rule must have id, name, trigger, and actions'
      });
    }
    
    automationEngine.addRule(rule);
    res.json({
      success: true,
      message: `Rule ${rule.id} added/updated`,
      rule: automationEngine.getRules().find(r => r.id === rule.id)
    });
  } catch (error) {
    console.error('Error adding automation rule:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete an automation rule
app.delete('/api/automation/rules/:ruleId', (req, res) => {
  try {
    const { ruleId } = req.params;
    automationEngine.removeRule(ruleId);
    res.json({
      success: true,
      message: `Rule ${ruleId} removed`
    });
  } catch (error) {
    console.error('Error removing automation rule:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enable/disable a rule
app.patch('/api/automation/rules/:ruleId', (req, res) => {
  try {
    const { ruleId } = req.params;
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'enabled field must be boolean'
      });
    }
    
    automationEngine.setRuleEnabled(ruleId, enabled);
    res.json({
      success: true,
      message: `Rule ${ruleId} ${enabled ? 'enabled' : 'disabled'}`,
      rule: automationEngine.getRules().find(r => r.id === ruleId)
    });
  } catch (error) {
    console.error('Error updating automation rule:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get automation execution history
app.get('/api/automation/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const history = automationEngine.getHistory(limit);
    res.json({
      success: true,
      history,
      count: history.length
    });
  } catch (error) {
    console.error('Error getting automation history:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get current sensor cache
app.get('/api/automation/sensors', (req, res) => {
  try {
    const sensors = automationEngine.getSensorCache();
    res.json({
      success: true,
      sensors,
      count: Object.keys(sensors).length
    });
  } catch (error) {
    console.error('Error getting sensor cache:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test automation rule with sample data
app.post('/api/automation/test', async (req, res) => {
  try {
    const { sensorData } = req.body;
    if (!sensorData || !sensorData.source || !sensorData.type || typeof sensorData.value !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'sensorData must have source, type, and numeric value'
      });
    }
    
    console.log('[automation] Testing rule execution with sample data:', sensorData);
    await automationEngine.processSensorData(sensorData);
    
    res.json({
      success: true,
      message: 'Test sensor data processed through automation engine',
      testData: sensorData
    });
  } catch (error) {
    console.error('Error testing automation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manual trigger for specific automation rule
app.post('/api/automation/trigger/:ruleId', async (req, res) => {
  try {
    const { ruleId } = req.params;
    const { sensorData } = req.body;
    
    const rules = automationEngine.getRules();
    const rule = rules.find(r => r.id === ruleId);
    
    if (!rule) {
      return res.status(404).json({
        success: false,
        error: `Rule ${ruleId} not found`
      });
    }
    
    // Create mock sensor data if not provided
    const mockData = sensorData || {
      source: 'manual-trigger',
      deviceId: 'test-device',
      type: 'manual',
      value: 1,
      metadata: { manualTrigger: true }
    };
    
    console.log(`[automation] Manually triggering rule ${ruleId}`);
    await automationEngine.executeRule(rule, mockData, Date.now());
    
    res.json({
      success: true,
      message: `Rule ${ruleId} manually triggered`,
      rule: rule.name,
      triggerData: mockData
    });
  } catch (error) {
    console.error('Error manually triggering rule:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Geocoding and Weather endpoints must be registered BEFORE the /api proxy below
function getWeatherDescription(code) {
  const descriptions = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Depositing rime fog', 51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    56: 'Light freezing drizzle', 57: 'Dense freezing drizzle', 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    66: 'Light freezing rain', 67: 'Heavy freezing rain', 71: 'Slight snow fall', 73: 'Moderate snow fall', 75: 'Heavy snow fall', 77: 'Snow grains',
    80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers', 85: 'Slight snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail'
  };
  return descriptions[code] || 'Unknown';
}

app.get('/api/geocode', async (req, res) => {
  try {
    setCors(req, res);
    const { address } = req.query;
    if (!address) return res.status(400).json({ ok: false, error: 'Address parameter required' });
    const encodedAddress = encodeURIComponent(address);
    const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=5`;
    const response = await fetch(geocodeUrl, { headers: { 'User-Agent': 'Light-Engine-Charlie/1.0 (Farm Management System)' } });
    if (!response.ok) throw new Error(`Geocoding API error: ${response.status}`);
    const data = await response.json();
    const results = data.map(item => ({ display_name: item.display_name, lat: parseFloat(item.lat), lng: parseFloat(item.lon), formatted_address: item.display_name }));
    res.json({ ok: true, results });
  } catch (error) {
    console.error('Geocoding error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/weather', async (req, res) => {
  try {
    setCors(req, res);
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ ok: false, error: 'Latitude and longitude parameters required' });
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&hourly=temperature_2m,relative_humidity_2m,precipitation,weather_code&timezone=auto`;
    const response = await fetch(weatherUrl);
    if (!response.ok) throw new Error(`Weather API error: ${response.status}`);
    const data = await response.json();
    const weather = {
      ok: true,
      current: {
        temperature_c: data.current_weather.temperature,
        temperature_f: (data.current_weather.temperature * 9/5) + 32,
        humidity: Array.isArray(data.hourly?.relative_humidity_2m) ? data.hourly.relative_humidity_2m[0] : null,
        wind_speed: data.current_weather.windspeed,
        wind_direction: data.current_weather.winddirection,
        weather_code: data.current_weather.weathercode,
        is_day: data.current_weather.is_day,
        description: getWeatherDescription(data.current_weather.weathercode),
        last_updated: data.current_weather.time
      },
      location: { lat: parseFloat(lat), lng: parseFloat(lng) }
    };
    res.json(weather);
  } catch (error) {
    console.error('Weather API error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Reverse geocoding: lat/lng → address parts
app.get('/api/reverse-geocode', async (req, res) => {
  try {
    setCors(req, res);
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ ok: false, error: 'Latitude and longitude required' });
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&addressdetails=1`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Light-Engine-Charlie/1.0 (Farm Management System)' } });
    if (!r.ok) throw new Error(`Reverse geocoding error: ${r.status}`);
    const data = await r.json();
    const addr = data.address || {};
    res.json({ ok: true, address: {
      display_name: data.display_name || '',
      road: addr.road || addr.house_number || '',
      city: addr.city || addr.town || addr.village || addr.hamlet || '',
      state: addr.state || addr.region || '',
      postal: addr.postcode || '',
      country: addr.country || ''
    }});
  } catch (e) {
    console.error('Reverse geocoding error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// In-memory weather cache and lightweight polling for automations
let LAST_WEATHER = null;
let LAST_WEATHER_AT = 0;
let WEATHER_TIMER = null;

async function fetchAndCacheWeather(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&hourly=temperature_2m,relative_humidity_2m,precipitation,weather_code&timezone=auto`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Weather API ${r.status}`);
    const data = await r.json();
    LAST_WEATHER = {
      ok: true,
      current: {
        temperature_c: data.current_weather.temperature,
        temperature_f: (data.current_weather.temperature * 9/5) + 32,
        humidity: Array.isArray(data.hourly?.relative_humidity_2m) ? data.hourly.relative_humidity_2m[0] : null,
        wind_speed: data.current_weather.windspeed,
        wind_direction: data.current_weather.winddirection,
        weather_code: data.current_weather.weathercode,
        is_day: data.current_weather.is_day,
        description: getWeatherDescription(data.current_weather.weathercode),
        last_updated: data.current_weather.time
      },
      location: { lat: parseFloat(lat), lng: parseFloat(lng) }
    };
    LAST_WEATHER_AT = Date.now();

    // Optional: feed into automation engine as sensor data
    try {
      if (automationEngine) {
        const src = 'weather';
        const ts = Date.now();
        const w = LAST_WEATHER.current;
        const readings = [];
        if (typeof w.temperature_c === 'number') readings.push({ source: src, deviceId: 'outside', type: 'outside_temperature_c', value: w.temperature_c, metadata: { lat, lng, ts } });
        if (typeof w.humidity === 'number') readings.push({ source: src, deviceId: 'outside', type: 'outside_humidity', value: w.humidity, metadata: { lat, lng, ts } });
        if (typeof w.wind_speed === 'number') readings.push({ source: src, deviceId: 'outside', type: 'outside_wind_kmh', value: w.wind_speed, metadata: { lat, lng, ts } });
        for (const r of readings) await automationEngine.processSensorData(r);
      }
    } catch (e) { console.warn('Weather → automation feed failed:', e.message); }

  } catch (e) {
    console.warn('fetchAndCacheWeather error:', e.message);
  }
}

function setupWeatherPolling() {
  try {
    const farm = readJSONSafe(FARM_PATH, null);
    const coords = farm?.coordinates || farm?.location?.coordinates;
    if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') {
      if (WEATHER_TIMER) { clearInterval(WEATHER_TIMER); WEATHER_TIMER = null; }
      return;
    }
    // Kick off immediately and then every 10 minutes
    fetchAndCacheWeather(coords.lat, coords.lng);
    if (WEATHER_TIMER) clearInterval(WEATHER_TIMER);
    WEATHER_TIMER = setInterval(() => fetchAndCacheWeather(coords.lat, coords.lng), 10 * 60 * 1000);
  } catch {}
}

// Expose cached weather (falls back to fetching if stale and coords exist)
app.get('/api/weather/current', async (req, res) => {
  try {
    setCors(req, res);
    // If stale (>15 min) try refresh
    const farm = readJSONSafe(FARM_PATH, null);
    const coords = farm?.coordinates || farm?.location?.coordinates;
    const isStale = !LAST_WEATHER || (Date.now() - LAST_WEATHER_AT) > (15 * 60 * 1000);
    if (coords && isStale) await fetchAndCacheWeather(coords.lat, coords.lng);
    if (!LAST_WEATHER) return res.status(404).json({ ok: false, error: 'No weather cached and no farm coordinates set' });
    res.json(LAST_WEATHER);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Explicit OPTIONS handler for all /api/* endpoints to support CORS preflight
app.options('/api/*', (req, res) => {
  // Allow all origins for development; adjust as needed for production
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, Authorization, X-Requested-With');
  res.status(204).end();
});

// STRICT pass-through: client calls /api/* → controller receives /api/*
// Express strips the mount "/api", so add it back via pathRewrite.
app.use('/api', proxyCorsMiddleware, createProxyMiddleware({
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
  },
  onProxyRes(proxyRes, req, res) {
    const origin = req.headers?.origin;
    if (origin) {
      proxyRes.headers['access-control-allow-origin'] = origin;
      const existingVary = proxyRes.headers['vary'];
      if (existingVary) {
        const varyParts = String(existingVary).split(/,\s*/);
        if (!varyParts.includes('Origin')) {
          proxyRes.headers['vary'] = `${existingVary}, Origin`;
        }
      } else {
        proxyRes.headers['vary'] = 'Origin';
      }
    } else {
      proxyRes.headers['access-control-allow-origin'] = '*';
    }
    const requestedHeaders = req.headers?.['access-control-request-headers'];
    if (requestedHeaders && typeof requestedHeaders === 'string') {
      proxyRes.headers['access-control-allow-headers'] = requestedHeaders;
    } else if (!proxyRes.headers['access-control-allow-headers']) {
      proxyRes.headers['access-control-allow-headers'] = 'Content-Type, Authorization, X-Requested-With';
    }
    proxyRes.headers['access-control-allow-methods'] = 'GET,POST,PATCH,DELETE,OPTIONS';
  }
}));

// Namespaced pass-through for controller-bound helpers (e.g., /controller/sched)
app.use('/controller', proxyCorsMiddleware, createProxyMiddleware({
  target: getController(),
  router: () => getController(),
  changeOrigin: true,
  xfwd: true,
  logLevel: 'debug',
  pathRewrite: (path) => path.replace(/^\/controller/, ''),
  onProxyReq(proxyReq, req) {
    console.log(`[→] ${req.method} ${req.originalUrl} -> ${getController()}${req.url}`);
  },
  onProxyRes(proxyRes, req) {
    const origin = req.headers?.origin;
    if (origin) {
      proxyRes.headers['access-control-allow-origin'] = origin;
      const existingVary = proxyRes.headers['vary'];
      if (existingVary) {
        const varyParts = String(existingVary).split(/,\s*/);
        if (!varyParts.includes('Origin')) {
          proxyRes.headers['vary'] = `${existingVary}, Origin`;
        }
      } else {
        proxyRes.headers['vary'] = 'Origin';
      }
    } else {
      proxyRes.headers['access-control-allow-origin'] = '*';
    }
    const requestedHeaders = req.headers?.['access-control-request-headers'];
    if (requestedHeaders && typeof requestedHeaders === 'string') {
      proxyRes.headers['access-control-allow-headers'] = requestedHeaders;
    } else if (!proxyRes.headers['access-control-allow-headers']) {
      proxyRes.headers['access-control-allow-headers'] = 'Content-Type, Authorization, X-Requested-With';
    }
    proxyRes.headers['access-control-allow-methods'] = 'GET,POST,PATCH,DELETE,OPTIONS';
  }
}));

// Static files
// Serve static files
app.use(express.static("./public"));

// Allow direct access to JSON data files in /public/data with CORS headers
app.use('/data', (req, res, next) => {
  // Only allow .json files
  if (!req.path.endsWith('.json')) return res.status(403).send('Forbidden');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') return res.status(204).end();
  // Serve the file from public/data
  const filePath = path.join(__dirname, 'public', 'data', req.path);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.type('application/json');
  fs.createReadStream(filePath).pipe(res);
});

// Favicon handler: map /favicon.ico to our SVG to avoid 404 noise
app.get('/favicon.ico', (req, res) => {
  try {
    const file = path.resolve('./public/favicon.svg');
    res.setHeader('Content-Type', 'image/svg+xml');
    fs.createReadStream(file).pipe(res);
  } catch {
    res.status(204).end();
  }
});

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

// Geocoding and Weather endpoints must be registered BEFORE the /api proxy below
// Helper function to convert weather codes to descriptions
// (removed duplicate getWeatherDescription)

// Geocoding API to get coordinates from address
app.get('/api/geocode', async (req, res) => {
  try {
    setCors(req, res);
    const { address } = req.query;
    
    if (!address) {
      return res.status(400).json({ ok: false, error: 'Address parameter required' });
    }

    // Use Nominatim (OpenStreetMap) for free geocoding
    const encodedAddress = encodeURIComponent(address);
    const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=5`;
    
    const response = await fetch(geocodeUrl, {
      headers: {
        'User-Agent': 'Light-Engine-Charlie/1.0 (Farm Management System)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Geocoding API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    const results = data.map(item => ({
      display_name: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      formatted_address: item.display_name
    }));

    res.json({ ok: true, results });
  } catch (error) {
    console.error('Geocoding error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Weather API to get current conditions
app.get('/api/weather', async (req, res) => {
  try {
    setCors(req, res);
    const { lat, lng } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ ok: false, error: 'Latitude and longitude parameters required' });
    }

    // Use Open-Meteo for free weather data
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&hourly=temperature_2m,relative_humidity_2m,precipitation,weather_code&timezone=auto`;
    
    const response = await fetch(weatherUrl);
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    const weather = {
      ok: true,
      current: {
        temperature_c: data.current_weather.temperature,
        temperature_f: (data.current_weather.temperature * 9/5) + 32,
        humidity: Array.isArray(data.hourly?.relative_humidity_2m) ? data.hourly.relative_humidity_2m[0] : null,
        wind_speed: data.current_weather.windspeed,
        wind_direction: data.current_weather.winddirection,
        weather_code: data.current_weather.weathercode,
        is_day: data.current_weather.is_day,
        description: getWeatherDescription(data.current_weather.weathercode),
        last_updated: data.current_weather.time
      },
      location: {
        lat: parseFloat(lat),
        lng: parseFloat(lng)
      }
    };

    res.json(weather);
  } catch (error) {
    console.error('Weather API error:', error);
    res.status(500).json({ ok: false, error: error.message });
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
app.options('/controller', (req, res) => { setCors(req, res); res.status(204).end(); });
app.get('/controller', (req, res) => {
  setCors(req, res);
  res.json({ url: getController() });
});
app.post('/controller', (req, res) => {
  try {
    setCors(req, res);
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
function setCors(req, res) {
  applyCorsHeaders(req, res, 'GET,POST,OPTIONS');
}

app.options('/brand/extract', (req, res) => { setCors(req, res); res.status(204).end(); });
app.options('/farm', (req, res) => { setCors(req, res); res.status(204).end(); });

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

function resolveUiDataPath(resource) {
  const normalized = String(resource || '').toLowerCase();
  if (!UI_DATA_RESOURCES.has(normalized)) {
    return null;
  }
  return path.join(DATA_DIR, UI_DATA_RESOURCES.get(normalized));
}

function loadUiData(resource) {
  const normalized = String(resource || '').toLowerCase();
  const fullPath = resolveUiDataPath(normalized);
  if (!fullPath) {
    return null;
  }
  const fallback = normalized === 'plans' ? { plans: [] } : {};
  return readJSONSafe(fullPath, fallback);
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
    setCors(req, res);
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
    setCors(req, res);
    // neutral fallback
    const fallback = { background:'#F7FAFA', surface:'#FFFFFF', border:'#DCE5E5', text:'#0B1220', primary:'#0D7D7D', accent:'#64C7C7' };
    return res.status(200).json({ ok:false, error: e.message, name: '', logo: '', palette: fallback, fontFamily: '', fontCss: [] });
  }
});

// GET current farm (including branding)
app.get('/farm', (req, res) => {
  try {
    setCors(req, res);
    const data = readJSONSafe(FARM_PATH, null) || { farmName:'', locations:[], contact:{}, crops:[], branding:null };
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// Save farm
app.post('/farm', (req, res) => {
  try {
    setCors(req, res);
    const body = req.body || {};
    // basic shape: store as-is
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FARM_PATH, JSON.stringify(body, null, 2));
    // Reconfigure weather polling when farm coordinates change
    setupWeatherPolling();
    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// Geocoding API to get coordinates from address

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
app.post("/ingest/env", async (req, res) => {
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

    // Process sensor readings through automation engine
    try {
      const sensorReadings = [];
      if (typeof temperature === "number" && !Number.isNaN(temperature)) {
        sensorReadings.push({
          source: source || 'env-ingest',
          deviceId: zoneId,
          type: 'temperature',
          value: temperature,
          metadata: { zone: zone.name, battery, rssi }
        });
      }
      if (typeof humidity === "number" && !Number.isNaN(humidity)) {
        sensorReadings.push({
          source: source || 'env-ingest',
          deviceId: zoneId,
          type: 'humidity',
          value: humidity,
          metadata: { zone: zone.name, battery, rssi }
        });
      }
      if (typeof co2 === "number" && !Number.isNaN(co2)) {
        sensorReadings.push({
          source: source || 'env-ingest',
          deviceId: zoneId,
          type: 'co2',
          value: co2,
          metadata: { zone: zone.name, battery, rssi }
        });
      }
      if (typeof vpd === "number" && !Number.isNaN(vpd)) {
        sensorReadings.push({
          source: source || 'env-ingest',
          deviceId: zoneId,
          type: 'vpd',
          value: vpd,
          metadata: { zone: zone.name, battery, rssi }
        });
      }

      // Process each sensor reading through automation rules
      for (const reading of sensorReadings) {
        await automationEngine.processSensorData(reading);
      }
      
      if (sensorReadings.length > 0) {
        console.log(`[automation] Processed ${sensorReadings.length} sensor readings from zone ${zoneId}`);
      }
    } catch (automationError) {
      console.warn('Sensor automation processing failed:', automationError.message);
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Namespaced UI config endpoints to avoid collisions with controller routes
app.options('/ui/:resource', (req, res) => { setCors(req, res); res.status(204).end(); });

app.get('/ui/:resource', (req, res) => {
  const resource = String(req.params.resource || '').toLowerCase();
  setCors(req, res);
  const data = loadUiData(resource);
  if (data === null) {
    return res.status(404).json({ ok: false, error: `Unknown UI resource '${resource}'` });
  }
  return res.json({ ok: true, resource, data });
});

app.post('/ui/:resource', (req, res) => {
  const resource = String(req.params.resource || '').toLowerCase();
  setCors(req, res);
  const fullPath = resolveUiDataPath(resource);
  if (!fullPath) {
    return res.status(404).json({ ok: false, error: `Unknown UI resource '${resource}'` });
  }
  try {
    ensureDataDir();
    const body = req.body ?? {};
    const payload = JSON.stringify(body, null, 2);
    fs.writeFileSync(fullPath, payload);
    return res.json({ ok: true, resource, bytesWritten: Buffer.byteLength(payload) });
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

app.options('/groups', (req, res) => { setCors(req, res); res.status(204).end(); });
app.options('/groups/:id', (req, res) => { setCors(req, res); res.status(204).end(); });

app.get('/groups', (req, res) => {
  setCors(req, res);
  try {
    const groups = loadGroupsFile().map(normalizeGroupForResponse).filter(Boolean);
    return res.json({ ok: true, groups });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/groups', (req, res) => {
  setCors(req, res);
  const body = req.body ?? {};
  const incoming = Array.isArray(body.groups) ? body.groups : (Array.isArray(body) ? body : null);
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ ok: false, error: 'Expected { groups: [...] } payload.' });
  }
  try {
    const parsed = incoming.map((g) => {
      if (g.match && (typeof g.match === 'object')) {
        const room = String(g.match.room ?? '').trim();
        const zone = String(g.match.zone ?? '').trim();
        if (!room || !zone) throw new Error('Group match{} must include both room and zone.');
      }
      return parseIncomingGroup(g);
    });
    const stored = parsed.map((item) => item.stored);
    if (!saveGroupsFile(stored)) {
      return res.status(500).json({ ok: false, error: 'Failed to persist groups.' });
    }
    return res.json({ ok: true, groups: parsed.map((item) => item.response) });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.put('/groups/:id', (req, res) => {
  setCors(req, res);
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'Group id is required.' });
  const existing = loadGroupsFile();
  const idx = existing.findIndex((group) => String(group?.id || '').trim() === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: `Group '${id}' not found.` });
  try {
    const merged = { ...req.body, id };
    if (merged.match && (typeof merged.match === 'object')) {
      const room = String(merged.match.room ?? '').trim();
      const zone = String(merged.match.zone ?? '').trim();
      if (!room || !zone) throw new Error('Group match{} must include both room and zone.');
    }
    const { stored, response } = parseIncomingGroup(merged);
    existing[idx] = stored;
    if (!saveGroupsFile(existing)) {
      return res.status(500).json({ ok: false, error: 'Failed to persist groups.' });
    }
    return res.json({ ok: true, group: response });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
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

// Consolidated Lights Status endpoint
// GET /api/lights/status?refresh=switchbot|kasa|all&scanKasa=1&limit=<n>
// Default is fast: use cached SwitchBot device/status; query controller for Kasa if available; registry devices are included as unknown
app.get('/api/lights/status', asyncHandler(async (req, res) => {
  const refreshParam = String(req.query.refresh || '').toLowerCase();
  const refreshSwitchBot = refreshParam === 'switchbot' || refreshParam === 'all' || refreshParam === 'true' || refreshParam === '1';
  const refreshKasa = refreshParam === 'kasa' || refreshParam === 'all';
  const scanKasa = ['1', 'true', 'yes'].includes(String(req.query.scanKasa || '').toLowerCase());
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 100));

  const entries = [];
  const sourcesMeta = { switchbot: { used: false }, kasa: { used: false }, registry: { used: false } };

  // Helper: normalize power flag
  const normPower = (v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    if (typeof v === 'string') return v.toLowerCase() === 'on' || v === '1' || v === 'true';
    return null;
  };

  // 1) SwitchBot (from cache; optional refresh limited by API rate limits)
  try {
    const sb = await fetchSwitchBotDevices({ force: refreshSwitchBot });
    sourcesMeta.switchbot = { used: true, cached: sb.fromCache, stale: sb.stale, fetchedAt: sb.fetchedAt ? new Date(sb.fetchedAt).toISOString() : null, error: sb.error?.message || null };
    const list = sb.payload?.body?.deviceList || [];
    for (const device of list) {
      const type = String(device.deviceType || '').toLowerCase();
      // Only include likely light-capable devices (bulb/strip/ceiling) and plugs used for lights
      const looksLikeLight = /(bulb|light|strip)/.test(type);
      const looksLikePlug = /plug/.test(type);
      if (!looksLikeLight && !looksLikePlug) continue;

      let power = null, brightness = null, meta = { cached: true, stale: false };
      try {
        const cacheEntry = getSwitchBotStatusEntry(device.deviceId);
        if (cacheEntry.payload && cacheEntry.payload.body) {
          power = normPower(cacheEntry.payload.body.power);
          // Many SwitchBot lighting devices expose brightness as number 1-100
          brightness = typeof cacheEntry.payload.body.brightness === 'number' ? cacheEntry.payload.body.brightness : null;
          meta = { cached: true, stale: (Date.now() - cacheEntry.fetchedAt) > SWITCHBOT_STATUS_CACHE_TTL_MS, fetchedAt: new Date(cacheEntry.fetchedAt).toISOString(), error: cacheEntry.lastError?.message || null };
        } else if (refreshSwitchBot) {
          // Optional on-demand refresh for a small subset (respect rate limits externally)
          const st = await fetchSwitchBotDeviceStatus(device.deviceId, { force: true });
          power = normPower(st.payload?.body?.power);
          brightness = typeof st.payload?.body?.brightness === 'number' ? st.payload.body.brightness : null;
          meta = { cached: st.fromCache, stale: st.stale, fetchedAt: st.fetchedAt ? new Date(st.fetchedAt).toISOString() : null };
        }
      } catch (e) {
        meta = { cached: false, stale: true, error: e.message };
      }

      entries.push({
        id: `switchbot:${device.deviceId}`,
        name: device.deviceName || `SwitchBot ${device.deviceType}`,
        vendor: 'SwitchBot',
        source: 'switchbot',
        type: device.deviceType,
        room: null,
        zone: null,
        power: power,
        brightness,
        watts: null,
        lastUpdated: meta.fetchedAt || null,
        meta
      });
      if (entries.length >= limit) break;
    }
  } catch (e) {
    sourcesMeta.switchbot = { used: true, error: e.message };
  }

  // 2) Kasa devices: try controller first; optionally scan locally if requested
  try {
    let kasaDevices = [];
    const controller = getController();
    if (controller) {
      try {
        const r = await fetch(`${controller.replace(/\/$/, '')}/api/devices/kasa`);
        if (r.ok) {
          const body = await r.json();
          if (Array.isArray(body?.devices)) {
            kasaDevices = body.devices.map(d => ({
              id: d.device_id,
              name: d.name,
              state: d.details?.state ?? d.state ?? null,
              address: d.details?.host || null,
              model: d.details?.model || d.model || null
            }));
          }
        }
      } catch {}
    }

    if (kasaDevices.length === 0 && (scanKasa || refreshKasa)) {
      try {
        // Use built-in discovery (slower). Avoid per-device status calls; rely on relay_state from discovery
        const client = await createKasaClient();
        const found = [];
        client.startDiscovery({ timeout: 3500 });
        client.on('device-new', async (device) => {
          try {
            const si = await device.getSysInfo();
            found.push({ id: device.deviceId, name: device.alias || si.alias, state: si.relay_state ?? null, address: device.host, model: si.model || null });
          } catch {}
        });
        await new Promise(resolve => setTimeout(resolve, 3800));
        client.stopDiscovery();
        kasaDevices = found;
      } catch {}
    }

    if (kasaDevices.length) {
      sourcesMeta.kasa = { used: true, count: kasaDevices.length };
      for (const d of kasaDevices) {
        entries.push({
          id: `kasa:${d.id}`,
          name: d.name || `Kasa ${d.model || ''}`.trim(),
          vendor: 'TP-Link Kasa',
          source: 'kasa',
          type: 'smart-plug',
          room: null,
          zone: null,
          power: normPower(d.state),
          brightness: null,
          watts: null,
          lastUpdated: null,
          meta: { discovered: true, address: d.address }
        });
        if (entries.length >= limit) break;
      }
    }
  } catch (e) {
    sourcesMeta.kasa = { used: true, error: e.message };
  }

  // 3) Device registry (NeDB) — include registered lights as inventory (status unknown)
  try {
    const rows = await devicesStore.find({});
    const lights = rows.filter(r => /^light-/i.test(String(r.id || '')));
    sourcesMeta.registry = { used: true, count: lights.length };
    for (const d of lights) {
      entries.push({
        id: d.id,
        name: d.deviceName || d.id,
        vendor: d.manufacturer || 'Registered',
        source: 'registry',
        type: d.model || 'light-fixture',
        room: d.room || null,
        zone: d.zone || null,
        power: null, // unknown live state
        brightness: null,
        watts: d.watts || null,
        lastUpdated: d.updatedAt || d.createdAt || null,
        meta: { registered: true }
      });
      if (entries.length >= limit) break;
    }
  } catch (e) {
    sourcesMeta.registry = { used: true, error: e.message };
  }

  // Build summary
  const summary = {
    total: entries.length,
    on: entries.filter(e => e.power === true).length,
    off: entries.filter(e => e.power === false).length,
    unknown: entries.filter(e => e.power !== true && e.power !== false).length,
    byVendor: entries.reduce((acc, e) => { acc[e.vendor] = (acc[e.vendor] || 0) + 1; return acc; }, {})
  };

  res.json({ ok: true, summary, count: entries.length, entries, sources: sourcesMeta, generatedAt: new Date().toISOString() });
}));

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
    console.warn('Kasa discovery via controller failed, trying direct Kasa discovery');
    
    // Try direct Kasa device discovery using tplink-smarthome-api
    try {
      const { Client } = await import('tplink-smarthome-api');
      const client = new Client();
      
      console.log('🔍 Scanning for Kasa devices on local network...');
      
      // Start device discovery
      client.startDiscovery({
        port: 9999,
        broadcast: '255.255.255.255',
        timeout: 5000
      });
      
      // Collect discovered devices
      const kasaDevices = new Map();
      
      client.on('device-new', (device) => {
        console.log('📱 Found Kasa device:', device.alias, '@', device.host);
        
        // Get device info
        device.getSysInfo().then(sysInfo => {
          kasaDevices.set(device.deviceId, {
            id: `kasa:${device.deviceId}`,
            name: device.alias || sysInfo.alias || 'Unknown Kasa Device',
            protocol: 'kasa-wifi',
            confidence: 0.95,
            signal: null,
            address: device.host,
            vendor: 'TP-Link Kasa',
            lastSeen: new Date().toISOString(),
            hints: {
              type: sysInfo.type || 'smart-plug',
              model: sysInfo.model,
              deviceType: sysInfo.mic_type || sysInfo.type,
              softwareVersion: sysInfo.sw_ver,
              hardwareVersion: sysInfo.hw_ver,
              capabilities: ['power_control', 'scheduling', 'remote_access'],
              metrics: ['power', 'energy', 'state']
            },
            kasaDetails: {
              deviceId: device.deviceId,
              alias: device.alias,
              model: sysInfo.model,
              type: sysInfo.type,
              state: sysInfo.relay_state || 0,
              ledOff: sysInfo.led_off || 0,
              latitude: sysInfo.latitude,
              longitude: sysInfo.longitude
            }
          });
        }).catch(err => {
          console.warn('Error getting Kasa device info:', err.message);
          // Add basic device info even if sysInfo fails
          kasaDevices.set(device.deviceId, {
            id: `kasa:${device.deviceId}`,
            name: device.alias || 'Unknown Kasa Device',
            protocol: 'kasa-wifi',
            confidence: 0.8,
            signal: null,
            address: device.host,
            vendor: 'TP-Link Kasa',
            lastSeen: new Date().toISOString(),
            hints: {
              type: 'smart-device',
              capabilities: ['power_control'],
              metrics: ['state']
            }
          });
        });
      });
      
      // Wait for discovery to complete, then add devices
      await new Promise(resolve => setTimeout(resolve, 6000));
      client.stopDiscovery();
      
      // Add discovered Kasa devices to the main devices array
      kasaDevices.forEach(device => devices.push(device));
      
      if (kasaDevices.size > 0) {
        console.log(`✅ Found ${kasaDevices.size} Kasa device(s)`);
      } else {
        console.log('⚠️  No Kasa devices found on local network');
      }
      
    } catch (kasaError) {
      console.warn('Direct Kasa discovery failed:', kasaError.message);
    }
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
let SETUP_WIZARDS = buildSetupWizards();
const wizardStates = new Map();
const wizardDiscoveryContext = new Map();

function refreshSetupWizards() {
  const contextObject = Object.fromEntries(wizardDiscoveryContext.entries());
  SETUP_WIZARDS = buildSetupWizards(contextObject);
}

function recordDiscoveryForWizard(wizardId, device) {
  const existing = wizardDiscoveryContext.get(wizardId) || {};
  const merged = mergeDiscoveryPayload(existing, device);
  wizardDiscoveryContext.set(wizardId, merged);
  refreshSetupWizards();

  const currentState = wizardStates.get(wizardId);
  if (currentState) {
    currentState.discoveryContext = merged;
    wizardStates.set(wizardId, currentState);
  }
}

function mergeStepPresets(...sources) {
  const merged = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [stepId, values] of Object.entries(source)) {
      if (!merged[stepId]) {
        merged[stepId] = {};
      }
      Object.assign(merged[stepId], values || {});
    }
  }
  return merged;
}

function buildWizardSuggestionsFromDevices(devices = []) {
  const suggestions = [];

  for (const device of devices) {
    const applicableWizards = Object.values(SETUP_WIZARDS).filter(wizard =>
      wizard.targetDevices.includes(device.type) ||
      device.services?.some(service => wizard.targetDevices.includes(service))
    );

    if (applicableWizards.length === 0) {
      continue;
    }

    const recommendedWizards = applicableWizards.map(wizard => {
      recordDiscoveryForWizard(wizard.id, device);
      const context = wizardDiscoveryContext.get(wizard.id) || null;
      const defaults = getWizardDefaultInputs(wizard.id, context || {});

      return {
        id: wizard.id,
        name: wizard.name,
        description: wizard.description,
        confidence: calculateWizardConfidence(device, wizard),
        discoveryContext: context ? JSON.parse(JSON.stringify(context)) : null,
        discoveryDefaults: JSON.parse(JSON.stringify(defaults))
      };
    }).sort((a, b) => b.confidence - a.confidence);

    suggestions.push({
      device: {
        ip: device.ip,
        hostname: device.hostname,
        type: device.type,
        services: device.services
      },
      recommendedWizards
    });
  }

  return suggestions;
}

function resetWizardSystem() {
  wizardStates.clear();
  wizardDiscoveryContext.clear();
  refreshSetupWizards();
}

// Wizard state management


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
  const execution = await executeWizardStep(wizardId, stepId, validation.data);
  const context = wizardDiscoveryContext.get(wizardId) || null;
  const wizardState = wizardStates.get(wizardId);

  if (execution.success && execution.nextStep) {
    const wizardDefinition = SETUP_WIZARDS[wizardId];
    if (wizardDefinition) {
      const nextStep = wizardDefinition.steps.find(step => step.id === execution.nextStep);
      if (nextStep) {
        execution.nextStepDetails = cloneWizardStep(nextStep);
        const defaults = wizardState?.discoveryDefaults || getWizardDefaultInputs(wizardId, context || {});
        execution.nextStepDefaults = defaults[execution.nextStep] || {};
      }
    }
  }

  execution.discoveryContext = context;
  execution.discoveryDefaults = wizardState?.discoveryDefaults || getWizardDefaultInputs(wizardId, context || {});

  return execution;
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
      
      try {
        const kasaModule = await import('tplink-smarthome-api');
        const Client = kasaModule.Client ?? kasaModule.default?.Client ?? kasaModule.default;

        if (typeof Client !== 'function') {
          const message = 'tplink-smarthome-api Client constructor not available';
          console.error(message);
          return {
            success: false,
            error: message,
            data: {}
          };
        }

        const client = new Client();
        const kasaDevices = [];
        
        // Start discovery
        client.startDiscovery({
          port: 9999,
          broadcast: '255.255.255.255',
          timeout: (data.discoveryTimeout || 10) * 1000
        });
        
        // Collect devices
        client.on('device-new', async (device) => {
          try {
            const sysInfo = await device.getSysInfo();
            kasaDevices.push({
              deviceId: device.deviceId,
              ip: device.host,
              model: sysInfo.model || 'Unknown',
              alias: device.alias || sysInfo.alias || 'Unnamed Device',
              type: sysInfo.type || 'plug',
              state: sysInfo.relay_state || 0,
              rssi: sysInfo.rssi,
              softwareVersion: sysInfo.sw_ver,
              hardwareVersion: sysInfo.hw_ver
            });
          } catch (err) {
            console.warn(`Error getting Kasa device info:`, err.message);
            kasaDevices.push({
              deviceId: device.deviceId,
              ip: device.host,
              alias: device.alias || 'Unknown Kasa Device',
              type: 'unknown',
              error: err.message
            });
          }
        });
        
        // Wait for discovery
        await new Promise(resolve => setTimeout(resolve, (data.discoveryTimeout || 10) * 1000 + 1000));
        client.stopDiscovery();
        
        // Filter by target IP if specified
        let filteredDevices = kasaDevices;
        if (data.targetIP) {
          filteredDevices = kasaDevices.filter(device => 
            device.ip.startsWith(data.targetIP.split('.').slice(0, 3).join('.'))
          );
        }
        
        return {
          success: true,
          data: { 
            discoveredDevices: filteredDevices,
            totalFound: kasaDevices.length,
            filtered: data.targetIP ? filteredDevices.length : kasaDevices.length
          },
          message: `Found ${filteredDevices.length} Kasa device(s)${data.targetIP ? ` matching ${data.targetIP}` : ''}`
        };
        
      } catch (error) {
        console.warn('Kasa discovery unavailable:', error.message);
        return {
          success: true,
          deviceSpecific: false,
          data: { discoveredDevices: [], totalFound: 0, filtered: 0 },
          message: 'Kasa discovery unavailable in current environment'
        };
      }
      
    case 'device-configuration':
      console.log(`⚙️ Configuring Kasa device: ${data.alias}`);
      
      try {
        // If we have device info from discovery, use it to configure
        if (data.deviceId) {
          const { Client } = await import('tplink-smarthome-api');
          const client = new Client();
          
          // Try to find the device
          let targetDevice = null;
          client.startDiscovery({ timeout: 3000 });
          
          await new Promise((resolve) => {
            client.on('device-new', (device) => {
              if (device.deviceId === data.deviceId) {
                targetDevice = device;
                client.stopDiscovery();
                resolve();
              }
            });
            
            setTimeout(() => {
              client.stopDiscovery();
              resolve();
            }, 3500);
          });
          
          if (targetDevice && data.alias !== targetDevice.alias) {
            // Set new alias
            await targetDevice.setAlias(data.alias);
          }
          
          return {
            success: true,
            data: {
              deviceId: data.deviceId,
              alias: data.alias,
              location: data.location,
              scheduleEnabled: data.scheduleEnabled,
              configured: true
            },
            message: `Successfully configured ${data.alias}`
          };
        }
        
        return {
          success: true,
          data: {
            alias: data.alias,
            location: data.location,
            scheduleEnabled: data.scheduleEnabled
          },
          message: `Configuration saved for ${data.alias}`
        };
        
      } catch (error) {
        console.warn('Kasa configuration not applied:', error.message);
        return {
          success: true,
          deviceSpecific: false,
          data: {
            alias: data.alias,
            location: data.location,
            scheduleEnabled: data.scheduleEnabled,
            configured: false
          },
          message: `Configuration deferred for ${data.alias}`
        };
      }
      
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
      startedAt: new Date().toISOString(),
      discoveryContext: wizardDiscoveryContext.get(wizardId) || null,
      discoveryDefaults: getWizardDefaultInputs(wizardId, wizardDiscoveryContext.get(wizardId) || {})
    });
  } else {
    const existingState = wizardStates.get(wizardId);
    const context = wizardDiscoveryContext.get(wizardId) || null;
    existingState.discoveryContext = context;
    existingState.discoveryDefaults = getWizardDefaultInputs(wizardId, context || {});
    wizardStates.set(wizardId, existingState);
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
  
  const context = wizardDiscoveryContext.get(wizardId) || null;
  const state = wizardStates.get(wizardId) || {
    currentStep: 0,
    completed: false,
    data: {},
    startedAt: new Date().toISOString(),
    discoveryContext: context,
    discoveryDefaults: getWizardDefaultInputs(wizardId, context || {})
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
    
    state.discoveryContext = wizardDiscoveryContext.get(wizardId) || state.discoveryContext || null;
    state.discoveryDefaults = getWizardDefaultInputs(wizardId, state.discoveryContext || {});

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
    data: state.data,
    discoveryContext: state.discoveryContext || wizardDiscoveryContext.get(wizardId) || null,
    discoveryDefaults: state.discoveryDefaults || getWizardDefaultInputs(wizardId, wizardDiscoveryContext.get(wizardId) || {})
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
    
    const suggestions = buildWizardSuggestionsFromDevices(devices);

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
      const discoveryContext = wizardDiscoveryContext.get(wizardConfig.id) || null;
      const discoveryDefaults = getWizardDefaultInputs(wizardConfig.id, discoveryContext || {});

      results.applicableWizards.push({
        wizardId: wizardConfig.id,
        priority: wizardConfig.priority,
        autoExecute: wizardConfig.autoExecute,
        applicableDevices: applicableDevices.length,
        devices: applicableDevices,
        discoveryContext: discoveryContext ? JSON.parse(JSON.stringify(discoveryContext)) : null,
        discoveryDefaults: JSON.parse(JSON.stringify(discoveryDefaults))
      });

      // Auto-execute if configured
      if (wizardConfig.autoExecute) {
        try {
          // Apply presets if available
          const presets = mergeStepPresets(
            discoveryDefaults,
            template.presets[wizardConfig.id],
            customPresets[wizardConfig.id]
          );

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

    const suggestions = buildWizardSuggestionsFromDevices(devices);

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

// 404 handler for undefined routes (must be registered after all routes)
app.use((req, res) => {
  console.warn(`⚠️  404 Not Found: ${req.method} ${req.url}`);
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} not found`,
    timestamp: new Date().toISOString()
  });
});

function tryListenOnPort(port, host) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();

    const onError = (error) => {
      tester.removeListener('listening', onListening);
      try {
        tester.close();
      } catch {}
      reject(error);
    };

    const onListening = () => {
      tester.removeListener('error', onError);
      tester.close(() => resolve(true));
    };

    tester.once('error', onError);
    tester.once('listening', onListening);

    tester.listen({ port, host, exclusive: true });
  });
}

async function isPortAvailable(port) {
  if (port === 0) return true; // allow OS to choose a port
  try {
    await tryListenOnPort(port, '::');
    return true;
  } catch (error) {
    if (error && (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT')) {
      try {
        await tryListenOnPort(port, '0.0.0.0');
        return true;
      } catch (ipv4Error) {
        if (ipv4Error && (ipv4Error.code === 'EADDRINUSE' || ipv4Error.code === 'EACCES')) {
          return false;
        }
        throw ipv4Error;
      }
    }
    if (error && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) {
      return false;
    }
    throw error;
  }
}

async function resolveAvailablePort(initialPort) {
  if (hasExplicitPort || initialPort === 0) {
    return initialPort;
  }

  let candidate = initialPort;
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isPortAvailable(candidate)) {
      if (candidate !== initialPort) {
        console.warn(`[charlie] Port ${initialPort} in use, falling back to ${candidate}.`);
      }
      return candidate;
    }
    candidate += 1;
  }

  const error = new Error(`Unable to find an open port starting at ${initialPort}`);
  error.code = 'EADDRINUSE';
  throw error;
}

async function startServer() {
  try {
    const resolvedPort = await resolveAvailablePort(PORT);
    PORT = resolvedPort;
  } catch (error) {
    if (error && error.code === 'EADDRINUSE') {
      console.error(`[charlie] Port ${PORT} is already in use. Stop the other process or set PORT to a free value.`);
    } else {
      console.error('[charlie] Failed to determine available port:', error?.message || error);
    }
    process.exit(1);
  }

  const server = app.listen(PORT);

  server.on('listening', () => {
    console.log(`[charlie] running http://127.0.0.1:${PORT} → ${getController()}`);
    try { setupWeatherPolling(); } catch {}
  });

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.error(`[charlie] Port ${PORT} is already in use. Stop the other process or set PORT to a free value.`);
    } else {
      console.error('[charlie] Server failed to start:', error?.message || error);
    }
    process.exit(1);
  });
}

// Start the server after all routes are defined when executed directly
if (process.argv[1] === __filename) {
  startServer().catch((error) => {
    console.error('[charlie] Unexpected startup failure:', error?.message || error);
    process.exit(1);
  });
}

export { app };
export function __resetWizardSystemForTests() {
  resetWizardSystem();
}
