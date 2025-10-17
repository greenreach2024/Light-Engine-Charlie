# SwitchBot Credentials & Grow3 Connection Fixes

**Date**: October 17, 2025
**Issues Fixed**:
1. SwitchBot credentials not persisting (asked every device)
2. Grow3 connection test failing with CORS/Load failed error

## Issue 1: SwitchBot Credentials Not Saved

### Problem
When users entered SwitchBot API token and secret in the Universal Scanner device sign-in modal, the credentials were only stored in memory (`STATE.iotDevices` and `window.LAST_IOT_SCAN`). They were never persisted to the server, causing the app to ask for credentials again for every device.

### Root Cause
- In `public/app.charlie.js`, the `addDeviceToIoT()` function had a TODO comment for the POST endpoint (line 2133)
- No call was made to save the devices to the server
- Generic `/data/:filename` endpoint existed but wasn't being used

### Solution
**File**: `public/app.charlie.js` (lines 2128-2149)

Added persistence call after adding device to STATE:

```javascript
// Persist to server
try {
  const response = await fetch('/data/iot-devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(STATE.iotDevices)
  });
  
  if (!response.ok) {
    console.warn('[UniversalScan] Failed to save IoT devices:', response.statusText);
  } else {
    console.log('[UniversalScan] IoT devices saved to server');
  }
} catch (saveError) {
  console.warn('[UniversalScan] Error saving IoT devices:', saveError);
}
```

**How It Works**:
1. User enters SwitchBot token/secret in modal
2. Device added to `STATE.iotDevices` array
3. Entire array POSTed to `/data/iot-devices`
4. Server writes to `public/data/iot-devices.json`
5. On page reload, credentials are restored from file

**Testing**:
1. Open Universal Scanner
2. Accept a SwitchBot device
3. Enter token and secret
4. Check `public/data/iot-devices.json` - should contain device with credentials
5. Refresh page - credentials should persist

## Issue 2: Grow3 Controller Connection Failure

### Problem
When clicking "Test Connection" on the Code3 integration card, browser threw error:
```
[Error] [Grow3] Connection test failed:
TypeError: Load failed
```

This occurred because frontend was trying to connect directly to `http://192.168.2.80:3000` from the browser, which fails due to CORS and network isolation.

### Root Cause
- Frontend constant `GROW3_BASE_URL` set to `'http://192.168.2.80:3000'` (line 2220)
- Browser cannot make cross-origin requests to remote Pi controller
- No proxy existed on Node.js server to forward these requests

### Solution Part 1: Frontend Proxy Path
**File**: `public/app.charlie.js` (line 2220)

Changed from absolute URL to relative proxy path:

```javascript
// Before:
const GROW3_BASE_URL = 'http://192.168.2.80:3000';

// After:
// Use relative URL to proxy through Node.js server instead of direct connection
const GROW3_BASE_URL = '/api/grow3';
```

### Solution Part 2: Node.js Proxy Endpoint
**File**: `server-charlie.js` (lines 6429-6479, BEFORE `/api` proxy)

Added dedicated proxy handler:

```javascript
// ===== GROW3 (CODE3) CONTROLLER PROXY =====
// IMPORTANT: This must come BEFORE the /api proxy middleware to avoid conflicts
const GROW3_TARGET = 'http://192.168.2.80:3000';

app.all('/api/grow3/*', async (req, res) => {
  try {
    const grow3Path = req.path.replace('/api/grow3', '');
    const targetUrl = `${GROW3_TARGET}${grow3Path}`;
    
    console.log(`[Grow3 Proxy] ${req.method} ${req.path} → ${targetUrl}`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    try {
      const response = await fetch(targetUrl, {
        method: req.method,
        headers: { 'Content-Type': 'application/json', ...req.headers },
        body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined,
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        res.status(response.status).json(data);
      } else {
        const text = await response.text();
        res.status(response.status).type(contentType || 'text/plain').send(text);
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error('[Grow3 Proxy] Error:', error.message);
    if (error.name === 'AbortError') {
      res.status(504).json({ error: 'Gateway timeout', message: 'Grow3 controller did not respond in time' });
    } else {
      res.status(502).json({ error: 'Bad gateway', message: error.message });
    }
  }
});
```

**CRITICAL**: This proxy endpoint **must** be defined BEFORE the generic `/api` proxy middleware (line 6480), otherwise the `/api` middleware will intercept `/api/grow3/*` requests and forward them to the Python backend instead of the Grow3 controller.

### Request Flow
1. **Frontend**: `fetch('/api/grow3/healthz')`
2. **Node.js Server**: Receives at `/api/grow3/healthz`
3. **Proxy Handler**: Strips `/api/grow3` → `/healthz`
4. **Target**: Forwards to `http://192.168.2.80:3000/healthz`
5. **Response**: Proxies back to frontend

### Features
- **Timeout**: 10-second timeout prevents hanging requests
- **Error Handling**: Returns 504 for timeouts, 502 for other errors
- **Logging**: `[Grow3 Proxy]` prefix for easy debugging
- **All Methods**: Supports GET, POST, PUT, PATCH, DELETE

### Testing
```bash
# Test health check endpoint
curl http://localhost:8091/api/grow3/healthz

# Should see in logs:
# [Grow3 Proxy] GET /api/grow3/healthz → http://192.168.2.80:3000/healthz
```

If Grow3 controller is offline or not responding, you'll see:
- HTTP 404: Endpoint doesn't exist on controller
- HTTP 502: Bad gateway (network error)
- HTTP 504: Gateway timeout (controller not responding)

## Verification Steps

### SwitchBot Credentials
1. ✅ Open Universal Scanner
2. ✅ Accept a SwitchBot device
3. ✅ Enter token and secret in modal
4. ✅ Check console: `[UniversalScan] IoT devices saved to server`
5. ✅ Verify file created: `public/data/iot-devices.json`
6. ✅ Refresh page and accept another device
7. ✅ Modal should NOT ask for credentials again (stored in memory from file)

### Grow3 Proxy
1. ✅ Start Node.js server: `npm run start`
2. ✅ Check logs: No errors about `/api/grow3` being intercepted by `/api` proxy
3. ✅ Test: `curl http://localhost:8091/api/grow3/healthz`
4. ✅ Check logs: `[Grow3 Proxy] GET /api/grow3/healthz → http://192.168.2.80:3000/healthz`
5. ✅ In browser: Click "Test Connection" on Code3 card
6. ✅ Check Network tab: Request goes to `/api/grow3/healthz` (not `192.168.2.80:3000`)
7. ✅ No CORS errors in console

## Edge Cases & Notes

### SwitchBot Credentials
- **Multiple Devices**: All devices with protocol='switchbot' will share the same credentials (stored once)
- **Security**: Credentials stored in plain JSON file - production should encrypt or use environment variables
- **File Growth**: Each device adds ~200 bytes to `iot-devices.json` - monitor file size for large installations

### Grow3 Proxy
- **Controller Offline**: Returns 502 Bad Gateway - expected behavior
- **Slow Network**: 10-second timeout prevents UI hanging
- **Direct Access**: If you can ping 192.168.2.80, the proxy will work even if controller is down (returns proper error)
- **VPN/Remote**: Proxy works through VPN as long as Node.js server can reach 192.168.2.80:3000

## Files Modified

1. **public/app.charlie.js**
   - Line 2128-2149: Added IoT device persistence to `/data/iot-devices`
   - Line 2220: Changed `GROW3_BASE_URL` from `http://192.168.2.80:3000` to `/api/grow3`

2. **server-charlie.js**
   - Lines 6429-6479: Added `/api/grow3/*` proxy handler (before `/api` proxy)

3. **New File**: `docs/FIXES_SWITCHBOT_GROW3.md` (this document)

## Rollback Instructions

If issues arise, revert with:

```bash
# Revert app.charlie.js changes
git checkout HEAD -- public/app.charlie.js

# Revert server-charlie.js changes
git checkout HEAD -- server-charlie.js

# Restart server
npm run start
```

## Future Improvements

### SwitchBot Credentials
- [ ] Encrypt credentials in `iot-devices.json`
- [ ] Support per-device credential override (different API tokens for different locations)
- [ ] Add credential validation before saving
- [ ] UI to view/edit/delete saved devices

### Grow3 Proxy
- [ ] Make `GROW3_TARGET` configurable via environment variable
- [ ] Add authentication/API key for proxy endpoint
- [ ] Support WebSocket connections for real-time updates
- [ ] Add retry logic for transient network failures
- [ ] Health check endpoint that also verifies Grow3 accessibility

## Related Documentation

- **Universal Scanner**: `docs/UNIVERSAL_SCANNER.md`
- **Device Discovery**: `docs/DISCOVERY_IMPLEMENTATION.md`
- **Grow3 Integration**: `docs/CONTROLLER_MANAGEMENT.md`
- **Data Persistence**: `SETUP_WIZARD_SYSTEM.md` (generic `/data/:filename` endpoint)
