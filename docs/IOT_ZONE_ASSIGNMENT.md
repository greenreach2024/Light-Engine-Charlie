# IoT Device Zone Assignment & Automation Control System

## Overview

The zone assignment and automation control features enable operators to:
1. **Assign sensors to zones (1-9)** for zone-specific environmental monitoring
2. **Mark sensors for automation control** to indicate which sensors actively control equipment vs. monitoring only

This allows for zone-specific environmental monitoring, data segmentation across multi-zone facilities, and clear visibility into which sensors drive automation decisions.

## User Interface

### Zone Dropdown Location
- **Card**: IoT Devices card on main dashboard (`index.charlie.html`)
- **Visibility**: Zone controls appear only for SwitchBot WoIOSensor devices
- **Position**: Below the device snapshot, above the telemetry section

### Visual Design

#### Zone Dropdown
- **Container**: Light blue background (`#f0f9ff`) with blue border (`#bae6fd`)
- **Label**: "Zone:" in dark blue text (`#0c4a6e`)
- **Dropdown**: White background with blue border (`#0ea5e9`)
- **Options**: 
  - "Unassigned" (default for devices without a zone)
  - "Zone 1" through "Zone 9"

#### Automation Control Toggle
- **Position**: Below zone dropdown, separated by a light blue divider
- **Checkbox**: Custom styled with blue accent color
- **Label**: "Used for Automation Control"
- **Status Badge**: 
  - **Active** (green): When `automationControl = true` - "Active" badge in green (`#dcfce7` bg, `#166534` text)
  - **Monitor Only** (gray): When `automationControl = false` - "Monitor Only" badge in gray (`#f3f4f6` bg, `#6b7280` text)

### User Interaction

#### Zone Assignment
1. User clicks on zone dropdown for a WoIOSensor device
2. Selects desired zone (1-9) or "Unassigned"
3. System immediately saves the zone assignment
4. Toast notification confirms: "{Device Name} assigned to Zone {N}"

#### Automation Control Toggle
1. User clicks checkbox to enable/disable automation control
2. System immediately saves the automation control flag
3. Status badge updates from "Active" ↔ "Monitor Only"
4. Toast notification confirms: "{Device Name} enabled for automation control" or "set to monitor only"
5. Card re-renders to show updated badge

## Technical Implementation

### Data Model

#### Device Schema Enhancement
Each device in `iot-devices.json` now supports two optional fields:

```json
{
  "id": "C3343035702D",
  "deviceId": "C3343035702D",
  "name": "Strawberry Room",
  "protocol": "switchbot",
  "type": "woiosensor",
  "category": "WoIOSensor",
  "zone": 1,  // <-- Zone assignment: 1-9 or null/undefined
  "automationControl": true,  // <-- Automation control flag: true/false
  "telemetry": { ... },
  ...
}
```

**Zone Field**:
- **Type**: `number | null | undefined`  
- **Valid Values**: `null`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, `9`

**Automation Control Field**:
- **Type**: `boolean`
- **Default**: `false`
- **Purpose**: Indicates whether the sensor is used for automation decisions (e.g., controlling HVAC, dehumidifiers, lighting)

### Frontend Code

#### Modified Functions

**`createDeviceEntryElement(device)` (line ~2069)**
- Detects SwitchBot WoIOSensor devices
- Renders zone dropdown with current assignment
- Renders automation control toggle with checkbox
- Displays status badge ("Active" or "Monitor Only")
- Attaches change event listeners to call `updateDeviceZone()` and `updateDeviceAutomationControl()`

**Key Code Section** (Zone Dropdown):
```javascript
// Add zone assignment dropdown for SwitchBot sensors
if (isSwitchbot && isWoiSensor) {
  const zoneSection = document.createElement('div');
  zoneSection.style.cssText = 'margin-top:10px;padding:8px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;';
  
  // ... zone dropdown code ...
  
  // Add automation control toggle
  const automationRow = document.createElement('div');
  automationRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid #bae6fd;';
  
  const automationLabel = document.createElement('label');
  automationLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:#0c4a6e;font-weight:600;cursor:pointer;flex:1;';
  
  const automationCheckbox = document.createElement('input');
  automationCheckbox.type = 'checkbox';
  automationCheckbox.checked = device.automationControl === true;
  automationCheckbox.style.cssText = 'width:16px;height:16px;cursor:pointer;accent-color:#0ea5e9;';
  
  automationCheckbox.addEventListener('change', (e) => {
    window.updateDeviceAutomationControl(device.id, e.target.checked);
  });
  
  const automationLabelText = document.createElement('span');
  automationLabelText.textContent = 'Used for Automation Control';
  
  automationLabel.appendChild(automationCheckbox);
  automationLabel.appendChild(automationLabelText);
  
  // Add status badge
  const statusBadge = document.createElement('span');
  statusBadge.style.cssText = `padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;${device.automationControl ? 'background:#dcfce7;color:#166534;' : 'background:#f3f4f6;color:#6b7280;'}`;
  statusBadge.textContent = device.automationControl ? 'Active' : 'Monitor Only';
  
  automationRow.appendChild(automationLabel);
  automationRow.appendChild(statusBadge);
  zoneSection.appendChild(automationRow);
  
  info.appendChild(zoneSection);
}
```

#### New Functions

**`window.updateDeviceZone(deviceId, zone)` (line ~2597)**

Persists zone assignment to device record.

**Parameters**:
- `deviceId` (string): Unique device identifier
- `zone` (number | null): Zone number 1-9, or null for unassigned

**Functionality**:
1. Retrieves device record via `findDeviceRecord(deviceId)`
2. Creates updated device object with new zone value
3. Sanitizes payload via `sanitizeDevicePayload()`
4. Persists to storage via `updateDeviceRecord(updated, { persist: true })`
5. Shows success/error toast notification

**Example**:
```javascript
window.updateDeviceZone('C3343035702D', 3); // Assign to Zone 3
window.updateDeviceZone('C3343035702D', null); // Unassign
```

**`window.updateDeviceAutomationControl(deviceId, isEnabled)` (line ~2627)**

Persists automation control flag to device record.

**Parameters**:
- `deviceId` (string): Unique device identifier
- `isEnabled` (boolean): `true` for automation control, `false` for monitor only

**Functionality**:
1. Retrieves device record via `findDeviceRecord(deviceId)`
2. Creates updated device object with new `automationControl` value
3. Sanitizes payload via `sanitizeDevicePayload()`
4. Persists to storage via `updateDeviceRecord(updated, { persist: true })`
5. Re-renders IoT device cards to update status badge
6. Shows success/error toast notification

**Example**:
```javascript
window.updateDeviceAutomationControl('C3343035702D', true); // Enable for automation
window.updateDeviceAutomationControl('C3343035702D', false); // Monitor only
```

### Backend Persistence

Zone assignments are persisted via the existing device update mechanism:

1. **Frontend**: `updateDeviceZone()` calls `updateDeviceRecord(updated, { persist: true })`
2. **Storage Function**: Updates both `STATE.iotDevices` and `window.LAST_IOT_SCAN`
3. **Backend Endpoint**: POST to `/data/iot-devices` with updated device array
4. **File System**: `iot-devices.json` written to `public/data/`

## Use Cases

### Multi-Zone Grow Room Monitoring with Automation Control
**Scenario**: Commercial vertical farm with 9 grow zones  
**Setup**: 
- 9 SwitchBot WoIOSensor devices (one per zone)
- Each sensor assigned to corresponding zone (1-9)
- 3 sensors in Zones 1-3 marked for automation control (actively control HVAC)
- 6 sensors in Zones 4-9 set to monitor only (data collection for analysis)

**Benefits**:
- Zone-specific temperature/humidity tracking
- Clear visibility into which sensors drive automation decisions
- Identify hot spots or humidity imbalances
- Optimize HVAC and dehumidifier placement based on automation control sensors
- Generate zone-level environmental reports
- Differentiate between control sensors (critical) and monitoring sensors (informational)

### Research Trials with Control Groups
**Scenario**: Agricultural research facility comparing environmental control strategies  
**Setup**:
- 4 zones with different environmental targets
- 4 SwitchBot sensors assigned to Zones 1-4
- Zones 1-2: Sensors marked for automation control (automated climate control)
- Zones 3-4: Sensors set to monitor only (manual control by researchers)
- Zones 5-9 unused (sensors unassigned)

**Benefits**:
- Compare automated vs. manual environmental control
- Correlate environmental data with growth outcomes
- Isolate automation variables in controlled experiments
- Track VPD and DLI per treatment group
- Identify which control strategy yields best results

### Greenhouse Sections with Selective Automation
**Scenario**: Mixed-use greenhouse with different crop types  
**Setup**:
- Zone 1-3: Leafy greens (cooler, higher humidity) - **Automation enabled**
- Zone 4-6: Tomatoes (warmer, moderate humidity) - **Automation enabled**
- Zone 7-9: Herbs (moderate temp, lower humidity) - **Monitor only** (manual control for precision)

**Benefits**:
- Monitor climate zones independently
- Alert operators when zones drift out of spec
- Automate climate control for production zones (greens, tomatoes)
- Manual control for sensitive crops (herbs) while still collecting data
- Clear distinction between automated and manually controlled areas

### Redundancy and Failover Planning
**Scenario**: Critical grow room with backup sensors  
**Setup**:
- Zone 1: Primary sensor marked for automation control
- Zone 1: Secondary sensor set to monitor only (backup)
- Zone 1: Tertiary sensor set to monitor only (calibration reference)

**Benefits**:
- Primary sensor drives automation decisions
- Backup sensors provide redundancy if primary fails
- Compare sensor readings to detect drift or calibration issues
- Quickly switch automation control to backup sensor if needed
- Maintain data continuity during sensor maintenance

## Future Enhancements

### Phase 2: Zone-Based Environmental Filtering
**Goal**: Filter environmental data by zone on dashboard

**Features**:
- Zone selector on Farm Summary dashboard
- "View All Zones" vs. "Zone 1" dropdown
- Sparkline charts show zone-specific trends
- Environmental alerts trigger per-zone thresholds

**Example**:
```javascript
// Fetch environmental data for Zone 3
fetch('/env?zone=3')
  .then(res => res.json())
  .then(data => renderEnvironmentalCharts(data));
```

### Phase 3: Zone-Based Automation Rules with Control Sensor Filtering
**Goal**: Create automation rules that trigger per zone and respect automation control flag

**Features**:
- "If Zone 2 temperature > 25°C (automation control sensor), increase exhaust fan speed"
- "If Zone 5 humidity < 60% (automation control sensor), activate humidifier"
- Zone-specific photoperiod schedules
- Automation rules only evaluate sensors marked for automation control
- Monitor-only sensors excluded from automation triggers (prevent false positives)

**Backend Changes**:
- Extend `/ingest/env` endpoint to accept `zoneId` parameter
- Modify `automation.py` rules engine to:
  - Evaluate zone-specific conditions
  - Filter by `automationControl = true` when evaluating triggers
  - Maintain separate rule evaluation for control vs. monitoring sensors
- Update environmental data schema to include zone field

### Phase 4: Multi-Zone Reports
**Goal**: Generate CSV/PDF reports with zone-level summaries

**Features**:
- Daily zone-level environmental summary
- Min/Max/Avg temperature, humidity, VPD per zone
- Deviation alerts (zones outside normal ranges)
- Export to Google Sheets for analysis

## API Endpoints (Future)

### GET `/api/devices/:deviceId/zone`
Returns the zone assignment for a specific device.

**Response**:
```json
{
  "deviceId": "C3343035702D",
  "zone": 3,
  "name": "Strawberry Room"
}
```

### POST `/api/devices/:deviceId/zone`
Updates the zone assignment for a device.

**Request Body**:
```json
{
  "zone": 5
}
```

**Response**:
```json
{
  "success": true,
  "deviceId": "C3343035702D",
  "zone": 5
}
```

### GET `/api/zones`
Lists all zones with assigned devices.

**Response**:
```json
{
  "zones": [
    {
      "zone": 1,
      "devices": [
        { "id": "C3343035702D", "name": "Strawberry Room" }
      ]
    },
    {
      "zone": 2,
      "devices": []
    }
  ]
}
```

## Testing Checklist

### Manual Testing
- [ ] Navigate to IoT Devices card
- [ ] Verify zone dropdown appears for WoIOSensor devices only
- [ ] Verify automation control toggle appears below zone dropdown
- [ ] Select "Zone 3" from dropdown
- [ ] Verify toast notification: "{Device} assigned to Zone 3"
- [ ] Check automation control checkbox
- [ ] Verify status badge changes from "Monitor Only" (gray) to "Active" (green)
- [ ] Verify toast notification: "{Device} enabled for automation control"
- [ ] Refresh page, verify both zone assignment and automation control persist
- [ ] Uncheck automation control checkbox
- [ ] Verify status badge changes back to "Monitor Only"
- [ ] Change zone to "Unassigned"
- [ ] Verify toast notification: "{Device} assigned to Unassigned"
- [ ] Check `iot-devices.json` for both `zone` and `automationControl` fields

### Edge Cases
- [ ] Device with no zone field (should default to "Unassigned")
- [ ] Device with no automationControl field (should default to unchecked, "Monitor Only")
- [ ] Device with zone = 0 (should treat as unassigned)
- [ ] Device with zone = 10 (invalid, should not occur)
- [ ] Rapid zone changes (multiple clicks)
- [ ] Rapid automation control toggles (multiple clicks)
- [ ] Offline device zone/automation assignment (should still persist)
- [ ] Multiple sensors in same zone with different automation control states

### Browser Compatibility
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari (macOS/iOS)
- [ ] Raspberry Pi Chromium (reTerminal)

## Known Limitations

1. **No Zone Naming**: Zones are numeric only (1-9), not named (e.g., "Vegetative", "Flowering")
2. **Hard-Coded Maximum**: 9 zones maximum, not configurable
3. **Sensor Type Limited**: Only WoIOSensor devices show zone dropdown and automation toggle (not plugs, switches, etc.)
4. **No Zone Visualization**: Dashboard doesn't yet filter/display data by zone
5. **No Validation**: System doesn't prevent multiple sensors in same zone or enforce coverage
6. **No Automation Integration**: Automation control flag is informational only - automation rules don't yet filter by this flag
7. **Manual Failover**: If a control sensor fails, operator must manually enable automation control on backup sensor

## Version History

- **v1.1** (2025-01-18): Added automation control toggle
  - Checkbox and status badge for automation control
  - "Active" vs "Monitor Only" visual indication
  - `automationControl` field added to device schema
  - `updateDeviceAutomationControl()` function
  - Updated documentation with automation control use cases

- **v1.0** (2025-01-18): Initial implementation
  - Zone dropdown for SwitchBot WoIOSensor devices
  - Zones 1-9 plus "Unassigned" option
  - Persistent storage to `iot-devices.json`
  - Toast notifications for zone changes

## Related Documentation

- [IoT Universal Scanner](./IOT_UNIVERSAL_SCANNER.md)
- [Device Discovery Implementation](./DISCOVERY_IMPLEMENTATION.md)
- [SwitchBot Integration](./SWITCHBOT-INTEGRATION.md)
- [Farm Summary Dashboard](./FARM_SUMMARY.md)

## Support

For questions or issues with zone assignment:
1. Check device is a SwitchBot WoIOSensor (zone dropdown only appears for sensors)
2. Verify device is trusted (not quarantined or ignored)
3. Inspect browser console for JavaScript errors
4. Check `iot-devices.json` for zone field presence
5. Review server logs for persistence errors

---

**Last Updated**: 2025-01-18  
**Maintainer**: Peter Gilbert  
**Status**: Production-Ready
