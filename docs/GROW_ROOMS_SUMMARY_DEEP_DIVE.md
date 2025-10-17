# Grow Rooms Summary Deep Dive - October 17, 2025

## Problem Statement

**User Reports**:
- Grow Rooms summary shows: "Zones: Zone 1, Controls: 0, Lights: 0"
- Equipment is missing from the summary
- "None of this should be listed" - user wants to see equipment instead

## Root Cause Analysis

### Issue 1: Equipment Data Not Displayed
**Problem**: `renderRooms()` function doesn't show equipment  
**Location**: `public/app.charlie.js` lines 9629-9720

**Current code**:
```javascript
function renderRooms() {
  // ...
  const zones = (r.zones || []).map(z => escapeHtml(z)).join(', ') || '—';
  const controlCount = Array.isArray(r.controllers) ? r.controllers.length : (r.controlMethod ? 1 : 0);
  // Lights from STATE.lightSetups
  // ...
  return `<div class="card">
    <div class="tiny" style="color:#475569">Zones: ${zones}</div>
    <div class="tiny" style="color:#475569">Controls: ${controlCount}</div>
    <div class="tiny" style="color:#475569">Lights: ${numLights}</div>
    <div class="tiny" style="color:#475569">${lightsList}</div>
    <!-- NO EQUIPMENT LINE -->
  </div>`;
}
```

**Comparison**: Farm Wizard rendering (lines 4303-4325) **DOES** include equipment:
```javascript
// Equipment summary (if present)
let equipmentList = '—';
if (Array.isArray(room.equipment) && room.equipment.length) {
  const eqMap = {};
  room.equipment.forEach(eq => {
    const key = eq.category || eq.type || eq.name || 'Equipment';
    if (!eqMap[key]) eqMap[key] = 0;
    eqMap[key] += Number(eq.count)||1;
  });
  equipmentList = Object.entries(eqMap).map(([k,v]) => `${escapeHtml(k)} ×${v}`).join(', ');
}
// ...
<div class="tiny"><b>Equipment:</b> ${equipmentList}</div>
```

### Issue 2: Equipment Data Structure Mismatch
**Problem**: Equipment is stored in a different location than expected

**Actual data structure** (from `rooms.json`):
```json
{
  "rooms": [{
    "id": "room-ue2cer",
    "name": "GreenReach",
    "zones": ["Zone 1"],
    "hardwareCats": ["dehumidifier"],
    "category": {
      "dehumidifier": {
        "selectedEquipment": [{
          "category": "dehumidifier",
          "vendor": "Quest",
          "model": "Quest Dual 155",
          "capacity": "155 pints/day",
          "control": "WiFi",
          "count": 1
        }]
      }
    },
    "_categoryProgress": {
      "2": {
        "selectedEquipment": [...]
      }
    }
  }]
}
```

**Expected by render code**: `room.equipment` (flat array)  
**Actual location**: `room.category[catName].selectedEquipment` (nested by category)

### Issue 3: Showing Irrelevant Data
**User expectation**: Only show equipment  
**Current behavior**: Shows zones, controls, lights (all showing 0 or default values)

**Why zeros?**:
- **Zones**: Shows "Zone 1" (exists, but user doesn't want to see it)
- **Controls**: Shows 0 because `r.controllers` is empty and `r.controlMethod` is null
- **Lights**: Shows 0 because no light setups exist in `STATE.lightSetups` for this room

## Solution Design

### Fix 1: Extract Equipment from Nested Structure
Create a helper function to aggregate equipment from `room.category`:

```javascript
function extractRoomEquipment(room) {
  const equipment = [];
  if (room.category && typeof room.category === 'object') {
    Object.values(room.category).forEach(cat => {
      if (Array.isArray(cat.selectedEquipment)) {
        equipment.push(...cat.selectedEquipment);
      }
    });
  }
  return equipment;
}
```

### Fix 2: Update renderRooms() to Show Equipment
Replace zones/controls/lights with equipment-focused summary:

**Before**:
```javascript
<div class="tiny" style="color:#475569">Zones: ${zones}</div>
<div class="tiny" style="color:#475569">Controls: ${controlCount}</div>
<div class="tiny" style="color:#475569">Lights: ${numLights}</div>
<div class="tiny" style="color:#475569">${lightsList}</div>
```

**After**:
```javascript
<div class="tiny" style="color:#475569"><b>Equipment:</b> ${equipmentSummary}</div>
<div class="tiny" style="color:#475569"><b>Zones:</b> ${zoneCount} zone${zoneCount !== 1 ? 's' : ''}</div>
```

### Fix 3: Format Equipment Summary Properly
Group by category and show counts:

```javascript
// Equipment summary
let equipmentSummary = '—';
const equipment = extractRoomEquipment(r);
if (equipment.length) {
  const eqMap = {};
  equipment.forEach(eq => {
    const key = `${eq.vendor || ''} ${eq.model || eq.name || eq.category || 'Equipment'}`.trim();
    if (!eqMap[key]) eqMap[key] = 0;
    eqMap[key] += Number(eq.count) || 1;
  });
  equipmentSummary = Object.entries(eqMap)
    .map(([k, v]) => `${escapeHtml(k)} ×${v}`)
    .join(', ');
}
```

## Expected Result

**Before Fix**:
```
GreenReach
Zones: Zone 1
Controls: 0
Lights: 0
—
```

**After Fix**:
```
GreenReach
Equipment: Quest Quest Dual 155 ×1
Zones: 1 zone
```

## Implementation Plan

1. **Add helper function** `extractRoomEquipment()` before `renderRooms()`
2. **Update `renderRooms()`**:
   - Extract equipment using helper
   - Build equipment summary string
   - Replace detailed zones/controls/lights with:
     - Equipment list (primary)
     - Zone count (secondary)
3. **Test**:
   - Verify equipment shows for existing room
   - Verify "—" shows when no equipment
   - Verify zone count is accurate

## Files to Modify

### `/Users/petergilbert/Light-Engine-Charlie/public/app.charlie.js`

**Lines 9629-9680**: Update `renderRooms()` function

## Testing Checklist

- [ ] Equipment displays: "Quest Quest Dual 155 ×1"
- [ ] Zone count displays: "1 zone"
- [ ] No "Controls: 0" or "Lights: 0" shown
- [ ] Edit/Delete buttons still work
- [ ] New rooms without equipment show "—"

## Architecture Notes

### Why Equipment is Nested
Equipment is organized by category because the Room Wizard collects it step-by-step:
- Step 1: Select hardware categories (dehumidifier, hvac, fans, etc.)
- Step 2-N: For each category, search and select specific equipment
- Result: `category[catName].selectedEquipment[]`

This structure allows:
- Category-specific forms (dehumidifier search vs. fan selection)
- Progress tracking per category
- Easy filtering by equipment type

### Why Farm Wizard Shows Equipment Correctly
The Farm Wizard's `renderRoomsInReview()` (lines 4303-4325) expects `room.equipment` as a flat array. This works because **it's a different data structure** - the wizard may be building a simplified preview, or the data gets flattened at some point.

The Grow Rooms panel's `renderRooms()` should extract from the **actual saved structure** in `rooms.json`.

---

**Bottom line**: The summary page CAN be fixed. It just needs to read equipment from the correct nested location (`room.category[...].selectedEquipment`) instead of expecting a flat `room.equipment` array.
