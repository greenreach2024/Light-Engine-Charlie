# Grow3 Controller Integration

**Date:** October 16, 2025  
**Status:** ✅ Complete

## Overview

Added a dedicated **Grow3 Light Controller** card to the Integrations panel with full 4-channel spectrum control, fixture management, and live testing capabilities.

---

## Controller Specifications

### Connection Details
- **Address:** `http://192.168.2.80:3000`
- **Role:** Primary light control endpoint for all grow fixtures
- **Spectrum Channels:** 4-channel control (CW/WW/Blue/Red)
- **Protocol:** HTTP REST API with JSON payloads

### Controlled Fixtures (5 devices)

| Controller ID | Fixture UID | Description |
|--------------|-------------|-------------|
| 2 | F00001 | Grow light fixture 1 |
| 3 | F00002 | Grow light fixture 2 |
| 4 | F00003 | Grow light fixture 3 |
| 5 | F00005 | Grow light fixture 5 |
| 6 | F00004 | Grow light fixture 4 |

---

## Features Added

### 1. **Grow3 Controller Card** ✅

**Location:** `public/index.charlie.html` - Integrations panel

**Visual Elements:**
- Green gradient card with controller branding
- Real-time status indicator (Online/Offline)
- Controller address display
- Test connection button
- Expandable fixtures table
- Expandable API reference

**Status Monitoring:**
- Auto-checks health on page load
- Visual indicator: 🟢 Online / 🔴 Offline
- Async health check with 5-second timeout

### 2. **Connection Testing** ✅

**Function:** `window.testGrow3Connection()`

**Tests Performed:**
1. Health check: `GET /healthz`
2. Device list retrieval: `GET /api/devicedatas`

**UI Feedback:**
- Button state management (disabled during test)
- Success toast with device count
- Error toast with specific error message
- Status indicator update

### 3. **Individual Fixture Testing** ✅

**Function:** `window.testGrow3Fixture(controllerId, fixtureUid)`

**Test Sequence:**
1. **Turn ON** with 45% all channels
   - Payload: `{"status":"on","value":"737373730000"}`
   - CW: 45%, WW: 45%, Blue: 45%, Red: 45%
2. **Wait 2 seconds**
3. **Turn OFF**
   - Payload: `{"status":"off"}`

**Test Buttons:**
- Individual test button for each fixture
- Click to run ON → wait → OFF sequence
- Toast notifications at each step

### 4. **API Reference Documentation** ✅

**Built-in Documentation:**
- Expandable API reference section
- Control endpoint format
- Command examples
- Hex encoding guide
- Common spectrum recipes

---

## API Details

### Health Check
```bash
GET http://192.168.2.80:3000/healthz

Response:
{
  "ok": true
}
```

### Get Device List
```bash
GET http://192.168.2.80:3000/api/devicedatas

Response: Array of device objects
```

### Control Fixture
```bash
PATCH http://192.168.2.80:3000/api/devicedatas/device/:id
Content-Type: application/json

Body (Turn ON):
{
  "status": "on"
}

Body (Turn OFF):
{
  "status": "off"
}

Body (Spectrum Control):
{
  "status": "on",
  "value": "HEX12"
}
```

### HEX12 Format

**Structure:** `[CW][WW][Blue][Red][00][00]`

Each pair is a hex value (00–64) representing 0–100% intensity:
- `00` = 0%
- `32` = ~50% (50 decimal)
- `64` = 100% (100 decimal)
- `73` = ~45% (115 decimal)

**Examples:**

| Intent | HEX Payload | JSON Command |
|--------|-------------|--------------|
| All channels 45% | `737373730000` | `{"status":"on","value":"737373730000"}` |
| Red 100% only | `000000640000` | `{"status":"on","value":"000000640000"}` |
| Blue 50% only | `000032000000` | `{"status":"on","value":"000032000000"}` |
| CW + WW 100% | `646400000000` | `{"status":"on","value":"646400000000"}` |
| All off | `000000000000` | `{"status":"off"}` |

---

## JavaScript Functions

### Auto-Health Check
```javascript
// Runs on page load
window.checkGrow3Status = async function() {
  // Check /healthz endpoint
  // Update status indicator
  // Green dot if online, red if offline
}
```

### Connection Test
```javascript
window.testGrow3Connection = async function() {
  // 1. Test health endpoint
  // 2. Retrieve device list
  // 3. Show success/failure toast
  // 4. Update status indicator
}
```

### Fixture Test
```javascript
window.testGrow3Fixture = async function(controllerId, fixtureUid) {
  // 1. Turn ON at 45% all channels
  // 2. Wait 2 seconds
  // 3. Turn OFF
  // 4. Show toast notifications at each step
}
```

---

## UI Components

### Controller Card Structure
```
┌─────────────────────────────────────────────────┐
│ 🔌 Grow3 Light Controller          [Test Conn] │
│ Primary light control endpoint • 4-channel      │
│ [Address: 192.168.2.80:3000] [Status: Online]  │
│                                                  │
│ ▼ Controlled Fixtures (5 devices)              │
│   ┌─────────────────────────────────────────┐  │
│   │ ID  UID     Status    Actions           │  │
│   │ 2   F00001  —         [Test]            │  │
│   │ 3   F00002  —         [Test]            │  │
│   │ 4   F00003  —         [Test]            │  │
│   │ 5   F00005  —         [Test]            │  │
│   │ 6   F00004  —         [Test]            │  │
│   │                                          │  │
│   │ 💡 Spectrum Control: CW • WW • Blue • Red │
│   └─────────────────────────────────────────┘  │
│                                                  │
│ ▼ API Reference                                 │
│   PATCH /api/devicedatas/device/:id            │
│   Commands: {"status":"on"}, {"status":"off"}  │
└─────────────────────────────────────────────────┘
```

---

## Testing Guide

### 1. Access Integrations Panel
1. Open dashboard at `http://127.0.0.1:8091`
2. Navigate to **Settings → Integrations**
3. Scroll to **Grow3 Light Controller** card

### 2. Check Controller Status
- Status indicator should show:
  - 🟢 **Online** if controller is reachable
  - 🔴 **Offline** if controller is unreachable
- Auto-checked on page load

### 3. Test Connection
1. Click **"🧪 Test Connection"** button
2. Wait for response (up to 5 seconds)
3. Success toast should show:
   - "Grow3 Controller Connected"
   - Health: OK
   - Device count

### 4. Test Individual Fixture
1. Expand **"📋 Controlled Fixtures"** section
2. Click **"Test"** button for any fixture
3. Light should:
   - Turn ON at 45% (all channels)
   - Stay on for 2 seconds
   - Turn OFF automatically
4. Toast notifications show each step

### 5. View API Reference
1. Expand **"📚 API Reference"** section
2. View endpoints and command examples
3. Copy/paste examples for custom scripts

---

## Error Handling

### Connection Failures
- **Timeout (5s):** Shows "Offline" status
- **Network Error:** Toast notification with error message
- **HTTP Error:** Shows status code in toast

### Fixture Test Failures
- **ON Command Failed:** Toast with error details
- **OFF Command Failed:** Toast with error details
- **Timeout:** Abort signal cancels request after 5s

### Graceful Degradation
- Controller offline → Card still displays information
- Health check failure → Status shows "Offline"
- Test failures → Detailed error messages in console

---

## Network Requirements

### Local Network Access
- Controller must be accessible on LAN: `192.168.2.80:3000`
- Dashboard can be on same network or VPN
- CORS headers must allow dashboard origin

### VPN/Remote Access
If accessing remotely:
1. Ensure VPN connects to `192.168.2.0/24` network
2. Verify routing to `.80` device
3. Test with: `curl http://192.168.2.80:3000/healthz`

### Firewall Rules
Allow inbound on controller:
- Port: 3000 (HTTP)
- Protocol: TCP
- Source: Dashboard IP or subnet

---

## Integration with E.V.I.E. System

The Grow3 controller integrates with the E.V.I.E. (Environmental Vision Intelligence Engine) system:

### Recipe Bridge
- **Source:** `/home/greenreach/LightRecipes.xlsx`
- **Proxy:** `http://localhost:8080` → `http://192.168.2.80:3000`
- **Endpoints:**
  - `/plans` - Recipe publishing
  - `/sched` - Schedule sync
  - `/api/devicedatas/device/:id` - Light name sync

### Dynamic Spectrum Modulation
- Controlled via crop recipes
- Smooth transitions (no abrupt jumps)
- Environmental condition-based adjustments
- PPFD and spectral ratio optimization

---

## Verification Commands

### Health Check
```bash
curl -s http://192.168.2.80:3000/healthz
# Expected: {"ok":true}
```

### Get Device List
```bash
curl -s http://192.168.2.80:3000/api/devicedatas
# Expected: Array of device objects with IDs
```

### Turn Fixture ON (45% all channels)
```bash
curl -X PATCH \
  -H 'Content-Type: application/json' \
  -d '{"status":"on","value":"737373730000"}' \
  http://192.168.2.80:3000/api/devicedatas/device/2
# Expected: 200 OK, light turns on
```

### Turn Fixture OFF
```bash
curl -X PATCH \
  -H 'Content-Type: application/json' \
  -d '{"status":"off"}' \
  http://192.168.2.80:3000/api/devicedatas/device/2
# Expected: 200 OK, light turns off
```

---

## Future Enhancements

### Short Term
- [ ] Real-time fixture status display
- [ ] Custom spectrum presets UI
- [ ] Bulk fixture control (all on/off)
- [ ] Schedule editor integration

### Medium Term
- [ ] Live PPFD monitoring
- [ ] Spectrum visualization (color wheel)
- [ ] Recipe editor integration
- [ ] Historical spectrum logs

### Long Term
- [ ] AI-powered spectrum optimization
- [ ] Crop-specific recipe templates
- [ ] Energy usage analytics
- [ ] Remote firmware updates

---

## Troubleshooting

### Controller Shows Offline
1. **Check network connectivity:**
   ```bash
   ping 192.168.2.80
   ```
2. **Verify controller is running:**
   ```bash
   curl http://192.168.2.80:3000/healthz
   ```
3. **Check firewall rules** on controller device
4. **Verify VPN connection** if remote

### Test Connection Fails
1. **Check console logs** in browser DevTools
2. **Verify API endpoint** is accessible
3. **Check CORS headers** on controller
4. **Increase timeout** if network is slow

### Fixture Test Does Nothing
1. **Verify physical wiring** to fixture
2. **Check controller ID mapping** (2-6 → F00001-F00004)
3. **Test with curl command** directly
4. **Review controller logs** for errors

### Wrong Fixture Responds
1. **Verify Controller ID mapping** in table
2. **Check fixture UID labels** on physical devices
3. **Update mapping** in HTML if incorrect
4. **Test each fixture individually** to identify

---

## Support

### Documentation
- Controller API: Built-in API Reference section
- Dashboard: This document
- E.V.I.E. System: Contact GreenReach support

### Logs
- Browser Console: `F12` → Console tab
- Network Tab: `F12` → Network tab
- Controller Logs: SSH to `192.168.2.80` and check logs

### Contact
For issues or questions:
- Check health endpoint first
- Review browser console errors
- Test with curl commands
- Document error messages for support

---

**Status:** Grow3 Controller integration complete and ready for testing ✅
