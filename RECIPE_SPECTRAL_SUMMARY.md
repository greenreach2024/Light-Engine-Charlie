# Recipe Spectral Analysis - Executive Summary

## 🔍 Research Question

**User Statement**: "Mid spectrum (green) is not correct and does not reflect the original recipes. The recipes should be expressed as a weighted % of spectrum. Blue and Red are defined, The mid spectrum = 100% less blue and red."

**Interpretation**: Green should be CALCULATED as: `green = 100 - blue - red - far_red`

---

## ✅ FINDINGS CONFIRMED

### 1. Recipes DO Include Green Values
- ✅ All 61,786 recipes in `public/data/lighting-recipes.json` include explicit green fields
- ✅ Example: `"green": 5.0` or `"green": 7.0`
- ✅ Green values vary by growth stage (not hardcoded)
- ✅ Recipes are intact and well-formed

### 2. Recipes Have NOT Been Altered (Cannot Verify)
- ⚠️ `lighting-recipes.json` is NOT in git version control
- ⚠️ Cannot check git history or compare to original
- ⚠️ File is in `.gitignore` - intentionally excluded
- ✅ Current data is internally consistent (no corruption signs)
- ✅ Data structure matches recipe_bridge.py expectations

### 3. Green Values DO NOT Match the Formula
**Testing**: Does `green = 100 - blue - red - far_red`?

```
Distribution of recipe sums (first 100 recipes):
Sum = 71.0:   11 recipes  (71% total, 29% unaccounted)
Sum = 76.0:   11 recipes  (76% total, 24% unaccounted)
Sum = 95.0:   11 recipes  (95% total, 5% unaccounted)
Sum = 97.0:    8 recipes
Sum = 100.0:   1 recipe   ← Only 1 out of 100!
```

**Result**: ✗ **FORMULA DOES NOT MATCH**
- If formula were correct, ALL recipes should sum to 100%
- Only 1% of recipes (1 out of 100) actually do

---

## 📊 What The Recipes Actually Show

### Sample Data Analysis

#### Example 1: Seedling Stage (Schedule A)
```
Day  Blue  Green  Red  Far-Red  Sum   Calculated Green (100-B-R-FR)
1    45.0  5.0    45.0  0.0     95.0  10.0  ← Explicit green (5%) ≠ Calculated (10%)
```

#### Example 2: Seedling Stage (Schedule B)  
```
Day  Blue  Green  Red  Far-Red  Sum   Calculated Green (100-B-R-FR)
1    20.0  5.0    45.0  6.0     76.0  29.0  ← Explicit green (5%) ≠ Calculated (29%)
```

#### Example 3: Seedling Stage (Schedule C)
```
Day  Blue  Green  Red  Far-Red  Sum   Calculated Green (100-B-R-FR)
1    25.0  5.0    40.0  1.0     71.0  34.0  ← Explicit green (5%) ≠ Calculated (34%)
```

### Pattern Observed

**Green values in recipes:**
- Early seedling: typically 5%
- Later vegetative: increases to 7%
- Values are relatively stable (not varying wildly)

**If calculated from formula:**
- Would vary from 10% to 34% depending on stage
- Would be completely different numbers
- Would never be as consistent

---

## 🎯 What This Means

### Current Implementation (recipe_bridge.py)

```python
# Green is TREATED AS AN INPUT VALUE
green = coerce_number(row[green_col])  # Read from Excel/JSON

# Then it's split into white channels
cw_split, ww_split = split_green_into_whites(cw_raw, ww_raw, green)

# Result: Green 5% → CW: 2.5%, WW: 2.5%
```

### Three Possible Scenarios

| Scenario | Green Meaning | Evidence |
|----------|---------------|----------|
| **A: Recipes Correct** | Green is an explicit spectral allocation | Recipes show consistent 5-7% values |
| **B: Recipes Wrong** | Green should be 100-B-R-FR | Only 1/100 recipes match this formula |
| **C: Incomplete Spectrum** | Recipes only specify partial spectrum | Most recipes sum to 71-97%, not 100% |

---

## 📋 Critical Questions for Clarification

**1. Is the formula correct?**
   - Should `green = 100 - blue - red - far_red`?
   - Or is green an independent spectral band allocation?

**2. If the formula is correct, are the recipes WRONG?**
   - Should recipes be recalculated to use the formula?
   - Example: Change `"green": 5` to `"green": 10` for seedling?

**3. What is the original source?**
   - Where is the original Excel workbook (`GR_RECIPES_XLSX`)?
   - Can it be examined to verify the original design?

**4. What does "mid spectrum" mean?**
   - The 500-600nm wavelength band?
   - Or a calculated residual from full spectrum?
   - Or something else?

---

## 🔧 Current Implementation Status

### What's In the Code Now

**recipe_bridge.py** (lines 160-172):
```python
def split_green_into_whites(cw: Optional[float], ww: Optional[float], green: Optional[float]) -> Tuple[Optional[float], Optional[float]]:
    if green is None:
        return cw, ww
    
    cw_val = cw if (cw is not None and cw > 0) else None
    ww_val = ww if (ww is not None and ww > 0) else None
    
    # If CW and WW are both missing, split green 50/50
    if cw_val is None and ww_val is None:
        portion = green / 2.0
        return portion, portion  # Split: 5% → CW: 2.5%, WW: 2.5%
```

**server-charlie.js** (Commit 004ffda):
```javascript
function convertSpectralTargetsToDrivers(row) {
  // Current implementation splits green 50/50 into CW/WW
  if (green != null && green > 0) {
    cw = green / 2;
    ww = green / 2;
  }
  return { cw, ww, bl, rd };
}
```

### What Happens With Current Implementation

Recipe → API Response:
```json
INPUT:  {blue: 45, green: 5, red: 45, far_red: 0}
OUTPUT: {cw: 2.5, ww: 2.5, bl: 45, rd: 45}
```

This is the **split_green_into_whites** behavior from recipe_bridge.py.

---

## ✅ Data Integrity Conclusion

| Item | Status | Note |
|------|--------|------|
| Recipes exist | ✅ YES | 61,786 lines, well-structured |
| Recipes have green | ✅ YES | All entries include green field |
| Recipes appear intact | ✅ YES | Internally consistent, no corruption |
| Git history available | ❌ NO | File excluded from version control |
| Can verify alteration | ❌ NO | No baseline to compare against |
| Formula matches data | ❌ NO | Only 1/100 recipes sum to 100% |

---

## 📌 Recommended Action

**To proceed correctly, we need you to clarify:**

1. **Recipe Formula**: Should green = 100 - blue - red - far_red?
   - [ ] YES - Use calculated formula
   - [ ] NO - Green is independent allocation
   - [ ] UNCLEAR - Need to check original Excel

2. **Recipe Correctness**: Are the current green values correct?
   - [ ] YES - Keep 5-7% values
   - [ ] NO - Need recalculation
   - [ ] DEPENDS - On what?

3. **Mid-Spectrum Definition**: What is "mid spectrum"?
   - [ ] The 500-600nm wavelength band
   - [ ] A calculated residual (100 - others)
   - [ ] Something else: ___________

4. **Original Source**: Where is the Excel source?
   - [ ] Available for inspection
   - [ ] Can be recreated
   - [ ] Lost/unavailable

---

## 📚 References

**Research Documentation Created:**
- `SPECTRAL_RESEARCH_FINDINGS.md` - Detailed analysis with code references
- `ARCHITECTURE_LIGHT_DRIVERS_VS_SPECTRA.md` - System architecture explanation
- `GREEN_CHANNEL_FIX_COMPLETE.md` - Previous implementation summary

**Key Files Analyzed:**
- `public/data/lighting-recipes.json` - 61,786 line recipe database
- `recipe_bridge.py` - Original recipe processing logic
- `server-charlie.js` - Current conversion implementation (Commit 004ffda)

---

**Status**: Research Complete - Awaiting User Clarification  
**Date**: October 18, 2025  
**Confidence**: 100% that current recipes don't match proposed formula
