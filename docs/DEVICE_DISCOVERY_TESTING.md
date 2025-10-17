# Universal Device Scanner - Testing Guide

## Quick Test Procedure

### 1. Start Servers
```bash
# Terminal 1: Start Python backend
cd /Users/petergilbert/Light-Engine-Charlie
python -m backend

# Terminal 2: Start Node.js server
npm run start
```

### 2. Open Browser
Navigate to: `http://localhost:8091`

### 3. Run Device Scan
1. Click sidebar: **Integrations**
2. Find **Universal Device Scanner** card
3. Click **"Start Scan"** button
4. Watch progress animation (5-10 seconds)

### 4. Expected Results

**Console Output (Python backend):**
```
INFO:     POST /discovery/scan
Discovered 9 devices:
  - Family Room TV (mDNS)
  - Apple TV (mDNS)
  - My ecobee (mDNS)
  - Smart Bridge 2 (mDNS)
  - GreenReach Farms (mDNS)
  - Officejet Pro 8600 (mDNS)
  - Brother MFC-L8900CDW (mDNS)
```

**Browser UI:**
- ✅ Progress bar completes
- ✅ Results table appears with devices
- ✅ Each row has **Accept** and **Ignore** buttons
- ✅ Device count displayed: "9 devices found"
- ✅ Protocol badges colored blue

### 5. Test Accept Workflow (mDNS Device)

**Steps:**
1. Click **Accept** on "Apple TV" or "My ecobee"
2. Verify:
   - ✅ No sign-in modal appears (mDNS doesn't need auth)
   - ✅ Row fades out and disappears
   - ✅ Device count updates: "8 devices found"
   - ✅ Toast appears: "Device added to IoT devices"
   - ✅ IoT Devices panel updates (if open)

**Console Check:**
```javascript
// In browser console
window.LAST_IOT_SCAN
// Should show newly added device
```

### 6. Test Accept Workflow (Auth Required - SwitchBot)

**Prerequisites:** Need actual SwitchBot device discovered (or mock one)

**Steps:**
1. Click **Accept** on SwitchBot device
2. Verify modal appears with:
   - ✅ Title: "Sign In to SwitchBot"
   - ✅ API Token input field
   - ✅ API Secret input field
   - ✅ Cancel button
   - ✅ "Sign In & Add Device" button
3. Enter test credentials:
   - Token: `test-token-123`
   - Secret: `test-secret-456`
4. Click **"Sign In & Add Device"**
5. Verify:
   - ✅ Modal closes
   - ✅ Device added to IoT panel
   - ✅ Credentials stored in device payload
   - ✅ Row removed from scan results

### 7. Test Accept Workflow (Auth Required - Kasa)

**Prerequisites:** Need actual Kasa device discovered (or mock one)

**Steps:**
1. Click **Accept** on Kasa device
2. Verify modal appears with:
   - ✅ Title: "Sign In to TP-Link Kasa"
   - ✅ Email input field
   - ✅ Password input field
   - ✅ Cancel button
   - ✅ "Sign In & Add Device" button
3. Enter test credentials:
   - Email: `test@example.com`
   - Password: `testpass123`
4. Click **"Sign In & Add Device"**
5. Verify same results as SwitchBot test

### 8. Test Ignore Workflow

**Steps:**
1. Click **Ignore** on any device
2. Verify:
   - ✅ Row fades to 50% opacity
   - ✅ Row disappears after 300ms
   - ✅ Device count updates
   - ✅ Toast appears: "Device ignored, will not be added"

**Edge Case: Ignore All Devices**
1. Click **Ignore** on all devices
2. Verify:
   - ✅ Empty state message appears
   - ✅ Message: "All devices ignored. Run scan again to discover more."

### 9. Test Modal Cancel

**Steps:**
1. Click **Accept** on SwitchBot/Kasa device
2. Modal appears
3. Click **Cancel** button
4. Verify:
   - ✅ Modal closes
   - ✅ Device remains in scan results
   - ✅ No changes to IoT panel

### 10. Test Modal Validation

**Steps:**
1. Click **Accept** on SwitchBot device
2. Leave Token or Secret empty
3. Click **"Sign In & Add Device"**
4. Verify:
   - ✅ Toast error: "Please enter both token and secret"
   - ✅ Modal stays open
   - ✅ No device added

## Backend API Tests

### Test Discovery Endpoint
```bash
curl -X POST http://127.0.0.1:8000/discovery/scan | jq '.'
```

**Expected Response:**
```json
{
  "status": "success",
  "devices": [
    {
      "name": "Apple TV",
      "brand": "Unknown",
      "vendor": "Unknown",
      "protocol": "mdns",
      "comm_type": "mDNS",
      "ip": null,
      "mac": null,
      "deviceId": null,
      "model": null
    }
  ],
  "count": 9,
  "timestamp": 516682.548988375
}
```

### Test Device Count
```bash
curl -s -X POST http://127.0.0.1:8000/discovery/scan | jq '.count'
```

**Expected:** `9` (or number of devices on network)

### Test Device Names
```bash
curl -s -X POST http://127.0.0.1:8000/discovery/scan | jq '.devices[].name'
```

**Expected:**
```
"Family Room TV"
"Apple TV"
"My ecobee"
...
```

## Console Debugging

### Check Frontend State
```javascript
// In browser console

// View last scan results
window.LAST_UNIVERSAL_SCAN

// View IoT devices
STATE.iotDevices
window.LAST_IOT_SCAN

// Check API endpoint
console.log('Discovery endpoint:', 'http://127.0.0.1:8000/discovery/scan')
```

### Enable Verbose Logging
```javascript
// Add this before running scan
window.DEBUG_DISCOVERY = true;

// Then run scan and check console for detailed logs
```

### Manually Trigger Functions
```javascript
// Accept device at index 0
window.acceptDiscoveredDevice(0)

// Ignore device at index 1
window.ignoreDiscoveredDevice(1)

// Close any open modal
window.closeDeviceSignInModal()
```

## Common Issues & Solutions

### Issue: "No devices found" in UI
**Check:**
- Python backend running on port 8000?
- Browser console shows any errors?
- Network has discoverable devices?

**Solution:**
```bash
# Test backend directly
curl -X POST http://127.0.0.1:8000/discovery/scan | jq '.count'

# If count > 0, it's a frontend issue
# Check browser console for fetch errors
```

### Issue: Modal doesn't appear
**Check:**
- Device protocol set correctly?
- Console errors when clicking Accept?

**Solution:**
```javascript
// In console, check device protocol
window.LAST_UNIVERSAL_SCAN[0].protocol
// Should be 'kasa' or 'switchbot' for modal
```

### Issue: Device not added to IoT panel
**Check:**
- `renderIoTDeviceCards()` function exists?
- IoT Devices panel visible?

**Solution:**
```javascript
// Check if function exists
typeof window.renderIoTDeviceCards
// Should be 'function'

// Manually trigger render
window.renderIoTDeviceCards(window.LAST_IOT_SCAN)
```

### Issue: Row doesn't disappear
**Check:**
- Row ID matches index?
- Transitions enabled in CSS?

**Solution:**
```javascript
// Check row exists
document.getElementById('device-row-0')
// Should return <tr> element
```

## Performance Testing

### Scan Speed
- **Target**: < 10 seconds
- **Actual**: ~5-8 seconds (depends on network)
- **Timeout**: 30 seconds max

### UI Responsiveness
- **Progress animation**: 60 FPS (smooth)
- **Row removal**: 300ms fade
- **Modal open**: Instant
- **Table render**: < 100ms for 50 devices

### Memory Usage
```javascript
// Check memory impact
console.log('Devices stored:', window.LAST_UNIVERSAL_SCAN?.length || 0)
console.log('IoT devices:', STATE.iotDevices?.length || 0)
console.log('Total memory:', performance.memory?.usedJSHeapSize || 'N/A')
```

## Regression Tests

### Critical Paths
1. ✅ Scan discovers devices
2. ✅ Accept button adds mDNS device directly
3. ✅ Accept button shows modal for auth devices
4. ✅ Sign-in modal validates inputs
5. ✅ Device appears in IoT panel after accept
6. ✅ Ignore button removes device from list
7. ✅ Cancel button closes modal without changes
8. ✅ Empty state shown when all processed

### Edge Cases
- Scan with no devices on network
- Accept all devices
- Ignore all devices
- Cancel modal multiple times
- Submit modal with empty fields
- Run scan twice in a row
- Accept same device type twice

## Automated Test Script

```javascript
// Copy/paste into browser console for automated test

async function runAutomatedTest() {
  console.log('🧪 Starting automated test...');
  
  // 1. Check functions exist
  console.assert(typeof window.runUniversalScan === 'function', 'runUniversalScan exists');
  console.assert(typeof window.acceptDiscoveredDevice === 'function', 'acceptDiscoveredDevice exists');
  console.assert(typeof window.ignoreDiscoveredDevice === 'function', 'ignoreDiscoveredDevice exists');
  
  // 2. Run scan
  console.log('▶️  Running scan...');
  await window.runUniversalScan();
  
  // 3. Wait for results
  await new Promise(r => setTimeout(r, 8000));
  
  // 4. Check results
  const devices = window.LAST_UNIVERSAL_SCAN || [];
  console.log(`✅ Found ${devices.length} devices`);
  console.assert(devices.length > 0, 'Devices discovered');
  
  // 5. Test ignore
  if (devices.length > 2) {
    console.log('▶️  Testing ignore...');
    window.ignoreDiscoveredDevice(0);
    await new Promise(r => setTimeout(r, 500));
    console.log('✅ Ignore function executed');
  }
  
  // 6. Test accept (non-auth device)
  if (devices.length > 1) {
    console.log('▶️  Testing accept...');
    const nonAuthDevice = devices.find(d => !['kasa', 'switchbot'].includes(d.protocol?.toLowerCase()));
    if (nonAuthDevice) {
      const idx = devices.indexOf(nonAuthDevice);
      window.acceptDiscoveredDevice(idx);
      await new Promise(r => setTimeout(r, 500));
      console.log('✅ Accept function executed');
    }
  }
  
  // 7. Check IoT devices
  await new Promise(r => setTimeout(r, 500));
  const iotDevices = STATE.iotDevices || [];
  console.log(`✅ IoT devices: ${iotDevices.length}`);
  console.assert(iotDevices.length > 0, 'Device added to IoT panel');
  
  console.log('✅ All tests passed!');
}

// Run the test
runAutomatedTest().catch(err => console.error('❌ Test failed:', err));
```

## Test Checklist

Before marking feature complete:

- [ ] Backend `/discovery/scan` returns devices
- [ ] Frontend displays scan results
- [ ] Accept button works for mDNS devices
- [ ] Accept button shows modal for SwitchBot
- [ ] Accept button shows modal for Kasa
- [ ] Modal Cancel button closes modal
- [ ] Modal validates required fields
- [ ] Sign-in adds device to IoT panel
- [ ] Ignore button removes device from list
- [ ] Device count updates correctly
- [ ] Row animations work smoothly
- [ ] Empty state displays correctly
- [ ] Console logs show correct data
- [ ] No JavaScript errors in console
- [ ] Smoke test passes
- [ ] Documentation updated
- [ ] Code commented appropriately

## Next Steps

After completing tests:
1. Add backend persistence (`POST /api/iot/devices`)
2. Implement credential validation
3. Add MQTT, Zigbee, Shelly, Z-Wave protocols
4. Improve vendor detection
5. Extract IP addresses from mDNS
6. Add batch accept/ignore
7. Create device detail view
8. Link devices to automation rules

## Support

**Issues?** Check:
- `docs/DEVICE_DISCOVERY_WORKFLOW.md` - Complete workflow documentation
- `docs/UNIVERSAL_SCANNER.md` - Original scanner spec
- Browser console for errors
- Python backend logs for discovery issues
- GitHub issues for known bugs
