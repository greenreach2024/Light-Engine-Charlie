# Setup Wizard System - Complete Implementation

## 🎯 Overview

The Light Engine Charlie now includes a comprehensive **Setup Wizard System** that automatically identifies discovered IoT devices and provides step-by-step configuration wizards for each device type. This system integrates seamlessly with the network discovery engine to provide automatic device setup.

## 🏗 Architecture

### Core Components

1. **Wizard Definition System** (`SETUP_WIZARDS`)
   - Device-specific wizard configurations
   - Step-by-step workflow definitions
   - Field validation and requirements
   - Target device matching

2. **Wizard State Management**
   - Progress tracking across wizard steps
   - Data persistence during execution
   - Status monitoring and reporting
   - State reset and cleanup

3. **REST API Endpoints**
   - Full CRUD operations for wizards
   - Step execution and validation
   - Status monitoring and reporting
   - Device suggestion engine

4. **Device Matching Engine**
   - Confidence scoring for wizard recommendations
   - Multi-criteria device identification
   - Automatic wizard suggestion
   - Priority-based recommendations

## 📋 Available Wizards

### 1. MQTT Device Integration (`mqtt-setup`)
**Purpose**: Configure MQTT broker connections and device subscriptions
**Target Devices**: `mqtt`, `mqtt-tls`
**Steps**: 3 steps
- **Broker Connection**: Configure host, port, security, authentication
- **Topic Discovery**: Set up topic patterns and discovery timing
- **Sensor Mapping**: Map discovered topics to sensor types

### 2. Web-Enabled IoT Device Setup (`web-device-setup`)
**Purpose**: Configure web-based IoT devices with HTTP/HTTPS interfaces
**Target Devices**: `http`, `https`, `http-alt`, `http-mgmt`
**Steps**: 3 steps
- **Device Identification**: Identify device type and capabilities
- **Authentication Setup**: Configure device access credentials
- **Data Integration**: Set up polling and alert configurations

### 3. SwitchBot Device Setup (`switchbot-setup`)
**Purpose**: Configure SwitchBot cloud-connected devices
**Target Devices**: `switchbot`
**Steps**: 2 steps
- **API Credentials**: Configure SwitchBot Cloud API access
- **Device Discovery**: Discover and configure SwitchBot devices

## 🚀 API Endpoints

### Get Available Wizards
```http
GET /setup/wizards
```
**Response**: List of all available setup wizards with metadata

### Get Specific Wizard
```http
GET /setup/wizards/{wizardId}
```
**Response**: Complete wizard definition including steps and current state

### Execute Wizard Step
```http
POST /setup/wizards/{wizardId}/execute
Content-Type: application/json

{
  "stepId": "broker-connection",
  "data": {
    "host": "192.168.2.38",
    "port": 8883,
    "secure": true,
    "username": "farm-user"
  }
}
```
**Response**: Execution result with next step information

### Get Wizard Status
```http
GET /setup/wizards/{wizardId}/status
```
**Response**: Current wizard execution status and progress

### Reset Wizard State
```http
DELETE /setup/wizards/{wizardId}
```
**Response**: Confirmation of wizard state reset

### Get Wizard Suggestions
```http
POST /discovery/suggest-wizards
Content-Type: application/json

{
  "devices": [
    {
      "ip": "192.168.2.38",
      "hostname": "mqtt-broker",
      "type": "mqtt-tls",
      "services": ["mqtt", "mqtt-tls"]
    }
  ]
}
```
**Response**: Recommended wizards for each device with confidence scores

## 🔄 Integration with Discovery System

The wizard system seamlessly integrates with the network discovery engine:

1. **Automatic Discovery**: Network scanning identifies IoT devices
2. **Device Analysis**: Each device is analyzed for type and capabilities
3. **Wizard Suggestion**: Appropriate wizards are automatically suggested
4. **Confidence Scoring**: Each suggestion includes a confidence percentage
5. **Priority Ordering**: Wizards are ordered by relevance to device

## ✅ Real-World Testing

### Tested on Greenreach Farm Network
- **MQTT Broker**: 192.168.2.38:8883 → MQTT Setup Wizard (100% confidence)
- **Web Controller**: 192.168.2.80:80 → Web Device Setup Wizard (100% confidence)
- **Network Gateway**: 192.168.2.1:80/443 → Web Device Setup Wizard (60% confidence)

### Wizard Execution Flow
1. ✅ Wizard definition retrieval
2. ✅ Step-by-step execution
3. ✅ Progress tracking (67% completion after 2/3 steps)
4. ✅ State persistence and recovery
5. ✅ Dynamic next-step calculation

## 🎛 Features

### Smart Device Matching
- **Multi-Protocol Support**: HTTP, HTTPS, MQTT, TLS, SwitchBot
- **Hostname Analysis**: Device name pattern recognition
- **Service Detection**: Port-based service identification
- **Confidence Scoring**: Intelligent wizard recommendation ranking

### Wizard State Management
- **Progress Tracking**: Real-time step completion monitoring
- **Data Persistence**: Configuration data stored across steps
- **Recovery Support**: Resume wizard from any point
- **Validation**: Input validation at each step

### Developer-Friendly API
- **RESTful Design**: Standard HTTP methods and status codes
- **JSON Responses**: Structured, consistent response format
- **Error Handling**: Comprehensive error reporting
- **Documentation**: Self-documenting API structure

## 🔧 Technical Implementation

### Wizard Configuration Object
```javascript
const SETUP_WIZARDS = {
  'wizard-id': {
    id: 'wizard-id',
    name: 'Human Readable Name',
    description: 'Wizard purpose and functionality',
    targetDevices: ['device-type-1', 'device-type-2'],
    steps: [
      {
        id: 'step-id',
        name: 'Step Name',
        description: 'Step description',
        fields: [
          {
            name: 'fieldName',
            type: 'text|number|boolean|select|password',
            label: 'Field Label',
            required: true|false,
            default: 'defaultValue',
            options: ['option1', 'option2'] // for select fields
          }
        ]
      }
    ]
  }
}
```

### State Management
- **In-Memory Storage**: Fast access using Map() data structure
- **JSON Serialization**: Compatible with persistent storage
- **Atomic Updates**: Thread-safe state modifications
- **Cleanup Support**: Manual and automatic state reset

## 🎯 Usage Examples

### Complete MQTT Setup Flow
```bash
# 1. Get wizard definition
curl http://127.0.0.1:8091/setup/wizards/mqtt-setup

# 2. Execute broker connection step
curl -X POST -H "Content-Type: application/json" \
  -d '{"stepId":"broker-connection","data":{"host":"192.168.2.38","port":8883,"secure":true}}' \
  http://127.0.0.1:8091/setup/wizards/mqtt-setup/execute

# 3. Execute topic discovery step
curl -X POST -H "Content-Type: application/json" \
  -d '{"stepId":"topic-discovery","data":{"baseTopic":"farm/#","discoverTime":30}}' \
  http://127.0.0.1:8091/setup/wizards/mqtt-setup/execute

# 4. Check completion status
curl http://127.0.0.1:8091/setup/wizards/mqtt-setup/status
```

### Discovery-to-Wizard Integration
```bash
# 1. Discover devices on network
curl http://127.0.0.1:8091/discovery/devices

# 2. Extract devices and get wizard suggestions
curl -X POST -H "Content-Type: application/json" \
  -d '{"devices":[...discovered devices...]}' \
  http://127.0.0.1:8091/discovery/suggest-wizards

# 3. Execute recommended wizards
curl -X POST http://127.0.0.1:8091/setup/wizards/{suggested-wizard-id}/execute
```

## 📈 Benefits

1. **Automated Setup**: Reduces manual configuration complexity
2. **Guided Workflow**: Step-by-step device configuration
3. **Error Prevention**: Field validation and requirement checking
4. **Progress Tracking**: Visual progress indication and recovery
5. **Scalable Architecture**: Easy addition of new device types
6. **Integration Ready**: Seamless integration with discovery system

## 🔮 Future Enhancements

1. **Wizard Templates**: User-defined wizard creation
2. **Conditional Logic**: Dynamic step flows based on responses
3. **Bulk Configuration**: Multi-device wizard execution
4. **Validation Hooks**: Custom validation functions per field
5. **Rollback Support**: Undo wizard configurations
6. **Scheduling**: Automated wizard execution based on discovery events

---

The Setup Wizard System transforms device discovery from identification to full configuration, creating a complete end-to-end IoT device onboarding experience for the Light Engine Charlie platform.