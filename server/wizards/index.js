// Wizard System - Shared Step Factories and Discovery Context Integration
// Extracted from server-charlie.js for better modularity and testing

/**
 * Shared Step Factory Functions
 * These factories create reusable wizard steps that can be customized with discovery context
 */

// Factory for broker/connection credential steps
function createBrokerCredentialsStep(options = {}) {
  const {
    stepId = 'broker-connection',
    name = 'Broker Connection',
    description = 'Configure broker connection settings',
    defaultPort = 1883,
    supportsTLS = true,
    protocol = 'MQTT'
  } = options;

  return {
    id: stepId,
    name,
    description,
    fields: [
      { 
        name: 'host', 
        type: 'text', 
        label: `${protocol} Broker Host`, 
        required: true,
        placeholder: 'IP address or hostname'
      },
      { 
        name: 'port', 
        type: 'number', 
        label: 'Port', 
        default: defaultPort, 
        required: true,
        min: 1,
        max: 65535
      },
      ...(supportsTLS ? [{
        name: 'secure', 
        type: 'boolean', 
        label: 'Use TLS/SSL', 
        default: false
      }] : []),
      { 
        name: 'username', 
        type: 'text', 
        label: 'Username (optional)',
        placeholder: 'Leave empty for anonymous access'
      },
      { 
        name: 'password', 
        type: 'password', 
        label: 'Password (optional)'
      }
    ],
    validation: {
      host: { pattern: '^[a-zA-Z0-9.-]+$', message: 'Invalid hostname format' },
      port: { min: 1, max: 65535, message: 'Port must be between 1 and 65535' }
    }
  };
}

// Factory for device discovery steps
function createDeviceDiscoveryStep(options = {}) {
  const {
    stepId = 'device-discovery',
    name = 'Device Discovery',
    description = 'Discover devices on the network',
    defaultTimeout = 30,
    maxTimeout = 300,
    supportsBroadcast = true,
    supportsTargeted = true
  } = options;

  const fields = [
    {
      name: 'discoveryTimeout',
      type: 'number',
      label: 'Discovery Timeout (seconds)',
      default: defaultTimeout,
      min: 5,
      max: maxTimeout,
      required: true
    }
  ];

  if (supportsBroadcast) {
    fields.push({
      name: 'broadcastDiscovery',
      type: 'boolean',
      label: 'Enable Broadcast Discovery',
      default: true
    });
  }

  if (supportsTargeted) {
    fields.push({
      name: 'targetIP',
      type: 'text',
      label: 'Target IP Range (optional)',
      placeholder: '192.168.1.0/24 or specific IP'
    });
  }

  return {
    id: stepId,
    name,
    description,
    fields,
    dynamic: true,
    validation: {
      discoveryTimeout: { min: 5, max: maxTimeout, message: `Timeout must be between 5 and ${maxTimeout} seconds` },
      targetIP: { pattern: '^(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}(/\\d{1,2})?)?$', message: 'Invalid IP address or CIDR notation' }
    }
  };
}

// Factory for device assignment/configuration steps
function createDeviceAssignmentStep(options = {}) {
  const {
    stepId = 'device-assignment',
    name = 'Device Assignment',
    description = 'Assign devices to rooms and equipment',
    includeScheduling = true,
    includeAlerts = true
  } = options;

  const fields = [
    {
      name: 'deviceName',
      type: 'text',
      label: 'Device Name',
      required: true,
      placeholder: 'Friendly name for this device'
    },
    {
      name: 'room',
      type: 'select',
      label: 'Room Assignment',
      required: true,
      options: [], // Will be populated from discovery context
      placeholder: 'Select a room'
    },
    {
      name: 'equipment',
      type: 'select',
      label: 'Equipment Type',
      required: false,
      options: [
        'grow-light',
        'exhaust-fan',
        'intake-fan',
        'heater',
        'cooler',
        'humidifier',
        'dehumidifier',
        'water-pump',
        'nutrient-doser',
        'ph-controller',
        'other'
      ],
      placeholder: 'Select equipment type'
    }
  ];

  if (includeScheduling) {
    fields.push({
      name: 'enableScheduling',
      type: 'boolean',
      label: 'Enable Automated Scheduling',
      default: false
    });
  }

  if (includeAlerts) {
    fields.push({
      name: 'enableAlerts',
      type: 'boolean',
      label: 'Enable Alert Notifications',
      default: true
    });
  }

  return {
    id: stepId,
    name,
    description,
    fields,
    validation: {
      deviceName: { minLength: 2, maxLength: 50, message: 'Device name must be 2-50 characters' },
      room: { required: true, message: 'Room assignment is required' }
    }
  };
}

/**
 * Discovery Context Integration
 * Functions to merge discovery payloads with wizard steps
 */

// Merge discovery context into wizard step defaults
function mergeDiscoveryContext(step, discoveryPayload) {
  if (!discoveryPayload || !step) return step;

  const enhancedStep = JSON.parse(JSON.stringify(step)); // Deep clone
  
  // Enhance fields with discovery context
  enhancedStep.fields = enhancedStep.fields.map(field => {
    const enhancedField = { ...field };
    
    switch (field.name) {
      case 'host':
        if (discoveryPayload.ip) {
          enhancedField.default = discoveryPayload.ip;
          enhancedField.placeholder = `Detected: ${discoveryPayload.ip}`;
        }
        if (discoveryPayload.hostname) {
          enhancedField.alternativeValue = discoveryPayload.hostname;
          enhancedField.hint = `Hostname: ${discoveryPayload.hostname}`;
        }
        break;
        
      case 'port':
        if (discoveryPayload.detectedServices) {
          // Handle array or object services
          const services = Array.isArray(discoveryPayload.detectedServices) 
            ? discoveryPayload.detectedServices 
            : Object.values(discoveryPayload.detectedServices);
          
          const relevantService = services.find(s => 
            s.protocol === step.protocol || s.name?.includes(step.protocol?.toLowerCase())
          );
          if (relevantService) {
            enhancedField.default = relevantService.port;
            enhancedField.placeholder = `Detected service on port ${relevantService.port}`;
          }
        }
        break;
        
      case 'deviceUrl':
        if (discoveryPayload.webInterface) {
          enhancedField.default = discoveryPayload.webInterface.url;
          enhancedField.placeholder = `Detected: ${discoveryPayload.webInterface.url}`;
        }
        break;
        
      case 'deviceType':
        if (discoveryPayload.deviceInfo?.type) {
          enhancedField.default = discoveryPayload.deviceInfo.type;
        }
        break;
        
      case 'deviceName':
        if (discoveryPayload.deviceInfo?.name) {
          enhancedField.default = discoveryPayload.deviceInfo.name;
        } else if (discoveryPayload.hostname) {
          enhancedField.default = discoveryPayload.hostname.replace(/[.-]/g, ' ').trim();
        }
        break;
    }
    
    return enhancedField;
  });
  
  // Add discovery metadata
  enhancedStep.discoveryContext = {
    ip: discoveryPayload.ip,
    hostname: discoveryPayload.hostname,
    confidence: discoveryPayload.confidence || 0,
    detectedServices: discoveryPayload.detectedServices || [],
    deviceInfo: discoveryPayload.deviceInfo || {},
    timestamp: discoveryPayload.timestamp || new Date().toISOString()
  };
  
  return enhancedStep;
}

// Calculate confidence score for wizard applicability
function calculateWizardConfidence(device, wizard, discoveryContext = null) {
  let confidence = 0;
  
  // Base confidence from device type matching
  if (wizard.targetDevices && device.type) {
    const typeMatch = wizard.targetDevices.some(target => 
      device.type.toLowerCase().includes(target.toLowerCase()) ||
      target.toLowerCase().includes(device.type.toLowerCase())
    );
    if (typeMatch) confidence += 40;
  }
  
  // Additional confidence from discovery context
  if (discoveryContext) {
    // Service detection confidence
    if (discoveryContext.detectedServices) {
      const relevantServices = discoveryContext.detectedServices.filter(service => 
        wizard.targetDevices?.some(target => 
          service.name.toLowerCase().includes(target.toLowerCase()) ||
          service.protocol?.toLowerCase().includes(target.toLowerCase())
        )
      );
      confidence += relevantServices.length * 15;
    }
    
    // Device info confidence
    if (discoveryContext.deviceInfo) {
      const { manufacturer, model, type } = discoveryContext.deviceInfo;
      
      if (manufacturer && wizard.targetDevices?.some(target => 
        manufacturer.toLowerCase().includes(target.toLowerCase())
      )) {
        confidence += 20;
      }
      
      if (type && wizard.targetDevices?.some(target => 
        type.toLowerCase().includes(target.toLowerCase())
      )) {
        confidence += 25;
      }
    }
    
    // Web interface detection
    if (discoveryContext.webInterface && wizard.id.includes('web')) {
      confidence += 30;
    }
  }
  
  // Port-based confidence
  if (device.port && wizard.id.includes('mqtt') && device.port === 1883) confidence += 20;
  if (device.port && wizard.id.includes('modbus') && device.port === 502) confidence += 20;
  if (device.port && wizard.id.includes('http') && (device.port === 80 || device.port === 443)) confidence += 15;
  
  return Math.min(confidence, 100); // Cap at 100%
}

/**
 * Wizard Definitions with Factory-Generated Steps
 */

const SETUP_WIZARDS = {
  'farm-setup': {
    id: 'farm-setup',
    name: 'Farm Setup',
    description: 'Configure farm identity, location, rooms, and contact information',
    targetDevices: ['farm'],
    steps: [
      {
        id: 'farm-wifi',
        name: 'Network Setup',
        description: 'Configure farm network connectivity',
        fields: [
          { name: 'connectionType', type: 'select', label: 'Connection Type', options: ['wifi', 'ethernet'], default: 'wifi', required: true },
          { name: 'ssid', type: 'text', label: 'WiFi SSID', required: false },
          { name: 'password', type: 'password', label: 'WiFi Password', required: false },
          { name: 'reuseDiscovery', type: 'boolean', label: 'Reuse discovered network', default: true },
          { name: 'testConnection', type: 'boolean', label: 'Test connection now', default: true }
        ]
      },
      {
        id: 'farm-contact',
        name: 'Contact',
        description: 'Primary contact details',
        fields: [
          { name: 'name', type: 'text', label: 'Contact Name', required: true },
          { name: 'email', type: 'email', label: 'Email', required: true },
          { name: 'phone', type: 'text', label: 'Phone', required: false },
          { name: 'website', type: 'url', label: 'Website', required: false }
        ]
      },
      {
        id: 'farm-identity',
        name: 'Farm Identity',
        description: 'Basic farm information',
        fields: [
          { name: 'farmName', type: 'text', label: 'Farm Name', required: true, validation: { minLength: 2, maxLength: 100 } },
          { name: 'tagline', type: 'text', label: 'Tagline', required: false, validation: { maxLength: 140 } },
          { name: 'logo', type: 'url', label: 'Logo URL', required: false }
        ]
      },
      {
        id: 'farm-branding',
        name: 'Branding',
        description: 'Pull theme colors from your website or logo URL',
        fields: [
          { name: 'website', type: 'url', label: 'Website URL (optional)', required: false },
          { name: 'preferThemeColor', type: 'boolean', label: 'Prefer site theme-color', default: true },
          { name: 'fallbackPrimary', type: 'text', label: 'Fallback Primary (hex)', required: false, validation: { pattern: '^#?[0-9A-Fa-f]{6}$', message: 'Use 6-digit hex like #0077b5' } }
        ]
      },
      {
        id: 'farm-location',
        name: 'Location',
        description: 'Address and timezone',
        fields: [
          { name: 'address', type: 'text', label: 'Street Address', required: true },
          { name: 'city', type: 'text', label: 'City', required: true },
          { name: 'state', type: 'text', label: 'State/Province', required: true },
          { name: 'postalCode', type: 'text', label: 'Postal/ZIP Code', required: true },
          { name: 'timezone', type: 'text', label: 'Timezone (IANA)', required: true, validation: { pattern: '^[A-Za-z_]+\/[A-Za-z_]+$', message: 'Use IANA timezone like America/Toronto' } },
          { name: 'lat', type: 'number', label: 'Latitude (optional)', required: false, min: -90, max: 90 },
          { name: 'lng', type: 'number', label: 'Longitude (optional)', required: false, min: -180, max: 180 }
        ]
      },
      {
        id: 'farm-rooms',
        name: 'Rooms and Zones',
        description: 'Create your first room and zones',
        fields: [
          { name: 'roomName', type: 'text', label: 'Room Name', required: true },
          { name: 'zonesCsv', type: 'text', label: 'Zones (comma-separated)', required: false, placeholder: '1,2,3' }
        ]
      }
    ]
  },
  'mqtt-setup': {
    id: 'mqtt-setup',
    name: 'MQTT Device Integration',
    description: 'Configure MQTT broker connection and device subscriptions',
    targetDevices: ['mqtt', 'mqtt-tls'],
    steps: [
      createBrokerCredentialsStep({
        protocol: 'MQTT',
        defaultPort: 1883,
        supportsTLS: true
      }),
      {
        id: 'topic-discovery',
        name: 'Topic Discovery',
        description: 'Discover available MQTT topics and sensors',
        fields: [
          { 
            name: 'baseTopic', 
            type: 'text', 
            label: 'Base Topic Pattern', 
            default: 'farm/#',
            placeholder: 'e.g., farm/#, sensors/+/data'
          },
          { 
            name: 'discoverTime', 
            type: 'number', 
            label: 'Discovery Time (seconds)', 
            default: 30,
            min: 10,
            max: 300
          }
        ]
      },
      {
        id: 'sensor-mapping',
        name: 'Sensor Mapping',
        description: 'Map discovered topics to sensor types',
        dynamic: true,
        fields: [
          {
            name: 'sensorType',
            type: 'select',
            label: 'Sensor Type',
            options: ['temperature', 'humidity', 'soil-moisture', 'light', 'ph', 'ec', 'co2'],
            required: true
          },
          {
            name: 'topic',
            type: 'text',
            label: 'MQTT Topic',
            required: true
          },
          {
            name: 'unit',
            type: 'text',
            label: 'Measurement Unit',
            placeholder: 'e.g., °C, %, ppm'
          }
        ]
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
          { 
            name: 'deviceUrl', 
            type: 'url', 
            label: 'Device URL', 
            required: true,
            placeholder: 'http://device-ip:port'
          },
          { 
            name: 'deviceType', 
            type: 'select', 
            label: 'Device Type',
            options: [
              'environmental-controller',
              'sensor-hub', 
              'lighting-controller', 
              'irrigation-controller',
              'climate-controller',
              'other'
            ],
            required: true
          }
        ]
      },
      {
        id: 'authentication',
        name: 'Authentication Setup',
        description: 'Configure device authentication',
        fields: [
          { 
            name: 'authType', 
            type: 'select', 
            label: 'Authentication Type',
            options: ['none', 'basic', 'bearer', 'api-key'],
            default: 'none'
          },
          { 
            name: 'username', 
            type: 'text', 
            label: 'Username', 
            conditional: 'authType=basic'
          },
          { 
            name: 'password', 
            type: 'password', 
            label: 'Password', 
            conditional: 'authType=basic'
          },
          {
            name: 'apiKey',
            type: 'text',
            label: 'API Key',
            conditional: 'authType=api-key'
          },
          {
            name: 'bearerToken',
            type: 'text',
            label: 'Bearer Token',
            conditional: 'authType=bearer'
          }
        ]
      },
      createDeviceAssignmentStep({
        includeScheduling: true,
        includeAlerts: true
      })
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
          { 
            name: 'token', 
            type: 'text', 
            label: 'SwitchBot Token', 
            required: true,
            placeholder: 'Your SwitchBot API token'
          },
          { 
            name: 'secret', 
            type: 'text', 
            label: 'SwitchBot Secret', 
            required: true,
            placeholder: 'Your SwitchBot API secret'
          }
        ]
      },
      createDeviceDiscoveryStep({
        stepId: 'device-discovery',
        name: 'SwitchBot Device Discovery',
        description: 'Discover SwitchBot devices in your account',
        defaultTimeout: 15,
        supportsBroadcast: false,
        supportsTargeted: false
      }),
      createDeviceAssignmentStep({
        stepId: 'device-configuration',
        name: 'Device Configuration',
        description: 'Configure discovered SwitchBot devices'
      })
    ]
  },

  'modbus-setup': {
    id: 'modbus-setup',
    name: 'Modbus Device Configuration',
    description: 'Configure Modbus RTU/TCP devices for industrial sensors',
    targetDevices: ['modbus', 'modbus-tcp'],
    steps: [
      createBrokerCredentialsStep({
        stepId: 'connection-setup',
        name: 'Modbus Connection Setup',
        description: 'Configure Modbus connection parameters',
        defaultPort: 502,
        supportsTLS: false,
        protocol: 'Modbus'
      }),
      {
        id: 'protocol-setup',
        name: 'Protocol Configuration',
        description: 'Configure Modbus protocol parameters',
        fields: [
          { 
            name: 'unitId', 
            type: 'number', 
            label: 'Unit ID', 
            default: 1, 
            min: 1, 
            max: 247,
            required: true
          },
          { 
            name: 'timeout', 
            type: 'number', 
            label: 'Timeout (ms)', 
            default: 3000,
            min: 100,
            max: 30000
          },
          { 
            name: 'protocol', 
            type: 'select', 
            label: 'Protocol', 
            options: ['TCP', 'RTU'], 
            default: 'TCP'
          }
        ]
      },
      {
        id: 'register-mapping',
        name: 'Register Mapping',
        description: 'Map Modbus registers to sensor readings',
        fields: [
          { 
            name: 'startAddress', 
            type: 'number', 
            label: 'Start Address', 
            default: 0,
            min: 0,
            max: 65535
          },
          { 
            name: 'registerCount', 
            type: 'number', 
            label: 'Register Count', 
            default: 10,
            min: 1,
            max: 125
          },
          { 
            name: 'dataType', 
            type: 'select', 
            label: 'Data Type',
            options: ['int16', 'uint16', 'int32', 'uint32', 'float32'],
            default: 'uint16'
          },
          { 
            name: 'pollInterval', 
            type: 'number', 
            label: 'Poll Interval (seconds)', 
            default: 30,
            min: 5,
            max: 3600
          }
        ]
      },
      createDeviceAssignmentStep({
        stepId: 'sensor-assignment',
        name: 'Sensor Assignment',
        description: 'Assign Modbus sensors to monitoring points'
      })
    ]
  },

  'kasa-setup': {
    id: 'kasa-setup',
    name: 'TP-Link Kasa Device Setup',
    description: 'Configure TP-Link Kasa smart devices for farm automation',
    targetDevices: ['kasa', 'tplink'],
    steps: [
      createDeviceDiscoveryStep({
        stepId: 'device-discovery',
        name: 'Kasa Device Discovery',
        description: 'Discover Kasa devices on the network',
        defaultTimeout: 10,
        supportsBroadcast: true,
        supportsTargeted: true
      }),
      createDeviceAssignmentStep({
        stepId: 'device-configuration',
        name: 'Kasa Device Configuration',
        description: 'Configure discovered Kasa devices',
        includeScheduling: true,
        includeAlerts: false
      })
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
          { 
            name: 'hubType', 
            type: 'select', 
            label: 'Hub Type',
            options: ['Arduino-based', 'Raspberry Pi', 'ESP32', 'Commercial Hub'],
            required: true
          },
          { 
            name: 'connectionType', 
            type: 'select', 
            label: 'Connection Type',
            options: ['WiFi', 'Ethernet', 'USB', 'Serial'],
            required: true
          },
          { 
            name: 'endpoint', 
            type: 'text', 
            label: 'Hub Endpoint', 
            placeholder: 'IP:Port or device path',
            required: true
          }
        ]
      },
      {
        id: 'sensor-configuration',
        name: 'Sensor Configuration',
        description: 'Configure individual sensors on the hub',
        dynamic: true,
        fields: [
          { 
            name: 'sensorType', 
            type: 'select', 
            label: 'Sensor Type',
            options: [
              'Temperature', 
              'Humidity', 
              'Soil Moisture', 
              'Light', 
              'pH', 
              'EC', 
              'CO2', 
              'Air Quality'
            ],
            required: true
          },
          { 
            name: 'channel', 
            type: 'number', 
            label: 'Channel/Pin', 
            min: 0, 
            max: 255,
            required: true
          },
          { 
            name: 'calibrationFactor', 
            type: 'number', 
            label: 'Calibration Factor', 
            default: 1.0, 
            step: 0.001,
            min: 0.001,
            max: 1000
          }
        ]
      },
      createDeviceAssignmentStep({
        stepId: 'hub-assignment',
        name: 'Hub Assignment',
        description: 'Assign sensor hub to monitoring location'
      })
    ]
  }
};

/**
 * Wizard State Management
 */
class WizardStateManager {
  constructor() {
    this.states = new Map();
  }

  initializeWizard(wizardId, discoveryContext = null) {
    const wizard = SETUP_WIZARDS[wizardId];
    if (!wizard) {
      throw new Error(`Unknown wizard: ${wizardId}`);
    }

    const state = {
      wizardId,
      currentStep: 0,
      stepData: new Map(),
      discoveryContext,
      started: new Date().toISOString(),
      completed: false,
      errors: []
    };

    this.states.set(wizardId, state);
    return state;
  }

  getWizardState(wizardId) {
    return this.states.get(wizardId);
  }

  updateStepData(wizardId, stepId, data) {
    const state = this.states.get(wizardId);
    if (state) {
      state.stepData.set(stepId, data);
      state.lastUpdated = new Date().toISOString();
    }
    return state;
  }

  completeWizard(wizardId) {
    const state = this.states.get(wizardId);
    if (state) {
      state.completed = true;
      state.completedAt = new Date().toISOString();
    }
    return state;
  }

  clearWizard(wizardId) {
    return this.states.delete(wizardId);
  }
}

export {
  // Factory functions
  createBrokerCredentialsStep,
  createDeviceDiscoveryStep,
  createDeviceAssignmentStep,
  
  // Discovery context functions
  mergeDiscoveryContext,
  calculateWizardConfidence,
  
  // Wizard definitions
  SETUP_WIZARDS,
  
  // State management
  WizardStateManager
};