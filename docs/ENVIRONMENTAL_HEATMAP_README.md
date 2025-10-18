# Environmental Heat Map 🌡️

> Visual time machine for your grow room environment

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Status](https://img.shields.io/badge/status-beta-yellow)
![Dependencies](https://img.shields.io/badge/dependencies-0-green)

---

## What is it?

The Environmental Heat Map transforms 24 hours of sensor data into color-coded spatial visualizations. See temperature, humidity, and VPD gradients across your grow room layout, study equipment impact, and optimize placement—all with an intuitive playback interface.

## Quick Start

### Access
```
Dashboard → Farm Summary → 🌡️ Heat Map
```

### 3 Steps to Insights
1. **Select Metric**: Temperature, Humidity, or VPD
2. **Press Play**: Watch 24-hour environmental evolution
3. **Study Patterns**: Identify hot spots, cold zones, correlate with equipment

## Key Features

✨ **Real-Time Status Bar** - Current readings + 24hr ranges  
🎨 **Color-Coded Heat Maps** - Intuitive gradient visualization  
⏱️ **Timeline Playback** - Play, pause, scrub through history  
📍 **Sensor Overlay** - Live readings at exact positions  
🔌 **Equipment Status** - Online/offline indicators  
🗺️ **Zone Boundaries** - Logical grow area separation  

## Screenshots

### Temperature Heat Map
```
🔵 Cold Zone (AC coverage)
🟢 Ideal Zone (optimal growth)
🔴 Hot Zone (near lights)
```

### Timeline Playback
```
├───────────●───────────┤
24h ago   (2h 15m ago)  Now

Watch environmental changes over time
Correlate with equipment on/off cycles
```

## Use Cases

### 1. HVAC Effectiveness
**Question**: Is my air conditioner cooling evenly?  
**Method**: Watch temperature heat map for 24 hours  
**Insight**: Identify cold spots near AC, hot spots in corners  
**Action**: Add circulation fans for uniform distribution

### 2. Dehumidifier Placement
**Question**: Where should I place my dehumidifier?  
**Method**: Review humidity map during high-humidity periods  
**Insight**: Find zones with consistently high RH%  
**Action**: Move dehumidifier to problem area

### 3. Light Heat Study
**Question**: How much heat do my grow lights generate?  
**Method**: Compare temperature lights-on vs lights-off  
**Insight**: Quantify temperature rise (e.g., +6°F)  
**Action**: Add cooling or adjust light intensity

### 4. Sensor Validation
**Question**: Are my sensors accurate?  
**Method**: Compare readings from sensors in same zone  
**Insight**: Identify outliers (>5°F difference)  
**Action**: Recalibrate or replace suspect sensors

## Requirements

### Minimum (Basic)
- 1 sensor with 24-hour history
- Room map saved (or default)
- Environmental data in `/data/env.json`

### Recommended (Good)
- 3+ sensors positioned in Room Mapper
- Defined grow zones
- Equipment registered in IoT devices

### Optimal (Research-Grade)
- 5-10 sensors across room
- Equipment telemetry (on/off status)
- 7+ days historical baseline

## Color Schemes

### Temperature (°F)
| Range | Color | Meaning |
|-------|-------|---------|
| 85°F+ | 🔴 Red | Very Hot - Potential stress |
| 80-85 | 🟠 Orange | Hot - Monitor closely |
| 75-80 | 🟡 Yellow | Warm - Upper range |
| 70-75 | 🟢 Green | **Ideal** - Optimal growth |
| 65-70 | 🔵 Blue | Cool - Lower range |
| <65 | 🔷 Cyan | Cold - Below recommended |

### Humidity (%RH)
| Range | Color | Meaning |
|-------|-------|---------|
| >70% | 🔵 Blue | Very Humid - Mold risk |
| 60-70 | 🔷 Cyan | High - Upper range |
| 50-60 | 🟢 Green | **Ideal** - Optimal |
| 40-50 | 🟡 Yellow | Low - Lower range |
| <40% | 🔴 Red | Dry - Stress risk |

### VPD (kPa)
| Range | Color | Meaning |
|-------|-------|---------|
| >1.5 | 🔴 Red | High - Excessive transpiration |
| 1.2-1.5 | 🟡 Yellow | Upper - Monitor |
| 0.8-1.2 | 🟢 Green | **Ideal** - Optimal VPD |
| <0.8 | 🔵 Blue | Low - Insufficient transpiration |

## Troubleshooting

### Heat Map Shows "No data available"
**Fix**: Check if sensors are sending data to `/data/env.json`

### Heat Map is All One Color
**Fix**: Need 3+ sensors for accurate gradients

### Sensors Not Appearing on Map
**Fix**: Go to Room Mapper, place sensors on grid, save

### Timeline Slider Stuck
**Fix**: Wait for 24 hours of data to accumulate

### Equipment Status All Offline
**Fix**: Verify device telemetry is reporting online status

## Documentation

| Document | Purpose | Audience |
|----------|---------|----------|
| [Full Documentation](docs/ENVIRONMENTAL_HEATMAP.md) | Technical details | Developers |
| [Quick Start](docs/ENVIRONMENTAL_HEATMAP_QUICKSTART.md) | 60-second tutorial | Operators |
| [Visual Guide](docs/ENVIRONMENTAL_HEATMAP_VISUAL_GUIDE.md) | ASCII diagrams | Visual learners |
| [Implementation](docs/ENVIRONMENTAL_HEATMAP_IMPLEMENTATION.md) | Project summary | Stakeholders |

## Technical Details

### Stack
- **Language**: Vanilla JavaScript (ES6+)
- **Rendering**: HTML5 Canvas API
- **Data Format**: JSON
- **Dependencies**: Zero
- **Browser**: Modern browsers with Canvas support

### Performance
- **Render Time**: <50ms per frame
- **Memory**: ~15MB typical usage
- **Data Points**: 288 (24 hours @ 5min intervals)
- **Canvas Size**: 800×600px (default)

### Data Sources
```
GET /data/room-map.json       # Device positions, zones
GET /data/env.json             # 24hr environmental history
GET /data/iot-devices.json     # Device telemetry, status
```

## Roadmap

### v1.0 (Current) ✅
- [x] Basic heat map visualization
- [x] 3 metrics (Temp, Humidity, VPD)
- [x] 24-hour playback
- [x] Sensor position overlay
- [x] Equipment status indicators

### v2.0 (Planned) 🚧
- [ ] True spatial interpolation (IDW algorithm)
- [ ] Equipment history timeline
- [ ] Multi-room support
- [ ] Export as PNG/GIF
- [ ] Comparison mode (before/after)
- [ ] Timeline annotations

### Future (Research) 🔮
- [ ] 3D visualization (height dimension)
- [ ] Predictive modeling (forecast 2-4 hours)
- [ ] Anomaly detection (auto-alerts)
- [ ] Mobile app (iOS/Android)

## Contributing

### Found a Bug?
1. Check [Known Issues](docs/ENVIRONMENTAL_HEATMAP.md#known-limitations)
2. Search existing GitHub Issues
3. Create new issue with reproduction steps

### Feature Request?
1. Review [Roadmap](#roadmap) above
2. Check if already planned
3. Open GitHub Issue with use case description

### Want to Contribute?
1. Fork repository
2. Create feature branch
3. Write tests
4. Submit pull request

## FAQ

**Q: Why is my heat map all one color?**  
A: You need 3+ sensors for realistic gradients. With 1 sensor, the system assumes uniform distribution.

**Q: Can I export the heat map as an image?**  
A: Not yet. Export functionality is planned for v2.0.

**Q: Does this work on mobile?**  
A: Currently optimized for desktop/tablet. Mobile app planned for future.

**Q: How much data is stored?**  
A: 24 hours × 12 intervals/hour = 288 data points per metric. Rotates automatically.

**Q: Can I compare two rooms side-by-side?**  
A: Not yet. Multi-room support with comparison mode planned for v2.0.

## Support

### Documentation
- 📖 [Full Docs](docs/ENVIRONMENTAL_HEATMAP.md)
- ⚡ [Quick Start](docs/ENVIRONMENTAL_HEATMAP_QUICKSTART.md)
- 🎨 [Visual Guide](docs/ENVIRONMENTAL_HEATMAP_VISUAL_GUIDE.md)

### Training
- Video tutorial: Coming soon
- Live demo: Schedule with team
- FAQ: Updated weekly

### Feedback
- GitHub Issues: Bug reports and features
- Beta testing: Weekly sessions
- Survey: Post-beta questionnaire

## License

Part of Light Engine Charlie project.  
See main [LICENSE](../LICENSE) for details.

## Changelog

### v1.0.0 (2025-10-18) - Initial Release
- ✨ Heat map visualization with 3 metrics
- ✨ 24-hour playback system
- ✨ Sensor and equipment overlays
- ✨ Zone boundary visualization
- ✨ Real-time status bar
- 📚 Comprehensive documentation (4 docs)
- 🐛 Fixed Room Mapper async loading issues
- 🐛 Added device snapshot persistence

---

**Built with ❤️ for indoor farming operators**

🌱 Optimize your grow room environment with data-driven insights
