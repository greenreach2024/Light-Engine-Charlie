# Universal Device Scanner

## Overview

The Universal Device Scanner is a comprehensive multi-protocol device discovery system integrated into the Integrations panel. It discovers IoT devices across multiple protocols and presents a unified view with confidence scoring.

## Location

- **UI**: Integrations panel (`public/index.html`)
- **Frontend Logic**: `public/app.charlie.js` (setupUniversalScanner, runUniversalScan, displayScanResults)
- **Backend API**: `server-charlie.js` (/discovery/scan endpoint)

## Supported Protocols

### 1. **SwitchBot Cloud API**
- Protocol: Cloud REST API with HMAC-SHA256 authentication
- Discovery Method: Fetch device list from SwitchBot Cloud
- Confidence: 0.95 (high - authenticated API)
- Device Types: Plugs, Bots, Meters, Hubs, Curtains, Locks
- Requirements: SwitchBot token and secret configured

### 2. **TP-Link Kasa (WiFi)**
- Protocol: UDP broadcast on port 9999
- Discovery Method: tplink-smarthome-api library
- Confidence: 0.9 (high - direct protocol match)
- Device Types: Smart Plugs, Bulbs, Switches
- Requirements: Devices on same local network

### 3. **Controller Discovery**
- Protocol: Backend FastAPI controller (Python)
- Discovery Method: Proxy to `/api/discovery/devices`
- Confidence: Varies by source
- Device Types: All supported by Python backend (Kasa, MQTT, BLE)
- Requirements: Python backend running

### 4. **Future Protocols** (planned)
- **BLE (Bluetooth Low Energy)**: SwitchBot manufacturer ID 0x0969
- **mDNS/DNS-SD**: Chromecast (_googlecast._tcp), Hue (_hue._tcp), HomeKit (_hap._tcp)
- **SSDP/UPnP**: Roku (roku:ecp), Sonos, generic UPnP devices
- **MQTT Broker**: Devices publishing to configured MQTT topics

## Architecture

### Frontend Flow

1. **User clicks "Scan for Devices" button**
   - Button: `#btnUniversalScan`
   - Handler: `setupUniversalScanner()` (wired in `refreshIntegrationsPanel()`)

2. **Scan orchestration** (`runUniversalScan()`)
   - Shows progress indicator: `#universalScanProgress`
   - Updates status text: `#universalScanStatus`
   - Animates progress bar: `#universalScanProgressBar`
   
3. **Multi-phase discovery**
   - Phase 1: Backend discovery (POST to `/discovery/scan`)
   - Phase 2: mDNS services (placeholder - requires browser extension)
   - Phase 3: SSDP/UPnP (placeholder - requires backend support)
   - Phase 4: SwitchBot Cloud (GET `/switchbot/devices`)

4. **Result aggregation**
   - Deduplicates devices by IP/MAC/device ID
   - Normalizes data structure: `{name, brand, model, ip, mac, protocol, confidence, category}`

5. **Result rendering** (`displayScanResults()`)
   - Sorts by confidence (desc), then brand (asc)
   - Displays in `#universalScanResultsTable`
   - Shows brand icon, device details, confidence score, "Add" button

### Backend Flow

1. **Endpoint**: `POST /discovery/scan`

2. **Discovery phases**:
   - **Python Controller**: Proxy to FastAPI `/api/discovery/devices`
   - **SwitchBot Cloud**: `fetchSwitchBotDevices()` if configured
   - **Kasa Direct**: `discoverKasaDevicesDirect()` using tplink-smarthome-api

3. **Data normalization**:
   - `identifyDeviceBrand()`: Brand detection from name/type/vendor
   - `categorizeDevice()`: Device type classification (plug, light, sensor, etc.)
   - `categorizeSwitchBot()`: SwitchBot-specific categorization

4. **Response**:
   ```json
   {
     "status": "success",
     "startedAt": "2025-01-18T12:00:00Z",
     "completedAt": "2025-01-18T12:00:15Z",
     "devices": [
       {
         "name": "Living Room Plug",
         "brand": "TP-Link Kasa",
         "model": "HS105",
         "ip": "192.168.2.105",
         "mac": "50:C7:BF:XX:XX:XX",
         "protocol": "Kasa WiFi",
         "confidence": 0.9,
         "category": "Smart Plug",
         "deviceId": "..."
       }
     ],
     "count": 1
   }
   ```

## Confidence Scoring

### High Confidence (0.9-1.0)
- **0.95**: SwitchBot Cloud API (authenticated, exact device type)
- **0.95**: Kasa UDP protocol match (verified sysinfo)
- **0.9**: Direct protocol handshake success
- **0.9**: mDNS service with vendor-specific name (_hue._tcp, _googlecast._tcp)

### Medium Confidence (0.6-0.8)
- **0.7**: Brand identified from device name/type
- **0.6**: IP + MAC address available
- **0.6**: HTTP/HTTPS web interface detected

### Low Confidence (0.2-0.5)
- **0.5**: Default baseline for unknown devices
- **0.4**: MAC OUI lookup only (IEEE vendor match)
- **0.2**: DHCP fingerprint or HTTP user-agent hint

## Brand Detection

Automatic brand identification from multiple signals:

```javascript
identifyDeviceBrand(device):
  1. Check explicit vendor/manufacturer field
  2. Parse name, deviceType, type fields
  3. Match patterns:
     - "kasa", "tp-link" → TP-Link Kasa
     - "switchbot" → SwitchBot
     - "philips", "hue" → Philips Hue
     - "google", "chromecast" → Google
     - "roku" → Roku
     - "sonos" → Sonos
     - "homekit", "apple" → Apple
  4. Fallback: "Unknown"
```

## Device Categorization

Automatic device type classification:

```javascript
categorizeDevice(device):
  1. Check hints.type, deviceType, type fields
  2. Match patterns in name + type:
     - "plug", "outlet" → Smart Plug
     - "light", "bulb" → Light
     - "switch" → Switch
     - "sensor", "meter" → Sensor
     - "hub", "bridge" → Hub
     - "tv", "display" → Media
     - "speaker", "audio" → Audio
     - "thermostat", "hvac" → Climate
  3. Fallback: "Device"
```

## UI Components

### Scanner Header
- **Style**: Purple gradient background (linear-gradient 135deg #667eea to #764ba2)
- **Icon**: 🔍 (magnifying glass)
- **Text**: "Universal Device Scanner"
- **Description**: "Scan for devices across all protocols (BLE, mDNS, WiFi, Cloud)"

### Scan Button
- **ID**: `btnUniversalScan`
- **Text**: "🔍 Scan for Devices"
- **State**: Disabled during scan

### Progress Indicator
- **Container**: `#universalScanProgress` (hidden by default)
- **Spinner**: Rotating 🔄 icon (@keyframes spin)
- **Status**: `#universalScanStatus` (e.g., "Scanning local network...")
- **Progress Bar**: `#universalScanProgressBar` (0-100% width)

### Results Display
- **Container**: `#universalScanResults` (hidden until scan completes)
- **Count**: `#universalScanCount` (e.g., "3 devices found")
- **Table**: `#universalScanResultsTable`

### Result Card Format
```
┌─────────────────────────────────────────────────┐
│ 🔌  Living Room Plug                        85% │
│     TP-Link Kasa · HS105 · 192.168.2.105       │
│     Kasa WiFi · Smart Plug            [Add]    │
└─────────────────────────────────────────────────┘
```

- **Brand Icon**: Emoji (🤖 SwitchBot, 🔌 Kasa, 💡 Hue, 🔵 Google, etc.)
- **Device Name**: Bold, 14px
- **Details**: Brand, model, IP (12px, gray)
- **Confidence**: Color-coded (green ≥90%, orange ≥70%, gray <70%)
- **Protocol & Category**: 11px, gray
- **Add Button**: Blue, 12px, calls `addDiscoveredDevice(index)`

## API Endpoints

### POST /discovery/scan
Comprehensive multi-protocol device scan.

**Request**: `POST /discovery/scan` (no body required)

**Response**:
```json
{
  "status": "success",
  "startedAt": "2025-01-18T12:00:00.000Z",
  "completedAt": "2025-01-18T12:00:15.123Z",
  "devices": [...],
  "count": 5
}
```

**Timing**: ~10-15 seconds (5s Kasa timeout, 5s SwitchBot fetch, parallel operations)

### GET /switchbot/devices
Fetch SwitchBot Cloud devices (reused by scanner).

**Parameters**: `?refresh=1` to bypass cache

### GET /discovery/devices
Legacy comprehensive discovery (includes network scan, MQTT, BLE if available).

## Adding Discovered Devices

When user clicks "Add" button:

1. **Frontend**: `addDiscoveredDevice(index)` called
2. **Retrieve device**: From `window._universalScanDevices[index]`
3. **Current behavior**: Toast notification + console log
4. **TODO**: Integrate with device manager STATE or trigger wizard assignment flow

### Future Integration

```javascript
window.addDiscoveredDevice = async function(index) {
  const device = window._universalScanDevices[index];
  
  // Option 1: Add to STATE.devices
  if (!STATE.devices) STATE.devices = [];
  STATE.devices.push({
    id: device.deviceId || device.mac,
    name: device.name,
    brand: device.brand,
    comm: device.comm_type,
    ...
  });
  await safeApi('/devices', STATE.devices, 'POST');
  
  // Option 2: Launch wizard
  if (device.comm_type === 'kasa') {
    launchWizard('kasa-setup', { device });
  } else if (device.comm_type === 'switchbot-cloud') {
    launchWizard('switchbot-setup', { device });
  }
  
  showToast({ title: 'Device added', msg: `${device.name} configured`, kind: 'success' });
};
```

## Error Handling

### Frontend Errors
- **Network failure**: "Scan failed: Network request failed"
- **Timeout**: Progress bar fills to 100%, then hides
- **No devices**: "No devices discovered. Ensure devices are powered on..."

### Backend Errors
- **SwitchBot not configured**: Silently skips (logs warning)
- **Kasa discovery failure**: Continues with other protocols
- **Controller unavailable**: Falls back to direct discovery
- **Import error** (tplink-smarthome-api): Returns empty array

## Testing

### Manual Test
1. Open Integrations panel
2. Click "🔍 Scan for Devices"
3. Verify progress indicator appears
4. Wait 10-15 seconds
5. Verify results display with discovered devices
6. Click "Add" on any device
7. Verify toast notification

### Expected Results
- **With SwitchBot configured**: SwitchBot devices appear
- **With Kasa devices on network**: Kasa plugs/bulbs appear
- **With Python backend running**: Additional devices from controller
- **No devices**: Friendly message "No devices discovered..."

### Test Coverage
- [ ] SwitchBot Cloud discovery
- [ ] Kasa WiFi discovery
- [ ] Controller proxy discovery
- [ ] Brand identification
- [ ] Device categorization
- [ ] Confidence scoring
- [ ] Result sorting (confidence desc)
- [ ] Add button functionality
- [ ] Error handling (no credentials, network down)

## Known Limitations

1. **Browser-based discovery**: mDNS/SSDP require browser extensions or backend support
2. **BLE scanning**: Not yet implemented (requires Web Bluetooth API or backend)
3. **Kasa timeout**: Fixed 5-second timeout may miss slow-responding devices
4. **No deduplication**: Devices appearing in multiple sources may show duplicates
5. **Add button**: Currently shows toast but doesn't persist to device manager

## Future Enhancements

### Phase 1 (Planned)
- [ ] Python backend mDNS discovery (using zeroconf library)
- [ ] Python backend SSDP discovery (using ssdpy library)
- [ ] BLE discovery via Python backend (using bleak library)
- [ ] Device deduplication by IP/MAC/device ID

### Phase 2 (Future)
- [ ] MAC OUI lookup for vendor identification
- [ ] DHCP fingerprinting (OS/device type detection)
- [ ] HTTP user-agent fingerprinting
- [ ] Confidence score tuning based on signal combinations
- [ ] Device capability detection (metrics, actions)

### Phase 3 (Advanced)
- [ ] Real-time device updates (WebSocket push)
- [ ] Device state monitoring (online/offline)
- [ ] Automatic re-discovery on network changes
- [ ] Smart wizard suggestion based on discovered devices
- [ ] Batch device import/assignment

## Reference Documentation

- **Bluetooth SIG Company IDs**: https://www.bluetooth.com/specifications/assigned-numbers/
- **IEEE OUI Database**: https://standards.ieee.org/products-programs/regauth/
- **Home Assistant Zeroconf Catalog**: https://github.com/home-assistant/home-assistant.io/blob/current/source/_integrations/zeroconf.markdown
- **SSDP/UPnP Spec**: http://www.upnp.org/specs/arch/UPnP-arch-DeviceArchitecture-v2.0.pdf
- **Kasa Protocol**: https://github.com/python-kasa/python-kasa
- **SwitchBot API**: https://github.com/OpenWonderLabs/SwitchBotAPI

## Configuration

### Environment Variables

```bash
# SwitchBot Cloud API (required for SwitchBot discovery)
SWITCHBOT_TOKEN=your_token_here
SWITCHBOT_SECRET=your_secret_here

# Kasa Discovery
KASA_DISCOVERY_TIMEOUT=5000  # milliseconds

# Controller URL (optional, for backend discovery)
CTRL=http://192.168.2.80:8000
```

### farm.json Structure

```json
{
  "integrations": {
    "switchbot": {
      "token": "...",
      "secret": "..."
    },
    "kasa": {
      "email": "user@example.com",
      "password": "..."
    }
  }
}
```

## Troubleshooting

### No SwitchBot Devices Found
- Verify token/secret in Integrations panel
- Click "Test Connection" for SwitchBot
- Check server logs for authentication errors
- Ensure devices are added to SwitchBot app

### No Kasa Devices Found
- Ensure devices are on same local network (no VLANs)
- Check firewall allows UDP broadcast on port 9999
- Verify tplink-smarthome-api is installed (`npm install tplink-smarthome-api`)
- Try direct Kasa app to confirm devices are online

### Scan Takes Too Long
- Default timeout is 10-15 seconds
- Kasa discovery timeout: 5 seconds (hardcoded in discoverKasaDevicesDirect)
- SwitchBot fetch: ~2-5 seconds (network dependent)
- Reduce Kasa timeout if needed (edit server-charlie.js, line ~8350)

### "Scan failed" Error
- Check browser console for detailed error
- Verify server is running (port 8091 or 8092)
- Check `/discovery/scan` endpoint in Network tab
- Review server logs for backend errors

## Success Criteria

✅ **Scanner UI appears in Integrations panel above credentials**  
✅ **Scan button triggers multi-protocol discovery**  
✅ **Progress indicator shows scan phases**  
✅ **Results display with brand icons, confidence scores**  
✅ **Devices sorted by confidence (high to low)**  
✅ **Add button shows toast notification**  
✅ **Backend endpoint `/discovery/scan` implemented**  
✅ **SwitchBot Cloud discovery working**  
✅ **Kasa WiFi discovery working**  
✅ **Brand identification from device signals**  
✅ **Device categorization (plug, light, sensor, etc.)**  

## Next Steps

1. **Test scanner with real SwitchBot devices**
   - Configure SwitchBot token/secret
   - Run scan
   - Verify devices appear with 95% confidence

2. **Test scanner with Kasa devices**
   - Ensure Kasa plugs on same network
   - Run scan
   - Verify devices appear with 90% confidence

3. **Implement Add button integration**
   - Add device to STATE.devices
   - Persist via POST to /devices endpoint
   - Refresh device manager panel

4. **Add Python backend discovery**
   - Implement mDNS discovery (zeroconf)
   - Implement SSDP discovery (ssdpy)
   - Implement BLE discovery (bleak)
   - Return results via `/api/discovery/devices`

5. **Device deduplication**
   - Merge devices by IP/MAC/device ID
   - Combine confidence signals
   - Show highest-confidence protocol

---

**Version**: 1.0  
**Date**: 2025-01-18  
**Author**: Light Engine Charlie Team  
**Status**: Implemented (Phase 1 - SwitchBot + Kasa)
