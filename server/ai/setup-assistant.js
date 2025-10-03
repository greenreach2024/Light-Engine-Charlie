// AI Setup Assistant Service
// Provides intelligent suggestions for device configuration and setup guidance

/**
 * Analyzes device metadata and provides setup suggestions
 */
class AISetupAssistant {
  constructor(config = {}) {
    this.enabled = config.enabled || false;
    this.provider = config.provider || 'heuristic'; // 'openai', 'azure', 'heuristic'
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-3.5-turbo';
    
    // Heuristic knowledge base for when AI service is not available
    this.deviceKnowledgeBase = {
      'mqtt': {
        commonPorts: [1883, 8883],
        defaultSettings: { secure: false, qos: 1 },
        setupTips: 'MQTT brokers typically run on port 1883 (unsecured) or 8883 (TLS). Check if your broker requires authentication.',
        fieldSuggestions: {
          topic: 'farm/{location}/{sensor_type}',
          clientId: 'greenreach_client_{random}'
        }
      },
      'kasa': {
        commonPorts: [9999],
        defaultSettings: { discoveryTimeout: 10 },
        setupTips: 'TP-Link Kasa devices use local network discovery. Ensure devices are on the same network segment.',
        fieldSuggestions: {
          alias: 'Farm {device_type} {location}',
          location: 'Greenhouse A'
        }
      },
      'switchbot': {
        defaultSettings: { pollInterval: 300 },
        setupTips: 'SwitchBot requires API tokens from the SwitchBot app. Enable "Developer Options" in settings.',
        fieldSuggestions: {
          deviceName: 'SwitchBot {device_type}',
          enableScheduling: true
        }
      },
      'modbus': {
        commonPorts: [502],
        defaultSettings: { timeout: 3000, unitId: 1 },
        setupTips: 'Modbus devices typically use unit ID 1. Check device documentation for register mappings.',
        fieldSuggestions: {
          protocol: 'TCP',
          dataType: 'float32'
        }
      },
      'web-device': {
        commonPorts: [80, 443, 8080, 8443],
        defaultSettings: { pollInterval: 60 },
        setupTips: 'Web devices may require authentication. Test connectivity before proceeding.',
        fieldSuggestions: {
          authType: 'none',
          deviceType: 'environmental-controller'
        }
      }
    };
  }

  /**
   * Generate setup suggestions based on device metadata
   */
  async generateSetupSuggestions(deviceMetadata, wizardContext = {}) {
    if (!this.enabled) {
      return this._generateHeuristicSuggestions(deviceMetadata, wizardContext);
    }

    try {
      switch (this.provider) {
        case 'openai':
          return await this._generateOpenAISuggestions(deviceMetadata, wizardContext);
        case 'azure':
          return await this._generateAzureSuggestions(deviceMetadata, wizardContext);
        default:
          return this._generateHeuristicSuggestions(deviceMetadata, wizardContext);
      }
    } catch (error) {
      console.warn('AI provider failed, falling back to heuristics:', error.message);
      return this._generateHeuristicSuggestions(deviceMetadata, wizardContext);
    }
  }

  /**
   * Heuristic-based suggestions when AI is not available
   */
  _generateHeuristicSuggestions(deviceMetadata, wizardContext) {
    const { deviceType, ip, hostname, detectedServices, wizardId, stepId } = deviceMetadata;
    const knowledge = this.deviceKnowledgeBase[deviceType] || {};
    
    const suggestions = {
      confidence: 0.7,
      provider: 'heuristic',
      fieldSuggestions: {},
      nextSteps: [],
      setupTips: knowledge.setupTips || 'Configure device according to manufacturer specifications.',
      timestamp: new Date().toISOString()
    };

    // Generate field-specific suggestions
    if (stepId === 'broker-connection' || stepId === 'connection-setup') {
      if (ip) {
        suggestions.fieldSuggestions.host = ip;
        suggestions.confidence += 0.2;
      }
      
      if (knowledge.commonPorts) {
        const detectedPort = detectedServices?.find(s => knowledge.commonPorts.includes(s.port))?.port;
        suggestions.fieldSuggestions.port = detectedPort || knowledge.commonPorts[0];
        suggestions.confidence += 0.1;
      }

      // Apply default settings
      Object.assign(suggestions.fieldSuggestions, knowledge.defaultSettings);
    }

    if (stepId === 'device-assignment' || stepId === 'device-configuration') {
      if (hostname) {
        suggestions.fieldSuggestions.deviceName = hostname.replace(/[.-]/g, ' ').trim();
        suggestions.confidence += 0.1;
      }

      // Apply device-specific field suggestions
      Object.assign(suggestions.fieldSuggestions, knowledge.fieldSuggestions);
      
      // Replace placeholders
      for (const [field, value] of Object.entries(suggestions.fieldSuggestions)) {
        if (typeof value === 'string') {
          suggestions.fieldSuggestions[field] = value
            .replace('{device_type}', deviceType || 'Device')
            .replace('{location}', wizardContext.location || 'Zone 1')
            .replace('{hostname}', hostname || 'device')
            .replace('{random}', Math.random().toString(36).substr(2, 8));
        }
      }
    }

    // Generate next steps based on wizard progress
    suggestions.nextSteps = this._generateNextSteps(wizardId, stepId, deviceMetadata);

    return suggestions;
  }

  /**
   * OpenAI-based suggestions
   */
  async _generateOpenAISuggestions(deviceMetadata, wizardContext) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const prompt = this._buildAIPrompt(deviceMetadata, wizardContext);
    
    // This would integrate with OpenAI API
    // For now, return enhanced heuristics
    const heuristicResult = this._generateHeuristicSuggestions(deviceMetadata, wizardContext);
    
    return {
      ...heuristicResult,
      provider: 'openai',
      confidence: Math.min(heuristicResult.confidence + 0.2, 1.0),
      aiEnhanced: true
    };
  }

  /**
   * Azure AI-based suggestions
   */
  async _generateAzureSuggestions(deviceMetadata, wizardContext) {
    if (!this.apiKey) {
      throw new Error('Azure AI API key not configured');
    }

    // This would integrate with Azure AI services
    const heuristicResult = this._generateHeuristicSuggestions(deviceMetadata, wizardContext);
    
    return {
      ...heuristicResult,
      provider: 'azure',
      confidence: Math.min(heuristicResult.confidence + 0.2, 1.0),
      aiEnhanced: true
    };
  }

  /**
   * Build AI prompt for device setup assistance
   */
  _buildAIPrompt(deviceMetadata, wizardContext) {
    return `
You are an expert farm automation technician helping configure IoT devices.

Device Information:
- Type: ${deviceMetadata.deviceType}
- IP Address: ${deviceMetadata.ip || 'Unknown'}
- Hostname: ${deviceMetadata.hostname || 'Unknown'}
- Detected Services: ${JSON.stringify(deviceMetadata.detectedServices || [])}
- Current Wizard: ${deviceMetadata.wizardId}
- Current Step: ${deviceMetadata.stepId}

Context:
- Farm Environment: Greenhouse automation
- Previous Steps: ${JSON.stringify(wizardContext.previousSteps || {})}

Please provide:
1. Optimal field values for the current configuration step
2. 2-3 specific setup tips for this device type
3. Potential next steps or validation checks
4. Confidence level (0-1) for your suggestions

Format as JSON with fields: fieldSuggestions, setupTips, nextSteps, confidence
    `.trim();
  }

  /**
   * Generate logical next steps based on wizard progress
   */
  _generateNextSteps(wizardId, stepId, deviceMetadata) {
    const stepMap = {
      'mqtt-setup': {
        'broker-connection': [
          'Test MQTT connection',
          'Configure topic discovery',
          'Set up authentication if required'
        ],
        'topic-discovery': [
          'Review discovered topics',
          'Map topics to sensor types', 
          'Configure data retention'
        ]
      },
      'kasa-setup': {
        'device-discovery': [
          'Verify device connectivity',
          'Check firmware version',
          'Configure device scheduling'
        ],
        'device-configuration': [
          'Test device control',
          'Set up automation rules',
          'Configure monitoring alerts'
        ]
      },
      'switchbot-setup': {
        'api-credentials': [
          'Validate API access',
          'Discover linked devices',
          'Configure polling intervals'
        ]
      }
    };

    return stepMap[wizardId]?.[stepId] || [
      'Complete current configuration',
      'Test device connectivity',
      'Proceed to next setup step'
    ];
  }

  /**
   * Generate setup guide summaries with AI assistance
   */
  async generateSetupGuide(deviceType, currentProgress = {}) {
    const knowledge = this.deviceKnowledgeBase[deviceType] || {};
    
    const guide = {
      deviceType,
      title: `${deviceType.toUpperCase()} Setup Guide`,
      summary: knowledge.setupTips || 'Follow device-specific configuration steps.',
      estimatedTime: this._estimateSetupTime(deviceType),
      difficulty: this._assessDifficulty(deviceType),
      prerequisites: this._getPrerequisites(deviceType),
      troubleshooting: this._getTroubleshootingTips(deviceType),
      generated: new Date().toISOString()
    };

    if (this.enabled && this.provider !== 'heuristic') {
      // Enhance with AI-generated content
      guide.aiEnhanced = true;
      guide.summary = await this._generateAIGuideSummary(deviceType, currentProgress);
    }

    return guide;
  }

  _estimateSetupTime(deviceType) {
    const timeMap = {
      'mqtt': '10-15 minutes',
      'kasa': '5-10 minutes', 
      'switchbot': '15-20 minutes',
      'modbus': '20-30 minutes',
      'web-device': '10-20 minutes'
    };
    return timeMap[deviceType] || '15-25 minutes';
  }

  _assessDifficulty(deviceType) {
    const difficultyMap = {
      'kasa': 'Easy',
      'switchbot': 'Easy',
      'mqtt': 'Medium',
      'web-device': 'Medium',
      'modbus': 'Advanced'
    };
    return difficultyMap[deviceType] || 'Medium';
  }

  _getPrerequisites(deviceType) {
    const prereqMap = {
      'mqtt': ['MQTT broker running', 'Network connectivity', 'Authentication credentials (if required)'],
      'kasa': ['Devices on same network', 'TP-Link Kasa app configured', 'WiFi connectivity'],
      'switchbot': ['SwitchBot app installed', 'API tokens generated', 'Bluetooth connectivity'],
      'modbus': ['Device manual/documentation', 'Network connectivity', 'Register mappings'],
      'web-device': ['Device IP address', 'Authentication credentials', 'API documentation']
    };
    return prereqMap[deviceType] || ['Device documentation', 'Network connectivity'];
  }

  _getTroubleshootingTips(deviceType) {
    const troubleshootingMap = {
      'mqtt': [
        'Check broker connectivity with MQTT client tools',
        'Verify authentication credentials',
        'Ensure firewall allows MQTT ports'
      ],
      'kasa': [
        'Ensure devices are on same network segment',
        'Check for firmware updates',
        'Restart devices if discovery fails'
      ],
      'switchbot': [
        'Verify API tokens are valid and active',
        'Check rate limiting (1000 requests/day)',
        'Ensure devices are paired in SwitchBot app'
      ],
      'modbus': [
        'Verify unit ID and register addresses',
        'Check network connectivity to device',
        'Validate data type mappings'
      ],
      'web-device': [
        'Test device URL in web browser',
        'Verify authentication credentials',
        'Check SSL certificate validity'
      ]
    };
    return troubleshootingMap[deviceType] || [
      'Check device documentation',
      'Verify network connectivity',
      'Review error logs'
    ];
  }

  async _generateAIGuideSummary(deviceType, currentProgress) {
    // Placeholder for AI-enhanced guide summary
    // Would integrate with AI service to generate contextual summaries
    const baseKnowledge = this.deviceKnowledgeBase[deviceType];
    return baseKnowledge?.setupTips || `Configure ${deviceType} device according to specifications.`;
  }
}

export { AISetupAssistant };