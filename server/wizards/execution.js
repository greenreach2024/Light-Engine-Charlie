// Enhanced Wizard Execution Engine with Discovery Context Integration
import { 
  SETUP_WIZARDS, 
  mergeDiscoveryContext, 
  calculateWizardConfidence,
  WizardStateManager 
} from './index.js';

// Initialize shared wizard state manager (singleton-like)
globalThis.__wizardStateManager = globalThis.__wizardStateManager || new WizardStateManager();
const wizardStateManager = globalThis.__wizardStateManager;

/**
 * Enhanced wizard step validation with discovery context
 */
function validateWizardStepData(wizard, stepId, data, discoveryContext = null) {
  const step = wizard.steps.find(s => s.id === stepId);
  if (!step) {
    throw new Error(`Step ${stepId} not found in wizard ${wizard.id}`);
  }

  // Merge discovery context into step before validation
  const enhancedStep = discoveryContext ? 
    mergeDiscoveryContext(step, discoveryContext) : step;

  const errors = [];
  const processedData = {};

  // Validate each field
  if (enhancedStep.fields) {
    for (const field of enhancedStep.fields) {
      const value = data[field.name];
      
      // Check required fields
      if (field.required && (value === undefined || value === null || value === '')) {
        errors.push(`Field '${field.label}' is required`);
        continue;
      }

      // Skip validation for empty optional fields
      if (!field.required && (value === undefined || value === null || value === '')) {
        continue;
      }

      // Type-specific validation
      switch (field.type) {
        case 'number':
          const num = Number(value);
          if (isNaN(num)) {
            errors.push(`Field '${field.label}' must be a valid number`);
          } else {
            if (field.min !== undefined && num < field.min) {
              errors.push(`Field '${field.label}' must be at least ${field.min}`);
            }
            if (field.max !== undefined && num > field.max) {
              errors.push(`Field '${field.label}' must be at most ${field.max}`);
            }
            processedData[field.name] = num;
          }
          break;

        case 'boolean':
          processedData[field.name] = Boolean(value);
          break;

        case 'url':
          try {
            new URL(value);
            processedData[field.name] = value;
          } catch {
            errors.push(`Field '${field.label}' must be a valid URL`);
          }
          break;

        case 'email':
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(value)) {
            errors.push(`Field '${field.label}' must be a valid email address`);
          } else {
            processedData[field.name] = value;
          }
          break;

        case 'select':
          if (field.options && !field.options.includes(value)) {
            errors.push(`Field '${field.label}' must be one of: ${field.options.join(', ')}`);
          } else {
            processedData[field.name] = value;
          }
          break;

        default:
          // Text fields and others
          if (field.validation) {
            // Custom validation patterns
            if (field.validation.pattern) {
              const regex = new RegExp(field.validation.pattern);
              if (!regex.test(value)) {
                errors.push(field.validation.message || `Field '${field.label}' has invalid format`);
                continue;
              }
            }
            
            // Length validation
            if (field.validation.minLength && value.length < field.validation.minLength) {
              errors.push(`Field '${field.label}' must be at least ${field.validation.minLength} characters`);
              continue;
            }
            if (field.validation.maxLength && value.length > field.validation.maxLength) {
              errors.push(`Field '${field.label}' must be at most ${field.validation.maxLength} characters`);
              continue;
            }
          }
          
          processedData[field.name] = value;
          break;
      }
    }
  } else {
    // For dynamic steps, accept all data as-is
    Object.assign(processedData, data);
  }

  return { 
    isValid: errors.length === 0, 
    errors, 
    data: processedData,
    enhancedStep 
  };
}

/**
 * Enhanced wizard execution with discovery context integration
 */
async function executeWizardStepWithValidation(wizardId, stepId, data, discoveryContext = null) {
  const wizard = SETUP_WIZARDS[wizardId];
  if (!wizard) {
    throw new Error(`Unknown wizard: ${wizardId}`);
  }

  // Get or initialize wizard state
  let wizardState = wizardStateManager.getWizardState(wizardId);
  if (!wizardState) {
    wizardState = wizardStateManager.initializeWizard(wizardId, discoveryContext);
  }

  // Validate step data with discovery context
  const validation = validateWizardStepData(wizard, stepId, data, discoveryContext);
  if (!validation.isValid) {
    wizardState.errors.push(...validation.errors);
    return {
      success: false,
      errors: validation.errors,
      data: {},
      discoveryContext
    };
  }

  // Update wizard state
  wizardStateManager.updateStepData(wizardId, stepId, validation.data);

  // Execute the step with validated data and discovery context
  const executionResult = await executeWizardStep(wizardId, stepId, validation.data, discoveryContext);
  
  // Merge discovery context into result
  if (discoveryContext) {
    executionResult.discoveryContext = discoveryContext;
    executionResult.confidence = calculateWizardConfidence(
      { type: discoveryContext.deviceInfo?.type, port: discoveryContext.port },
      wizard,
      discoveryContext
    );
  }

  return executionResult;
}

/**
 * Enhanced wizard template application with discovery context
 */
async function applyWizardTemplate(templateId, devices, customPresets = {}, discoveryContext = null) {
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
    errors: [],
    discoveryContext
  };
  
  // Find applicable wizards based on devices and discovery context
  for (const wizardConfig of template.wizards) {
    const wizard = SETUP_WIZARDS[wizardConfig.id];
    if (!wizard) {
      results.errors.push(`Wizard not found: ${wizardConfig.id}`);
      continue;
    }
    
    // Check if any devices match this wizard (enhanced with discovery context)
    const applicableDevices = devices.filter(device => {
      const baseConfidence = calculateWizardConfidence(device, wizard);
      const contextualConfidence = discoveryContext ? 
        calculateWizardConfidence(device, wizard, discoveryContext) : baseConfidence;
      
      return Math.max(baseConfidence, contextualConfidence) > 50;
    });
    
    if (applicableDevices.length > 0) {
      const wizardEntry = {
        wizardId: wizardConfig.id,
        priority: wizardConfig.priority,
        autoExecute: wizardConfig.autoExecute,
        applicableDevices: applicableDevices.length,
        devices: applicableDevices,
        confidence: Math.max(
          ...applicableDevices.map(device => 
            calculateWizardConfidence(device, wizard, discoveryContext)
          )
        )
      };
      
      results.applicableWizards.push(wizardEntry);
      
      // Auto-execute if configured
      if (wizardConfig.autoExecute) {
        try {
          // Apply presets merged with discovery context
          const presets = { ...template.presets[wizardConfig.id], ...customPresets[wizardConfig.id] };
          
          // Enhance presets with discovery context
          if (discoveryContext) {
            for (const [stepId, stepData] of Object.entries(presets)) {
              const enhancedData = mergeDiscoveryContextIntoStepData(stepData, discoveryContext);
              await executeWizardStepWithValidation(wizardConfig.id, stepId, enhancedData, discoveryContext);
            }
          } else {
            for (const [stepId, stepData] of Object.entries(presets)) {
              await executeWizardStepWithValidation(wizardConfig.id, stepId, stepData);
            }
          }
          
          results.autoExecuted.push({
            wizardId: wizardConfig.id,
            executedAt: new Date().toISOString(),
            discoveryContext: discoveryContext ? {
              ip: discoveryContext.ip,
              hostname: discoveryContext.hostname,
              confidence: discoveryContext.confidence
            } : null
          });
          
        } catch (error) {
          results.errors.push(`Auto-execution failed for ${wizardConfig.id}: ${error.message}`);
        }
      }
    }
  }
  
  // Sort by confidence and priority
  results.applicableWizards.sort((a, b) => {
    if (a.confidence !== b.confidence) {
      return b.confidence - a.confidence; // Higher confidence first
    }
    return a.priority - b.priority; // Lower priority number first
  });
  
  return results;
}

/**
 * Helper function to merge discovery context into step data
 */
function mergeDiscoveryContextIntoStepData(stepData, discoveryContext) {
  const enhancedData = { ...stepData };
  
  // Auto-populate common fields from discovery context
  if (discoveryContext.ip && !enhancedData.host) {
    enhancedData.host = discoveryContext.ip;
  }
  
  if (discoveryContext.hostname && !enhancedData.hostname) {
    enhancedData.hostname = discoveryContext.hostname;
  }
  
  if (discoveryContext.detectedServices && !enhancedData.port) {
    // Use the first detected service port if not specified
    const firstService = discoveryContext.detectedServices[0];
    if (firstService) {
      enhancedData.port = firstService.port;
    }
  }
  
  if (discoveryContext.deviceInfo?.name && !enhancedData.deviceName) {
    enhancedData.deviceName = discoveryContext.deviceInfo.name;
  }
  
  if (discoveryContext.deviceInfo?.type && !enhancedData.deviceType) {
    enhancedData.deviceType = discoveryContext.deviceInfo.type;
  }
  
  if (discoveryContext.webInterface?.url && !enhancedData.deviceUrl) {
    enhancedData.deviceUrl = discoveryContext.webInterface.url;
  }
  
  return enhancedData;
}

/**
 * Device-specific wizard step execution (enhanced)
 */
async function executeDeviceSpecificStep(wizardId, stepId, data, discoveryContext = null) {
  console.log(`🔧 Executing device-specific step: ${wizardId}/${stepId}`);
  
  const baseResult = { 
    success: true, 
    data: {}, 
    deviceSpecific: true,
    discoveryContext 
  };
  
  switch (wizardId) {
    case 'farm-setup':
      return await executeFarmWizardStep(stepId, data, discoveryContext);
    case 'mqtt-setup':
      return await executeMQTTWizardStep(stepId, data, discoveryContext);
    case 'modbus-setup':
      return await executeModbusWizardStep(stepId, data, discoveryContext);
    case 'kasa-setup':
      return await executeKasaWizardStep(stepId, data, discoveryContext);
    case 'switchbot-setup':
      return await executeSwitchBotWizardStep(stepId, data, discoveryContext);
    case 'sensor-hub-setup':
      return await executeSensorHubWizardStep(stepId, data, discoveryContext);
    case 'web-device-setup':
      return await executeWebDeviceWizardStep(stepId, data, discoveryContext);
    default:
      return { ...baseResult, deviceSpecific: false };
  }
}
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DATA_DIR = path.resolve(__dirname, '../../public/data');
const FARM_JSON_PATH = path.join(PUBLIC_DATA_DIR, 'farm.json');

function readFarmJsonSafe() {
  try {
    const raw = fs.readFileSync(FARM_JSON_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { rooms: [], locations: [], branding: { palette: {} } };
  }
}

function writeFarmJsonSafe(data) {
  fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });
  fs.writeFileSync(FARM_JSON_PATH, JSON.stringify(data, null, 2));
}

async function executeFarmWizardStep(stepId, data) {
  const farm = readFarmJsonSafe();

  switch (stepId) {
  case 'farm-identity': {
      farm.farmName = data.farmName;
      farm.name = data.farmName || farm.name || '';
      if (data.tagline !== undefined) farm.tagline = data.tagline;
      if (data.logo) farm.logo = data.logo;
      farm.branding = farm.branding || { palette: {} };
      writeFarmJsonSafe(farm);
      return { success: true, data: { saved: true, farmName: farm.farmName }, nextStep: 'farm-branding' };
    }
    case 'farm-location': {
      farm.address = data.address;
      farm.city = data.city;
      farm.state = data.state;
      farm.postalCode = data.postalCode;
      farm.timezone = data.timezone;
      farm.coordinates = farm.coordinates || {};
      if (typeof data.lat === 'number') farm.coordinates.lat = data.lat;
      if (typeof data.lng === 'number') farm.coordinates.lng = data.lng;
      writeFarmJsonSafe(farm);
      return { success: true, data: { saved: true }, nextStep: 'farm-rooms' };
    }
    case 'farm-wifi': {
      farm.connection = farm.connection || {};
      const type = data.connectionType || 'wifi';
      farm.connection.type = type;
      if (type === 'wifi') {
        farm.connection.wifi = farm.connection.wifi || {};
        if (data.ssid) farm.connection.wifi.ssid = data.ssid;
        if (typeof data.reuseDiscovery === 'boolean') farm.connection.wifi.reuseDiscovery = data.reuseDiscovery;
        // Simulate a connection test
        if (data.testConnection) {
          farm.connection.wifi.tested = true;
          farm.connection.wifi.testResult = {
            status: 'connected',
            ip: '192.168.1.120',
            gateway: '192.168.1.1',
            testedAt: new Date().toISOString()
          };
        }
      }
      writeFarmJsonSafe(farm);
      return { success: true, data: { saved: true }, nextStep: 'farm-contact' };
    }
  case 'farm-rooms': {
      const roomName = data.roomName;
      const zones = String(data.zonesCsv || '')
        .split(',')
        .map(z => z.trim())
        .filter(Boolean);
      farm.rooms = farm.rooms || [];
      const id = `room-${Math.random().toString(36).slice(2, 10)}`;
      farm.rooms.push({ id, name: roomName, zones });
      farm.locations = Array.from(new Set([...(farm.locations || []), roomName]));
      writeFarmJsonSafe(farm);
      return { success: true, data: { saved: true, roomId: id, completed: true }, nextStep: undefined };
    }
    case 'farm-branding': {
      farm.branding = farm.branding || { palette: {} };
      const website = data.website || farm.contact?.website || farm.website;
      let primary = (data.fallbackPrimary || '').trim();
      if (primary && !primary.startsWith('#')) primary = `#${primary}`;

      // Try to extract <meta name="theme-color"> from site
      if (website && (!primary || data.preferThemeColor)) {
        try {
          const resp = await fetch(website, { method: 'GET' });
          const html = await resp.text();
          const match = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-fA-F]{3,6})["'][^>]*>/i);
          if (match && match[1]) {
            primary = match[1];
          }
        } catch {}
      }

      if (primary) {
        farm.branding.palette = farm.branding.palette || {};
        farm.branding.palette.primary = primary;
      }
      if (data.website) farm.contact = { ...(farm.contact || {}), website: data.website };
      writeFarmJsonSafe(farm);
      return { success: true, data: { saved: true }, nextStep: 'farm-location' };
    }
  case 'farm-contact': {
      farm.contact = farm.contact || {};
      farm.contact.name = data.name;
      farm.contact.email = data.email;
      if (data.phone !== undefined) farm.contact.phone = data.phone;
      if (data.website !== undefined) farm.contact.website = data.website;
      farm.registered = farm.registered || new Date().toISOString();
      writeFarmJsonSafe(farm);
      return { success: true, data: { saved: true }, nextStep: 'farm-identity' };
    }
    default:
      return { success: true, data: {} };
  }
}

/**
 * Enhanced device-specific step executors
 */

async function executeMQTTWizardStep(stepId, data, discoveryContext = null) {
  switch (stepId) {
    case 'broker-connection':
      try {
        console.log(`🔗 Testing MQTT connection to ${data.host}:${data.port}`);
        
        // Enhanced connection with discovery context
        const connectionConfig = {
          host: data.host,
          port: data.port,
          secure: data.secure || false,
          username: data.username,
          password: data.password
        };
        
        // Use discovery context to enhance connection
        if (discoveryContext?.detectedServices) {
          const mqttService = discoveryContext.detectedServices.find(s => 
            s.protocol === 'mqtt' || s.name.includes('mqtt')
          );
          if (mqttService) {
            connectionConfig.serviceInfo = mqttService;
          }
        }
        
        // Simulate connection test (in real implementation, use mqtt.js)
        const connectionResult = {
          connected: true,
          broker: `${data.host}:${data.port}`,
          secure: data.secure,
          clientId: `lightengine_${Date.now()}`,
          discoveryEnhanced: !!discoveryContext
        };
        
        return {
          success: true,
          data: { connectionResult, config: connectionConfig },
          nextStep: 'topic-discovery',
          discoveryContext
        };
        
      } catch (error) {
        return {
          success: false,
          error: `MQTT connection failed: ${error.message}`,
          data: {},
          discoveryContext
        };
      }
      
    case 'topic-discovery':
      try {
        console.log(`🔍 Discovering MQTT topics with pattern: ${data.baseTopic}`);
        
        // Simulate topic discovery
        const discoveredTopics = [
          'farm/greenhouse1/temperature',
          'farm/greenhouse1/humidity',
          'farm/sensors/soil_moisture',
          'farm/lights/status'
        ];
        
        return {
          success: true,
          data: { discoveredTopics, baseTopic: data.baseTopic },
          nextStep: 'sensor-mapping',
          discoveryContext
        };
        
      } catch (error) {
        return {
          success: false,
          error: `Topic discovery failed: ${error.message}`,
          data: {},
          discoveryContext
        };
      }
      
    default:
      return {
        success: true,
        data: {},
        discoveryContext
      };
  }
}

async function executeKasaWizardStep(stepId, data, discoveryContext = null) {
  switch (stepId) {
    case 'device-discovery':
      try {
        console.log(`🔍 Discovering Kasa devices (timeout: ${data.discoveryTimeout}s)`);
        
        // Enhanced discovery with context
        const discoveryConfig = {
          timeout: data.discoveryTimeout,
          targetIP: data.targetIP,
          broadcastDiscovery: data.broadcastDiscovery
        };
        
        // Use discovery context to enhance search
        if (discoveryContext?.ip) {
          discoveryConfig.knownDevice = {
            ip: discoveryContext.ip,
            hostname: discoveryContext.hostname
          };
        }
        
        // Simulate Kasa device discovery
        const discoveredDevices = [
          {
            ip: discoveryContext?.ip || '192.168.1.100',
            mac: '50:C7:BF:12:34:56',
            alias: discoveryContext?.deviceInfo?.name || 'Smart Plug 1',
            model: 'HS100',
            type: 'plug'
          }
        ];
        
        return {
          success: true,
          data: { 
            discoveredDevices, 
            config: discoveryConfig,
            enhancedByDiscovery: !!discoveryContext
          },
          nextStep: 'device-configuration',
          discoveryContext
        };
        
      } catch (error) {
        return {
          success: false,
          error: `Kasa discovery failed: ${error.message}`,
          data: {},
          discoveryContext
        };
      }
      
    default:
      return {
        success: true,
        data: {},
        discoveryContext
      };
  }
}

async function executeSwitchBotWizardStep(stepId, data, discoveryContext = null) {
  switch (stepId) {
    case 'api-credentials':
      try {
        console.log(`🔑 Validating SwitchBot API credentials`);
        
        // Simulate API validation
        const apiValidation = {
          valid: true,
          token: data.token.substring(0, 8) + '...',
          accountInfo: {
            devices: 5,
            scenes: 3
          }
        };
        
        return {
          success: true,
          data: { apiValidation },
          nextStep: 'device-discovery',
          discoveryContext
        };
        
      } catch (error) {
        return {
          success: false,
          error: `SwitchBot API validation failed: ${error.message}`,
          data: {},
          discoveryContext
        };
      }
      
    default:
      return {
        success: true,
        data: {},
        discoveryContext
      };
  }
}

async function executeWebDeviceWizardStep(stepId, data, discoveryContext = null) {
  switch (stepId) {
    case 'device-identification':
      try {
        console.log(`🌐 Identifying web device at ${data.deviceUrl}`);
        
        // Enhanced identification with discovery context
        const deviceInfo = {
          url: data.deviceUrl,
          type: data.deviceType,
          discoveryEnhanced: !!discoveryContext
        };
        
        if (discoveryContext) {
          deviceInfo.detectedInfo = {
            ip: discoveryContext.ip,
            hostname: discoveryContext.hostname,
            services: discoveryContext.detectedServices
          };
        }
        
        return {
          success: true,
          data: { deviceInfo },
          nextStep: 'authentication',
          discoveryContext
        };
        
      } catch (error) {
        return {
          success: false,
          error: `Device identification failed: ${error.message}`,
          data: {},
          discoveryContext
        };
      }
      
    default:
      return {
        success: true,
        data: {},
        discoveryContext
      };
  }
}

async function executeModbusWizardStep(stepId, data, discoveryContext = null) {
  // Implementation similar to MQTT but for Modbus protocol
  return {
    success: true,
    data: {},
    discoveryContext
  };
}

async function executeSensorHubWizardStep(stepId, data, discoveryContext = null) {
  // Implementation for sensor hub configuration
  return {
    success: true,
    data: {},
    discoveryContext
  };
}

/**
 * Generic wizard step execution with discovery context
 */
async function executeWizardStep(wizardId, stepId, data, discoveryContext = null) {
  // Try device-specific execution first
  const deviceSpecificResult = await executeDeviceSpecificStep(wizardId, stepId, data, discoveryContext);
  
  if (deviceSpecificResult.deviceSpecific) {
    return deviceSpecificResult;
  }
  
  // Generic execution for non-device-specific steps
  console.log(`⚙️ Executing generic wizard step: ${wizardId}/${stepId}`);
  
  return {
    success: true,
    data: data,
    stepId: stepId,
    wizardId: wizardId,
    executedAt: new Date().toISOString(),
    discoveryContext
  };
}

// Wizard template definitions (placeholder - these would be defined in the main server)
const WIZARD_TEMPLATES = {
  'smart-farm-basic': {
    name: 'Smart Farm Basic Setup',
    wizards: [
      { id: 'mqtt-setup', priority: 1, autoExecute: false },
      { id: 'kasa-setup', priority: 2, autoExecute: false },
      { id: 'switchbot-setup', priority: 3, autoExecute: false }
    ],
    presets: {
      'mqtt-setup': {
        'broker-connection': {
          port: 1883,
          secure: false
        }
      }
    }
  }
};

export {
  validateWizardStepData,
  executeWizardStepWithValidation,
  applyWizardTemplate,
  executeWizardStep,
  executeDeviceSpecificStep,
  wizardStateManager,
  WIZARD_TEMPLATES
};