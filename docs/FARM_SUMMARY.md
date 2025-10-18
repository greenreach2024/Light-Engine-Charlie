# Farm Room Summary Dashboard

## Overview

The Farm Room Summary is a large-format, full-screen dashboard designed for real-time monitoring of farm operations. Perfect for wall-mounted displays, tablets, or monitoring stations.

## Features

### 📊 Environmental Conditions
- **Real-time metrics** displayed in large, easy-to-read cards:
  - Temperature (°F)
  - Humidity (%)
  - CO₂ (ppm)
  - VPD (kPa)
  - PPFD (μmol/m²/s)
  - DLI (mol/m²/d)
- **Status indicators** with color coding:
  - 🟢 **Optimal**: Values within ideal range
  - 🟡 **Acceptable**: Values within acceptable range
  - 🔴 **Alert**: Values outside safe range

### ⚙️ Schedule & Automation
- **Automation status** with live indicator
  - Running/Stopped state
  - Execution count and error count
  - Active groups count
- **Current group information**
  - Group name and light count
  - Seed date and days past seed
- **Active plan details**
  - Plan name and recipe
  - Duration and current day
- **Schedule information**
  - Photoperiod (on/off times)
  - Schedule type

### 📈 Environmental Trends
- **2-hour historical data** with interactive charts
- **Metric selection** via button controls:
  - Temperature
  - Humidity
  - CO₂
  - VPD
  - PPFD
- **Real-time updates** every 30 seconds
- **Smooth line charts** with grid overlay

## Access

### From Main Dashboard
1. Navigate to the main Light Engine Charlie dashboard
2. Look for the **🌱 Farm Summary** button in the top card (right side)
3. Click to open in a new window/tab

### Direct URL
```
http://localhost:8091/views/farm-summary.html
```

### Full-Screen Mode
The page is designed for full-screen viewing:
- Opens in a large window (1920x1080 by default)
- Press **F11** in most browsers for true full-screen
- Optimized for landscape displays

## Closing the Dashboard

Two ways to close:
1. Click the **✕ Close (ESC)** button in the top-right corner
2. Press the **ESC** key on your keyboard

## Design

### Visual Style
- **Modern dark theme** with gradient background
- **High contrast** for easy visibility from distance
- **Color-coded status** for quick visual assessment
- **Large typography** optimized for readability
- **Smooth animations** for status indicators

### Layout
- **Responsive grid** adapts to different screen sizes
- **Three main sections**:
  - Environmental Conditions (left, full height)
  - Schedule & Automation (right top)
  - Trending Data (right bottom)

### Performance
- **Lightweight** - vanilla JavaScript, no frameworks
- **Auto-refresh** every 30 seconds
- **Efficient rendering** with canvas-based charts
- **Graceful degradation** when data is unavailable

## Data Sources

The dashboard pulls data from these endpoints:

### Environmental Data
```
GET /env
```
Returns latest environmental readings and 24-hour history.

### Schedule Executor Status
```
GET /api/schedule-executor/status
```
Returns automation status and execution metrics.

### Groups, Plans, Schedules
```
GET /data/groups.json
GET /data/plans.json
GET /data/schedules.json
```
Returns configuration for active automation.

## Customization

### Optimal Ranges
Default optimal ranges (defined in JavaScript):
```javascript
const ranges = {
  temperature: { optimal: [68, 78], warning: [65, 82] },
  humidity: { optimal: [50, 70], warning: [40, 80] },
  co2: { optimal: [800, 1200], warning: [600, 1500] },
  vpd: { optimal: [0.8, 1.2], warning: [0.6, 1.5] },
  ppfd: { optimal: [400, 800], warning: [200, 1000] }
};
```

Edit `/public/views/farm-summary.html` to adjust these values for your specific crops and growth stages.

### Refresh Interval
Default: 30 seconds
```javascript
// Change this value to adjust refresh rate (milliseconds)
updateInterval = setInterval(loadData, 30000);
```

### Chart Time Window
Default: 2 hours
```javascript
// Change to show more/less history
const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
```

## Use Cases

### 1. Monitoring Station
Mount on a wall display or tablet in the grow room entrance for quick status checks.

### 2. Control Room Dashboard
Display on large monitors in a central control room for multi-room operations.

### 3. Remote Monitoring
Access from any device with a browser to check farm status remotely.

### 4. Operator Handoff
Use during shift changes to quickly communicate current conditions and automation status.

### 5. Client Demonstrations
Show stakeholders a professional, real-time view of farm operations.

## Troubleshooting

### No Environmental Data
- Check that sensors are connected and reporting to `/ingest/env`
- Verify `/env` endpoint returns data: `curl http://localhost:8091/env`
- Check browser console for API errors

### Automation Shows "Stopped"
- Verify schedule executor is enabled in `server-charlie.js`
- Check executor status: `curl http://localhost:8091/api/schedule-executor/status`
- Review server logs for executor errors

### Charts Not Displaying
- Ensure environmental history data exists
- Check that data is being collected over time
- Verify canvas element is rendering (check browser console)

### Page Won't Close
- Try using the ESC key
- Close the browser tab manually
- Check browser pop-up settings

## Browser Compatibility

Tested and optimized for:
- ✅ Chrome/Chromium 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

Mobile browsers supported but optimized for desktop/tablet displays.

## Future Enhancements

Potential additions for future versions:
- [ ] Camera feed integration
- [ ] Alert notifications overlay
- [ ] Multi-room switching
- [ ] Historical data export
- [ ] Customizable color themes
- [ ] Full-screen image slideshow mode
- [ ] Touch-optimized controls for kiosks
- [ ] Voice readout for accessibility

## Technical Details

### File Structure
```
/public/views/farm-summary.html
  ├── HTML structure
  ├── CSS (embedded in <style>)
  └── JavaScript (embedded in <script>)
```

### Dependencies
- None! Pure vanilla JavaScript
- HTML5 Canvas API for charts
- Fetch API for data loading

### Code Stats
- ~650 lines total
- ~250 lines CSS
- ~350 lines JavaScript
- ~50 lines HTML

## Related Documentation

- [Schedule Executor System](./SCHEDULE_EXECUTOR.md)
- [Environmental Data Flow](./AUTOMATION_SYSTEM.md)
- [Groups V2 Design](./GROUPS_V2_LIGHT_ASSIGNMENT.md)

## Support

For issues or feature requests related to the Farm Summary dashboard:
1. Check server logs: `tail -f server.log`
2. Check browser console for JavaScript errors
3. Verify data endpoints are accessible
4. Review this documentation for configuration options

---

**Ready for Testing**: The Farm Summary dashboard is production-ready and optimized for tomorrow's testing session. Simply click the button or navigate directly to the URL to start monitoring your farm operations.
