# Room Mapper - Quick Start Guide

## 🎯 Purpose
Visual tool for mapping sensor and equipment locations in your grow room.

## 📍 When to Use
**Last step** after configuring devices, zones, and automation control.

## 🚀 Quick Start

### 1. Open Room Mapper
Dashboard → **Control Devices** → **🗺️ Room Mapper**

### 2. Draw Zones (Optional)
1. Click **📐 Draw Zone** tool
2. Click-and-drag to create rectangular zone
3. Repeat for additional zones
4. Click **👆 Select** when done

### 3. Place Devices
1. Click device name in left sidebar
2. Device appears on canvas
3. Drag to correct location
4. Repeat for all devices

### 4. Save Map
Click **💾 Save Map** button

## 🎨 Device Icons

| Icon | Device Type |
|------|-------------|
| 🌡️ | Temperature/Humidity Sensor |
| 💡 | Grow Light / Fixture |
| 🔌 | Smart Plug / Controller |
| 🌀 | Equipment (HVAC, Dehumidifier) |

## 🗺️ Example Layout

```
Room: 20×15 cells

┌────────────────────────────────────┐
│  Zone 1 (Blue) - Vegetative        │
│  🌡️₁        💡  💡  💡            │
│                                    │
├────────────────────────────────────┤
│  Zone 2 (Green) - Flowering        │
│  💡  💡  💡      🌡️₂              │
│  🌀 Dehumidifier                   │
└────────────────────────────────────┘
```

## 🛠️ Tools

### 👆 Select
- Click to select devices
- Drag to move devices
- Click to view device details

### 📐 Draw Zone
- Click-and-drag to define rectangular zones
- Automatically numbered (Zone 1, Zone 2, etc.)
- Color-coded for visual distinction

## 💡 Tips

✅ **DO:**
- Draw zones first, then place devices
- Match zone numbers to physical room sections
- Place sensors at actual mounting locations
- Save map after every change

❌ **DON'T:**
- Forget to click Save button
- Place sensors at edge/corner (inaccurate readings)
- Overlap zones (keep boundaries clear)

## 🔧 Controls

### Grid Settings
- **Grid Size**: 10-50 cells (default: 20)
- **Cell Size**: 20-80 pixels (default: 40)

### Actions
- **Save Map**: Persist layout to server
- **Load Map**: Restore saved layout
- **Clear**: Delete all devices and zones

## 📊 Best Practices

### Sensor Placement
1. **Center of zone** for primary sensor
2. **Avoid vents/doors** for accurate readings
3. **Multiple sensors per zone** for redundancy

### Light Placement
1. **Grid pattern** for even coverage
2. **Match actual fixture positions**
3. **Label by circuit** for troubleshooting

### Zone Design
1. **Match physical sections** (racks, tables)
2. **Keep zones rectangular** for clarity
3. **Leave space between zones** for visibility

## 🆘 Troubleshooting

**Devices not in list?**
→ Configure devices in IoT Devices card first

**Can't drag devices?**
→ Click **👆 Select** tool

**Map resets after refresh?**
→ Click **💾 Save Map** button

**Zone won't draw?**
→ Drag further to create larger area

## 📱 Responsive Design

- **Desktop**: Full 3-panel layout
- **Tablet**: Canvas-focused view
- **Mobile**: Canvas only (sidebars hidden)

**Recommendation**: Use desktop for initial setup

## 🔗 Related Tools

1. **IoT Devices** - Configure devices first
2. **Zone Assignment** - Assign devices to zones
3. **Automation Control** - Mark control sensors
4. **Room Mapper** ← You are here (final step)

## 📈 Workflow Position

```
1. IoT Device Discovery
   ↓
2. Zone Assignment (1-9)
   ↓
3. Automation Control Toggle
   ↓
4. Equipment Configuration
   ↓
5. 🗺️ Room Mapper ← FINAL STEP
```

## 💾 Data Storage

- **File**: `public/data/room-map.json`
- **Auto-load**: Yes (on page refresh)
- **Backup**: Manual export recommended

## ⌨️ Future Shortcuts

Coming soon:
- **Esc**: Deselect / Cancel
- **Delete**: Remove selected item
- **Ctrl+S**: Quick save
- **Ctrl+Z**: Undo

---

**Version**: 1.0  
**Status**: Production-Ready  
**Last Updated**: January 18, 2025

**Ready to map?** Open Room Mapper now! 🚀
