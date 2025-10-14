# Farm Automation System - Sensor-Triggered Kasa & SwitchBot Control

## Overview

Light Engine Charlie now includes a sophisticated automation rules engine that connects sensor data from multiple sources (SwitchBot devices, IFTTT services, environmental sensors) to trigger automated control of Kasa smart plugs, SwitchBot devices, and custom scenarios.

## Key Features

### 🔄 **Multi-Source Sensor Integration**
- **SwitchBot**: Temperature, humidity, motion, contact sensors
- **IFTTT Services**: Weather data, calendar events, location triggers
- **Environmental Ingest**: Farm zone temperature, humidity, CO2, VPD readings
- **Manual Testing**: API endpoints for testing automation rules

### 🎯 **Smart Device Control**
- **Kasa Devices**: Smart plugs, switches, dimmers via TP-Link API
- **SwitchBot Devices**: Plugs, bots, sensors via SwitchBot Cloud API  
- **IFTTT Triggers**: Send data back to IFTTT for external integrations
- **Notification Actions**: Console logging (extensible to email/SMS)

### 🧠 **Intelligent Rule Engine**
- **Conditional Logic**: Temperature thresholds, time ranges, multi-sensor conditions
- **Debouncing**: Prevent rapid repeated triggering (configurable per rule)
- **Scheduling**: Time-based activation windows and day-of-week filtering
- **Scenarios**: Multi-step coordinated device actions
- **History Tracking**: Complete audit log of rule executions

## Quick Start

### 1. Default Rules (Pre-configured)

The system includes three default automation rules for common farm scenarios:

```javascript
// High temperature triggers exhaust fans
"high-temp-exhaust": {
  trigger: { type: 'temperature', value: { operator: 'gt', threshold: 28 } },
  actions: [
    { type: 'kasa_control', deviceId: 'exhaust-fan-kasa', command: 'turnOn' },
    { type: 'ifttt_trigger', event: 'farm_alert_high_temp' }
  ]
}

// Low humidity activates misters (daylight hours only)
"low-humidity-misters": {
  trigger: { type: 'humidity', value: { operator: 'lt', threshold: 60 } },
  actions: [{ type: 'switchbot_control', deviceId: 'mister-switchbot', command: 'turnOn' }],
  conditions: { timeRange: { start: 6, end: 20 } }
}

// Motion detection triggers security lighting (nighttime only)
"motion-security-lights": {
  trigger: { type: 'motion', value: { operator: 'eq', threshold: 1 } },
  actions: [{ type: 'scenario', scenarioId: 'security-lighting' }],
  conditions: { timeRange: { start: 20, end: 6 } }
}
```

### 2. IFTTT Integration Patterns

#### Common IFTTT Webhook Events:
- `weather_temp_change` → Temperature sensor data
- `weather_humidity_change` → Humidity sensor data  
- `motion_detected` → Motion sensor triggers
- `schedule_trigger` → Calendar/time-based events
- `light_level_change` → Ambient light sensors

#### Sample IFTTT Applet Setup:
```
IF: Weather Underground "Current condition changes to"
THEN: Webhooks "Make a web request"
  URL: https://your-domain.com/integrations/ifttt/incoming/weather_temp_change
  Method: POST
  Body: {"value1": "{{TempCelsius}}", "device_id": "outdoor_weather"}
```

### 3. Environmental Sensor Data

Send sensor readings to trigger automations:

```bash
curl -X POST http://127.0.0.1:8091/env \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "greenhouse-1",
    "sensors": {
      "temp": 32.5,
      "rh": 45,
      "co2": 1200
    },
    "meta": {
      "name": "Main Greenhouse",
      "source": "switchbot"
    }
  }'
```

## API Reference

### Rule Management

#### Get All Rules
```bash
GET /api/automation/rules
```

#### Add/Update Rule
```bash
POST /api/automation/rules
Content-Type: application/json

{
  "id": "custom-rule-1",
  "name": "High CO2 → Ventilation",
  "trigger": {
    "type": "co2",
    "value": { "operator": "gt", "threshold": 1500 }
  },
  "actions": [
    {
      "type": "kasa_control",
      "deviceId": "ventilation-fan",
      "command": "turnOn"
    },
    {
      "type": "notification", 
      "title": "High CO2 Alert",
      "message": "CO2 level {value} ppm in {deviceId}"
    }
  ],
  "conditions": {
    "timeRange": { "start": 6, "end": 22 }
  },
  "options": {
    "debounceMs": 600000
  }
}
```

#### Enable/Disable Rule
```bash
PATCH /api/automation/rules/custom-rule-1
Content-Type: application/json

{ "enabled": false }
```

#### Delete Rule
```bash
DELETE /api/automation/rules/custom-rule-1
```

### Monitoring & Testing

#### View Execution History
```bash
GET /api/automation/history?limit=50
```

#### View Current Sensor States
```bash
GET /api/automation/sensors
```

#### Test Rule with Sample Data
```bash
POST /api/automation/test
Content-Type: application/json

{
  "sensorData": {
    "source": "test",
    "deviceId": "greenhouse-1", 
    "type": "temperature",
    "value": 35.0
  }
}
```

#### Manually Trigger Specific Rule
```bash
POST /api/automation/trigger/high-temp-exhaust
```

## Rule Configuration Guide

### Trigger Conditions

```javascript
{
  "trigger": {
    "source": "switchbot",           // Optional: filter by data source
    "deviceId": "temp-sensor-1",     // Optional: specific device
    "type": "temperature",           // Required: sensor type
    "value": {                       // Optional: value conditions
      "operator": "gt",              // gt, gte, lt, lte, eq, neq, between, outside
      "threshold": 28,               // For single threshold
      "range": { "min": 20, "max": 25 } // For between/outside
    }
  }
}
```

### Action Types

#### Kasa Device Control
```javascript
{
  "type": "kasa_control",
  "deviceId": "smart-plug-1",
  "command": "turnOn",           // turnOn, turnOff, toggle
  "parameters": {               // Optional additional parameters
    "brightness": 80            // For dimmable devices
  }
}
```

#### SwitchBot Device Control
```javascript
{
  "type": "switchbot_control", 
  "deviceId": "bot-device-1",
  "command": "press",           // Device-specific commands
  "parameter": "default"       // Optional parameter
}
```

#### IFTTT Trigger
```javascript
{
  "type": "ifttt_trigger",
  "event": "farm_alert",
  "data": {
    "value1": "Alert message",
    "value2": "Additional data",
    "value3": "Third field"
  }
}
```

#### Notifications
```javascript
{
  "type": "notification",
  "title": "Farm Alert",
  "message": "Temperature is {value}°C in {deviceId}",
  "iftttEvent": "notification_alert"  // Optional: also send via IFTTT
}
```

#### Multi-Step Scenarios
```javascript
{
  "type": "scenario",
  "scenarioId": "security-lighting",
  "parameters": {
    "duration": 600000  // Override scenario defaults
  }
}
```

### Advanced Conditions

#### Time-Based Scheduling
```javascript
{
  "conditions": {
    "timeRange": { 
      "start": 6,    // Hour (24h format)
      "end": 20      // Hour (24h format)
    }
  },
  "schedule": {
    "hours": { "start": 8, "end": 18 },
    "days": [1, 2, 3, 4, 5]  // Monday-Friday (0=Sunday)
  }
}
```

#### Debouncing & Rate Limiting
```javascript
{
  "options": {
    "debounceMs": 300000  // 5 minutes between executions
  }
}
```

## Device Integration Examples

### SwitchBot Temperature Sensor → Kasa Fan Control

1. **Setup SwitchBot API** (if not already configured):
   ```bash
   # Add SwitchBot credentials to environment
   export SWITCHBOT_TOKEN="your_token"
   export SWITCHBOT_SECRET="your_secret"
   ```

2. **Create Automation Rule**:
   ```bash
   curl -X POST http://127.0.0.1:8091/api/automation/rules \
     -H "Content-Type: application/json" \
     -d '{
       "id": "switchbot-temp-fan",
       "name": "SwitchBot Temp → Kasa Fan",
       "trigger": {
         "source": "switchbot",
         "type": "temperature", 
         "value": { "operator": "gt", "threshold": 26 }
       },
       "actions": [
         {
           "type": "kasa_control",
           "deviceId": "ceiling-fan-kasa",
           "command": "turnOn"
         }
       ],
       "options": { "debounceMs": 180000 }
     }'
   ```

### IFTTT Weather → Irrigation Control

1. **Setup IFTTT Applet**:
   - **IF**: Weather Underground "Today's weather report"
   - **THEN**: Webhooks POST to `https://your-domain.com/integrations/ifttt/incoming/weather_humidity_change`
   - **Body**: `{"value1": "{{HumidityPercentage}}", "device_id": "outdoor_weather"}`

2. **Create Automation Rule**:
   ```bash
   curl -X POST http://127.0.0.1:8091/api/automation/rules \
     -H "Content-Type: application/json" \
     -d '{
       "id": "weather-irrigation",
       "name": "Low Outdoor Humidity → Irrigation",
       "trigger": {
         "source": "ifttt-weather",
         "type": "humidity",
         "value": { "operator": "lt", "threshold": 40 }
       },
       "actions": [
         {
           "type": "switchbot_control",
           "deviceId": "irrigation-valve",
           "command": "turnOn"
         },
         {
           "type": "ifttt_trigger", 
           "event": "irrigation_started",
           "data": { "value1": "Low humidity irrigation activated" }
         }
       ],
       "conditions": {
         "timeRange": { "start": 6, "end": 10 }
       }
     }'
   ```

### Motion Sensor → Security Scenario

1. **Create Security Lighting Scenario** (modify `/lib/automation-engine.js`):
   ```javascript
   // Add to getScenario() method
   'security-lighting': {
     steps: [
       { type: 'kasa_control', deviceId: 'porch-light', command: 'turnOn' },
       { type: 'kasa_control', deviceId: 'garage-light', command: 'turnOn' },
       { type: 'switchbot_control', deviceId: 'camera-bot', command: 'turnOn' },
       { type: 'ifttt_trigger', event: 'security_alert', data: { value1: 'Motion detected' } },
       { delay: 600000 }, // 10 minute delay
       { type: 'kasa_control', deviceId: 'porch-light', command: 'turnOff' },
       { type: 'kasa_control', deviceId: 'garage-light', command: 'turnOff' }
     ]
   }
   ```

## Troubleshooting

### Check Rule Status
```bash
# View all rules and their enabled status
curl http://127.0.0.1:8091/api/automation/rules | jq '.rules[] | {id, name, enabled}'

# View recent executions
curl http://127.0.0.1:8091/api/automation/history | jq '.history[0:5]'
```

### Test Device Connections
```bash
# Test Kasa device discovery
curl http://127.0.0.1:8091/api/kasa/devices

# Test SwitchBot device list  
curl http://127.0.0.1:8091/api/switchbot/devices

# Test IFTTT integration
curl http://127.0.0.1:8091/integrations/ifttt/status
```

### Debug Sensor Data Flow
```bash
# Send test sensor data
curl -X POST http://127.0.0.1:8091/api/automation/test \
  -H "Content-Type: application/json" \
  -d '{
    "sensorData": {
      "source": "debug",
      "deviceId": "test-sensor",
      "type": "temperature", 
      "value": 30.0
    }
  }'

# Check if it triggered any rules in the history
curl http://127.0.0.1:8091/api/automation/history | jq '.history[0]'
```

## Environment Variables

```bash
# IFTTT Integration
IFTTT_KEY=your_ifttt_webhook_key           # Required for outbound IFTTT triggers
IFTTT_INBOUND_TOKEN=your_secure_token      # Optional: secures inbound webhooks

# SwitchBot Integration  
SWITCHBOT_TOKEN=your_switchbot_token       # Required for SwitchBot API
SWITCHBOT_SECRET=your_switchbot_secret     # Required for SwitchBot API

# Server Configuration
PORT=8091                                  # Server port (default: 8091)
```

## Best Practices

### 1. **Debouncing**
- Use appropriate debounce intervals to prevent spam (e.g., 5-10 minutes for temperature)
- Shorter intervals for critical alerts (30 seconds for motion/security)

### 2. **Time Constraints**
- Add time ranges to prevent inappropriate activations
- Consider seasonal schedules for outdoor sensors

### 3. **Fail-Safe Conditions**
- Include multiple sensor validation for critical actions
- Add manual override capabilities for safety systems

### 4. **Testing Strategy**
- Test rules with `/api/automation/test` before deployment
- Monitor execution history for unexpected behavior
- Use manual triggers for validation

### 5. **Device Reliability**
- Implement error handling in automation actions
- Consider backup device actions for critical systems
- Monitor device connectivity through status endpoints

This automation system transforms Light Engine Charlie into a comprehensive IoT orchestration platform, enabling sophisticated sensor-driven automations across your entire farm infrastructure.