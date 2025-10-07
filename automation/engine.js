import EnvStore from './env-store.js';
import RulesStore from './rules-store.js';
import PlugRegistry from './plug-registry.js';
import AutomationLogger from './logger.js';
import PlugManager from './plug-manager.js';

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function evaluateComparison(operator, actual, expected) {
  if (expected === undefined || expected === null) return true;
  switch (operator) {
    case 'gt':
      return actual > expected;
    case 'gte':
      return actual >= expected;
    case 'lt':
      return actual < expected;
    case 'lte':
      return actual <= expected;
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'between':
      return Array.isArray(expected) && expected.length === 2
        ? actual >= expected[0] && actual <= expected[1]
        : true;
    default:
      return true;
  }
}

function evaluateWhenClause(whenClause, env) {
  if (!whenClause) return false;
  return Object.entries(whenClause).every(([key, conditions]) => {
    const reading = env?.sensors?.[key]?.value;
    if (reading === undefined || reading === null) return false;
    if (conditions === null) return true;
    if (typeof conditions !== 'object') {
      return reading === conditions;
    }
    return Object.entries(conditions).every(([operator, expected]) =>
      evaluateComparison(operator, reading, expected)
    );
  });
}

function isFresh(env, freshnessMs) {
  if (!freshnessMs) return true;
  const updatedAt = env?.updatedAt || env?.sensorsUpdatedAt;
  if (!updatedAt) return false;
  const ts = typeof updatedAt === 'number' ? updatedAt : Date.parse(updatedAt);
  if (!ts) return false;
  return Date.now() - ts <= freshnessMs;
}

function normalizeAction(action) {
  if (!action) return null;
  return {
    plugId: action.plugId,
    set: action.set || (action.on ? (action.on ? 'on' : 'off') : undefined),
    on: action.on,
    level: action.level ?? action.pct ?? null
  };
}

export default class PreAutomationEngine {
  constructor(options = {}) {
    const {
      dataDir,
      intervalMs = 15000,
      guardrailDefaults = { freshnessMs: 60000 }
    } = options;

    this.envStore = options.envStore || new EnvStore({ dataDir });
    this.rulesStore = options.rulesStore || new RulesStore({ dataDir });
    this.registry = options.registry || new PlugRegistry({ dataDir });
    this.logger = options.logger || new AutomationLogger({ dataDir });
    this.plugManager = options.plugManager || new PlugManager({ registry: this.registry, logger: this.logger });

    this.intervalMs = intervalMs;
    this.guardrailDefaults = guardrailDefaults;
    this.timer = null;
    this.guardState = new Map(); // plugId -> { lastChange, onEvents: [] }
    this.activeRules = new Map(); // scopeId -> { ruleId, executedAt, actions }
  }

  getActiveRule(scopeId) {
    return this.activeRules.get(scopeId) || null;
  }

  getActiveRules() {
    return Array.from(this.activeRules.entries()).map(([scopeId, payload]) => ({ scopeId, ...payload }));
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        console.warn('[automation] Control loop tick failed:', error.message);
      });
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getEnvSnapshot() {
    return this.envStore.getSnapshot();
  }

  ingestSensor(scopeId, sensorType, reading) {
    return this.envStore.updateSensor(scopeId, sensorType, reading);
  }

  setTargets(scopeId, targets) {
    return this.envStore.setTargets(scopeId, targets);
  }

  listRules() {
    return this.rulesStore.list();
  }

  upsertRule(rule) {
    const saved = this.rulesStore.upsert(rule);
    return saved;
  }

  removeRule(ruleId) {
    return this.rulesStore.remove(ruleId);
  }

  setRuleEnabled(ruleId, enabled) {
    return this.rulesStore.setEnabled(ruleId, enabled);
  }

  assignPlug(ruleId, plugId, actionConfig) {
    return this.rulesStore.assignPlug(ruleId, plugId, actionConfig);
  }

  removePlugAssignment(ruleId, plugId) {
    return this.rulesStore.removePlugFromRule(ruleId, plugId);
  }

  listPlugs() {
    return this.plugManager.discoverAll();
  }

  registerPlug(definition) {
    const saved = this.registry.upsert(definition);
    this.plugManager.refreshManualAssignments();
    return saved;
  }

  unregisterPlug(plugId) {
    const removed = this.registry.remove(plugId);
    this.plugManager.refreshManualAssignments();
    return removed;
  }

  async setPlugState(plugId, on) {
    const state = await this.plugManager.setPowerState(plugId, on);
    return state;
  }

  recordGuardEvent(plugId, on) {
    if (!plugId) return;
    const now = Date.now();
    const entry = this.guardState.get(plugId) || { lastChange: 0, onEvents: [] };
    entry.lastChange = now;
    if (on) {
      entry.onEvents.push(now);
      entry.onEvents = entry.onEvents.filter((ts) => now - ts <= 3600000);
    }
    this.guardState.set(plugId, entry);
  }

  guardAllows(action, guardrails = {}) {
    const merged = { ...this.guardrailDefaults, ...guardrails };
    const plugId = action.plugId;
    const desired = action.set === 'off' ? false : action.set === 'on' ? true : Boolean(action.on);
    const entry = this.guardState.get(plugId) || { lastChange: 0, onEvents: [] };

    if (merged.minHoldSec) {
      const elapsed = (Date.now() - entry.lastChange) / 1000;
      if (elapsed < merged.minHoldSec) {
        return { allowed: false, reason: 'minHoldSec' };
      }
    }

    if (desired && merged.maxOnPerHour) {
      const onEvents = entry.onEvents.filter((ts) => Date.now() - ts <= 3600000);
      if (onEvents.length >= merged.maxOnPerHour) {
        return { allowed: false, reason: 'maxOnPerHour' };
      }
    }

    return { allowed: true };
  }

  async tick() {
    const scopeIds = this.envStore.getScopeIds();
    const rules = this.rulesStore.listEnabled();

    for (const scopeId of scopeIds) {
      const env = this.envStore.getScope(scopeId);
      if (!isFresh(env, this.guardrailDefaults.freshnessMs)) {
        continue;
      }

      const scopeRules = rules.filter((rule) => {
        const ruleScope = rule.scope || {};
        return !ruleScope?.room || ruleScope.room === scopeId || ruleScope.scope === scopeId;
      });

      const matched = scopeRules.find((rule) => evaluateWhenClause(rule.when, env));
      if (!matched) continue;

      const actions = ensureArray(matched.actions).map(normalizeAction).filter(Boolean);
      if (!actions.length) continue;

      const pre = await this.plugManager.snapshot(actions);

      const guardDecisions = actions.map((action) => ({
        action,
        decision: this.guardAllows(action, matched.guardrails)
      }));
      const actionable = guardDecisions.filter((item) => item.decision.allowed).map((item) => item.action);
      const skipped = guardDecisions.filter((item) => !item.decision.allowed).map((item) => ({
        ...item.action,
        reason: item.decision.reason
      }));

      const results = await this.plugManager.apply(actionable);
      for (const action of actionable) {
        const desired = action.set === 'off' ? false : action.set === 'on' ? true : Boolean(action.on);
        this.recordGuardEvent(action.plugId, desired);
      }

      const post = await this.plugManager.snapshot(actions);
      const envAfter = this.envStore.getScope(scopeId);

      const success = results.some((result) => result.success);

      if (success) {
        this.activeRules.set(scopeId, {
          ruleId: matched.id,
          executedAt: Date.now(),
          actions: results
        });
      } else {
        this.activeRules.delete(scopeId);
      }

      this.logger.log({
        ts: Date.now(),
        scope: scopeId,
        ruleId: matched.id,
        actions,
        executed: results,
        skipped,
        envBefore: env,
        envAfter,
        pre,
        post
      });
    }
  }
}
