# Azure SwitchBot Integration Guide

## Overview
Configure Light Engine Charlie to pull SwitchBot environmental data from Azure instead of local polling.

## Current Azure Resources
Based on your resource query, you have:
- **IoT Hub**: `GreenReach` (eastus)
- **Storage Account**: `grtelemetry806819540` (currently disabled)
- **Storage Account**: `grfiles1756059941` (eastus)

## Integration Options

### Option 1: Use Azure Functions (Recommended)

Create an Azure Function that:
1. Polls SwitchBot API (respecting rate limits)
2. Stores data in Azure Storage or Cosmos DB
3. Provides an HTTP endpoint for Light Engine Charlie

**Expected API Response Format:**
```json
[
  {
    "zone": "Living Room",
    "deviceId": "sensor-001",
    "temperature": 23.5,
    "humidity": 45,
    "co2": 420,
    "battery": 85,
    "rssi": -45,
    "timestamp": "2025-09-29T18:52:40.387Z"
  }
]
```

### Option 2: Use IoT Hub with Event Hub Endpoint

Configure your existing IoT Hub to:
1. Receive SwitchBot data via device connections
2. Route data to Event Hub or Storage
3. Create Azure Function to serve latest readings

### Option 3: Direct Storage Access

Store SwitchBot data in Azure Storage and:
1. Use Blob Storage for time-series data
2. Create Azure Function to query latest readings
3. Return formatted data for Light Engine Charlie

## Configuration

### Environment Variables
Set these on your Light Engine Charlie server:

```bash
ENV_SOURCE=azure
AZURE_LATEST_URL=https://your-function-app.azurewebsites.net/api/telemetry
```

### Server Restart
```bash
cd /Users/petergilbert/Desktop/GreenReach/Light-Engine-Charlie
ENV_SOURCE=azure AZURE_LATEST_URL=your-azure-url node server-charlie.js
```

## Sample Azure Function Code

```javascript
module.exports = async function (context, req) {
    // Query your data source (Storage, Cosmos DB, etc.)
    const telemetryData = await getLatestTelemetry();
    
    // Transform to expected format
    const zones = telemetryData.map(reading => ({
        zone: reading.zone || 'SwitchBot',
        deviceId: reading.deviceId,
        temperature: reading.temperature,
        humidity: reading.humidity,
        co2: reading.co2,
        battery: reading.battery,
        rssi: reading.rssi,
        timestamp: reading.timestamp
    }));
    
    context.res = {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        body: zones
    };
};
```

## Next Steps

1. **Create Azure Function**: Deploy a function to serve SwitchBot data
2. **Configure Data Storage**: Set up reliable storage for telemetry data
3. **Update Environment**: Set ENV_SOURCE=azure and AZURE_LATEST_URL
4. **Test Integration**: Verify data flows from Azure to dashboard

## Troubleshooting

- **Storage Account Disabled**: `grtelemetry806819540` is currently disabled. Enable it or use a different storage solution.
- **Rate Limiting**: Ensure Azure-side polling respects SwitchBot API limits
- **CORS**: Make sure Azure Function allows cross-origin requests from your dashboard