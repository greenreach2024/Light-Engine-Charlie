# Integration Scan CORS Fix

## Issue Summary

**Problem**: The Universal Scanner in the Integrations panel was failing with "Scan failed" error when clicking "Start Scan".

**Root Cause**: CORS (Cross-Origin Resource Sharing) misconfiguration. The Python backend was only allowing requests from `http://localhost:8095`, but the Node.js frontend was running on `http://localhost:8091`.

## Error Details

### Frontend Error
- User clicked "Start Scan" in Integrations panel
- Toast notification: "Scan failed"
- Console error: CORS policy blocked the request

### Backend Configuration
```python
# Before (Line 66)
allow_origins=["http://localhost:8095"],  # Only port 8095 allowed
```

### Frontend Request
```javascript
// app.charlie.js Line 1789
const discoveryEndpoint = 'http://127.0.0.1:8000/discovery/scan';
const response = await fetch(discoveryEndpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
});
```

**Conflict**: Frontend on port 8091 → Backend on port 8000 → CORS blocked ❌

## Solution

Updated the Python backend CORS configuration to allow multiple origins:

### Changed File: `backend/server.py` (Line 65-74)

**Before:**
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8095"],  # Node.js server origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**After:**
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8095",  # Original Node.js server port
        "http://localhost:8091",  # Current Node.js server port
        "http://127.0.0.1:8091",  # Alternative localhost
        "http://127.0.0.1:8095",  # Alternative localhost
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Verification

### 1. CORS Headers Test
```bash
curl -s -X POST http://127.0.0.1:8000/discovery/scan \
  -H "Origin: http://localhost:8091" \
  -H "Content-Type: application/json" \
  -i | grep access-control
```

**Result:**
```
access-control-allow-credentials: true
access-control-allow-origin: http://localhost:8091  ✅
vary: Origin
```

### 2. Discovery Scan Test
```bash
curl -s -X POST http://127.0.0.1:8000/discovery/scan | jq '.count'
```

**Result:**
```json
9
```

**Devices Found:**
- Smart Bridge 2 (mDNS)
- My ecobee (mDNS)
- Family Room TV (mDNS)
- Apple TV (mDNS)
- 2× Officejet Pro 8600 printers (mDNS)
- 2× Brother MFC-L8900CDW printers (mDNS)
- GreenReach Farms (mDNS)

### 3. Smoke Test
```bash
npm run smoke
```

**Result:** ✅ PASSED

## Server Startup Process

### Starting Python Backend
```bash
cd /Users/petergilbert/Light-Engine-Charlie
python3 -m backend > /tmp/python-backend.log 2>&1 &
```

**Verification:**
```bash
lsof -ti:8000  # Should show PID
```

**Logs:**
```bash
tail -f /tmp/python-backend.log
```

### Starting Node.js Server
```bash
cd /Users/petergilbert/Light-Engine-Charlie
npm run start > /tmp/node-server.log 2>&1 &
```

**Verification:**
```bash
lsof -ti:8091  # Should show PID
```

## Known Warnings (Non-Critical)

The Python backend shows these warnings on startup - they are **expected** and **non-critical**:

1. **`paho-mqtt not available. MQTT discovery disabled.`**
   - Optional dependency for MQTT device discovery
   - Install: `pip install paho-mqtt`

2. **`python-kasa not available. Kasa discovery disabled.`**
   - Optional dependency for TP-Link Kasa devices
   - Install: `pip install python-kasa`

3. **`bleak not available. Bluetooth LE discovery disabled.`**
   - Optional dependency for BLE device discovery
   - Install: `pip install bleak`

4. **`Valid config keys have changed in V2`**
   - Pydantic v2 migration warning
   - Non-blocking, functionality works

5. **`unregister_all_services skipped as it does blocking i/o`**
   - Zeroconf library warning during shutdown
   - Does not affect functionality

## Shutdown Behavior

### Normal Shutdown (Ctrl+C)
When stopping the backend with Ctrl+C, you may see:

```
ERROR:    Application shutdown failed. Exiting.
asyncio.exceptions.CancelledError
```

**This is normal!** It occurs because:
- The discovery supervisor task is cancelled during shutdown
- FastAPI/Starlette shutdown handler cancels pending tasks
- Does not indicate a problem

### Clean Shutdown
```bash
# Find and kill process
lsof -ti:8000 | xargs kill

# Or with PID
kill <PID>
```

## Testing the Fix

### Manual Test in Browser

1. **Open application**: http://localhost:8091
2. **Navigate to**: Integrations panel (sidebar)
3. **Click**: "Start Scan" button in Universal Device Scanner card
4. **Verify**:
   - Progress animation appears
   - Scan completes in 5-10 seconds
   - Results table shows discovered devices
   - Each device has "Accept" and "Ignore" buttons
   - No "Scan failed" error

### Browser Console Test
```javascript
// Open DevTools Console (F12)

// Manual scan test
await fetch('http://127.0.0.1:8000/discovery/scan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
})
.then(r => r.json())
.then(data => console.log('Devices found:', data.count, data.devices));

// Expected: No CORS error, returns devices
```

### Expected Results

**Success Indicators:**
- ✅ No CORS errors in browser console
- ✅ Toast notification: "Found X devices across all protocols"
- ✅ Results table populated with device rows
- ✅ Accept/Ignore buttons functional
- ✅ No "Scan failed" message

**Device Display Format:**
```
┌──────────────────────────────────────────────────────────────┐
│ Device Name      Brand    Protocol  IP/ID    [Accept][Ignore]│
├──────────────────────────────────────────────────────────────┤
│ Apple TV         Unknown  mDNS      —        [Accept][Ignore]│
│ My ecobee        Unknown  mDNS      —        [Accept][Ignore]│
│ Smart Bridge 2   Unknown  mDNS      —        [Accept][Ignore]│
└──────────────────────────────────────────────────────────────┘
```

## Architecture Notes

### Port Configuration

| Service | Port | Purpose |
|---------|------|---------|
| Node.js Frontend | 8091 | Main application server, static files, REST API |
| Python Backend | 8000 | Device discovery, automation, FastAPI endpoints |

### Communication Flow

```
Browser (localhost:8091)
       ↓
Node.js Server (port 8091)
       ↓ serves index.html
Browser executes app.charlie.js
       ↓ makes fetch request
Python Backend (port 8000)
       ↓ CORS check: is origin allowed?
       ✅ YES: localhost:8091 in allow_origins
       ↓
Returns device discovery results
```

### CORS Headers in Response

```http
HTTP/1.1 200 OK
access-control-allow-credentials: true
access-control-allow-origin: http://localhost:8091
vary: Origin
content-type: application/json

{"status":"success","devices":[...]}
```

## Alternative Solutions Considered

### Option 1: Proxy via Node.js ❌
- Add proxy middleware in Node.js server
- Forward `/discovery/*` to Python backend
- **Rejected**: Adds complexity, extra hop

### Option 2: Same Port for Both Servers ❌
- Run both on same port with reverse proxy
- **Rejected**: Requires nginx/Apache setup

### Option 3: Wildcard CORS ❌
```python
allow_origins=["*"]  # Allow all origins
```
- **Rejected**: Security risk in production

### Option 4: Multiple Allowed Origins ✅ (CHOSEN)
- List all valid frontend origins
- Secure and flexible
- Easy to maintain

## Production Considerations

### Environment Variables
Consider using environment variables for CORS origins:

```python
import os

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:8091,http://localhost:8095"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Deployment
For production deployments:
1. Update `allow_origins` with production URLs
2. Consider using domain names instead of localhost
3. Enable HTTPS for secure communication
4. Review `allow_credentials` setting

## Troubleshooting

### Issue: "Scan failed" still appears

**Check:**
1. Python backend running?
   ```bash
   lsof -ti:8000
   ```

2. CORS headers present?
   ```bash
   curl -i -X POST http://127.0.0.1:8000/discovery/scan \
     -H "Origin: http://localhost:8091"
   ```

3. Node.js server on correct port?
   ```bash
   lsof -ti:8091
   ```

### Issue: Backend won't start

**Check logs:**
```bash
tail -f /tmp/python-backend.log
```

**Common causes:**
- Port 8000 already in use
- Missing Python dependencies
- Configuration file errors

**Solution:**
```bash
# Kill existing process
lsof -ti:8000 | xargs kill

# Install dependencies
pip install -r requirements.txt

# Restart backend
python3 -m backend
```

### Issue: "Connection refused"

**Verify:**
```bash
# Check if backend is listening
netstat -an | grep 8000

# Test direct connection
curl http://127.0.0.1:8000/health
```

## Related Files

- **backend/server.py**: FastAPI application, CORS config
- **public/app.charlie.js**: Frontend scan function (line 1749)
- **public/index.charlie.html**: Integrations panel UI
- **docs/DEVICE_DISCOVERY_WORKFLOW.md**: Complete workflow docs
- **docs/DEVICE_DISCOVERY_TESTING.md**: Testing procedures

## Changelog

**2025-01-17**
- Fixed CORS configuration to allow port 8091
- Added multiple origin support (8091, 8095, 127.0.0.1 variants)
- Documented server startup procedures
- Added troubleshooting guide
- Smoke test passed

## Summary

The Integration Scanner is now fully functional! The CORS fix allows the frontend (port 8091) to successfully communicate with the Python backend (port 8000) for device discovery. Users can now scan for devices and see results in the Integrations panel.

**Status**: ✅ **RESOLVED**
