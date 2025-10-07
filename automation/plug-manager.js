import ShellyPlugDriver from './drivers/shelly-driver.js';
import KasaPlugDriver from './drivers/kasa-driver.js';

function normalizeAction(action) {
  if (!action) return null;
  const payload = { ...action };
  if (typeof payload.set === 'string') {
    payload.set = payload.set.toLowerCase();
  }
  return payload;
}

export default class PlugManager {
  constructor({ registry, logger } = {}) {
    this.registry = registry;
    this.logger = logger;
    this.drivers = new Map();

    this.registerDriver(new ShellyPlugDriver());
    this.registerDriver(new KasaPlugDriver());

    this.refreshManualAssignments();
  }

  registerDriver(driver) {
    if (!driver) return;
    this.drivers.set(driver.vendor(), driver);
  }

  refreshManualAssignments() {
    if (!this.registry) return;
    const plugs = this.registry.list();
    const byVendor = plugs.reduce((acc, plug) => {
      const vendor = plug.vendor;
      if (!acc[vendor]) acc[vendor] = [];
      acc[vendor].push(plug);
      return acc;
    }, {});
    for (const [vendor, devices] of Object.entries(byVendor)) {
      const driver = this.drivers.get(vendor);
      if (driver?.syncManualDefinitions) {
        driver.syncManualDefinitions(devices);
      }
    }
  }

  async discoverAll() {
    const results = [];
    for (const driver of this.drivers.values()) {
      try {
        const plugs = await driver.discover();
        results.push(...plugs);
      } catch (error) {
        console.warn(`[automation] ${driver.vendor()} discovery failed:`, error.message);
      }
    }
    return this.mergeWithRegistry(results);
  }

  mergeWithRegistry(discoveredPlugs) {
    const manualPlugs = this.registry ? this.registry.list() : [];
    const combined = new Map();
    for (const plug of discoveredPlugs) {
      combined.set(plug.id, plug);
    }
    for (const manual of manualPlugs) {
      if (!combined.has(manual.id)) {
        combined.set(manual.id, {
          id: manual.id,
          vendor: manual.vendor,
          name: manual.name,
          model: manual.model,
          source: 'manual',
          connection: manual.connection,
          state: { online: false, on: false, powerW: null },
          capabilities: { dimmable: false, powerMonitoring: false }
        });
      }
    }
    return Array.from(combined.values());
  }

  async getState(plugId) {
    const driver = this.getDriverForPlug(plugId);
    if (!driver) throw new Error(`Driver not found for ${plugId}`);
    const state = await driver.getState(plugId);
    return state;
  }

  getDriverForPlug(plugId) {
    const vendor = plugId.split(':')[1];
    return this.drivers.get(vendor);
  }

  async setPowerState(plugId, on) {
    const driver = this.getDriverForPlug(plugId);
    if (!driver) throw new Error(`Driver not found for ${plugId}`);
    const state = await driver.setOn(plugId, on);
    return state;
  }

  async readPower(plugId) {
    const driver = this.getDriverForPlug(plugId);
    if (!driver?.readPower) return null;
    return driver.readPower(plugId);
  }

  async snapshot(actions = []) {
    const uniquePlugIds = Array.from(new Set(actions.map((action) => normalizeAction(action)?.plugId).filter(Boolean)));
    const snapshot = {};
    for (const plugId of uniquePlugIds) {
      try {
        snapshot[plugId] = await this.getState(plugId);
      } catch (error) {
        snapshot[plugId] = { error: error.message, online: false };
      }
    }
    return snapshot;
  }

  async apply(actions = []) {
    const results = [];
    for (const action of actions.map(normalizeAction)) {
      if (!action?.plugId) continue;
      const desired = action.set === 'off' ? false : action.set === 'on' ? true : Boolean(action.on ?? action.state);
      try {
        const state = await this.setPowerState(action.plugId, desired);
        results.push({ plugId: action.plugId, success: true, state });
      } catch (error) {
        console.warn(`[automation] Failed to set ${action.plugId}:`, error.message);
        results.push({ plugId: action.plugId, success: false, error: error.message });
      }
    }
    return results;
  }
}
