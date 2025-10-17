# WiFi Scan Mock Data Removal - SERVER FIX

**Date**: October 16, 2025  
**Status**: ✅ FIXED - Server-side mock data removed

## Problem Identified

Farm Registration wizard was showing fake WiFi networks because **the server endpoint** had a fallback to hardcoded demo networks, not the frontend code.

### Root Cause

**File**: `server-charlie.js`  
**Endpoint**: `GET /forwarder/network/wifi/scan`  
**Lines**: 7789-7820

The server endpoint was designed to:
1. Try to fetch WiFi networks from the controller at `http://127.0.0.1:8000`
2. **If that failed, return hardcoded demo networks** (greenreach, Farm-IoT, etc.)

This meant that even though the frontend was correctly calling the API, it was receiving fake data from the server.

## Fix Applied

### Server-Side Change (Critical)

**Before** (server-charlie.js lines 7804-7809):
```javascript
} catch (err) {
  console.warn('Controller Wi-Fi scan failed, falling back to farm networks', err.message);
}
// Farm network scan results
res.json([
  { ssid: 'greenreach', signal: -42, security: 'WPA2' },
  { ssid: 'Farm-IoT', signal: -48, security: 'WPA2' },
  { ssid: 'Greenhouse-Guest', signal: -62, security: 'WPA2' },
  { ssid: 'BackOffice', signal: -74, security: 'WPA3' },
  { ssid: 'Equipment-WiFi', signal: -55, security: 'WPA2' }
]);
```

**After**:
```javascript
} catch (err) {
  console.warn('Controller Wi-Fi scan failed, falling back to farm networks', err.message);
}
// LIVE MODE: No mock fallback - return error if controller unavailable
console.error('[WiFi Scan] Controller not available or scan failed');
res.status(503).json({ 
  error: 'WiFi scan unavailable', 
  message: 'Controller not reachable. Please check controller connection at ' + (getController() || 'not configured')
});
```

**Impact**:
- Server now returns HTTP 503 error when WiFi scan unavailable
- Frontend receives error and displays empty network list with error toast
- No fake networks ever returned to the user

## Testing Results

### Before Fix
```bash
curl http://127.0.0.1:8091/forwarder/network/wifi/scan
# Returned fake networks: greenreach, Farm-IoT, etc.
```

### After Fix
```bash
curl http://127.0.0.1:8091/forwarder/network/wifi/scan
# Returns:
{
  "error": "WiFi scan unavailable",
  "message": "Controller not reachable. Please check controller connection at http://127.0.0.1:8000"
}
```

### Frontend Behavior
1. Farm Registration wizard calls `/forwarder/network/wifi/scan`
2. Server returns 503 error
3. Frontend catch block executes
4. Empty network list displayed
5. Error toast: "Network scan error: WiFi scan unavailable. Check API endpoint."

## Controller WiFi Scan Endpoint

**Current Status**: ⚠️ Not implemented

The controller at `http://127.0.0.1:8000` does not have `/api/network/wifi/scan` endpoint:

```bash
curl http://127.0.0.1:8000/api/network/wifi/scan
# Returns: {"detail":"Not Found"}
```

### To Enable Real WiFi Scanning

The WiFi scan endpoint needs to be implemented in the Python backend (FastAPI):

**File to modify**: `backend/server.py`

**Suggested implementation**:
```python
import subprocess
import json

@app.get("/api/network/wifi/scan")
async def scan_wifi_networks():
    """Scan for available WiFi networks using system tools"""
    try:
        # On macOS/Linux: Use airport or nmcli
        # On Raspberry Pi: Use iwlist or nmcli
        
        # Example for macOS (airport utility)
        result = subprocess.run(
            ['/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport', '-s'],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        networks = []
        for line in result.stdout.split('\n')[1:]:  # Skip header
            if line.strip():
                parts = line.split()
                if len(parts) >= 3:
                    networks.append({
                        'ssid': parts[0],
                        'signal': int(parts[2]),
                        'security': 'WPA2' if 'WPA2' in line else 'Open'
                    })
        
        return {"networks": networks}
    
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"WiFi scan failed: {str(e)}")
```

**Alternative for Raspberry Pi**:
```python
# Using nmcli (NetworkManager)
result = subprocess.run(['nmcli', 'dev', 'wifi', 'list'], capture_output=True, text=True)

# Or iwlist
result = subprocess.run(['sudo', 'iwlist', 'wlan0', 'scan'], capture_output=True, text=True)
```

## Manual WiFi Entry Workaround

Since WiFi scanning is not currently available, users can manually enter WiFi credentials:

1. Farm Registration wizard → WiFi step
2. Click "Scan Networks" → Error displayed
3. Use "Manual Entry" option (if available) or type SSID directly
4. Enter WiFi password
5. Continue with registration

## Verification Checklist

✅ **Server mock data removed**: Hardcoded networks removed from server endpoint  
✅ **Frontend error handling works**: Empty list displayed on scan failure  
✅ **Error messages clear**: Points to controller connection issue  
✅ **Server restarted**: Changes active on port 8091  
⚠️ **WiFi scan endpoint**: Not implemented in controller (needs Python backend work)  

## Next Steps

### Short Term (Manual Entry)
1. Add "Enter SSID manually" button to Farm Registration WiFi step
2. Update UI to show that scanning is unavailable
3. Allow users to type SSID and password directly

### Long Term (Real Scanning)
1. Implement `/api/network/wifi/scan` in Python FastAPI backend
2. Use platform-specific tools (airport, nmcli, iwlist)
3. Test on target hardware (Raspberry Pi, reTerminal)
4. Handle permissions (may need sudo for some scan commands)

## Server Status

**Process**: PID 25431  
**Port**: 8091  
**Health**: ✅ Healthy  
**Logs**: `/tmp/charlie-server.log`  
**Dashboard**: http://127.0.0.1:8091

## Related Files Modified

1. **`server-charlie.js`** - Removed mock WiFi network fallback (lines 7804-7809)
2. **`docs/LIVE_TESTING_SETUP.md`** - Updated with server-side fix documentation
3. **`docs/FARM_REGISTRATION_MOCK_REMOVAL.md`** - Previous frontend fixes documented

## Rollback Plan

If WiFi scanning mock data is needed temporarily for testing:

**Restore in server-charlie.js** (line ~7804):
```javascript
// Temporary: Restore mock networks for testing
res.json([
  { ssid: 'greenreach', signal: -42, security: 'WPA2' },
  { ssid: 'Farm-IoT', signal: -48, security: 'WPA2' }
]);
```

**Commit with**: `temp: restore WiFi scan mock for testing`

---

**Summary**: The fake WiFi networks were coming from the **server**, not the frontend. Server has been fixed to return proper errors. Real WiFi scanning requires implementing the endpoint in the Python backend.

**Maintainer**: Light Engine Charlie Team  
**Last Updated**: October 16, 2025
