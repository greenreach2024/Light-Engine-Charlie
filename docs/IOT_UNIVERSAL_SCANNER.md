# IoT Universal Scanner Implementation

## Overview

The IoT Universal Scanner extends the Universal Device Scanner functionality to the **IoT Devices** panel, providing comprehensive device discovery with equipment assignment capabilities for farm automation.

## Implementation Date
January 2025

## Key Features

### 1. Universal Device Discovery
- **Multi-Protocol Scanning**: Discovers devices using:
  - SwitchBot Cloud API (0.95 confidence)
  - TP-Link Kasa UDP port 9999 (0.9 confidence)
  - Controller proxy endpoints
  - Future: mDNS, SSDP, BLE

### 2. Device Cards
Each discovered device is displayed with:
- **Brand Icon**: Visual identification (🤖 SwitchBot, 🔌 Kasa, 💡 Hue, etc.)
- **Device Name**: Friendly name or model designation
- **Metadata**: Brand, category (plug/sensor/light), protocol
- **Device Details**: Model, protocol, IP address, MAC address
- **Confidence Indicator**: Color-coded dot (green >90%, yellow >70%, gray <70%)

### 3. Equipment Assignment
- **Dropdown Selection**: Each device card includes an equipment assignment dropdown
- **Wireless Filter**: Only equipment with wireless control (WiFi, Smart Plug, Wired) appears in dropdown
- **Persistent Mapping**: Assignments stored in `window._iotDeviceAssignments` by device key (MAC/IP/name)
- **Toast Notifications**: Confirms successful assignments
- **Future**: Backend persistence via API endpoint

### 4. Device Controls
- **Smart Plugs/Lights**: Toggle power button (⚡ Toggle Power)
- **Sensors**: View data button (📊 View Data)
- **Coming Soon**: Live status indicators, real-time control implementation

### 5. Device Manager Setup Cards
- **Automatic Detection**: Displays setup cards only for known/supported ecosystems
- **Supported Brands**: SwitchBot, TP-Link Kasa
- **Device Count**: Shows how many devices of each brand were discovered
- **Quick Configuration**: One-click access to brand-specific setup wizards

## Architecture

### Frontend Components

#### HTML Elements (`public/index.charlie.html`)
```html
<!-- IoT Devices Panel -->
<section id="iotPanel" data-panel="iot-devices">
  <!-- Universal Scanner Button -->
  <button id="btnUniversalScanIoT">Universal Scanner</button>
  
  <!-- Progress Bar -->
  <div id="iotUniversalScanProgress">
    <div id="iotUniversalScanBar"></div>
    <span id="iotUniversalScanPercent">0%</span>
  </div>
  
  <!-- Device Cards Container -->
  <div id="iotUniversalScanResults">
    <div id="iotUniversalScanDeviceCards"></div>
  </div>
  
  <!-- Device Manager Cards -->
  <div id="iotDeviceManagerCards">
    <div id="iotDeviceManagerList"></div>
  </div>
</section>
```

#### JavaScript Functions (`public/app.charlie.js`)

**`setupIoTUniversalScanner()`**
- Wires the `btnUniversalScanIoT` button
- Called when `iot-devices` panel becomes active
- Uses `dataset.wired` flag to prevent double-binding

**`runIoTUniversalScan()`**
- Executes multi-phase device discovery
- Updates progress bar (20% → 40% → 60% → 80% → 100%)
- Fetches from `/discovery/scan` endpoint
- Fetches from `/switchbot/devices` endpoint
- Calls `renderUniversalIoTDeviceCards()` with results

**`renderUniversalIoTDeviceCards(devices)`**
- Filters equipment for wireless control only
- Creates device cards with assignment dropdowns
- Adds device control buttons based on category
- Generates device manager setup cards for supported brands
- Stores assignments in `window._iotDeviceAssignments`

**`getBrandIcon(brand)`**
- Maps brand names to emoji icons
- Supports: SwitchBot 🤖, Kasa 🔌, Hue 💡, Sonoff ⚡, Shelly 🔵, etc.

### Backend Endpoints

**`POST /discovery/scan`** (`server-charlie.js`)
- Aggregates device discovery from multiple sources
- Returns: `{ status, devices: [], count }`
- Includes brand identification and confidence scoring

**`GET /switchbot/devices`** (`server-charlie.js`)
- Fetches devices from SwitchBot Cloud API
- Requires `SWITCHBOT_TOKEN` and `SWITCHBOT_SECRET` env vars
- Returns: `{ devices: [] }` with SwitchBot-specific metadata

## Data Flow

```
User clicks "Universal Scanner"
  ↓
setupIoTUniversalScanner() → runIoTUniversalScan()
  ↓
[Phase 1: 20%] POST /discovery/scan → Backend Kasa/MQTT/BLE discovery
  ↓
[Phase 2: 40-60%] Placeholder for mDNS/SSDP (future)
  ↓
[Phase 3: 80%] GET /switchbot/devices → SwitchBot Cloud API
  ↓
[Phase 4: 100%] Aggregate results, normalize device objects
  ↓
renderUniversalIoTDeviceCards(devices)
  ↓
Filter wireless equipment from STATE.rooms
  ↓
Create device cards with:
  - Brand icon, name, details
  - Equipment assignment dropdown (wireless only)
  - Device control buttons (category-specific)
  ↓
Render device manager cards (SwitchBot, Kasa only)
  ↓
Display results, hide progress bar
```

## Equipment Assignment Logic

### Filtering Criteria
Equipment must have `control` field matching:
- `WiFi`
- `Smart Plug`
- `Wired`

Equipment with `control: 'None'` is **excluded** from assignment dropdowns.

### Equipment Name Format
```javascript
`${eq.vendor || eq.manufacturer || ''} ${eq.model || ''} (${room.name || room.id})`.trim()
```

Example: `"ACME LED Panel (Grow Room A)"`

### Assignment Storage
```javascript
window._iotDeviceAssignments = {
  "AA:BB:CC:DD:EE:FF": "ACME LED Panel (Grow Room A)",
  "192.168.1.42": "SwitchBot Sensor (Drying Room)"
}
```

Key priority: `device.mac` > `device.ip` > `device.name`

### Future Backend Persistence
Assignments should be saved to:
```
POST /iot/assignments
{
  "deviceKey": "AA:BB:CC:DD:EE:FF",
  "equipmentName": "ACME LED Panel (Grow Room A)",
  "assignedAt": "2025-01-15T12:34:56Z"
}
```

## Device Manager Integration

### Conditional Rendering
Device manager setup cards only appear when:
```javascript
const supportedBrands = ['SwitchBot', 'TP-Link Kasa'];
const detectedSupported = knownBrands.filter(b => supportedBrands.includes(b));
```

### Setup Card Structure
```html
<div class="device-manager-card">
  <span>🤖</span> <!-- Brand icon -->
  <div>
    <div>SwitchBot</div>
    <div class="tiny">3 devices detected</div>
  </div>
  <button onclick="openSwitchBotManager()">Configure</button>
</div>
```

### Manager Functions
- `window.openSwitchBotManager()` - Opens SwitchBot configuration modal
- `window.openTPLinkKasaManager()` - Opens Kasa setup wizard (coming soon)

## Styling

### Progress Bar
- Purple gradient theme: `#a855f7` → `#c084fc`
- Shimmer animation for visual feedback
- 28px height with rounded corners

### Device Cards
- Grid layout: `repeat(auto-fill, minmax(340px, 1fr))`
- 12px gap between cards
- White background with subtle shadow
- Responsive down to 340px card width

### Confidence Indicator
- Green dot (>90%): `#10b981`
- Yellow dot (70-90%): `#f59e0b`
- Gray dot (<70%): `#64748b`

## User Workflow

1. **Navigate to IoT Devices panel** (Control Devices → IoT Devices)
2. **Click "Universal Scanner"** button
3. **Watch progress bar** advance through discovery phases
4. **Review device cards** with brand icons and details
5. **Assign devices to equipment** using dropdown (wireless only)
6. **Configure device managers** for detected ecosystems (SwitchBot, Kasa)
7. **(Future) Toggle device power** or view live sensor data

## Removed Features

The following elements were **removed** from the IoT Devices panel:
- ❌ Old "Scan for Devices" button (`btnScanIoTDevices`)
- ❌ Legacy IoT scan progress bar (`iotScanBarContainer`)
- ❌ Standalone SwitchBot Manager button in header (moved to Device Manager Cards)

The legacy `renderIoTDeviceCards()` function is **preserved** for backward compatibility but not actively used.

## Configuration

### Environment Variables
```bash
# Required for SwitchBot discovery
SWITCHBOT_TOKEN=your_token_here
SWITCHBOT_SECRET=your_secret_here

# Optional - Backend discovery settings
KASA_DISCOVERY_TIMEOUT=10
MQTT_HOST=192.168.2.38
MQTT_PORT=1883
```

### State Management
```javascript
// Global device assignments
window._iotDeviceAssignments = {};

// Last scan results
window._iotUniversalScanDevices = [];

// Equipment data source
STATE.rooms = [
  {
    name: "Grow Room A",
    equipment: [
      {
        vendor: "ACME",
        model: "LED Panel",
        control: "WiFi",  // ← Must be WiFi/Smart Plug/Wired
        // ...
      }
    ]
  }
];
```

## Testing

### Manual Verification
```bash
# 1. Check HTML elements exist
curl -s http://127.0.0.1:8091/ | grep btnUniversalScanIoT

# 2. Verify JavaScript functions loaded
curl -s http://127.0.0.1:8091/app.charlie.js | grep setupIoTUniversalScanner

# 3. Test scan endpoint
curl -X POST http://127.0.0.1:8091/discovery/scan

# 4. Test SwitchBot endpoint
curl http://127.0.0.1:8091/switchbot/devices
```

### Expected Behavior
- Universal Scanner button visible in IoT Devices panel
- Progress bar animates during scan (20% → 100%)
- Device cards render with brand icons and details
- Equipment assignment dropdowns show only wireless equipment
- Device manager cards appear only for SwitchBot/Kasa devices
- Toast notifications confirm assignments

## Future Enhancements

### Phase 2: Live Device Control
- [ ] Implement real-time power toggle for plugs/lights
- [ ] Show live status indicators (green = on, gray = off)
- [ ] Display sensor data in device cards
- [ ] WebSocket subscriptions for live updates

### Phase 3: Backend Persistence
- [ ] Create `/iot/assignments` endpoint for saving assignments
- [ ] Load existing assignments on panel load
- [ ] Associate assignments with equipment automation rules
- [ ] Show assigned devices in Equipment Overview

### Phase 4: Advanced Discovery
- [ ] mDNS/Zeroconf for Chromecast, Hue, HomeKit
- [ ] SSDP/UPnP for Roku, Sonos, networked devices
- [ ] BLE discovery for SwitchBot, Govee, Mi devices
- [ ] OUI lookup for manufacturer identification from MAC addresses

### Phase 5: Automation Integration
- [ ] Use device assignments in automation rules
- [ ] Trigger equipment control via assigned IoT devices
- [ ] Create "IoT → Equipment" mappings in automation engine
- [ ] Show automation status in device cards

## Troubleshooting

### Scanner button not visible
- Verify server is serving `index.charlie.html` (not `index.html`)
- Check browser console for errors
- Restart server to clear HTML cache

### No devices discovered
- Check backend is running on port 8000
- Verify SwitchBot credentials in env vars
- Ensure Kasa devices are on same subnet
- Check firewall rules for UDP port 9999

### Equipment dropdown empty
- Verify `STATE.rooms` is populated
- Check equipment has `control` field set to WiFi/Smart Plug/Wired
- Inspect browser console: `STATE.rooms`

### Device manager cards not appearing
- Only SwitchBot and TP-Link Kasa show manager cards
- Check `device.brand` matches exactly: 'SwitchBot' or 'TP-Link Kasa'
- Verify devices were discovered in scan

## Related Documentation
- [UNIVERSAL_SCANNER.md](./UNIVERSAL_SCANNER.md) - Original Universal Scanner for Integrations panel
- [DISCOVERY_IMPLEMENTATION.md](./DISCOVERY_IMPLEMENTATION.md) - Backend discovery architecture
- [SWITCHBOT-INTEGRATION.md](./SWITCHBOT-INTEGRATION.md) - SwitchBot Cloud API integration

## Migration Notes

### From Old IoT Device Manager
The old IoT device manager (`renderIoTDeviceCards`) rendered devices in a simple list with trust levels (trusted/quarantine/ignored). The new Universal Scanner:
- Uses grid layout instead of table
- Adds equipment assignment dropdowns
- Shows confidence scores instead of trust levels
- Includes device manager setup cards
- Filters wireless equipment automatically

### Backward Compatibility
The old `renderIoTDeviceCards()` function is still present but not actively used. To switch back:
```javascript
// In setActivePanel() function
if (panelId === 'iot-devices') {
  renderIoTDeviceCards(window.LAST_IOT_SCAN);  // Old version
}
```

## Conclusion

The IoT Universal Scanner provides a comprehensive device discovery and management interface tailored for indoor farming operations. By integrating equipment assignments with device discovery, it bridges the gap between IoT hardware and farm automation workflows.
