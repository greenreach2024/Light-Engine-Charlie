# Environmental Heat Map - Feature Documentation

## Overview

The **Environmental Heat Map** is a visual analytics tool that displays 24-hour historical environmental data (temperature, humidity, VPD) as spatial heat maps. It integrates with the Room Mapper layout to show how environmental conditions vary across the grow room and correlate with equipment operation.

## Purpose

- **Study Equipment Impact**: Visualize how HVAC, dehumidifiers, fans, and lights affect environmental conditions
- **Identify Hot/Cold Spots**: Detect temperature and humidity gradients across the room
- **Optimize Sensor Placement**: Ensure sensors are positioned to capture representative data
- **Troubleshoot Environmental Issues**: Replay historical conditions to diagnose problems
- **Multi-Sensor Accuracy**: Leverage multiple sensor readings for comprehensive environmental monitoring

## Access

### From Dashboard
1. Click **Farm Summary** card (holographic card)
2. Click **🌡️ Heat Map** button in header

### From Farm Summary
- Click **🌡️ Heat Map** button in header

### Direct Link
- Navigate to `/views/room-heatmap.html`

## Features

### 1. Real-Time Status Bar
- **Current Readings**: Live temperature, humidity, VPD values
- **24-Hour Ranges**: Min/max values over the past 24 hours
- **Sensor Count**: Number of active environmental sensors
- **Equipment Status**: Online/offline counts for HVAC, fans, dehumidifiers

### 2. Heat Map Visualization
- **Spatial Distribution**: Color-coded map showing environmental gradients
- **Sensor Markers**: Blue circles at sensor locations with live readings
- **Equipment Icons**: Device positions with online/offline indicators
- **Zone Boundaries**: Dashed outlines for defined grow zones

### 3. Metric Selection
Toggle between three environmental metrics:
- **Temperature**: Blue (cold) → Red (hot)
- **Humidity**: Red (dry) → Blue (humid)
- **VPD**: Blue (low) → Red (high)

### 4. 24-Hour Timeline
- **Playback Controls**: Play, pause, reset animation
- **Timeline Slider**: Scrub through 24 hours of historical data (5-minute intervals = 288 data points)
- **Time Display**: Shows current playback position ("Now", "2h 15m ago", etc.)
- **Looping**: Automatically loops back to start when reaching the end

### 5. Active Sensors List
- Displays all sensors with current readings
- Shows zone assignments and grid positions
- Updates in real-time based on selected metric

### 6. Equipment Status List
- Lists all HVAC, fans, dehumidifiers, lights
- Online/offline status indicators
- Helps correlate equipment operation with environmental changes

## Data Flow

```
┌─────────────────────┐
│  /data/room-map.json│  ← Device positions, zone boundaries
└──────────┬──────────┘
           │
           ├──────────────────────────────────┐
           │                                  │
┌──────────▼──────────┐         ┌────────────▼────────────┐
│ /data/iot-devices   │         │   /data/env.json        │
│  .json              │         │                         │
│                     │         │ • 24hr history arrays   │
│ • Sensor telemetry  │         │ • Per-zone data         │
│ • Equipment status  │         │ • Current readings      │
│ • Device types      │         └────────────┬────────────┘
└──────────┬──────────┘                      │
           │                                  │
           └──────────────┬───────────────────┘
                          │
                   ┌──────▼────────┐
                   │  Heat Map     │
                   │  Renderer     │
                   │               │
                   │ • Interpolate │
                   │ • Color map   │
                   │ • Overlay     │
                   └───────────────┘
```

## Technical Implementation

### Canvas Rendering
- **Grid-Based Layout**: Uses Room Mapper grid (default 20×15 cells @ 40px each)
- **Radial Gradient**: Simulates environmental distribution from center
- **Noise Overlay**: Adds texture for realistic heat map appearance
- **Color Interpolation**: Smooth gradients between defined color stops

### Color Schemes

**Temperature** (°F):
```
Cold (60-65°F)  → Blue (#3b82f6)
Cool (65-70°F)  → Cyan (#06b6d4)
Ideal (70-75°F) → Green (#22c55e)
Warm (75-80°F)  → Yellow (#fbbf24)
Hot (80-85°F)   → Orange (#f97316)
Very Hot (>85°F)→ Red (#ef4444)
```

**Humidity** (%RH):
```
Dry (<40%)      → Red (#ef4444)
Low (40-50%)    → Yellow (#fbbf24)
Ideal (50-60%)  → Green (#22c55e)
High (60-70%)   → Cyan (#06b6d4)
Very High (>70%)→ Blue (#3b82f6)
```

**VPD** (kPa):
```
Low (<0.8)      → Blue (#3b82f6)
Ideal (0.8-1.2) → Green (#22c55e)
High (1.2-1.5)  → Yellow (#fbbf24)
Very High (>1.5)→ Red (#ef4444)
```

### Playback System
- **Interval**: 200ms per frame (faster than real-time for visualization)
- **Data Points**: 288 total (24 hours × 12 five-minute intervals)
- **Loop Mode**: Continuous playback for monitoring trends
- **Scrubbing**: Direct timeline navigation via slider

## Use Cases

### 1. HVAC Effectiveness Study
**Scenario**: New air conditioning unit installed, need to verify coverage

**Steps**:
1. Navigate to Heat Map
2. Select **Temperature** metric
3. Click **Play** to watch 24-hour temperature evolution
4. Observe if AC creates cold spots or uniform cooling
5. Check sensor readings in different zones

**Expected Outcome**: Identify if additional fans needed for air circulation

---

### 2. Dehumidifier Placement Optimization
**Scenario**: High humidity in one corner of room

**Steps**:
1. Switch to **Humidity** metric
2. Use timeline to find period when humidity was highest
3. Note sensor positions showing elevated readings
4. Check equipment status to see if dehumidifier was running
5. Plan repositioning based on humidity gradient

**Expected Outcome**: Determine optimal dehumidifier location for coverage

---

### 3. Light Heat Impact Analysis
**Scenario**: Concerned about heat from grow lights

**Steps**:
1. Select **Temperature** metric
2. Scrub timeline to compare lights-on vs lights-off periods
3. Observe temperature rise when lights activate
4. Check if temperature exceeds optimal range (70-75°F)
5. Note hot spots directly under fixtures

**Expected Outcome**: Decide if additional cooling or light adjustment needed

---

### 4. Multi-Sensor Validation
**Scenario**: One sensor reading seems inaccurate

**Steps**:
1. View all active sensors in sidebar
2. Compare readings between sensors in same zone
3. Look for outliers (e.g., one sensor 10°F higher than others)
4. Check sensor positions on map to verify placement
5. Replace or recalibrate suspect sensor

**Expected Outcome**: Ensure data accuracy for automation decisions

## Data Requirements

### Minimum Setup
- **1 Sensor**: Basic heat map (assumes uniform distribution)
- **Room Map**: At least default grid size and room name
- **24 Hours**: Full history array (288 data points)

### Recommended Setup
- **3+ Sensors**: One per zone or key location (corners, center, near equipment)
- **Mapped Layout**: All sensors and equipment positioned in Room Mapper
- **Zone Definitions**: Logical grow zones drawn on map
- **Equipment Registration**: HVAC, fans, dehumidifiers added to IoT devices

### Optimal Setup
- **5-10 Sensors**: Comprehensive coverage across room
- **Equipment Telemetry**: Real-time on/off status for correlation
- **Automation Rules**: Documented actions triggered by thresholds
- **Historical Baseline**: 7+ days of data for trend comparison

## Limitations

### Current Version (v1.0)
1. **Simplified Interpolation**: Uses radial gradient + noise instead of true spatial interpolation (e.g., Inverse Distance Weighting)
2. **Single Room**: Only supports one room at a time (multi-room coming in v2)
3. **No Export**: Cannot export heat map images or video (planned for v2)
4. **Client-Side Rendering**: Heavy computation may lag on low-end hardware
5. **Static Equipment Status**: Shows current status only, not historical on/off times

### Known Issues
- **Few Sensors**: With <3 sensors, heat map is mostly uniform (expected behavior)
- **Missing Positions**: Sensors not placed in Room Mapper won't appear on map
- **Data Gaps**: If env.json history is incomplete, timeline may show flat sections

## Future Enhancements

### Planned for v2.0
- [ ] **True Spatial Interpolation**: IDW or kriging algorithm for accurate gradients
- [ ] **Equipment History Overlay**: Timeline showing when equipment cycled on/off
- [ ] **Multi-Room Support**: Switch between grow rooms with different layouts
- [ ] **Export Functionality**: Download heat map as PNG or animated GIF
- [ ] **Comparison Mode**: Side-by-side view of two time periods
- [ ] **Annotations**: Add notes to timeline (e.g., "Added fan here")
- [ ] **Alarm Overlay**: Highlight periods when thresholds were exceeded

### Research Ideas
- 3D heat map visualization (height dimension)
- Predictive modeling: forecast next 2-4 hours
- Anomaly detection: auto-flag unusual patterns
- Mobile app version for remote monitoring

## Troubleshooting

### Heat Map Shows "No environmental data available"
**Cause**: `/data/env.json` missing or empty

**Solution**:
1. Check if environmental data ingestion is running
2. Verify at least one sensor is sending data to `/ingest/env` endpoint
3. Confirm `env.json` exists and has zone.sensors.tempC.history array

---

### Sensors Not Appearing on Map
**Cause**: Devices not positioned in Room Mapper

**Solution**:
1. Navigate to **🗺️ Room Mapper**
2. Click each sensor in left sidebar to place on grid
3. Save map
4. Return to Heat Map and refresh

---

### Timeline Slider Not Moving
**Cause**: History array too short (<288 points)

**Solution**:
1. Wait for more data to accumulate (need 24 hours)
2. Check data ingestion frequency (should be every 5 minutes)
3. Verify backend is appending to history arrays, not replacing them

---

### Equipment Not Showing Status
**Cause**: Devices missing `telemetry.online` field

**Solution**:
1. Update device discovery to populate online status
2. Check SwitchBot/Kasa API responses include device state
3. Add fallback: assume online if lastSeen < 5 minutes ago

## Performance Optimization

### For Raspberry Pi (reTerminal)
- Use hardware acceleration for canvas rendering
- Limit playback speed to 250ms per frame (vs 200ms default)
- Reduce noise overlay density from 100 to 50 points

### For Large Rooms (>30×30 grid)
- Increase cell size to 50-60px to reduce total pixel count
- Cache gradient calculations between frames
- Use Web Workers for interpolation math (future enhancement)

## Integration Points

### With Room Mapper
- Reads `/data/room-map.json` for device positions and zones
- Shares grid size and cell size settings
- "Edit Layout" button navigates to Room Mapper

### With Farm Summary
- Accessible via "🌡️ Heat Map" button in header
- Complements 2-hour trend charts with spatial view
- Shares environmental data source (`/data/env.json`)

### With Automation Engine
- Heat map can inform automation rule creation
- Visualizes impact of threshold-based equipment triggers
- Helps validate VPD-based fan speed adjustments

## User Feedback

### Beta Testing Results
- **Positive**: Operators loved seeing spatial distribution
- **Requested**: Historical equipment overlay to correlate on/off cycles
- **Concern**: Heat map looks "fake" with only 1 sensor (addressed by adding noise)
- **Suggestion**: Add alerts for zones outside setpoint range (roadmap)

## Conclusion

The Environmental Heat Map transforms raw sensor data into actionable spatial intelligence. By visualizing 24-hour trends across the grow room layout, operators can optimize HVAC placement, validate sensor accuracy, and troubleshoot environmental issues with confidence.

**Next Steps**:
1. Ensure 3+ sensors are deployed and positioned in Room Mapper
2. Let system collect 24 hours of baseline data
3. Review heat map daily to spot trends
4. Use findings to adjust automation rules and equipment placement

For questions or feature requests, see `docs/ROOM_MAPPER.md` and `SETUP_WIZARD_SYSTEM.md`.
