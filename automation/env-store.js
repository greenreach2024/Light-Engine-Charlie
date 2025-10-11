import path from 'path';
import { readJsonFileSync, writeJsonFileSync, ensureDirSync } from './utils/file-storage.js';

const DEFAULT_ENV_STATE = {
  scopes: {},
  targets: {},
  rooms: {},
  updatedAt: null
};

function nowIso() {
  return new Date().toISOString();
}

export default class EnvStore {
  constructor(options = {}) {
    const {
      dataDir = path.resolve('./data/automation'),
      fileName = 'env-state.json'
    } = options;

    this.dataDir = dataDir;
    this.filePath = path.join(this.dataDir, fileName);
    ensureDirSync(this.dataDir);
    this.state = readJsonFileSync(this.filePath, { ...DEFAULT_ENV_STATE });
    if (!this.state.updatedAt) {
      this.state.updatedAt = nowIso();
    }
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  getScopeIds() {
    return Object.keys(this.state.scopes || {});
  }

  getScope(scopeId) {
    return JSON.parse(JSON.stringify(this.state.scopes?.[scopeId] || {}));
  }

  upsertScope(scopeId, payload = {}) {
    if (!scopeId) return this.getScope(scopeId);
    const existing = this.state.scopes?.[scopeId] || {};
    const next = {
      ...existing,
      ...payload,
      sensors: {
        ...(existing.sensors || {}),
        ...(payload.sensors || {})
      },
      updatedAt: nowIso()
    };
    this.state.scopes = {
      ...(this.state.scopes || {}),
      [scopeId]: next
    };
    this.state.updatedAt = nowIso();
    this.persist();
    return this.getScope(scopeId);
  }

  updateSensor(scopeId, sensorType, reading) {
    if (!scopeId || !sensorType) return;
    const scope = this.state.scopes?.[scopeId] || { sensors: {} };
    const sensors = { ...(scope.sensors || {}) };
    sensors[sensorType] = {
      value: reading?.value ?? reading,
      unit: reading?.unit || sensors[sensorType]?.unit || null,
      observedAt: reading?.observedAt || nowIso(),
      meta: reading?.meta || null
    };
    this.state.scopes = {
      ...(this.state.scopes || {}),
      [scopeId]: {
        ...scope,
        sensors,
        updatedAt: nowIso()
      }
    };
    this.state.updatedAt = nowIso();
    this.persist();
    return this.getScope(scopeId);
  }

  setTargets(scopeId, targets = {}) {
    if (!scopeId) return;
    const existing = this.state.targets?.[scopeId] || {};
    this.state.targets = {
      ...(this.state.targets || {}),
      [scopeId]: {
        ...existing,
        ...targets,
        updatedAt: nowIso()
      }
    };
    this.state.updatedAt = nowIso();
    this.persist();
    return JSON.parse(JSON.stringify(this.state.targets[scopeId]));
  }

  getTargets(scopeId) {
    return JSON.parse(JSON.stringify(this.state.targets?.[scopeId] || {}));
  }

  listRooms() {
    const rooms = this.state.rooms || {};
    return Object.values(rooms).map((room) => JSON.parse(JSON.stringify(room)));
  }

  getRoom(roomId) {
    if (!roomId) return null;
    const room = this.state.rooms?.[roomId];
    return room ? JSON.parse(JSON.stringify(room)) : null;
  }

  upsertRoom(roomId, payload = {}) {
    if (!roomId) return null;
    const existing = this.state.rooms?.[roomId] || {};

    const mergeActuatorList = (next = [], prev = []) => {
      const list = Array.isArray(next) ? next : [];
      const existingList = Array.isArray(prev) ? prev : [];
      const merged = [...existingList, ...list].map((value) => String(value));
      return Array.from(new Set(merged));
    };

    const existingActuators = existing.actuators || {};

    const next = {
      roomId,
      name: payload.name || existing.name || roomId,
      targets: {
        ...(existing.targets || {}),
        ...(payload.targets || {})
      },
      control: {
        enable: existing.control?.enable ?? false,
        mode: existing.control?.mode || 'advisory',
        step: existing.control?.step ?? 0.05,
        dwell: existing.control?.dwell ?? 180,
        ...(payload.control || {})
      },
      sensors: {
        ...(existing.sensors || {}),
        ...(payload.sensors || {})
      },
      actuators: {
        ...existingActuators,
        lights: mergeActuatorList(payload.actuators?.lights, existingActuators?.lights),
        fans: mergeActuatorList(payload.actuators?.fans, existingActuators?.fans),
        dehu: mergeActuatorList(payload.actuators?.dehu, existingActuators?.dehu),
        ...(payload.actuators || {})
      },
      meta: {
        ...(existing.meta || {}),
        ...(payload.meta || {})
      },
      updatedAt: nowIso()
    };

    this.state.rooms = {
      ...(this.state.rooms || {}),
      [roomId]: next
    };
    this.state.updatedAt = nowIso();
    this.persist();
    return JSON.parse(JSON.stringify(next));
  }

  removeRoom(roomId) {
    if (!roomId || !this.state.rooms?.[roomId]) return false;
    const nextRooms = { ...(this.state.rooms || {}) };
    delete nextRooms[roomId];
    this.state.rooms = nextRooms;
    this.state.updatedAt = nowIso();
    this.persist();
    return true;
  }

  persist() {
    writeJsonFileSync(this.filePath, this.state);
  }
}
