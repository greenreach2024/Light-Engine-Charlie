# Groups V2 - Light Assignment & Comparison System

## Overview
Groups V2 now features a comprehensive light assignment workflow with side-by-side plan vs light comparison capabilities, spectrum visualization, and intelligent detection of tunable vs non-tunable fixtures.

## Features Implemented

### 1. Light Card Rendering
- **Unassigned Lights Section**: Displays all lights assigned to the selected room but not yet assigned to a zone
- **Assigned Lights Section**: Shows lights currently assigned to the selected zone
- **Card-Based UI**: Replaced dropdown selects with visual cards showing:
  - Manufacturer and model name
  - Wattage
  - Tunable/Fixed spectrum badge
  - Dimmable/On-Off badge
  - Control type (WiFi, BLE, 0-10V, Smart Plug, etc.)
  - Spectrum graph with color-coded visualization

### 2. Light Assignment Workflow
1. Select a room from the Room dropdown
2. Unassigned lights for that room appear as cards
3. Click "Assign to Group" button on any light card
4. Light moves to Assigned Lights section
5. Click "Unassign" to return light to unassigned pool

### 3. Side-by-Side Comparison
When clicking on any light card, a two-column comparison view appears:

#### Plan Target Card (Left - Blue)
- Plan name and current day/stage
- Target PPFD (µmol/m²/s)
- Photoperiod (hours)
- Target DLI (mol/m²/day)
- Target spectrum distribution with graph
- Spectrum percentages (Blue, Green, Red, Far-Red)

#### Light Capability Card (Right - Purple)
- Light name and manufacturer
- Power (watts), PPF (µmol/s), PPE (µmol/J)
- Control type
- Tunable/Dimmable status
- Actual spectrum distribution with graph
- Spectrum percentages

### 4. Tunable vs Non-Tunable Detection

#### Tunable Lights
- Badge: "TUNABLE" (green)
- Spectrum from `light.spectrum` object
- Can be adjusted to match plan targets
- Examples: TopLight MH Model-300W-22G12 with WiFi/BLE control

#### Non-Tunable (Fixed Spectrum) Lights
- Badge: No tunable badge
- Spectrum inferred from:
  - PPF/color range data
  - Industry standard distributions (e.g., 400-700nm → 30% blue, 20% green, 45% red, 5% far-red)
- Can only be dimmed (if controller supports)

#### Dimmable Detection
- **Wireless (WiFi/BLE/Zigbee)**: Dimmable → "DIMMABLE" badge (blue)
- **Wired (0-10V/RS485)**: Dimmable → "DIMMABLE" badge (blue)
- **Smart Plug**: Not dimmable → "ON/OFF" badge (gray)

### 5. Spectrum Delta Visualization
- Each spectrum graph uses Gaussian curves for realistic wavelength distribution
- Plan spectrum shows crop growth stage targets
- Light spectrum shows hardware capabilities
- Visual comparison enables operators to:
  - Identify spectrum mismatches
  - Plan fixture upgrades
  - Optimize light positioning

### 6. Data Persistence
When saving a group:
```json
{
  "room": "GreenReach",
  "zone": "1",
  "zoneName": "Propagation North",
  "lights": [
    { "id": "22G12-001", "name": "TopLight MH Model-300W-22G12" },
    { "id": "VERTIMAX-001", "name": "P.L. Light VertiMax 640W" }
  ],
  "plan": {
    "name": "Buttercrunch Lettuce",
    "anchorMode": "seed",
    "seedDate": "2025-10-01",
    "cycles": { ... },
    "summary": { ... }
  },
  "created": "2025-10-16T12:00:00Z",
  "updated": "2025-10-16T16:00:00Z"
}
```

## Light Data Structure

### Required Fields
```javascript
{
  id: string,              // Unique identifier
  name: string,            // Display name
  manufacturer: string,    // Manufacturer name
  room: string,            // Room assignment
  roomId: string,          // Room ID (normalized)
  zoneId: string | null,   // Zone assignment (null = unassigned)
  watts: number,           // Power consumption
  ppf: number,             // Photosynthetic Photon Flux (µmol/s)
  ppe: number,             // Photosynthetic Photon Efficacy (µmol/J)
  tunable: boolean,        // Can adjust spectrum?
  dimmable: boolean,       // Can adjust intensity?
  comm: string,            // Control protocol (WiFi/BLE/0-10V/SmartPlug)
}
```

### Optional Fields
```javascript
{
  spectrum: {              // For tunable lights
    blue: number,          // % blue
    green: number,         // % green
    red: number,           // % red
    farRed: number         // % far-red
  },
  colorRange: string,      // e.g., "400-700nm"
  smartPlug: boolean,      // Smart plug controlled?
  channels: array,         // Channel configuration
  lynx3: boolean,          // Lynx3 compatible?
}
```

## Event Flow

### Light Setup → Groups V2
1. Light Setup wizard saves light with `roomId` set
2. `lights-updated` event fired
3. Groups V2 listens and calls `renderGroupsV2UnassignedLightCards()`
4. Light appears in Unassigned Lights section

### Assign to Group
1. User clicks "Assign to Group" button
2. `handleGroupsV2AssignLight()` sets `light.zoneId = selectedZone`
3. `lights-updated` event fired
4. Both Unassigned and Assigned sections re-render
5. Light moves to Assigned Lights section

### Save Group
1. User clicks "Save Group"
2. `handleGroupsV2SaveGroup()` collects:
   - Room, zone, zone name
   - All lights with matching `room + zoneId`
   - Applied plan payload (if any)
3. Saves to `public/data/groups-v2.json`

### Load Group
1. User selects group from "Load group" dropdown
2. `handleGroupsV2LoadGroup()` restores:
   - Room, zone, zone name
   - Plan details (via `applyGroupsV2PlanFromGroup()`)
   - Light assignments (sets `zoneId` on matching lights)
3. Cards re-render with restored state

## CSS Classes

### Light Cards
- `.gr-light-card` - Base card style
- `.gr-light-card:hover` - Hover effect (lift + shadow)
- `.groupsV2AssignLightBtn` - Assign button
- `.groupsV2UnassignLightBtn` - Unassign button

### Comparison Layout
- `#groupsV2Comparison` - Grid container (hidden by default)
- `#groupsV2PlanComparisonCard` - Plan target content
- `#groupsV2LightComparisonCard` - Light capability content

## Spectrum Visualization

### Rendering Function
- `renderSpectrograph(svg, percents)` - Draws Gaussian-based spectrum curve
- Colors gradient from blue (400nm) → green (550nm) → red (660nm) → far-red (730nm)
- Uses weighted Gaussian distributions for realistic spectral power distribution

### Spectrum Descriptions
- "High blue/red - vegetative" (B>40%, R>40%, G<10%)
- "Flowering/fruiting spectrum" (R>45%, FR>10%)
- "Full spectrum - balanced growth" (B>30%, G>15%)
- "Blue-heavy - compact growth" (B>50%)
- "Red-heavy - flowering" (R>50%)
- "Broad spectrum" (default)

## Testing

### Seed Data
The system seeds 5 test lights on page load:
1. **TopLight MH Model-300W-22G12** (×2) - Tunable, WiFi, 300W
2. **P.L. Light VertiMax 640W** - Fixed spectrum, 0-10V, 640W
3. **Fluence SPYDR 2x** - Fixed spectrum, BLE, 685W
4. **Generic LED via Smart Plug** - Fixed, on/off only, 100W

### Test Workflow
1. Navigate to Groups V2 panel
2. Select room "GreenReach"
3. Apply a plan (e.g., "Buttercrunch Lettuce")
4. Set seed date or DPS
5. Observe 5 light cards in Unassigned section
6. Click any card → comparison view appears
7. Click "Assign to Group" → light moves to Assigned section
8. Save group → persists to groups-v2.json
9. Delete group or select "(none)" → clears assignments
10. Reload group → restores light assignments

## Future Enhancements
- [ ] Spectrum delta calculations (show % mismatch per wavelength band)
- [ ] Automatic fixture recommendation based on plan requirements
- [ ] PPFD coverage map integration
- [ ] Multi-light selection for batch assignment
- [ ] Drag-and-drop light card reordering
- [ ] Light health monitoring (runtime hours, status)
- [ ] Export comparison reports (PDF/CSV)
