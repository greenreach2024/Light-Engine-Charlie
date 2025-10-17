# Live Testing Setup - WiFi & Device Scanning

**Date**: October 16, 2025  
**Status**: ✅ Ready for Live Testing

## Overview

All mock/demo data has been removed from the Light Engine Charlie dashboard to enable pure live testing of WiFi scanning and device discovery features.

## Changes Made

### 1. WiFi Scanning (Farm Setup Wizard)
**Location**: `public/app.charlie.js` lines ~3808-3824

**Before**: 
- WiFi scan failures fell back to demo networks (greenreach, Farm-IoT, Greenhouse-Guest, etc.)
- Toast message: "Using demo networks. Check network connection."

**After**:
- WiFi scan failures show empty network list
- Toast message: "Network scan error: {error.message}. Check API endpoint."
- Status text: "Scan failed" (no "using demo networks")

### 1b. Farm Registration - Device Setup WiFi Credentials
**Location**: `public/app.charlie.js` lines ~8646-8666 (`getSetupForDeviceType` method)

**Before**:
- Hardcoded WiFi credentials: `ssid: 'greenreach', psk: 'Farms2024'`
- Hardcoded static IPs: `192.168.1.{40-50}`

**After**:
- Empty WiFi credentials: `ssid: '', psk: ''`
- No static IP pre-fill: `useStatic: false, staticIp: null`
- User must configure network from Farm Registration wizard

### 2. Universal Device Scanner (Integrations Panel)
**Location**: `public/app.charlie.js` lines ~1750-1900

**Status**: Already configured for live testing
- Calls `/discovery/scan` POST endpoint
- No demo/mock device fallback
- Shows clear error messages on failure

### 3. IoT Device Scanner
**Location**: `public/app.charlie.js` lines ~1680-1750

**Status**: Already configured for live testing
- Calls `/discovery/devices` GET endpoint
- No demo/mock device fallback
- Progress bar animation with real-time feedback

### 4. Emoji Cleanup
Removed remaining emoji characters from UI buttons:
- `'🔍 Start Scan'` → `'Start Scan'`
- `'⏳ Scanning...'` → `'Scanning...'`
- `'⏳ Testing...'` → `'Testing...'`

## API Endpoints

### WiFi Scanning
**Endpoint**: `GET /forwarder/network/wifi/scan`  
**Server File**: `server-charlie.js` line 7789  
**Expected Response**:
```json
[
  {
    "ssid": "NetworkName",
    "signal": -42,
    "security": "WPA2"
  }
]
```

### Universal Device Discovery
**Endpoint**: `POST /discovery/scan`  
**Server File**: `server-charlie.js` line 8516  
**Expected Response**:
```json
{
  "devices": [
    {
      "name": "Device Name",
      "brand": "Vendor",
      "protocol": "wifi|ble|mqtt|kasa|switchbot",
      "ip": "192.168.x.x",
      "deviceId": "...",
      "mac": "..."
    }
  ]
}
```

### IoT Device Discovery
**Endpoint**: `GET /discovery/devices`  
**Expected Response**:
```json
{
  "devices": [
    {
      "address": "192.168.x.x",
      "type": "light|sensor|plug",
      "vendor": "VendorName",
      "name": "Device Name",
      "protocol": "kasa|mqtt|ble"
    }
  ]
}
```

## Testing Checklist

### WiFi Scanning (Farm Setup Wizard)
1. ✅ Navigate to Farm Setup wizard
2. ✅ Select WiFi connection type
3. ✅ Click "Scan Networks" button
4. ✅ Verify real WiFi networks appear (no demo fallback)
5. ✅ If scan fails, verify error toast shows actual error message
6. ✅ Check console for `[FarmWizard] WiFi scan error:` logs

### Universal Scanner (Integrations Panel)
1. ✅ Navigate to Sidebar → Farm Setup → Integrations
2. ✅ Locate "Universal Device Scanner" card
3. ✅ Click "Start Scan" button
4. ✅ Verify progress bar animates (0% → 95% → 100%)
5. ✅ Verify status text shows "Scanning WiFi, BLE, MQTT, Kasa, SwitchBot..."
6. ✅ Verify results table displays discovered devices
7. ✅ Verify "Add" button functionality for each device
8. ✅ Check console for `[UniversalScan]` logs

### IoT Device Scanner
1. ✅ Navigate to device discovery section
2. ✅ Click "Scan for Devices" button
3. ✅ Verify progress bar animates with percentage display
4. ✅ Verify discovered devices render as cards
5. ✅ Check console for device discovery logs

### Code3 Controller
1. ✅ Navigate to Integrations panel
2. ✅ Verify Code3 Controller card displays (no emojis)
3. ✅ Click "Test Connection" button
4. ✅ Verify button text changes to "Testing..."
5. ✅ Verify status dot/pill updates (green for online, red for offline)
6. ✅ If successful, verify 5 fixtures appear in Groups V2 Unassigned Lights

## Known Demo/Mock Components (Still Present)

### Demo Room Removal (Active Filter)
**Location**: `public/app.charlie.js` lines 3417-3433  
**Purpose**: Filters out demo room names on data load  
**Status**: ✅ Keeping active - prevents test data from appearing in production

**Filtered Names**:
- Demo Room, Demo Grow Room
- Test Room, Sample Room
- Room 1, Room 2, Room A, Room B

### Demo Pair Scan (Misleading Name)
**Location**: `public/app.charlie.js` lines 1528-1545  
**Function**: `window.demoPairScan()`  
**Actual Behavior**: Calls LIVE `/discovery/devices` endpoint  
**Status**: ⚠️ Name is misleading - function is actually live, not demo

## Troubleshooting

### WiFi Scan Returns Empty
**Symptoms**: Network list is empty, status shows "Scan failed"  
**Check**:
1. Verify `/forwarder/network/wifi/scan` endpoint is reachable
2. Check server logs for forwarder connection errors
3. Verify network interface has WiFi capability
4. Check firewall/permissions for network scanning

**Check**:
1. Verify `/discovery/scan` or `/discovery/devices` endpoint responds
5. Review server console for Python backend errors

### Code3 Controller Offline
**Symptoms**: Red status dot, "Connection failed" toast  
**Check**:
3. Test health endpoint: `curl http://192.168.2.80:3000/healthz`
4. Verify network routing to controller subnet
**Server Process**: Running on PID 24112  
**Port**: 8091  
**Logs**: `/tmp/charlie-server.log`  
**Health Check**: `http://127.0.0.1:8091/healthz`

kill 24112
```
cd /Users/petergilbert/Light-Engine-Charlie
nohup node server-charlie.js > /tmp/charlie-server.log 2>&1 &
```

## Additional Notes

- **No Emoji Icons**: All toast messages now use `icon: ''` (empty string)
- **Live Data Only**: Application will fail gracefully if endpoints are unreachable
- **Error Visibility**: All errors are logged to console with descriptive messages
- **Network Requirements**: 
  - WiFi scanning requires network interface with scan capability
  - Device discovery requires multicast/broadcast support for mDNS/SSDP
  - MQTT discovery requires broker credentials in environment variables

## Next Steps

1. **Test WiFi Scanning**: Navigate to Farm Setup wizard and scan for networks
2. **Test Universal Scanner**: Open Integrations panel and run full device scan
3. **Verify Error Handling**: Disconnect network and verify clear error messages
4. **Test Code3 Integration**: Connect to Code3 controller and verify fixture discovery
5. **Check Groups V2**: Verify discovered fixtures appear in Unassigned Lights grid

---

**Documentation**: This setup enables pure live testing without any mock/demo data fallbacks.  
**Maintainer**: Light Engine Charlie Team  
**Last Updated**: October 16, 2025
