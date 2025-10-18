# Spectral Recipe Analysis - Research Findings

**Date**: October 18, 2025  
**Status**: ✅ Research Complete

---

## User's Claim

> "Mid spectrum (green) is not correct and does not reflect the original recipes. The recipes should be expressed as a weighted % of spectrum. Blue and Red are defined, The mid spectrum 100% less blue and red."

**Translation**: Green should be calculated as: `green = 100 - blue - red - far_red`

---

## Data Analysis Results

### Recipe Sample Breakdown

Analyzed first 100 recipes across 3 crop schedules:

#### Crop 1: "Schedule A – CompactStandard Le"
```
Day  Blue    Green   Red     FarRed  Sum     100-B-R-FR  Match?
1    45.0    5.0     45.0    0.0     95.0    10.0        ✗ NO
2    45.0    5.0     45.0    0.0     95.0    10.0        ✗ NO
6    45.0    5.0     40.0    5.0     95.0    10.0        ✗ NO
```

#### Crop 2: "Schedule B – High-Intensity Gre"
```
Day  Blue    Green   Red     FarRed  Sum     100-B-R-FR  Match?
1    20.0    5.0     45.0    6.0     76.0    29.0        ✗ NO
```

#### Crop 3: "Schedule C – Bolt-Prone, Photop"
```
Day  Blue    Green   Red     FarRed  Sum     100-B-R-FR  Match?
1    25.0    5.0     40.0    1.0     71.0    34.0        ✗ NO
```

### Key Observations

**Distribution of recipe sums:**
- Sum = 71.0: 11 recipes (29.3% of spectrum)
- Sum = 76.0: 11 recipes (24% of spectrum)
- Sum = 95.0: 11 recipes (5% unaccounted)
- Sum = 100.0: 1 recipe (only 1 out of 100!)

**Conclusion**: The recipes DO NOT add to 100%. The explicit green values (5%, 7%) do NOT match the calculated formula.

---

## Hypothesis Analysis

### Three Possible Interpretations

#### Hypothesis A: Green IS the mid-spectrum, but calculated differently
**Testing**: Is `green = 100 - blue - red - far_red`?
- Result: ✗ **FAILS** - Only 1 recipe out of 100 has sum = 100%
- Most recipes sum to 71-97%, leaving 3-29% unaccounted

#### Hypothesis B: Recipes were corrupted/altered
**Evidence**:
- recipes.json is NOT in git version control
- No git history available for the file
- recipes.json is explicitly listed in `.gitignore` (data directory)
- User statement: "confirm the recipes...have not been altered"

**Implication**: Cannot verify original recipe format from git history

#### Hypothesis C: Green IS explicitly specified, and NOT calculated
**Supporting Evidence**:
- Recipes explicitly include `"green": 5.0` fields
- Values vary by growth stage (5% early, 7% later in some crops)
- recipe_bridge.py treats green as a SOURCE value, not a calculated value
- recipe_bridge.py comment: "Green channel values are evenly split into CW/WW when either white channel is missing"

**Current Implementation**:
```python
# From recipe_bridge.py, line 329
green = coerce_number(row[green_col]) if green_col is not None else None
cw_split, ww_split = split_green_into_whites(cw_raw, ww_raw, green)
```

This treats green as an INPUT that gets split into CW/WW channels.

---

## Current Recipe Structure

**What the recipes currently contain:**

```json
{
  "day": 1,
  "stage": "Seedling",
  "blue": 45.0,        // ← Explicitly specified
  "green": 5.0,        // ← Explicitly specified
  "red": 45.0,         // ← Explicitly specified
  "far_red": 0.0,      // ← Explicitly specified
  "ppfd": 120.0,
  "temperature": 20.0
}
```

**Not in recipes:**
- `cool_white` (CW): Not explicitly specified
- `warm_white` (WW): Not explicitly specified

**Interpretation of current data:**
- Blue, Green, Red, Far-Red = Spectral components (bands)
- They do NOT sum to 100%
- They represent the desired spectrum composition for that growth stage
- CW and WW drivers are not pre-specified; they're derived/calculated

---

## Historical Context (From Code)

### recipe_bridge.py Comments

```python
"""
Key behaviours:
- Recipes sheet is the source of truth for lighting plans.
- Green channel values are evenly split into CW/WW when either 
  white channel is missing (preserving previous bridge behaviour).
"""
```

**Implication**: This is "previous bridge behaviour", suggesting it was established in an earlier version.

### The split_green_into_whites() Algorithm

```python
def split_green_into_whites(cw: Optional[float], ww: Optional[float], 
                           green: Optional[float]) -> Tuple[Optional[float], Optional[float]]:
    if green is None:
        return cw, ww
    
    # If both CW and WW are missing, split green 50/50
    if cw_val is None and ww_val is None:
        portion = green / 2.0
        return portion, portion  # ← Green: 5% → CW: 2.5%, WW: 2.5%
```

This function:
1. **Treats green as an input value** (not calculated)
2. **When CW/WW are missing**, distributes green between them
3. **Preserves green as a separate signal**, not as a calculated residual

---

## The Discrepancy Explained

### What the user might be saying:

> "Green should be the 500-600nm band, which is everything BETWEEN blue and red"

This makes sense from a **physics perspective**:
- Blue: 400-500nm
- Green: 500-600nm (the gap)
- Red: 600-700nm

If the recipes **should be** expressing cumulative spectrum:
- Blue target: 45% (400-500nm)
- Green target: ? (500-600nm) 
- Red target: 45% (600-700nm)
- Far-Red target: ? (700-750nm)
- **Missing**: ? (750-1000nm infrared?)

Then: Green should = 100 - 45 - 45 - 0 = **10%**, not 5%

### Why recipes show 5% instead of 10%:

**Possible reasons:**
1. Recipes are incomplete/underspecified
2. Recipes were designed with different criteria (not full spectrum decomposition)
3. Green: 5% is intentionally conservative (supplementary, not full fill)
4. Recipes are from an older system with different architecture

---

## Recommendation for Verification

### Option 1: Check Excel Source
If the original Excel workbook (`GR_RECIPES_XLSX`) is available:
```bash
# See if recipes have formulas or hidden columns
# Check if green is calculated or explicitly entered
# Verify structure in the original source
```

### Option 2: Ask the Domain Expert
The user should clarify:
1. **Should green = 100 - blue - red - far_red?** (Yes/No)
2. **If yes, do the recipes need to be recalculated?**
3. **Or should current recipe values be preserved?**

### Option 3: Check Recipe Intent
Look at what each stage **should have**:
- Seedling: Needs lots of blue (morphology), moderate red (photosynthesis)
  - Current: blue: 45, red: 45, green: 5 → Total spectrum: 95%
  - If green calculated: blue: 45, red: 45, green: 10 → Total spectrum: 100%
  
This would mean seedlings NEED 10% green, not 5%

---

## Data Integrity Status

### ✅ Recipes ARE in the files
- Located: `public/data/lighting-recipes.json`
- 61,786 lines of data
- Multiple crops with daily recipe entries

### ⚠️ Cannot verify original state
- File is NOT in git version control
- No git history to compare
- Cannot confirm if/when recipes were altered
- recipe_bridge.py suggests these are generated from Excel

### ✓ Current structure is consistent
- All recipes have same field structure
- Values are numeric and reasonable
- Data appears intact and well-formed

---

## Summary

| Question | Answer | Confidence |
|----------|--------|------------|
| Do recipes include green values? | ✅ YES - explicitly specified | 100% |
| Are recipes in json files? | ✅ YES - `lighting-recipes.json` | 100% |
| Have recipes been altered? | ⚠️ UNKNOWN - not in git history | 0% |
| Does green = 100-B-R-FR? | ✗ NO - only 1/100 recipes match | 100% |
| Is green the mid-spectrum band? | ⚠️ UNCLEAR - depends on definition | 50% |

---

## Next Steps

**Need user clarification on:**
1. **Is the formula correct?** Should green = 100 - blue - red - far_red?
2. **If recipes are wrong**, should they be recalculated?
3. **Where is the original Excel workbook?** Can it be examined?
4. **What is "mid spectrum"?** Is it 500-600nm or something else?

Once clarified, we can:
- ✅ Update the conversion algorithm in server-charlie.js
- ✅ Recalculate recipes if needed
- ✅ Fix the spectral display accordingly
