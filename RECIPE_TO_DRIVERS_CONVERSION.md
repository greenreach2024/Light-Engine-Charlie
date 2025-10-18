# Recipe to 4-Channel Driver Conversion Algorithm

## Overview

This document explains how Light Engine Charlie converts **spectral recipes (R/B/G format)** to **hardware driver commands (CW/WW/BL/RD format)** for 4-channel grow lights.

## The Algorithm

### Step 1: Normalize Recipe Inputs

Recipes specify **Red (R)**, **Blue (B)**, and **Green (G)** as control percentages that **do NOT need to sum to 100%**.

```
Input:
  R_in, B_in, G_in (percentages, 0–100)

Normalize:
  T = R_in + B_in + G_in
  R = R_in / T
  B = B_in / T
  G = G_in / T
  
Result: R, B, G now sum to 1.0 (0–100% share)
```

**Why normalization?**
- Recipes may specify uneven totals (e.g., 35+25+40 = 100, or 45+45+5 = 95)
- Normalization ensures consistent behavior regardless of input sum
- Handles missing channels gracefully

### Step 2: Split "Green" into White Drivers

"Green" in the recipe represents the **mid-band (500–600 nm)**, which we create by blending **Warm White (WW)** and **Cool White (CW)** drivers using a **warm bias** parameter.

```
warm_bias ∈ [0, 1]
  0.00 = all cool white (5000K+, bluish)
  0.50 = even split (default)
  1.00 = all warm white (2700K, reddish)

Split Green:
  WW_norm = G × warm_bias
  CW_norm = G × (1 − warm_bias)
```

**Example with warm_bias = 0.60:**
```
G = 0.40 (40% green control)
WW_norm = 0.40 × 0.60 = 0.24
CW_norm = 0.40 × 0.40 = 0.16
```

### Step 3: Preserve Red and Blue Directly

Red and Blue channels pass through unchanged (they map 1:1 to physical drivers).

```
Red_norm = R
Blue_norm = B
```

### Step 4: Apply Intensity Scaling

Convert normalized values (0–1) to final percentage (0–100) using an intensity scale factor.

**Option A: Brightness-Based Scaling**
```
Scale = brightness (0–1)
Simple: "run the light at 80% full power"

CW_out = CW_norm × brightness × 100
WW_out = WW_norm × brightness × 100
BL_out = Blue_norm × brightness × 100
RD_out = Red_norm × brightness × 100
```

**Option B: PPFD-Based Scaling** (Recommended for plants)
```
Scale = target_PPFD / expected_PPFD_at_100%

expected_PPFD_at_100% = 
  (CW_norm × η_cw) + 
  (WW_norm × η_ww) + 
  (Blue_norm × η_bl) + 
  (Red_norm × η_rd)

where η_* = per-channel PPFD output efficiency (µmol/s per 1% power)

Examples:
  η_cw = 1.2  (cool white: broad spectrum, ~1.2 µmol/s at 1%)
  η_ww = 1.1  (warm white: slightly lower efficiency)
  η_bl = 1.8  (blue: narrow-band, more photons per watt)
  η_rd = 1.6  (red: narrow-band, more photons per watt)

Scale = clamp(PPFD_target / expected, 0, 1)
```

### Step 5: Compute Final Channel Values

```
CW_out = clamp(CW_norm × scale × 100, 0, 100)
WW_out = clamp(WW_norm × scale × 100, 0, 100)
BL_out = clamp(Blue_norm × scale × 100, 0, 100)
RD_out = clamp(Red_norm × scale × 100, 0, 100)
```

### Step 6: Output to Hardware

Convert to device-specific control format:

**As Percentages (0–100):**
```
{
  cw: 12.8,
  ww: 19.2,
  bl: 20.0,
  rd: 28.0
}
```

**As 8-bit (0–255) for direct PWM:**
```
cw_byte = round(255 × 0.128) = 33  → 0x21
ww_byte = round(255 × 0.192) = 49  → 0x31
bl_byte = round(255 × 0.200) = 51  → 0x33
rd_byte = round(255 × 0.280) = 71  → 0x47
```

**Packed Hex (per controller order):**
```
Hex payload: [CW][WW][BL][RD][00][00]
Example: 213133470000
```

## Worked Example

**Input Recipe:**
- Red: 35%
- Blue: 25%
- Green: 40%
- Brightness: 0.80 (80% power)
- Warm Bias: 0.60 (warmer mid-band)

**Step 1: Normalize**
```
T = 35 + 25 + 40 = 100
R = 35/100 = 0.35
B = 25/100 = 0.25
G = 40/100 = 0.40
```

**Step 2: Split Green**
```
WW_norm = 0.40 × 0.60 = 0.24
CW_norm = 0.40 × 0.40 = 0.16
```

**Step 3: Preserve Red/Blue**
```
Red_norm = 0.35
Blue_norm = 0.25
```

**Step 4: Scale (brightness = 0.80)**
```
CW_out = 0.16 × 0.80 × 100 = 12.8%
WW_out = 0.24 × 0.80 × 100 = 19.2%
BL_out = 0.25 × 0.80 × 100 = 20.0%
RD_out = 0.35 × 0.80 × 100 = 28.0%
```

**Output:**
```json
{
  "cw": 12.8,
  "ww": 19.2,
  "bl": 20.0,
  "rd": 28.0
}
```

**As Hex (0–255):**
- CW: 33 (0x21)
- WW: 49 (0x31)
- BL: 51 (0x33)
- RD: 71 (0x47)
- Payload: `213133470000`

## Implementation in Node.js

**Location:** `server-charlie.js`, function `convertRecipeToChannelMix()` (lines 7853–7924)

```javascript
function convertRecipeToChannelMix(row, opts = {}) {
  const toNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const clamp = (v, min = 0, max = 100) => 
    Math.max(min, Math.min(max, Number(v) || 0));
  
  // Step 1: Normalize
  const r_in = toNumber(row.red) ?? 0;
  const b_in = toNumber(row.blue) ?? 0;
  const g_in = toNumber(row.green) ?? 0;
  
  const total = r_in + b_in + g_in;
  if (total === 0) return { cw: 0, ww: 0, bl: 0, gn: 0, rd: 0, fr: 0 };
  
  const r = r_in / total;
  const b = b_in / total;
  const g = g_in / total;
  
  // Step 2: Split Green
  const warmBias = opts.warmBias ?? 0.50;
  const ww_norm = g * warmBias;
  const cw_norm = g * (1 - warmBias);
  
  // Step 3: Preserve Red/Blue
  const red_norm = r;
  const blue_norm = b;
  
  // Step 4: Calculate scale factor
  let scale = 1.0;
  if (opts.ppfd != null && opts.ppfdEfficiency != null) {
    const eff = opts.ppfdEfficiency;
    const totalEfficiency = 
      (cw_norm * (eff.cw ?? 1)) + 
      (ww_norm * (eff.ww ?? 1)) + 
      (blue_norm * (eff.bl ?? 1)) + 
      (red_norm * (eff.rd ?? 1));
    if (totalEfficiency > 0) {
      scale = opts.ppfd / (totalEfficiency * 100);
      scale = Math.min(1.0, scale);
    }
  } else if (opts.brightness != null) {
    scale = opts.brightness;
  }
  
  // Step 5: Scale outputs
  const cw_out = clamp(cw_norm * scale * 100);
  const ww_out = clamp(ww_norm * scale * 100);
  const bl_out = clamp(blue_norm * scale * 100);
  const rd_out = clamp(red_norm * scale * 100);
  
  // Step 6: Return
  return {
    cw: cw_out,
    ww: ww_out,
    bl: bl_out,
    gn: clamp(toNumber(row.green) ?? 0),    // Preserve for reference
    rd: rd_out,
    fr: clamp(toNumber(row.far_red) ?? 0),  // Preserve for reference
  };
}
```

## Usage in Plan Synthesis

When converting recipes to plans, call with appropriate options:

```javascript
const mix = convertRecipeToChannelMix(row, {
  ppfd: toNumber(row.ppfd),
  ppfdEfficiency: {
    cw: 1.2,   // µmol/s per 1% power
    ww: 1.1,
    bl: 1.8,
    rd: 1.6,
  },
  warmBias: 0.50,  // 50% WW, 50% CW for mid-band
});
```

## Time-of-Day Tint (Optional Enhancement)

For sunrise/sunset transitions, dynamically adjust `warmBias`:

```javascript
function getWarmBias(hourOfDay) {
  // Sunrise (6-8 AM): warmer (0.60–0.70)
  // Midday (10 AM–4 PM): cooler (0.40–0.45)
  // Sunset (5-7 PM): warmer (0.60–0.70)
  
  if (hourOfDay < 8) return 0.65;    // Sunrise warmth
  if (hourOfDay < 10) return 0.55;   // Transition in
  if (hourOfDay < 16) return 0.45;   // Cooler midday
  if (hourOfDay < 17) return 0.55;   // Transition out
  return 0.65;                        // Sunset warmth
}

// Usage:
const warmBias = getWarmBias(new Date().getHours());
const mix = convertRecipeToChannelMix(row, { 
  ppfd: row.ppfd, 
  warmBias 
});
```

## PPFD Efficiency Calibration

Different light fixtures have different efficiencies. To calibrate:

1. **Measure at 100% power** for each channel individually
   ```
   PPFD_cw_100% = 120 µmol/m²/s
   PPFD_ww_100% = 110 µmol/m²/s
   PPFD_bl_100% = 180 µmol/m²/s
   PPFD_rd_100% = 160 µmol/m²/s
   ```

2. **Calculate per-% efficiency** (divide by 100)
   ```
   η_cw = 120 / 100 = 1.2
   η_ww = 110 / 100 = 1.1
   η_bl = 180 / 100 = 1.8
   η_rd = 160 / 100 = 1.6
   ```

3. **Use in options**
   ```javascript
   ppfdEfficiency: { cw: 1.2, ww: 1.1, bl: 1.8, rd: 1.6 }
   ```

## Key Insights

✅ **Normalization handles variable recipe sums** – No need to force R+B+G=100%

✅ **Green is a control knob, not a physical channel** – It steers the white mix (CW/WW)

✅ **Scale factor hits intensity targets** – Use PPFD for plants, brightness for aesthetics

✅ **Spectral shape preserved** – Scaling doesn't change R:B ratio, only intensity

❌ **Output won't sum to 100%** – That's normal! Green is allocated to whites, not separate

❌ **Can't exceed 100% power** – If target PPFD unachievable, light runs at full power

## FAQ

**Q: Why doesn't my recipe sum to 100%?**
A: Because R, B, and G are normalized independently, not allocated from a fixed pool. Normalization ensures consistent behavior regardless of input sum.

**Q: Where does "Green" go in the output?**
A: Green is split 50/50 (or per warm_bias) into WW and CW. The output doesn't have a separate "Green" channel—it's embedded in the white mix.

**Q: How do I set a target PPFD?**
A: Pass `ppfd: 300` and `ppfdEfficiency: {...}` in opts. The function calculates scale to hit that target.

**Q: Can I just use brightness scaling?**
A: Yes, for manual control. Pass `brightness: 0.80` for 80% power. Plants prefer PPFD targets for consistency across different fixtures.

**Q: How do I adjust the color temperature?**
A: Change `warmBias` (0 = cool/blue, 1 = warm/red). Default 0.5 = neutral.

## References

- **Section 2, Recipe → Driver Mapping**: User's specification above
- **Horticultural Context**: PPFD (photosynthetic photon flux density) measured in µmol/m²/s
- **Hardware**: 4-channel driver architecture (CW, WW, BL, RD)
- **Calibration**: Per-fixture measurement required for accurate PPFD targeting
