# Environmental Heat Map - Quick Start

## 🎯 What Is This?

A **visual time machine** for your grow room environment. See temperature, humidity, and VPD as color-coded heat maps across your room layout over the past 24 hours.

## 🚀 Quick Access

**Method 1: From Dashboard**
```
Dashboard → Farm Summary Card → 🌡️ Heat Map button
```

**Method 2: Direct Link**
```
http://localhost:8091/views/room-heatmap.html
```

## ⚡ 60-Second Tutorial

### Step 1: Choose Your Metric (Top Controls)
- **Temperature** 🌡️ - See hot and cold spots
- **Humidity** 💧 - Track moisture distribution  
- **VPD** 🌱 - Monitor vapor pressure deficit

### Step 2: Watch 24-Hour Playback
- Click **▶️ Play** - Auto-play through last 24 hours
- Click **⏸️ Pause** - Freeze at interesting moment
- Click **⏮️ Reset** - Jump back to "Now"

### Step 3: Scrub Timeline Manually
- Drag slider to jump to any point in past 24 hours
- Watch heat map update in real-time
- Note equipment status changes in sidebar

## 📊 Reading the Heat Map

### Color Codes

**Temperature (°F)**
- 🔵 Blue = Cold (60-70°F)
- 🟢 Green = Ideal (70-75°F)
- 🟡 Yellow = Warm (75-80°F)
- 🔴 Red = Hot (80°F+)

**Humidity (%RH)**
- 🔴 Red = Dry (<40%)
- 🟢 Green = Ideal (50-60%)
- 🔵 Blue = Humid (>70%)

**VPD (kPa)**
- 🔵 Blue = Low (<0.8)
- 🟢 Green = Ideal (0.8-1.2)
- 🔴 Red = High (>1.5)

### Map Icons
- **🔵 Blue Circles** = Sensors (with live readings)
- **💡🔌🌀 Icons** = Equipment (lights, plugs, fans)
- **🟢 Green Dot** = Equipment online
- **⚫ Gray Dot** = Equipment offline
- **Dashed Lines** = Zone boundaries

## 🎓 Common Use Cases

### 1️⃣ Check HVAC Coverage
**Goal**: Is my air conditioner cooling evenly?

1. Select **Temperature** metric
2. Click **Play** to watch full 24 hours
3. Look for blue zones (cold) near AC
4. Look for red zones (hot) far from AC
5. **Action**: If uneven, add fans for air circulation

---

### 2️⃣ Find Dehumidifier Sweet Spot
**Goal**: Where should I place my dehumidifier?

1. Select **Humidity** metric
2. Scrub to period when humidity was high
3. Note which sensors show highest readings
4. Check current dehumidifier position
5. **Action**: Move dehumidifier toward high-humidity zone

---

### 3️⃣ Measure Light Heat Impact
**Goal**: Do my grow lights make it too hot?

1. Select **Temperature** metric
2. Find lights-off period (use timeline)
3. Note baseline temperature (e.g., 72°F)
4. Scrub to lights-on period
5. Watch temperature rise (e.g., to 78°F)
6. **Action**: If >5°F rise, add cooling or dim lights

---

### 4️⃣ Validate Sensor Accuracy
**Goal**: Is one sensor giving bad readings?

1. Check **Active Sensors** sidebar
2. Compare readings between nearby sensors
3. If one sensor differs by >5°F/10%RH, suspect!
4. Check sensor position on map
5. **Action**: Recalibrate or replace outlier sensor

## 📈 Status Bar Explained

**Top bar shows current conditions:**

| Metric | What It Means |
|--------|---------------|
| **Temperature** | Current temp + 24hr range (min to max) |
| **Humidity** | Current RH% + 24hr range |
| **VPD** | Current VPD + 24hr range |
| **Active Sensors** | How many sensors are reporting data |
| **Equipment Online** | How many devices are currently powered on |

## 🔧 Troubleshooting

### ❌ "No environmental data available"
**Fix**: Wait for sensors to report data. Check if `/data/env.json` exists.

### ❌ Heat map is all one color
**Fix**: You need 3+ sensors for accurate gradients. Add more sensors!

### ❌ Sensors not showing on map
**Fix**: Go to Room Mapper, click sensors in left sidebar to place them on grid. Save map.

### ❌ Timeline slider stuck
**Fix**: Need 24 hours of data. Come back after system runs for a full day.

### ❌ Equipment status shows all offline
**Fix**: Check device telemetry. Ensure SwitchBot/Kasa devices are online and responding.

## 💡 Pro Tips

1. **Best Time to Review**: Morning (see overnight trends)
2. **Focus on Ranges**: Status bar shows min/max - if range >10°F, investigate!
3. **Watch Equipment Cycles**: Note when HVAC turns on/off in equipment list
4. **Loop Playback**: Let it loop 2-3 times to spot recurring patterns
5. **Compare Metrics**: Switch between Temp/Humidity/VPD to see correlations

## 🎯 Success Criteria

You're using this tool effectively when you can:

✅ Identify which zone gets hottest during lights-on
✅ Explain why humidity spikes at specific times
✅ Predict when dehumidifier will cycle based on humidity gradient
✅ Confirm all sensors are reading within 2°F of each other
✅ Correlate equipment on/off with environmental changes

## 📚 Next Steps

1. **Set Baseline**: Note typical ranges for your room
2. **Document Changes**: When you move equipment, review heat map impact
3. **Create Rules**: Use findings to set automation thresholds
4. **Weekly Review**: Check heat map every Monday to spot trends

## 🆘 Need Help?

- **Full Documentation**: `docs/ENVIRONMENTAL_HEATMAP.md`
- **Room Mapper Guide**: `docs/ROOM_MAPPER.md`
- **Sensor Setup**: See `SETUP_WIZARD_SYSTEM.md`

---

**Remember**: This tool is most powerful with **3+ sensors** properly positioned. Start there! 🚀
