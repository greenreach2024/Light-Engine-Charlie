# Farm Registration Mock Data Removal

**Date**: October 16, 2025  
**Status**: ✅ Completed

## Summary

Removed all mock/demo data from Farm Registration wizard and device setup to enable pure live testing. Users must now configure all network credentials and farm details manually through WiFi scanning and form input.

## Changes Made

### 1. Device Setup WiFi Credentials (Critical Fix)
**File**: `public/app.charlie.js`  
**Method**: `getSetupForDeviceType(deviceType)`  
**Lines**: ~8646-8666

**Before** (Mock Data):
```javascript
// Plugs and switches
return {
  wifi: { ssid: 'greenreach', psk: 'Farms2024', useStatic: false, staticIp: null }
};

// Other devices
return {
  wifi: { ssid: 'greenreach', psk: 'Farms2024', useStatic: true, staticIp: `192.168.1.${40 + Math.floor(Math.random() * 10)}` }
};
```

**After** (Live Data):
```javascript
// All WiFi devices
return {
  wifi: { ssid: '', psk: '', useStatic: false, staticIp: null }
};
```

**Impact**:
- SwitchBot plug/switch provisioning no longer uses hardcoded credentials
- Users must enter WiFi SSID and password from Farm Registration wizard
- No random static IP assignment - DHCP by default

### 2. WiFi Network Scanning Fallback
**File**: `public/app.charlie.js`  
**Lines**: ~3808-3824

**Before** (Demo Fallback):
```javascript
this.wifiNetworks = [
  { ssid: 'greenreach', signal: -42, security: 'WPA2' },
  { ssid: 'Farm-IoT', signal: -48, security: 'WPA2' },
  { ssid: 'Greenhouse-Guest', signal: -62, security: 'WPA2' },
  { ssid: 'BackOffice', signal: -74, security: 'WPA3' },
  { ssid: 'Equipment-WiFi', signal: -55, security: 'WPA2' }
];
showToast({ title: 'WiFi scan failed', msg: 'Using demo networks...', kind: 'warn' });
```

**After** (Live Only):
```javascript
this.wifiNetworks = [];
showToast({ 
  title: 'WiFi scan failed', 
  msg: `Network scan error: ${error.message}. Check API endpoint.`, 
  kind: 'error' 
});
```

**Impact**:
- Failed WiFi scans show empty network list instead of fake networks
- Clear error messaging points to actual problem (API endpoint, network connectivity)

### 3. Emoji Cleanup (Button Text)
**File**: `public/app.charlie.js`

**Removed**:
- `'🔍 Start Scan'` → `'Start Scan'` (Universal Scanner)
- `'⏳ Testing...'` → `'Testing...'` (Code3 Test Connection)
- `'⏳ Scanning...'` → `'Scanning...'` (Universal Scanner progress)

## Verification

### Farm Registration Wizard - Default Data
**Method**: `FarmWizard.defaultData()`  
**Status**: ✅ Already clean - no mock data

All fields start empty:
```javascript
{
  connection: { type: 'wifi', wifi: { ssid: '', password: '' } },
  location: { farmName: '', address: '', city: '', state: '', postal: '' },
  contact: { name: '', email: '', phone: '', website: '' },
  rooms: []
}
```

Only auto-filled value: `timezone` (from browser's Intl API)

### Demo Room Filter
**Function**: `removeDemoRooms()`  
**Status**: ✅ Active and correct

Filters out test room names on data load:
- Demo Room, Demo Grow Room, Test Room, Sample Room
- Room 1, Room 2, Room A, Room B

This is **intentional** and should remain active to prevent test data from appearing in production.

## Testing Instructions

### Test 1: WiFi Scanning in Farm Registration
1. Open dashboard → Click "Register Farm" button
2. Select "WiFi" connection type
3. Click "Scan Networks" button
4. **Expected**: 
   - Real WiFi networks from `/forwarder/network/wifi/scan` endpoint
   - If scan fails: Empty list + error toast with actual error message
   - No "greenreach" or demo networks

### Test 2: Device Setup WiFi Configuration
1. Navigate to Integrations → SwitchBot or device setup
2. Add a new WiFi device (plug, switch, or light)
3. Check WiFi configuration fields
4. **Expected**:
   - SSID field: Empty
   - Password field: Empty
   - No pre-filled "greenreach" or "Farms2024"
   - User must enter credentials manually

### Test 3: Farm Registration Form Submission
1. Complete Farm Registration wizard with real data:
   - WiFi network (from scan)
   - WiFi password (manual entry)
   - Farm name, address, city, state
   - Contact name, email, phone
2. Click "Save Farm"
3. **Expected**:
   - Data saved to `STATE.farm` and persisted to server
   - No demo/mock data mixed in
   - WiFi credentials from wizard used for device provisioning

## Impact on User Experience

### Before (Mock Data)
- ❌ WiFi scan failures showed fake networks
- ❌ Devices auto-configured with "greenreach" network
- ❌ Users could proceed without real network setup
- ❌ Confusion between test and production environments

### After (Live Data Only)
- ✅ WiFi scan failures show clear error messages
- ✅ Devices require manual WiFi configuration
- ✅ Users must complete real network setup to proceed
- ✅ Production environment isolated from test data
- ✅ Errors point to actual problems (API, connectivity)

## Related Files

- `public/app.charlie.js` - Main application logic (Farm Registration, device setup)
- `docs/LIVE_TESTING_SETUP.md` - Comprehensive live testing guide
- `server-charlie.js` - Server endpoints for WiFi scanning and device discovery

## API Dependencies

### WiFi Scanning
**Endpoint**: `GET /forwarder/network/wifi/scan`  
**Expected Response**: Array of network objects with `ssid`, `signal`, `security`

### Device Discovery
**Endpoint**: `POST /discovery/scan`  
**Expected Response**: Object with `devices` array containing discovered devices

### Device Provisioning
Uses WiFi credentials from `FarmWizard.data.connection.wifi`:
- `ssid`: User-entered or scanned network name
- `password`: User-entered password
- No hardcoded fallbacks

## Rollback Plan

If live testing reveals issues and mock data is temporarily needed:

1. **Restore WiFi credentials** (line ~8654):
   ```javascript
   wifi: { ssid: 'greenreach', psk: 'Farms2024', useStatic: false, staticIp: null }
   ```

2. **Restore WiFi scan fallback** (line ~3813):
   ```javascript
   this.wifiNetworks = [
     { ssid: 'greenreach', signal: -42, security: 'WPA2' },
     // ... other networks
   ];
   ```

3. Commit with message: `temp: restore mock data for testing`

**Note**: Mock data should only be restored temporarily for debugging. Production deployments must use live data only.

## Known Limitations

1. **WiFi Scanning**: Requires network interface with scan capability
   - May not work in all environments (VMs, containers, limited permissions)
   - Fallback: Users can manually enter SSID (hidden network support)

2. **Device Discovery**: Requires multicast/broadcast support
   - mDNS (Bonjour) must not be blocked by firewall
   - SSDP discovery requires UDP 1900 access

3. **API Endpoint Availability**: 
   - Server must be running on localhost:8091 or configured endpoint
   - Python backend (FastAPI) must be running for some discovery protocols

## Next Steps

1. ✅ Test WiFi scanning with real network adapter
2. ✅ Test device provisioning with actual SwitchBot devices
3. ✅ Verify farm registration saves correctly without mock data
4. ✅ Test error handling when endpoints are unreachable
5. ⬜ Update user documentation to explain manual WiFi entry for hidden networks

---

**Maintainer**: Light Engine Charlie Team  
**Last Updated**: October 16, 2025  
**Related Issues**: Live testing preparation, mock data cleanup
