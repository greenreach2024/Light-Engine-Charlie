# Deep Discovery Implementation Guide

## Architecture Overview

The Light Engine's deep discovery system uses a multi-layered approach to identify and categorize IoT devices:

```
┌─────────────────────────────────────────────────────────────┐
│                    Discovery Endpoint                      │
│                 /discovery/devices                         │
└─────────────────────┬───────────────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
         ▼            ▼            ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  SwitchBot  │ │   Network   │ │    MQTT     │
│  Discovery  │ │   Scanner   │ │  Discovery  │
└─────────────┘ └─────────────┘ └─────────────┘
         │            │            │
         └────────────┼────────────┘
                      │
                      ▼
         ┌─────────────────────────┐
         │   Device Analysis &     │
         │   Wizard Suggestions    │
         └─────────────────────────┘
```

## Core Functions

### 1. Network Range Detection
```javascript
// Get current network interface IP
const { stdout: ifconfigOut } = await execAsync('ifconfig en0 | grep "inet " | grep -v 127.0.0.1');
const ipMatch = ifconfigOut.match(/inet (\d+\.\d+\.\d+\.\d+)/);
const currentIP = ipMatch[1];
const networkBase = currentIP.split('.').slice(0, 3).join('.');
```

### 2. IoT Port Scanning
```javascript
const commonPorts = [80, 443, 8080, 8081, 1883, 8883, 502, 9999, 10002, 8000];
const { stdout: nmapOut } = await execAsync(
  `nmap -p ${commonPorts.join(',')} --open ${networkBase}.0/24`
);
```

### 3. Device Type Classification
```javascript
const devicePatterns = {
  1883: { name: 'MQTT Broker', protocol: 'mqtt', confidence: 0.8 },
  8883: { name: 'MQTT Broker (TLS)', protocol: 'mqtt-tls', confidence: 0.8 },
  80: { name: 'IoT Device', protocol: 'http', confidence: 0.6 },
  502: { name: 'Modbus Device', protocol: 'modbus', confidence: 0.9 }
};
```

### 4. Device Analysis
```javascript
function analyzeDiscoveredDevices(devices) {
  const protocols = new Map();
  const setupWizards = [];
  
  devices.forEach(device => {
    const protocolCount = protocols.get(device.protocol) || 0;
    protocols.set(device.protocol, protocolCount + 1);
  });
  
  // Generate wizard suggestions based on protocols found
  if (protocols.has('mqtt')) {
    setupWizards.push({
      id: 'mqtt-setup',
      name: 'MQTT Device Integration',
      priority: 'high'
    });
  }
  
  return { protocols, setupWizards };
}
```

## Device Discovery Flows

### MQTT Broker Discovery
```javascript
// 1. Port scan for MQTT ports
nmap -p 1883,8883 192.168.2.0/24

// 2. Identify MQTT service
if (port === 1883) return { protocol: 'mqtt', security: 'none' };
if (port === 8883) return { protocol: 'mqtt', security: 'tls' };

// 3. Test connectivity
mosquitto_sub -h ${host} -p ${port} -t '$SYS/#'
```

### Web Device Discovery
```javascript
// 1. Port scan for web ports
nmap -p 80,443,8080,8081 192.168.2.0/24

// 2. Service fingerprinting
nmap -sV -p 80 ${host}

// 3. Device classification
if (service.includes('lighttpd')) return { type: 'iot-controller' };
if (service.includes('nginx')) return { type: 'web-gateway' };
```

### Industrial Device Discovery
```javascript
// 1. Scan for Modbus port
nmap -p 502 192.168.2.0/24

// 2. Modbus device identification
if (port === 502) return {
  protocol: 'modbus',
  type: 'industrial-device',
  capabilities: ['registers', 'coils', 'inputs']
};
```

## Setup Wizard Generation

### Wizard Priority System
```javascript
const priorityOrder = {
  high: ['mqtt', 'modbus', 'switchbot', 'kasa'],
  medium: ['http', 'https', 'ble'],
  low: ['custom', 'unknown']
};
```

### Wizard Configuration
```javascript
const wizardTemplates = {
  'mqtt-setup': {
    steps: [
      'broker-connection',
      'topic-discovery', 
      'authentication',
      'subscription-setup'
    ],
    capabilities: ['messaging', 'sensor-data', 'real-time-updates']
  },
  
  'web-device-setup': {
    steps: [
      'device-identification',
      'api-discovery',
      'authentication-setup',
      'data-integration'
    ],
    capabilities: ['web-interface', 'remote-access', 'configuration']
  }
};
```

## Error Handling

### Network Connectivity
```javascript
try {
  const networkDevices = await scanNetworkForDevices();
  discoveredDevices.push(...networkDevices);
} catch (e) {
  console.warn('Network device discovery failed:', e.message);
  // Continue with other discovery methods
}
```

### Service Detection
```javascript
try {
  const deviceInfo = identifyDeviceByPort(port, service, host, ip);
  if (deviceInfo) {
    devices.push(createDeviceRecord(deviceInfo));
  }
} catch (e) {
  console.warn(`Failed to identify device ${host}:${port}`, e.message);
  // Log but continue discovery
}
```

## Performance Considerations

### Parallel Discovery
```javascript
const tasks = [
  discoverSwitchBotDevices(),
  discoverNetworkDevices(),
  discoverMQTTDevices(),
  discoverBLEDevices()
];

const results = await Promise.allSettled(tasks);
```

### Timeout Management
```javascript
const scanTimeout = 30; // seconds
const nmapCommand = `timeout ${scanTimeout}s nmap -p ${ports} ${network}`;
```

### Resource Optimization
```javascript
// Limit concurrent scans
const maxConcurrentScans = 5;
const semaphore = new Semaphore(maxConcurrentScans);
```

## Integration Points

### Python Backend Integration
```javascript
// Query Python backend for additional discovery
const kasaResponse = await fetch(`${controller}/api/devices/kasa`);
const bleResponse = await fetch(`${controller}/api/devices/ble`);
```

### Database Storage
```javascript
// Store discovered devices
const device = new Device({
  id: `network:${ip}:${port}`,
  protocol: deviceInfo.protocol,
  capabilities: deviceInfo.capabilities,
  discoveredAt: new Date(),
  lastSeen: new Date()
});
```

## Testing and Validation

### Unit Tests
```javascript
describe('Device Discovery', () => {
  test('identifies MQTT broker correctly', () => {
    const device = identifyDeviceByPort(8883, 'mqtt', 'broker.local', '192.168.2.38');
    expect(device.protocol).toBe('mqtt-tls');
    expect(device.confidence).toBe(0.8);
  });
});
```

### Integration Tests
```javascript
describe('Network Scanning', () => {
  test('discovers devices on test network', async () => {
    const devices = await scanNetworkForDevices();
    expect(devices.length).toBeGreaterThan(0);
    expect(devices[0]).toHaveProperty('protocol');
  });
});
```

## Security Considerations

### Network Isolation
- Discovery respects network boundaries
- No cross-network scanning without explicit permission
- Firewall-aware discovery patterns

### Credential Handling
- Secure storage of API keys (SwitchBot, etc.)
- TLS certificate validation for secure connections
- Authentication token management

### Data Protection
- Discovered device data encryption at rest
- Secure transmission of device information
- Privacy-aware device identification

This implementation provides a robust, scalable discovery system that can adapt to diverse farm network configurations while maintaining security and performance.