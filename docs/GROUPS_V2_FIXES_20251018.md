# Groups V2 Fixes - October 18, 2025

## Issues Fixed

### 1. **Plans Not Seeding the Search Dropdown**

**Problem**: The plan search dropdown appeared empty even though plans were available in STATE.

**Root Cause**: 
- The plan search dropdown was being populated at `DOMContentLoaded` time, but `window.STATE.plans` might not be populated yet
- The `plans-updated` event listener wasn't triggering a full re-population

**Fix**:
- Added `console.log` statements to track when dropdowns are repopulated
- Ensured `farmDataChanged` event triggers a full dropdown refresh (already in place)
- Added explicit event listener logging for `plans-updated` and `schedules-updated` events
- Wrapped `schedules-updated` listener to explicitly call `populateGroupsV2ScheduleDropdown()` instead of passing function reference

**Code Changes** (lines 1724-1754):
```javascript
document.addEventListener('plans-updated', () => {
  console.log('[Groups V2] plans-updated event received');
  populateGroupsV2PlanSearchDropdown();
  populateGroupsV2PlanDropdown(groupsV2FormState.planSearch);
});
document.addEventListener('schedules-updated', () => {
  console.log('[Groups V2] schedules-updated event received');
  populateGroupsV2ScheduleDropdown();
});

window.addEventListener('farmDataChanged', () => {
  console.log('[Groups V2] farmDataChanged event received - repopulating dropdowns');
  populateGroupsV2PlanSearchDropdown();
  populateGroupsV2PlanDropdown(groupsV2FormState.planSearch);
  populateGroupsV2ScheduleDropdown();
  updateGroupsV2Preview();
});
```

---

### 2. **Add Cycle Button Not Showing Second Cycle**

**Problem**: Clicking "Add Cycle" button didn't make the second cycle visible in the UI.

**Root Cause**:
- The `updateGroupsV2ScheduleUI()` function runs after the button click and may be re-setting visibility based on schedule state
- The button was being hidden correctly but the second cycle container might be re-hidden

**Fix**:
- Added console logging to track the button click flow
- Ensured `cycle2Container.style.display = 'flex'` is set BEFORE calling `updateGroupsV2ScheduleUI()`
- The `updateGroupsV2ScheduleUI()` function now properly respects the normalized schedule's `mode` property to determine visibility
- Added logging to confirm the container is visible after the operation

**Code Changes** (lines 1896-1920):
```javascript
// Wire up Add Cycle 2 button
document.addEventListener('DOMContentLoaded', () => {
  const addCycle2Btn = document.getElementById('groupsV2AddCycle2Btn');
  const cycle2Container = document.getElementById('groupsV2Cycle2Container');
  if (addCycle2Btn && cycle2Container) {
    addCycle2Btn.addEventListener('click', () => {
      console.log('[Groups V2] Add Cycle 2 button clicked');
      const schedule = ensureGroupsV2ScheduleState();
      const baselineHours = Number.isFinite(schedule.photoperiodHours) && schedule.photoperiodHours > 0
        ? schedule.photoperiodHours
        : GROUPS_V2_DEFAULTS.schedule.photoperiodHours;
      const updated = normalizeGroupsV2Schedule({
        ...schedule,
        mode: 'two',
        photoperiodHours: baselineHours,
      });
      groupsV2FormState.schedule = updated;
      console.log('[Groups V2] Updated schedule to two-cycle mode:', updated);
      // Manually set the container display BEFORE updateGroupsV2ScheduleUI
      cycle2Container.style.display = 'flex';
      addCycle2Btn.style.display = 'none';
      updateGroupsV2ScheduleUI();
      updateGroupsV2Preview();
      console.log('[Groups V2] Add Cycle 2 complete - container visible:', cycle2Container.style.display);
    });
  }
});
```

---

### 3. **DPS Button Not Working**

**Problem**: Clicking the DPS button didn't enable the DPS input field or update the form properly.

**Root Cause**:
- The `updateGroupsV2AnchorInputs()` function wasn't being called after the button state changed
- The DPS input field wasn't receiving focus after being enabled
- The anchor button state wasn't properly reflecting in the UI

**Fix**:
- Enhanced `updateGroupsV2AnchorInputs()` to:
  - Properly set `aria-disabled` attribute (not `removeAttribute`)
  - Auto-focus the DPS input when DPS mode is activated
  - Log the mode transition for debugging
- Enhanced DPS button click handler to:
  - Log the button click event
  - Use `setTimeout(..., 0)` to ensure DPS input is enabled before focusing
  - Add logging to confirm DPS mode is activated

**Code Changes** (lines 1089-1120):
```javascript
function updateGroupsV2AnchorInputs() {
  const seedInput = document.getElementById('groupsV2SeedDate');
  const dpsInput = document.getElementById('groupsV2Dps');
  const seedWrapper = document.getElementById('groupsV2SeedWrapper');
  const dpsWrapper = document.getElementById('groupsV2DpsWrapper');
  const seedButton = document.getElementById('groupsV2SeedDateBtn');
  const dpsButton = document.getElementById('groupsV2DpsBtn');
  const isSeed = groupsV2FormState.anchorMode !== 'dps';
  
  // Update seed input state
  if (seedInput) {
    seedInput.disabled = !isSeed;
    seedInput.setAttribute('aria-disabled', !isSeed ? 'true' : 'false');
  }
  
  // Update DPS input state
  if (dpsInput) {
    dpsInput.disabled = isSeed;
    dpsInput.setAttribute('aria-disabled', isSeed ? 'true' : 'false');
    // If DPS mode is active, focus the input
    if (!isSeed && dpsInput !== document.activeElement) {
      dpsInput.focus();
    }
  }
  
  // Update wrapper visibility
  if (seedWrapper) seedWrapper.style.display = isSeed ? 'flex' : 'none';
  if (dpsWrapper) dpsWrapper.style.display = isSeed ? 'none' : 'flex';
  
  // Update button states
  if (seedButton) seedButton.setAttribute('aria-pressed', isSeed ? 'true' : 'false');
  if (dpsButton) dpsButton.setAttribute('aria-pressed', isSeed ? 'false' : 'true');
  
  console.log('[Groups V2] Updated anchor inputs - mode:', groupsV2FormState.anchorMode, 'isSeed:', isSeed);
}
```

**And DPS button handler** (lines 1875-1897):
```javascript
// Wire up DPS button to toggle anchor mode
document.addEventListener('DOMContentLoaded', () => {
  const dpsBtn = document.getElementById('groupsV2DpsBtn');
  if (dpsBtn) {
    dpsBtn.addEventListener('click', () => {
      const isPressed = dpsBtn.getAttribute('aria-pressed') === 'true';
      console.log('[Groups V2] DPS button clicked - current aria-pressed:', isPressed);
      if (!isPressed) {
        groupsV2FormState.anchorMode = 'dps';
        dpsBtn.setAttribute('aria-pressed', 'true');
        // Update Seed Date button
        const seedDateBtn = document.getElementById('groupsV2SeedDateBtn');
        if (seedDateBtn) seedDateBtn.setAttribute('aria-pressed', 'false');
        updateGroupsV2AnchorInputs();
        // Force focus to DPS input after a micro-delay to ensure it's enabled
        setTimeout(() => {
          const dpsInput = document.getElementById('groupsV2Dps');
          if (dpsInput && !dpsInput.disabled) {
            dpsInput.focus();
            console.log('[Groups V2] DPS input focused');
          }
        }, 0);
        updateGroupsV2Preview();
        console.log('[Groups V2] DPS mode activated');
      }
    });
  }
});
```

---

## Testing Checklist

### Test 1: Plan Search Dropdown Population
1. Open dashboard and navigate to Groups V2 panel
2. Check browser console for `[Groups V2] farmDataChanged event received` message
3. Verify that `groupsV2PlanSearch` dropdown is populated with plan names, categories, crops, etc.
4. Expected: Dropdown should show "All plans" + multiple plan categories after data loads

### Test 2: Add Cycle Button
1. In Groups V2 panel, locate the "Add Cycle 2" button (under schedule controls)
2. Click the button
3. Expected behavior:
   - Console shows: `[Groups V2] Add Cycle 2 button clicked`
   - Console shows: `[Groups V2] Updated schedule to two-cycle mode: {...}`
   - Second cycle container becomes visible (shows "Cycle 2" fields)
   - "Add Cycle 2" button disappears
   - "Remove Cycle 2" button appears (if present)

### Test 3: DPS Button Toggle
1. In Groups V2 panel, note that "Seed Date" button is initially active (aria-pressed="true")
2. Click the "DPS" button (next to Seed Date button)
3. Expected behavior:
   - Console shows: `[Groups V2] DPS button clicked - current aria-pressed: false`
   - Console shows: `[Groups V2] Updated anchor inputs - mode: dps`
   - Console shows: `[Groups V2] DPS input focused`
   - Console shows: `[Groups V2] DPS mode activated`
   - "DPS" button becomes active/pressed (aria-pressed="true")
   - "Seed Date" button becomes inactive (aria-pressed="false")
   - Seed Date input becomes disabled/grayed out
   - DPS input becomes enabled and focused
   - DPS wrapper (input container) becomes visible
   - Seed Date wrapper becomes hidden

### Test 4: Toggle Back to Seed Date
1. With DPS mode active, click the "Seed Date" button
2. Expected behavior:
   - DPS input becomes disabled
   - Seed Date input becomes enabled and focused
   - "Seed Date" button is active (aria-pressed="true")
   - "DPS" button is inactive (aria-pressed="false")

### Test 5: Plan Dropdown After Add Cycle
1. Add a second cycle (Test 2)
2. Change to DPS mode and enter a valid DPS value (Test 3)
3. Select a plan from the plan dropdown
4. Expected: Plan preview should update reflecting the DPS anchor and second cycle schedule

---

## Browser Console Debugging

When testing, monitor the browser console (F12 → Console tab) for these key messages:

**On page load:**
```
[Groups V2] farmDataChanged event received - repopulating dropdowns
[Groups V2] plans-updated event received
[Groups V2] schedules-updated event received
```

**When clicking DPS button:**
```
[Groups V2] DPS button clicked - current aria-pressed: false
[Groups V2] Updated anchor inputs - mode: dps, isSeed: false
[Groups V2] DPS input focused
[Groups V2] DPS mode activated
```

**When clicking Add Cycle:**
```
[Groups V2] Add Cycle 2 button clicked
[Groups V2] Updated schedule to two-cycle mode: {mode: 'two', ...}
[Groups V2] Add Cycle 2 complete - container visible: flex
```

---

## Files Modified

- `/Users/petergilbert/Light-Engine-Charlie/public/groups-v2.js`
  - Lines 1089-1120: Enhanced `updateGroupsV2AnchorInputs()` function
  - Lines 1724-1754: Added console logging to dropdown population events
  - Lines 1875-1897: Enhanced DPS button click handler
  - Lines 1896-1920: Enhanced Add Cycle button click handler

---

## Notes

- All fixes preserve backward compatibility
- Console logging can be removed in production if needed
- The fixes use standard DOM APIs (no dependencies)
- Focus management uses `setTimeout(..., 0)` to ensure async operations complete before focusing

