# SwitchBot Integration Guide

## Overview

The Light Engine Charlie server includes robust SwitchBot API integration for real-time monitoring of environmental sensors and smart devices. The integration includes automatic error handling, retry logic, and graceful fallback to mock data when the SwitchBot API is unavailable.

## Features

✅ **Robust Error Handling**: Automatic retry with exponential backoff  
✅ **Graceful Degradation**: Falls back to mock data if API fails  
✅ **Configurable Timeouts**: 5-second timeout with retry logic  
✅ **Environment Control**: Can be disabled for development  
✅ **Production Ready**: Handles rate limiting and network issues  

## Configuration

### Environment Variables

```bash
# Enable/disable SwitchBot integration (default: true)
SWITCHBOT_ENABLED=true

# SwitchBot API credentials
SWITCHBOT_TOKEN=your_switchbot_token_here
SWITCHBOT_SECRET=your_switchbot_secret_here
```

### Development vs Production

**Development Mode (SwitchBot disabled):**
```bash
SWITCHBOT_ENABLED=false node server-charlie.js
```
- Returns mock data for all SwitchBot endpoints
- No external API calls made
- Stable for UI development and testing

**Production Mode (SwitchBot enabled):**
```bash
SWITCHBOT_ENABLED=true node server-charlie.js
```
- Makes real API calls to SwitchBot
- Falls back to mock data if API fails
- Includes retry logic and error handling

## API Endpoints

### Get Devices
```
GET /api/switchbot/devices
```

**Success Response (Real API):**
```json
{
  "statusCode": 100,
  "message": "success",
  "body": {
    "deviceList": [
      {
        "deviceId": "3C8427B1316E",
        "deviceName": "Living Room Sensor",
        "deviceType": "Meter Plus"
      }
    ]
  }
}
```

**Fallback Response (API Error):**
```json
{
  "statusCode": 190,
  "message": "Fallback data (SwitchBot API unavailable)",
  "body": {
    "deviceList": [
      {
        "deviceId": "fallback1",
        "deviceName": "Temp/Humidity Sensor (Offline)",
        "deviceType": "Meter"
      }
    ]
  },
  "error": "SwitchBot API timeout after 5000ms",
  "fallback": true
}
```

### Get Device Status
```
GET /api/switchbot/devices/:deviceId/status
```

**Success Response:**
```json
{
  "statusCode": 100,
  "message": "success",
  "body": {
    "deviceId": "3C8427B1316E",
    "temperature": 23.5,
    "humidity": 45,
    "battery": 85,
    "lastUpdate": "2025-09-29T21:00:00.000Z"
  }
}
```

**Fallback Response:**
```json
{
  "statusCode": 190,
  "message": "Fallback data (device unavailable)",
  "body": {
    "deviceId": "3C8427B1316E",
    "temperature": 24.2,
    "humidity": 48,
    "battery": 78,
    "lastUpdate": "2025-09-29T21:00:00.000Z",
    "offline": true
  },
  "error": "Device unavailable",
  "fallback": true
}
```

## Error Handling

### Retry Logic
- **Max Retries**: 2 attempts
- **Retry Delay**: 1 second between attempts
- **Timeout**: 5 seconds per request
- **Graceful Fallback**: Returns mock data if all retries fail

### Status Codes
- `100`: Success (real data)
- `190`: Fallback data (API unavailable)
- `500`: Server error

## Getting SwitchBot Credentials

1. Open the SwitchBot app
2. Go to **Profile** → **Preferences**
3. Tap **App Version** 5-15 times to unlock Developer Options
4. Copy the **Token** and **Secret**
5. Set them as environment variables

## Troubleshooting

### Common Issues

**Server Crashes on SwitchBot Calls:**
- **Solution**: The new implementation includes robust error handling
- **Fallback**: Set `SWITCHBOT_ENABLED=false` for development

**Rate Limiting:**
- **Built-in Protection**: Automatic retry with backoff
- **Graceful Handling**: Falls back to mock data if rate limited

**Network Timeouts:**
- **Timeout Handling**: 5-second timeout with retry
- **Fallback Data**: Returns realistic mock values

### Monitoring

Check server logs for:
```bash
# Success
[charlie] Fetching status for device: 3C8427B1316E

# Warnings (with retry)
SwitchBot API error (attempt 1): ENOTFOUND

# Fallback activated
SwitchBot devices API error: SwitchBot API timeout after 5000ms
```

## Integration Examples

### Client-Side Usage

```javascript
// Fetch devices with error handling
async function getSwitchBotDevices() {
  try {
    const response = await fetch('/api/switchbot/devices');
    const data = await response.json();
    
    if (data.fallback) {
      console.warn('Using fallback data:', data.message);
      showOfflineIndicator();
    }
    
    return data.body.deviceList;
  } catch (error) {
    console.error('Failed to fetch SwitchBot devices:', error);
    return [];
  }
}

// Check if data is live or fallback
function isLiveData(response) {
  return response.statusCode === 100 && !response.fallback;
}
```

### Server-Side Monitoring

```javascript
// Add health check for SwitchBot integration
app.get('/health/switchbot', async (req, res) => {
  try {
    const response = await switchBotApiRequest('/devices');
    res.json({ 
      status: 'healthy', 
      api: 'available',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'degraded', 
      api: 'unavailable',
      error: error.message,
      fallback: 'enabled'
    });
  }
});
```

## Summary

The SwitchBot integration is now **production-ready** with:
- ✅ **No more server crashes**
- ✅ **Graceful error handling** 
- ✅ **Automatic fallback to mock data**
- ✅ **Configurable for development/production**
- ✅ **Real-time monitoring capabilities**

The system will continue to function even when SwitchBot API is unavailable, providing a stable foundation for your grow room monitoring dashboard.