import path from 'path';
import { readJsonFileSync, writeJsonFileSync, ensureDirSync } from './utils/file-storage.js';

const DEFAULT_ENV_STATE = {
  scopes: {},
  targets: {},
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

  persist() {
    writeJsonFileSync(this.filePath, this.state);
  }
}
