# Automation Control Toggle - Quick Reference

## Feature Overview

The **Automation Control Toggle** allows operators to mark which SwitchBot environmental sensors actively drive automation decisions vs. those used for monitoring/analysis only.

## Visual Appearance

### Device Card with Automation Control
```
┌─────────────────────────────────────────────────┐
│ 📊 Strawberry Room Sensor                       │
│ ┌─────────────────────────────────────────────┐ │
│ │ Zone: [Dropdown: Zone 3 ▼]                  │ │
│ │ ─────────────────────────────────────────── │ │
│ │ ☑ Used for Automation Control    [Active]  │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### Status Badges
- **Active** (Green): `automationControl = true`
  - Background: `#dcfce7`
  - Text: `#166534`
  - Indicates sensor drives automation rules

- **Monitor Only** (Gray): `automationControl = false`
  - Background: `#f3f4f6`
  - Text: `#6b7280`
  - Indicates sensor is for data collection only

## When to Enable Automation Control

### ✅ Enable for These Scenarios:
- **Primary Control Sensor**: Main sensor used for HVAC/dehumidifier control
- **Critical Monitoring Point**: Sensor in location that determines equipment operation
- **Automation Rules Active**: Sensor reading triggers automation actions
- **Safety-Critical**: Sensor that prevents over-temp/humidity conditions

### ❌ Keep Disabled (Monitor Only) for These Scenarios:
- **Backup/Redundant Sensors**: Secondary sensors for comparison
- **Calibration Reference**: Sensors used to validate other sensors
- **Data Analysis**: Sensors collecting data for research/optimization
- **Manual Control Zones**: Areas where operator makes control decisions
- **Testing/Commissioning**: Sensors being evaluated before production use

## Typical Configurations

### Production Grow Room (3 sensors)
```
Sensor 1 - "Main Room Sensor"
  Zone: 1
  Automation Control: ✓ Enabled (Active)
  → Controls HVAC and dehumidifier

Sensor 2 - "Backup Sensor"  
  Zone: 1
  Automation Control: ✗ Disabled (Monitor Only)
  → Redundancy, ready to take over if primary fails

Sensor 3 - "Canopy Level Sensor"
  Zone: 1  
  Automation Control: ✗ Disabled (Monitor Only)
  → Collects microclimatic data for analysis
```

### Multi-Zone Facility (6 sensors)
```
Zone 1-3: Automated Climate Control
  Sensors marked: Automation Control ✓ Enabled
  → Sensors drive automated HVAC responses

Zone 4-6: Manual Climate Control  
  Sensors marked: Automation Control ✗ Disabled
  → Operators manually adjust equipment based on readings
```

## Data Structure

### JSON Schema
```json
{
  "id": "C3343035702D",
  "name": "Strawberry Room",
  "protocol": "switchbot",
  "type": "woiosensor",
  "zone": 3,
  "automationControl": true,  // <-- This field
  "telemetry": {
    "temperature": 22.5,
    "humidity": 65
  }
}
```

### Default Values
- **New Devices**: `automationControl = false` (Monitor Only)
- **Existing Devices**: `automationControl = false` if field missing

## User Workflow

### Enabling Automation Control
1. Navigate to **IoT Devices** card
2. Find the WoIOSensor device card
3. Locate the automation control section (below zone dropdown)
4. **Check** the "Used for Automation Control" checkbox
5. Badge updates to **Active** (green)
6. Toast confirms: "{Device Name} enabled for automation control"

### Disabling Automation Control  
1. Navigate to **IoT Devices** card
2. Find the WoIOSensor device card
3. **Uncheck** the "Used for Automation Control" checkbox
4. Badge updates to **Monitor Only** (gray)
5. Toast confirms: "{Device Name} set to monitor only"

## Integration with Automation Rules (Future)

### Phase 1 (Current): Informational Only
- Toggle provides **visual indication** of sensor purpose
- No impact on automation system behavior
- Helps operators understand sensor roles

### Phase 2 (Planned): Automation Rule Filtering
When automation rules are implemented:

```javascript
// Pseudocode for future automation rule evaluation
function evaluateTemperatureRule(zone) {
  const sensors = getZoneSensors(zone);
  
  // Only evaluate sensors marked for automation control
  const controlSensors = sensors.filter(s => s.automationControl === true);
  
  if (controlSensors.length === 0) {
    console.warn(`No automation control sensors in Zone ${zone}`);
    return; // Skip rule evaluation
  }
  
  const avgTemp = average(controlSensors.map(s => s.temperature));
  
  if (avgTemp > 25) {
    triggerAction('increase_exhaust_fan');
  }
}
```

**Benefits**:
- Prevent false triggers from monitoring-only sensors
- Allow multiple sensors per zone with different roles
- Enable sensor redundancy without rule confusion
- Support gradual commissioning (add sensors without immediate automation impact)

## Best Practices

### Sensor Placement Strategy
1. **Primary Control Sensor**:
   - Place at representative location (not near door/vent/light)
   - Mark for automation control
   - Calibrate regularly

2. **Backup Control Sensor**:
   - Place near primary sensor for comparison
   - Keep as monitor only initially
   - Enable automation control if primary fails

3. **Microclimatic Sensors**:
   - Place at canopy level, floor level, etc.
   - Always monitor only
   - Use for analysis and optimization

### Failover Procedure
If a control sensor fails:
1. Identify backup sensor in same zone
2. Verify backup sensor readings are accurate
3. **Enable automation control** on backup sensor
4. **Disable automation control** on failed sensor
5. Replace/repair failed sensor
6. Test repaired sensor in monitor-only mode
7. Switch control back to primary when confident

### Commissioning New Sensors
1. Add sensor to system (initially `automationControl = false`)
2. Assign to zone
3. Monitor readings for 24-48 hours
4. Compare with existing sensors
5. If readings stable and accurate, enable automation control
6. Monitor for another 24 hours before removing old sensor

## Troubleshooting

### Issue: No sensors marked for automation control
**Symptom**: Automation rules not triggering  
**Resolution**: Enable automation control on at least one sensor per zone

### Issue: Too many sensors marked for automation control
**Symptom**: Conflicting automation behaviors, equipment cycling  
**Resolution**: Disable automation control on redundant sensors, keep only primary enabled

### Issue: Backup sensor not updating status badge
**Symptom**: Status badge stuck on "Monitor Only" after enabling checkbox  
**Resolution**: Refresh page, check browser console for errors, verify `iot-devices.json` updated

### Issue: Sensor readings differ significantly
**Symptom**: Control sensor shows 25°C, monitor-only sensor shows 22°C  
**Resolution**: 
- Check sensor placement (near heat source?)
- Verify sensor calibration
- Consider sensor failure if difference > 2°C
- Do NOT enable automation control on questionable sensor

## Related Documentation

- [IoT Zone Assignment System](./IOT_ZONE_ASSIGNMENT.md) - Full documentation
- [IoT Universal Scanner](./IOT_UNIVERSAL_SCANNER.md) - Device discovery
- [SwitchBot Integration](./SWITCHBOT-INTEGRATION.md) - SwitchBot API details
- [Automation System](./AUTOMATION_SYSTEM.md) - Automation rules (future integration)

## Support

**Questions?**
- Feature requests: Enable automation control integration with rules engine
- Bug reports: Status badge not updating, persistence issues
- Documentation: Suggest improvements to this guide

---

**Version**: 1.1  
**Last Updated**: January 18, 2025  
**Status**: Production-Ready (UI only, automation integration pending)
