# Light Setup Wizard - Room Only (No Zones) - October 17, 2025

## Issue Resolved
The Light Setup Wizard was showing zone selection, but zones should NOT be part of the Light Setup flow. The wizard should ONLY select rooms (from Grow Rooms setup), nothing else.

## Changes Made

### 1. Removed Zone Selection from HTML

**File**: `public/index.html` (line ~1005)

**Before:**
```html
<h3>Select Room and Zone</h3>

<div style="margin-bottom: 20px;">
  <label>Room:</label>
  <select id="freshRoomSelect">...</select>
</div>

<div style="margin-bottom: 20px;">
  <label>Zone:</label>
  <select id="freshZoneSelect">...</select>
  <p class="tiny">Zones are managed in the Groups panel...</p>
</div>
```

**After:**
```html
<h3>Select Room</h3>

<div style="margin-bottom: 20px;">
  <label>Room:</label>
  <select id="freshRoomSelect">...</select>
  <p class="tiny">Rooms are created in the Grow Rooms panel. Create a room there first.</p>
</div>
```

**Impact**: Zone dropdown completely removed from UI

---

### 2. Renamed Function to setupRoomDropdown()

**File**: `public/app.charlie.js` (line ~13895)

**Before:** `setupRoomZoneDropdowns()`
**After:** `setupRoomDropdown()`

**Impact**: Function name reflects that it only handles rooms

---

### 3. Removed All Zone Logic from JavaScript

**File**: `public/app.charlie.js`

**Removed:**
- `zoneSelect` DOM element reference
- `updateZones()` function
- `refreshRoomsAndZones()` renamed to `refreshRooms()`
- `zoneSelect.addEventListener('change')` event listener
- All zone-related state updates
- `this.data.zone` from wizard data

**Kept:**
- `roomSelect` DOM element reference
- `refreshRooms()` function that pulls from STATE.rooms
- `roomSelect.addEventListener('change')` event listener
- `this.data.room` in wizard data

---

### 4. Updated refreshRooms() Function

**File**: `public/app.charlie.js` (line ~13920)

**New Logic:**
```javascript
const refreshRooms = (selectedRoomId) => {
  const rooms = collectRoomsFromState(); // Gets STATE.rooms from Grow Rooms
  
  if (!rooms.length) {
    roomSelect.innerHTML = '<option value="">No rooms found. Create rooms in Grow Rooms panel first.</option>';
    this.data.room = '';
    this.updateNavigation();
    return;
  }
  
  roomSelect.innerHTML = '<option value="">Select a room</option>' + 
    rooms.map(room => `<option value="${room.id || room.name}">${room.name || room.id}</option>`).join('');
  
  let roomId = selectedRoomId;
  if (!roomId || !rooms.some(r => (r.id || r.name) === roomId)) {
    roomId = rooms[0]?.id || rooms[0]?.name || '';
  }
  roomSelect.value = roomId;
  
  // Update wizard data (no zone)
  this.data.room = roomId;
  this.updateNavigation();
};
```

**Data Source**: `STATE.rooms` (populated from `public/data/rooms.json` via Grow Rooms setup)

---

### 5. Updated Event Listeners

**File**: `public/app.charlie.js` (line ~13950)

**Before:**
```javascript
roomSelect.addEventListener('change', (e) => {
  updateZones(e.target.value, '');
});

zoneSelect.addEventListener('change', (e) => {
  this.data.zone = e.target.value;
  this.data.room = roomSelect.value;
  this.updateNavigation();
});
```

**After:**
```javascript
roomSelect.addEventListener('change', (e) => {
  this.data.room = e.target.value;
  this.updateNavigation();
});
```

**Impact**: Only room selection triggers navigation update

---

### 6. Updated open() Method

**File**: `public/app.charlie.js` (line ~14197)

**Before:**
```javascript
if (!this.refreshRoomsAndZones) {
  this.setupRoomZoneDropdowns();
}
if (this.refreshRoomsAndZones) {
  this.refreshRoomsAndZones(this.data.room, this.data.zone);
}
```

**After:**
```javascript
if (!this.refreshRooms) {
  this.setupRoomDropdown();
}
if (this.refreshRooms) {
  this.refreshRooms(this.data.room);
}
```

**Impact**: Calls correct function with room only (no zone parameter)

---

### 7. Removed zone from Wizard Data

**File**: `public/app.charlie.js` (line ~13863)

**Before:**
```javascript
this.data = {
  room: '',
  zone: '',
  fixtures: [],
  controlMethod: '',
  ...
};
```

**After:**
```javascript
this.data = {
  room: '',
  fixtures: [],
  controlMethod: '',
  ...
};
```

**Impact**: No zone tracking in wizard state

---

## New Workflow

### Step 1: Create Room (Grow Rooms Panel)
1. Navigate to **Grow Rooms** panel
2. Click "Add Room" button
3. Fill in room details (name, equipment, etc.)
4. Save
5. Room added to STATE.rooms

### Step 2: Configure Lights (Light Setup Wizard)
1. Navigate to **Light Setup** panel
2. Click "New Light Setup" button
3. **Select Room** (from dropdown showing STATE.rooms)
4. Select Fixtures
5. Select Control Method
6. Review & Save

### Step 3: Assign to Group (Optional - Groups Panel)
1. Navigate to **Groups** panel
2. Create group with room + zone
3. Assign devices to group

---

## Data Flow

```
Grow Rooms Panel
    ↓
Create Room → STATE.rooms = [{id: "room-123", name: "Room1", ...}]
    ↓
Save to public/data/rooms.json
    ↓
Light Setup Wizard opens
    ↓
refreshRooms() pulls from STATE.rooms
    ↓
Room dropdown shows ["Room1"]
    ↓
User selects "Room1" → this.data.room = "room-123"
    ↓
Configure fixtures → Save light setup
```

---

## Testing Checklist

### Test 1: Room Dropdown Shows Rooms from Grow Rooms
- [ ] Create room "TestRoom" in Grow Rooms panel
- [ ] Open Light Setup wizard
- [ ] Room dropdown shows "TestRoom"
- [ ] NO zone dropdown visible

### Test 2: No Rooms Yet
- [ ] Delete all rooms (or use fresh data)
- [ ] Open Light Setup wizard
- [ ] Room dropdown shows: "No rooms found. Create rooms in Grow Rooms panel first."

### Test 3: Multiple Rooms
- [ ] Create 3 rooms in Grow Rooms
- [ ] Open Light Setup wizard
- [ ] Room dropdown shows all 3 rooms
- [ ] Select each room → wizard advances

### Test 4: Light Setup Saves with Room Only
- [ ] Open Light Setup wizard
- [ ] Select room "TestRoom"
- [ ] Add fixtures
- [ ] Save
- [ ] Check STATE.lightSetups → should have {room: "TestRoom", fixtures: [...]}
- [ ] NO zone property in saved light setup

### Test 5: Console Logs Verification
- [ ] Open browser console
- [ ] Open Light Setup wizard
- [ ] Look for: `[FreshLightWizard] Calling refreshRooms with STATE.rooms length: X`
- [ ] Look for: `[FreshLightWizard] Dropdown populated with X rooms: ...`
- [ ] Should NOT see any zone-related logs

---

## Benefits

✅ **Simplified Workflow**: Rooms only, no zone confusion
✅ **Clear Data Source**: STATE.rooms from Grow Rooms panel
✅ **Cleaner UI**: Single dropdown instead of two
✅ **Easier to Understand**: Light Setup = Room + Fixtures + Control
✅ **Zones Stay in Groups**: Zones are group-level concepts, not light setup

---

## Key Points

1. **Rooms** are created in **Grow Rooms** panel
2. **Light Setups** select rooms and configure fixtures
3. **Zones** are created in **Groups** panel (room + zone = group)
4. Light Setup wizard has ZERO zone logic
5. STATE.rooms is the single source of truth for room dropdown

---

## Summary

The Light Setup Wizard now:
- Shows ONLY rooms (no zones)
- Pulls rooms from STATE.rooms (Grow Rooms setup)
- Has simplified step 1: "Select Room" instead of "Select Room and Zone"
- Stores light setups with room reference only
- Provides clear guidance: "Rooms are created in the Grow Rooms panel"

Zones are completely removed from the Light Setup flow. They belong in Groups management, not lighting configuration.
