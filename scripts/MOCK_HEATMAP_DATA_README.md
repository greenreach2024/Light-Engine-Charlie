# Mock Heat Map Data Generator

This script generates realistic 24-hour environmental data for demonstrating the Environmental Heat Map feature.

## What It Creates

### Room Layout (`room-map.json`)
- **4 Zones**: 2×2 grid configuration
  - Zone 1 (Mini-Split) - Top left
  - Zone 2 (Mini-Split) - Top right  
  - Zone 3 (Fans) - Bottom left
  - Zone 4 (Fans) - Bottom right

- **16 Devices**:
  - 4 sensors (1 per zone at center)
  - 8 grow lights (2 lines per zone)
  - 2 mini-splits (zones 1 & 2)
  - 2 circulation fans (zones 3 & 4)

### Environmental Data (`env.json`)
- **288 data points** per metric (24 hours @ 5-minute intervals)
- **Realistic patterns** showing:
  - Light cycle effects (8 hours on, 4 hours off, repeating)
  - Heat generation from lights
  - Humidity increase from transpiration
  - Cooling effects from mini-splits (better)
  - Cooling effects from fans (moderate)

## Pattern Details

### Light Schedule
```
00:00-04:00: Lights OFF  (4 hours)
04:00-12:00: Lights ON   (8 hours)
12:00-16:00: Lights OFF  (4 hours)
16:00-24:00: Lights ON   (8 hours)
```

### Temperature Patterns

**Lights OFF (Baseline)**
- All zones: ~70°F

**Lights ON**
- Initial rise: ~78°F (heat from lights)
- Mini-split zones (1 & 2): Cool to ~72°F
- Fan zones (3 & 4): Cool to ~74°F

**Ramp Time**
- 30 minutes to reach full effect (gradual, not instant)

### Humidity Patterns

**Lights OFF (Baseline)**
- All zones: ~55% RH

**Lights ON**
- Initial rise: ~65% RH (transpiration from plants)
- Mini-split zones: Dehumidify to ~62% RH
- Fan zones: Slight reduction to ~64% RH

### VPD Calculation
- Automatically calculated from temperature and humidity
- Typical range: 0.75-1.35 kPa
- Ideal range: 0.8-1.2 kPa

## Usage

### Generate Data
```bash
npm run mock:heatmap
```

Or directly:
```bash
node scripts/generate-mock-heatmap-data.cjs
```

### View Results
```bash
# Start server (if not running)
npm run start

# Open heat map page
open http://localhost:8091/views/room-heatmap.html
```

## Expected Visualization

When you view the heat map, you should see:

### Temperature Mode
- **Zone 1 & 2** (mini-splits): Cooler blues/greens
- **Zone 3 & 4** (fans): Warmer yellows/oranges
- **During lights-on**: Clear heat gradients
- **During lights-off**: More uniform, cooler temps

### Humidity Mode
- **Zone 1 & 2**: Lower humidity (mini-splits dehumidify)
- **Zone 3 & 4**: Higher humidity (fans don't dehumidify)
- **During lights-on**: Increased humidity overall
- **During lights-off**: More uniform distribution

### Timeline Playback
1. Start at "Now" (lights likely on)
2. Scrub back to 24 hours ago
3. Watch temperature/humidity rise when lights turn on
4. See cooling effects from equipment
5. Observe patterns repeat every 12 hours

## Customization

To modify the patterns, edit `generate-mock-heatmap-data.cjs`:

```javascript
// Change baseline temperatures
const baseTemp = 70; // Lights off baseline

// Change light heat contribution
const lightHeat = 8; // Heat from lights

// Change cooling effects
coolingEffect = lightsOn ? -4 : 0; // Mini-split cooling

// Change light schedule
function isLightsOn(intervalIndex) {
  const hour = (intervalIndex * 5 / 60);
  return (hour >= 4 && hour < 12) || (hour >= 16 && hour < 24);
}
```

## Technical Details

### Data Generation
- **Temperature**: Base + light heat + cooling effect + daily variation + random noise
- **Humidity**: Base + transpiration + dehumidification + daily variation + random noise
- **VPD**: Calculated from Temp/RH using saturation vapor pressure formula
- **Ramp**: 30-minute gradual transition (not instant state changes)

### File Output
- **room-map.json**: 256 lines (room layout with zones and devices)
- **env.json**: ~3,600 lines (4 zones × 3 metrics × 288 points)

### Randomness
- Small random noise added to each data point (±0.5°F, ±1% RH)
- Creates realistic sensor variation
- Prevents perfectly smooth lines

## Verification

After running the script, check:

```bash
# Verify room map created
cat public/data/room-map.json | head -30

# Verify env data created
cat public/data/env.json | head -50

# Check data point count (should be 288)
cat public/data/env.json | jq '.zones[0].sensors.tempC.history | length'
```

## Integration

This mock data integrates seamlessly with:
- **Environmental Heat Map** (`/views/room-heatmap.html`)
- **Room Mapper** (`/views/room-mapper.html`)
- **Farm Summary** (`/views/farm-summary.html`)

No code changes needed - just generate the data and refresh the pages!

## Demo Scenarios

### Scenario 1: Compare Cooling Methods
1. Open heat map in Temperature mode
2. Click Play to watch 24-hour cycle
3. Observe: Zones 1 & 2 stay cooler (mini-splits)
4. Observe: Zones 3 & 4 run warmer (fans only)
5. **Insight**: Mini-splits provide better cooling

### Scenario 2: Light Cycle Impact
1. Scrub timeline to lights-off period (e.g., 2am)
2. Note: Temperature ~70°F, uniform across zones
3. Scrub to lights-on period (e.g., 10am)
4. Note: Temperature ~72-74°F, gradients visible
5. **Insight**: Lights contribute 4-6°F heat rise

### Scenario 3: Equipment Correlation
1. Switch to Humidity mode
2. Watch humidity rise when lights turn on
3. Note: Mini-split zones recover faster
4. Note: Fan zones stay more humid
5. **Insight**: Mini-splits provide dehumidification benefit

## Troubleshooting

### Script fails to run
```bash
# Ensure Node.js installed
node --version  # Should be v18+

# Check file permissions
chmod +x scripts/generate-mock-heatmap-data.cjs
```

### Generated files look wrong
```bash
# Re-run script
rm public/data/room-map.json public/data/env.json
node scripts/generate-mock-heatmap-data.cjs

# Validate JSON
jq . public/data/env.json > /dev/null && echo "✅ Valid JSON"
```

### Heat map not showing patterns
- Hard refresh browser (Cmd+Shift+R)
- Clear browser cache
- Check browser console for errors
- Verify server is running on port 8091

## Clean Up

To restore original data:

```bash
# If you backed up original data
mv public/data/env.json.backup public/data/env.json
mv public/data/room-map.json.backup public/data/room-map.json

# Or use git to restore
git checkout public/data/env.json
git checkout public/data/room-map.json
```

## Production Note

**⚠️ This is DEMO DATA ONLY**

Do not use in production environments. For production:
1. Use real sensor data from `/ingest/env` endpoint
2. Configure actual IoT devices in Room Mapper
3. Let system accumulate 24 hours of real data
4. This script is for demonstration and training purposes only

## Future Enhancements

Potential improvements to the generator:
- [ ] Command-line arguments for customization
- [ ] Multiple room templates (small, medium, large)
- [ ] Different light schedules (vegetative, flowering)
- [ ] Seasonal outdoor temp influence
- [ ] Equipment malfunction scenarios (for training)
- [ ] Export as CSV for analysis tools

---

**Questions?** See `docs/ENVIRONMENTAL_HEATMAP.md` for heat map documentation.
