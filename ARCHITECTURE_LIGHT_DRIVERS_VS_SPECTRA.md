# Light Engine Charlie: Architecture - Drivers vs. Spectra

## Executive Summary

**The system has 4 physical light DRIVERS, but grow recipes specify SPECTRAL TARGETS.**

There are two different systems that must not be confused:

| Aspect | Physical Drivers | Spectral Targets |
|--------|------------------|------------------|
| **What** | Hardware LED channels | What the plants receive |
| **How many** | 4 (CW, WW, BL, RD) | 4+ (Blue, Red, Green, Far-Red) |
| **Source** | Device firmware/control | Grow recipes / research data |
| **Usage** | Direct device commands | Optimization targets |
| **Relationship** | Drivers are adjusted to ACHIEVE spectra | Spectra are the GOAL |

---

## Physical Drivers (Hardware Layer)

There are exactly **4 light driver channels**:

### 1. CW (Cool White)
- **Spectrum**: 5000K+ Correlated Color Temperature
- **Wavelength range**: Broad, 380-760nm (full PAR)
- **Energy peak**: ~450nm and ~600nm (dual phosphor peaks)
- **Role**: Baseline white spectrum; provides broad illumination
- **Typical use**: Mix with others to achieve desired color temperature

### 2. WW (Warm White)
- **Spectrum**: 2700-3000K Correlated Color Temperature
- **Wavelength range**: Broad, 380-760nm (full PAR)
- **Energy peak**: ~450nm and ~750nm (warm phosphor peaks)
- **Role**: Warm baseline; creates naturalistic photoperiod feel
- **Typical use**: Extended photoperiods; late vegetative/finish

### 3. BL (Blue)
- **Spectrum**: ~400-500nm narrow-band direct LED
- **Wavelength peak**: ~450nm (royal blue)
- **Role**: Drives compact morphology, stomatal opening, transpiration
- **Typical use**: High in seedling/early veg; reduce for flowering

### 4. RD (Red)
- **Spectrum**: ~600-680nm narrow-band direct LED
- **Wavelength peak**: ~660nm (deep red)
- **Role**: Primary photosynthesis driver; affects stem stretch
- **Typical use**: High in vegetative and flowering; adjusted with BL ratio

---

## Spectral Targets (Grow Recipes)

Grow recipes (from `lighting-recipes.json`) specify **spectral targets** that the system should achieve:

### Recipe Fields (Spectral Targets)

Each recipe day contains:
```json
{
  "day": 1,
  "stage": "Seedling",
  "blue": 45.0,        // SPECTRAL: 400-500nm target
  "green": 5.0,        // SPECTRAL: 500-600nm target
  "red": 45.0,         // SPECTRAL: 600-700nm target
  "far_red": 0.0,      // SPECTRAL: 700-750nm target
  "ppfd": 120.0,       // Total intensity target
  "temperature": 20.0  // Environment target
}
```

### What "Green" Really Means

**Green is NOT a physical driver.** It's a **spectral band** (500-600nm) that emerges from the combination of:
- **CW/WW energy** in the 500-600nm range (phosphor peak)
- **BL spillover** from higher efficiency at longer wavelengths
- **RD tail** if red driver has 600nm component

### Why Green Matters

The 500-600nm band (green) has horticultural significance:
- **Penetrates deeper** into canopy than blue
- **Pre-harvest**: Green supplementation improves visual quality and chlorophyll retention
- **Pigment stability**: Green light helps maintain colour compounds
- **Shelf appeal**: Green-enriched crops look fresher longer

### Why Far-Red Matters

The 700-750nm band (far-red) drives phytochrome responses:
- **Phytochrome signaling**: Controls plant height, leaf expansion, flowering
- **Red:Far-Red ratio**: Affects canopy architecture and shading response
- **Strategic use**: Far-red helps suppress unwanted stretch or encourage elongation

---

## Data Flow: Recipes → Drivers → SPD

### Current Flow (INCOMPLETE)

```
Grow Recipe (blue: 45, green: 5, red: 45, far_red: 0)
                ↓
     synthesizePlansFromRecipes()
                ↓
     Mix object: {bl: 45, gn: 5, rd: 45, fr: 0}
                ↓
     Groups V2 Plan Card (SHOWS ALL 6 VALUES)
                ↓
     Issue: No way to convert spectral targets → driver commands!
```

### Correct Flow (WHAT SHOULD HAPPEN)

```
Grow Recipe (blue: 45, green: 5, red: 45, far_red: 0) [SPECTRA]
                ↓
     MISSING: Spectral Target → Driver Conversion
     (Algorithm needed: blue/red/green/far_red → cw%/ww%/bl%/rd%)
                ↓
     Driver Commands: {cw: 35, ww: 30, bl: 50, rd: 25}
                ↓
     Groups V2 Plan Card (SHOWS 4 DRIVER SLIDERS)
                ↓
     Hardware Device (executes: CW=35%, WW=30%, BL=50%, RD=25%)
                ↓
     SPD Computation: Sum of 4 driver spectral curves
                ↓
     Spectragraph Display (SHOWS all 4 bands: blue, green, red, far-red)
```

---

## The Spectragraph Visualization

The spectragraph is **NOT just 4 sliders**. It's a computed SPD curve showing the actual light spectrum distribution.

### How It Works

1. **Input**: 4 driver percentages (cw%, ww%, bl%, rd%)
2. **Lookup**: For each driver, get its SPD curve from the SPD library
3. **Weight**: Multiply each driver curve by its percentage
4. **Sum**: Add all 4 weighted curves together
5. **Normalize**: Scale for display
6. **Render**: Show on spectrum canvas

### Why "Green" Shows Up

Even if you don't have a separate green driver, green appears in the spectragraph because:
- **CW at 500-600nm**: ~20-30% of total energy (phosphor green peak)
- **WW at 500-600nm**: ~15-25% of total energy (warm phosphor green tail)
- **BL spillover**: ~5-10% in 500-600nm range
- **Sum**: = Visible green band in the SPD

This is **correct and expected**. The spectragraph reflects physical reality.

---

## The Real Problem: Recipe → Driver Conversion is Missing

### Current Bug

The `synthesizePlansFromRecipes()` function in `server-charlie.js` (lines 7850-7900) **directly maps recipe fields to mix object**:

```javascript
mix: {
  cw: toNumber(row.cool_white) ?? 0,      // Recipe has cool_white? Use it. Otherwise 0.
  ww: toNumber(row.warm_white) ?? 0,      // Recipe has warm_white? Use it. Otherwise 0.
  bl: toNumber(row.blue) ?? 0,            // ❌ WRONG: Recipe.blue is spectral target, not driver
  gn: toNumber(row.green) ?? 0,           // ❌ WRONG: This is just copied as-is (no driver exists!)
  rd: toNumber(row.red) ?? 0,             // ❌ WRONG: Recipe.red is spectral target, not driver
  fr: toNumber(row.far_red) ?? 0,         // ❌ WRONG: No driver exists for this
}
```

### Why It Fails

1. **Recipes contain spectral targets**, not driver commands
2. **No driver exists for green or far-red** (they're computed emergent properties)
3. **The algorithm to convert spectral targets to driver commands is missing**
4. **UI displays 6 values** (bl, gn, rd, fr, cw, ww) but **only 4 are actual drivers**

### What Should Happen

Need an optimization algorithm that takes:
- **Input**: Spectral targets (blue%, red%, green%, far_red%)
- **Output**: Driver commands (cw%, ww%, bl%, rd%)

Example:
```
Input: blue: 45, red: 45, green: 5, far_red: 0
↓
Algorithm (unknown - needs implementation!)
↓
Output: cw: 35, ww: 30, bl: 50, rd: 25
```

---

## Why Green Isn't Displaying Currently

### The Display Flow

1. **Plan Card loads recipe plan**
2. **getPlanDayData() extracts values** from `mix: {bl: 45, gn: 5, rd: 45, fr: 0}`
3. **HTML template shows all 6 values** (CW: 0, WW: 0, BL: 45, GN: 5, RD: 45, FR: 0)
4. **Problem**: Values of 0 for CW/WW suggest the conversion is completely missing
5. **Spectragraph shows**: Whatever SPD emerges from CW:0, WW:0, BL:45, RD:45
   - With no white light, green band would be almost invisible
   - The spectrum would look very saturated (pure blue + pure red = magenta-ish)

### Why This Is Wrong

The recipe values should **never be displayed directly as driver percentages**. They need to be converted first.

---

## Recommendations

### Immediate Fix (UI Display)

1. **Don't display recipe spectral targets as driver percentages**
2. **Either**:
   - a) Implement the spectral target → driver conversion algorithm
   - b) OR store both in plans.json (spectral targets in metadata, driver commands in mix)

### Medium-term Fix (Architecture)

1. **Create a conversion algorithm** that takes spectral targets and produces driver commands
   - Consider physics of SPD curves
   - Consider device calibration
   - Consider optimization criteria (efficiency vs. spectrum match)

2. **Update synthesizePlansFromRecipes()** to use this algorithm

3. **Store metadata** about spectral targets separately (e.g., in plan.meta.spectra)

### Long-term Fix (Full Integration)

1. **Implement a research-driven optimization** that:
   - Takes desired spectral targets
   - Considers device SPD library
   - Considers efficiency/power constraints
   - Recommends driver mix

2. **E.V.I.E. AI layer** should have this logic built-in

---

## Summary: Four Drivers, Four Spectral Bands (Emergent)

| Driver | Physical | Spectral Band | Emergent From |
|--------|----------|----------------|----------------|
| CW | Yes | Broad (380-760) | Direct |
| WW | Yes | Broad (380-760) | Direct |
| BL | Yes | Blue (400-500) | Direct |
| RD | Yes | Red (600-680) | Direct |
| --- | --- | --- | --- |
| GREEN (500-600) | No | Emergent | CW/WW + BL spillover |
| FAR-RED (700-750) | No | Emergent | RD tail + CW/WW tail |

---

## Files Involved

- **Server**: `server-charlie.js` line 7850-7900 (`synthesizePlansFromRecipes`)
- **Frontend**: `public/groups-v2.js` (`derivePlanRuntime`, `getPlanDayData`, `updatePlanCardForDay`)
- **Frontend**: `public/app.charlie.js` (`computeWeightedSPD`, `DRIVER_CHANNEL_KEYS`)
- **Data**: `public/data/lighting-recipes.json` (spectral targets)
- **Data**: `public/data/plans.json` (driver commands - manual)
- **SPD Lib**: Loaded dynamically, defines curves for each driver channel

---

## Status

✅ **Architecture clarified**  
❌ **Spectral target → driver conversion: NOT YET IMPLEMENTED**  
❌ **Green display: DEPENDS ON ABOVE**  
⚠️ **Current state: Hybrid/broken (mixing spectral targets and driver commands)**
