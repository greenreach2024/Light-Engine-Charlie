# Light Engine Charlie - Deep Discovery System

## Overview
The Light Engine now includes a comprehensive deep search discovery system that can automatically detect, identify, and categorize IoT devices across multiple protocols on farm networks.

## 🔍 Deep Discovery Capabilities

### Network Scanning
- **Automatic network range detection** based on current interface
- **Port scanning** for common IoT device ports:
  - `80, 443` - Web interfaces (HTTP/HTTPS)
  - `8080, 8081` - Alternative web ports
  - `1883, 8883` - MQTT (standard and secure)
  - `502` - Modbus TCP (industrial/agricultural)
  - `9999, 10002` - Custom IoT protocols
  - `8000` - Development/management interfaces

### Device Type Identification
The system automatically identifies device types based on:
- **Port patterns** and service fingerprints
- **Service version detection** (e.g., lighttpd, nginx, mosquitto)
- **Protocol analysis** (MQTT broker, web server, Modbus device)
- **Vendor identification** where possible

### Supported Protocols
1. **MQTT** - Farm sensor/actuator communication
2. **HTTP/HTTPS** - Web-based IoT devices
3. **Modbus TCP** - Industrial/agricultural equipment
4. **SwitchBot Cloud** - Commercial IoT devices
5. **TP-Link Kasa** - Smart home/lighting devices
6. **Bluetooth LE** - Proximity sensors and beacons
7. **mDNS/Bonjour** - Network service discovery

## 🚀 Discovery Process

### 1. Network Discovery
```javascript
// Auto-detect current network range
const networkBase = getCurrentNetworkRange();
// Scan for devices with IoT ports open
const devices = await scanNetworkForDevices();
```

### 2. Device Analysis
```javascript
// Categorize discovered devices
const analysis = analyzeDiscoveredDevices(devices);
// Generate setup wizard suggestions
const wizards = analysis.suggestedWizards;
```

### 3. Setup Wizard Suggestions
Based on discovered devices, the system suggests:
- **MQTT Integration Wizard** (for MQTT brokers)
- **Web Device Setup** (for HTTP/HTTPS devices)
- **Industrial Device Integration** (for Modbus devices)
- **SwitchBot Setup** (for cloud-connected devices)
- **Kasa Device Configuration** (for smart lighting)

## 📊 Device Categories

### Farm Communication Hub
- **MQTT Brokers** (ports 1883, 8883)
- **Capabilities**: Real-time sensor data, device messaging
- **Example**: `192.168.2.38:8883` (Secure MQTT with TLS)

### Web-Enabled Controllers
- **HTTP/HTTPS Devices** (ports 80, 443, 8080)
- **Capabilities**: Web interface, configuration, monitoring
- **Example**: `192.168.2.80:80` (lighttpd controller)

### Industrial/Agricultural Equipment
- **Modbus Devices** (port 502)
- **Capabilities**: Sensor reading, equipment control
- **Use Cases**: Environmental sensors, irrigation systems

### Smart Lighting/Power
- **Kasa Devices** (WiFi-based)
- **Capabilities**: Lighting control, power monitoring
- **Integration**: Auto-discovery and room assignment

### Cloud IoT Devices
- **SwitchBot** (Cloud API)
- **Capabilities**: Environmental monitoring, automation
- **Integration**: API credential configuration

## 🔧 API Endpoints

### Discovery Endpoint
```
GET /discovery/devices
```
Returns:
```json
{
  "startedAt": "2025-09-30T...",
  "completedAt": "2025-09-30T...",
  "devices": [...],
  "analysis": {
    "summary": {
      "totalDevices": 3,
      "protocolCount": 3,
      "vendorCount": 2
    },
    "protocols": {
      "mqtt": 1,
      "http": 1,
      "switchbot": 5
    },
    "suggestedWizards": [
      {
        "id": "mqtt-setup",
        "name": "MQTT Device Integration",
        "priority": "high",
        "deviceCount": 1,
        "capabilities": ["messaging", "sensor-data"]
      }
    ]
  }
}
```

### Protocol-Specific Endpoints
- `GET /api/devices/kasa` - TP-Link Kasa devices
- `GET /api/devices/mqtt` - MQTT devices
- `GET /api/devices/ble` - Bluetooth LE devices
- `GET /api/devices/mdns` - mDNS services

## 🌐 Real-World Testing

### Greenreach Farm Network Results
- **Network**: 192.168.2.0/24 (Greenreach WiFi)
- **Devices Found**: 20+ active network devices
- **IoT Devices Identified**: 3 key devices
  - MQTT Broker: `192.168.2.38:8883`
  - Web Controller: `192.168.2.80:80`
  - Network Gateway: `192.168.2.1:80,443`

### Setup Wizards Generated
1. **MQTT Farm Integration** (High Priority)
2. **Farm Controller Web Interface** (High Priority)
3. **SwitchBot Cloud Integration** (Medium Priority)
4. **Network Infrastructure Setup** (Medium Priority)

## 💡 Usage

### For Farm Setup
1. Connect to farm WiFi network
2. Run device discovery: `GET /discovery/devices`
3. Review suggested setup wizards
4. Follow wizard flows for each device type
5. Configure automation rules and monitoring

### For Development
1. The discovery system automatically adapts to any network
2. Device types are identified based on service patterns
3. Setup wizards are dynamically generated based on findings
4. All discovery is live - no mock data or fallbacks

## 🔐 Security Considerations

- **TLS/SSL Support** for secure MQTT connections
- **Authentication handling** for web-based devices
- **Network segmentation** awareness
- **Certificate management** for secure protocols

## 🚀 Future Enhancements

- **Zigbee/Z-Wave** protocol support
- **BACnet** for building automation
- **LoRaWAN** for long-range sensors
- **Machine learning** device classification
- **Automated vulnerability scanning**

---

This deep discovery system transforms the Light Engine into a comprehensive IoT device detection and integration platform, capable of automatically discovering and configuring diverse farm equipment and sensors.