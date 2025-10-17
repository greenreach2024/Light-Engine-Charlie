# Light Setup Wizard Zone Management Fix - October 17, 2025

## Issue
Zones were being created in the Light Setup Wizard, but the user wants zones to be created ONLY in the Groups panel, not in room setup or light setup.

## Changes Made

### 1. Removed "Create New Zone" Button from Light Setup Wizard

**File**: `public/index.html` (line ~1021)

**Before:**
```html
<button id="freshCreateZone" type="button" style="padding: 8px 16px;">Create New Zone</button>
```

**After:**
```html
<p class="tiny" style="margin: 8px 0 0 0; color: #64748b;">
  Zones are managed in the <strong>Groups</strong> panel. Create zones there first.
</p>
```

**Impact**: Users now see clear guidance that zones must be created in Groups panel

---

### 2. Removed Zone Creation Logic from JavaScript

**File**: `public/app.charlie.js` (line ~13995)

**Removed:**
- `createZoneBtn` DOM element reference
- `createZoneBtn.addEventListener('click', ...)` handler
- Zone creation logic that added zones to `STATE.rooms` or `STATE.farm.rooms`

**Impact**: No zone creation functionality in Light Setup wizard

---

### 3. Updated Zone Dropdown to Pull from Groups

**File**: `public/app.charlie.js` (line ~13950)

**Before:**
```javascript
const updateZones = (roomId, zoneToPreserve) => {
  const rooms = collectRoomsFromState();
  const selectedRoom = rooms.find(r => (r.id || r.name) === roomId);
  const zones = selectedRoom && Array.isArray(selectedRoom.zones) ? selectedRoom.zones : [];
  // ... populate dropdown with room.zones
}
```

**After:**
```javascript
const updateZones = (roomId, zoneToPreserve) => {
  // Get zones from Groups for the selected room
  const groupsForRoom = Array.isArray(STATE.groups) 
    ? STATE.groups.filter(g => (g.room === roomId || g.roomId === roomId))
    : [];
  
  // Extract unique zone names from groups
  const zones = [...new Set(groupsForRoom.map(g => g.zone).filter(z => z))];
  
  console.log('[FreshLightWizard] Zones for room', roomId, ':', zones);
  
  if (!zones.length) {
    zoneSelect.innerHTML = '<option value="">No zones found. Create zones in Groups panel first.</option>';
    // ... handle empty state
  }
  // ... populate dropdown with zones from groups
}
```

**Impact**: Zone dropdown now shows zones from Groups (STATE.groups) instead of from rooms (STATE.rooms.zones)

---

## New Workflow

### Creating Zones (Groups Panel)
1. Navigate to **Groups** panel
2. Create a new group
3. Assign a room and zone to the group
4. Zone is now available for Light Setup

### Using Zones (Light Setup Wizard)
1. Navigate to **Light Setup** panel
2. Click "New Light Setup"
3. Select a room
4. Zone dropdown shows zones from Groups (for that room)
5. Select zone → configure fixtures → save

## Data Flow

```
Groups Panel
    ↓
Create Group with {room: "Room1", zone: "Zone A"}
    ↓
STATE.groups = [{room: "Room1", zone: "Zone A", ...}]
    ↓
Light Setup Wizard opens
    ↓
User selects "Room1"
    ↓
updateZones() filters STATE.groups by room → finds ["Zone A"]
    ↓
Zone dropdown shows "Zone A"
```

## Testing Checklist

### Test 1: Create Zone in Groups
- [ ] Navigate to Groups panel
- [ ] Create a new group
- [ ] Set room: "GreenReach"
- [ ] Set zone: "Zone 1"
- [ ] Save group

### Test 2: Verify Light Setup Shows Zone
- [ ] Navigate to Light Setup panel
- [ ] Click "New Light Setup"
- [ ] Select room: "GreenReach"
- [ ] Zone dropdown should show "Zone 1" (from Groups)
- [ ] "Create New Zone" button should NOT appear
- [ ] Help text should say "Zones are managed in the Groups panel"

### Test 3: No Zones Yet
- [ ] Delete all groups (or use fresh data)
- [ ] Open Light Setup wizard
- [ ] Select any room
- [ ] Zone dropdown should show: "No zones found. Create zones in Groups panel first."

### Test 4: Multiple Zones for Same Room
- [ ] Create Group 1: Room "GreenReach", Zone "Veg Zone"
- [ ] Create Group 2: Room "GreenReach", Zone "Flower Zone"
- [ ] Open Light Setup wizard
- [ ] Select "GreenReach"
- [ ] Zone dropdown should show both "Veg Zone" and "Flower Zone"

## Benefits

✅ **Single Source of Truth**: Zones are ONLY created in Groups panel
✅ **Clearer Workflow**: Users understand zones are part of group management
✅ **No Duplication**: Zones aren't scattered across rooms, groups, and light setups
✅ **Better UX**: Clear guidance text tells users where to create zones
✅ **Data Integrity**: Zones always tied to groups (room + zone = group identifier)

## Technical Notes

### Zone Storage
- **Before**: Zones stored in `room.zones[]` array
- **After**: Zones extracted from `STATE.groups[].zone` property

### Zone Uniqueness
- Uses `Set` to deduplicate zones: `[...new Set(groupsForRoom.map(g => g.zone))]`
- If multiple groups have same room + zone combo, zone appears once in dropdown

### Group Structure
```javascript
{
  id: "group-abc123",
  name: "My Group",
  room: "room-id" or "Room Name",
  roomId: "room-id",
  zone: "Zone 1",
  devices: [...],
  // ... other properties
}
```

## Migration Notes

If users have existing rooms with `room.zones[]` arrays:
- Those zones will NO LONGER appear in Light Setup dropdown
- Users must recreate zones in Groups panel
- Consider a one-time migration script if needed to convert `room.zones` → groups

## Future Enhancements

1. **Group Wizard**: Add "Create Zone" button in Light Setup that opens Groups wizard pre-filled with selected room
2. **Zone Validation**: Warn if selecting a room+zone combination that doesn't have a group yet
3. **Quick Create**: Inline zone creation that automatically creates a group with that room+zone

## Summary

Zones are now EXCLUSIVELY managed in the Groups panel. The Light Setup wizard is read-only for zones - it displays zones from existing groups but cannot create new ones. This provides a clearer, more maintainable workflow where zones are always part of group definitions.
