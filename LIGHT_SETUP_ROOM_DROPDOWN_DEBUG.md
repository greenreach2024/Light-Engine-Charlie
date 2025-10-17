# Light Setup Room Dropdown Debugging - October 17, 2025

## Issue Report
User reports: Light Setup Wizard "Select Room" dropdown is not pulling the room created in Grow Rooms setup.

## Investigation

### Data Flow Verification ✅

**rooms.json contains the room:**
```json
{
  "rooms": [
    {
      "id": "room-ue2cer",
      "name": "GreenReach",
      "zones": ["Zone 1"],
      "category": {
        "dehumidifier": {
          "selectedEquipment": [...]
        }
      }
    }
  ]
}
```

**STATE.rooms loading:**
- File: `public/app.charlie.js` line 9273
- Function: `loadAllData()`
- Code: `STATE.rooms = rooms?.rooms || [];`
- Called: During `DOMContentLoaded` async initialization

**Dropdown population:**
- File: `public/app.charlie.js` line ~13907
- Function: `setupRoomZoneDropdowns()` → `refreshRoomsAndZones()`
- Called: When wizard opens via `freshLightWizard.open()`
- Logic: `collectRoomsFromState()` returns `STATE.rooms`

## Diagnostic Logging Added

### 1. STATE.rooms Load Confirmation (line 9273)
```javascript
STATE.rooms = rooms?.rooms || [];
console.log('✅ [loadAllData] Loaded STATE.rooms:', STATE.rooms.length, 'rooms');
if (STATE.rooms.length > 0) {
  console.log('   Room details:', STATE.rooms.map(r => `${r.name} (id: ${r.id})`).join(', '));
}
```

**Expected Output:**
```
✅ [loadAllData] Loaded STATE.rooms: 1 rooms
   Room details: GreenReach (id: room-ue2cer)
```

### 2. Dropdown Population Debugging (line ~13908)
```javascript
const refreshRoomsAndZones = (selectedRoomId, selectedZone) => {
  const rooms = collectRoomsFromState();
  console.log('[FreshLightWizard] refreshRoomsAndZones called, rooms count:', rooms.length);
  console.log('[FreshLightWizard] STATE.rooms:', STATE.rooms);
  console.log('[FreshLightWizard] Collected rooms:', rooms);
  if (!rooms.length) {
    console.warn('[FreshLightWizard] No rooms found! STATE.rooms length:', STATE.rooms?.length);
    // ... show empty state
  }
```

**Expected Output (when opening wizard):**
```
[FreshLightWizard] refreshRoomsAndZones called, rooms count: 1
[FreshLightWizard] STATE.rooms: [{id: "room-ue2cer", name: "GreenReach", ...}]
[FreshLightWizard] Collected rooms: [{id: "room-ue2cer", name: "GreenReach", ...}]
[FreshLightWizard] Dropdown populated with 1 rooms: GreenReach
```

## Testing Steps

1. **Refresh Browser**
   - Go to `http://localhost:8091`
   - Open browser DevTools Console (Cmd+Option+I on Mac)

2. **Check Initial Load**
   - Look for: `✅ [loadAllData] Loaded STATE.rooms: 1 rooms`
   - Should show: `Room details: GreenReach (id: room-ue2cer)`
   - **If missing**: rooms.json not loading properly

3. **Open Light Setup Wizard**
   - Click "Light Setup" in sidebar
   - Click "New Light Setup" button
   - Modal opens

4. **Check Dropdown Population**
   - Look for: `[FreshLightWizard] refreshRoomsAndZones called, rooms count: 1`
   - Should show: `Collected rooms:` with GreenReach object
   - Should show: `Dropdown populated with 1 rooms: GreenReach`
   - **If count is 0**: Timing issue or STATE.rooms not persisting

5. **Verify Dropdown**
   - Room dropdown should show "GreenReach" as an option
   - Select "GreenReach"
   - Zone dropdown should populate with "Zone 1"

## Possible Issues & Solutions

### Issue 1: Timing Problem
**Symptom**: STATE.rooms is empty when wizard opens
**Cause**: Wizard opens before loadAllData() completes
**Solution**: loadAllData() is awaited in DOMContentLoaded, but wizard is initialized synchronously

**Fix**: Ensure wizard doesn't open until STATE.rooms is loaded:
```javascript
// In open() method, add check:
if (!STATE.rooms || STATE.rooms.length === 0) {
  console.warn('[FreshLightWizard] STATE.rooms not loaded yet, retrying...');
  setTimeout(() => this.open(), 500);
  return;
}
```

### Issue 2: STATE.rooms Overwritten
**Symptom**: STATE.rooms loads correctly but is empty when wizard opens
**Cause**: Another function clears or reassigns STATE.rooms
**Solution**: Check console logs for any STATE.rooms manipulation between load and wizard open

### Issue 3: Dropdown Not Refreshing
**Symptom**: STATE.rooms has data but dropdown shows "No rooms found"
**Cause**: refreshRoomsAndZones() not called or called with stale reference
**Solution**: Already fixed - open() method calls refreshRoomsAndZones()

### Issue 4: rooms.json Not Saved Properly
**Symptom**: Browser shows old/empty rooms.json
**Cause**: Room saved to STATE but not persisted to file
**Solution**: Verify Grow Room wizard saves via POST /data/rooms.json

## Code References

### loadAllData() - Initial Load
**Location**: `public/app.charlie.js` line 9175
**Purpose**: Loads all JSON data files including rooms.json
**Called**: During DOMContentLoaded async block (line ~15850)

### collectRoomsFromState() - Data Source
**Location**: `public/app.charlie.js` line ~13900
**Purpose**: Returns STATE.rooms array
**Logic**: `return Array.isArray(STATE.rooms) ? STATE.rooms : [];`

### refreshRoomsAndZones() - Dropdown Population
**Location**: `public/app.charlie.js` line ~13908
**Purpose**: Populates room and zone dropdowns
**Called**: From setupRoomZoneDropdowns() and freshLightWizard.open()

### freshLightWizard.open() - Wizard Launch
**Location**: `public/app.charlie.js` line 14245
**Purpose**: Opens wizard modal and refreshes dropdowns
**Trigger**: "New Light Setup" button click

## Next Steps

1. **User should check console logs** to see where the data flow breaks
2. **Report which log messages appear** (or don't appear)
3. Based on logs, we can determine if it's:
   - Load timing issue
   - Data persistence issue
   - Dropdown refresh issue
   - STATE.rooms mutation issue

## Expected Console Output (Success Case)

```
✅ [loadAllData] Loaded STATE.rooms: 1 rooms
   Room details: GreenReach (id: room-ue2cer)
...
[FreshLightWizard] Opening wizard, STATE.rooms: [{...}]
[FreshLightWizard] Calling refreshRoomsAndZones with STATE.rooms length: 1
[FreshLightWizard] refreshRoomsAndZones called, rooms count: 1
[FreshLightWizard] STATE.rooms: [{id: "room-ue2cer", name: "GreenReach", ...}]
[FreshLightWizard] Collected rooms: [{id: "room-ue2cer", name: "GreenReach", ...}]
[FreshLightWizard] Dropdown populated with 1 rooms: GreenReach
```

If all these logs appear, the room "GreenReach" should be in the dropdown!
