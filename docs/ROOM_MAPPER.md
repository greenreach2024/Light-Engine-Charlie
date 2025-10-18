# Room Mapper - Visual Layout Tool

## Overview

The **Room Mapper** is a visual tool for creating spatial layouts of grow rooms, showing the physical locations of sensors, lights, equipment, and zone boundaries. It provides operators with a bird's-eye view of the facility for planning, troubleshooting, and documentation.

## Purpose

Room Mapper is designed to be the **final step** in the setup workflow:
1. ✅ **First**: Configure devices in IoT Devices panel
2. ✅ **Second**: Assign zones to sensors (1-9)
3. ✅ **Third**: Mark sensors for automation control
4. ✅ **Fourth**: Configure equipment and controllers
5. ✅ **Last**: **Map the room** to visualize everything spatially

## Access

**Navigation**:
- Dashboard → **Control Devices** → **🗺️ Room Mapper**
- Direct URL: `/views/room-mapper.html`

## Features

### 1. Auto-Population from Existing Data
- Automatically loads all configured IoT devices
- Displays device names, types, and zone assignments
- Shows current telemetry data (temperature, humidity)

### 2. Interactive Canvas
- **Grid-based layout** (default: 20×15 cells)
- **Adjustable grid size** (10-50 cells)
- **Adjustable cell size** (20-80 pixels)
- **Background grid** for visual reference
- **Drag-and-drop** device placement

### 3. Device Icons
- 🌡️ **Sensors** (WoIOSensor temperature/humidity)
- 💡 **Lights** (Grow3, Lynx3, smart bulbs)
- 🔌 **Plugs** (Smart plugs, controllers)
- 🌀 **Equipment** (Dehumidifiers, HVAC, fans)

### 4. Zone Drawing
- **Click-and-drag** to define rectangular zones
- **Color-coded** zones (9 colors for Zones 1-9)
- **Transparent overlays** (80% transparency)
- **Zone labels** displayed on canvas

### 5. Device Details Panel
- Click any device to view:
  - Device name and type
  - Protocol (SwitchBot, Kasa, etc.)
  - Grid position (x, y coordinates)
  - Zone assignment
  - Live telemetry (if sensor)
- **Remove button** to delete device from map

### 6. Persistence
- **Save** button stores map to `public/data/room-map.json`
- **Load** button retrieves saved layout
- **Auto-load** on page refresh
- **Clear** button resets entire map

## User Interface

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  🗺️ Room Mapper          [Back] [Save] [Load] [Clear]   │
├──────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌────────────────────────────┐ ┌──────────┐ │
│ │ Tools & │ │      Room Layout Canvas    │ │ Details  │ │
│ │ Devices │ │                            │ │  Panel   │ │
│ │         │ │  [Interactive Grid]        │ │          │ │
│ │ 👆Select│ │                            │ │ Click a  │ │
│ │ 📐 Zone │ │  Grid: 20x15 | Cells: 40px │ │ device   │ │
│ │         │ │                            │ │ or zone  │ │
│ │ Devices:│ │  Devices: 3 | Zones: 2     │ │          │ │
│ │  🌡️ S1  │ │                            │ │          │ │
│ │  🌡️ S2  │ └────────────────────────────┘ │          │ │
│ │  💡 L1  │                                │          │ │
│ │         │                                │          │ │
│ │ Zones:  │                                │          │ │
│ │  Zone 1 │                                │          │ │
│ │  Zone 2 │                                │          │ │
│ └─────────┘                                └──────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Three-Panel Layout

#### Left Sidebar: Tools & Devices (250px)
- **Drawing Tools**:
  - 👆 **Select** - Click to select and drag devices
  - 📐 **Draw Zone** - Click-and-drag to define zones
  
- **IoT Devices List**:
  - All configured devices from `iot-devices.json`
  - Click device to place on canvas (centered)
  - Grayed out if already placed
  - Shows device type and zone assignment

- **Zones List**:
  - All drawn zones with color indicators
  - Click to view zone details
  - Shows zone size in cells

- **Legend**:
  - Icon meanings for all device types

#### Center: Canvas (Flexible)
- Interactive grid canvas
- Devices rendered as emoji icons with names
- Zones drawn as colored rectangles with labels
- Grid size and cell size controls in header
- Stats bar at bottom (grid info, device count, zone count)

#### Right Sidebar: Details (300px)
- **Empty State**: "Click on a device or zone to view details"
- **Device Selected**:
  - Large icon display
  - Name, type, protocol
  - Grid position
  - Zone assignment
  - Live telemetry (temperature, humidity) for sensors
  - Remove button
  
- **Zone Selected**:
  - Color swatch
  - Zone name
  - Position bounds
  - Size in cells
  - Remove button

## Workflow

### Initial Setup (First Time)

1. **Open Room Mapper**
   - Click **Control Devices** → **🗺️ Room Mapper**

2. **Adjust Grid (Optional)**
   - Change "Grid" size (e.g., 25 for larger room)
   - Change "Cell Size" (e.g., 50 for bigger icons)

3. **Define Zones**
   - Click **📐 Draw Zone** tool
   - Click-and-drag to create rectangular zone
   - Repeat for additional zones (up to 9)
   - Click **👆 Select** to exit zone mode

4. **Place Devices**
   - In left sidebar, click a device from the list
   - Device appears centered on canvas
   - Drag device to correct location
   - Repeat for all devices

5. **Fine-Tune Positions**
   - Select **👆 Select** tool
   - Click and drag devices to adjust positions
   - Place sensors at actual mounting locations
   - Place lights above grow areas
   - Place equipment at physical locations

6. **Save Layout**
   - Click **💾 Save Map** button
   - Confirmation alert: "✅ Map saved successfully!"

### Daily Use

**Viewing the Map**:
- Open Room Mapper to see current layout
- Live telemetry displayed on sensor cards

**Updating Positions**:
- Drag devices to new locations
- Click **💾 Save Map** to persist changes

**Adding New Devices**:
- New devices auto-appear in device list
- Click device to add to map
- Save map after placement

**Removing Devices**:
- Click device on canvas
- Click **Remove** in details panel
- Device returns to available list

## Data Structure

### Saved Map Format (`public/data/room-map.json`)

```json
{
  "roomId": "default",
  "name": "Main Grow Room",
  "gridSize": 20,
  "cellSize": 40,
  "devices": [
    {
      "deviceId": "C3343035702D",
      "x": 5,
      "y": 3
    },
    {
      "deviceId": "light-001",
      "x": 10,
      "y": 3
    }
  ],
  "zones": [
    {
      "zone": 1,
      "name": "Zone 1",
      "color": "#3b82f6",
      "x1": 0,
      "y1": 0,
      "x2": 19,
      "y2": 5
    },
    {
      "zone": 2,
      "name": "Zone 2",
      "color": "#10b981",
      "x1": 0,
      "y1": 6,
      "x2": 19,
      "y2": 14
    }
  ],
  "lastUpdated": "2025-01-18T10:30:00.000Z"
}
```

### Device Position
- **deviceId**: Matches `id` field in `iot-devices.json`
- **x**: Horizontal grid position (0 to gridSize-1)
- **y**: Vertical grid position (0 to gridSize*0.75-1)

### Zone Definition
- **zone**: Zone number (1-9)
- **name**: Zone display name
- **color**: Hex color code for zone overlay
- **x1, y1**: Top-left corner coordinates
- **x2, y2**: Bottom-right corner coordinates

## Use Cases

### 1. Facility Planning
**Before Installation**:
- Map planned sensor and equipment locations
- Visualize zone boundaries
- Identify coverage gaps
- Plan wiring and network runs

**Benefits**:
- Optimize sensor placement for representative readings
- Ensure even light distribution
- Plan HVAC airflow patterns

### 2. Troubleshooting
**During Operations**:
- Identify which sensor is reporting high temperature
- Locate equipment for maintenance
- Understand zone relationships

**Example**:
- Sensor 2 shows 28°C
- Map shows Sensor 2 is near exhaust vent
- Check if vent is blocked

### 3. Documentation
**For Team Communication**:
- Export map as screenshot
- Share with installation team
- Document as-built conditions
- Training new operators

### 4. Sensor Redundancy Verification
**Quality Assurance**:
- Verify each zone has at least one sensor
- Check backup sensors are spatially separated
- Ensure primary and backup sensors aren't too close

### 5. Automation Control Visualization
**System Understanding**:
- See which sensors control automation (marked in device list)
- Understand control sensor placement strategy
- Verify redundancy for critical control points

## Best Practices

### Zone Mapping
1. **Draw zones first**, then place devices
2. **Match zone numbers** to physical room sections
3. **Use consistent orientation** (e.g., Zone 1 always on left)
4. **Leave borders** between zones for clarity
5. **Label physical zones** with matching numbers

### Sensor Placement
1. **Place sensors** at actual mounting heights (not floor)
2. **Avoid edge effects** (near doors, vents, lights)
3. **Distributed coverage** across zone area
4. **Primary sensor** in center of zone
5. **Backup sensor** offset from primary

### Light Placement
1. **Grid pattern** for even coverage
2. **Match actual fixture layout**
3. **Note fixture types** in device names
4. **Group by circuit** for troubleshooting

### Equipment Placement
1. **Exact locations** of dehumidifiers, fans, HVAC
2. **Note airflow direction** in names
3. **Mark power sources** if relevant

## Technical Details

### Canvas Rendering
- **Technology**: HTML5 Canvas API
- **Drawing Loop**: Manual draw() calls on state changes
- **Event Handling**: Mouse events for click, drag, draw
- **Performance**: Optimized for up to 50 devices

### Grid System
- **Coordinate System**: (0,0) at top-left
- **Cell Addressing**: Integer grid coordinates
- **Aspect Ratio**: Default 4:3 (width:height)
- **Responsive**: Canvas scales with cell size

### State Management
- **Global STATE object**: Holds all canvas data
- **Reactive Updates**: draw() called after any state change
- **Persistence**: Manual save via button
- **Auto-Load**: On page load if map exists

### Browser Compatibility
- ✅ Chrome 90+ (tested)
- ✅ Firefox 88+ (tested)
- ✅ Safari 14+ (expected compatible)
- ✅ Edge 90+ (Chromium)
- ✅ Mobile browsers (responsive, but desktop recommended)

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Esc** | Deselect item, exit zone mode (future) |
| **Delete** | Remove selected item (future) |
| **Ctrl+S** | Save map (future) |
| **Ctrl+Z** | Undo last action (future) |

*Note: Keyboard shortcuts are planned for future releases*

## API Endpoints

### Save Map
```http
POST /data/room-map.json
Content-Type: application/json

{
  "roomId": "default",
  "name": "Main Grow Room",
  "gridSize": 20,
  "cellSize": 40,
  "devices": [...],
  "zones": [...],
  "lastUpdated": "2025-01-18T10:30:00.000Z"
}
```

**Response**:
```json
{
  "ok": true
}
```

### Load Map
```http
GET /data/room-map.json
```

**Response**: Full map object

### Load IoT Devices
```http
GET /data/iot-devices.json
```

**Response**: Array of IoT devices

## Troubleshooting

### Issue: Devices not appearing in list
**Cause**: No devices configured in IoT Devices panel  
**Solution**: 
1. Go to main dashboard
2. Configure devices in IoT Devices card
3. Return to Room Mapper
4. Refresh page

### Issue: Can't drag devices
**Cause**: Zone tool selected instead of Select tool  
**Solution**: Click **👆 Select** tool in left sidebar

### Issue: Zone won't draw
**Cause**: Click-and-drag area too small  
**Solution**: Drag further to create larger rectangle

### Issue: Map not saving
**Cause**: Server not running or permission error  
**Solution**:
1. Check server is running on port 8091
2. Check browser console for errors
3. Verify `public/data/` directory is writable

### Issue: Map resets after refresh
**Cause**: Forgot to click Save button  
**Solution**: Always click **💾 Save Map** after changes

### Issue: Device appears twice
**Cause**: Clicked device in list multiple times  
**Solution**: 
1. Click device on canvas
2. Click Remove in details panel
3. Place device again

## Future Enhancements

### Phase 2: Advanced Features
- **Upload floor plan image** as background
- **Distance measurement** tool
- **Rotate devices** to show orientation
- **Custom device icons** (upload your own)
- **Zoom and pan** for large facilities
- **Multi-room support** (switch between rooms)
- **Export as PNG/PDF** for documentation

### Phase 3: Live Data Integration
- **Real-time telemetry** overlay on sensors
- **Alert indicators** for out-of-range sensors
- **Device status** (online/offline) on map
- **Historical heatmaps** (temperature over time)
- **Airflow visualization** (CFD simulation)

### Phase 4: Automation Visualization
- **Show automation rules** on map
- **Control zones highlighted** when active
- **Equipment state indicators** (on/off/auto)
- **Rule trigger paths** (sensor → equipment)

## Related Documentation

- [IoT Zone Assignment System](./IOT_ZONE_ASSIGNMENT.md) - Zone configuration
- [Automation Control Toggle](./AUTOMATION_CONTROL_TOGGLE.md) - Control sensor setup
- [IoT Universal Scanner](./IOT_UNIVERSAL_SCANNER.md) - Device discovery
- [SwitchBot Integration](./SWITCHBOT-INTEGRATION.md) - SwitchBot setup

## Support

**Questions?**
- Need help placing devices? Review sensor placement best practices above
- Map not loading? Check browser console for errors
- Feature requests? See Future Enhancements section

**Feedback Welcome!**
- Suggest device icons or colors
- Request additional grid sizes
- Report usability issues

---

**Version**: 1.0  
**Last Updated**: January 18, 2025  
**Status**: Production-Ready  
**Recommended Workflow Position**: Final step after all device and zone configuration
