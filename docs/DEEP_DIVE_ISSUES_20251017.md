# Deep Dive: Multiple System Issues - October 17, 2025

## Issues Identified

### 1. ❌ Grow Room Summary Not Updating
**Root Cause**: `renderGrowRoomOverview()` is being called, but the DOM elements it targets don't exist in the current HTML.

**Evidence**:
- Function exists at line 10883 and 14921 (duplicate!)
- Tries to update `#growOverviewSummary` and `#growOverviewGrid`
- These elements are NOT in `index.charlie.html`

**Fix**: Either add the missing DOM elements or wire the function to update the actual room panel summary.

---

### 2. ❌ Rooms Not Appearing in Light Setup Dropdown
**Root Cause**: Multiple issues in the data flow chain:

1. `saveRoom()` correctly dispatches `farmDataChanged` event (line 9050)
2. `FreshLightWizard.setupRoomZoneDropdowns()` listens for `farmDataChanged` (line 6112)
3. **BUT**: The listener calls `refreshRoomsAndZones()` which expects rooms from `STATE.farm.rooms` or `STATE.rooms`
4. **DATA MISMATCH**: Code checks both sources but may be pulling from wrong one

**Evidence from code**:
```javascript
// Line 6090 - refreshRoomsAndZones pulls from STATE.farm?.rooms
const rooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : 
              Array.isArray(STATE.rooms) ? STATE.rooms : [];

// Line 9039 - saveRoom pushes to STATE.rooms
STATE.rooms.push({ ...this.data });

// Line 9043 - saveRoom calls renderRooms() which reads STATE.rooms
renderRooms();
```

**Fix**: Consolidate on ONE source of truth - `STATE.rooms` - and ensure all code reads from there.

---

### 3. ✅ Unwanted "Add Room" Button - FALSE ALARM
**Location**: `btnAddRoom` is at line 1285 in `index.charlie.html`
**Context**: It's inside the **Farm Wizard** modal's "spaces" step, NOT on the Light Setup card
**Verdict**: This is correct placement - user may be seeing it in the wrong context

---

### 4. ❌ Scanner Not Finding IoT Devices
**Root Cause**: Python backend is NOT running

**Evidence**:
- `ps aux | grep python | grep backend` returns nothing
- Port 8000 is clear
- Frontend calls `http://localhost:8000/discovery/scan` but gets CORS/connection errors

**Network Architecture**:
- Backend Python service (FastAPI on port 8000) scans **the local network where it runs**
- If backend runs on your Mac, it scans your Mac's WiFi network
- If backend runs on a Pi, it scans the Pi's network
- Devices must be on **the same subnet** as the backend server

**Fix**: Start the Python backend:
```bash
cd /Users/petergilbert/Light-Engine-Charlie
python3 -m backend
```

---

### 5. ❓ WiFi/Network Confusion
**Question**: "Are we even signing in to a wifi? or using the computer as a host?"

**Answer**: 
- **No WiFi sign-in required** - the backend scans the existing network it's connected to
- **Your computer IS the host** - when you run `python3 -m backend`, your Mac becomes the discovery server
- **Devices must be on the same network** - IoT devices need to be on the same WiFi/LAN as your Mac
- **No authentication to devices** - discovery uses broadcast/mDNS, doesn't need device passwords (pairing comes later)

**Discovery Protocols**:
- **TP-Link Kasa**: UDP broadcast on local subnet
- **SwitchBot**: Cloud API (requires token, doesn't need local network)
- **BLE**: Bluetooth LE scanning (requires BLE adapter)
- **MQTT**: Connects to broker at configured IP (default: 192.168.2.38)

---

## Root Cause Analysis Summary

| Issue | Root Cause | Severity |
|-------|-----------|----------|
| Room summary not updating | Missing DOM elements for overview | Medium |
| Rooms not in Light Setup | Data source mismatch (STATE.farm.rooms vs STATE.rooms) | **HIGH** |
| "Add Room" button | User confusion - button is in Farm Wizard (correct) | Low |
| Scanner not finding devices | **Backend not running** | **CRITICAL** |
| WiFi confusion | Architecture not documented | Medium |

---

## Fixes Required

### Fix 1: Consolidate Room Data Source (HIGH PRIORITY)

**File**: `public/app.charlie.js`

**Change all room lookups to use STATE.rooms consistently**:

1. Find all `STATE.farm?.rooms` references
2. Replace with `STATE.rooms` 
3. Remove fallback to `STATE.farm.rooms`

**Lines to update**:
- Line 6090 (FreshLightWizard dropdown refresh)
- Line 6188 (device assignment)
- Line 10891 (renderGrowRoomOverview)
- Any other `STATE.farm?.rooms` references

### Fix 2: Start Python Backend (CRITICAL)

```bash
cd /Users/petergilbert/Light-Engine-Charlie
python3 -m backend
```

**Expected output**:
```
INFO:     Started server process
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Fix 3: Add Room Overview DOM Elements (OPTIONAL)

If you want the overview summary to work, add to `index.charlie.html` in the Grow Rooms panel:

```html
<div id="growOverviewSummary" class="grow-overview-summary"></div>
<div id="growOverviewGrid" class="grow-overview-grid"></div>
```

---

## Testing Plan

1. **Start Backend**
   ```bash
   python3 -m backend
   ```

2. **Verify Backend Running**
   ```bash
   curl http://localhost:8000/discovery/scan
   ```
   Should return JSON with discovered devices

3. **Test Room Workflow**
   - Create a new room via "New Grow Room"
   - Save it
   - Open "New Light Setup" wizard
   - **Verify room appears in dropdown**

4. **Test Device Discovery**
   - Click "Start Scan" in Integrations panel
   - **Verify devices appear** (must be on same WiFi)
   - Accept/Ignore devices
   - Check IoT Devices panel

---

## Network Requirements for Discovery

**For devices to be discovered, they must**:
1. Be powered on
2. Be connected to the **same WiFi network** as your Mac
3. Be on the **same subnet** (typically 192.168.x.x or 10.0.x.x)
4. Not blocked by firewall rules

**Subnet check**:
```bash
# Your Mac's IP
ipconfig getifaddr en0

# Should be same prefix as devices, e.g.:
# Mac: 192.168.1.100
# Kasa plug: 192.168.1.45  ✅ Same subnet
# Kasa plug: 192.168.2.45  ❌ Different subnet
```

---

## Next Steps

1. Apply Fix 1 (consolidate STATE.rooms) - I'll do this next
2. Start backend (you do this)
3. Test room creation → light setup flow
4. Test device discovery
5. Document network setup in user guide
