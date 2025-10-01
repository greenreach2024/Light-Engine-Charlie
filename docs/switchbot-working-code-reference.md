# SwitchBot Real Device Integration - Working Code Reference

## Date: September 30, 2025
## Status: WORKING CODE FROM LAST NIGHT

This document captures the working SwitchBot integration that was successfully pulling real device data.

## Working Client Code (app.charlie 2.js)

The `addDemoSwitchBotDevices()` function was successfully fetching real devices:

```javascript
async addDemoSwitchBotDevices() {
  try {
    // Fetch real SwitchBot devices from the API
    const response = await fetch('/api/switchbot/devices?refresh=1');
    if (!response.ok) {
      throw new Error(`SwitchBot API returned HTTP ${response.status}`);
    }
    const data = await response.json();
    const meta = data.meta || {};

    if (meta.cached && meta.stale) {
      console.warn('SwitchBot API returned stale cached data:', meta.error || 'Unknown error');
    } else if (meta.cached) {
      console.info('Using cached SwitchBot device list (within TTL).');
    }

    if (data.statusCode === 100 && data.body && data.body.deviceList) {
      const realDevices = data.body.deviceList;

      // Clear existing devices and add real ones
      this.data.devices = [];

      realDevices.forEach((device, index) => {
        const demoDevice = {
          name: device.deviceName || `Farm Device ${index + 1}`,
          vendor: 'SwitchBot',
          model: device.deviceType,
          host: 'switchbot-demo-token',
          switchBotId: device.deviceId,
          hubId: device.hubDeviceId,
          setup: this.getSetupForDeviceType(device.deviceType),
          isReal: true,
          realDeviceData: device
        };
        this.data.devices.push(demoDevice);
      });
      
      console.log(`✅ Loaded ${realDevices.length} SwitchBot device(s) for demo`, meta);

    } else {
      throw new Error('Failed to load real devices');
    }
  } catch (error) {
    console.error('Failed to load real SwitchBot devices, using fallback:', error);
    // Fallback to mock data if real API fails
    this.addFallbackDemoDevices();
  }

  // Set shared SwitchBot configuration regardless of real vs fallback
  this.setupSwitchBotConfiguration();
}
```

## Key Success Factors

1. **API Endpoint**: `/api/switchbot/devices?refresh=1` (with refresh=1 to bypass cache)
2. **Expected Response Format**: 
   ```json
   {
     "statusCode": 100,
     "body": {
       "deviceList": [
         {
           "deviceId": "actual-device-id",
           "deviceName": "actual-device-name", 
           "deviceType": "actual-device-type",
           "hubDeviceId": "hub-id-or-null"
         }
       ]
     },
     "meta": {
       "cached": false,
       "stale": false
     }
   }
   ```

3. **Device Mapping**: Each real device gets mapped to internal format with:
   - `isReal: true` flag
   - `realDeviceData: device` (original API response)
   - `switchBotId: device.deviceId`

## What Was Working Last Night

- SwitchBot API credentials: Valid and authenticated
- Rate limiting: Working properly (HTTP 429 responses confirm authentication)
- Client code: Correctly processing real device responses
- Server endpoint: Returning actual device data (not mock data)

## Current Issue

The server is now returning fallback mock data instead of waiting for rate limits to clear and returning real devices. The server needs to:

1. Wait for rate limits to clear
2. Make actual API calls to SwitchBot
3. Return real device data instead of mock data
4. Only use fallback when API is genuinely unavailable (not just rate limited)

## Credentials Used
- Token: 4e6fc805b4a0dd7ed693af1dcf89d9731113d4706b2d796759aafe09cf8f07aed370d35bab4fb4799e1bda57d03c0aed
- Secret: 141c0bc9906ab1f4f73dd9f0c298046b

## Action Required

Fix the server to stop returning mock data and wait for real SwitchBot API responses.