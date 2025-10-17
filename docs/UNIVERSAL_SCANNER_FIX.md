# Universal Device Scanner - Troubleshooting Guide

## Issues Fixed

### 1. FreshLightWizard Room Dropdown Not Populating ✅

**Problem:** Light Setup wizard showed "No rooms found" even after creating rooms in Grow Rooms.

**Root Cause:** The wizard was initialized before room data was loaded from the backend.

**Timeline:**
1. Page loads → `DOMContentLoaded` fires
2. Line 15683: `new FreshLightWizard()` created
3. Constructor calls `setupRoomDropdown()` → Sees `STATE.rooms = []` (empty)
4. Later: `loadAllData()` runs → Loads rooms from backend → `STATE.rooms = [room1, ...]`
5. Wizard never gets notified of the data change

**Fix Applied:**
- Added `farmDataChanged` event dispatch in `loadAllData()` after rendering UI (line ~9340)
- The wizard already had an event listener for `farmDataChanged` (line 13964)
- Now when data loads, wizard automatically refreshes its room dropdown

**Files Changed:**
- `public/app.charlie.js` line ~9340

---

### 2. Universal Device Scanner Not Showing Devices ✅

**Problem:** Scanner shows "No devices found" even though devices exist on the network.

**Root Cause:** Python backend not running on port 8000.

**Discovery Flow:**
```
Frontend (browser)
  → fetch('/discovery/devices')
  → Node.js server (port 8091)
     → Try: http://localhost:8000/discovery/devices (Python backend) ❌ NOT RUNNING
     → Try: http://192.168.2.80:3000/discovery/devices (Remote Pi) ❌ CORS error
     → Fallback: Node's own discovery (incomplete implementation)
```

**Fixes Applied:**

**A. Enhanced Node.js Proxy (`server-charlie.js` lines 8126-8175):**
- Added priority check for local Python backend first
- Added 30-second timeout handling
- Added comprehensive logging
- Added proper error handling

**B. Python Backend Discovery Endpoint (`backend/server.py` lines 959-987):**
- Added SwitchBot device discovery (was missing)
- Now discovers: Kasa, BLE, mDNS, **and SwitchBot**
- Runs SwitchBot discovery in executor (non-blocking)

**C. Frontend Logging (`public/app.charlie.js` lines 1790-1815):**
- Added detailed console logging for debugging
- Logs endpoint URL, response status, device count, protocols

---

## How to Use

### Starting the Servers

**Option 1: Using the startup script (Recommended)**
```bash
cd /Users/petergilbert/Light-Engine-Charlie
./start-servers.sh
```

**Option 2: Manual start**
```bash
# Terminal 1: Python backend
cd /Users/petergilbert/Light-Engine-Charlie
python -m backend

# Terminal 2: Node.js server
cd /Users/petergilbert/Light-Engine-Charlie
npm run start
```

### Verifying Everything Works

**1. Check servers are running:**
```bash
# Python backend health check
curl http://localhost:8000/health
# Should return: {"status": "ok"}

# Node.js server
curl http://localhost:8091
# Should return HTML
```

**2. Test Universal Scanner:**
- Open browser to http://localhost:8091
- Open browser console (F12 → Console tab)
- Navigate to **Integrations** panel
- Click **"Start Scan"**
- Watch console for logs:
  ```
  [Discovery] Attempting local Python backend at http://localhost:8000/discovery/devices
  [Discovery] ✅ Found X devices from local Python backend
  [UniversalScan] Found devices: [...]
  ```
- Devices should appear in table with Accept/Ignore buttons

**3. Test Light Setup Wizard:**
- Navigate to **Light Setup** panel
- Click **"New Light Setup"**
- Step 1: Room dropdown should show "GreenReach 2" (or your room name)
- Select room → Click **Next** → Should advance to Step 2

**4. Test Equipment Overview:**
- Create a room with equipment in **Grow Rooms** wizard
- Navigate to **Equipment Overview** panel
- Equipment should appear in the table

---

## Troubleshooting

### Scanner shows "No devices found"

**Check 1: Is Python backend running?**
```bash
lsof -i :8000
# Should show Python process
```

If not running:
```bash
cd /Users/petergilbert/Light-Engine-Charlie
python -m backend
```

**Check 2: Check Python backend logs**
```bash
tail -f logs/python-backend.log
```

Look for errors like:
- `ModuleNotFoundError` → Install dependencies: `pip install -r requirements.txt`
- `SwitchBot not configured` → Set environment variables in `.env`
- `Kasa discovery failed` → Normal if no Kasa devices on network

**Check 3: Check browser console**
- Open F12 → Console
- Look for `[UniversalScan]` logs
- Should see device count and protocols

---

### Room dropdown shows "No rooms found"

**Check 1: Are rooms saved?**
- Navigate to **Grow Rooms** panel
- Verify rooms appear in the list
- Check browser console for: `✅ [loadAllData] Loaded STATE.rooms: X rooms`

**Check 2: Check for event dispatch**
- After rooms load, should see: `[loadAllData] Dispatched farmDataChanged event`
- If missing, wizard won't refresh

**Check 3: Manual refresh**
Open browser console and run:
```javascript
window.freshLightWizard.refreshRooms()
```

---

### CORS errors in console

Errors like:
```
Origin http://localhost:8091 is not allowed by Access-Control-Allow-Origin
```

**Cause:** Node.js server trying to reach remote controller at `http://192.168.2.80:3000`

**Solution:** This is expected and harmless. The server will fall back to local Python backend.

To suppress: Set environment variable:
```bash
export CTRL=http://localhost:8000
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Browser Frontend                      │
│  (http://localhost:8091/index.html)                     │
│                                                          │
│  • Light Setup Wizard (freshLightWizard)                │
│  • Universal Scanner (runUniversalScan)                 │
│  • Equipment Overview (renderEquipmentOverview)         │
└──────────────────┬──────────────────────────────────────┘
                   │
                   │ HTTP Requests
                   │ (fetch('/discovery/devices'))
                   ▼
┌─────────────────────────────────────────────────────────┐
│              Node.js Server (Port 8091)                  │
│                  server-charlie.js                       │
│                                                          │
│  Routes:                                                 │
│  • GET /discovery/devices → Proxy to Python             │
│  • GET /data/rooms.json → Return room data              │
│  • POST /data/rooms.json → Save room data               │
└──────────────────┬──────────────────────────────────────┘
                   │
                   │ Proxy Requests
                   │ (http://localhost:8000/discovery/devices)
                   ▼
┌─────────────────────────────────────────────────────────┐
│            Python Backend (Port 8000)                    │
│                 backend/server.py                        │
│                                                          │
│  FastAPI Endpoints:                                      │
│  • GET /discovery/devices                                │
│    - discover_kasa_devices()                             │
│    - discover_ble_devices()                              │
│    - discover_mdns_devices()                             │
│    - discover_switchbot_devices() ← NEW!                │
│  • GET /health                                           │
└──────────────────┬──────────────────────────────────────┘
                   │
                   │ Device Discovery
                   ▼
┌─────────────────────────────────────────────────────────┐
│                Physical Devices                          │
│                                                          │
│  • SwitchBot devices (Cloud API)                         │
│  • TP-Link Kasa devices (UDP)                            │
│  • BLE devices (Bluetooth scan)                          │
│  • mDNS devices (network scan)                           │
└─────────────────────────────────────────────────────────┘
```

---

## Next Steps

1. **Start both servers** using `./start-servers.sh`
2. **Refresh the browser** page
3. **Create a room** if you haven't already
4. **Test Light Setup wizard** - room dropdown should work
5. **Test Universal Scanner** - should show discovered devices
6. **Check Equipment Overview** - should show room equipment

---

## Summary of Changes

| File | Lines | Change |
|------|-------|--------|
| `public/app.charlie.js` | 1790-1815 | Added detailed scanner logging |
| `public/app.charlie.js` | 9340 | Dispatch `farmDataChanged` after data load |
| `public/app.charlie.js` | 14119 | Fixed wizard validation (removed zone check) |
| `public/app.charlie.js` | 14231-14268 | Removed zone from save() method |
| `backend/server.py` | 25-31 | Added `discover_switchbot_devices` import |
| `backend/server.py` | 959-987 | Added SwitchBot to discovery endpoint |
| `server-charlie.js` | 8126-8175 | Enhanced proxy with local backend priority |
| `start-servers.sh` | NEW | Automated server startup script |

---

## Logs to Monitor

**Python Backend:**
```bash
tail -f logs/python-backend.log
```

Look for:
- `INFO: Application startup complete`
- `INFO: Uvicorn running on http://0.0.0.0:8000`
- Discovery logs when scanner runs

**Node.js Server:**
```bash
tail -f logs/node-server.log
```

Look for:
- `charlie server listening on :8091`
- `[Discovery] Attempting local Python backend...`
- `[Discovery] ✅ Found X devices...`

**Browser Console:**
- `[UniversalScan] Found devices: [...]`
- `[loadAllData] Dispatched farmDataChanged event`
- `[FreshLightWizard] Dropdown populated with X rooms`
