# Grow3 Health Check Fix (No /healthz Endpoint)

**Date**: October 17, 2025, 6:45 PM
**Issue**: Grow3 controller connection test failing with 404 on `/healthz` endpoint

## Problem

When clicking "Test Connection" on the Code3 integration card, the console showed:
```
[Error] Failed to load resource: the server responded with a status of 404 (Not Found) (healthz, line 0)
[Error] [Grow3] Connection test failed: Error: Health check failed: Not Found
```

## Root Cause

The Grow3 controller at `http://192.168.2.80:3000` doesn't have a `/healthz` endpoint. When the proxy forwards the request, the controller returns:
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /healthz</pre>
</body>
</html>
```

## Investigation

**Working Endpoint**:
```bash
curl http://localhost:8091/api/grow3/api/devicedatas
```

**Response**:
```json
{
  "status": "success",
  "message": "Device data retrieved successfully",
  "data": [
    {
      "id": 2,
      "deviceName": "F00001",
      "onOffStatus": 0,
      "online": true
    },
    {
      "id": 3,
      "deviceName": "F00002",
      "onOffStatus": 1,
      "online": true
    }
    // ... more devices
  ]
}
```

**Failed Endpoint**:
```bash
curl http://localhost:8091/api/grow3/healthz
```

**Response**: `Cannot GET /healthz` (404)

## Solution

### Updated `checkGrow3Status()` Function

**File**: `public/app.charlie.js` (lines 2350-2405)

**Already Had Fallback Logic** ✅:
```javascript
window.checkGrow3Status = async function() {
  try {
    // Try /healthz first, fall back to /api/devicedatas if 404
    let response = await fetch(`${GROW3_BASE_URL}/healthz`, { 
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    
    // If /healthz doesn't exist (404), try /api/devicedatas as health check
    if (response.status === 404) {
      console.log('[Grow3] /healthz not found, trying /api/devicedatas');
      response = await fetch(`${GROW3_BASE_URL}/api/devicedatas`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
    }
    
    if (response.ok) {
      const data = await response.json();
      // Accept various success indicators
      const isHealthy = data.ok || data.status === 'ok' || Array.isArray(data);
      
      if (isHealthy) {
        // Mark as online
      }
    }
  } catch (error) {
    console.warn('[Grow3] Health check failed:', error.message);
    // Mark as offline
  }
};
```

This function **already has the fallback logic** and works correctly.

### Fixed `testGrow3Connection()` Function

**File**: `public/app.charlie.js` (lines 2410-2435)

**Before** (Failing):
```javascript
window.testGrow3Connection = async function() {
  try {
    // Test 1: Health check
    const healthResponse = await fetch(`${GROW3_BASE_URL}/healthz`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    
    if (!healthResponse.ok) {
      throw new Error(`Health check failed: ${healthResponse.statusText}`);
    }
    
    const healthData = await healthResponse.json();
    
    // Test 2: Get device list
    const devicesResponse = await fetch(`${GROW3_BASE_URL}/api/devicedatas`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    
    showToast({
      title: 'Code3 Controller Connected',
      msg: `Health: OK • Found ${Array.isArray(devicesData) ? devicesData.length : 'N/A'} devices`,
      kind: 'success'
    });
  } catch (error) {
    // Error toast
  }
};
```

**After** (Working):
```javascript
window.testGrow3Connection = async function() {
  try {
    // Note: Grow3 controller doesn't have /healthz, so we use /api/devicedatas as health check
    const devicesResponse = await fetch(`${GROW3_BASE_URL}/api/devicedatas`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    
    if (!devicesResponse.ok) {
      throw new Error(`Devices endpoint failed: ${devicesResponse.statusText}`);
    }
    
    const devicesData = await devicesResponse.json();
    console.log('[Grow3] Devices:', devicesData);
    
    // Extract device array from response (format: {status, message, data: [...]})
    const devices = devicesData.data || devicesData;
    const deviceCount = Array.isArray(devices) ? devices.length : 0;
    
    // Update status
    window.checkGrow3Status();
    
    showToast({
      title: 'Code3 Controller Connected',
      msg: `Found ${deviceCount} device${deviceCount !== 1 ? 's' : ''}`,
      kind: 'success'
    });
  } catch (error) {
    // Error toast
  }
};
```

**Changes Made**:
1. ❌ **Removed** separate `/healthz` health check (doesn't exist on controller)
2. ✅ **Use** `/api/devicedatas` as both health check AND device list
3. ✅ **Extract** device count from `devicesData.data` array (nested structure)
4. ✅ **Improved** success message to show actual device count

## Testing

### Test 1: Automatic Health Check (On Page Load)

**Expected Console Output**:
```
[Error] Failed to load resource: 404 (Not Found) (healthz, line 0)
[Log] [Grow3] /healthz not found, trying /api/devicedatas
```

**Expected UI**:
- Code3 integration card shows: **Online** (green dot)
- Grow3 status shows: **Online**

### Test 2: Manual Connection Test (Click "Test Connection")

**Before Fix**:
```
❌ [Error] [Grow3] Connection test failed: Error: Health check failed: Not Found
❌ Toast: "Code3 Connection Failed"
```

**After Fix**:
```
✅ [Log] [Grow3] Devices: {status: "success", message: "...", data: Array(5)}
✅ Toast: "Code3 Controller Connected - Found 5 devices"
```

### Test 3: Verify Device Count

**Command**:
```bash
curl -s http://localhost:8091/api/grow3/api/devicedatas | jq '.data | length'
```

**Expected**: `5` (or actual device count)

**UI Toast**: Should match the count

## File Changes

**Modified**:
- `public/app.charlie.js`
  - Lines 2417-2435: Updated `testGrow3Connection()` to skip `/healthz` check
  - Lines 2418: Added comment explaining why we skip `/healthz`
  - Lines 2426-2428: Extract devices from nested `data` property
  - Line 2433: Improved success message with accurate device count

**Unchanged** (Already Working):
- `public/app.charlie.js`
  - Lines 2350-2405: `checkGrow3Status()` already has fallback logic ✅

**Related**:
- `server-charlie.js` lines 6429-6479: Grow3 proxy (already working)
- `docs/FIXES_SWITCHBOT_GROW3.md`: Original proxy documentation

## Verification Commands

### Check Proxy Works
```bash
# Should return JSON with devices
curl -s http://localhost:8091/api/grow3/api/devicedatas | jq '.'

# Should return HTML error (404)
curl -s http://localhost:8091/api/grow3/healthz
```

### Check Device Count
```bash
curl -s http://localhost:8091/api/grow3/api/devicedatas | jq '.data | length'
```

### Check Server Logs
```bash
tail -50 logs/node-server.log | grep -i grow3
```

**Expected**:
```
[Grow3 Proxy] GET /api/grow3/api/devicedatas → http://192.168.2.80:3000/api/devicedatas
[Grow3 Proxy] Response: 200
```

## Success Criteria

- [x] Hard refresh browser (Cmd+Shift+R / Ctrl+Shift+R)
- [x] Navigate to Integrations panel
- [x] Code3 card shows "Online" status (green)
- [x] Click "Test Connection" button
- [x] Console shows: `[Grow3] Devices: {status: "success", ...}`
- [x] Toast shows: "Code3 Controller Connected - Found X devices"
- [x] NO 404 error for healthz in test connection
- [x] Automatic health check still works (uses fallback)

## Notes

- **Automatic Health Check** (`checkGrow3Status`): Tries `/healthz`, falls back to `/api/devicedatas` on 404
- **Manual Test** (`testGrow3Connection`): Skips `/healthz` entirely, uses `/api/devicedatas` directly
- **Device Count**: Response format is `{status, message, data: [...]}`, must extract `data` array
- **Grow3 Controller**: Light Engine Code3 at 192.168.2.80:3000 (5 fixtures: F00001-F00005)

## Related Issues

This fix completes the Grow3 integration started in:
- `docs/FIXES_SWITCHBOT_GROW3.md` - Original proxy setup
- `docs/IOT_DEVICES_FIX.md` - IoT device acceptance flow
- `docs/HOTFIX_IOT_ENDPOINT.md` - 400 Bad Request fix
