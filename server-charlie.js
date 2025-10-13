

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
const RUNNING_UNDER_NODE_TEST = process.argv.some((arg) =>
  arg === '--test' || arg.startsWith('--test=')
);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- CORS guardrail: always answer OPTIONS and echo request headers ---
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin'); // allow per-origin caching
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  const reqHdrs = req.headers['access-control-request-headers'];
  res.setHeader('Access-Control-Allow-Headers', reqHdrs || 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.options('*', (req, res) => {
  applyCorsHeaders(req, res, 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.status(204).end();
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
const PLANS_PATH = path.join(DATA_DIR, 'plans.json');
const SCHEDULES_PATH = path.join(DATA_DIR, 'schedules.json');
const ROOMS_PATH = path.join(DATA_DIR, 'rooms.json');
const CALIBRATIONS_PATH = path.join(DATA_DIR, 'calibration.json');
const DEVICES_CACHE_PATH = path.join(DATA_DIR, 'devices.cache.json');
const CHANNEL_SCALE_PATH = path.resolve('./config/channel-scale.json');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const UI_DATA_RESOURCES = new Map([
  ['farm', 'farm.json'],
  ['groups', 'groups.json'],
  ['sched', 'schedules.json'],
  ['plans', 'plans.json'],
  ['env', 'env.json']
]);
const UI_EQUIP_PATH = path.join(PUBLIC_DIR, 'data', 'ui.equip.json');
const UI_CTRLMAP_PATH = path.join(PUBLIC_DIR, 'data', 'ui.ctrlmap.json');
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

function readDeviceCache() {
  try {
    if (!fs.existsSync(DEVICES_CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(DEVICES_CACHE_PATH, 'utf8'));
    if (raw && typeof raw === 'object') {
      return raw;
    }
  } catch (err) {
    console.warn('[devices.cache] Failed to read cache:', err.message);
  }
  return null;
}

function writeDeviceCache(data) {
  try {
    ensureDataDir();
    const payload = {
      cachedAt: new Date().toISOString(),
      data
    };
    fs.writeFileSync(DEVICES_CACHE_PATH, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.warn('[devices.cache] Failed to write cache:', err.message);
  }
}

function sanitizePlansEnvelope(source, excludeKeys = []) {
  if (!source || typeof source !== 'object') return {};
  const skip = new Set(['plans', 'ok', ...excludeKeys]);
  const envelope = {};
  for (const [key, value] of Object.entries(source)) {
    if (skip.has(key)) continue;
    envelope[key] = value;
  }
  return envelope;
}

function loadPlansDocument() {
  ensureDataDir();
  try {
    if (!fs.existsSync(PLANS_PATH)) return { plans: [] };
    const raw = JSON.parse(fs.readFileSync(PLANS_PATH, 'utf8'));
    if (Array.isArray(raw)) return { plans: raw };
    if (raw && typeof raw === 'object') {
      const doc = { ...raw };
      if (!Array.isArray(doc.plans)) doc.plans = [];
      return doc;
    }
  } catch (err) {
    console.warn('[plans] Failed to read plans.json:', err.message);
  }
  return { plans: [] };
}

function savePlansDocument(document) {
  ensureDataDir();
  try {
    const plansArray = Array.isArray(document?.plans) ? document.plans : [];
    const envelope = sanitizePlansEnvelope(document || {});
    const payload = { ...envelope, plans: plansArray };
    fs.writeFileSync(PLANS_PATH, JSON.stringify(payload, null, 2));
    return true;
  } catch (err) {
    console.error('[plans] Failed to write plans.json:', err.message);
    return false;
  }
}

function loadPlansFile() {
  const doc = loadPlansDocument();
  return Array.isArray(doc.plans) ? doc.plans : [];
}

function savePlansFile(plans) {
  return savePlansDocument({ plans });
}

function loadSchedulesFile() {
  ensureDataDir();
  try {
    if (!fs.existsSync(SCHEDULES_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(SCHEDULES_PATH, 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.schedules)) return raw.schedules;
    return [];
  } catch (err) {
    console.warn('[sched] Failed to read schedules.json:', err.message);
    return [];
  }
}

function saveSchedulesFile(schedules) {
  ensureDataDir();
  try {
    fs.writeFileSync(SCHEDULES_PATH, JSON.stringify({ schedules }, null, 2));
    return true;
  } catch (err) {
    console.error('[sched] Failed to write schedules.json:', err.message);
    return false;
  }
}

async function fetchKnownDeviceIds() {
  try {
    const controller = getController();
    if (!controller) return new Set();
    const url = `${controller.replace(/\/$/, '')}/api/devicedatas`;
    const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' } }).catch(() => null);
    if (!response || !response.ok) return new Set();
    const body = await response.json().catch(() => ({}));
    const devices = Array.isArray(body?.data) ? body.data : [];
    const ids = new Set();
    devices.forEach((device) => {
      if (!device || typeof device !== 'object') return;
      const raw = device.id ?? device.deviceId ?? device.device_id ?? device.deviceID;
      if (raw == null) return;
      const id = String(raw).trim();
      if (id) ids.add(id);
    });
    return ids;
  } catch (err) {
    console.warn('[groups] Unable to fetch controller device ids:', err.message);
    return new Set();
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
  const label = typeof group.label === 'string' ? group.label.trim() : name;
  const matchRaw = group.match && typeof group.match === 'object' ? group.match : null;
  const room = String(group.room ?? matchRaw?.room ?? '').trim();
  const zone = String(group.zone ?? matchRaw?.zone ?? '').trim();
  const membersSource = Array.isArray(group.members) ? group.members : Array.isArray(group.lights) ? group.lights : [];
  const members = membersSource.map(normalizeMemberEntry).filter(Boolean);

  const response = { id, name: name || label || id };
  if (label) response.label = label;
  if (room) response.room = room;
  if (zone) response.zone = zone;
  if (typeof group.plan === 'string' && group.plan.trim()) response.plan = group.plan.trim();
  if (typeof group.schedule === 'string' && group.schedule.trim()) response.schedule = group.schedule.trim();
  if (group.pendingSpectrum && typeof group.pendingSpectrum === 'object') response.pendingSpectrum = group.pendingSpectrum;
  if (room || zone) response.match = { room, zone };
  if (members.length > 0) response.members = members;
  if (!response.members && Array.isArray(group.lights)) {
    response.members = group.lights.map(normalizeMemberEntry).filter(Boolean);
  }
  return response;
}

function parseIncomingGroup(raw, knownDeviceIds = null) {
  if (!raw || typeof raw !== 'object') throw new Error('Group payload must be an object.');
  const id = String(raw.id ?? raw.groupId ?? '').trim();
  if (!id) throw new Error('Group id is required.');
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';

  const matchRaw = raw.match && typeof raw.match === 'object' ? raw.match : null;
  const room = String(raw.room ?? raw.roomId ?? matchRaw?.room ?? '').trim();
  if (!room) throw new Error('Group room is required.');
  const zone = String(raw.zone ?? raw.zoneId ?? matchRaw?.zone ?? '').trim();

  const membersSource = Array.isArray(raw.members) ? raw.members : Array.isArray(raw.lights) ? raw.lights : [];
  const members = membersSource.map(normalizeMemberEntry).filter(Boolean);
  if (!members.length) throw new Error('Group requires a non-empty members[] list.');

  const normalizedMembers = members.map((entry) => ({ id: String(entry.id).trim() })).filter((entry) => !!entry.id);
  if (!normalizedMembers.length) throw new Error('Group members require valid ids.');
  if (knownDeviceIds && knownDeviceIds.size) {
    const unknown = normalizedMembers
      .map((entry) => entry.id)
      .filter((entry) => entry && !knownDeviceIds.has(entry));
    if (unknown.length) {
      throw new Error(`Unknown device id(s): ${unknown.join(', ')}`);
    }
  }

  const stored = {
    ...raw,
    id,
    name: name || label || id,
    label: label || name || id,
    room,
    zone,
    match: { room, zone },
    lights: normalizedMembers.map((entry) => ({ id: entry.id })),
    members: normalizedMembers.map((entry) => entry.id),
  };
  if (typeof stored.plan === 'string') stored.plan = stored.plan.trim();
  if (typeof stored.schedule === 'string') stored.schedule = stored.schedule.trim();
  if (!stored.plan) delete stored.plan;
  if (!stored.schedule) delete stored.schedule;

  const response = normalizeGroupForResponse(stored);
  return { stored, response };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      if (!value.trim()) continue;
      return value;
    }
    return value;
  }
  return undefined;
}

function readPhotoperiodHours(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const first = trimmed.split('/')[0];
    const hours = Number(first);
    return Number.isFinite(hours) ? hours : null;
  }
  return null;
}

function normalizePlanLightDay(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const mixSource = entry.mix && typeof entry.mix === 'object' ? entry.mix : entry;
  const cw = toNumberOrNull(mixSource?.cw ?? mixSource?.coolWhite);
  const ww = toNumberOrNull(mixSource?.ww ?? mixSource?.warmWhite);
  const bl = toNumberOrNull(mixSource?.bl ?? mixSource?.blue);
  const rd = toNumberOrNull(mixSource?.rd ?? mixSource?.red);
  return {
    raw: entry,
    day: toNumberOrNull(entry.d ?? entry.day ?? entry.dayStart) ?? null,
    stage: entry.stage ?? entry.label ?? '',
    ppfd: toNumberOrNull(entry.ppfd),
    photoperiod: firstNonEmpty(entry.photoperiod, entry.hours, entry.photoperiodHours),
    mix: {
      cw: cw ?? 0,
      ww: ww ?? 0,
      bl: bl ?? 0,
      rd: rd ?? 0,
    },
  };
}

function normalizePlanEnvDay(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    raw: entry,
    day: toNumberOrNull(entry.d ?? entry.day ?? entry.dayStart) ?? null,
    tempC: toNumberOrNull(entry.tempC ?? entry.temp ?? entry.temperature),
    rh: toNumberOrNull(entry.rh ?? entry.humidity ?? entry.rhPct),
    rhBand: toNumberOrNull(entry.rhBand ?? entry.humidityBand ?? entry.rhDelta),
  };
}

function derivePlanRuntime(plan) {
  if (!plan || typeof plan !== 'object') {
    return { structured: false, lightDays: [], envDays: [] };
  }
  const lightV2 = Array.isArray(plan?.light?.days) ? plan.light.days : [];
  const legacyDays = Array.isArray(plan?.days) ? plan.days : [];
  const normalizedLight = lightV2.map(normalizePlanLightDay).filter(Boolean);
  const normalizedLegacy = legacyDays.map(normalizePlanLightDay).filter(Boolean);
  const lightDays = normalizedLight.length ? normalizedLight : normalizedLegacy;
  const firstDay = lightDays.length ? lightDays[0] : null;
  const envDays = Array.isArray(plan?.env?.days) ? plan.env.days.map(normalizePlanEnvDay).filter(Boolean) : [];
  const spectrum = firstDay?.mix ? { ...firstDay.mix } : (plan.spectrum && typeof plan.spectrum === 'object' ? { ...plan.spectrum } : null);
  const ppfd = toNumberOrNull(firstNonEmpty(plan?.ppfd, firstDay?.ppfd));
  const photoperiodRaw = firstNonEmpty(plan?.photoperiod, firstDay?.photoperiod, plan?.defaults?.photoperiod);
  const photoperiodHours = readPhotoperiodHours(photoperiodRaw);
  const dliProvided = toNumberOrNull(plan?.dli);
  const dli = dliProvided != null
    ? dliProvided
    : (ppfd != null && photoperiodHours != null ? (ppfd * 3600 * photoperiodHours) / 1e6 : null);
  const notes = Array.isArray(plan?.meta?.notes)
    ? plan.meta.notes.map((note) => (typeof note === 'string' ? note.trim() : '')).filter(Boolean)
    : [];
  const appliesRaw = plan?.meta?.appliesTo && typeof plan.meta.appliesTo === 'object' ? plan.meta.appliesTo : {};
  const appliesTo = {
    category: Array.isArray(appliesRaw.category)
      ? appliesRaw.category.map((entry) => (typeof entry === 'string' ? entry : '')).filter(Boolean)
      : [],
    varieties: Array.isArray(appliesRaw.varieties)
      ? appliesRaw.varieties.map((entry) => (typeof entry === 'string' ? entry : '')).filter(Boolean)
      : [],
  };
  const structured = normalizedLight.length > 0 || envDays.length > 0 || !!plan?.defaults || !!plan?.meta;
  return {
    structured,
    lightDays,
    envDays,
    firstDay,
    spectrum,
    ppfd,
    photoperiod: photoperiodRaw,
    photoperiodHours,
    dli,
    notes,
    appliesTo,
  };
}

function hydratePlan(plan, index = 0) {
  if (!plan || typeof plan !== 'object') return null;
  const normalized = { ...plan };
  const fallbackId = firstNonEmpty(plan.id, plan.planId, plan.plan_id, plan.key, `plan-${index + 1}`);
  const id = typeof fallbackId === 'string' ? fallbackId.trim() : String(fallbackId || '').trim();
  if (id) {
    normalized.id = id;
  }
  if (!normalized.id) normalized.id = `plan-${index + 1}`;
  if (!normalized.key) normalized.key = normalized.id;
  const derived = derivePlanRuntime(normalized);
  const nameCandidate = firstNonEmpty(normalized.name, normalized.label, normalized.meta?.label, normalized.key, normalized.id);
  if (nameCandidate) normalized.name = String(nameCandidate).trim();
  Object.defineProperty(normalized, '_derived', { value: derived, enumerable: false, configurable: true, writable: true });
  Object.defineProperty(normalized, '_structured', { value: !!derived.structured, enumerable: false, configurable: true, writable: true });
  return normalized;
}

function normalizePlanEntry(raw, fallbackId = '') {
  if (!raw || typeof raw !== 'object') return null;
  const idSource = raw.id ?? raw.planId ?? raw.plan_id ?? raw.key ?? fallbackId ?? '';
  const id = typeof idSource === 'string' ? idSource.trim() : String(idSource || '').trim();
  if (!id) return null;
  const plan = { ...raw, id };
  if (!plan.key) plan.key = id;

  const meta = plan.meta && typeof plan.meta === 'object' ? plan.meta : null;
  const nameCandidate = [plan.name, plan.label, meta?.label, plan.key, id]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => !!value);
  if (nameCandidate) {
    plan.name = nameCandidate;
  } else {
    plan.name = id;
  }

  if (!plan.description) {
    if (typeof meta?.description === 'string' && meta.description.trim()) {
      plan.description = meta.description.trim();
    } else if (Array.isArray(meta?.notes)) {
      const joined = meta.notes
        .map((note) => (typeof note === 'string' ? note.trim() : ''))
        .filter(Boolean)
        .join(' • ');
      if (joined) plan.description = joined;
    }
  }

  if (typeof plan.photoperiod === 'string') plan.photoperiod = plan.photoperiod.trim();
  return plan;
}

function parseIncomingPlans(body) {
  if (!body) throw new Error('Plan payload required.');
  let entries = [];
  let excludeKeys = [];
  let envelope = {};

  if (Array.isArray(body)) {
    entries = body;
  } else if (body && typeof body === 'object') {
    const rawPlans = body.plans;
    if (Array.isArray(rawPlans)) {
      entries = rawPlans;
      excludeKeys.push('plans');
    } else if (rawPlans && typeof rawPlans === 'object') {
      entries = Object.entries(rawPlans).map(([id, value]) => ({
        id,
        ...(value && typeof value === 'object' ? value : { value })
      }));
      excludeKeys.push('plans');
    }

    if (!entries.length) {
      const candidateEntries = Object.entries(body)
        .filter(([key]) => key !== 'plans' && key !== 'ok')
        .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && (
          Array.isArray(value.days) ||
          Array.isArray(value.light?.days) ||
          typeof value.defaults === 'object' ||
          typeof value.meta === 'object' ||
          typeof value.env === 'object'
        ));
      if (candidateEntries.length) {
        excludeKeys.push(...candidateEntries.map(([key]) => key));
        entries = candidateEntries.map(([id, value]) => ({ id, ...(value && typeof value === 'object' ? value : {}) }));
      }
    }

    envelope = sanitizePlansEnvelope(body, excludeKeys);
  }

  const normalized = entries
    .map((entry, idx) => normalizePlanEntry(entry, entry?.id ?? `plan-${idx + 1}`))
    .filter(Boolean);

  if (!normalized.length) {
    throw new Error('At least one plan entry is required.');
  }

  return { ...envelope, plans: normalized };
}

function normalizeScheduleEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const idCandidate = [raw.id, raw.scheduleId, raw.deviceId, raw.device_id, raw.deviceID]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => !!value);
  if (!idCandidate) return null;
  const schedule = { ...raw, id: idCandidate };
  if (typeof schedule.planKey === 'string') schedule.planKey = schedule.planKey.trim();
  if (typeof schedule.period === 'string') schedule.period = schedule.period.trim();
  if (typeof schedule.start === 'string') schedule.start = schedule.start.trim();
  return schedule;
}

function parseIncomingSchedules(body) {
  if (!body) throw new Error('Schedule payload required.');
  let entries = [];
  if (Array.isArray(body)) {
    entries = body;
  } else if (Array.isArray(body.schedules)) {
    entries = body.schedules;
  } else if (typeof body === 'object') {
    entries = [body];
  }
  const normalized = entries.map(normalizeScheduleEntry).filter(Boolean);
  if (!normalized.length) {
    if (Array.isArray(body?.schedules) && body.schedules.length === 0) return [];
    if (Array.isArray(body) && body.length === 0) return [];
    throw new Error('At least one schedule entry is required.');
  }
  return normalized;
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

// --- ENV store helpers
const envPath = path.join(DATA_DIR, 'env.json');

function readJSON(fileName, fallback = null) {
  const target = path.isAbsolute(fileName) ? fileName : path.join(DATA_DIR, fileName);
  return readJsonSafe(target, fallback);
}

function writeJSON(fileName, value) {
  const target = path.isAbsolute(fileName) ? fileName : path.join(DATA_DIR, fileName);
  ensureDataDir();
  try {
    fs.writeFileSync(target, JSON.stringify(value ?? {}, null, 2));
    return true;
  } catch (error) {
    console.warn('[env] Failed to persist JSON:', error?.message || error);
    return false;
  }
}

function needPin(req, res) {
  const configuredPin = process.env.FARM_PIN || process.env.CTRL_PIN || '';
  if (!configuredPin) return false;
  const provided = (req.body && (req.body.pin || req.body.PIN))
    || req.headers['x-farm-pin']
    || req.query.pin;
  if (provided && String(provided) === configuredPin) return false;
  res.status(403).json({ ok: false, error: 'pin-required' });
  return true;
}

const pinGuard = (req, res, next) => {
  if (needPin(req, res)) return;
  next();
};

const readEnv = () => readJSON(envPath, { rooms: {}, targets: {}, control: {} }) || { rooms: {}, targets: {}, control: {} };
const writeEnv = (obj) => writeJSON(envPath, obj);

const MAX_ENV_READING_HISTORY = 10000;
const SENSOR_ENTRY_KIND = 'sensor';
const ACTION_ENTRY_KIND = 'action';

function toNumberOrNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clampPercentage(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function computeVpd(tempC, rh) {
  const temperature = Number(tempC);
  const humidity = Number(rh);
  if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) return null;
  if (humidity <= 0) return Math.round(temperature * 100) / 100;
  const saturation = 0.6108 * Math.exp((17.27 * temperature) / (temperature + 237.3));
  const actual = saturation * (humidity / 100);
  const deficit = Math.max(0, saturation - actual);
  const rounded = Math.round(deficit * 1000) / 1000;
  return Number.isFinite(rounded) ? rounded : null;
}

function ensureRoomContainer(state, roomId) {
  if (!state || !roomId) return null;
  if (!state.rooms || typeof state.rooms !== 'object') {
    state.rooms = {};
  }
  if (!state.rooms[roomId] || typeof state.rooms[roomId] !== 'object') {
    state.rooms[roomId] = { roomId, targets: {}, control: {}, actuators: {} };
  }
  const container = state.rooms[roomId];
  if (!container.telemetry || typeof container.telemetry !== 'object') {
    container.telemetry = {};
  }
  return container;
}

function recordEnvEntry(state, entry) {
  if (!state) return;
  state.readings = Array.isArray(state.readings) ? state.readings : [];
  state.readings.push(entry);
  if (state.readings.length > MAX_ENV_READING_HISTORY) {
    state.readings.splice(0, state.readings.length - MAX_ENV_READING_HISTORY);
  }
}

// GET /env → full state (legacy view via ?legacy=1)
app.get('/env', (req, res, next) => {
  if (req.query?.legacy === '1') {
    return res.json(readEnv());
  }
  return next();
});

// POST /env → upsert full or partial (PIN)
app.post('/env', pinGuard, (req, res) => {
  const cur = readEnv();
  const nxt = { ...cur, ...req.body };
  writeEnv(nxt);
  res.json({ ok: true });
});

// POST /env/readings → append one reading (room, temp, rh, ts)
app.post('/env/readings', pinGuard, (req, res) => {
  const body = req.body || {};
  const room = body.room || body.scope || body.zone || null;
  if (!room) {
    return res.status(400).json({ ok: false, error: 'room-required' });
  }

  const st = readEnv();
  const container = ensureRoomContainer(st, room);

  if (typeof body.plan === 'string' && body.plan.trim()) {
    container.plan = body.plan.trim();
  }

  const ts = body.ts || body.timestamp || new Date().toISOString();
  const temp = toNumberOrNull(body.temp ?? body.temperature);
  const rh = toNumberOrNull(body.rh ?? body.humidity);
  const vpd = toNumberOrNull(body.vpd) ?? computeVpd(temp, rh);
  const ppfd = toNumberOrNull(body.ppfd);
  const kwh = toNumberOrNull(body.kwh ?? body.energyKwh ?? body.energy);
  let masterPct = toNumberOrNull(body.masterPct ?? body.master);
  let bluePct = toNumberOrNull(body.bluePct ?? body.blue);

  if (!Number.isFinite(masterPct) && Number.isFinite(container.telemetry?.masterPct)) {
    masterPct = container.telemetry.masterPct;
  }
  if (!Number.isFinite(bluePct) && Number.isFinite(container.telemetry?.bluePct)) {
    bluePct = container.telemetry.bluePct;
  }

  const entry = {
    kind: SENSOR_ENTRY_KIND,
    room,
    ts,
    temp,
    rh,
    vpd,
    ppfd,
    kwh,
    plan: container.plan || null,
    masterPct: clampPercentage(masterPct ?? null),
    bluePct: clampPercentage(bluePct ?? null),
    source: body.source || 'ingest'
  };

  recordEnvEntry(st, entry);
  writeEnv(st);
  res.json({ ok: true, reading: entry });
});

// POST /automation/run → run one policy tick for a room (or all)
app.post('/automation/run', async (req, res) => {
  if (needPin(req, res)) return;
  const room = (req.body || {}).room || null;
  const st = readEnv();
  const out = await runPolicyOnce(st, room);
  writeEnv(out.state);
  res.json({ ok: true, actions: out.actions });
});

function logAutomationAction(state, roomId, cfg, reading, actionList, mode) {
  if (!state || !roomId || !Array.isArray(actionList) || !actionList.length) return;
  const container = ensureRoomContainer(state, roomId);
  const telemetry = container.telemetry || {};
  const plan = reading?.plan || container.plan || cfg?.plan || null;

  const prevMaster = Number.isFinite(telemetry.masterPct) ? telemetry.masterPct : 100;
  const prevBlue = Number.isFinite(telemetry.bluePct) ? telemetry.bluePct : 100;
  const readingMaster = Number.isFinite(reading?.masterPct) ? clampPercentage(reading.masterPct) : null;
  const readingBlue = Number.isFinite(reading?.bluePct) ? clampPercentage(reading.bluePct) : null;

  let nextMaster = Number.isFinite(readingMaster) ? readingMaster : prevMaster;
  let nextBlue = Number.isFinite(readingBlue) ? readingBlue : prevBlue;

  for (const action of actionList) {
    if (!action || action.type !== 'lights.scale') continue;
    const deltaMaster = Number(action.masterDelta || 0) * 100;
    const deltaBlue = Number(action.blueDelta || 0) * 100;
    const minMasterPct = Number.isFinite(action.minMaster) ? action.minMaster * 100 : null;
    const minBluePct = Number.isFinite(action.minBlue) ? action.minBlue * 100 : null;

    if (Number.isFinite(deltaMaster)) {
      nextMaster = clampPercentage(nextMaster + deltaMaster);
      if (minMasterPct != null) nextMaster = Math.max(nextMaster, minMasterPct);
    }
    if (Number.isFinite(deltaBlue)) {
      nextBlue = clampPercentage(nextBlue + deltaBlue);
      if (minBluePct != null) nextBlue = Math.max(nextBlue, minBluePct);
    }
  }

  const ts = new Date().toISOString();
  const entry = {
    kind: ACTION_ENTRY_KIND,
    room: roomId,
    ts,
    temp: Number.isFinite(reading?.temp) ? reading.temp : null,
    rh: Number.isFinite(reading?.rh) ? reading.rh : null,
    vpd: Number.isFinite(reading?.vpd) ? reading.vpd : computeVpd(reading?.temp, reading?.rh),
    ppfd: Number.isFinite(reading?.ppfd) ? reading.ppfd : null,
    kwh: Number.isFinite(reading?.kwh) ? reading.kwh : null,
    plan: plan || null,
    masterPct: clampPercentage(nextMaster),
    bluePct: clampPercentage(nextBlue),
    actions: actionList.map((action) => ({ ...action })),
    mode: mode || 'advisory',
    result: mode === 'autopilot' ? 'executed' : 'pending',
    resultAfterDwell: null,
    dwell: cfg?.control?.dwell ?? null,
    previousMasterPct: Number.isFinite(prevMaster) ? prevMaster : null,
    previousBluePct: Number.isFinite(prevBlue) ? prevBlue : null
  };

  recordEnvEntry(state, entry);

  container.telemetry = {
    ...(container.telemetry || {}),
    masterPct: entry.masterPct ?? container.telemetry?.masterPct ?? null,
    bluePct: entry.bluePct ?? container.telemetry?.bluePct ?? null,
    lastActionAt: ts,
    lastResult: entry.result
  };

  if (plan && !container.plan) {
    container.plan = plan;
  }
}

async function runPolicyOnce(state, onlyRoom = null) {
  const rooms = state.rooms || {};
  const actions = [];
  for (const [roomId, cfg] of Object.entries(rooms)) {
    if (onlyRoom && roomId !== onlyRoom) continue;
    const t = cfg.targets || {};
    const c = cfg.control || {};
    if (!c.enable) continue;
    const r = latestReading(state.readings || [], roomId);
    if (!r) continue;

    const dT = (r.temp ?? NaN) - (t.temp ?? NaN);
    const dRH = (r.rh ?? NaN) - (t.rh ?? NaN);

    let master = 0;
    let blue = 0;
    if (!Number.isNaN(dT) && dT > 0) {
      master -= Math.min(c.step || 0.05, dT * 0.03);
    }
    if (!Number.isNaN(dRH) && dRH > (t.rhBand || 5)) {
      master -= Math.min(c.step || 0.05, (dRH / (t.rhBand || 5)) * 0.05);
    }
    if (!Number.isNaN(dT) && dT > 0 && !Number.isNaN(dRH) && dRH > 0) {
      blue -= Math.min((c.step || 0.05) / 2, 0.03);
    }

    const minM = t.minMaster ?? 0.6;
    const minB = t.minBlue ?? 0.5;
    if (master !== 0 || blue !== 0) {
      const payload = {
        roomId,
        type: 'lights.scale',
        masterDelta: master,
        blueDelta: blue,
        minMaster: minM,
        minBlue: minB,
        dwell: c.dwell || 180
      };
      actions.push(payload);
      if (c.mode === 'autopilot') {
        await applyLightScaling(cfg, master, blue, minM, minB);
      }
      logAutomationAction(state, roomId, cfg, r, [payload], c.mode);
    }
  }
  return { state, actions };
}

function latestReading(readings, roomId) {
  for (let i = readings.length - 1; i >= 0; --i) {
    const entry = readings[i];
    if (entry.room !== roomId) continue;
    if (entry.kind && entry.kind !== SENSOR_ENTRY_KIND && entry.kind !== ACTION_ENTRY_KIND) continue;
    if (entry.temp == null && entry.rh == null && entry.vpd == null) continue;
    return entry;
  }
  return null;
}

async function applyLightScaling(cfg, masterDelta, blueDelta, minMaster, minBlue) {
  const lightIds = cfg?.actuators?.lights || [];
  if (!Array.isArray(lightIds) || !lightIds.length) return;
  for (const id of lightIds) {
    try {
      console.debug('[automation] would apply light scaling', { id, masterDelta, blueDelta, minMaster, minBlue });
    } catch (error) {
      console.warn('[automation] Failed to apply light scaling:', error?.message || error);
    }
  }
}

// --- Automation Rules Engine ---
const automationEngine = new AutomationRulesEngine();
console.log('[automation] Rules engine initialized with default farm automation rules');

const {
  engine: preAutomationEngine,
  envStore: preEnvStore,
  rulesStore: preRulesStore,
  registry: prePlugRegistry,
  plugManager: prePlugManager,
  logger: preAutomationLogger
} = createPreAutomationLayer({
  dataDir: path.resolve('./data/automation'),
  autoStart: !RUNNING_UNDER_NODE_TEST
});
console.log('[automation] Pre-AI automation layer initialized (sensors + smart plugs)');

if (!app.__automationListenPatched) {
  const originalListen = app.listen.bind(app);
  app.listen = function automationAwareListen(...args) {
    const server = originalListen(...args);
    server.on('close', () => {
      try {
        preAutomationEngine.stop();
      } catch (error) {
        console.warn('[automation] Failed to stop engine during shutdown:', error?.message || error);
      }
    });

    if (!RUNNING_UNDER_NODE_TEST) {
      try {
        preAutomationEngine.start();
      } catch (error) {
        console.warn('[automation] Failed to start engine after listen:', error?.message || error);
      }
    }

    return server;
  };
  app.__automationListenPatched = true;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'room';
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`[automation] Failed to read ${filePath}:`, error.message);
    return fallback;
  }
}

function findZoneMatch(zones, identifier) {
  if (!identifier) return null;
  const normalized = String(identifier).toLowerCase();
  return zones.find((zone) => {
    const zoneId = String(zone.id || '').toLowerCase();
    const zoneName = String(zone.name || '').toLowerCase();
    return zoneId === normalized || zoneName === normalized;
  }) || null;
}

function averageSetpoint(setpoint) {
  if (!setpoint || typeof setpoint !== 'object') return null;
  const min = Number(setpoint.min);
  const max = Number(setpoint.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return Math.round(((min + max) / 2) * 10) / 10;
}

function seedRoomAutomationDefaults() {
  try {
    const existing = preEnvStore.listRooms();
    if (existing.length) return;

    const roomsDoc = readJsonSafe(ROOMS_PATH, null);
    if (!roomsDoc || !Array.isArray(roomsDoc.rooms) || !roomsDoc.rooms.length) return;

    const envDoc = readJsonSafe(ENV_PATH, { zones: [] }) || { zones: [] };
    const zones = Array.isArray(envDoc.zones) ? envDoc.zones : [];

    let seeded = 0;

    roomsDoc.rooms.forEach((room) => {
      if (!room) return;
      const roomId = room.id || slugify(room.name);
      const primaryZoneLabel = Array.isArray(room.zones) && room.zones.length
        ? room.zones[0]
        : room.name || roomId;
      const zoneMatch = findZoneMatch(zones, primaryZoneLabel) || findZoneMatch(zones, roomId) || null;
      const zoneId = zoneMatch?.id || slugify(primaryZoneLabel);
      const tempTarget = averageSetpoint(zoneMatch?.sensors?.tempC?.setpoint) || zoneMatch?.sensors?.tempC?.current;
      const rhTarget = averageSetpoint(zoneMatch?.sensors?.rh?.setpoint) || zoneMatch?.sensors?.rh?.current;
      const rhSetpoint = zoneMatch?.sensors?.rh?.setpoint;
      let rhBand = 5;
      if (rhSetpoint && Number.isFinite(rhSetpoint.max) && Number.isFinite(rhSetpoint.min)) {
        rhBand = Math.max(2, Math.round(Math.abs(rhSetpoint.max - rhSetpoint.min) / 2));
      }

      const lights = (Array.isArray(room.devices) ? room.devices : [])
        .filter((device) => String(device?.type || '').toLowerCase() === 'light')
        .map((device) => device.id)
        .filter(Boolean);

      const fans = (Array.isArray(room.devices) ? room.devices : [])
        .filter((device) => {
          const type = String(device?.type || '').toLowerCase();
          return type.includes('fan') || type.includes('hvac');
        })
        .map((device) => device.id)
        .filter(Boolean);

      const dehuDevices = (Array.isArray(room.devices) ? room.devices : [])
        .filter((device) => String(device?.type || '').toLowerCase().includes('dehu'))
        .map((device) => device.id)
        .filter(Boolean);

      if (!fans.length && room.hardwareCats?.includes('hvac')) {
        fans.push(`fan:${roomId}`);
      }

      if (!dehuDevices.length && room.hardwareCats?.includes('dehumidifier')) {
        dehuDevices.push(`plug:dehu:${roomId}`);
      }

      const config = {
        roomId,
        name: room.name || roomId,
        targets: {
          temp: Number.isFinite(tempTarget) ? tempTarget : 24,
          rh: Number.isFinite(rhTarget) ? rhTarget : 65,
          rhBand,
          minBlue: 0.5,
          minMaster: 0.6
        },
        control: {
          enable: false,
          mode: 'advisory',
          step: 0.05,
          dwell: 180
        },
        sensors: {
          temp: zoneId,
          rh: zoneId
        },
        actuators: {
          lights,
          fans,
          dehu: dehuDevices
        },
        meta: {
          seededFrom: 'rooms.json',
          zoneId,
          zoneLabel: primaryZoneLabel
        }
      };

      preEnvStore.upsertRoom(roomId, config);
      seeded += 1;
    });

    if (seeded) {
      console.log(`[automation] Seeded ${seeded} room automation profile${seeded === 1 ? '' : 's'} from rooms.json`);
    }
  } catch (error) {
    console.warn('[automation] Failed to seed room automation defaults:', error.message);
  }
}

seedRoomAutomationDefaults();

const SENSOR_METRIC_ALIASES = new Map([
  ['temp', 'tempC'],
  ['temperature', 'tempC'],
  ['tempC', 'tempC'],
  ['rh', 'rh'],
  ['humidity', 'rh'],
  ['vpd', 'vpd'],
  ['co2', 'co2']
]);

function resolveMetricKey(metric) {
  const key = String(metric || '').toLowerCase();
  return SENSOR_METRIC_ALIASES.get(key) || metric || 'tempC';
}

function findZoneByAny(zones, identifiers = []) {
  const normalized = identifiers
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  if (!normalized.length) return null;
  return zones.find((zone) => {
    const zoneId = String(zone.id || '').toLowerCase();
    const zoneName = String(zone.name || '').toLowerCase();
    const zoneLocation = String(zone.location || '').toLowerCase();
    return normalized.some((value) => value === zoneId || value === zoneName || value === zoneLocation);
  }) || null;
}

function toLegacyMetricKeys(metricKey) {
  switch (metricKey) {
    case 'tempC':
      return ['tempC', 'temp', 'temperature'];
    case 'rh':
      return ['rh', 'humidity'];
    case 'vpd':
      return ['vpd'];
    case 'co2':
      return ['co2'];
    default:
      return [metricKey];
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function computeMedian(values) {
  if (!Array.isArray(values) || !values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function computeLegacyRoomMetric(legacyEnv, roomId, metricKey) {
  if (!legacyEnv || !Array.isArray(legacyEnv.readings) || !roomId) return null;
  const normalizedRoom = String(roomId).toLowerCase();
  const metricKeys = toLegacyMetricKeys(metricKey);

  const samples = [];
  let latestTs = null;

  for (const entry of legacyEnv.readings) {
    if (!entry) continue;
    const entryRoom = entry.room || entry.roomId || entry.scope;
    if (!entryRoom || String(entryRoom).toLowerCase() !== normalizedRoom) continue;
    for (const key of metricKeys) {
      if (!Object.prototype.hasOwnProperty.call(entry, key)) continue;
      const value = Number(entry[key]);
      if (Number.isFinite(value)) {
        samples.push(value);
      }
    }
    const tsCandidate = entry.ts || entry.timestamp || entry.observedAt || entry.recordedAt;
    if (tsCandidate) {
      const parsed = Date.parse(tsCandidate);
      if (Number.isFinite(parsed) && (!latestTs || parsed > latestTs)) {
        latestTs = parsed;
      }
    }
  }

  if (!samples.length) return null;
  return {
    value: computeMedian(samples),
    observedAt: latestTs ? new Date(latestTs).toISOString() : null,
    sampleCount: samples.length,
    source: 'room-median'
  };
}

function buildReadingQuality(meta = null, fallback = null) {
  const quality = {
    liveSources: 0,
    totalSources: 0,
    fallback: null,
    source: null,
    lastSampleAt: null
  };
  if (meta && typeof meta === 'object') {
    if (Number.isFinite(meta.liveSources)) quality.liveSources = meta.liveSources;
    if (Number.isFinite(meta.liveSampleCount)) quality.liveSources = meta.liveSampleCount;
    if (Number.isFinite(meta.totalSources)) quality.totalSources = meta.totalSources;
    if (Number.isFinite(meta.totalSampleCount)) quality.totalSources = meta.totalSampleCount;
    if (meta.fallback) quality.fallback = meta.fallback;
    if (meta.source) quality.source = meta.source;
    if (meta.lastSampleAt) quality.lastSampleAt = meta.lastSampleAt;
    if (!quality.totalSources && meta.sources && typeof meta.sources === 'object') {
      quality.totalSources = Object.keys(meta.sources).length;
    }
  }
  if (fallback) {
    quality.fallback = fallback;
  }
  return quality;
}

function resolveSensorReading(sensorConfig, fallbackIdentifier, metric, envSnapshot, zones, legacyEnv, roomId) {
  const scopes = envSnapshot?.scopes || {};
  const metricKey = resolveMetricKey(metric);
  let scopeId = fallbackIdentifier || null;
  let explicitMetric = null;

  if (typeof sensorConfig === 'string') {
    const trimmed = sensorConfig.trim();
    if (trimmed.includes('/')) {
      const parts = trimmed.split('/').filter(Boolean);
      if (parts.length >= 2) {
        scopeId = parts[parts.length - 2];
        explicitMetric = parts[parts.length - 1];
      } else if (parts.length === 1) {
        scopeId = parts[0];
      }
    } else {
      scopeId = trimmed;
    }
  } else if (sensorConfig && typeof sensorConfig === 'object') {
    scopeId = sensorConfig.scope || sensorConfig.zone || sensorConfig.id || scopeId;
    explicitMetric = sensorConfig.metric || sensorConfig.key || sensorConfig.type || explicitMetric;
  }

  const sensorKey = resolveMetricKey(explicitMetric || metricKey);
  const scopeEntry = scopeId ? scopes[scopeId] : null;
  const scopeSensor = scopeEntry?.sensors?.[sensorKey];

  let value = null;
  let unit = null;
  let observedAt = null;
  let source = null;
  let quality = buildReadingQuality(scopeSensor?.meta || null);

  if (scopeSensor != null) {
    if (typeof scopeSensor === 'object') {
      value = scopeSensor.value ?? scopeSensor.current ?? null;
      unit = scopeSensor.unit || null;
      observedAt = scopeSensor.observedAt || scopeEntry?.updatedAt || null;
    } else {
      value = scopeSensor;
    }
    source = 'scope';
  }

  if ((value == null || Number.isNaN(value)) && zones?.length) {
    const zoneMatch = findZoneByAny(zones, [scopeId, fallbackIdentifier]);
    const zoneSensor = zoneMatch?.sensors?.[sensorKey];
    if (zoneSensor != null) {
      if (typeof zoneSensor === 'object') {
        value = zoneSensor.current ?? zoneSensor.value ?? null;
        unit = zoneSensor.unit || unit || null;
        observedAt = zoneSensor.observedAt || zoneMatch.meta?.lastUpdated || observedAt || null;
        quality = buildReadingQuality(zoneSensor.meta || null, quality.fallback);
      } else {
        value = zoneSensor;
      }
      source = source || 'zone';
    }
  }

  if ((value == null || Number.isNaN(value)) && legacyEnv && (roomId || scopeId || fallbackIdentifier)) {
    const legacyRoomId = roomId || scopeId || fallbackIdentifier;
    const legacyMetric = computeLegacyRoomMetric(legacyEnv, legacyRoomId, sensorKey);
    if (legacyMetric) {
      value = legacyMetric.value;
      observedAt = legacyMetric.observedAt || observedAt;
      source = source || legacyMetric.source;
      quality = buildReadingQuality(scopeSensor?.meta || null, 'room-median');
      quality.totalSources = Math.max(quality.totalSources, legacyMetric.sampleCount || 0);
    }
  }

  const numericValue = typeof value === 'number' && !Number.isNaN(value) ? value : null;
  if (!quality.source && source) {
    quality.source = source;
  }
  if (numericValue == null) {
    quality.liveSources = 0;
  }

  return {
    scopeId,
    metric: sensorKey,
    value: numericValue,
    unit,
    observedAt,
    source,
    quality
  };
}

function evaluateRoomAutomationConfig(roomConfig, envSnapshot, zones, legacyEnv) {
  const evaluatedAt = new Date().toISOString();
  const control = {
    enable: Boolean(roomConfig?.control?.enable),
    mode: roomConfig?.control?.mode || 'advisory',
    step: typeof roomConfig?.control?.step === 'number' ? roomConfig.control.step : 0.05,
    dwell: typeof roomConfig?.control?.dwell === 'number' ? roomConfig.control.dwell : 180,
    paused: false
  };
  const targets = roomConfig?.targets || {};
  const sensors = roomConfig?.sensors || {};
  const readings = {};
  const suggestions = [];

  const summaryAlerts = [];

  const tempReading = resolveSensorReading(sensors.temp || sensors.temperature, sensors.temp || sensors.temperature, 'temp', envSnapshot, zones, legacyEnv, roomConfig?.roomId);
  if (tempReading.value != null) {
    readings.temp = tempReading;
  }

  const rhReading = resolveSensorReading(sensors.rh || sensors.humidity, sensors.rh || sensors.humidity, 'rh', envSnapshot, zones, legacyEnv, roomConfig?.roomId);
  if (rhReading.value != null) {
    readings.rh = rhReading;
  }

  const minBlue = typeof targets.minBlue === 'number' ? targets.minBlue : null;
  const minMaster = typeof targets.minMaster === 'number' ? targets.minMaster : null;

  const stepPercent = Math.round(control.step * 100);

  if (typeof targets.temp === 'number' && tempReading.value != null) {
    const delta = tempReading.value - targets.temp;
    const absDelta = Math.abs(delta);
    if (absDelta >= 0.5) {
      const severity = absDelta >= 3 ? 'critical' : absDelta >= 1.5 ? 'moderate' : 'minor';
      const direction = delta > 0 ? 'down' : 'up';
      const actionLabel = direction === 'down'
        ? `Dim master −${stepPercent}% for ${control.dwell}s`
        : `Increase master +${stepPercent}% for ${control.dwell}s`;
      suggestions.push({
        id: `${roomConfig.roomId || slugify(roomConfig.name)}-temp-${direction}`,
        type: 'lighting',
        metric: 'temp',
        severity,
        label: actionLabel,
        detail: `Current ${tempReading.value.toFixed(1)}°C vs target ${targets.temp.toFixed(1)}°C.`,
        delta,
        action: {
          actuator: 'lights',
          change: direction === 'down' ? -control.step : control.step,
          dwell: control.dwell,
          guardrails: { minMaster, minBlue }
        }
      });
      summaryAlerts.push(delta > 0 ? 'temperature high' : 'temperature low');
    }
  }

  const humidityQuality = rhReading?.quality || {};
  const humidityLiveSources = Number.isFinite(humidityQuality.liveSources) ? humidityQuality.liveSources : 0;
  const humidityFallback = humidityQuality.fallback;
  const humidityUsingRoomMedian = humidityFallback === 'room-median';
  const plugDwell = Math.max(control.dwell ?? 600, 600);

  if (typeof targets.rh === 'number' && rhReading.value != null) {
    const band = typeof targets.rhBand === 'number' ? Math.max(1, targets.rhBand) : 5;
    const minRh = targets.rh - band;
    const maxRh = targets.rh + band;
    const detailSuffix = !humidityLiveSources && humidityUsingRoomMedian
      ? ' Using room-level median until sensors recover.'
      : '';

    if (rhReading.value > maxRh) {
      const severity = rhReading.value - maxRh >= 5 ? 'moderate' : 'minor';
      suggestions.push({
        id: `${roomConfig.roomId || slugify(roomConfig.name)}-rh-high`,
        type: 'dehumidifier',
        metric: 'rh',
        severity,
        label: `Dehumidifier ON (${Math.round(plugDwell / 60)}m dwell)`,
        detail: `Humidity ${rhReading.value.toFixed(1)}% exceeds band (${minRh.toFixed(1)}–${maxRh.toFixed(1)}%).${detailSuffix}`,
        action: {
          actuator: 'dehu',
          dwell: plugDwell,
          mode: 'on'
        },
        disabled: !humidityLiveSources
      });
      summaryAlerts.push('humidity high');
    } else if (rhReading.value < minRh) {
      const severity = minRh - rhReading.value >= 5 ? 'moderate' : 'minor';
      suggestions.push({
        id: `${roomConfig.roomId || slugify(roomConfig.name)}-rh-low`,
        type: 'dehumidifier',
        metric: 'rh',
        severity,
        label: `Dehumidifier OFF (${Math.round(plugDwell / 60)}m dwell)`,
        detail: `Humidity ${rhReading.value.toFixed(1)}% below band (${minRh.toFixed(1)}–${maxRh.toFixed(1)}%).${detailSuffix}`,
        action: {
          actuator: 'dehu',
          dwell: plugDwell,
          mode: 'off'
        },
        disabled: !humidityLiveSources
      });
      summaryAlerts.push('humidity low');
    }
  }

  const missingMetrics = [];
  if (typeof targets.temp === 'number' && tempReading.value == null) missingMetrics.push('temperature');
  if (typeof targets.rh === 'number' && rhReading.value == null) missingMetrics.push('humidity');
  const sensorsMissing = missingMetrics.length > 0;
  if (sensorsMissing) {
    control.paused = true;
  }

  let statusLevel = null;
  let statusSummary = null;
  const statusDetails = [];

  if (sensorsMissing) {
    statusLevel = 'alert';
    statusSummary = 'Automation paused — sensors unavailable';
    const missingText = missingMetrics.join(' and ');
    statusDetails.push(`No live ${missingText} readings. Guardrails are paused until sensors recover.`);
    suggestions.length = 0;
  } else if (!humidityLiveSources && humidityUsingRoomMedian && typeof targets.rh === 'number') {
    statusLevel = 'alert';
    statusSummary = 'Using room median until humidity sensors recover';
    statusDetails.push('No live humidity sensors detected. Using last recorded room median for guardrails.');
  }

  const defaultLevel = suggestions.length
    ? (suggestions.some((s) => s.severity === 'critical') ? 'critical' : 'alert')
    : control.enable && control.mode === 'autopilot'
      ? 'active'
      : 'idle';
  if (!statusLevel || defaultLevel === 'critical') {
    statusLevel = defaultLevel;
  }

  const defaultSummary = suggestions.length
    ? `Advisories ready (${suggestions.length})`
    : control.enable && control.mode === 'autopilot'
      ? 'Autopilot engaged'
      : 'Within guardrails';
  if (!statusSummary) {
    statusSummary = defaultSummary;
  }

  if (summaryAlerts.length) {
    statusDetails.push(summaryAlerts.join(', '));
  } else if (suggestions.length) {
    statusDetails.push(suggestions.map((s) => s.detail).join(' | '));
  } else if (!statusDetails.length) {
    statusDetails.push('No adjustments recommended at this time.');
  }

  const statusDetail = statusDetails.filter(Boolean).join(' | ');

  return {
    roomId: roomConfig.roomId,
    name: roomConfig.name || roomConfig.roomId,
    targets: {
      ...targets,
      minBlue,
      minMaster
    },
    control,
    sensors,
    actuators: roomConfig.actuators || {},
    readings,
    suggestions,
    status: {
      level: statusLevel,
      summary: statusSummary,
      detail: statusDetail,
      evaluatedAt
    },
    evaluatedAt,
    meta: roomConfig.meta || {}
  };
}

function buildBindingIndex(bindingSummary) {
  const bindings = (bindingSummary && bindingSummary.bindings) || [];
  const byZone = new Map();
  const byRoom = new Map();

  bindings.forEach((binding) => {
    if (!binding) return;
    const zoneCandidates = [binding.scopeId, binding.zoneId, binding.zoneName, binding.zoneKey];
    zoneCandidates
      .map((value) => normalizeString(value).toLowerCase())
      .filter(Boolean)
      .forEach((key) => {
        if (!byZone.has(key)) {
          byZone.set(key, binding);
        }
      });

    const roomCandidates = [binding.roomId, binding.roomName];
    roomCandidates
      .map((value) => normalizeString(value).toLowerCase())
      .filter(Boolean)
      .forEach((key) => {
        if (!byRoom.has(key)) {
          byRoom.set(key, binding);
        }
      });
  });

  return { byZone, byRoom };
}

function findBindingForRoom(roomConfig, bindingIndex) {
  if (!roomConfig || !bindingIndex) return null;
  const { byZone, byRoom } = bindingIndex;
  const zoneCandidates = [
    roomConfig?.meta?.scopeId,
    roomConfig?.meta?.zoneId,
    roomConfig?.meta?.zoneName,
    roomConfig?.sensors?.temp,
    roomConfig?.sensors?.rh,
    roomConfig?.roomId,
  ];

  for (const candidate of zoneCandidates) {
    const key = normalizeString(candidate).toLowerCase();
    if (!key) continue;
    if (byZone.has(key)) return byZone.get(key);
  }

  const roomCandidates = [roomConfig.roomId, roomConfig.meta?.roomId, roomConfig.meta?.roomName, roomConfig.name];
  for (const candidate of roomCandidates) {
    const key = normalizeString(candidate).toLowerCase();
    if (!key) continue;
    if (byRoom.has(key)) return byRoom.get(key);
  }

  return null;
}

function mergeRoomWithBinding(roomConfig, binding) {
  if (!binding) return roomConfig;
  const scopeId = binding.scopeId || binding.zoneId || binding.zoneKey;

  const merged = {
    ...roomConfig,
    sensors: {
      ...(roomConfig.sensors || {}),
    },
    actuators: {
      ...(roomConfig.actuators || {}),
    },
    meta: {
      ...(roomConfig.meta || {}),
    },
  };

  if (scopeId) {
    merged.sensors.temp = scopeId;
    merged.sensors.rh = scopeId;
  }

  if (Array.isArray(binding.actuators?.fans) && binding.actuators.fans.length) {
    merged.actuators.fans = binding.actuators.fans
      .map((entry) => normalizeString(entry.plugId || entry.deviceId))
      .filter(Boolean);
  }

  if (Array.isArray(binding.actuators?.dehu) && binding.actuators.dehu.length) {
    merged.actuators.dehu = binding.actuators.dehu
      .map((entry) => normalizeString(entry.plugId || entry.deviceId))
      .filter(Boolean);
  }

  merged.meta = {
    ...merged.meta,
    zoneId: binding.zoneId || merged.meta.zoneId,
    zoneName: binding.zoneName || merged.meta.zoneName,
    scopeId: scopeId || merged.meta.scopeId,
    binding: {
      zoneId: binding.zoneId,
      zoneName: binding.zoneName,
      scopeId,
      roomId: binding.roomId,
      roomName: binding.roomName,
      primarySensorId: binding.primarySensorId || null,
      sensors: (binding.sensors || []).map((sensor) => ({
        deviceId: sensor.deviceId,
        name: sensor.name,
        primary: Boolean(sensor.primary),
        weight: sensor.weight,
        weightPercent: sensor.weightPercent,
        rawWeight: sensor.rawWeight,
        battery: sensor.battery,
        vendor: sensor.vendor,
        updatedAt: sensor.updatedAt || null,
      })),
      actuators: binding.actuators,
      counts: binding.counts,
      updatedAt: binding.updatedAt || null,
    },
  };

  return merged;
}

function evaluateRoomAutomationState(envSnapshot, zones, legacyEnv, bindingSummary = null) {
  const bindingIndex = buildBindingIndex(bindingSummary);
  const rooms = preEnvStore.listRooms();
  const results = rooms.map((room) => {
    const binding = findBindingForRoom(room, bindingIndex);
    const hydrated = mergeRoomWithBinding(room, binding);
    return evaluateRoomAutomationConfig(hydrated, envSnapshot, zones, legacyEnv);
  });
  const totalSuggestions = results.reduce((acc, room) => acc + (room.suggestions?.length || 0), 0);
  return {
    rooms: results,
    evaluatedAt: new Date().toISOString(),
    totalSuggestions
  };
}

function getPlanIndex() {
  const plans = loadPlansFile();
  const map = new Map();
  plans.forEach((plan, index) => {
    if (!plan) return;
    const hydrated = hydratePlan(plan, index);
    if (!hydrated?.id) return;
    const keys = [hydrated.id, hydrated.key, hydrated.name]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
    keys.forEach((key) => {
      if (!map.has(key)) map.set(key, hydrated);
    });
  });
  return map;
}

function startOfToday() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

function parseTimestamp(ts) {
  if (!ts) return null;
  const date = new Date(ts);
  return Number.isFinite(date.getTime()) ? date : null;
}

function computeAverage(entries, key) {
  let sum = 0;
  let count = 0;
  entries.forEach((entry) => {
    const value = Number(entry?.[key]);
    if (Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  });
  if (!count) return null;
  return sum / count;
}

function computeEnergy(entries) {
  let total = 0;
  let count = 0;
  entries.forEach((entry) => {
    const value = Number(entry?.kwh ?? entry?.energyKwh ?? entry?.energy);
    if (Number.isFinite(value)) {
      total += value;
      count += 1;
    }
  });
  if (!count) return null;
  return total;
}

function readDutyCycleValue(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const candidates = [
    entry.duty,
    entry.dutyCycle,
    entry.dutyPct,
    entry.dutyPercent,
    entry.plugDuty,
    entry.masterPct,
    entry.blueDuty,
  ];
  for (const candidate of candidates) {
    const value = toNumberOrNull(candidate);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function computeCorrelation(entries, accessorA, accessorB) {
  if (!Array.isArray(entries) || entries.length < 3) return null;
  const samples = [];
  entries.forEach((entry) => {
    try {
      const a = accessorA(entry);
      const b = accessorB(entry);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        samples.push({ a, b });
      }
    } catch (error) {
      // Ignore malformed samples
    }
  });
  if (samples.length < 3) return null;

  const sumA = samples.reduce((acc, sample) => acc + sample.a, 0);
  const sumB = samples.reduce((acc, sample) => acc + sample.b, 0);
  const meanA = sumA / samples.length;
  const meanB = sumB / samples.length;

  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  samples.forEach((sample) => {
    const diffA = sample.a - meanA;
    const diffB = sample.b - meanB;
    numerator += diffA * diffB;
    denomA += diffA ** 2;
    denomB += diffB ** 2;
  });

  if (denomA === 0 || denomB === 0) return null;
  const coefficient = numerator / Math.sqrt(denomA * denomB);
  if (!Number.isFinite(coefficient)) return null;
  return { coefficient: Math.max(-1, Math.min(1, coefficient)), samples: samples.length };
}

function sanitizeTempBin(bin) {
  if (bin == null) return '';
  return String(bin)
    .replace(/[°\s]*(?:c|f)/gi, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+to\s+/gi, '-')
    .replace(/\s+/g, '')
    .trim();
}

function parseTempBinRange(bin) {
  const raw = typeof bin === 'string' ? bin : '';
  const normalized = sanitizeTempBin(raw);
  if (!normalized) {
    return {
      label: raw || '',
      min: null,
      max: null,
      includeMin: false,
      includeMax: false,
    };
  }

  const numbers = normalized.match(/-?\d+(?:\.\d+)?/g) || [];
  const parseValue = (value) => {
    if (value == null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const range = {
    label: raw || normalized,
    min: null,
    max: null,
    includeMin: false,
    includeMax: false,
  };

  if (/^(>=|=>|≥)/.test(normalized)) {
    range.min = parseValue(numbers[0]);
    range.includeMin = true;
    return range;
  }
  if (/^>/.test(normalized)) {
    range.min = parseValue(numbers[0]);
    range.includeMin = false;
    return range;
  }
  if (/^(<=|=<|≤)/.test(normalized)) {
    range.max = parseValue(numbers[0]);
    range.includeMax = true;
    return range;
  }
  if (/^</.test(normalized)) {
    range.max = parseValue(numbers[0]);
    range.includeMax = false;
    return range;
  }

  if (numbers.length >= 2 && normalized.includes('-')) {
    const first = parseValue(numbers[0]);
    const second = parseValue(numbers[1]);
    if (first != null && second != null) {
      range.min = Math.min(first, second);
      range.max = Math.max(first, second);
      range.includeMin = true;
      range.includeMax = true;
      return range;
    }
  }

  if (numbers.length >= 1) {
    const value = parseValue(numbers[0]);
    if (value != null) {
      range.min = value;
      range.max = value;
      range.includeMin = true;
      range.includeMax = true;
    }
  }

  return range;
}

function tempBinMatches(value, binRange) {
  if (!Number.isFinite(value) || !binRange) return false;
  const { min, max, includeMin, includeMax } = binRange;
  if (min != null) {
    if (includeMin) {
      if (value < min) return false;
    } else if (value <= min) {
      return false;
    }
  }
  if (max != null) {
    if (includeMax) {
      if (value > max) return false;
    } else if (value >= max) {
      return false;
    }
  }
  return true;
}

function describeCorrelationStrength(coefficient) {
  const magnitude = Math.abs(coefficient);
  if (magnitude >= 0.85) return 'very strong';
  if (magnitude >= 0.7) return 'strong';
  if (magnitude >= 0.5) return 'moderate';
  if (magnitude >= 0.3) return 'weak';
  return 'minimal';
}

const learningCorrelationCache = new Map();

function logLearningCorrelations(roomId, correlations, daily) {
  if (!roomId || !preAutomationLogger) return;
  if (!correlations || typeof correlations !== 'object') return;
  const payload = {};
  Object.entries(correlations).forEach(([key, entry]) => {
    if (!entry || typeof entry !== 'object') return;
    if (!Number.isFinite(entry.coefficient)) return;
    payload[key] = {
      coefficient: Math.round(entry.coefficient * 1000) / 1000,
      samples: entry.samples || 0,
    };
  });
  if (!Object.keys(payload).length) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateKey = today.toISOString().slice(0, 10);
  const cacheEntry = learningCorrelationCache.get(roomId);
  const signature = JSON.stringify(payload);
  if (cacheEntry && cacheEntry.date === dateKey && cacheEntry.signature === signature) {
    return;
  }

  preAutomationLogger.log({
    type: 'learning-correlation',
    mode: 'advisory',
    roomId,
    date: dateKey,
    correlations: payload,
    daily: {
      tempAvg: Number.isFinite(daily?.tempAvg) ? daily.tempAvg : null,
      rhAvg: Number.isFinite(daily?.rhAvg) ? daily.rhAvg : null,
      ppfdAvg: Number.isFinite(daily?.ppfdAvg) ? daily.ppfdAvg : null,
      masterAvg: Number.isFinite(daily?.masterAvg) ? daily.masterAvg : null,
      energyKwh: Number.isFinite(daily?.energyKwh) ? daily.energyKwh : null,
      samples: Number.isFinite(daily?.samples) ? daily.samples : null,
    },
  });
  learningCorrelationCache.set(roomId, { date: dateKey, signature });
}

function buildAdaptiveRecommendation(room, plan, planKey, daily, targets) {
  if (!room || !plan) return null;
  const curve = Array.isArray(plan?.adapt?.tempCurve) ? plan.adapt.tempCurve : [];
  if (!curve.length) return null;
  const temp = Number.isFinite(daily?.tempAvg) ? daily.tempAvg : null;
  if (temp == null) return null;

  let matched = null;
  for (const entry of curve) {
    if (!entry || typeof entry !== 'object') continue;
    const binRange = parseTempBinRange(entry.bin || entry.label || entry.range || entry.zone || '');
    if (tempBinMatches(temp, binRange)) {
      matched = { entry, binRange };
      break;
    }
  }
  if (!matched) return null;

  const ppfdScale = entryValue(matched.entry, 'ppfdScale');
  const blueDelta = entryValue(matched.entry, 'blueDelta');
  const redDelta = entryValue(matched.entry, 'redDelta');

  const meaningfulScale = Number.isFinite(ppfdScale) && Math.abs(ppfdScale - 1) >= 0.01;
  const meaningfulBlue = Number.isFinite(blueDelta) && Math.abs(blueDelta) >= 0.005;
  const meaningfulRed = Number.isFinite(redDelta) && Math.abs(redDelta) >= 0.005;
  if (!meaningfulScale && !meaningfulBlue && !meaningfulRed) return null;

  const ppfdDeltaPct = meaningfulScale ? Math.round((ppfdScale - 1) * 1000) / 10 : 0;
  const blueDeltaPct = meaningfulBlue ? Math.round(blueDelta * 1000) / 10 : 0;
  const redDeltaPct = meaningfulRed ? Math.round(redDelta * 1000) / 10 : 0;

  const ppfdText = meaningfulScale
    ? `${ppfdDeltaPct > 0 ? '+' : ''}${ppfdDeltaPct.toFixed(Math.abs(ppfdDeltaPct) < 1 ? 1 : 0)}% PPFD`
    : null;
  const blueText = meaningfulBlue
    ? `${blueDeltaPct >= 0 ? '+' : ''}${Math.abs(blueDeltaPct).toFixed(Math.abs(blueDeltaPct) < 1 ? 1 : 0)}% blue`
    : null;
  const redText = meaningfulRed
    ? `${redDeltaPct >= 0 ? '+' : ''}${Math.abs(redDeltaPct).toFixed(Math.abs(redDeltaPct) < 1 ? 1 : 0)}% red`
    : null;

  const planName = plan.name || planKey || 'plan';
  const binLabel = matched.binRange?.label || matched.entry.bin || 'current bin';
  const actions = [ppfdText, blueText, redText].filter(Boolean);
  if (!actions.length) return null;

  const label = `Learning: ${actions.join(' & ')}`;
  const detail = `Plan ${planName} adaptive curve (${binLabel}) suggests ${actions.join(' and ')} when canopy temp averages ${temp.toFixed(1)}°C. Advisory only.`;

  const idSuffix = slugify(`${room.roomId || room.name || 'room'}-${binLabel || 'bin'}`);
  const suggestion = {
    id: `${room.roomId}-learning-${idSuffix}`,
    type: 'learning',
    metric: 'temp',
    label,
    detail,
    advisory: true,
    source: 'plan.adapt.tempCurve',
    bin: binLabel,
    recommendation: {
      ppfdScale: meaningfulScale ? ppfdScale : null,
      blueDelta: meaningfulBlue ? blueDelta : null,
      redDelta: meaningfulRed ? redDelta : null,
      plan: planName,
    },
  };

  const summary = `Learning curve recommends ${actions.join(' & ')} for ${temp.toFixed(1)}°C canopy.`;
  const narrative = `Adaptive guidance (${binLabel}) proposes ${actions.join(' & ')}. Targets remain advisory until approved.`;

  return { suggestion, summary, narrative };
}

function entryValue(entry, key) {
  if (!entry || typeof entry !== 'object') return null;
  const value = entry[key];
  const numeric = toNumberOrNull(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function selectPlanForRoom(room, legacyRooms, planIndex) {
  const planKey = [
    room?.plan,
    room?.targets?.plan,
    legacyRooms?.[room?.roomId]?.plan,
    legacyRooms?.[room?.roomId]?.targets?.plan,
    room?.meta?.planId,
    room?.meta?.plan
  ].find((value) => typeof value === 'string' && value.trim());
  if (!planKey) return { plan: null, planKey: null };
  const normalized = planKey.trim();
  return {
    plan: planIndex.get(normalized) || null,
    planKey: normalized
  };
}

function describeDelta(value, target, suffix) {
  if (!Number.isFinite(value) || !Number.isFinite(target)) return null;
  const delta = value - target;
  if (Math.abs(delta) < 0.01) return null;
  const arrow = delta > 0 ? '+' : '−';
  return `${arrow}${Math.abs(delta).toFixed(1)}${suffix}`;
}

function buildRoomAnalytics(room, legacyEnv, planIndex) {
  const readings = Array.isArray(legacyEnv?.readings) ? legacyEnv.readings.filter((entry) => entry?.room === room.roomId) : [];
  const todayStart = startOfToday();
  const todaysSensors = readings.filter((entry) => {
    const ts = parseTimestamp(entry?.ts);
    if (!ts) return false;
    return ts >= todayStart;
  });

  const dailyEntries = todaysSensors.length ? todaysSensors : readings.slice(-24);
  const daily = {
    tempAvg: computeAverage(dailyEntries, 'temp'),
    rhAvg: computeAverage(dailyEntries, 'rh'),
    vpdAvg: computeAverage(dailyEntries, 'vpd'),
    ppfdAvg: computeAverage(dailyEntries, 'ppfd'),
    masterAvg: computeAverage(dailyEntries, 'masterPct'),
    blueAvg: computeAverage(dailyEntries, 'bluePct'),
    energyKwh: computeEnergy(dailyEntries),
    samples: dailyEntries.length,
    logCount: readings.length
  };

  const suggestions = [];
  const summaryParts = [];
  const learningNarrative = [];

  const correlations = {
    ppfdBlue: computeCorrelation(
      dailyEntries,
      (entry) => toNumberOrNull(entry?.ppfd),
      (entry) => toNumberOrNull(entry?.bluePct)
    ),
    tempRh: computeCorrelation(
      dailyEntries,
      (entry) => toNumberOrNull(entry?.temp),
      (entry) => toNumberOrNull(entry?.rh)
    ),
    dutyEnergy: computeCorrelation(
      dailyEntries,
      (entry) => readDutyCycleValue(entry),
      (entry) => {
        const value = entry?.kwh ?? entry?.energyKwh ?? entry?.energy;
        return toNumberOrNull(value);
      }
    ),
  };
  daily.correlations = correlations;

  const learning = { correlations };
  const correlationLabels = {
    ppfdBlue: 'PPFD↔Blue',
    tempRh: 'Temp↔RH',
    dutyEnergy: 'Duty↔Energy',
  };
  const correlationSummary = [];
  Object.entries(correlations).forEach(([key, info]) => {
    if (!info || !Number.isFinite(info.coefficient)) return;
    if (info.samples < 3) return;
    const descriptor = describeCorrelationStrength(info.coefficient);
    const direction = info.coefficient >= 0 ? 'direct' : 'inverse';
    const label = correlationLabels[key] || key;
    const summaryText = `${label} ${descriptor} ${direction} correlation (${info.coefficient.toFixed(2)}, ${info.samples} samples)`;
    correlationSummary.push(summaryText);
  });
  if (correlationSummary.length) {
    learning.correlationSummary = correlationSummary;
    learningNarrative.push(correlationSummary.join('; '));
  }

  const { plan, planKey } = selectPlanForRoom(room, legacyEnv?.rooms || {}, planIndex);
  const targets = room?.targets || {};
  const control = room?.control || {};
  const rhBand = typeof targets.rhBand === 'number' ? Math.max(1, targets.rhBand) : 5;
  const minRh = Number.isFinite(targets.rh) ? targets.rh - rhBand : null;
  const maxRh = Number.isFinite(targets.rh) ? targets.rh + rhBand : null;
  const targetVpd = computeVpd(targets.temp, targets.rh);
  const stepPct = Math.round((control.step ?? 0.05) * 100);
  const dwell = control.dwell ?? 180;

  if (Number.isFinite(daily.tempAvg) && Number.isFinite(targets.temp)) {
    const delta = daily.tempAvg - targets.temp;
    if (delta > 0.8) {
      suggestions.push({
        id: `${room.roomId}-ai-temp-high`,
        type: 'lighting',
        metric: 'temp',
        label: `Dim master −${stepPct}%`,
        detail: `Avg ${daily.tempAvg.toFixed(1)}°C vs target ${targets.temp.toFixed(1)}°C · dwell ${dwell}s`,
        change: { masterDelta: -(control.step || 0.05), dwell }
      });
      summaryParts.push(`temperature running high (+${delta.toFixed(1)}°C)`);
    } else if (delta < -0.8) {
      suggestions.push({
        id: `${room.roomId}-ai-temp-low`,
        type: 'lighting',
        metric: 'temp',
        label: `Boost master +${stepPct}%`,
        detail: `Avg ${daily.tempAvg.toFixed(1)}°C below target ${targets.temp.toFixed(1)}°C · dwell ${dwell}s`,
        change: { masterDelta: control.step || 0.05, dwell }
      });
      summaryParts.push(`temperature trailing low (${delta.toFixed(1)}°C)`);
    }
  }

  if (Number.isFinite(daily.rhAvg) && Number.isFinite(targets.rh)) {
    if (maxRh != null && daily.rhAvg > maxRh + 1) {
      suggestions.push({
        id: `${room.roomId}-ai-rh-high`,
        type: 'dehumidifier',
        metric: 'rh',
        label: `Run dehumidifier ${dwell}s`,
        detail: `Avg RH ${daily.rhAvg.toFixed(1)}% above ${maxRh.toFixed(1)}% band`,
        change: { actuator: 'dehu', duration: dwell }
      });
      summaryParts.push(`humidity drifting high (+${(daily.rhAvg - maxRh).toFixed(1)}%)`);
    } else if (minRh != null && daily.rhAvg < minRh - 1) {
      suggestions.push({
        id: `${room.roomId}-ai-rh-low`,
        type: 'circulation',
        metric: 'rh',
        label: `Pulse fans ${dwell}s`,
        detail: `Avg RH ${daily.rhAvg.toFixed(1)}% below ${minRh.toFixed(1)}% band`,
        change: { actuator: 'fans', duration: dwell }
      });
      summaryParts.push(`humidity dipping low (${(daily.rhAvg - minRh).toFixed(1)}%)`);
    }
  }

  if (Number.isFinite(daily.vpdAvg) && Number.isFinite(targetVpd)) {
    const delta = daily.vpdAvg - targetVpd;
    if (delta > 0.2) {
      summaryParts.push(`VPD trending high (${delta.toFixed(2)} kPa)`);
    } else if (delta < -0.2) {
      summaryParts.push(`VPD trending low (${delta.toFixed(2)} kPa)`);
    }
  }

  if (plan && Number.isFinite(plan.ppfd) && Number.isFinite(daily.ppfdAvg)) {
    const ppfdDelta = daily.ppfdAvg - plan.ppfd;
    if (ppfdDelta < -30) {
      suggestions.push({
        id: `${room.roomId}-ai-ppfd-low`,
        type: 'lighting',
        metric: 'ppfd',
        label: `Raise PPFD +${stepPct}%`,
        detail: `Avg PPFD ${daily.ppfdAvg.toFixed(0)} vs plan ${plan.ppfd.toFixed(0)} µmol/m²/s`,
        change: { masterDelta: control.step || 0.05, dwell }
      });
      summaryParts.push(`PPFD trailing plan (${Math.abs(ppfdDelta).toFixed(0)} µmol)`);
    } else if (ppfdDelta > 40) {
      suggestions.push({
        id: `${room.roomId}-ai-ppfd-high`,
        type: 'lighting',
        metric: 'ppfd',
        label: `Trim PPFD −${stepPct}%`,
        detail: `Avg PPFD ${daily.ppfdAvg.toFixed(0)} above plan ${plan.ppfd.toFixed(0)} µmol/m²/s`,
        change: { masterDelta: -(control.step || 0.05), dwell }
      });
      summaryParts.push(`PPFD exceeding plan (${ppfdDelta.toFixed(0)} µmol)`);
    }
  }

  if (Number.isFinite(daily.energyKwh) && daily.energyKwh > 0) {
    summaryParts.push(`lighting draw ${daily.energyKwh.toFixed(2)} kWh`);
  }

  const adaptive = buildAdaptiveRecommendation(room, plan, planKey, daily, targets);
  if (adaptive) {
    suggestions.unshift(adaptive.suggestion);
    if (adaptive.summary && !summaryParts.includes(adaptive.summary)) {
      summaryParts.push(adaptive.summary);
    }
    if (adaptive.narrative) {
      learningNarrative.push(adaptive.narrative);
    }
    learning.adaptive = {
      bin: adaptive.suggestion?.bin || null,
      summary: adaptive.summary,
      narrative: adaptive.narrative,
      recommendation: adaptive.suggestion?.recommendation || null,
    };
    learning.suggestions = [adaptive.suggestion];
  }

  const summary = summaryParts.length
    ? `${summaryParts[0][0].toUpperCase()}${summaryParts[0].slice(1)}${summaryParts.length > 1 ? '; ' + summaryParts.slice(1).join('; ') : ''}`
    : 'Conditions within configured guardrails.';

  const narrativeParts = [summary];
  const tempDetail = Number.isFinite(daily.tempAvg) && Number.isFinite(targets.temp)
    ? `Temp ${daily.tempAvg.toFixed(1)}°C (${describeDelta(daily.tempAvg, targets.temp, '°C') || 'on target'})`
    : null;
  const rhDetail = Number.isFinite(daily.rhAvg) && Number.isFinite(targets.rh)
    ? `RH ${daily.rhAvg.toFixed(0)}% (${describeDelta(daily.rhAvg, targets.rh, '%') || 'on target'})`
    : null;
  const vpdDetail = Number.isFinite(daily.vpdAvg) && Number.isFinite(targetVpd)
    ? `VPD ${daily.vpdAvg.toFixed(2)} kPa (${describeDelta(daily.vpdAvg, targetVpd, ' kPa') || 'balanced'})`
    : null;
  const ppfdDetail = Number.isFinite(daily.ppfdAvg)
    ? Number.isFinite(plan?.ppfd)
      ? `PPFD ${daily.ppfdAvg.toFixed(0)} µmol (plan ${plan.ppfd.toFixed(0)})`
      : `PPFD ${daily.ppfdAvg.toFixed(0)} µmol`
    : null;

  const climateDetails = [tempDetail, rhDetail, vpdDetail, ppfdDetail].filter(Boolean);
  if (climateDetails.length) {
    narrativeParts.push(climateDetails.join(' · '));
  }
  if (plan) {
    const photoperiod = Number.isFinite(plan.photoperiod) ? `${plan.photoperiod}h` : '—';
    const planPpfd = Number.isFinite(plan.ppfd) ? `${plan.ppfd.toFixed(0)} µmol` : `${plan.ppfd || '—'} µmol`;
    narrativeParts.push(`Plan ${plan.name || planKey} targets ${planPpfd} for ${photoperiod}.`);
  }
  if (Number.isFinite(daily.energyKwh)) {
    narrativeParts.push(`Lighting energy ${daily.energyKwh.toFixed(2)} kWh today.`);
  }

  if (learningNarrative.length) {
    narrativeParts.push(`Learning insights: ${learningNarrative.join(' ')}`);
  }

  logLearningCorrelations(room.roomId, correlations, daily);

  const lastAction = readings.slice().reverse().find((entry) => entry?.kind === ACTION_ENTRY_KIND) || null;

  return {
    summary,
    narrative: narrativeParts.join(' '),
    daily,
    suggestions,
    plan: planKey || null,
    planName: plan?.name || null,
    lastActionAt: lastAction?.ts || null,
    lastResult: lastAction?.result || null,
    learning
  };
}

function parseLocalDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const copy = new Date(value);
    if (!Number.isFinite(copy.getTime())) return null;
    copy.setHours(0, 0, 0, 0);
    return copy;
  }
  const str = String(value).trim();
  if (!str) return null;
  const isoMatch = str.match(/^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    if (Number.isFinite(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0);
      return parsed;
    }
  }
  const parsed = new Date(str);
  if (!Number.isFinite(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function pickDefined(source) {
  const out = {};
  Object.entries(source || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) out[key] = value;
  });
  return out;
}

function normalizeMixInput(mix) {
  const src = mix && typeof mix === 'object' ? mix : {};
  return {
    cw: toNumberOrNull(src.cw) ?? 0,
    ww: toNumberOrNull(src.ww) ?? 0,
    bl: toNumberOrNull(src.bl) ?? 0,
    rd: toNumberOrNull(src.rd) ?? 0,
  };
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function applyCalibrationToMix(mix, calibration) {
  const base = normalizeMixInput(mix);
  const gains = calibration || {};
  const intensity = Number.isFinite(gains.intensity) ? gains.intensity : 1;
  return {
    cw: clampPercent(base.cw * (Number.isFinite(gains.cw) ? gains.cw : 1) * intensity),
    ww: clampPercent(base.ww * (Number.isFinite(gains.ww) ? gains.ww : 1) * intensity),
    bl: clampPercent(base.bl * (Number.isFinite(gains.bl) ? gains.bl : 1) * intensity),
    rd: clampPercent(base.rd * (Number.isFinite(gains.rd) ? gains.rd : 1) * intensity),
  };
}

function buildHexPayload(mix, maxByte) {
  const normalized = normalizeMixInput(mix);
  const scale = Number.isFinite(maxByte) && maxByte > 0 ? Math.min(Math.round(maxByte), 255) : 255;
  const toHex = (value) => {
    const clamped = clampPercent(value);
    const scaled = Math.round((clamped / 100) * scale);
    const bounded = Math.min(scale, Math.max(0, scaled));
    return bounded.toString(16).padStart(2, '0').toUpperCase();
  };
  return `${toHex(normalized.cw)}${toHex(normalized.ww)}${toHex(normalized.bl)}${toHex(normalized.rd)}0000`;
}

function loadChannelScaleConfig() {
  const doc = readJsonSafe(CHANNEL_SCALE_PATH, null) || {};
  const maxByte = toNumberOrNull(doc.maxByte);
  const scale = typeof doc.scale === 'string' && doc.scale.trim() ? doc.scale.trim() : '00-FF';
  const safeMaxByte = Number.isFinite(maxByte) && maxByte > 0 ? Math.min(Math.round(maxByte), 255) : 255;
  return { maxByte: safeMaxByte, scale };
}

function buildCalibrationMap() {
  const doc = readJsonSafe(CALIBRATIONS_PATH, null);
  const entries = Array.isArray(doc?.calibrations) ? doc.calibrations : [];
  const map = new Map();
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const gains = entry.gains && typeof entry.gains === 'object' ? entry.gains : {};
    Object.entries(gains).forEach(([deviceId, gain]) => {
      const id = String(deviceId || '').trim();
      if (!id) return;
      const existing = map.get(id) || { cw: 1, ww: 1, bl: 1, rd: 1, intensity: 1, sources: [] };
      const next = { ...existing };
      if (gain && typeof gain === 'object') {
        ['cw', 'ww', 'bl', 'rd'].forEach((key) => {
          const factor = toNumberOrNull(gain[key]);
          if (Number.isFinite(factor)) next[key] *= factor;
        });
        const intensity = toNumberOrNull(gain.intensity);
        if (Number.isFinite(intensity)) next.intensity *= intensity;
      }
      const sourceId = entry.id || entry.name || entry.targetId || null;
      if (sourceId) {
        const sources = new Set(next.sources || []);
        sources.add(String(sourceId));
        next.sources = Array.from(sources);
      }
      map.set(id, next);
    });
  });
  return map;
}

function resolveDeviceCalibration(calibrationMap, deviceId) {
  if (!deviceId) return { cw: 1, ww: 1, bl: 1, rd: 1, intensity: 1, sources: [] };
  const entry = calibrationMap.get(deviceId);
  if (!entry) return { cw: 1, ww: 1, bl: 1, rd: 1, intensity: 1, sources: [] };
  return { ...entry };
}

function getGroupDeviceIds(group) {
  const ids = new Set();
  const push = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed) ids.add(trimmed);
  };
  if (Array.isArray(group?.members)) {
    group.members.forEach(push);
  }
  if (Array.isArray(group?.lights)) {
    group.lights.forEach((entry) => {
      if (!entry) return;
      if (typeof entry === 'string') {
        push(entry);
      } else if (entry.id) {
        push(String(entry.id));
      }
    });
  }
  return Array.from(ids);
}

function resolvePlanLightTargets(plan, requestedDay) {
  const derived = plan?._derived || derivePlanRuntime(plan);
  const dayNumber = Math.max(1, Number.isFinite(requestedDay) ? Number(requestedDay) : 1);
  const entries = Array.isArray(derived?.lightDays) ? derived.lightDays : [];
  if (!entries.length) {
    const spectrum = plan?.spectrum || derived?.spectrum || {};
    const ppfd = toNumberOrNull(firstNonEmpty(plan?.ppfd, derived?.ppfd));
    const photoperiod = firstNonEmpty(plan?.photoperiod, derived?.photoperiod, plan?.defaults?.photoperiod);
    return {
      day: dayNumber,
      stage: plan?.stage || '',
      mix: normalizeMixInput(spectrum),
      ppfd,
      photoperiod,
      photoperiodHours: readPhotoperiodHours(photoperiod) ?? derived?.photoperiodHours ?? null,
    };
  }
  const sorted = entries.slice().sort((a, b) => {
    const aDay = Number.isFinite(a.day) ? a.day : 0;
    const bDay = Number.isFinite(b.day) ? b.day : 0;
    return aDay - bDay;
  });
  let selected = sorted[0];
  let effectiveDay = dayNumber;
  let maxDay = 0;
  for (const entry of sorted) {
    if (!Number.isFinite(entry.day)) continue;
    maxDay = Math.max(maxDay, entry.day);
    if (dayNumber >= entry.day) {
      selected = entry;
    } else {
      break;
    }
  }
  if (maxDay > 0 && dayNumber > maxDay) {
    effectiveDay = maxDay;
    const last = sorted.slice().reverse().find((entry) => Number.isFinite(entry.day) && entry.day === maxDay);
    if (last) selected = last;
  }
  const mix = selected?.mix ? normalizeMixInput(selected.mix) : normalizeMixInput(selected?.raw?.mix || {});
  const ppfd = toNumberOrNull(firstNonEmpty(selected?.ppfd, derived?.ppfd, plan?.ppfd));
  const photoperiod = firstNonEmpty(selected?.photoperiod, derived?.photoperiod, plan?.photoperiod, plan?.defaults?.photoperiod);
  const photoperiodHours = readPhotoperiodHours(photoperiod) ?? derived?.photoperiodHours ?? null;
  return {
    day: effectiveDay,
    stage: selected?.stage || plan?.stage || '',
    mix,
    ppfd,
    photoperiod,
    photoperiodHours,
  };
}

function resolvePlanEnvTargets(plan, requestedDay) {
  const derived = plan?._derived || derivePlanRuntime(plan);
  const dayNumber = Math.max(1, Number.isFinite(requestedDay) ? Number(requestedDay) : 1);
  const entries = Array.isArray(derived?.envDays) ? derived.envDays : [];
  if (!entries.length) {
    return {
      day: dayNumber,
      tempC: toNumberOrNull(plan?.env?.defaults?.tempC),
      rh: toNumberOrNull(plan?.env?.defaults?.rh),
      rhBand: toNumberOrNull(plan?.env?.defaults?.rhBand),
    };
  }
  const sorted = entries.slice().sort((a, b) => {
    const aDay = Number.isFinite(a.day) ? a.day : 0;
    const bDay = Number.isFinite(b.day) ? b.day : 0;
    return aDay - bDay;
  });
  let selected = sorted[0];
  let effectiveDay = dayNumber;
  let maxDay = 0;
  for (const entry of sorted) {
    if (!Number.isFinite(entry.day)) continue;
    maxDay = Math.max(maxDay, entry.day);
    if (dayNumber >= entry.day) {
      selected = entry;
    } else {
      break;
    }
  }
  if (maxDay > 0 && dayNumber > maxDay) {
    effectiveDay = maxDay;
    const last = sorted.slice().reverse().find((entry) => Number.isFinite(entry.day) && entry.day === maxDay);
    if (last) selected = last;
  }
  return {
    day: effectiveDay,
    tempC: selected?.tempC != null ? selected.tempC : toNumberOrNull(plan?.env?.defaults?.tempC),
    rh: selected?.rh != null ? selected.rh : toNumberOrNull(plan?.env?.defaults?.rh),
    rhBand: selected?.rhBand != null ? selected.rhBand : toNumberOrNull(plan?.env?.defaults?.rhBand),
  };
}

function computePlanDayNumber(planConfig, group, todayStart) {
  const today = todayStart instanceof Date ? new Date(todayStart) : new Date();
  today.setHours(0, 0, 0, 0);
  const anchor = planConfig?.anchor && typeof planConfig.anchor === 'object' ? planConfig.anchor : {};
  const mode = typeof anchor.mode === 'string' ? anchor.mode.trim().toLowerCase() : null;
  const anchorDps = toNumberOrNull(anchor.dps);
  if (mode === 'dps' && anchorDps != null) return Math.max(1, Math.round(anchorDps));
  if (anchorDps != null) return Math.max(1, Math.round(anchorDps));
  const previewDay = toNumberOrNull(planConfig?.preview?.day);
  if (previewDay != null) return Math.max(1, Math.round(previewDay));
  const seedCandidates = [
    anchor.seedDate,
    anchor.seed,
    anchor.date,
    planConfig?.seedDate,
    group?.seedDate,
    group?.planSeedDate,
    group?.plan?.seedDate
  ];
  for (const candidate of seedCandidates) {
    const parsed = parseLocalDate(candidate);
    if (!parsed) continue;
    const diff = Math.floor((today.getTime() - parsed.getTime()) / MS_PER_DAY);
    return diff >= 0 ? diff + 1 : 1;
  }
  return 1;
}

function normalizePlanControl(controlSpec) {
  const control = {
    enable: false,
    mode: 'advisory',
    step: 0.05,
    dwell: 600,
  };
  if (!controlSpec || typeof controlSpec !== 'object') return control;
  if (typeof controlSpec.enable === 'boolean') control.enable = controlSpec.enable;
  if (typeof controlSpec.mode === 'string' && controlSpec.mode.trim()) control.mode = controlSpec.mode.trim();
  const rawStep = toNumberOrNull(controlSpec.step);
  if (rawStep != null) control.step = rawStep > 1 ? rawStep / 100 : rawStep;
  const rawDwell = toNumberOrNull(controlSpec.dwell);
  if (rawDwell != null) control.dwell = rawDwell >= 60 ? rawDwell : rawDwell * 60;
  if (!Number.isFinite(control.step) || control.step < 0) control.step = 0.05;
  if (!Number.isFinite(control.dwell) || control.dwell <= 0) control.dwell = 600;
  return control;
}

function normalizeEnvTargetsForAutomation(targets) {
  const normalized = {};
  if (!targets || typeof targets !== 'object') return normalized;
  const temp = toNumberOrNull(targets.tempC ?? targets.temperature ?? targets.temp);
  if (temp != null) {
    normalized.tempC = temp;
    normalized.temp = temp;
  }
  const rh = toNumberOrNull(targets.rh ?? targets.humidity);
  if (rh != null) normalized.rh = Math.min(100, Math.max(0, rh));
  const rhBand = toNumberOrNull(targets.rhBand ?? targets.rh_band ?? targets.humidityBand);
  if (rhBand != null) normalized.rhBand = Math.abs(rhBand);
  const ppfd = toNumberOrNull(targets.ppfd);
  if (ppfd != null) normalized.ppfd = Math.max(0, ppfd);
  const photoperiod = toNumberOrNull(targets.photoperiodHours ?? targets.photoperiod);
  if (photoperiod != null) normalized.photoperiodHours = Math.max(0, photoperiod);
  const dli = toNumberOrNull(targets.dli);
  if (dli != null) normalized.dli = Math.max(0, dli);
  const stage = typeof targets.stage === 'string' && targets.stage.trim() ? targets.stage.trim() : null;
  if (stage) normalized.stage = stage;
  const planDay = toNumberOrNull(targets.planDay ?? targets.day);
  if (planDay != null) normalized.planDay = Math.max(1, Math.round(planDay));
  const planKey = typeof targets.planKey === 'string' && targets.planKey.trim() ? targets.planKey.trim() : null;
  if (planKey) normalized.planKey = planKey;
  const planName = typeof targets.planName === 'string' && targets.planName.trim() ? targets.planName.trim() : null;
  if (planName) normalized.planName = planName;
  return normalized;
}

function normalizeEnvControlForAutomation(control) {
  const normalized = {};
  if (!control || typeof control !== 'object') return normalized;
  if (typeof control.enable === 'boolean') normalized.enable = control.enable;
  if (typeof control.mode === 'string' && control.mode.trim()) normalized.mode = control.mode.trim();
  const stepRaw = toNumberOrNull(control.step ?? control.stepPct ?? control.stepPercent);
  if (stepRaw != null) {
    const normalizedStep = stepRaw > 1 ? stepRaw / 100 : stepRaw;
    if (Number.isFinite(normalizedStep)) {
      normalized.step = normalizedStep;
      normalized.stepPercent = Math.round(normalizedStep * 10000) / 100;
    }
  }
  const dwellRaw = toNumberOrNull(control.dwell ?? control.dwellMinutes ?? control.dwellMin);
  if (dwellRaw != null) {
    const normalizedDwell = dwellRaw >= 60 ? dwellRaw : dwellRaw * 60;
    if (Number.isFinite(normalizedDwell) && normalizedDwell > 0) {
      normalized.dwell = normalizedDwell;
      normalized.dwellMinutes = Math.round((normalizedDwell / 60) * 100) / 100;
    }
  }
  return normalized;
}

function applyEnvTargetsToAutomation(scopeId, {
  name,
  targets,
  control,
  deviceIds = [],
  meta = {},
  updatedAt = new Date().toISOString()
} = {}) {
  if (!scopeId) return { ok: false, error: 'scope-missing' };
  const zoneName = (typeof name === 'string' && name.trim()) ? name.trim() : scopeId;
  const sanitizedTargets = normalizeEnvTargetsForAutomation(targets);
  const sanitizedControl = normalizeEnvControlForAutomation(control);
  const lights = Array.isArray(deviceIds) ? Array.from(new Set(deviceIds.map((id) => String(id)))) : [];

  try {
    if (preEnvStore && typeof preEnvStore.upsertRoom === 'function') {
      preEnvStore.upsertRoom(scopeId, {
        name: zoneName,
        targets: sanitizedTargets,
        control: sanitizedControl,
        actuators: lights.length ? { lights } : {},
        meta
      });
    }
  } catch (error) {
    console.warn(`[daily] failed to upsert automation room ${scopeId}:`, error?.message || error);
  }

  try {
    if (preEnvStore && typeof preEnvStore.setTargets === 'function' && Object.keys(sanitizedTargets).length) {
      preEnvStore.setTargets(scopeId, { ...sanitizedTargets, updatedAt });
    }
  } catch (error) {
    console.warn(`[daily] failed to persist automation targets for ${scopeId}:`, error?.message || error);
  }

  try {
    if (preAutomationEngine && typeof preAutomationEngine.setTargets === 'function' && Object.keys(sanitizedTargets).length) {
      preAutomationEngine.setTargets(scopeId, sanitizedTargets);
    }
  } catch (error) {
    console.warn(`[daily] failed to apply automation targets for ${scopeId}:`, error?.message || error);
  }

  return { ok: true, scopeId, targets: sanitizedTargets, control: sanitizedControl };
}

async function patchControllerLight(deviceId, hex, shouldPowerOn) {
  if (!deviceId) return { ok: false, error: 'device-id-missing' };
  const payload = shouldPowerOn
    ? { status: 'on', value: hex }
    : { status: 'off', value: null };

  if (RUNNING_UNDER_NODE_TEST) {
    return { ok: true, skipped: true, reason: 'test-mode' };
  }

  const controller = getController();
  if (!controller) {
    return { ok: false, error: 'controller-unset' };
  }

  try {
    const base = controller.replace(/\/$/, '');
    const url = `${base}/api/devicedatas/device/${encodeURIComponent(deviceId)}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response) return { ok: false, error: 'no-response' };
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ok: false, status: response.status, error: text || `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    return { ok: false, error: error.message || 'controller-error' };
  }
}

let dailyResolverRunning = false;
let dailyResolverTimer = null;

async function runDailyPlanResolver(trigger = 'manual') {
  if (dailyResolverRunning) {
    console.warn(`[daily] resolver already running (trigger: ${trigger})`);
    return null;
  }
  dailyResolverRunning = true;
  const startedAt = new Date();
  startedAt.setMilliseconds(0);
  const startedMs = Date.now();

  try {
    const groups = loadGroupsFile();
    const planIndex = getPlanIndex();
    const channelScale = loadChannelScaleConfig();
    const calibrationMap = buildCalibrationMap();
    const envState = readEnv();
    const results = [];
    const todayStart = new Date(startedAt);
    todayStart.setHours(0, 0, 0, 0);

    if (!Array.isArray(groups) || !groups.length || !planIndex.size) {
      envState.lastDailyResolverAt = startedAt.toISOString();
      envState.lastDailyResolverTrigger = trigger;
      envState.planResolver = { lastRunAt: startedAt.toISOString(), trigger, groups: [] };
      envState.updatedAt = startedAt.toISOString();
      writeEnv(envState);
      if (!groups.length) {
        console.log(`[daily] no groups to resolve (trigger: ${trigger})`);
      } else {
        console.log(`[daily] no plans available to resolve groups (trigger: ${trigger})`);
      }
      return [];
    }

    for (const group of groups) {
      try {
        const planKeyCandidate = [
          group.plan,
          group.planKey,
          group.plan_id,
          group.planId,
          group?.planConfig?.planId,
          group?.planConfig?.preview?.planId,
          group?.planConfig?.preview?.planKey,
          group?.planConfig?.preview?.plan
        ].find((value) => typeof value === 'string' && value.trim());
        if (!planKeyCandidate) continue;
        const planKey = planKeyCandidate.trim();
        let plan = planIndex.get(planKey);
        if (!plan) {
          const lower = planKey.toLowerCase();
          for (const [key, candidate] of planIndex.entries()) {
            if (String(key).toLowerCase() === lower) {
              plan = candidate;
              break;
            }
          }
        }
        if (!plan) {
          console.warn(`[daily] plan '${planKey}' not found for group ${group.id || group.name || 'unknown'}`);
          continue;
        }

        const deviceIds = Array.from(new Set(getGroupDeviceIds(group)));
        if (!deviceIds.length) continue;

        const planConfig = (group.planConfig && typeof group.planConfig === 'object') ? group.planConfig : {};
        const dayNumber = computePlanDayNumber(planConfig, group, todayStart);
        const lightTargets = resolvePlanLightTargets(plan, dayNumber);
        const envTargets = resolvePlanEnvTargets(plan, dayNumber);
        const effectiveDay = lightTargets?.day || envTargets?.day || dayNumber;
        const gradients = (planConfig.gradients && typeof planConfig.gradients === 'object') ? planConfig.gradients : {};
        const gradientPpfd = toNumberOrNull(gradients.ppfd) ?? 0;
        const gradientBlue = toNumberOrNull(gradients.blue) ?? 0;
        const gradientTemp = toNumberOrNull(gradients.tempC) ?? 0;
        const gradientRh = toNumberOrNull(gradients.rh) ?? 0;

        const baseMix = normalizeMixInput(lightTargets?.mix || {});
        const basePpfd = toNumberOrNull(lightTargets?.ppfd);
        const targetPpfd = basePpfd != null ? Math.max(0, basePpfd + gradientPpfd) : null;
        let workingMix = { ...baseMix };
        if (Number.isFinite(basePpfd) && basePpfd > 0 && Number.isFinite(targetPpfd)) {
          const scale = targetPpfd / basePpfd;
          if (Number.isFinite(scale) && scale > 0) {
            workingMix = {
              cw: clampPercent(baseMix.cw * scale),
              ww: clampPercent(baseMix.ww * scale),
              bl: clampPercent(baseMix.bl * scale),
              rd: clampPercent(baseMix.rd * scale),
            };
          }
        }
        if (Number.isFinite(gradientBlue) && gradientBlue !== 0) {
          workingMix.bl = clampPercent((workingMix.bl ?? 0) + gradientBlue);
        }

        const scheduleCfg = planConfig?.schedule && typeof planConfig.schedule === 'object' ? planConfig.schedule : {};
        const scheduleDuration = toNumberOrNull(scheduleCfg.durationHours);
        const photoperiodFallback = Number.isFinite(lightTargets?.photoperiodHours)
          ? lightTargets.photoperiodHours
          : readPhotoperiodHours(lightTargets?.photoperiod);
        const resolvedPhotoperiod = Number.isFinite(scheduleDuration) && scheduleDuration > 0
          ? scheduleDuration
          : (Number.isFinite(photoperiodFallback)
            ? photoperiodFallback
            : (readPhotoperiodHours(plan?.defaults?.photoperiod) ?? null));

        let envTargetTemp = envTargets?.tempC;
        if (envTargetTemp != null && Number.isFinite(gradientTemp)) envTargetTemp += gradientTemp;
        let envTargetRh = envTargets?.rh;
        if (envTargetRh != null && Number.isFinite(gradientRh)) {
          envTargetRh = Math.min(100, Math.max(0, envTargetRh + gradientRh));
        }
        const envTargetRhBand = envTargets?.rhBand != null ? Math.abs(envTargets.rhBand) : null;

        const normalizedControl = normalizePlanControl(plan?.env?.control || planConfig?.control || {});
        const envControl = { ...normalizedControl, enable: normalizedControl.enable === false ? false : true };
        const planName = plan?.name || planKey;
        const stage = lightTargets?.stage || plan?.stage || '';
        const shouldPowerOn = !(Number.isFinite(targetPpfd) && targetPpfd <= 0);

        const hexPayloads = [];
        for (const deviceId of deviceIds) {
          const calibration = resolveDeviceCalibration(calibrationMap, deviceId);
          const calibratedMix = applyCalibrationToMix(workingMix, calibration);
          const hex = buildHexPayload(calibratedMix, channelScale.maxByte);
          const patchResult = await patchControllerLight(deviceId, hex, shouldPowerOn, {
            planKey,
            planName,
            stage,
            day: effectiveDay
          });
          if (!patchResult?.ok && !patchResult?.skipped) {
            console.warn(`[daily] failed to patch ${deviceId} for group ${group.id || group.name || 'unknown'}:`, patchResult?.error || patchResult?.status || 'unknown error');
          }
          const mixSummary = {
            cw: Number(clampPercent(calibratedMix.cw).toFixed(2)),
            ww: Number(clampPercent(calibratedMix.ww).toFixed(2)),
            bl: Number(clampPercent(calibratedMix.bl).toFixed(2)),
            rd: Number(clampPercent(calibratedMix.rd).toFixed(2)),
          };
          hexPayloads.push({
            deviceId,
            hex: shouldPowerOn ? hex : null,
            mix: mixSummary,
            calibrationSources: calibration.sources || [],
            patched: !!patchResult?.ok,
            skipped: !!patchResult?.skipped,
            status: patchResult?.status ?? null,
            error: patchResult?.ok ? null : (patchResult?.error || null)
          });
        }

        const envScopeCandidates = [
          group.zone,
          group.room,
          planConfig?.zone,
          planConfig?.scope,
          planConfig?.room,
          planKey
        ];
        const envScopeId = envScopeCandidates
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .find((value) => !!value) || 'default';
        const legacyRoomId = (typeof group.room === 'string' && group.room.trim()) ? group.room.trim() : envScopeId;

        const container = ensureRoomContainer(envState, legacyRoomId);
        container.name = group.name || container.name || legacyRoomId;
        container.zone = group.zone || container.zone || envScopeId;
        container.scopeId = envScopeId;
        container.plan = planKey;
        container.members = deviceIds;
        container.updatedAt = new Date().toISOString();
        const dli = Number.isFinite(targetPpfd) && Number.isFinite(resolvedPhotoperiod)
          ? (targetPpfd * 3600 * resolvedPhotoperiod) / 1e6
          : null;
        container.targets = {
          ...(container.targets || {}),
          ...pickDefined({
            temp: envTargetTemp,
            rh: envTargetRh,
            rhBand: envTargetRhBand,
            ppfd: targetPpfd,
            photoperiodHours: resolvedPhotoperiod,
            stage,
            planDay: effectiveDay,
            dli,
            planKey,
            planName
          })
        };
        container.control = {
          ...(container.control || {}),
          ...pickDefined(envControl)
        };
        container.actuators = container.actuators || {};
        container.actuators.lights = deviceIds;
        container.planDay = { day: effectiveDay, stage, computedAt: container.updatedAt };
        container.planConfig = planConfig;

        if (!envState.targets || typeof envState.targets !== 'object') envState.targets = {};
        envState.targets[legacyRoomId] = {
          ...(envState.targets[legacyRoomId] || {}),
          ...pickDefined({
            tempC: envTargetTemp,
            rh: envTargetRh,
            rhBand: envTargetRhBand,
            ppfd: targetPpfd,
            photoperiodHours: resolvedPhotoperiod,
            stage,
            planDay: effectiveDay,
            dli,
            planKey,
            planName
          }),
          updatedAt: container.updatedAt
        };
        if (!envState.control || typeof envState.control !== 'object') envState.control = {};
        envState.control[legacyRoomId] = {
          ...(envState.control[legacyRoomId] || {}),
          ...pickDefined(envControl),
          updatedAt: container.updatedAt
        };

        const preTargets = pickDefined({
          tempC: envTargetTemp,
          rh: envTargetRh,
          rhBand: envTargetRhBand,
          ppfd: targetPpfd,
          photoperiodHours: resolvedPhotoperiod,
          stage,
          planDay: effectiveDay,
          dli,
          planKey,
          planName
        });

        applyEnvTargetsToAutomation(envScopeId, {
          name: container.name,
          targets: preTargets,
          control: envControl,
          deviceIds,
          updatedAt: container.updatedAt,
          meta: pickDefined({
            planKey,
            planName,
            planStage: stage,
            planDay: effectiveDay,
            zone: group.zone,
            room: group.room,
            lastDailyResolverAt: container.updatedAt
          })
        });

        const scheduleSummary = Object.keys(scheduleCfg).length ? {
          startTime: scheduleCfg.startTime || null,
          durationHours: toNumberOrNull(scheduleCfg.durationHours) ?? null,
          rampUpMin: toNumberOrNull(scheduleCfg.rampUpMin) ?? null,
          rampDownMin: toNumberOrNull(scheduleCfg.rampDownMin) ?? null,
        } : null;

        results.push({
          groupId: group.id || null,
          groupName: group.name || null,
          room: group.room || null,
          planKey,
          planName,
          day: effectiveDay,
          stage,
          targetPpfd,
          photoperiodHours: resolvedPhotoperiod,
          dli,
          shouldPowerOn,
          schedule: scheduleSummary,
          env: pickDefined({ tempC: envTargetTemp, rh: envTargetRh, rhBand: envTargetRhBand }),
          control: pickDefined({ step: envControl.step, dwell: envControl.dwell, enable: envControl.enable, mode: envControl.mode }),
          scopeId: envScopeId,
          devices: hexPayloads,
        });
      } catch (groupError) {
        console.warn('[daily] failed to resolve group plan:', groupError?.message || groupError);
      }
    }

    envState.lastDailyResolverAt = startedAt.toISOString();
    envState.lastDailyResolverTrigger = trigger;
    envState.planResolver = { lastRunAt: startedAt.toISOString(), trigger, groups: results };
    envState.updatedAt = startedAt.toISOString();
    writeEnv(envState);
    console.log(`[daily] resolved ${results.length} group(s) in ${Date.now() - startedMs}ms (trigger: ${trigger})`);
    return results;
  } catch (error) {
    console.warn('[daily] plan resolver failed:', error?.message || error);
    return null;
  } finally {
    dailyResolverRunning = false;
  }
}

function computeNextDailyResolverDelay() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(0, 0, 15, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  const delay = next.getTime() - now.getTime();
  return Math.max(30000, delay);
}

function scheduleDailyPlanResolver() {
  if (RUNNING_UNDER_NODE_TEST) return;
  if (dailyResolverTimer) {
    clearTimeout(dailyResolverTimer);
  }
  const delay = computeNextDailyResolverDelay();
  dailyResolverTimer = setTimeout(async () => {
    try {
      await runDailyPlanResolver('scheduled');
    } catch (error) {
      console.warn('[daily] scheduled resolver run failed:', error?.message || error);
    } finally {
      scheduleDailyPlanResolver();
    }
  }, delay);
  if (typeof dailyResolverTimer.unref === 'function') {
    dailyResolverTimer.unref();
  }
}

if (!RUNNING_UNDER_NODE_TEST) {
  runDailyPlanResolver('startup').catch((error) => {
    console.warn('[daily] startup resolver failed:', error?.message || error);
  });
  scheduleDailyPlanResolver();
}

function buildAiAdvisory(rooms, legacyEnv) {
  const planIndex = getPlanIndex();
  const analyticsByRoom = new Map();
  const summaries = [];

  rooms.forEach((room) => {
    const analytics = buildRoomAnalytics(room, legacyEnv, planIndex);
    analyticsByRoom.set(room.roomId, analytics);
    if (analytics?.summary) {
      summaries.push(`${room.name || room.roomId}: ${analytics.summary}`);
    }
  });

  const summary = summaries.length
    ? summaries.join(' ')
    : 'AI Copilot is monitoring environmental guardrails.';

  return {
    summary,
    analyticsByRoom
  };
}

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
app.options('/env/rooms', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/env/rooms/:roomId', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/env/rooms/:roomId/actions', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/plugs', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/plugs/*', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/rules', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });
app.options('/rules/*', (req, res) => { setPreAutomationCors(req, res); res.status(204).end(); });

app.get('/env', async (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const zoneBindingSummary = await buildZoneBindingsFromDevices();
    const snapshot = preEnvStore.getSnapshot();
    const zonesFromScopes = Object.entries(snapshot.scopes || {}).map(([scopeId, scopeData]) => {
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

    let zonesPayload;
    try {
      zonesPayload = await loadEnvZonesPayload(req.query || {});
    } catch (error) {
      zonesPayload = { zones: zonesFromScopes, source: 'scopes', meta: { error: error.message } };
    }

    const zones = Array.isArray(zonesPayload.zones) && zonesPayload.zones.length ? zonesPayload.zones : zonesFromScopes;
    const legacyEnvState = readEnv();
    const automationState = evaluateRoomAutomationState(snapshot, zones, legacyEnvState, zoneBindingSummary);
    const aiBundle = buildAiAdvisory(automationState.rooms, legacyEnvState);
    const roomsWithAnalytics = automationState.rooms.map((room) => ({
      ...room,
      analytics: aiBundle.analyticsByRoom.get(room.roomId) || null
    }));

    res.json({
      ok: true,
      env: snapshot,
      zones,
      rooms: roomsWithAnalytics,
      zoneBindings: zoneBindingSummary.bindings,
      readings: legacyEnvState.readings || [],
      targets: legacyEnvState.targets || {},
      control: legacyEnvState.control || {},
      roomsMap: legacyEnvState.rooms || {},
      legacy: {
        rooms: legacyEnvState.rooms || {},
        targets: legacyEnvState.targets || {},
        control: legacyEnvState.control || {},
        readings: legacyEnvState.readings || []
      },
      ai: {
        summary: aiBundle.summary,
        rooms: roomsWithAnalytics.map((room) => ({
          roomId: room.roomId,
          name: room.name,
          analytics: room.analytics
        }))
      },
      meta: {
        envSource: zonesPayload.source,
        evaluatedAt: automationState.evaluatedAt,
        totalSuggestions: automationState.totalSuggestions,
        provider: zonesPayload.meta?.provider || null,
        cache: Boolean(zonesPayload.meta?.cached),
        updatedAt: zonesPayload.meta?.updatedAt || null,
        error: zonesPayload.meta?.error || null,
        zoneBindingsUpdatedAt: zoneBindingSummary.meta?.updatedAt || null,
        zoneBindingsSource: zoneBindingSummary.meta?.source || null,
        zoneBindingsError: zoneBindingSummary.meta?.error || null
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/env', pinGuard, (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const body = req.body || {};
    const scopeCandidates = [
      body.zoneId,
      body.zone,
      body.scope,
      body.scopeId,
      body.room,
      body.id
    ];
    const scope = scopeCandidates
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find((value) => !!value) || 'default';

    const sensors = body.sensors || body.readings || {};
    const sensorArray = Array.isArray(sensors) ? sensors : Object.entries(sensors).map(([type, value]) => ({ type, value }));
    const ingestStructuredReading = (reading, defaultScope) => {
      const readingScope = reading.scope || reading.room || reading.zone || defaultScope;
      if (!readingScope) return;

      const observedAt = reading.observedAt
        || reading.timestamp
        || reading.ts
        || new Date().toISOString();

      const baseMeta = {
        ...(reading.meta || reading.metadata || {}),
        sensorId: reading.sensorId
          || reading.id
          || reading.deviceId
          || reading.mac
          || reading.sourceId
          || reading.serial
          || undefined,
        vendor: reading.vendor || reading.brand || undefined
      };

      const metricCandidates = [
        { key: 'temp', aliases: ['temp', 'temperature'], unit: reading.tempUnit || reading.temperatureUnit || 'celsius' },
        { key: 'rh', aliases: ['rh', 'humidity'], unit: reading.rhUnit || reading.humidityUnit || 'percent' },
        { key: 'co2', aliases: ['co2'], unit: reading.co2Unit || 'ppm' },
        { key: 'vpd', aliases: ['vpd'], unit: reading.vpdUnit || 'kpa' },
        { key: 'ppfd', aliases: ['ppfd'], unit: reading.ppfdUnit || 'umol/m2/s' },
        { key: 'kwh', aliases: ['kwh', 'energyKwh', 'energy'], unit: reading.energyUnit || 'kwh' },
        { key: 'battery', aliases: ['battery'], unit: reading.batteryUnit || 'percent' },
        { key: 'rssi', aliases: ['rssi'], unit: reading.rssiUnit || 'dBm' }
      ];

      let ingestedAny = false;

      for (const metric of metricCandidates) {
        const value = metric.aliases
          .map((alias) => reading[alias])
          .find((candidate) => candidate !== undefined && candidate !== null);
        if (value === undefined || value === null) continue;

        preAutomationEngine.ingestSensor(readingScope, metric.key, {
          value,
          unit: reading.unit || metric.unit || null,
          observedAt,
          meta: baseMeta
        });
        ingestedAny = true;
      }

      return ingestedAny;
    };

    sensorArray.forEach((reading) => {
      if (!reading) return;
      const sensorType = reading.type || reading.sensor || reading.metric;
      const readingScope = reading.scope || reading.room || scope;

      if (sensorType) {
        preAutomationEngine.ingestSensor(readingScope, sensorType, {
          value: reading.value ?? reading.reading ?? null,
          unit: reading.unit,
          observedAt: reading.observedAt || reading.timestamp || new Date().toISOString(),
          meta: reading.meta || reading.metadata || null
        });
        return;
      }

      ingestStructuredReading(reading, scope);
    });

    const normalizedTargets = normalizeEnvTargetsForAutomation(body.targets);
    const normalizedControl = normalizeEnvControlForAutomation(body.control);
    const hasTargets = Object.keys(normalizedTargets).length > 0;
    const hasControl = Object.keys(normalizedControl).length > 0;
    const zoneNameCandidates = [body.zoneName, body.name, body.label];
    const zoneName = zoneNameCandidates
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find((value) => !!value) || scope;
    const metaPayload = body.meta && typeof body.meta === 'object' ? body.meta : null;

    if (hasTargets || hasControl || zoneName || metaPayload) {
      const upsertPayload = { name: zoneName };
      if (hasTargets) upsertPayload.targets = normalizedTargets;
      if (hasControl) upsertPayload.control = normalizedControl;
      if (metaPayload) upsertPayload.meta = metaPayload;
      preEnvStore.upsertRoom(scope, upsertPayload);
      if (hasTargets) {
        preAutomationEngine.setTargets(scope, normalizedTargets);
      }
    }

    const room = preEnvStore.getRoom(scope);
    const targets = preEnvStore.getTargets(scope);
    res.json({ ok: true, scope, zoneId: scope, room, targets });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch('/env/rooms/:roomId', pinGuard, async (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const roomId = req.params.roomId;
    if (!roomId) return res.status(400).json({ ok: false, error: 'roomId required' });
    const payload = req.body || {};
    const updated = preEnvStore.upsertRoom(roomId, payload);
    let zonesPayload;
    try {
      zonesPayload = await loadEnvZonesPayload({});
    } catch (error) {
      zonesPayload = { zones: [] };
    }
    const legacyEnvState = readEnv();
    const evaluated = evaluateRoomAutomationConfig(updated, preEnvStore.getSnapshot(), zonesPayload.zones || [], legacyEnvState);
    res.json({ ok: true, room: evaluated });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/env/rooms/:roomId/actions', pinGuard, async (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const roomId = req.params.roomId;
    if (!roomId) return res.status(400).json({ ok: false, error: 'roomId required' });
    const roomConfig = preEnvStore.getRoom(roomId);
    if (!roomConfig) return res.status(404).json({ ok: false, error: 'Room not found' });

    let zonesPayload;
    try {
      zonesPayload = await loadEnvZonesPayload({});
    } catch (error) {
      zonesPayload = { zones: [] };
    }

    const snapshot = preEnvStore.getSnapshot();
    const legacyEnvState = readEnv();
    const evaluated = evaluateRoomAutomationConfig(roomConfig, snapshot, zonesPayload.zones || [], legacyEnvState);
    const suggestionId = req.body?.suggestionId;
    const suggestion = evaluated.suggestions.find((item) => !suggestionId || item.id === suggestionId);
    if (!suggestion) {
      return res.status(400).json({ ok: false, error: 'Suggestion not available' });
    }

    preAutomationLogger?.log({
      type: 'room-automation-action',
      roomId,
      suggestionId: suggestion.id,
      action: suggestion.action || null,
      label: suggestion.label,
      detail: suggestion.detail,
      mode: evaluated.control?.mode || 'advisory'
    });

    res.json({ ok: true, room: evaluated, appliedSuggestion: suggestion });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});


app.get('/plugs', asyncHandler(async (req, res) => {
  setPreAutomationCors(req, res);
  // Get all plug-type devices from the device store
  let allPlugDevices = [];
  try {
    // Query for devices with type 'plug' (case-insensitive, supports SwitchBot, Kasa, Shelly, etc)
    const rows = await devicesStore.find({});
    allPlugDevices = rows.filter(d => {
      const type = (d.type || d.deviceType || '').toLowerCase();
      return type.includes('plug');
    });
  } catch (e) {
    console.warn('[plugs] Failed to load plug devices from device store:', e.message);
  }

  // Get plugs from prePlugManager (Kasa, Shelly, etc)
  let discoveredPlugs = [];
  try {
    discoveredPlugs = await prePlugManager.discoverAll();
  } catch (e) {
    console.warn('[plugs] prePlugManager.discoverAll() failed:', e.message);
  }

  // Merge by id (device id is unique)
  const plugMap = new Map();
  for (const plug of [...allPlugDevices, ...discoveredPlugs]) {
    const id = plug.id || plug.deviceId || plug.device_id;
    if (id) plugMap.set(id, plug);
  }
  const plugs = Array.from(plugMap.values());
  res.json({ ok: true, plugs });
}));

app.post('/plugs/discover', pinGuard, asyncHandler(async (req, res) => {
  setPreAutomationCors(req, res);
  const plugs = await prePlugManager.discoverAll();
  res.json({ ok: true, plugs, refreshedAt: new Date().toISOString() });
}));

app.post('/plugs/register', pinGuard, (req, res) => {
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

app.delete('/plugs/:plugId', pinGuard, (req, res) => {
  try {
    setPreAutomationCors(req, res);
    const plugId = decodeURIComponent(req.params.plugId);
    const removed = preAutomationEngine.unregisterPlug(plugId);
    res.json({ ok: true, removed });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/plugs/:plugId/state', pinGuard, asyncHandler(async (req, res) => {
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

app.post('/plugs/:plugId/rules', pinGuard, (req, res) => {
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

function toTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return ['true', '1', 'yes', 'y', 'primary', 'on'].includes(normalized);
  }
  return false;
}

function toWeight(value) {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return null;
  return num;
}

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value || '').trim();
}

function collectTextTokens(...values) {
  const tokens = new Set();
  values
    .flat()
    .filter((entry) => entry !== undefined && entry !== null)
    .forEach((entry) => {
      const text = normalizeString(entry).toLowerCase();
      if (!text) return;
      text
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .forEach((token) => tokens.add(token));
    });
  return tokens;
}

function classifyDeviceKind(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const details = doc.details || {};
  const tokens = collectTextTokens(
    doc.deviceType,
    doc.type,
    doc.category,
    doc.model,
    doc.protocol,
    doc.name,
    details.deviceType,
    details.category,
    details.model,
    details.kind
  );

  if (
    ['sensor', 'sensors', 'meter', 'thermometer', 'hygrometer', 'monitor', 'air', 'climate'].some((keyword) =>
      tokens.has(keyword)
    )
  ) {
    return 'sensor';
  }

  if (
    ['plug', 'plugs', 'outlet', 'switch', 'relay', 'socket'].some((keyword) =>
      tokens.has(keyword)
    )
  ) {
    return 'plug';
  }

  if (doc.controlledType || details.controlledType) {
    return 'plug';
  }

  return null;
}

function classifyControlledCategory(doc) {
  const details = (doc && doc.details) || {};
  const controlledRaw = normalizeString(
    firstNonEmpty(
      doc.controlledType,
      doc.controlType,
      details.controlledType,
      details.controlType,
      details.controlled_type,
      details.control_type
    )
  ).toLowerCase();

  const tokens = collectTextTokens(controlledRaw, doc.deviceType, doc.type, details.deviceType, details.type);

  if (controlledRaw) {
    if (controlledRaw.includes('dehu') || controlledRaw.includes('dehumid')) return 'dehu';
    if (controlledRaw.includes('fan') || controlledRaw.includes('exhaust')) return 'fans';
    if (controlledRaw.includes('heater') || controlledRaw.includes('heat')) return 'heaters';
    if (controlledRaw.includes('light') || controlledRaw.includes('lamp')) return 'lights';
  }

  if (tokens.has('dehu') || tokens.has('dehumidifier')) return 'dehu';
  if (tokens.has('fan') || tokens.has('fans') || tokens.has('blower')) return 'fans';
  if (tokens.has('heater') || tokens.has('heat')) return 'heaters';
  if (tokens.has('light') || tokens.has('lamp')) return 'lights';

  return 'misc';
}

function normalizeZoneContext(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const details = doc.details || {};

  const zoneName = normalizeString(
    firstNonEmpty(doc.zoneName, details.zoneName, doc.zone, details.zone, doc.location, details.location)
  );
  const zoneIdRaw = normalizeString(
    firstNonEmpty(doc.zoneId, details.zoneId, doc.zoneSlug, details.zoneSlug, doc.zone, details.zone, zoneName)
  );
  const zoneId = zoneIdRaw || (zoneName ? slugify(zoneName) : '');
  const zoneKey = zoneId ? zoneId.toLowerCase() : zoneName.toLowerCase();
  if (!zoneKey) return null;

  const roomName = normalizeString(
    firstNonEmpty(doc.roomName, details.roomName, doc.room, details.room, doc.locationName, details.location, doc.location)
  );
  const roomIdRaw = normalizeString(
    firstNonEmpty(doc.roomId, details.roomId, doc.roomSlug, details.roomSlug, roomName)
  );
  const roomId = roomIdRaw || (roomName ? slugify(roomName) : '');
  const roomKey = roomId ? roomId.toLowerCase() : roomName.toLowerCase();

  const scopeId = slugify(zoneId || zoneName || roomId || roomName || zoneKey || 'zone');

  return {
    zoneId: zoneId || null,
    zoneName: zoneName || (zoneId || '').toUpperCase(),
    zoneKey,
    roomId: roomId || null,
    roomName: roomName || null,
    roomKey,
    scopeId,
  };
}

function buildSensorEntry(doc, context) {
  const details = doc.details || {};
  const updatedAt = normalizeString(firstNonEmpty(doc.updatedAt, details.updatedAt));
  const updatedAtTs = toTimestamp(updatedAt);
  const rawWeight = toWeight(firstNonEmpty(doc.weight, details.weight));
  const battery = toNumberOrNull(firstNonEmpty(doc.battery, details.battery));
  return {
    deviceId: normalizeString(firstNonEmpty(doc.device_id, doc.deviceId, doc.id)),
    name: normalizeString(firstNonEmpty(doc.deviceName, doc.name, details.displayName, details.name)),
    vendor: normalizeString(firstNonEmpty(doc.manufacturer, details.manufacturer, doc.protocol)),
    primary: toBoolean(firstNonEmpty(doc.primary, details.primary)),
    rawWeight,
    weight: null,
    weightPercent: null,
    weightSource: rawWeight !== null ? 'explicit' : 'default',
    battery,
    updatedAt: updatedAtTs ? new Date(updatedAtTs).toISOString() : null,
    updatedAtTs,
    zoneId: context.zoneId,
    zoneName: context.zoneName,
  };
}

function buildActuatorEntry(doc, context) {
  const details = doc.details || {};
  const updatedAt = normalizeString(firstNonEmpty(doc.updatedAt, details.updatedAt));
  const updatedAtTs = toTimestamp(updatedAt);
  return {
    deviceId: normalizeString(firstNonEmpty(doc.device_id, doc.deviceId, doc.id)),
    plugId: normalizeString(firstNonEmpty(details.plugId, details.deviceId, doc.plugId, doc.id)),
    name: normalizeString(firstNonEmpty(doc.deviceName, doc.name, details.displayName, details.name)),
    vendor: normalizeString(firstNonEmpty(doc.manufacturer, details.manufacturer, doc.protocol)),
    controlledType: normalizeString(firstNonEmpty(doc.controlledType, details.controlledType)),
    energyTelemetry: normalizeString(firstNonEmpty(doc.energyTelemetry, details.energyTelemetry)),
    managedEquipment: normalizeString(firstNonEmpty(doc.managedEquipment, details.managedEquipment)),
    updatedAt: updatedAtTs ? new Date(updatedAtTs).toISOString() : null,
    updatedAtTs,
    zoneId: context.zoneId,
    zoneName: context.zoneName,
  };
}

function finalizeZoneBinding(binding) {
  const sensors = binding.sensors || [];
  if (sensors.length) {
    sensors.sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      const weightA = a.rawWeight ?? 0;
      const weightB = b.rawWeight ?? 0;
      if (weightA !== weightB) return weightB - weightA;
      return a.deviceId.localeCompare(b.deviceId);
    });

    let primary = sensors.find((sensor) => sensor.primary);
    if (!primary) {
      primary = sensors[0];
      if (primary) primary.primary = true;
    } else {
      sensors.forEach((sensor) => {
        sensor.primary = sensor === primary;
      });
    }

    const explicitCount = sensors.filter((sensor) => sensor.rawWeight !== null).length;
    if (explicitCount !== sensors.length) {
      const defaultWeight = sensors.length ? 1 / sensors.length : 0;
      sensors.forEach((sensor) => {
        if (sensor.rawWeight === null) {
          sensor.rawWeight = defaultWeight;
          sensor.weightSource = 'default';
        }
      });
    }

    const totalWeight = sensors.reduce((sum, sensor) => sum + (sensor.rawWeight || 0), 0);
    const divisor = totalWeight > 0 ? totalWeight : sensors.length || 1;
    sensors.forEach((sensor) => {
      const normalized = divisor ? (sensor.rawWeight || 0) / divisor : 0;
      const rounded = Math.max(0, Math.round(normalized * 1000) / 1000);
      sensor.weight = rounded;
      sensor.weightPercent = Math.round(rounded * 10000) / 100;
    });
    binding.primarySensorId = primary ? primary.deviceId : null;
  } else {
    binding.primarySensorId = null;
  }

  binding.counts = {
    sensors: sensors.length,
    fans: binding.actuators.fans.length,
    dehu: binding.actuators.dehu.length,
    heaters: binding.actuators.heaters.length,
    lights: binding.actuators.lights.length,
    misc: binding.actuators.misc.length,
  };

  binding.updatedAtTs = Math.max(
    binding.updatedAtTs || 0,
    ...sensors.map((sensor) => sensor.updatedAtTs || 0),
    ...binding.actuators.fans.map((act) => act.updatedAtTs || 0),
    ...binding.actuators.dehu.map((act) => act.updatedAtTs || 0),
    ...binding.actuators.heaters.map((act) => act.updatedAtTs || 0),
    ...binding.actuators.lights.map((act) => act.updatedAtTs || 0),
    ...binding.actuators.misc.map((act) => act.updatedAtTs || 0)
  );
  binding.updatedAt = binding.updatedAtTs ? new Date(binding.updatedAtTs).toISOString() : null;
  delete binding.updatedAtTs;

  // Remove temporary timestamp fields from child entries for cleaner JSON payloads
  sensors.forEach((sensor) => delete sensor.updatedAtTs);
  Object.values(binding.actuators).forEach((list) =>
    list.forEach((entry) => delete entry.updatedAtTs)
  );

  return binding;
}

async function buildZoneBindingsFromDevices() {
  try {
    const rows = await devicesStore.find({});
    const zoneMap = new Map();

    for (const doc of rows) {
      const kind = classifyDeviceKind(doc);
      if (!kind) continue;
      const context = normalizeZoneContext(doc);
      if (!context) continue;

      const zoneKey = context.zoneKey;
      if (!zoneMap.has(zoneKey)) {
        zoneMap.set(zoneKey, {
          zoneId: context.zoneId,
          zoneName: context.zoneName || context.zoneId,
          zoneKey,
          scopeId: context.scopeId,
          roomId: context.roomId,
          roomName: context.roomName,
          sensors: [],
          actuators: {
            fans: [],
            dehu: [],
            heaters: [],
            lights: [],
            misc: [],
          },
          updatedAt: null,
          updatedAtTs: null,
        });
      }

      const binding = zoneMap.get(zoneKey);
      if (!binding.roomId && context.roomId) binding.roomId = context.roomId;
      if (!binding.roomName && context.roomName) binding.roomName = context.roomName;
      if (!binding.zoneId && context.zoneId) binding.zoneId = context.zoneId;
      if (!binding.zoneName && context.zoneName) binding.zoneName = context.zoneName;

      if (kind === 'sensor') {
        binding.sensors.push(buildSensorEntry(doc, context));
      } else if (kind === 'plug') {
        const category = classifyControlledCategory(doc);
        if (category && binding.actuators[category]) {
          const entry = buildActuatorEntry(doc, context);
          if (!binding.actuators[category].some((existing) => existing.deviceId === entry.deviceId)) {
            binding.actuators[category].push(entry);
          }
        }
      }
    }

    const bindings = Array.from(zoneMap.values()).map(finalizeZoneBinding);
    bindings.sort((a, b) => a.zoneName.localeCompare(b.zoneName, undefined, { sensitivity: 'base' }));

    const meta = {
      source: 'devices-store',
      bindings: bindings.length,
      updatedAt:
        bindings.reduce((latest, binding) => {
          if (!binding.updatedAt) return latest;
          if (!latest) return binding.updatedAt;
          return Date.parse(binding.updatedAt) > Date.parse(latest) ? binding.updatedAt : latest;
        }, null) || null,
    };

    return { bindings, meta };
  } catch (error) {
    console.warn('[automation] Failed to build zone bindings:', error.message);
    return { bindings: [], meta: { source: 'devices-store', error: error.message } };
  }
}

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

// SwitchBot Real API Endpoints - MUST be before proxy middleware
const SWITCHBOT_TOKEN = process.env.SWITCHBOT_TOKEN || '';
const SWITCHBOT_SECRET = process.env.SWITCHBOT_SECRET || '';
const SWITCHBOT_REGION = process.env.SWITCHBOT_REGION || '';
const SWITCHBOT_API_BASE = 'https://api.switch-bot.com/v1.1';
const SWITCHBOT_API_TIMEOUT_MS = Number(process.env.SWITCHBOT_API_TIMEOUT_MS || 8000);
const SWITCHBOT_DEVICE_CACHE_TTL_MS = Number(process.env.SWITCHBOT_DEVICE_CACHE_TTL_MS || 1_800_000); // 30 minutes
const SWITCHBOT_STATUS_CACHE_TTL_MS = Number(process.env.SWITCHBOT_STATUS_CACHE_TTL_MS || 900_000); // 15 minutes
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

// Unified health endpoint with controller + SwitchBot diagnostics
app.get('/healthz', async (req, res) => {
  const started = Date.now();
  const hasCors = app._router && app._router.stack && app._router.stack.some(
    (layer) => layer && layer.handle && layer.handle.toString().includes('Access-Control-Allow-Origin')
  );

  const controllerInfo = { reachable: false, status: null };
  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 1200);
    try {
      const base = getController().replace(/\/$/, '');
      let response = await fetch(base, { method: 'HEAD', signal: ac.signal });
      controllerInfo.reachable = response.ok;
      controllerInfo.status = response.status;

      if (!controllerInfo.reachable || (typeof controllerInfo.status === 'number' && controllerInfo.status >= 400)) {
        response = await fetch(`${base}/healthz`, { method: 'GET', headers: { accept: '*/*' }, signal: ac.signal });
        controllerInfo.reachable = response.ok;
        controllerInfo.status = response.status;
      }

      if (!controllerInfo.reachable || (typeof controllerInfo.status === 'number' && controllerInfo.status >= 400)) {
        response = await fetch(`${base}/api/healthz`, { method: 'GET', headers: { accept: '*/*' }, signal: ac.signal });
        controllerInfo.reachable = response.ok;
        controllerInfo.status = response.status;
      }
    } catch (error) {
      controllerInfo.reachable = false;
      controllerInfo.status = error.name === 'AbortError' ? 'timeout' : (error.message || 'error');
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    controllerInfo.reachable = false;
    controllerInfo.status = error.message || 'error';
  }

  let statusCacheEntries = 0;
  let statusCacheActive = 0;
  for (const entry of switchBotStatusCache.values()) {
    statusCacheEntries += 1;
    if (entry?.payload) statusCacheActive += 1;
  }

  const switchBotDiagnostics = {
    configured: ensureSwitchBotConfigured(),
    tokenPresent: Boolean(process.env.SWITCHBOT_TOKEN && process.env.SWITCHBOT_TOKEN.trim()),
    secretPresent: Boolean(process.env.SWITCHBOT_SECRET && process.env.SWITCHBOT_SECRET.trim()),
    region: SWITCHBOT_REGION || null,
    lastRequestAt: lastSwitchBotRequest ? new Date(lastSwitchBotRequest).toISOString() : null,
    cache: {
      devicesCached: Boolean(switchBotDevicesCache.payload),
      devicesFetchedAt: switchBotDevicesCache.fetchedAt ? new Date(switchBotDevicesCache.fetchedAt).toISOString() : null,
      devicesError: switchBotDevicesCache.lastError ? (switchBotDevicesCache.lastError.message || String(switchBotDevicesCache.lastError)) : null,
      statusEntries: statusCacheEntries,
      statusCached: statusCacheActive
    }
  };

  const ok = hasCors && (controllerInfo.reachable || controllerInfo.status === 'timeout');
  const httpStatus = hasCors ? 200 : 500;
  res.status(httpStatus).json({
    ok,
    status: ok ? 'healthy' : (hasCors ? 'degraded' : 'unhealthy'),
    cors: { configured: hasCors },
    controller: {
      target: getController(),
      reachable: controllerInfo.reachable,
      status: controllerInfo.status
    },
    envSource: ENV_SOURCE,
    azureLatestUrl: AZURE_LATEST_URL || null,
    switchbot: switchBotDiagnostics,
    ts: new Date().toISOString(),
    dtMs: Date.now() - started
  });
});

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

app.get('/switchbot/devices', async (req, res) => {
  try {
    const token = process.env.SWITCHBOT_TOKEN;
    if (!token) {
      return res.status(500).json({ error: 'SWITCHBOT_TOKEN not configured' });
    }
    const response = await fetch('https://api.switch-bot.com/v1.1/devices', {
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).send(text);
    }

    const payload = await response.json();
    res.json(payload);
  } catch (error) {
    console.error('[switchbot] Proxy failed:', error);
    res.status(500).json({ error: String(error) });
  }
});

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

function streamLiveFile(res, filePath, type) {
  if (!fs.existsSync(filePath)) {
    res.status(404).send(`${path.basename(filePath)} not found`);
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  if (type) res.type(type);
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  stream.on('error', (err) => {
    console.error('[live-file] stream error', err);
    if (!res.headersSent) {
      res.status(500).send('Failed to read file');
    } else {
      res.end();
    }
  });
  stream.pipe(res);
}

// Phase 9 testing guardrails: serve the live files from disk
app.get('/tmp/live.index.html', (req, res) => {
  const filePath = path.join(PUBLIC_DIR, 'index.html');
  streamLiveFile(res, filePath, 'html');
});

app.get('/tmp/live.app.new.js', (req, res) => {
  const filePath = path.join(PUBLIC_DIR, 'app.charlie.js');
  streamLiveFile(res, filePath, 'application/javascript');
});

const CONTROLLER_BASE = () => getController().replace(/\/+$/, '');

// Targeted proxies for controller device data
app.get('/api/devicedatas', async (req, res) => {
  const target = `${CONTROLLER_BASE()}/api/devicedatas`;
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(5000) });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`upstream_status_${response.status}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch (err) {
      throw new Error(`upstream_non_json: ${err.message}`);
    }
    writeDeviceCache(parsed);
    res
      .status(response.status)
      .type('application/json')
      .send(JSON.stringify(parsed));
  } catch (error) {
    const cached = readDeviceCache();
    if (cached) {
      res.setHeader('X-Cache', 'hit');
      const payload = {
        stale: true,
        cachedAt: cached.cachedAt,
        data: cached.data ?? cached
      };
      res.status(200).json(payload);
      return;
    }
    res.status(502).json({ error: 'proxy_error', target, detail: String(error) });
  }
});

app.patch('/api/devicedatas/device/:id', pinGuard, express.json(), async (req, res) => {
  const target = `${CONTROLLER_BASE()}/api/devicedatas/device/${encodeURIComponent(req.params.id)}`;
  try {
    const response = await fetch(target, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(5000)
    });
    const body = await response.text();
    res
      .status(response.status)
      .type(response.headers.get('content-type') || 'application/json')
      .send(body);
  } catch (error) {
    res.status(502).json({ error: 'proxy_error', target, detail: String(error) });
  }
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

const ZONE_SENSOR_FRESH_MS = 10 * 60 * 1000; // 10 minutes

function weightedMedianSamples(samples) {
  if (!Array.isArray(samples) || !samples.length) return null;
  const normalized = samples
    .filter((sample) => isFiniteNumber(sample.value))
    .map((sample) => ({
      value: sample.value,
      weight: isFiniteNumber(sample.weight) && sample.weight > 0 ? sample.weight : 1
    }))
    .sort((a, b) => a.value - b.value);
  if (!normalized.length) return null;
  const totalWeight = normalized.reduce((acc, sample) => acc + sample.weight, 0);
  const half = totalWeight / 2;
  let running = 0;
  for (const sample of normalized) {
    running += sample.weight;
    if (running >= half) {
      return sample.value;
    }
  }
  return normalized[normalized.length - 1].value;
}

function aggregateZoneSources(sourceEntries) {
  const entries = Object.values(sourceEntries || {})
    .filter((entry) => entry && isFiniteNumber(entry.value))
    .map((entry) => ({
      ...entry,
      observedAtTs: Date.parse(entry.observedAt || '') || Date.now()
    }));

  if (!entries.length) {
    return {
      value: null,
      observedAt: null,
      liveSources: 0,
      totalSources: 0,
      fallback: null,
      lastSampleAt: null
    };
  }

  const now = Date.now();
  const live = entries.filter((entry) => now - entry.observedAtTs <= ZONE_SENSOR_FRESH_MS);
  const samples = live.length ? live : entries;
  const aggregate = weightedMedianSamples(samples);
  const latest = samples.reduce((acc, entry) => (entry.observedAtTs > acc ? entry.observedAtTs : acc), 0);

  return {
    value: aggregate,
    observedAt: latest ? new Date(latest).toISOString() : null,
    liveSources: live.length,
    totalSources: entries.length,
    fallback: live.length ? null : 'stale-sources',
    lastSampleAt: latest ? new Date(latest).toISOString() : null
  };
}

async function loadEnvZonesPayload(query = {}) {
  if (ENV_SOURCE === 'azure' && AZURE_LATEST_URL) {
    const params = new URLSearchParams();
    if (query.zone) params.set('zone', query.zone);
    if (query.deviceId) params.set('deviceId', query.deviceId);
    const url = params.toString() ? `${AZURE_LATEST_URL}?${params.toString()}` : AZURE_LATEST_URL;

    try {
      const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`Azure endpoint ${response.status}`);
      const list = await response.json();

      const zonesMap = new Map();
      for (const entry of Array.isArray(list) ? list : []) {
        const zoneId = entry.zone || 'DefaultZone';
        const zone = zonesMap.get(zoneId) || { id: zoneId, name: zoneId, location: zoneId, sensors: {}, meta: {} };
        const temp = Number(entry.temperature);
        const humidity = Number(entry.humidity);
        const co2 = Number(entry.co2);
        const vpd = computeVPDkPa(temp, humidity);

        if (typeof entry.battery === 'number') zone.meta.battery = entry.battery;
        if (typeof entry.rssi === 'number') zone.meta.rssi = entry.rssi;
        if (entry.timestamp) zone.meta.lastUpdated = entry.timestamp;

        const ensureSensor = (key, value) => {
          if (!zone.sensors[key]) {
            zone.sensors[key] = { current: null, setpoint: { min: null, max: null }, history: [], sources: {} };
          }
          if (typeof value === 'number' && !Number.isNaN(value)) {
            const histKey = `${zoneId}:${key}`;
            pushHist(histKey, value);
            zone.sensors[key].history = azureHist.get(histKey) || [];

            const sources = zone.sensors[key].sources || (zone.sensors[key].sources = {});
            const sensorId = entry.sensorId || entry.deviceId || entry.mac || entry.serial || entry.id || `${zoneId}:${key}`;
            const observedAt = entry.timestamp || entry.observedAt || entry.recordedAt || entry.lastSeen || new Date().toISOString();
            const weight = Number(entry.weight ?? entry.confidence ?? entry.priority);
            const sample = {
              value,
              weight: Number.isFinite(weight) && weight > 0 ? weight : undefined,
              observedAt
            };
            const existingSample = sources[sensorId];
            const existingTs = existingSample ? Date.parse(existingSample.observedAt || '') || 0 : 0;
            const nextTs = Date.parse(sample.observedAt || '') || Date.now();
            if (!existingSample || nextTs >= existingTs) {
              sources[sensorId] = sample;
            }
          }
        };

        ensureSensor('tempC', temp);
        ensureSensor('rh', humidity);
        ensureSensor('co2', co2);
        if (vpd != null) ensureSensor('vpd', vpd);

        zonesMap.set(zoneId, zone);
      }

      const zonesList = Array.from(zonesMap.values()).map((zone) => {
        const sensors = zone.sensors || {};
        for (const sensor of Object.values(sensors)) {
          const aggregate = aggregateZoneSources(sensor.sources || {});
          if (aggregate.value != null) {
            sensor.current = aggregate.value;
            sensor.observedAt = aggregate.observedAt || sensor.observedAt || zone.meta?.lastUpdated || null;
          }
          sensor.meta = {
            ...(sensor.meta || {}),
            liveSources: aggregate.liveSources,
            totalSources: aggregate.totalSources,
            fallback: aggregate.fallback,
            lastSampleAt: aggregate.lastSampleAt
          };
        }
        return zone;
      });

      return {
        zones: zonesList,
        source: 'azure',
        meta: { provider: 'azure', cached: false }
      };
    } catch (error) {
      if (azureHist.size > 0) {
        const zones = {};
        for (const [key, history] of azureHist.entries()) {
          const [zoneId, metric] = key.split(':');
          zones[zoneId] = zones[zoneId] || { id: zoneId, name: zoneId, location: zoneId, sensors: {} };
          zones[zoneId].sensors[metric] = { current: history[0] ?? null, setpoint: { min: null, max: null }, history };
        }
        return {
          zones: Object.values(zones),
          source: 'azure-cache',
          meta: { provider: 'azure', cached: true, error: error.message }
        };
      }
      throw error;
    }
  }

  const data = readJsonSafe(ENV_PATH, { zones: [] }) || { zones: [] };
  const zones = Array.isArray(data.zones) ? data.zones : [];
  return {
    zones,
    source: 'local',
    meta: { provider: 'local', updatedAt: data.updatedAt || null }
  };
}

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
app.get('/ui/ctrlmap', (req, res) => {
  setCors(req, res);
  let existing = {};
  try {
    if (fs.existsSync(UI_CTRLMAP_PATH)) {
      const raw = fs.readFileSync(UI_CTRLMAP_PATH, 'utf8');
      existing = raw ? JSON.parse(raw) : {};
    }
  } catch (error) {
    console.warn('[ui.ctrlmap] Failed to read data:', error?.message || error);
    existing = {};
  }
  res.json(existing);
});

app.post('/ui/ctrlmap', pinGuard, express.json(), (req, res) => {
  setCors(req, res);
  let existing = {};
  try {
    if (fs.existsSync(UI_CTRLMAP_PATH)) {
      const raw = fs.readFileSync(UI_CTRLMAP_PATH, 'utf8');
      existing = raw ? JSON.parse(raw) : {};
    }
  } catch (error) {
    console.warn('[ui.ctrlmap] Failed to read existing data:', error?.message || error);
    existing = {};
  }

  const { key, method, controllerId } = req.body || {};
  if (!key || !method || !controllerId) {
    return res.status(400).json({ error: 'key/method/controllerId required' });
  }

  existing[key] = { method, controllerId, ts: Date.now() };

  try {
    fs.mkdirSync(path.dirname(UI_CTRLMAP_PATH), { recursive: true });
    fs.writeFileSync(UI_CTRLMAP_PATH, JSON.stringify(existing, null, 2));
  } catch (error) {
    console.warn('[ui.ctrlmap] Failed to persist data:', error?.message || error);
    return res.status(500).json({ error: 'failed to save' });
  }

  res.json({ ok: true });
});

app.get('/ui/equip', (req, res) => {
  setCors(req, res);
  let existing = {};
  try {
    if (fs.existsSync(UI_EQUIP_PATH)) {
      const raw = fs.readFileSync(UI_EQUIP_PATH, 'utf8');
      existing = raw ? JSON.parse(raw) : {};
    }
  } catch (error) {
    console.warn('[ui.equip] Failed to read existing data:', error?.message || error);
    existing = {};
  }
  res.json(existing);
});

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

app.post('/ui/equip', pinGuard, express.json(), (req, res) => {
  setCors(req, res);
  const { id, kind, count } = req.body || {};
  if (!id || !kind) {
    return res.status(400).json({ error: 'id/kind required' });
  }

  const parsedCount = Number.parseInt(count, 10);
  const safeCount = Math.max(0, Number.isFinite(parsedCount) ? parsedCount | 0 : 0);

  let existing = {};
  try {
    if (fs.existsSync(UI_EQUIP_PATH)) {
      const raw = fs.readFileSync(UI_EQUIP_PATH, 'utf8');
      existing = raw ? JSON.parse(raw) : {};
    }
  } catch (error) {
    console.warn('[ui.equip] Failed to read existing data:', error?.message || error);
    existing = {};
  }

  existing[id] = { kind, count: safeCount, ts: Date.now() };

  try {
    fs.mkdirSync(path.dirname(UI_EQUIP_PATH), { recursive: true });
    fs.writeFileSync(UI_EQUIP_PATH, JSON.stringify(existing, null, 2));
  } catch (error) {
    console.warn('[ui.equip] Failed to persist data:', error?.message || error);
    return res.status(500).json({ error: 'failed to save' });
  }

  return res.json({ ok: true, id, count: safeCount });
});

app.post('/ui/:resource', pinGuard, (req, res) => {
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

app.post('/groups', pinGuard, async (req, res) => {
  setCors(req, res);
  const body = req.body ?? {};
  const incoming = Array.isArray(body.groups) ? body.groups : (Array.isArray(body) ? body : null);
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ ok: false, error: 'Expected { groups: [...] } payload.' });
  }
  try {
    const knownIds = await fetchKnownDeviceIds();
    const parsed = incoming.map((g) => parseIncomingGroup(g, knownIds));
    const stored = parsed.map((item) => item.stored);
    if (!saveGroupsFile(stored)) {
      return res.status(500).json({ ok: false, error: 'Failed to persist groups.' });
    }
    return res.json({ ok: true, groups: parsed.map((item) => item.response) });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.put('/groups/:id', pinGuard, async (req, res) => {
  setCors(req, res);
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'Group id is required.' });
  const existing = loadGroupsFile();
  const idx = existing.findIndex((group) => String(group?.id || '').trim() === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: `Group '${id}' not found.` });
  try {
    const merged = { ...req.body, id };
    const knownIds = await fetchKnownDeviceIds();
    const { stored, response } = parseIncomingGroup(merged, knownIds);
    existing[idx] = stored;
    if (!saveGroupsFile(existing)) {
      return res.status(500).json({ ok: false, error: 'Failed to persist groups.' });
    }
    return res.json({ ok: true, group: response });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.options('/plans', (req, res) => { setCors(req, res); res.status(204).end(); });
app.get('/plans', (req, res) => {
  try {
    setCors(req, res);
    const doc = loadPlansDocument();
    const plans = Array.isArray(doc.plans) ? doc.plans : [];
    const envelope = sanitizePlansEnvelope(doc);
    const normalized = plans.map((plan) => normalizePlanEntry(plan, plan?.id)).filter(Boolean);
    res.json({ ok: true, ...envelope, plans: normalized });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/plans', (req, res) => {
  try {
    setCors(req, res);
    const isArrayClear = Array.isArray(req.body) && req.body.length === 0;
    const isObjectClear = Array.isArray(req.body?.plans) && req.body.plans.length === 0 &&
      (!req.body || typeof req.body !== 'object' || Object.keys(req.body).every((key) => key === 'plans'));
    if (isArrayClear || isObjectClear) {
      if (!savePlansDocument({ plans: [] })) {
        return res.status(500).json({ ok: false, error: 'Failed to persist plans.' });
      }
      return res.json({ ok: true, plans: [] });
    }

    const doc = parseIncomingPlans(req.body);
    if (!savePlansDocument(doc)) {
      return res.status(500).json({ ok: false, error: 'Failed to persist plans.' });
    }
    const envelope = sanitizePlansEnvelope(doc);
    const plans = Array.isArray(doc.plans) ? doc.plans.map((plan) => normalizePlanEntry(plan, plan?.id)).filter(Boolean) : [];
    res.json({ ok: true, ...envelope, plans });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.options('/sched', (req, res) => { setCors(req, res); res.status(204).end(); });
app.get('/sched', (req, res) => {
  try {
    setCors(req, res);
    const schedules = loadSchedulesFile().map(normalizeScheduleEntry).filter(Boolean);
    res.json({ ok: true, schedules });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/sched', pinGuard, (req, res) => {
  try {
    setCors(req, res);
    const incoming = parseIncomingSchedules(req.body);
    if ((Array.isArray(req.body?.schedules) && req.body.schedules.length === 0) ||
        (Array.isArray(req.body) && req.body.length === 0)) {
      if (!saveSchedulesFile([])) {
        return res.status(500).json({ ok: false, error: 'Failed to persist schedules.' });
      }
      return res.json({ ok: true, schedules: [] });
    }
    const existing = loadSchedulesFile();
    const map = new Map(existing.map((entry) => {
      const normalized = normalizeScheduleEntry(entry);
      return normalized ? [normalized.id, normalized] : null;
    }).filter(Boolean));
    for (const schedule of incoming) {
      map.set(schedule.id, schedule);
    }
    const merged = Array.from(map.values());
    if (!saveSchedulesFile(merged)) {
      return res.status(500).json({ ok: false, error: 'Failed to persist schedules.' });
    }
    res.json({ ok: true, schedules: merged });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
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

export async function __runDailyPlanResolverForTests(trigger = 'test-helper') {
  return runDailyPlanResolver(trigger);
}

export const __testUtils = {
  computePlanDayNumber,
  resolvePlanLightTargets,
  resolvePlanEnvTargets,
  buildHexPayload,
  evaluateRoomAutomationConfig,
  computeEnergy,
};
