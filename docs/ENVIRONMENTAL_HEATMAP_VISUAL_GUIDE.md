# Environmental Heat Map - Visual Guide

## Page Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│  🌡️ Environmental Heat Map      [Room: Main Grow Room ▼]                  │
│                                                    [← Back] [🗺️ Edit Layout]│
├────────────────────────────────────────────────────────────────────────────┤
│  Temperature    Humidity     VPD       Active Sensors    Equipment Online  │
│    72.5°F        60.5%      0.91 kPa         3                2/4          │
│  Range: 70-75   Range: 55-65  Range: 0.8-1.1                               │
├─────────────────────────────────────────────────────┬──────────────────────┤
│                                                     │                      │
│  ┌─────────────────────────────────────────────┐   │  🎨 Heat Map Legend  │
│  │  Spatial Distribution                       │   │  ┌────────────────┐  │
│  │                   [Temp] [Humidity] [VPD]   │   │  │     Red (Hot)  │  │
│  ├─────────────────────────────────────────────┤   │  │                │  │
│  │                                             │   │  │    Orange      │  │
│  │         ╔═══════════════════════╗           │   │  │                │  │
│  │         ║  Zone 1 (Veg)        ║           │   │  │    Yellow      │  │
│  │         ║                       ║           │   │  │                │  │
│  │         ║   🔵 72.1°F          ║           │   │  │    Green       │  │
│  │         ║                       ║           │   │  │                │  │
│  │         ║      💡 (online)      ║           │   │  │    Cyan        │  │
│  │         ║                       ║           │   │  │                │  │
│  │         ║   🔵 72.8°F          ║           │   │  │    Blue (Cold) │  │
│  │         ╚═══════════════════════╝           │   │  └────────────────┘  │
│  │                                             │   │  Min: 70°F          │
│  │    🔌 (offline)                             │   │  Max: 75°F          │
│  │                                             │   │                      │
│  │    🔵 73.2°F                               │   ├──────────────────────┤
│  │                                             │   │  🌡️ Active Sensors  │
│  │         ╔═══════════════════════╗           │   │  ┌────────────────┐ │
│  │         ║  Zone 2 (Flower)      ║           │   │  │ Sensor 1       │ │
│  │         ║                       ║           │   │  │ Zone 1 • (5,3) │ │
│  │         ║      🌀 (online)       ║           │   │  │ 72.1°F     [🔵]│ │
│  │         ║                       ║           │   │  ├────────────────┤ │
│  │         ║   🔵 71.5°F          ║           │   │  │ Sensor 2       │ │
│  │         ║                       ║           │   │  │ Zone 1 • (12,3)│ │
│  │         ╚═══════════════════════╝           │   │  │ 72.8°F     [🔵]│ │
│  │                                             │   │  ├────────────────┤ │
│  │  [Color gradient background represents      │   │  │ Sensor 3       │ │
│  │   environmental conditions across space]    │   │  │ Zone 2 • (10,9)│ │
│  └─────────────────────────────────────────────┘   │  │ 71.5°F     [🔵]│ │
│                                                     │  └────────────────┘ │
│  ⏱️ 24-Hour Playback          [▶️] [⏸️] [⏮️]      ├──────────────────────┤
│  ┌─────────────────────────────────────────────┐   │  🌀 Equipment Status │
│  │              2h 15m ago                     │   │  ┌────────────────┐ │
│  └─────────────────────────────────────────────┘   │  │ HVAC Unit      │ │
│  ├───────────────●───────────────────────────┤     │  │ ● Online   [🟢]│ │
│  24 hours ago                              Now     │  ├────────────────┤ │
│                                                     │  │ Dehumidifier   │ │
│                                                     │  │ ● Online   [🟢]│ │
│                                                     │  ├────────────────┤ │
│                                                     │  │ Fan 1          │ │
│                                                     │  │ ○ Offline  [⚫]│ │
│                                                     │  ├────────────────┤ │
│                                                     │  │ Grow Light     │ │
│                                                     │  │ ○ Offline  [⚫]│ │
│                                                     │  └────────────────┘ │
└─────────────────────────────────────────────────────┴──────────────────────┘
```

## Heat Map Legend

### Temperature Mode
```
  ┌────────────────┐
  │   85°F+  ████  │  🔴 Very Hot - Potential plant stress
  │   80-85  ████  │  🟠 Hot - Monitor closely
  │   75-80  ████  │  🟡 Warm - Upper acceptable range
  │   70-75  ████  │  🟢 Ideal - Optimal growth temp
  │   65-70  ████  │  🔵 Cool - Lower acceptable range
  │   <65    ████  │  🔷 Cold - Below recommended
  └────────────────┘
```

### Humidity Mode
```
  ┌────────────────┐
  │   >70%   ████  │  🔵 Very Humid - Risk of mold
  │   60-70  ████  │  🔷 High - Upper range
  │   50-60  ████  │  🟢 Ideal - Optimal range
  │   40-50  ████  │  🟡 Low - Lower range
  │   <40    ████  │  🔴 Dry - Risk of plant stress
  └────────────────┘
```

### VPD Mode
```
  ┌────────────────┐
  │   >1.5   ████  │  🔴 High - Too much transpiration
  │   1.2-1.5 ████ │  🟡 Upper - Monitor plants
  │   0.8-1.2 ████ │  🟢 Ideal - Optimal VPD
  │   <0.8   ████  │  🔵 Low - Insufficient transpiration
  └────────────────┘
```

## Map Icons Explained

### Sensors
```
    🔵        Sensor marker (blue circle with white border)
   72.1°F     Current reading displayed above
```

**What it means**: Live environmental sensor
**Click to**: See details in sidebar

---

### Equipment (Online)
```
    💡        Equipment icon (light, plug, HVAC)
    🟢        Green indicator dot (top-right corner)
```

**What it means**: Device is powered on and responding
**Impact on**: May be generating heat or humidity

---

### Equipment (Offline)
```
    🔌        Equipment icon
    ⚫        Gray indicator dot (top-right corner)
```

**What it means**: Device is powered off or not responding
**Impact on**: Not affecting environment currently

---

### Zones
```
    ╔═══════════════════════╗
    ║  Zone 1 (Veg)        ║   Dashed border in zone color
    ║                       ║   Zone name at top-left
    ╚═══════════════════════╝
```

**What it means**: Defined grow zone from Room Mapper
**Purpose**: Logical grouping of equipment and sensors

## Timeline Controls

### Playback Buttons
```
  [▶️]  Play   - Auto-advance through 24 hours (loops)
  [⏸️]  Pause  - Freeze at current time point
  [⏮️]  Reset  - Jump back to "Now"
```

### Timeline Slider
```
  ├───────────────●───────────────────────────┤
  24h ago      (current)                    Now

  • Drag circle to scrub through history
  • Each position = 5-minute interval
  • 288 total positions (24 hrs × 12)
```

### Time Display
```
  ┌─────────────────────────────────────────────┐
  │              2h 15m ago                     │
  └─────────────────────────────────────────────┘

  Shows:
  • "Now" - Current time (rightmost position)
  • "15 min ago" - Recent past (minutes only)
  • "2h 15m ago" - Further past (hours + minutes)
  • "24h ago" - Leftmost position
```

## Status Bar Metrics

### Current Reading
```
   Temperature
     72.5°F        ← Current value (large)
   Range: 70-75    ← 24-hour min-max
```

### Sensor Count
```
   Active Sensors
        3          ← Number of sensors reporting data
```

### Equipment Count
```
   Equipment Online
       2/4         ← Online / Total
```

## Interaction Examples

### Example 1: Scrubbing Timeline
```
Before:                    After (drag slider left):
┌──────────────┐          ┌──────────────┐
│     Now      │          │  3h 45m ago  │
└──────────────┘          └──────────────┘
     ●────────┤               ●───────────┤
             Now          3h 45m ago    Now

Heat map updates to show conditions at that time
Sensor readings reflect historical values
Equipment status shows state at that moment
```

### Example 2: Changing Metrics
```
[Temperature] [Humidity] [VPD]
     ▼             ▲
   Active       Inactive

Click Humidity:
• Heat map re-renders with humidity colors
• Legend updates (Red = dry, Blue = humid)
• Sensor markers show RH% instead of °F
• Status bar highlights Humidity metric
```

### Example 3: Playback Animation
```
Time:    Now → 23h ago → 22h ago → ... → Now (loops)
         │      │         │              │
Heat Map │      │         │              │
Updates  └──────┴─────────┴──────────────┘
         Smoothly animates through 24 hours
         Shows how environment evolved
         Correlates with equipment on/off cycles
```

## Common Patterns to Look For

### Pattern 1: Hot Spots Near Lights
```
  ┌──────────────────────┐
  │   💡 (online)        │  ← Grow light ON
  │                      │
  │   🔴🔴🔴🔴🔴          │  ← Red zone (hot)
  │   🔴🔴🔴🔴🔴          │
  │   🟡🟡🟡🟡🟡          │  ← Yellow zone (warm)
  │                      │
  │   🟢🟢🟢🟢🟢          │  ← Green zone (ideal)
  └──────────────────────┘

Action: Add fan for air circulation
```

### Pattern 2: Cold Spots Near HVAC
```
  ┌──────────────────────┐
  │   🌀 (online)        │  ← AC unit ON
  │                      │
  │   🔵🔵🔵🔵🔵          │  ← Blue zone (cold)
  │   🔷🔷🔷🔷🔷          │
  │   🟢🟢🟢🟢🟢          │  ← Green zone (ideal)
  │                      │
  │   🟡🟡🟡🟡🟡          │  ← Yellow zone (warm, far from AC)
  └──────────────────────┘

Action: Reposition AC or add circulation fan
```

### Pattern 3: Humidity Gradient
```
  ┌──────────────────────┐
  │   🔴🔴🔴🔴🔴          │  ← Red zone (dry)
  │   🟡🟡🟡🟡🟡          │
  │   🟢🟢🟢🟢🟢          │  ← Green zone (ideal)
  │   🔷🔷🔷🔷🔷          │
  │   🔵🔵🔵🔵🔵          │  ← Blue zone (humid, no dehumidifier coverage)
  │                      │
  │   🌀 (offline)       │  ← Dehumidifier OFF
  └──────────────────────┘

Action: Turn on dehumidifier or move closer to humid zone
```

## Sidebar Details

### Sensor Item Breakdown
```
┌─────────────────────────┐
│ Sensor 1                │  ← Device name
│ Zone 1 • (5,3)          │  ← Zone assignment • Grid position
│         72.1°F      [🔵]│  ← Current reading • Marker icon
└─────────────────────────┘
```

### Equipment Item Breakdown
```
┌─────────────────────────┐
│ HVAC Unit               │  ← Device name
│         ● Online   [🟢] │  ← Status text • Status indicator
└─────────────────────────┘
```

## Tips for Best Visualization

### ✅ Do This
- Position 3+ sensors for accurate gradients
- Define zones in Room Mapper for context
- Let system collect 24 hours of data
- Review heat map during peak conditions (midday)
- Compare lights-on vs lights-off periods

### ❌ Avoid This
- Don't place all sensors in one corner
- Don't expect accuracy with only 1 sensor
- Don't ignore equipment status correlations
- Don't forget to save Room Mapper layout
- Don't rely on heat map with <1 hour of data

## Quick Troubleshooting Flowchart

```
Heat map not showing?
     │
     ├─ Status bar empty? ──→ No data in env.json ──→ Check sensor ingestion
     │
     ├─ All one color? ──→ Need more sensors ──→ Add 2+ more sensors
     │
     ├─ Sensors missing? ──→ Not positioned ──→ Place in Room Mapper
     │
     └─ Timeline stuck? ──→ <24hr data ──→ Wait for data accumulation
```

---

**Pro Tip**: Take a screenshot of the heat map before and after making equipment changes. Compare to measure impact! 📸
