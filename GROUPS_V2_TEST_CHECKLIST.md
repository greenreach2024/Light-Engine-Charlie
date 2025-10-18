# Groups V2 Quick Test Checklist

**Date**: October 18, 2025  
**Server**: http://localhost:8091 ✅  
**Code**: All fixes applied to `public/groups-v2.js` ✅

---

## 🎯 Test Execution Checklist

### Before Starting
- [ ] Open http://localhost:8091 in browser
- [ ] Open browser console (F12 → Console tab)
- [ ] Navigate to **Groups V2** panel in dashboard
- [ ] Clear console (optional) to see fresh logs

---

### Issue #1: Plan Dropdown Not Seeding

**Test**: Verify plan dropdown populates with data

- [ ] Page loads, plan search dropdown visible
- [ ] Console shows: `[Groups V2] farmDataChanged event received`
- [ ] Console shows: `[Groups V2] plans-updated event received`
- [ ] Plan dropdown now contains multiple plan options
- [ ] Can select different plan categories

**✅ PASS** if dropdown is populated  
**❌ FAIL** if dropdown remains empty or shows only "(Unnamed)" option

---

### Issue #2: DPS Button Not Working

**Test**: Verify DPS button toggles properly and enables DPS input

#### Part A: DPS Button Activation
- [ ] Click the **DPS** button (next to "Seed Date")
- [ ] Console shows: `[Groups V2] DPS button clicked - current aria-pressed: false`
- [ ] Console shows: `[Groups V2] Updated anchor inputs - mode: dps, isSeed: false`
- [ ] Console shows: `[Groups V2] DPS input focused`
- [ ] Console shows: `[Groups V2] DPS mode activated`
- [ ] DPS button becomes visually active/highlighted
- [ ] Seed Date button becomes inactive
- [ ] Seed Date input becomes disabled/grayed out
- [ ] DPS input becomes enabled (not grayed out)

**✅ PASS** if all above occur  
**❌ FAIL** if DPS input remains disabled or unfocused

#### Part B: Toggling Back
- [ ] Click the **Seed Date** button
- [ ] Seed Date button becomes active
- [ ] DPS button becomes inactive
- [ ] DPS input becomes disabled
- [ ] Seed Date input becomes enabled

**✅ PASS** if toggle works smoothly  
**❌ FAIL** if buttons don't toggle properly

---

### Issue #3: Add Cycle Button Not Showing Second Cycle

**Test**: Verify Add Cycle button shows second cycle container

- [ ] Located and visible: **Add Cycle 2** button
- [ ] Click **Add Cycle 2** button
- [ ] Console shows: `[Groups V2] Add Cycle 2 button clicked`
- [ ] Console shows: `[Groups V2] Updated schedule to two-cycle mode: {mode: 'two',...}`
- [ ] Console shows: `[Groups V2] Add Cycle 2 complete - container visible: flex`
- [ ] Second cycle container appears (shows "Cycle 2" input fields)
- [ ] **Add Cycle 2** button disappears
- [ ] Schedule summary updates to show dual-cycle info
- [ ] Clicking **Remove Cycle** button hides the cycle 2 container
- [ ] **Add Cycle 2** button reappears

**✅ PASS** if second cycle container shows and hides properly  
**❌ FAIL** if container doesn't appear or disappears after click

---

## 🔍 Integration Test

**After all three fixes pass individually**:

1. [ ] Set plan dropdown to a specific plan
2. [ ] Toggle to DPS mode and enter a valid DPS value (e.g., 35)
3. [ ] Click "Add Cycle 2" to enable second cycle
4. [ ] Verify preview updates correctly
5. [ ] Check that schedule summary shows both cycles and DPS anchor

**✅ PASS** if all three settings work together in the preview  
**❌ FAIL** if preview doesn't update or shows incorrect info

---

## 📋 Console Log Reference

### Successful Test Run Console Output
```
[Groups V2] farmDataChanged event received - repopulating dropdowns
[Groups V2] plans-updated event received
[Groups V2] schedules-updated event received
[Groups V2] DPS button clicked - current aria-pressed: false
[Groups V2] Updated anchor inputs - mode: dps, isSeed: false
[Groups V2] DPS input focused
[Groups V2] DPS mode activated
[Groups V2] Add Cycle 2 button clicked
[Groups V2] Updated schedule to two-cycle mode: {mode: "two", photoperiodHours: 16, ...}
[Groups V2] Add Cycle 2 complete - container visible: flex
```

### Troubleshooting

If you see errors like:
- `Cannot read property 'style' of null` → Container element not found (check HTML)
- `groupsV2FormState is undefined` → Module not loaded (hard refresh page)
- `DPS input not focused` → setTimeout may be getting blocked

---

## ✅ Final Verification

After completing all tests:

- [ ] Plan dropdown populates correctly
- [ ] DPS button toggles and enables DPS input
- [ ] Add Cycle button shows second cycle
- [ ] All three work together in preview
- [ ] No console errors or warnings
- [ ] All expected console logs appear

**Final Status**: 
- ✅ **All tests pass** → Issues are **FIXED**
- ⚠️ **Some tests fail** → Check browser console for error messages

---

## 📝 Notes

- Tests assume you're in the Groups V2 panel
- Console logs use `[Groups V2]` prefix for easy filtering
- All changes are backward compatible
- No page refresh needed between tests

---

**Test Date**: ________________  
**Tester Name**: ________________  
**Result**: [ ] PASS [ ] FAIL  

