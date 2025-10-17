# Hotfix: IoT Devices 400 Bad Request

**Date**: October 17, 2025, 6:30 PM
**Issue**: Accepting devices from Universal Scanner resulted in 400 Bad Request error

## Problem

When accepting devices in the Universal Scanner, the console showed:
```
[Error] Failed to load resource: the server responded with a status of 400 (Bad Request) (iot-devices, line 0)
[Warning] [UniversalScan] Failed to save IoT devices: "Bad Request"
```

## Root Cause

The frontend was posting to `/data/iot-devices` but the server endpoint `/data/:name` requires filenames to end with `.json`:

**server-charlie.js** (line 7637):
```javascript
app.post("/data/:name", (req, res) => {
  try {
    const name = req.params.name || "";
    if (!name.endsWith(".json")) return res.status(400).json({ ok: false, error: "Only .json files allowed" });
    // ...
  }
});
```

## Solution

Changed both POST endpoints from `/data/iot-devices` to `/data/iot-devices.json`:

### Fix 1: addDeviceToIoT() function
**File**: `public/app.charlie.js` (line 2233)

**Before**:
```javascript
const response = await fetch('/data/iot-devices', {
```

**After**:
```javascript
const response = await fetch('/data/iot-devices.json', {
```

### Fix 2: removeIoTDevice() function
**File**: `public/app.charlie.js` (line 1730)

**Before**:
```javascript
fetch('/data/iot-devices', {
```

**After**:
```javascript
fetch('/data/iot-devices.json', {
```

## Testing

1. **Refresh browser** (hard refresh: Cmd+Shift+R / Ctrl+Shift+R)
2. Navigate to Integrations panel
3. Click "Start Scan" in Universal Scanner
4. Accept a device (any device from the scan results)
5. **Verify in console**:
   - ✅ `[UniversalScan] IoT devices saved to server` (no error)
   - ❌ NO `400 Bad Request` error
6. **Verify in browser**:
   - Device removed from scan table
   - Panel switches to IoT Devices
   - Device appears as card
7. **Verify persistence**:
   - Refresh browser
   - Navigate to IoT Devices panel
   - Device still appears (loaded from file)

## Files Created

When you accept the first device, the server will create:
- `public/data/iot-devices.json`

Example content:
```json
[
  {
    "name": "GreenReach Farms",
    "brand": "Unknown",
    "vendor": "Unknown",
    "protocol": "mdns",
    "type": "mdns",
    "deviceId": "mdns:GreenReach Farms._airplay._tcp.local.",
    "address": "192.168.2.93",
    "online": true,
    "trust": "trusted",
    "category": "network-service",
    "capabilities": [],
    "discoveredAt": "2025-10-17T18:14:21.651Z",
    "acceptedAt": "2025-10-17T18:25:34.123Z"
  }
]
```

## Rollback

If issues arise:
```bash
# Revert the two-line change
git checkout HEAD -- public/app.charlie.js

# Remove test data (optional)
rm public/data/iot-devices.json

# Refresh browser
```

## Related Issues

This was discovered during testing of the main IoT devices panel fix documented in:
- `docs/IOT_DEVICES_FIX.md`

The console errors led to discovering the missing `.json` extension in the POST endpoints.
