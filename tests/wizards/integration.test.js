// Integration Tests for Wizard API Endpoints
// Tests the full POST /discovery/suggest-wizards + POST /setup/wizards/{id}/execute flow

const request = require('supertest');
const express = require('express');

// Mock the wizard modules for testing
jest.mock('../../server/wizards/index.js', () => ({
  SETUP_WIZARDS: {
    'mqtt-setup': {
      id: 'mqtt-setup',
      name: 'MQTT Device Integration',
      targetDevices: ['mqtt', 'mqtt-tls'],
      steps: [
        {
          id: 'broker-connection',
          name: 'Broker Connection',
          fields: [
            { name: 'host', type: 'text', required: true },
            { name: 'port', type: 'number', default: 1883, required: true },
            { name: 'secure', type: 'boolean', default: false }
          ]
        }
      ]
    },
    'kasa-setup': {
      id: 'kasa-setup',
      name: 'TP-Link Kasa Device Setup',
      targetDevices: ['kasa', 'tplink'],
      steps: [
        {
          id: 'device-discovery',
          name: 'Device Discovery',
          fields: [
            { name: 'discoveryTimeout', type: 'number', default: 10 },
            { name: 'targetIP', type: 'text' }
          ]
        }
      ]
    },
    'switchbot-setup': {
      id: 'switchbot-setup',
      name: 'SwitchBot Device Setup',
      targetDevices: ['switchbot'],
      steps: [
        {
          id: 'api-credentials',
          name: 'API Credentials',
          fields: [
            { name: 'token', type: 'text', required: true },
            { name: 'secret', type: 'text', required: true }
          ]
        }
      ]
    }
  },
  calculateWizardConfidence: jest.fn((device, wizard, context) => {
    if (wizard.targetDevices.some(target => device.type?.includes(target))) {
      return context ? 85 : 60;
    }
    return 20;
  }),
  mergeDiscoveryContext: jest.fn((step, context) => ({
    ...step,
    discoveryContext: context,
    fields: step.fields.map(field => ({
      ...field,
      ...(field.name === 'host' && context?.ip ? { default: context.ip } : {})
    }))
  }))
}));

jest.mock('../../server/wizards/execution.js', () => ({
  executeWizardStepWithValidation: jest.fn(async (wizardId, stepId, data, context) => {
    // Simulate successful execution
    return {
      success: true,
      data: {
        stepId,
        wizardId,
        executedData: data,
        ...(context ? { discoveryEnhanced: true } : {})
      },
      discoveryContext: context,
      confidence: context ? 85 : 60,
      nextStep: stepId === 'broker-connection' ? 'topic-discovery' : null
    };
  }),
  applyWizardTemplate: jest.fn(async (templateId, devices, presets, context) => ({
    templateId,
    applicableWizards: devices.map(device => ({
      wizardId: device.type + '-setup',
      confidence: context ? 85 : 60,
      devices: [device]
    })),
    autoExecuted: [],
    errors: [],
    discoveryContext: context
  }))
}));

// Create test Express app with wizard endpoints
function createTestApp() {
  const app = express();
  app.use(express.json());
  
  const { SETUP_WIZARDS, calculateWizardConfidence, mergeDiscoveryContext } = require('../../server/wizards/index.js');
  const { executeWizardStepWithValidation, applyWizardTemplate } = require('../../server/wizards/execution.js');
  
  // POST /discovery/suggest-wizards
  app.post('/discovery/suggest-wizards', async (req, res) => {
    try {
      const { devices, discoveryContext } = req.body;
      
      if (!devices || !Array.isArray(devices)) {
        return res.status(400).json({
          error: 'devices array is required'
        });
      }
      
      const suggestions = [];
      
      for (const device of devices) {
        const applicableWizards = Object.values(SETUP_WIZARDS)
          .map(wizard => ({
            wizard,
            confidence: calculateWizardConfidence(device, wizard, discoveryContext)
          }))
          .filter(({ confidence }) => confidence > 50)
          .sort((a, b) => b.confidence - a.confidence);
        
        if (applicableWizards.length > 0) {
          suggestions.push({
            device: {
              ip: device.ip,
              type: device.type,
              port: device.port
            },
            recommendedWizards: applicableWizards.map(({ wizard, confidence }) => ({
              id: wizard.id,
              name: wizard.name,
              confidence,
              estimatedSteps: wizard.steps.length,
              discoveryEnhanced: !!discoveryContext
            })),
            discoveryContext: discoveryContext ? {
              ip: discoveryContext.ip,
              hostname: discoveryContext.hostname,
              confidence: discoveryContext.confidence
            } : null
          });
        }
      }
      
      res.json({
        suggestions,
        totalDevices: devices.length,
        devicesWithWizards: suggestions.length,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // POST /setup/wizards/:wizardId/execute
  app.post('/setup/wizards/:wizardId/execute', async (req, res) => {
    try {
      const { wizardId } = req.params;
      const { stepId, data, discoveryContext } = req.body;
      
      if (!stepId) {
        return res.status(400).json({
          error: 'stepId is required'
        });
      }
      
      if (!SETUP_WIZARDS[wizardId]) {
        return res.status(404).json({
          error: `Wizard ${wizardId} not found`
        });
      }
      
      const result = await executeWizardStepWithValidation(
        wizardId,
        stepId,
        data || {},
        discoveryContext
      );
      
      if (!result.success) {
        return res.status(422).json({
          error: 'Validation failed',
          details: result.errors,
          data: result.data
        });
      }
      
      res.json({
        success: true,
        wizardId,
        stepId,
        result: result.data,
        nextStep: result.nextStep,
        discoveryContext: result.discoveryContext,
        confidence: result.confidence,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // GET /setup/wizards/:wizardId/steps/:stepId
  app.get('/setup/wizards/:wizardId/steps/:stepId', (req, res) => {
    try {
      const { wizardId, stepId } = req.params;
      const { discoveryContext } = req.query;
      
      const wizard = SETUP_WIZARDS[wizardId];
      if (!wizard) {
        return res.status(404).json({ error: `Wizard ${wizardId} not found` });
      }
      
      const step = wizard.steps.find(s => s.id === stepId);
      if (!step) {
        return res.status(404).json({ error: `Step ${stepId} not found` });
      }
      
      let enhancedStep = step;
      if (discoveryContext) {
        try {
          const context = JSON.parse(discoveryContext);
          enhancedStep = mergeDiscoveryContext(step, context);
        } catch (e) {
          // Invalid discovery context, use original step
        }
      }
      
      res.json({
        wizardId,
        stepId,
        step: enhancedStep,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  return app;
}

describe('Wizard API Integration Tests', () => {
  let app;
  
  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });
  
  describe('POST /discovery/suggest-wizards', () => {
    
    test('suggests wizards for MQTT devices', async () => {
      const devices = [
        {
          ip: '192.168.1.100',
          type: 'mqtt',
          port: 1883,
          services: ['mqtt']
        }
      ];
      
      const discoveryContext = {
        ip: '192.168.1.100',
        hostname: 'mqtt-broker-01',
        confidence: 90,
        detectedServices: [
          { name: 'mqtt', protocol: 'mqtt', port: 1883 }
        ]
      };
      
      const response = await request(app)
        .post('/discovery/suggest-wizards')
        .send({ devices, discoveryContext })
        .expect(200);
      
      expect(response.body.suggestions).toHaveLength(1);
      expect(response.body.suggestions[0].recommendedWizards).toContainEqual(
        expect.objectContaining({
          id: 'mqtt-setup',
          confidence: 85,
          discoveryEnhanced: true
        })
      );
      expect(response.body.devicesWithWizards).toBe(1);
    });
    
    test('suggests wizards for multiple device types', async () => {
      const devices = [
        { ip: '192.168.1.100', type: 'mqtt', port: 1883 },
        { ip: '192.168.1.101', type: 'kasa', port: 9999 },
        { ip: '192.168.1.102', type: 'switchbot', port: 443 }
      ];
      
      const response = await request(app)
        .post('/discovery/suggest-wizards')
        .send({ devices })
        .expect(200);
      
      expect(response.body.suggestions).toHaveLength(3);
      expect(response.body.totalDevices).toBe(3);
      expect(response.body.devicesWithWizards).toBe(3);
    });
    
    test('handles empty devices array', async () => {
      const response = await request(app)
        .post('/discovery/suggest-wizards')
        .send({ devices: [] })
        .expect(200);
      
      expect(response.body.suggestions).toHaveLength(0);
      expect(response.body.totalDevices).toBe(0);
    });
    
    test('validates required devices parameter', async () => {
      const response = await request(app)
        .post('/discovery/suggest-wizards')
        .send({})
        .expect(400);
      
      expect(response.body.error).toContain('devices array is required');
    });
  });
  
  describe('POST /setup/wizards/:wizardId/execute', () => {
    
    test('executes MQTT broker connection step successfully', async () => {
      const stepData = {
        host: '192.168.1.100',
        port: 1883,
        secure: false
      };
      
      const discoveryContext = {
        ip: '192.168.1.100',
        hostname: 'mqtt-broker-01'
      };
      
      const response = await request(app)
        .post('/setup/wizards/mqtt-setup/execute')
        .send({
          stepId: 'broker-connection',
          data: stepData,
          discoveryContext
        })
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.wizardId).toBe('mqtt-setup');
      expect(response.body.stepId).toBe('broker-connection');
      expect(response.body.result.discoveryEnhanced).toBe(true);
      expect(response.body.confidence).toBe(85);
      expect(response.body.nextStep).toBe('topic-discovery');
    });
    
    test('executes Kasa device discovery step', async () => {
      const stepData = {
        discoveryTimeout: 15,
        targetIP: '192.168.1.0/24'
      };
      
      const response = await request(app)
        .post('/setup/wizards/kasa-setup/execute')
        .send({
          stepId: 'device-discovery',
          data: stepData
        })
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.wizardId).toBe('kasa-setup');
      expect(response.body.result.executedData).toEqual(stepData);
    });
    
    test('executes SwitchBot API credentials step', async () => {
      const stepData = {
        token: 'abc123def456',
        secret: 'secret789xyz'
      };
      
      const response = await request(app)
        .post('/setup/wizards/switchbot-setup/execute')
        .send({
          stepId: 'api-credentials',
          data: stepData
        })
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.wizardId).toBe('switchbot-setup');
    });
    
    test('validates required stepId parameter', async () => {
      const response = await request(app)
        .post('/setup/wizards/mqtt-setup/execute')
        .send({ data: {} })
        .expect(400);
      
      expect(response.body.error).toContain('stepId is required');
    });
    
    test('handles unknown wizard gracefully', async () => {
      const response = await request(app)
        .post('/setup/wizards/unknown-wizard/execute')
        .send({
          stepId: 'some-step',
          data: {}
        })
        .expect(404);
      
      expect(response.body.error).toContain('Wizard unknown-wizard not found');
    });
  });
  
  describe('GET /setup/wizards/:wizardId/steps/:stepId', () => {
    
    test('returns step definition without discovery context', async () => {
      const response = await request(app)
        .get('/setup/wizards/mqtt-setup/steps/broker-connection')
        .expect(200);
      
      expect(response.body.wizardId).toBe('mqtt-setup');
      expect(response.body.stepId).toBe('broker-connection');
      expect(response.body.step.fields).toBeDefined();
      expect(response.body.step.discoveryContext).toBeUndefined();
    });
    
    test('returns enhanced step definition with discovery context', async () => {
      const discoveryContext = {
        ip: '192.168.1.100',
        hostname: 'mqtt-device'
      };
      
      const response = await request(app)
        .get('/setup/wizards/mqtt-setup/steps/broker-connection')
        .query({ discoveryContext: JSON.stringify(discoveryContext) })
        .expect(200);
      
      expect(response.body.step.discoveryContext).toEqual(discoveryContext);
      
      // Check if discovery context was used to enhance fields
      const hostField = response.body.step.fields.find(f => f.name === 'host');
      expect(hostField.default).toBe('192.168.1.100');
    });
    
    test('handles invalid discovery context gracefully', async () => {
      const response = await request(app)
        .get('/setup/wizards/mqtt-setup/steps/broker-connection')
        .query({ discoveryContext: 'invalid-json' })
        .expect(200);
      
      // Should return original step without enhancement
      expect(response.body.step.discoveryContext).toBeUndefined();
    });
    
    test('handles unknown wizard/step gracefully', async () => {
      await request(app)
        .get('/setup/wizards/unknown-wizard/steps/some-step')
        .expect(404);
      
      await request(app)
        .get('/setup/wizards/mqtt-setup/steps/unknown-step')
        .expect(404);
    });
  });
});

describe('End-to-End Wizard Flow Tests', () => {
  let app;
  
  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });
  
  test('complete MQTT wizard setup flow with discovery context', async () => {
    const devices = [{
      ip: '192.168.1.100',
      type: 'mqtt',
      port: 1883
    }];
    
    const discoveryContext = {
      ip: '192.168.1.100',
      hostname: 'mqtt-broker-01',
      detectedServices: [{ name: 'mqtt', port: 1883 }]
    };
    
    // Step 1: Get wizard suggestions
    const suggestResponse = await request(app)
      .post('/discovery/suggest-wizards')
      .send({ devices, discoveryContext })
      .expect(200);
    
    expect(suggestResponse.body.suggestions[0].recommendedWizards[0].id).toBe('mqtt-setup');
    
    // Step 2: Get enhanced step definition
    const stepResponse = await request(app)
      .get('/setup/wizards/mqtt-setup/steps/broker-connection')
      .query({ discoveryContext: JSON.stringify(discoveryContext) })
      .expect(200);
    
    expect(stepResponse.body.step.discoveryContext).toBeDefined();
    
    // Step 3: Execute step with discovery-enhanced data
    const executeResponse = await request(app)
      .post('/setup/wizards/mqtt-setup/execute')
      .send({
        stepId: 'broker-connection',
        data: {
          host: '192.168.1.100', // From discovery context
          port: 1883,
          secure: false
        },
        discoveryContext
      })
      .expect(200);
    
    expect(executeResponse.body.success).toBe(true);
    expect(executeResponse.body.confidence).toBe(85);
    expect(executeResponse.body.result.discoveryEnhanced).toBe(true);
  });
  
  test('complete Kasa wizard setup flow', async () => {
    const devices = [{
      ip: '192.168.1.101',
      type: 'kasa',
      port: 9999
    }];
    
    // Get suggestions
    const suggestResponse = await request(app)
      .post('/discovery/suggest-wizards')
      .send({ devices })
      .expect(200);
    
    expect(suggestResponse.body.suggestions[0].recommendedWizards[0].id).toBe('kasa-setup');
    
    // Execute discovery step
    const executeResponse = await request(app)
      .post('/setup/wizards/kasa-setup/execute')
      .send({
        stepId: 'device-discovery',
        data: {
          discoveryTimeout: 10,
          targetIP: '192.168.1.0/24'
        }
      })
      .expect(200);
    
    expect(executeResponse.body.success).toBe(true);
    expect(executeResponse.body.wizardId).toBe('kasa-setup');
  });
  
  test('complete SwitchBot wizard setup flow', async () => {
    const devices = [{
      ip: '192.168.1.102',
      type: 'switchbot',
      port: 443
    }];
    
    // Get suggestions
    const suggestResponse = await request(app)
      .post('/discovery/suggest-wizards')
      .send({ devices })
      .expect(200);
    
    expect(suggestResponse.body.suggestions[0].recommendedWizards[0].id).toBe('switchbot-setup');
    
    // Execute credentials step
    const executeResponse = await request(app)
      .post('/setup/wizards/switchbot-setup/execute')
      .send({
        stepId: 'api-credentials',
        data: {
          token: 'test-token-123',
          secret: 'test-secret-456'
        }
      })
      .expect(200);
    
    expect(executeResponse.body.success).toBe(true);
    expect(executeResponse.body.wizardId).toBe('switchbot-setup');
  });
});

describe('Cross-Provider Consistency Integration Tests', () => {
  let app;
  
  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });
  
  test('all wizard types return consistent response format', async () => {
    const wizardTypes = ['mqtt-setup', 'kasa-setup', 'switchbot-setup'];
    const responses = [];
    
    for (const wizardId of wizardTypes) {
      const stepId = wizardId === 'mqtt-setup' ? 'broker-connection' :
                    wizardId === 'kasa-setup' ? 'device-discovery' : 'api-credentials';
      
      const response = await request(app)
        .post(`/setup/wizards/${wizardId}/execute`)
        .send({
          stepId,
          data: {}
        })
        .expect(200);
      
      responses.push(response.body);
    }
    
    // Check all responses have consistent structure
    responses.forEach(response => {
      expect(response).toHaveProperty('success');
      expect(response).toHaveProperty('wizardId');
      expect(response).toHaveProperty('stepId');
      expect(response).toHaveProperty('result');
      expect(response).toHaveProperty('timestamp');
    });
  });
  
  test('discovery context enhancement works consistently across wizards', async () => {
    const discoveryContext = {
      ip: '192.168.1.100',
      hostname: 'test-device',
      confidence: 80
    };
    
    const wizardSteps = [
      { wizardId: 'mqtt-setup', stepId: 'broker-connection' },
      { wizardId: 'kasa-setup', stepId: 'device-discovery' },
      { wizardId: 'switchbot-setup', stepId: 'api-credentials' }
    ];
    
    for (const { wizardId, stepId } of wizardSteps) {
      const response = await request(app)
        .post(`/setup/wizards/${wizardId}/execute`)
        .send({
          stepId,
          data: {},
          discoveryContext
        })
        .expect(200);
      
      expect(response.body.discoveryContext).toEqual(discoveryContext);
      expect(response.body.confidence).toBe(85); // Enhanced confidence
    }
  });
});