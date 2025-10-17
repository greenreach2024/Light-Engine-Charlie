# Device Discovery Workflow

## Overview

The Universal Device Scanner provides a comprehensive workflow for discovering, authenticating, and onboarding IoT devices into the Light Engine Charlie platform. This document describes the complete user flow from device discovery through authentication to final device registration.

## Workflow Steps

### 1. Device Discovery (Integrations Panel)

**User Action**: Click "Start Scan" button in Universal Device Scanner card

**Backend Process**:
- POST request to `http://127.0.0.1:8000/discovery/scan`
- Parallel scanning across multiple protocols:
  - TP-Link Kasa (UDP broadcast, 5s timeout)
  - BLE devices (5s scan)
  - mDNS/Bonjour (3s scan)
  - MQTT devices (from registry)
- Returns unified device list with fields:
  - `name`: Device name
  - `brand`/`vendor`: Manufacturer
  - `protocol`/`comm_type`: Communication protocol
  - `ip`: IP address (if available)
  - `mac`: MAC address (if available)
  - `deviceId`: Unique device identifier
  - `model`: Device model

**Frontend Display**:
- Progress indicator with animated spinner
- Results table showing:
  - Device name
  - Brand/vendor
  - Protocol (color-coded badge)
  - IP/ID/MAC
  - Action buttons: **Accept** and **Ignore**

### 2. Accept/Ignore Decision

**Accept Button** (Green):
- Determines if device requires authentication
- **Requires Sign-In**: SwitchBot, TP-Link Kasa
- **No Authentication**: mDNS devices (Apple TV, ecobee, printers, etc.)
- Shows modal sign-in form if needed
- Adds device to IoT Devices panel after success

**Ignore Button** (Gray):
- Removes device from scan results
- Fades out row with animation
- Updates device count
- Shows toast: "Device ignored, will not be added"
- No persistence (device will reappear in next scan)

### 3. Device Authentication (Modal Forms)

#### SwitchBot Devices
**Form Fields**:
- API Token (text input)
- API Secret (password input)

**Actions**:
- Cancel: Close modal, return to scan results
- Sign In & Add Device: Validate credentials, add to IoT

**Credential Storage**:
- Stored in device payload under `credentials: { token, secret }`
- Used for future API calls to SwitchBot Cloud

#### TP-Link Kasa Devices
**Form Fields**:
- Email (email input)
- Password (password input)

**Actions**:
- Cancel: Close modal, return to scan results
- Sign In & Add Device: Validate credentials, add to IoT

**Credential Storage**:
- Stored in device payload under `credentials: { email, password }`
- Used for Kasa Cloud API authentication

#### Other Protocols (Future)
Planned sign-in forms for:
- **Zigbee**: Hub selection + pairing mode
- **Shelly**: API key entry
- **MQTT**: Broker URL + username + password
- **Z-Wave**: Hub selection + inclusion mode

### 4. Device Transfer to IoT Devices

**After Authentication** (or immediately for non-auth devices):
1. Create device payload:
   ```json
   {
     "name": "My Device",
     "brand": "Vendor Name",
     "protocol": "kasa",
     "ip": "192.168.1.100",
     "mac": "AA:BB:CC:DD:EE:FF",
     "deviceId": "unique-id",
     "model": "HS100",
     "credentials": { ... }
   }
   ```

2. Add to `STATE.iotDevices` array
3. Remove from scan results table (fade animation)
4. Update device count
5. Call `renderIoTDeviceCards()` to refresh IoT Devices panel
6. Show success toast: "Device Name added to IoT devices"

**TODO**: Persist to backend via `POST /api/iot/devices`

## Technical Implementation

### Frontend Functions

**`runUniversalScan()`** (Line 1749)
- Entry point for scan workflow
- Handles progress animation
- Calls backend endpoint
- Renders results table

**`acceptDiscoveredDevice(index)`** (Line 1883)
- Handles Accept button click
- Checks if authentication required
- Shows sign-in modal or adds directly

**`ignoreDiscoveredDevice(index)`** (Line 1902)
- Handles Ignore button click
- Animates row removal
- Updates device count

**`showDeviceSignInForm(device, index)`** (Line 1935)
- Creates modal overlay
- Renders protocol-specific form
- Handles Cancel and Submit actions

**`submitDeviceSignIn(deviceIndex, protocol)`** (Line 2055)
- Validates form inputs
- Extracts credentials
- Calls `addDeviceToIoT()`

**`addDeviceToIoT(device, index, credentials)`** (Line 2082)
- Creates device payload
- Adds to STATE.iotDevices
- Removes from scan results
- Triggers UI refresh
- Shows success toast

### Backend Endpoint

**`POST /discovery/scan`** (backend/server.py:1338)

**Request**: Empty POST body

**Response**:
```json
{
  "status": "success",
  "devices": [
    {
      "name": "Apple TV",
      "brand": "Unknown",
      "vendor": "Unknown",
      "protocol": "mdns",
      "comm_type": "mDNS",
      "ip": null,
      "mac": null,
      "deviceId": null,
      "model": null
    }
  ],
  "count": 9,
  "timestamp": 516682.548988375
}
```

**Parallel Discovery**:
```python
results = await asyncio.gather(
    discover_kasa_devices(),
    discover_ble_devices(),
    discover_mdns_devices(),
    return_exceptions=True
)
```

## Device Protocol Matrix

| Protocol | Auth Required | Credentials | Backend Support |
|----------|---------------|-------------|-----------------|
| mDNS/Bonjour | ❌ | None | ✅ Implemented |
| BLE | ❌ | None | ✅ Implemented |
| TP-Link Kasa | ✅ | Email + Password | ✅ Implemented |
| SwitchBot | ✅ | Token + Secret | ✅ Implemented |
| MQTT | ✅ | Broker + User + Pass | ⏳ Planned |
| Zigbee | ✅ | Hub + Pairing | ⏳ Planned |
| Shelly | ✅ | API Key | ⏳ Planned |
| Z-Wave | ✅ | Hub + Inclusion | ⏳ Planned |
| SSDP/UPnP | ❌ | None | ⏳ Planned |

## UI States

### Initial State
- Universal Scanner card collapsed
- "Start Scan" button enabled
- No results visible

### Scanning State
- Progress indicator visible
- Animated spinner + progress bar
- Status text: "Scanning WiFi, BLE, MQTT..."
- Button disabled, text: "Scanning..."

### Results State
- Progress hidden
- Results container visible
- Device count displayed
- Table with Accept/Ignore buttons
- Info banner explaining workflow

### Empty Results
```
No devices found. Check network connection.
```

### All Processed
```
✓ All devices processed. Run scan again to discover more.
```

## Error Handling

### Backend Scan Failure
- Toast: "Scan failed - Could not complete device scan"
- Console error logged
- Progress bar completes to 100%
- Button re-enabled

### Missing Device Credentials
- Toast: "Please enter both token and secret"
- Modal remains open
- No device added

### Device Add Failure
- Toast: "Failed to add device: [error message]"
- Console error logged
- Device remains in scan results

## Known Issues & Limitations

1. **IP Address Extraction**: mDNS devices return `ip: null` - need to extract from DNS records
2. **Vendor Detection**: Most devices show "Unknown" vendor - need better detection from service types
3. **Backend Persistence**: Device payload not yet persisted to database (TODO)
4. **IoT Panel Integration**: `renderIoTDeviceCards()` may not exist yet
5. **Duplicate Detection**: No deduplication if device found via multiple protocols
6. **Credential Validation**: No backend test of credentials before adding device

## Future Enhancements

### Protocol Additions
- SSDP/UPnP discovery for network devices
- Zigbee hub scanning and pairing
- Z-Wave controller integration
- Shelly HTTP discovery
- Thread/Matter device support

### UI Improvements
- Batch accept/ignore (checkboxes)
- Device filtering by protocol/vendor
- Save ignored devices list
- Rescan individual devices
- Device detail view with capabilities

### Backend Improvements
- Vendor database lookup by MAC OUI
- IP extraction from mDNS records
- Device capability detection
- Firmware version checking
- Automatic setup wizard selection

### Integration
- Auto-populate device knowledge base
- Link devices to rooms/zones
- Suggest automation rules
- Device health monitoring
- Offline device alerts

## Testing

### Manual Test Procedure
1. Open Integrations panel
2. Click "Start Scan"
3. Verify progress animation
4. Wait for results (5-10 seconds)
5. Verify device list populated
6. Click "Ignore" on a device → row disappears
7. Click "Accept" on mDNS device → added to IoT Devices
8. Click "Accept" on Kasa device → sign-in modal appears
9. Enter credentials → device added to IoT Devices
10. Verify all accepted devices removed from scan results

### Backend Test
```bash
curl -X POST http://127.0.0.1:8000/discovery/scan | jq '.'
```

**Expected**: JSON with `status: "success"`, `count` > 0, `devices` array

### Frontend Test
1. Open browser console
2. Run scan
3. Check for errors in console
4. Verify `window.LAST_UNIVERSAL_SCAN` populated
5. Verify `STATE.iotDevices` updated after accept

## Troubleshooting

### "No devices found" in UI but curl shows devices
- **Cause**: Frontend API endpoint mismatch
- **Fix**: Check `API_BASE` constant points to Python backend (port 8000)
- **Solution**: Hardcoded `http://127.0.0.1:8000/discovery/scan` in fetch call

### Devices don't appear in IoT Devices panel
- **Cause**: `renderIoTDeviceCards()` function doesn't exist
- **Fix**: Create IoT Devices rendering function
- **Workaround**: Check `STATE.iotDevices` in console

### Sign-in modal doesn't close
- **Cause**: Missing `closeDeviceSignInModal()` binding
- **Fix**: Check onclick handler attached to Cancel button
- **Workaround**: Refresh page

### Credentials not saved
- **Cause**: No backend persistence endpoint
- **Fix**: Create `POST /api/iot/devices` endpoint
- **Status**: TODO in backend

## Related Documentation

- `UNIVERSAL_SCANNER.md` - Original scanner specification
- `IOT_UNIVERSAL_SCANNER.md` - IoT integration design
- `DEEP_DISCOVERY_SYSTEM.md` - Advanced discovery features
- `SWITCHBOT-INTEGRATION.md` - SwitchBot API details

## Changelog

**2025-01-XX**
- Fixed API endpoint to point to Python backend (port 8000)
- Replaced "Add" button with "Accept" and "Ignore" buttons
- Added protocol-specific sign-in modal forms
- Implemented device transfer to IoT Devices panel
- Added fade animations for row removal
- Updated UI instructions banner
- Added console logging for debugging

**Previous**
- Initial Universal Scanner implementation
- Basic device discovery across protocols
- Simple "Add" button workflow
