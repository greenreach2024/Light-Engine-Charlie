import PreAutomationEngine from './engine.js';
import EnvStore from './env-store.js';
import RulesStore from './rules-store.js';
import PlugRegistry from './plug-registry.js';
import AutomationLogger from './logger.js';
import PlugManager from './plug-manager.js';

export function createPreAutomationLayer(options = {}) {
  const envStore = options.envStore || new EnvStore(options);
  const rulesStore = options.rulesStore || new RulesStore(options);
  const registry = options.registry || new PlugRegistry(options);
  const logger = options.logger || new AutomationLogger(options);
  const plugManager = options.plugManager || new PlugManager({ registry, logger });

  const engine = new PreAutomationEngine({
    ...options,
    envStore,
    rulesStore,
    registry,
    logger,
    plugManager
  });

  if (options.autoStart !== false) {
    engine.start();
  }

  return {
    engine,
    envStore,
    rulesStore,
    registry,
    logger,
    plugManager
  };
}

export default PreAutomationEngine;
