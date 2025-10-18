function toNumberOrNull(val) {
  var n = Number(val);
  return isNaN(n) ? null : n;
}

// Lightweight helpers used by Groups V2; define here if not already present on the page
if (typeof window.firstNonEmpty !== 'function') {
  window.firstNonEmpty = function firstNonEmpty() {
    for (let i = 0; i < arguments.length; i++) {
      const v = arguments[i];
      if (v === undefined || v === null) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      return v;
    }
    return null;
  };
}

if (typeof window.readPhotoperiodHours !== 'function') {
  window.readPhotoperiodHours = function readPhotoperiodHours(v) {
    if (v == null) return null;
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return null;
      // Accept formats like "18", "18h", "18 H", "18/6", "12-12" (pick first number)
      const slash = s.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
      if (slash) return Number(slash[1]);
      const dash = s.match(/^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
      if (dash) return Number(dash[1]);
      const num = s.match(/\d+(?:\.\d+)?/);
      if (num) return Number(num[0]);
      return null;
    }
    return null;
  };
}

// Derive normalized runtime hints from a plan; tolerant to various shapes
if (typeof window.derivePlanRuntime !== 'function') {
  window.derivePlanRuntime = function derivePlanRuntime(plan) {
    const out = { lightDays: [], photoperiod: null, photoperiodHours: null, ppfd: null, dli: null, spectrum: null };
    if (!plan || typeof plan !== 'object') return out;
    // Check both plan.light.days (recipe format) and plan.days (flat format)
    const daysSrc = (plan.light && Array.isArray(plan.light.days)) ? plan.light.days 
                  : Array.isArray(plan.days) ? plan.days 
                  : [];
    const lightDays = daysSrc.map((row) => {
      const day = toNumberOrNull(row?.day ?? row?.d);
      const ppfd = toNumberOrNull(row?.ppfd);
      const dli = toNumberOrNull(row?.dli);
      const stage = typeof row?.stage === 'string' ? row.stage : '';
      const photoperiod = readPhotoperiodHours(row?.photoperiod);
      // Support either "mix" or flat cw/ww/bl/rd keys
      const mixRow = (row && typeof row === 'object' && row.mix && typeof row.mix === 'object') ? row.mix : row;
      
      // DEBUG: Log raw values before creating mix
      if (day <= 3) {
        console.log(`[derivePlanRuntime] Day ${day} RAW:`, {
          rawCw: mixRow?.cw,
          rawWw: mixRow?.ww,
          rawBl: mixRow?.bl,
          rawGn: mixRow?.gn,
          rawRd: mixRow?.rd,
          rawFr: mixRow?.fr
        });
      }
      
      const mix = {
        cw: toNumberOrNull(mixRow?.cw) ?? 0,
        ww: toNumberOrNull(mixRow?.ww) ?? 0,
        bl: toNumberOrNull(mixRow?.bl ?? mixRow?.blue) ?? 0,
        gn: toNumberOrNull(mixRow?.gn ?? mixRow?.green) ?? 0,
        rd: toNumberOrNull(mixRow?.rd ?? mixRow?.red) ?? 0,
        fr: toNumberOrNull(mixRow?.fr ?? mixRow?.far_red) ?? 0,
      };
      
      // DEBUG: Log created mix
      if (day <= 3) {
        console.log(`[derivePlanRuntime] Day ${day} CREATED MIX:`, mix);
      }
      
      return { day, ppfd, dli, stage, photoperiod, mix };
    }).filter(Boolean);
    out.lightDays = lightDays;
    // Compute defaults/summary
    const defaultPhotoperiod = readPhotoperiodHours(window.firstNonEmpty(plan.photoperiod, plan.defaults?.photoperiod));
    out.photoperiod = defaultPhotoperiod;
    out.photoperiodHours = defaultPhotoperiod;
    out.ppfd = toNumberOrNull(plan.ppfd);
    out.dli = toNumberOrNull(plan.dli);
    // Spectrum: prefer plan.spectrum; else average mix over defined days; else plan.light?.mix
    if (plan.spectrum && typeof plan.spectrum === 'object') out.spectrum = plan.spectrum;
    else if (lightDays.length) {
      let cw = 0, ww = 0, bl = 0, gn = 0, rd = 0, fr = 0, c = 0;
      lightDays.forEach((d) => { 
        cw += d.mix.cw || 0; 
        ww += d.mix.ww || 0; 
        bl += d.mix.bl || 0; 
        gn += d.mix.gn || 0; 
        rd += d.mix.rd || 0; 
        fr += d.mix.fr || 0; 
        c++; 
      });
      if (c > 0) out.spectrum = { 
        cw: cw / c, 
        ww: ww / c, 
        bl: bl / c, 
        gn: gn / c, 
        rd: rd / c, 
        fr: fr / c 
      };
    } else if (plan.light && plan.light.mix) {
      out.spectrum = {
        cw: toNumberOrNull(plan.light.mix.cw) ?? 0,
        ww: toNumberOrNull(plan.light.mix.ww) ?? 0,
        bl: toNumberOrNull(plan.light.mix.bl) ?? 0,
        gn: toNumberOrNull(plan.light.mix.gn) ?? 0,
        rd: toNumberOrNull(plan.light.mix.rd) ?? 0,
        fr: toNumberOrNull(plan.light.mix.fr) ?? 0,
      };
    }
    return out;
  };
}

// Convenience getters used by Plan Card
if (typeof window.getPlanPhotoperiodHours !== 'function') {
  window.getPlanPhotoperiodHours = function getPlanPhotoperiodHours(plan) {
    const derived = plan?._derived || derivePlanRuntime(plan);
    const fromPlan = readPhotoperiodHours(window.firstNonEmpty(plan?.photoperiod, plan?.defaults?.photoperiod));
    if (fromPlan != null) return fromPlan;
    // Try first defined photoperiod on day entries
    const d = (derived.lightDays || []).find((it) => it.photoperiod != null);
    return d ? d.photoperiod : (derived?.photoperiodHours ?? null);
  };
}

if (typeof window.getPlanPPFD !== 'function') {
  window.getPlanPPFD = function getPlanPPFD(plan) {
    // Use today’s target if available
    try {
      const dayNumber = (function() {
        const seedInput = document.getElementById('groupsV2SeedDate');
        const dpsInput = document.getElementById('groupsV2Dps');
        // Basic day calc mirroring getGroupsV2DayNumber
        if (dpsInput && !dpsInput.disabled) {
          const d = toNumberOrNull(dpsInput.value);
          if (d != null) return Math.max(0, Math.round(d));
        }
        const seed = (seedInput && seedInput.value) ? new Date(seedInput.value) : null;
        if (seed && isFinite(seed.getTime())) {
          seed.setHours(0,0,0,0);
          const now = new Date(); now.setHours(0,0,0,0);
          const diff = Math.floor((now.getTime() - seed.getTime()) / (24*60*60*1000));
          return diff < 0 ? 0 : diff + 1;
        }
        return 1;
      })();
      const t = resolvePlanTargetsForDay(plan, dayNumber);
      if (t && t.ppfd != null) return t.ppfd;
    } catch {}
    const derived = plan?._derived || derivePlanRuntime(plan);
    return toNumberOrNull(window.firstNonEmpty(plan?.ppfd, derived?.ppfd));
  };
}

if (typeof window.getPlanDli !== 'function') {
  window.getPlanDli = function getPlanDli(plan) {
    try {
      const dayNumber = 1;
      const t = resolvePlanTargetsForDay(plan, dayNumber);
      if (t && t.dli != null) return t.dli;
      // If DLI not explicitly set, compute from PPFD and photoperiod
      const ppfd = window.getPlanPPFD(plan);
      const hours = window.getPlanPhotoperiodHours(plan);
      if (ppfd != null && hours != null) {
        return (ppfd * 3600 * hours) / 1e6;
      }
    } catch {}
    const derived = plan?._derived || derivePlanRuntime(plan);
    return toNumberOrNull(window.firstNonEmpty(plan?.dli, derived?.dli));
  };
}

if (typeof window.formatPlanPhotoperiodDisplay !== 'function') {
  window.formatPlanPhotoperiodDisplay = function formatPlanPhotoperiodDisplay(v) {
    if (v == null) return '—';
    const hours = readPhotoperiodHours(v);
    return (hours != null && isFinite(hours)) ? `${hours} h` : String(v);
  };
}

window.addEventListener('lightSetupsChanged', () => {
  if (!window.STATE) window.STATE = {};
  if (!Array.isArray(window.STATE.lights)) window.STATE.lights = [];
  const setups = Array.isArray(window.STATE.lightSetups) ? window.STATE.lightSetups : [];
  setups.forEach(setup => {
    (setup.fixtures || []).forEach(fixture => {
      if (!window.STATE.lights.some(l => l.id === fixture.id)) {
        window.STATE.lights.push({
          ...fixture,
          roomId: setup.room,
          zoneId: null // Unassigned by default
        });
      }
    });
  });
  document.dispatchEvent(new Event('lights-updated'));
});
document.addEventListener('DOMContentLoaded', () => {
  // Populate the Zones dropdown with Zone 1-9
  const zoneSelect = document.getElementById('groupsV2ZoneSelect');
  if (zoneSelect) {
    zoneSelect.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '(none)';
    zoneSelect.appendChild(noneOpt);
    for (let i = 1; i <= 9; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `Zone ${i}`;
      zoneSelect.appendChild(opt);
    }
  }
  // Wire up Apply to Current Plan button
  const applyPlanBtn = document.getElementById('applyPlanToGroupBtn');
  if (applyPlanBtn) {
    applyPlanBtn.addEventListener('click', () => {
      const planSelect = document.getElementById('groupsV2PlanSelect');
      const planId = groupsV2FormState.planId || (planSelect && planSelect.value);
      if (!planId) {
        alert('Select a plan to apply.');
        return;
      }
      const plans = getGroupsV2Plans();
      const plan = plans.find((p) => (p.id || p.name) === planId);
      if (!plan) {
        alert('Plan not found.');
        return;
      }
      const groups = (window.STATE && Array.isArray(window.STATE.groups)) ? window.STATE.groups : [];
      if (!groups.length) {
        alert('No group to apply plan to.');
        return;
      }
      const group = groups[groups.length - 1];
      const targetPlanId = plan.id || plan.name || planId;
      group.plan = targetPlanId ? String(targetPlanId) : '';
      const config = buildGroupsV2PlanConfig(plan);
      if (config) group.planConfig = config;
      else delete group.planConfig;
      groupsV2FormState.planId = group.plan;
      document.dispatchEvent(new Event('groups-updated'));
      updateGroupsV2Preview();
      if (typeof showToast === 'function') {
        const preview = computeGroupsV2PreviewData(plan);
        const summary = preview && preview.stage
          ? `Today: ${preview.stage} • ${Number.isFinite(preview.ppfd) ? `${Math.round(preview.ppfd)} µmol` : 'PPFD —'}`
          : 'Plan applied to current group.';
        showToast({ title: 'Plan Applied', msg: summary, kind: 'success', icon: '✅' });
      }
    });
  }
  const assignBtn = document.getElementById('assignLightsToGroupBtn');
  if (assignBtn) {
    assignBtn.addEventListener('click', () => {
      const select = document.getElementById('groupsV2UnassignedLightsSelect');
      if (!select) return;
      const selectedIds = Array.from(select.selectedOptions).map(opt => opt.value).filter(Boolean);
      if (!selectedIds.length) {
        alert('Select at least one light to assign.');
        return;
      }
      // Find the current group (last group for now)
      const groups = (window.STATE && Array.isArray(window.STATE.groups)) ? window.STATE.groups : [];
      if (!groups.length) {
        alert('No group to assign to.');
        return;
      }
      const group = groups[groups.length - 1];
      if (!Array.isArray(group.lights)) group.lights = [];
      // Add selected lights to group if not already present
      selectedIds.forEach(id => {
        if (!group.lights.some(l => l.id === id)) {
          group.lights.push({ id });
        }
        // Update the light's zoneId to mark as assigned
        const light = (window.STATE.lights || []).find(l => l.id === id);
        if (light) {
          light.zoneId = group.zone || 'assigned';
        }
      });
      document.dispatchEvent(new Event('groups-updated'));
      document.dispatchEvent(new Event('lights-updated'));
    });
  }
});
// Light spec for TopLight MH Model-300W-22G12
const TOPLIGHT_MH_300W_SPEC = {
  watts: 300,
  ppf: 709,
  ppe: 2.59,
  powerInput: '100~277VAC 50/60Hz',
  colorRange: '400-700',
  uv: 'NO',
  farRed: 'NO',
  spectrumBooster: 'BLUE',
  factoryDefaultRatio: '0.68:1',
  bestRatioRange: '0.68:1~2:1',
  dimming: 'YES',
  controlBox: 'YES',
  app: 'YES',
  bluetooth: 'YES',
  wifi: 'YES',
  lynx3: 'YES',
  smartune: 'YES',
  cooling: 'PASSIVE, FANLESS COOLING',
  dimensions: '1240mm x 140mm x 76 mm (48.4\" x 5.5\" x 3.0\")',
  weight: '6.35 kg (14 lbs)',
  ipRating: 'IP66',
};

function renderLightInfoCard(light) {
  if (!light) return '';
  // Try to find the full light object from STATE.lights by id or serial
  const db = (window.STATE && Array.isArray(window.STATE.lights)) ? window.STATE.lights : [];
  const dbLight = db.find(l => l.id === light.id || l.serial === light.serial) || light;
  // Show all available fields
  let html = '';
  Object.entries(dbLight).forEach(([key, value]) => {
    if (typeof value === 'object' && value !== null) return;
    html += `<div><strong>${key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}:</strong> ${value ?? ''}</div>`;
  });
  // Add spectra graph if spectra breakdown is available
  if (dbLight.spectrum || dbLight.spectra) {
    const spectrum = dbLight.spectrum || dbLight.spectra;
    html += '<div style="margin-top:10px;"><canvas id="lightInfoSpectrumCanvas" width="300" height="60" style="border-radius:6px; background:#f8fafc; box-shadow:0 1px 4px #0001;"></canvas></div>';
    setTimeout(() => {
      const canvas = document.getElementById('lightInfoSpectrumCanvas');
      if (canvas && typeof renderSpectrumCanvas === 'function') {
        // If spectrum is already SPD, use as is; else compute SPD
        let spd = typeof computeWeightedSPD === 'function' ? computeWeightedSPD(spectrum) : spectrum;
        renderSpectrumCanvas(canvas, spd, { width: canvas.width, height: canvas.height });
      }
    }, 0);
  }
  if (!html) html = '<em>No info available for this light.</em>';
  return html;
}

// Show light info card when a light is highlighted in the unassigned lights field
document.addEventListener('DOMContentLoaded', () => {
  const unassignedSelect = document.getElementById('groupsV2UnassignedLightsSelect');
  const card = document.getElementById('lightInfoCard');
  const cardBody = document.getElementById('lightInfoCardBody');
  if (!unassignedSelect || !card || !cardBody) return;
  function updateCard() {
    const lights = (window.STATE && Array.isArray(window.STATE.lights)) ? window.STATE.lights : [];
    const selectedId = unassignedSelect.value;
    const light = lights.find(l => l.id === selectedId || l.serial === selectedId);
    if (light) {
      cardBody.innerHTML = renderLightInfoCard(light);
      card.style.display = '';
    } else {
      cardBody.innerHTML = '';
      card.style.display = 'none';
    }
  }
  unassignedSelect.addEventListener('change', updateCard);
  unassignedSelect.addEventListener('focus', updateCard);
  unassignedSelect.addEventListener('click', updateCard);
  // Show info for first light if present
  setTimeout(updateCard, 100);
});
// Hard code five lights for room GreenReach
document.addEventListener('DOMContentLoaded', () => {
  if (!window.STATE) window.STATE = {};
  if (!Array.isArray(window.STATE.lights)) window.STATE.lights = [];
  const greenReachLights = [
    {
      id: '22G12-001',
      name: 'TopLight MH Model-300W-22G12',
      serial: '22G12-001',
      manufacturer: 'TopLight',
      room: 'GreenReach',
      roomId: 'GreenReach',
      zoneId: undefined,
      watts: 300,
      ppf: 709,
      ppe: 2.59,
      tunable: true,
      dimmable: true,
      comm: 'WiFi',
      spectrum: { blue: 45, green: 5, red: 45, farRed: 5 },
      colorRange: '400-700'
    },
    {
      id: '22G12-002',
      name: 'TopLight MH Model-300W-22G12',
      serial: '22G12-002',
      manufacturer: 'TopLight',
      room: 'GreenReach',
      roomId: 'GreenReach',
      zoneId: undefined,
      watts: 300,
      ppf: 709,
      ppe: 2.59,
      tunable: true,
      dimmable: true,
      comm: 'WiFi',
      spectrum: { blue: 45, green: 5, red: 45, farRed: 5 },
      colorRange: '400-700'
    },
    {
      id: 'VERTIMAX-001',
      name: 'P.L. Light VertiMax 640W',
      serial: 'VERTIMAX-001',
      manufacturer: 'P.L. Light Systems',
      room: 'GreenReach',
      roomId: 'GreenReach',
      zoneId: undefined,
      watts: 640,
      ppf: 1738,
      ppe: 2.7,
      tunable: false,
      dimmable: true,
      comm: '0-10V',
      colorRange: '400-700',
      spectrum: null
    },
    {
      id: 'FLUENCE-001',
      name: 'Fluence SPYDR 2x',
      serial: 'FLUENCE-001',
      manufacturer: 'Fluence',
      room: 'GreenReach',
      roomId: 'GreenReach',
      zoneId: undefined,
      watts: 685,
      ppf: 1700,
      ppe: 2.5,
      tunable: false,
      dimmable: true,
      comm: 'BLE',
      colorRange: '400-700',
      spectrum: null
    },
    {
      id: 'GENERIC-PLUG-001',
      name: 'Generic LED via Smart Plug',
      serial: 'GENERIC-PLUG-001',
      manufacturer: 'Generic',
      room: 'GreenReach',
      roomId: 'GreenReach',
      zoneId: undefined,
      watts: 100,
      ppf: 220,
      ppe: 2.2,
      tunable: false,
      dimmable: false,
      comm: 'SmartPlug',
      smartPlug: true,
      colorRange: '400-700',
      spectrum: null
    },
  ];
  // Add if not already present
  greenReachLights.forEach(light => {
    if (!window.STATE.lights.some(l => l.id === light.id)) {
      window.STATE.lights.push(light);
    }
  });
  // Optionally trigger update event
  document.dispatchEvent(new Event('lights-updated'));
});
// Handle Save New Group button for Groups V2 card
document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('groupsV2SaveGroup');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const nameInput = document.getElementById('groupsV2ZoneName');
      const zoneSelect = document.getElementById('groupsV2ZoneSelect');
      const roomSelect = document.getElementById('groupsV2RoomSelect');
      if (!nameInput || !zoneSelect || !roomSelect) return;
      const groupName = nameInput.value.trim();
      const zone = zoneSelect.value;
      const room = roomSelect.value;
      if (!groupName || !zone || !room) {
        alert('Enter a group name, select a room, and select a zone.');
        return;
      }
      // Add to window.STATE.groups
      if (!window.STATE) window.STATE = {};
      if (!Array.isArray(window.STATE.groups)) window.STATE.groups = [];
      // Generate a unique id
      const id = `${room}:${zone}:${groupName}`;
      // Check for existing group with same id
      const exists = window.STATE.groups.find(g => (g.id === id || (g.room === room && g.zone === zone && g.name === groupName)));
      if (exists) {
        alert('A group with this name, room, and zone already exists.');
        return;
      }
      const plan = getGroupsV2SelectedPlan();
      const planId = groupsV2FormState.planId || plan?.id || plan?.name || '';
      const groupRecord = { id, name: groupName, room, zone };
      if (planId) groupRecord.plan = planId;
      const config = buildGroupsV2PlanConfig(plan);
      if (config) groupRecord.planConfig = config;
      window.STATE.groups.push(groupRecord);
      const statusEl = document.getElementById('groupsV2Status');
      let scheduleMessage = '';
      try {
        const scheduleConfig = buildGroupsV2ScheduleConfig();
        const result = await upsertGroupScheduleForGroup(id, scheduleConfig, { name: `${groupName} Schedule` });
        const schedule = result?.schedule
          || (Array.isArray(result?.schedules) ? result.schedules.find((entry) => entry && entry.groupId === id) : null);
        if (schedule) {
          mergeScheduleIntoState(schedule);
          groupRecord.schedule = schedule.id || schedule.groupId;
          scheduleMessage = ' • Schedule linked';
        }
      } catch (error) {
        console.warn('[groups-v2] Failed to upsert schedule', error);
        if (typeof showToast === 'function') {
          showToast({ title: 'Schedule not saved', msg: error?.message || 'Failed to sync schedule.', kind: 'warn', icon: '⚠️' });
        }
        scheduleMessage = ' • Schedule sync failed';
      }
      // Dispatch event to update dropdown
      document.dispatchEvent(new Event('groups-updated'));
      // Optionally clear the input
      nameInput.value = '';
      // Optionally show a toast
      if (typeof showToast === 'function') {
        const details = [`${groupName} (${room}:${zone})`];
        if (planId) details.push(`Plan ${plan?.name || planId}`);
        if (scheduleMessage.includes('failed')) {
          showToast({ title: 'Group Saved', msg: `${details.join(' • ')}${scheduleMessage}`, kind: 'warn', icon: '⚠️' });
        } else {
          showToast({ title: 'Group Saved', msg: `${details.join(' • ')}${scheduleMessage}`, kind: 'success', icon: '✅' });
        }
      }
      if (statusEl) {
        statusEl.textContent = `Saved group ${groupName}${scheduleMessage}`;
      }
    });
  }
});
// Assign selected lights to the zone selected at the top
document.addEventListener('DOMContentLoaded', () => {
  // Removed zone assignment logic from light setup as per new process
});

// Assign selected equipment to the zone selected at the top
document.addEventListener('DOMContentLoaded', () => {
  // Removed zone assignment logic from equipment setup as per new process
});
// Populate Unassigned Lights dropdown from light setup wizard
function populateGroupsV2UnassignedLightsDropdown() {
  const select = document.getElementById('groupsV2UnassignedLightsSelect');
  if (!select) return;
  select.innerHTML = '';
  const lights = (window.STATE && Array.isArray(window.STATE.lights)) ? window.STATE.lights : [];
  // Only show lights assigned to a room but not yet assigned to a zone
  const unassigned = lights.filter(light => light.roomId && !light.zoneId);
  if (unassigned.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(none)';
    select.appendChild(opt);
    return;
  }
  unassigned.forEach(light => {
  const opt = document.createElement('option');
  opt.value = light.id || light.name || '';
  // Show name and S/N (ID) for clarity
  const label = light.name ? `${light.name} (S/N: ${light.id || ''})` : (light.id || '(unnamed light)');
  opt.textContent = label;
  select.appendChild(opt);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // ...existing code...
  populateGroupsV2UnassignedLightsDropdown();
  document.addEventListener('lights-updated', populateGroupsV2UnassignedLightsDropdown);
});

// Assign selected lights to selected zone (in group card context)
document.addEventListener('DOMContentLoaded', () => {
  const assignBtn = document.getElementById('assignLightsToZoneBtn');
  if (assignBtn) {
    assignBtn.addEventListener('click', () => {
      const lightsSelect = document.getElementById('groupsV2UnassignedLightsSelect');
      const zoneSelect = document.getElementById('groupsV2ZoneSelect');
      if (!lightsSelect || !zoneSelect) return;
      const selectedLights = Array.from(lightsSelect.selectedOptions).map(opt => opt.value).filter(Boolean);
      const selectedZone = zoneSelect.value;
      if (!selectedZone || selectedLights.length === 0) {
        alert('Select lights and a zone to assign.');
        return;
      }
      // Dispatch a custom event to handle assignment logic elsewhere
      const evt = new CustomEvent('assign-lights-to-zone', {
        detail: { lightIds: selectedLights, zoneId: selectedZone }
      });
      document.dispatchEvent(evt);
    });
  }
});
// Populate Unassigned Equipment dropdown from equipment setup wizard
function populateGroupsV2UnassignedEquipDropdown() {
  const select = document.getElementById('groupsV2UnassignedEquipSelect');
  if (!select) return;
  select.innerHTML = '';
  const equipment = (window.STATE && Array.isArray(window.STATE.equipment)) ? window.STATE.equipment : [];
  // Only show equipment assigned to a room but not yet assigned to a zone
  const unassigned = equipment.filter(eq => (eq.roomId || eq.room) && !eq.zoneId);
  if (unassigned.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(none)';
    select.appendChild(opt);
    return;
  }
  unassigned.forEach(eq => {
    const opt = document.createElement('option');
    opt.value = eq.id || eq.name || '';
    opt.textContent = eq.name || eq.label || eq.id || '(unnamed equipment)';
    select.appendChild(opt);
  });
}

// Populate Assigned Equipment dropdown for Groups V2
function populateGroupsV2AssignedEquipDropdown() {
  const select = document.getElementById('assignedEquipSelect');
  if (!select) return;
  select.innerHTML = '';
  const equipment = (window.STATE && Array.isArray(window.STATE.equipment)) ? window.STATE.equipment : [];
  // Only show equipment assigned to a zone
  const assigned = equipment.filter(eq => eq.zoneId);
  if (assigned.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(none)';
    select.appendChild(opt);
    return;
  }
  assigned.forEach(eq => {
    const opt = document.createElement('option');
    opt.value = eq.id || eq.name || '';
    opt.textContent = eq.name || eq.label || eq.id || '(unnamed equipment)';
    select.appendChild(opt);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // ...existing code...
  populateGroupsV2UnassignedEquipDropdown();
  populateGroupsV2AssignedEquipDropdown();
  document.addEventListener('equipment-updated', populateGroupsV2UnassignedEquipDropdown);
  document.addEventListener('equipment-updated', populateGroupsV2AssignedEquipDropdown);
});

// Assign selected equipment to selected zone (in group card context)
document.addEventListener('DOMContentLoaded', () => {
  const assignBtn = document.getElementById('assignEquipToZoneBtn');
  if (assignBtn) {
    assignBtn.addEventListener('click', () => {
      const equipSelect = document.getElementById('groupsV2UnassignedEquipSelect');
      const zoneSelect = document.getElementById('groupsV2ZoneSelect');
      if (!equipSelect || !zoneSelect) return;
      const selectedEquip = Array.from(equipSelect.selectedOptions).map(opt => opt.value).filter(Boolean);
      const selectedZone = zoneSelect.value;
      if (!selectedZone || selectedEquip.length === 0) {
        alert('Select equipment and a zone to assign.');
        return;
      }
      // Mark equipment as assigned by updating zoneId
      (window.STATE.equipment || []).forEach(eq => {
        if (selectedEquip.includes(eq.id)) {
          eq.zoneId = selectedZone;
        }
      });
      document.dispatchEvent(new Event('equipment-updated'));
    });
  }
});

const GROUPS_V2_DEFAULTS = {
  schedule: {
    mode: 'one',
    timezone: 'America/Toronto',
    startTime: '08:00',
    photoperiodHours: 12,
    cycles: [
      { on: '08:00', hours: 12, off: '20:00' },
      { on: '20:00', hours: 6, off: '02:00' },
    ],
    rampUpMin: 10,
    rampDownMin: 10,
  },
  gradients: { ppfd: 0, blue: 0, tempC: 0, rh: 0 },
};

function normalizePhotoperiodHours(hours, maxHours = 24) {
  const num = Number(hours);
  if (!Number.isFinite(num)) return 0;
  const safeMax = Number.isFinite(maxHours) ? Math.max(0, maxHours) : 24;
  const clamped = Math.max(0, Math.min(safeMax, num));
  return Math.round(clamped * 4) / 4;
}

function normalizeTimeString(value, fallback = '08:00') {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
      const minutes = toMinutes(trimmed);
      if (Number.isFinite(minutes)) {
        return minutesToHHMM(minutes);
      }
    }
  }
  return typeof fallback === 'string' && fallback ? fallback : '08:00';
}

function distributeMinutes(total, parts) {
  const safeTotal = Math.max(0, Math.round(Number(total) || 0));
  const safeParts = Math.max(1, Math.round(Number(parts) || 1));
  const base = Math.floor(safeTotal / safeParts);
  const remainder = safeTotal - base * safeParts;
  return Array.from({ length: safeParts }, (_, index) => base + (index < remainder ? 1 : 0));
}

function generateGroupsV2Cycles(mode, startTime, photoperiodHours) {
  const normalizedMode = mode === 'two' ? 'two' : 'one';
  const safeStart = normalizeTimeString(startTime, GROUPS_V2_DEFAULTS.schedule.startTime);
  const normalizedHours = normalizePhotoperiodHours(photoperiodHours);
  const totalOnMinutes = Math.max(0, Math.round(normalizedHours * 60));
  const totalOffMinutes = Math.max(0, 1440 - totalOnMinutes);
  const cycleCount = normalizedMode === 'two' ? 2 : 1;
  const onMinutesParts = distributeMinutes(totalOnMinutes, cycleCount);
  const offMinutesParts = distributeMinutes(totalOffMinutes, cycleCount);
  let cursor = toMinutes(safeStart);
  if (!Number.isFinite(cursor)) cursor = toMinutes(GROUPS_V2_DEFAULTS.schedule.startTime);
  if (!Number.isFinite(cursor)) cursor = 0;
  const cycles = [];
  for (let i = 0; i < cycleCount; i += 1) {
    const onMinutes = onMinutesParts[i];
    const offMinutes = offMinutesParts[i];
    const cycleOn = minutesToHHMM(cursor);
    const cycleOff = minutesToHHMM(cursor + onMinutes);
    cycles.push({ on: cycleOn, off: cycleOff, hours: onMinutes / 60 });
    cursor = (cursor + onMinutes + offMinutes) % 1440;
  }
  return { startTime: safeStart, photoperiodHours: normalizedHours, cycles };
}

function computePhotoperiodFromCycles(rawCycles, mode, fallbackHours) {
  if (Array.isArray(rawCycles) && rawCycles.length) {
    const activeCount = mode === 'two' ? 2 : 1;
    let total = 0;
    for (let i = 0; i < activeCount; i += 1) {
      const entry = rawCycles[i];
      if (!entry) continue;
      const directHours = toNumberOrNull(entry.hours);
      if (Number.isFinite(directHours)) {
        total += directHours;
        continue;
      }
      const duration = computeCycleDuration(entry.on, entry.off) / 60;
      if (Number.isFinite(duration)) total += duration;
    }
    if (total > 0) return total;
  }
  return Number.isFinite(fallbackHours) ? fallbackHours : GROUPS_V2_DEFAULTS.schedule.photoperiodHours;
}

function createDefaultGroupsV2Schedule() {
  const defaults = GROUPS_V2_DEFAULTS.schedule;
  const baseMode = defaults.mode === 'two' ? 'two' : 'one';
  const start = normalizeTimeString(defaults.startTime, defaults.cycles[0]?.on || '08:00');
  const photoperiod = normalizePhotoperiodHours(
    Number.isFinite(defaults.photoperiodHours)
      ? defaults.photoperiodHours
      : computePhotoperiodFromCycles(defaults.cycles, baseMode, 12),
  );
  const generated = generateGroupsV2Cycles('two', start, photoperiod);
  return {
    mode: baseMode,
    timezone: defaults.timezone,
    startTime: generated.startTime,
    photoperiodHours: generated.photoperiodHours,
    cycles: generated.cycles,
    rampUpMin: defaults.rampUpMin,
    rampDownMin: defaults.rampDownMin,
  };
}

function normalizeCycleHours(hours) {
  const num = Number(hours);
  if (!Number.isFinite(num)) return 0;
  const clamped = Math.max(0, Math.min(24, num));
  return Math.round(clamped * 2) / 2;
}

function computeGroupsV2CycleOff(on, hours) {
  if (typeof on !== 'string' || !on) return null;
  const match = on.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const minutes = toMinutes(on);
  if (!Number.isFinite(minutes)) return null;
  const durationMinutes = Math.max(0, Math.round(normalizeCycleHours(hours) * 60));
  return minutesToHHMM(minutes + durationMinutes);
}

function formatCycleHoursValue(hours) {
  if (!Number.isFinite(hours)) return '';
  const normalized = Math.max(0, Number(hours));
  if (Math.abs(normalized - Math.round(normalized)) < 1e-6) {
    return String(Math.round(normalized));
  }
  if (Math.abs(normalized * 10 - Math.round(normalized * 10)) < 1e-6) {
    return (Math.round(normalized * 10) / 10).toFixed(1).replace(/\.0$/, '');
  }
  return (Math.round(normalized * 100) / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}

function normalizeGroupsV2Schedule(schedule) {
  const defaults = createDefaultGroupsV2Schedule();
  const base = schedule && typeof schedule === 'object' ? schedule : {};
  const inferredCycles = base.cyclesSelected === 2 || base.mode === 'two' ? 2 : 1;
  const mode = inferredCycles === 2 ? 'two' : 'one';
  const timezone = typeof base.timezone === 'string' && base.timezone ? base.timezone : defaults.timezone;
  const rampUpMin = toNumberOrNull(base.cycleA?.rampUpMin ?? base.rampUpMin) ?? defaults.rampUpMin;
  const rampDownMin = toNumberOrNull(base.cycleA?.rampDownMin ?? base.rampDownMin) ?? defaults.rampDownMin;
  const startCandidate = normalizeTimeString(
    base.cycleA?.start
      ?? base.startTime
      ?? base.start
      ?? (Array.isArray(base.cycles) && base.cycles[0]?.on),
    defaults.startTime,
  );
  let providedPhotoperiod = toNumberOrNull(base.photoperiodHours ?? base.durationHours);
  if (!Number.isFinite(providedPhotoperiod)) {
    const cycleAOn = toNumberOrNull(base.cycleA?.onHours);
    const cycleBOn = toNumberOrNull(base.cycleB?.onHours);
    if (Number.isFinite(cycleAOn)) {
      if (mode === 'two') {
        if (Number.isFinite(cycleBOn)) providedPhotoperiod = Math.max(0, cycleAOn + cycleBOn);
        else providedPhotoperiod = Math.max(0, cycleAOn * 2);
      } else {
        providedPhotoperiod = Math.max(0, cycleAOn);
      }
    }
  }
  const fallbackPhotoperiod = computePhotoperiodFromCycles(base.cycles, mode, defaults.photoperiodHours);
  const photoperiodHours = normalizePhotoperiodHours(
    Number.isFinite(providedPhotoperiod) ? providedPhotoperiod : fallbackPhotoperiod,
  );
  const generated = generateGroupsV2Cycles(mode, startCandidate, photoperiodHours);
  const twoCycle = generateGroupsV2Cycles('two', generated.startTime, generated.photoperiodHours).cycles;
  return {
    mode,
    timezone,
    rampUpMin,
    rampDownMin,
    startTime: generated.startTime,
    photoperiodHours: generated.photoperiodHours,
    cycles: twoCycle,
  };
}

function ensureGroupsV2ScheduleState() {
  const normalized = normalizeGroupsV2Schedule(groupsV2FormState.schedule);
  groupsV2FormState.schedule = normalized;
  return normalized;
}

function hydrateGroupsV2ScheduleState(scheduleCfg) {
  const defaults = createDefaultGroupsV2Schedule();
  if (!scheduleCfg || typeof scheduleCfg !== 'object') return createDefaultGroupsV2Schedule();
  const inferredCycles = scheduleCfg.cyclesSelected === 2 || scheduleCfg.mode === 'two' ? 2 : 1;
  const mode = inferredCycles === 2 ? 'two' : 'one';
  const timezone = typeof scheduleCfg.timezone === 'string' && scheduleCfg.timezone
    ? scheduleCfg.timezone
    : defaults.timezone;
  const rampUpMin = toNumberOrNull(scheduleCfg.cycleA?.rampUpMin ?? scheduleCfg.rampUpMin) ?? defaults.rampUpMin;
  const rampDownMin = toNumberOrNull(scheduleCfg.cycleA?.rampDownMin ?? scheduleCfg.rampDownMin) ?? defaults.rampDownMin;
  const baseCycles = Array.isArray(scheduleCfg.cycles)
    ? scheduleCfg.cycles.slice(0, 2).map((cycle) => ({ ...cycle }))
    : [];
  const cycleAStart = scheduleCfg.cycleA?.start
    ?? scheduleCfg.startTime
    ?? scheduleCfg.start
    ?? (baseCycles[0]?.on ?? defaults.startTime);
  const cycleAOn = toNumberOrNull(scheduleCfg.cycleA?.onHours);
  const cycleBOn = toNumberOrNull(scheduleCfg.cycleB?.onHours);
  let photoperiodHours = toNumberOrNull(scheduleCfg.photoperiodHours ?? scheduleCfg.durationHours);
  if (!Number.isFinite(photoperiodHours) && Number.isFinite(cycleAOn)) {
    if (mode === 'two') {
      photoperiodHours = Number.isFinite(cycleBOn) ? cycleAOn + cycleBOn : cycleAOn * 2;
    } else {
      photoperiodHours = cycleAOn;
    }
  }
  if (!baseCycles.length && typeof cycleAStart === 'string') {
    const perCycle = Number.isFinite(cycleAOn)
      ? cycleAOn
      : mode === 'two'
        ? normalizePhotoperiodHours(photoperiodHours ?? defaults.photoperiodHours, 24) / 2
        : normalizePhotoperiodHours(photoperiodHours ?? defaults.photoperiodHours, 24);
    const cycleAOff = computeGroupsV2CycleOff(cycleAStart, perCycle);
    baseCycles.push({ on: cycleAStart, off: cycleAOff, hours: perCycle });
    if (mode === 'two') {
      const windowHours = Number.isFinite(scheduleCfg.constraints?.windowHours)
        ? scheduleCfg.constraints.windowHours
        : 12;
      const startB = scheduleCfg.cycleB?.start
        ?? minutesToHHMM((toMinutes(cycleAStart) + Math.max(0, Number(windowHours)) * 60) % 1440);
      const perCycleB = Number.isFinite(cycleBOn) ? cycleBOn : perCycle;
      const cycleBOff = computeGroupsV2CycleOff(startB, perCycleB);
      baseCycles.push({ on: startB, off: cycleBOff, hours: perCycleB });
    }
  }
  const base = {
    mode,
    timezone,
    rampUpMin,
    rampDownMin,
    startTime: cycleAStart ?? defaults.startTime,
    photoperiodHours,
    cycles: baseCycles,
    cyclesSelected: inferredCycles,
    cycleA: scheduleCfg.cycleA,
    cycleB: scheduleCfg.cycleB,
    constraints: scheduleCfg.constraints,
  };
  return normalizeGroupsV2Schedule(base);
}

function buildGroupsV2ScheduleConfig() {
  const scheduleState = ensureGroupsV2ScheduleState();
  const defaults = createDefaultGroupsV2Schedule();
  const mode = scheduleState.mode === 'two' ? 'two' : 'one';
  const timezone = typeof scheduleState.timezone === 'string' && scheduleState.timezone
    ? scheduleState.timezone
    : defaults.timezone;
  const startTime = normalizeTimeString(scheduleState.startTime, defaults.startTime);
  const basePhotoperiod = Number.isFinite(scheduleState.photoperiodHours)
    ? scheduleState.photoperiodHours
    : defaults.photoperiodHours;
  const cycleOnHours = mode === 'two'
    ? normalizePhotoperiodHours(basePhotoperiod / 2, 12)
    : normalizePhotoperiodHours(basePhotoperiod, 24);
  const totalOnHours = mode === 'two' ? cycleOnHours * 2 : cycleOnHours;
  let rampUpMin = toNumberOrNull(scheduleState.rampUpMin) ?? defaults.rampUpMin;
  let rampDownMin = toNumberOrNull(scheduleState.rampDownMin) ?? defaults.rampDownMin;
  rampUpMin = Math.max(0, Math.min(120, rampUpMin));
  rampDownMin = Math.max(0, Math.min(120, rampDownMin));
  const maxRampTotal = Math.max(0, cycleOnHours * 60);
  if (rampUpMin + rampDownMin > maxRampTotal) {
    if (rampUpMin >= maxRampTotal) {
      rampUpMin = maxRampTotal;
      rampDownMin = 0;
    } else {
      rampDownMin = maxRampTotal - rampUpMin;
    }
  }
  const windowHours = mode === 'two' ? 12 : 24;
  const startMinutes = toMinutes(startTime);
  const cycleADurationMinutes = Math.max(0, Math.round(cycleOnHours * 60));
  const cycleAOff = minutesToHHMM((startMinutes + cycleADurationMinutes) % 1440);
  let cycleBStart = null;
  let cycleBOff = null;
  if (mode === 'two') {
    const startBMinutes = (startMinutes + windowHours * 60) % 1440;
    cycleBStart = minutesToHHMM(startBMinutes);
    cycleBOff = minutesToHHMM((startBMinutes + cycleADurationMinutes) % 1440);
  }
  const selectedCycles = [
    { on: startTime, off: cycleAOff, hours: cycleOnHours },
  ];
  if (mode === 'two' && cycleBStart) {
    selectedCycles.push({ on: cycleBStart, off: cycleBOff, hours: cycleOnHours });
  }
  const scheduleConfig = {
    period: 'photoperiod',
    cyclesSelected: mode === 'two' ? 2 : 1,
    timezone,
    cycleA: { start: startTime, onHours: cycleOnHours, rampUpMin, rampDownMin },
    cycleB: mode === 'two'
      ? { start: cycleBStart, onHours: cycleOnHours, rampUpMin, rampDownMin }
      : null,
    mode,
    startTime,
    photoperiodHours: totalOnHours,
    durationHours: totalOnHours,
    rampUpMin,
    rampDownMin,
    cycles: selectedCycles,
    totalOnHours,
    totalOffHours: Math.max(0, 24 - totalOnHours),
  };
  if (mode === 'two') {
    scheduleConfig.constraints = { windowHours };
  }
  return scheduleConfig;
}

function getApiBase() {
  if (typeof window !== 'undefined' && typeof window.API_BASE === 'string') {
    const trimmed = window.API_BASE.trim();
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  }
  return '';
}

function buildScheduleCyclesPayload(scheduleConfig) {
  const cycles = Array.isArray(scheduleConfig?.cycles) ? scheduleConfig.cycles : [];
  const rampUp = toNumberOrNull(scheduleConfig?.rampUpMin);
  const rampDown = toNumberOrNull(scheduleConfig?.rampDownMin);
  const rampPayload = {};
  if (Number.isFinite(rampUp) && rampUp >= 0) rampPayload.up = rampUp;
  if (Number.isFinite(rampDown) && rampDown >= 0) rampPayload.down = rampDown;
  const includeRamp = Object.keys(rampPayload).length > 0;

  return cycles.slice(0, 2).map((cycle) => {
    if (!cycle) return null;
    const rawStart = typeof cycle.on === 'string' && cycle.on ? cycle.on : cycle.start;
    const start = normalizeTimeString(rawStart, '00:00');
    const rawOff = typeof cycle.off === 'string' && cycle.off ? cycle.off : cycle.end;
    let off = rawOff ? normalizeTimeString(rawOff, null) : null;
    let photo = toNumberOrNull(cycle.hours ?? cycle.photo);
    if (!Number.isFinite(photo)) {
      const duration = typeof computeCycleDuration === 'function'
        ? computeCycleDuration(rawStart || start, rawOff || off || start)
        : null;
      if (Number.isFinite(duration)) {
        photo = duration / 60;
      }
    }
    if (!Number.isFinite(photo)) photo = 0;
    photo = Math.max(0, Math.min(24, photo));
    if (!off) {
      const baseMinutes = typeof toMinutes === 'function' ? toMinutes(start) : null;
      const computedMinutes = Number.isFinite(baseMinutes)
        ? baseMinutes + Math.round(photo * 60)
        : Math.round(photo * 60);
      off = minutesToHHMM(computedMinutes);
    }
    const payload = {
      start,
      off,
      photo,
    };
    if (includeRamp) {
      payload.ramp = { ...rampPayload };
    }
    if (cycle.spectrum && typeof cycle.spectrum === 'object') {
      payload.spectrum = cycle.spectrum;
    }
    return payload;
  }).filter(Boolean);
}

function buildSchedulePayload(groupId, scheduleConfig, metadata = {}) {
  if (!groupId) return null;
  const cycles = buildScheduleCyclesPayload(scheduleConfig);
  if (!cycles.length) return null;
  const payload = {
    groupId,
    cycles,
  };
  if (metadata && typeof metadata.name === 'string' && metadata.name.trim()) {
    payload.name = metadata.name.trim();
  }
  if (typeof scheduleConfig?.mode === 'string') {
    payload.mode = scheduleConfig.mode;
  }
  if (typeof scheduleConfig?.timezone === 'string' && scheduleConfig.timezone) {
    payload.timezone = scheduleConfig.timezone;
  }
  const photoperiod = toNumberOrNull(scheduleConfig?.photoperiodHours);
  if (Number.isFinite(photoperiod)) {
    payload.photoperiodHours = photoperiod;
  }
  return payload;
}

async function upsertGroupScheduleForGroup(groupId, scheduleConfig, metadata = {}) {
  const payload = buildSchedulePayload(groupId, scheduleConfig, metadata);
  if (!payload) {
    throw new Error('Unable to build schedule payload.');
  }
  const apiBase = getApiBase();
  const url = `${apiBase}/sched/${encodeURIComponent(groupId)}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Failed to save schedule (HTTP ${response.status})`);
  }
  return response.json();
}

function mergeScheduleIntoState(schedule) {
  if (!schedule || typeof schedule !== 'object') return;
  if (!window.STATE) window.STATE = {};
  if (!Array.isArray(window.STATE.schedules)) window.STATE.schedules = [];
  const idx = window.STATE.schedules.findIndex((entry) => entry && entry.groupId === schedule.groupId);
  if (idx >= 0) {
    window.STATE.schedules[idx] = schedule;
  } else {
    window.STATE.schedules.push(schedule);
  }
  document.dispatchEvent(new Event('schedules-updated'));
}

function updateGroupsV2ScheduleUI() {
  const scheduleState = ensureGroupsV2ScheduleState();
  const defaults = createDefaultGroupsV2Schedule();
  const mode = scheduleState.mode === 'two' ? 'two' : 'one';
  const modeRadios = document.querySelectorAll('input[name="groupsV2ScheduleMode"]');
  modeRadios.forEach((radio) => {
    radio.checked = radio.value === mode;
  });
  const startTime = normalizeTimeString(scheduleState.startTime, defaults.startTime);
  const photoperiodHours = normalizePhotoperiodHours(
    Number.isFinite(scheduleState.photoperiodHours)
      ? scheduleState.photoperiodHours
      : defaults.photoperiodHours,
  );
  const singleCycle = generateGroupsV2Cycles('one', startTime, photoperiodHours).cycles[0];
  const twoCycles = generateGroupsV2Cycles('two', startTime, photoperiodHours).cycles;

  const c1OnInput = document.getElementById('groupsV2Cycle1On');
  if (c1OnInput) c1OnInput.value = singleCycle?.on || startTime;
  const c1HoursInput = document.getElementById('groupsV2Cycle1Hours');
  if (c1HoursInput) {
    const cycleHours = mode === 'two'
      ? twoCycles[0]?.hours ?? photoperiodHours / 2
      : singleCycle?.hours ?? photoperiodHours;
    c1HoursInput.value = formatCycleHoursValue(cycleHours);
    c1HoursInput.max = mode === 'two' ? '12' : '24';
    c1HoursInput.setAttribute('max', mode === 'two' ? '12' : '24');
  }
  const c1End = document.getElementById('groupsV2Cycle1End');
  if (c1End) {
    const endLabel = mode === 'two' ? twoCycles[0]?.off : singleCycle?.off;
    c1End.textContent = `End: ${endLabel || '--:--'}`;
  }

  const cycle2Container = document.getElementById('groupsV2Cycle2Container');
  if (cycle2Container) {
    const isTwo = mode === 'two';
    cycle2Container.style.display = isTwo ? 'flex' : 'none';
    const c2 = twoCycles[1] || twoCycles[0] || {
      on: defaults.cycles[1]?.on || startTime,
      off: defaults.cycles[1]?.off || startTime,
      hours: defaults.cycles[1]?.hours ?? photoperiodHours / 2,
    };
    const c2OnInput = document.getElementById('groupsV2Cycle2On');
    if (c2OnInput) {
      c2OnInput.value = c2.on;
      c2OnInput.readOnly = true;
      c2OnInput.setAttribute('aria-readonly', 'true');
      c2OnInput.disabled = !isTwo;
    }
    const c2HoursInput = document.getElementById('groupsV2Cycle2Hours');
    if (c2HoursInput) {
      c2HoursInput.value = formatCycleHoursValue(c2.hours);
      c2HoursInput.readOnly = true;
      c2HoursInput.setAttribute('aria-readonly', 'true');
      c2HoursInput.disabled = !isTwo;
    }
    const c2End = document.getElementById('groupsV2Cycle2End');
    if (c2End) c2End.textContent = `End: ${c2.off || '--:--'}`;
  }
  const addCycleBtn = document.getElementById('groupsV2AddCycle2Btn');
  if (addCycleBtn) {
    addCycleBtn.style.display = mode === 'two' ? 'none' : 'inline-block';
  }
  const summaryEl = document.getElementById('groupsV2ScheduleSummary');
  if (summaryEl) {
    const summaryConfig = buildGroupsV2ScheduleConfig();
    const summaryText = scheduleSummary(summaryConfig);
    summaryEl.textContent = summaryText && summaryText !== 'No schedule'
      ? `Summary: ${summaryText}`
      : '';
  }
}

const groupsV2FormState = {
  planId: '',
  planSearch: '',
  anchorMode: 'seedDate',
  seedDate: formatDateInputValue(new Date()),
  dps: 1,
  schedule: createDefaultGroupsV2Schedule(),
  gradients: { ...GROUPS_V2_DEFAULTS.gradients },
  targetHumidity: null, // User input for target humidity percentage
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatDateInputValue(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDateInput(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((part) => Number(part));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const date = new Date(y, m - 1, d);
  if (!Number.isFinite(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatSigned(value, precision = 1) {
  const num = Number(value);
  if (!Number.isFinite(num) || Math.abs(num) < 1e-9) return '0';
  const abs = Math.abs(num);
  const formatted = abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(precision);
  return `${num > 0 ? '+' : '-'}${formatted}`;
}

function getGroupsV2Plans() {
  return (window.STATE && Array.isArray(window.STATE.plans)) ? window.STATE.plans : [];
}

function planMatchesSearch(plan, query) {
  if (!query) return true;
  const needle = query.toLowerCase();
  if (!needle) return true;
  const derived = plan?._derived;
  const applies = derived?.appliesTo || plan?.meta?.appliesTo || {};
  const haystack = [
    plan?.id,
    plan?.name,
    plan?.label,
    plan?.meta?.label,
    plan?.kind,
    plan?.crop,
    ...(Array.isArray(plan?.meta?.category) ? plan.meta.category : []),
    ...(Array.isArray(applies.category) ? applies.category : []),
    ...(Array.isArray(applies.varieties) ? applies.varieties : []),
    ...(Array.isArray(derived?.notes) ? derived.notes : []),
  ];
  return haystack.some((entry) => typeof entry === 'string' && entry.toLowerCase().includes(needle));
}

function getGroupsV2SelectedPlan() {
  const plans = getGroupsV2Plans();
  const id = groupsV2FormState.planId || '';
  if (!id) return null;
  return plans.find((plan) => (plan.id === id) || (plan.key === id) || (plan.name === id)) || null;
}

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

function applyGroupsV2StateToInputs() {
  const searchSelect = document.getElementById('groupsV2PlanSearch');
  if (searchSelect) searchSelect.value = groupsV2FormState.planSearch || '';
  const planSelect = document.getElementById('groupsV2PlanSelect');
  if (planSelect) planSelect.value = groupsV2FormState.planId || '';
  const seedInput = document.getElementById('groupsV2SeedDate');
  if (seedInput) seedInput.value = groupsV2FormState.seedDate || '';
  const dpsInput = document.getElementById('groupsV2Dps');
  if (dpsInput) dpsInput.value = groupsV2FormState.dps != null ? String(groupsV2FormState.dps) : '';
  updateGroupsV2ScheduleUI();
  const gradientMap = {
    groupsV2GradientPpfd: 'ppfd',
    groupsV2GradientBlue: 'blue',
    groupsV2GradientTemp: 'tempC',
    groupsV2GradientRh: 'rh',
  };
  Object.entries(gradientMap).forEach(([id, key]) => {
    const input = document.getElementById(id);
    if (!input) return;
    const value = groupsV2FormState.gradients[key];
    const defaultValue = GROUPS_V2_DEFAULTS.gradients[key] ?? 0;
    input.value = value != null ? String(value) : String(defaultValue);
  });
  const anchorRadios = document.querySelectorAll('input[name="groupsV2AnchorMode"]');
  anchorRadios.forEach((radio) => { radio.checked = radio.value === groupsV2FormState.anchorMode; });
  
  // Apply target humidity
  const targetHumidityInput = document.getElementById('groupsV2TargetHumidity');
  if (targetHumidityInput) {
    targetHumidityInput.value = groupsV2FormState.targetHumidity != null ? String(groupsV2FormState.targetHumidity) : '';
  }
}

function getGroupsV2DayNumber() {
  if (groupsV2FormState.anchorMode === 'dps') {
    const dps = toNumberOrNull(groupsV2FormState.dps);
    return dps != null ? Math.max(0, Math.round(dps)) : null;
  }
  const seed = parseLocalDateInput(groupsV2FormState.seedDate);
  if (!seed) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - seed.getTime()) / MS_PER_DAY);
  return diff < 0 ? 0 : diff + 1;
}

function resolvePlanTargetsForDay(plan, dayNumber) {
  if (!plan || typeof plan !== 'object') return null;
  const derived = plan._derived || derivePlanRuntime(plan);
  const lightDays = Array.isArray(derived?.lightDays) ? derived.lightDays.slice() : [];
  if (!lightDays.length) {
    const basePhotoperiod = firstNonEmpty(plan.photoperiod, derived?.photoperiod, plan.defaults?.photoperiod);
    const photoperiodHours = readPhotoperiodHours(basePhotoperiod) ?? derived?.photoperiodHours ?? null;
    return {
      stage: plan.stage || '',
      ppfd: toNumberOrNull(firstNonEmpty(plan.ppfd, derived?.ppfd)),
      dli: toNumberOrNull(firstNonEmpty(plan.dli, derived?.dli)),
      photoperiod: basePhotoperiod,
      photoperiodHours,
    };
  }
  const sorted = lightDays.slice().sort((a, b) => {
    const aDay = Number.isFinite(a.day) ? a.day : 0;
    const bDay = Number.isFinite(b.day) ? b.day : 0;
    return aDay - bDay;
  });
  const effectiveDay = Math.max(1, Number.isFinite(dayNumber) ? dayNumber : 1);
  let target = sorted[0];
  for (const entry of sorted) {
    const start = Number.isFinite(entry.day) ? entry.day : null;
    if (start === null) {
      if (!target) target = entry;
      continue;
    }
    if (effectiveDay >= start) target = entry;
    else break;
  }
  const photoperiodHours = readPhotoperiodHours(target?.photoperiod) ?? derived?.photoperiodHours ?? null;
  const ppfd = toNumberOrNull(firstNonEmpty(target?.ppfd, derived?.ppfd, plan.ppfd));
  const dli = toNumberOrNull(firstNonEmpty(target?.dli, plan.dli, derived?.dli));
  return {
    stage: target?.stage || plan.stage || '',
    ppfd,
    dli,
    photoperiod: target?.photoperiod,
    photoperiodHours,
  };
}

function computeGroupsV2PreviewData(planOverride) {
  const plan = planOverride || getGroupsV2SelectedPlan();
  if (!plan) return null;
  const dayNumber = getGroupsV2DayNumber();
  const target = resolvePlanTargetsForDay(plan, dayNumber ?? 1) || {};
  const scheduleConfig = buildGroupsV2ScheduleConfig();
  const scheduleHours = Number.isFinite(scheduleConfig.durationHours) ? scheduleConfig.durationHours : null;
  const basePhotoperiod = target.photoperiodHours ?? readPhotoperiodHours(firstNonEmpty(plan.photoperiod, plan.defaults?.photoperiod, plan._derived?.photoperiod));
  const photoperiodHours = Number.isFinite(scheduleHours) && scheduleHours > 0 ? scheduleHours : basePhotoperiod;
  const planPpfd = toNumberOrNull(firstNonEmpty(target.ppfd, plan.ppfd, plan._derived?.ppfd));
  const gradientPpfd = toNumberOrNull(groupsV2FormState.gradients.ppfd) || 0;
  const hours = Number.isFinite(photoperiodHours) ? Math.max(0, photoperiodHours) : null;
  const targetDli = toNumberOrNull(firstNonEmpty(target.dli, plan.dli, plan._derived?.dli));
  let basePpfd = Number.isFinite(planPpfd) ? planPpfd : null;
  let ppfdAdjustedForDli = false;
  let aiSuggestion = '';
  if (Number.isFinite(targetDli) && hours != null && hours > 0) {
    basePpfd = (targetDli * 1e6) / (3600 * hours);
    ppfdAdjustedForDli = true;
  }
  if ((basePpfd == null || !Number.isFinite(basePpfd)) && hours != null && hours > 0) {
    basePpfd = 200;
    const recommendedDli = (basePpfd * 3600 * hours) / 1e6;
    aiSuggestion = `AI Assist recommends starting at ${Math.round(basePpfd)} µmol·m⁻²·s⁻¹ (${recommendedDli.toFixed(1)} mol·m⁻²·d⁻¹) until plan targets are defined.`;
  } else if ((basePpfd == null || !Number.isFinite(basePpfd)) && (!hours || hours === 0)) {
    aiSuggestion = 'AI Assist recommends selecting a photoperiod to receive PPFD guidance.';
  }
  const adjustedPpfd = basePpfd != null ? basePpfd + gradientPpfd : null;
  const safePpfd = adjustedPpfd != null ? Math.max(0, adjustedPpfd) : null;
  const dli = safePpfd != null && hours != null ? (safePpfd * 3600 * hours) / 1e6 : null;
  return {
    planId: plan.id || plan.name || '',
    day: dayNumber != null ? Math.max(0, dayNumber) : null,
    stage: target.stage || '',
    basePpfd,
    ppfd: safePpfd,
    basePhotoperiod,
    photoperiodHours: hours,
    dli,
    targetDli: Number.isFinite(targetDli) ? targetDli : null,
    ppfdAdjustedForDli,
    aiSuggestion,
    gradients: { ...groupsV2FormState.gradients },
    schedule: scheduleConfig,
    anchor: {
      mode: groupsV2FormState.anchorMode,
      seedDate: groupsV2FormState.anchorMode === 'seedDate' ? (groupsV2FormState.seedDate || null) : null,
      dps: groupsV2FormState.anchorMode === 'dps' ? toNumberOrNull(groupsV2FormState.dps) : null,
    },
  };
}

function updateGroupsV2Preview() {
  const previewEl = document.getElementById('groupsV2PlanPreview');
  if (!previewEl) return;
  const plan = getGroupsV2SelectedPlan();
  if (!plan) {
    previewEl.innerHTML = '<div class="tiny text-muted">Select a plan to preview today’s stage, PPFD, photoperiod, and DLI.</div>';
    return;
  }
  const preview = computeGroupsV2PreviewData(plan);
  if (!preview) {
    previewEl.innerHTML = '<div class="tiny text-muted">Enter a seed date or DPS to preview today’s targets.</div>';
    return;
  }
  const dayLabel = preview.day != null ? `Day ${preview.day}` : 'Day —';
  const stage = preview.stage || '—';
  const photoperiodLabel = Number.isFinite(preview.photoperiodHours) ? `${formatCycleHoursValue(preview.photoperiodHours)} h` : '—';
  const ppfdLabel = Number.isFinite(preview.ppfd) ? `${Math.round(preview.ppfd)} µmol·m⁻²·s⁻¹` : '—';
  const dliLabel = Number.isFinite(preview.dli) ? `${preview.dli.toFixed(2)} mol·m⁻²·d⁻¹` : '—';
  const basePhotoperiodLabel = Number.isFinite(preview.basePhotoperiod) ? `${formatCycleHoursValue(preview.basePhotoperiod)} h plan` : '';
  const basePpfdLabel = Number.isFinite(preview.basePpfd) ? `${Math.round(preview.basePpfd)} µmol plan` : '';
  const gradients = preview.gradients || {};
  const gradientParts = [];
  const gradientPpfd = toNumberOrNull(gradients.ppfd);
  const gradientBlue = toNumberOrNull(gradients.blue);
  const gradientTemp = toNumberOrNull(gradients.tempC);
  const gradientRh = toNumberOrNull(gradients.rh);
  if (Number.isFinite(gradientPpfd) && gradientPpfd !== 0) gradientParts.push(`PPFD ${formatSigned(gradientPpfd, 0)} µmol`);
  if (Number.isFinite(gradientBlue) && gradientBlue !== 0) gradientParts.push(`Blue ${formatSigned(gradientBlue, 1)}%`);
  if (Number.isFinite(gradientTemp) && gradientTemp !== 0) gradientParts.push(`Temp ${formatSigned(gradientTemp, 1)}°C`);
  if (Number.isFinite(gradientRh) && gradientRh !== 0) gradientParts.push(`RH ${formatSigned(gradientRh, 1)}%`);
  const gradientHtml = gradientParts.length
    ? `<div class="tiny text-muted">Gradients: ${gradientParts.map((part) => escapeHtml(part)).join(' • ')}</div>`
    : '';
  const notes = [];
  if (preview.ppfdAdjustedForDli && Number.isFinite(preview.targetDli)) {
    notes.push(`PPFD auto-scaled to maintain ${preview.targetDli.toFixed(2)} mol·m⁻²·d⁻¹.`);
  }
  if (preview.aiSuggestion) {
    notes.push(preview.aiSuggestion);
  }
  const notesHtml = notes.length
    ? `<div class="tiny text-muted">${notes.map((note) => escapeHtml(note)).join('<br>')}</div>`
    : '';
  previewEl.innerHTML = `
    <div><strong>Today →</strong> ${escapeHtml(dayLabel)}</div>
    <div class="tiny">Stage: <strong>${escapeHtml(stage)}</strong></div>
    <div class="tiny">PPFD: <strong>${escapeHtml(ppfdLabel)}</strong>${basePpfdLabel ? ` <span class="text-muted">(${escapeHtml(basePpfdLabel)})</span>` : ''}</div>
    <div class="tiny">Photoperiod: <strong>${escapeHtml(photoperiodLabel)}</strong>${basePhotoperiodLabel ? ` <span class="text-muted">(${escapeHtml(basePhotoperiodLabel)})</span>` : ''}</div>
    <div class="tiny">DLI: <strong>${escapeHtml(dliLabel)}</strong></div>
    ${gradientHtml}
    ${notesHtml}
  `;
  
  // Also update target temperature display
  updateGroupsV2TargetTemp();
}

function updateGroupsV2TargetTemp() {
  const targetTempEl = document.getElementById('groupsV2TargetTemp');
  if (!targetTempEl) return;
  
  const plan = getGroupsV2SelectedPlan();
  if (!plan || !plan.env || !Array.isArray(plan.env.days)) {
    targetTempEl.innerHTML = '<span class="text-muted">—</span>';
    return;
  }
  
  // Get current day from preview
  const preview = computeGroupsV2PreviewData(plan);
  const currentDay = preview?.day || 1;
  
  // Find the temperature for the current day (or closest day)
  const envDays = plan.env.days
    .map((row) => ({ d: toNumberOrNull(row?.d ?? row?.day), tempC: toNumberOrNull(row?.tempC ?? row?.temp_c ?? row?.temp) }))
    .filter((r) => r.d != null && r.tempC != null)
    .sort((a, b) => a.d - b.d);
  let targetTemp = null;
  
  for (const envDay of envDays) {
    if (envDay.d <= currentDay) {
      targetTemp = envDay.tempC;
    } else {
      break;
    }
  }
  
  if (targetTemp != null && Number.isFinite(targetTemp)) {
    targetTempEl.innerHTML = `<strong style="color:#16a34a;">${targetTemp}°C</strong>`;
  } else {
    targetTempEl.innerHTML = '<span class="text-muted">—</span>';
  }
}

function buildGroupsV2PlanConfig(planOverride) {
  const plan = planOverride || getGroupsV2SelectedPlan();
  if (!plan) return null;
  const preview = computeGroupsV2PreviewData(plan);
  const updatedAt = new Date().toISOString();
  const schedule = buildGroupsV2ScheduleConfig();
  const gradients = {
    ppfd: toNumberOrNull(groupsV2FormState.gradients.ppfd) ?? GROUPS_V2_DEFAULTS.gradients.ppfd,
    blue: toNumberOrNull(groupsV2FormState.gradients.blue) ?? GROUPS_V2_DEFAULTS.gradients.blue,
    tempC: toNumberOrNull(groupsV2FormState.gradients.tempC) ?? GROUPS_V2_DEFAULTS.gradients.tempC,
    rh: toNumberOrNull(groupsV2FormState.gradients.rh) ?? GROUPS_V2_DEFAULTS.gradients.rh,
  };
  const anchor = {
    mode: groupsV2FormState.anchorMode,
    seedDate: groupsV2FormState.anchorMode === 'seedDate' ? (groupsV2FormState.seedDate || null) : null,
    dps: groupsV2FormState.anchorMode === 'dps' ? toNumberOrNull(groupsV2FormState.dps) : null,
  };
  const config = { anchor, schedule, gradients, updatedAt };
  
  // Add target humidity if set
  const targetHumidity = toNumberOrNull(groupsV2FormState.targetHumidity);
  if (targetHumidity != null) {
    config.targetHumidity = targetHumidity;
  }
  
  if (preview) {
    // Seed environmental target summaries for automation (e.g., tempC today)
    const envTarget = (() => {
      if (!plan.env || !Array.isArray(plan.env.days)) return null;
      const currentDay = preview?.day || 1;
      const envDays = plan.env.days
        .map((row) => ({ d: toNumberOrNull(row?.d ?? row?.day), tempC: toNumberOrNull(row?.tempC ?? row?.temp_c ?? row?.temp) }))
        .filter((r) => r.d != null)
        .sort((a, b) => a.d - b.d);
      let targetTemp = null;
      for (const envDay of envDays) {
        if (envDay.d <= currentDay && envDay.tempC != null) targetTemp = envDay.tempC;
        else if (envDay.d > currentDay) break;
      }
      return targetTemp != null ? { tempC: targetTemp } : null;
    })();
    config.preview = { ...preview, updatedAt, ...(envTarget ? { env: envTarget } : {}) };
  }
  return config;
}

function initializeGroupsV2Form() {
  if (initializeGroupsV2Form._initialized) return;
  initializeGroupsV2Form._initialized = true;
  applyGroupsV2StateToInputs();
  const planSearchSelect = document.getElementById('groupsV2PlanSearch');
  if (planSearchSelect) {
    planSearchSelect.addEventListener('change', (event) => {
      groupsV2FormState.planSearch = event.target.value || '';
      populateGroupsV2PlanDropdown(groupsV2FormState.planSearch);
    });
  }
  const seedInput = document.getElementById('groupsV2SeedDate');
  if (seedInput) {
    seedInput.addEventListener('input', (event) => {
      groupsV2FormState.seedDate = event.target.value || '';
      updateGroupsV2Preview();
    });
  }
  const dpsInput = document.getElementById('groupsV2Dps');
  if (dpsInput) {
    const handleDpsChange = (event) => {
      groupsV2FormState.dps = toNumberOrNull(event.target.value);
      updateGroupsV2Preview();
    };
    dpsInput.addEventListener('input', handleDpsChange);
    dpsInput.addEventListener('change', handleDpsChange);
  }
  const scheduleModeRadios = document.querySelectorAll('input[name="groupsV2ScheduleMode"]');
  scheduleModeRadios.forEach((radio) => {
    radio.addEventListener('change', (event) => {
      if (!event.target.checked) return;
      const schedule = ensureGroupsV2ScheduleState();
      const nextMode = event.target.value === 'two' ? 'two' : 'one';
      if (schedule.mode === nextMode) return;
      const previousTotal = normalizePhotoperiodHours(
        Number.isFinite(schedule.photoperiodHours) ? schedule.photoperiodHours : 0,
        24,
      );
      let nextTotal = previousTotal;
      if (nextMode === 'two') {
        let perCycle = previousTotal > 0 ? previousTotal / 2 : 6;
        if (!Number.isFinite(perCycle) || perCycle <= 0) perCycle = 6;
        perCycle = normalizePhotoperiodHours(perCycle, 12);
        nextTotal = Math.min(24, perCycle * 2);
      } else {
        const perCycle = normalizePhotoperiodHours(previousTotal / 2, 12);
        nextTotal = normalizePhotoperiodHours(perCycle * 2, 24);
      }
      const updated = normalizeGroupsV2Schedule({ ...schedule, mode: nextMode, photoperiodHours: nextTotal });
      groupsV2FormState.schedule = updated;
      updateGroupsV2ScheduleUI();
      updateGroupsV2Preview();
    });
  });
  const defaultSchedule = createDefaultGroupsV2Schedule();
  const c1OnInput = document.getElementById('groupsV2Cycle1On');
  if (c1OnInput) {
    const handleStartChange = (event) => {
      const schedule = ensureGroupsV2ScheduleState();
      const fallback = defaultSchedule.startTime || defaultSchedule.cycles[0]?.on || '08:00';
      const value = normalizeTimeString(event.target.value, fallback);
      const updated = normalizeGroupsV2Schedule({ ...schedule, startTime: value });
      groupsV2FormState.schedule = updated;
      updateGroupsV2ScheduleUI();
      updateGroupsV2Preview();
    };
    c1OnInput.addEventListener('change', handleStartChange);
    c1OnInput.addEventListener('input', handleStartChange);
  }
  const c1HoursInput = document.getElementById('groupsV2Cycle1Hours');
  if (c1HoursInput) {
    c1HoursInput.addEventListener('input', (event) => {
      const schedule = ensureGroupsV2ScheduleState();
      const mode = schedule.mode === 'two' ? 'two' : 'one';
      const maxHours = mode === 'two' ? 12 : 24;
      const perCycle = normalizePhotoperiodHours(event.target.value, maxHours);
      const total = mode === 'two' ? Math.min(24, perCycle * 2) : perCycle;
      const updated = normalizeGroupsV2Schedule({ ...schedule, photoperiodHours: total });
      groupsV2FormState.schedule = updated;
      c1HoursInput.value = formatCycleHoursValue(perCycle);
      updateGroupsV2ScheduleUI();
      updateGroupsV2Preview();
    });
  }
  const splitEvenBtn = document.getElementById('groupsV2SplitEvenBtn');
  if (splitEvenBtn) {
    splitEvenBtn.addEventListener('click', () => {
      const schedule = ensureGroupsV2ScheduleState();
      const updated = normalizeGroupsV2Schedule({ ...schedule, mode: 'two', photoperiodHours: 12 });
      groupsV2FormState.schedule = updated;
      updateGroupsV2ScheduleUI();
      updateGroupsV2Preview();
    });
  }
  const maxLightBtn = document.getElementById('groupsV2MaxLightBtn');
  if (maxLightBtn) {
    maxLightBtn.addEventListener('click', () => {
      const schedule = ensureGroupsV2ScheduleState();
      const updated = normalizeGroupsV2Schedule({ ...schedule, mode: 'two', photoperiodHours: 22 });
      groupsV2FormState.schedule = updated;
      updateGroupsV2ScheduleUI();
      updateGroupsV2Preview();
    });
  }
  const resetRampsBtn = document.getElementById('groupsV2ResetRampsBtn');
  if (resetRampsBtn) {
    resetRampsBtn.addEventListener('click', () => {
      const schedule = ensureGroupsV2ScheduleState();
      const defaultsSchedule = createDefaultGroupsV2Schedule();
      const updated = normalizeGroupsV2Schedule({
        ...schedule,
        rampUpMin: defaultsSchedule.rampUpMin,
        rampDownMin: defaultsSchedule.rampDownMin,
      });
      groupsV2FormState.schedule = updated;
      updateGroupsV2ScheduleUI();
      updateGroupsV2Preview();
    });
  }
  const gradientMap = {
    groupsV2GradientPpfd: 'ppfd',
    groupsV2GradientBlue: 'blue',
    groupsV2GradientTemp: 'tempC',
    groupsV2GradientRh: 'rh',
  };
  Object.entries(gradientMap).forEach(([id, key]) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('input', (event) => {
      const value = toNumberOrNull(event.target.value);
      const defaultValue = GROUPS_V2_DEFAULTS.gradients[key] ?? 0;
      groupsV2FormState.gradients[key] = value != null ? value : defaultValue;
      updateGroupsV2Preview();
    });
  });
  
  // Wire up target humidity input
  const targetHumidityInput = document.getElementById('groupsV2TargetHumidity');
  if (targetHumidityInput) {
    targetHumidityInput.addEventListener('input', (event) => {
      const value = toNumberOrNull(event.target.value);
      groupsV2FormState.targetHumidity = value;
      // No need to update preview since humidity doesn't affect the plan preview
    });
  }
  
  const anchorRadios = document.querySelectorAll('input[name="groupsV2AnchorMode"]');
  anchorRadios.forEach((radio) => {
    radio.addEventListener('change', (event) => {
      if (!event.target.checked) return;
      groupsV2FormState.anchorMode = event.target.value === 'dps' ? 'dps' : 'seedDate';
      updateGroupsV2AnchorInputs();
      updateGroupsV2Preview();
    });
  });
  updateGroupsV2AnchorInputs();
}
// Populate Groups V2 Plan and Schedule dropdowns from setup cards
function populateGroupsV2PlanSearchDropdown() {
  const select = document.getElementById('groupsV2PlanSearch');
  if (!select) return;
  
  // Don't repopulate if user is actively interacting with the dropdown
  if (document.activeElement === select) {
    console.log('[Groups V2] Skipping plan search dropdown repopulation - user is interacting with it');
    return;
  }
  
  const currentRaw = groupsV2FormState.planSearch || '';
  const current = currentRaw.trim();
  const plans = getGroupsV2Plans();
  const seen = new Set();
  const options = [{ value: '', label: 'All plans' }];
  const addOption = (value, label) => {
    const trimmed = (value || '').trim();
    if (!trimmed) return;
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    options.push({ value: trimmed, label });
  };
  const categories = new Set();
  const crops = new Set();
  const varieties = new Set();
  const kinds = new Set();
  const planNames = new Set();
  plans.forEach((plan) => {
    const derived = plan?._derived || {};
    const applies = derived.appliesTo || plan?.meta?.appliesTo || {};
    const allCategories = [
      ...(Array.isArray(plan?.meta?.category) ? plan.meta.category : []),
      ...(Array.isArray(derived?.category) ? derived.category : []),
      ...(Array.isArray(applies?.category) ? applies.category : []),
    ];
    allCategories.forEach((cat) => {
      if (typeof cat === 'string' && cat.trim()) categories.add(cat.trim());
    });
    if (typeof plan?.crop === 'string' && plan.crop.trim()) crops.add(plan.crop.trim());
    if (typeof plan?.kind === 'string' && plan.kind.trim()) kinds.add(plan.kind.trim());
    const varietyList = Array.isArray(applies?.varieties) ? applies.varieties : [];
    varietyList.forEach((variety) => {
      if (typeof variety === 'string' && variety.trim()) varieties.add(variety.trim());
    });
    const planLabel = plan?.name || plan?.label || plan?.id;
    if (typeof planLabel === 'string' && planLabel.trim()) planNames.add(planLabel.trim());
  });
  const addSet = (set, prefix) => {
    Array.from(set).sort((a, b) => a.localeCompare(b)).forEach((value) => {
      addOption(value, prefix ? `${prefix} — ${value}` : value);
    });
  };
  addSet(categories, 'Category');
  addSet(crops, 'Crop');
  addSet(varieties, 'Variety');
  addSet(kinds, 'Type');
  addSet(planNames, 'Plan');
  const normalizedCurrent = current.toLowerCase();
  if (normalizedCurrent && !seen.has(normalizedCurrent)) {
    options.push({ value: current, label: `Filter — ${current}` });
    seen.add(normalizedCurrent);
  }
  select.innerHTML = '';
  options.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  if (normalizedCurrent && seen.has(normalizedCurrent)) {
    select.value = current;
  } else {
    select.value = '';
    if (normalizedCurrent && !seen.has(normalizedCurrent)) {
      select.value = current;
    }
  }
}

function populateGroupsV2PlanDropdown(filterQuery) {
  const select = document.getElementById('groupsV2PlanSelect');
  if (!select) return;
  
  // Don't repopulate if user is actively interacting with the dropdown
  if (document.activeElement === select) {
    console.log('[Groups V2] Skipping plan dropdown repopulation - user is interacting with it');
    return;
  }
  
  const query = typeof filterQuery === 'string'
    ? filterQuery.trim().toLowerCase()
    : (groupsV2FormState.planSearch || '').trim().toLowerCase();
  while (select.options.length > 1) select.remove(1);
  const plans = getGroupsV2Plans();
  const filtered = !query ? plans : plans.filter((plan) => planMatchesSearch(plan, query));
  if (!filtered.length) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '(no matching plans)';
    placeholder.disabled = true;
    select.appendChild(placeholder);
  } else {
    filtered.forEach((plan) => {
      const opt = document.createElement('option');
      const value = plan.id || plan.key || plan.name || '';
      opt.value = value;
      opt.dataset.id = plan.id || '';
      opt.dataset.key = plan.key || '';
      opt.textContent = plan.name || plan.label || plan.id || '(unnamed plan)';
      select.appendChild(opt);
    });
  }
  const current = groupsV2FormState.planId;
  const hasMatch = filtered.some((plan) => (plan.id === current) || (plan.key === current) || (plan.name === current));
  if (hasMatch) {
    select.value = current;
  } else {
    select.value = '';
    if (current) groupsV2FormState.planId = '';
  }
  if (!select.value && filtered.length === 1) {
    const fallback = filtered[0].id || filtered[0].key || filtered[0].name || '';
    select.value = fallback;
  }
  if (!select._planListenerAttached) {
    select.addEventListener('change', () => {
      const opt = select.selectedOptions && select.selectedOptions[0];
      const raw = select.value || '';
      const chosenId = (opt && (opt.dataset.id || opt.dataset.key)) || raw;
      groupsV2FormState.planId = chosenId || raw || '';
      const plan = getGroupsV2SelectedPlan();
      renderGroupsV2PlanCard(plan);
      updateGroupsV2Preview();
      // If a group is currently active, auto-apply and persist the plan selection
      try {
        applyPlanSelectionToCurrentGroup(plan);
      } catch (e) {
        console.warn('[Groups V2] Failed to auto-apply plan to group:', e);
      }
    });
    select._planListenerAttached = true;
  }
  groupsV2FormState.planId = select.value || '';
  const plan = getGroupsV2SelectedPlan();
  renderGroupsV2PlanCard(plan);
  updateGroupsV2Preview();
}

// Apply current plan selection to the active group and persist
function applyPlanSelectionToCurrentGroup(planOverride) {
  const plan = planOverride || getGroupsV2SelectedPlan();
  if (!plan) return;
  if (!window.STATE || !Array.isArray(window.STATE.groups) || !window.STATE.groups.length) return;
  // Determine active group: prefer selection from 'Load Group' dropdown, else last group
  const loadSelect = document.getElementById('groupsV2LoadGroup');
  let group = null;
  if (loadSelect && loadSelect.value) {
    const id = loadSelect.value;
    group = window.STATE.groups.find((g) => g && (g.id === id));
  }
  if (!group) group = window.STATE.groups[window.STATE.groups.length - 1];
  if (!group) return;
  const targetPlanId = plan.id || plan.key || plan.name || groupsV2FormState.planId || '';
  if (!targetPlanId) return;
  group.plan = String(targetPlanId);
  const cfg = buildGroupsV2PlanConfig(plan);
  if (cfg) group.planConfig = cfg; else delete group.planConfig;
  // Persist to server via app's saveGroups helper
  if (typeof window.saveGroups === 'function') {
    window.saveGroups();
  }
  // Notify UX
  try { document.dispatchEvent(new Event('groups-updated')); } catch {}
  if (typeof window.showToast === 'function') {
    const label = plan.name || plan.id || 'plan';
    window.showToast({ title: 'Plan Saved', msg: `Applied ${label} to group ${group.name || group.id}`, kind: 'success', icon: '✅' }, 1500);
  }
}

// Calculate color percentages from SPD data
function calculateSpectrumColorPercentages(spd) {
  if (!spd || !Array.isArray(spd.wavelengths) || !Array.isArray(spd.display)) {
    return { blue: 0, green: 0, red: 0, deepRed: 0 };
  }
  
  const wavelengths = spd.wavelengths;
  const display = spd.display;
  
  let blueSum = 0, greenSum = 0, redSum = 0, deepRedSum = 0, total = 0;
  
  for (let i = 0; i < wavelengths.length; i++) {
    const wl = wavelengths[i];
    const val = display[i] || 0;
    
    if (wl >= 400 && wl < 500) {
      blueSum += val;
    } else if (wl >= 500 && wl < 600) {
      greenSum += val;
    } else if (wl >= 600 && wl < 680) {
      redSum += val;
    } else if (wl >= 680 && wl < 750) {
      deepRedSum += val;
    }
    total += val;
  }
  
  if (total === 0) {
    return { blue: 0, green: 0, red: 0, deepRed: 0 };
  }
  
  return {
    blue: (blueSum / total * 100).toFixed(1),
    green: (greenSum / total * 100).toFixed(1),
    red: (redSum / total * 100).toFixed(1),
    deepRed: (deepRedSum / total * 100).toFixed(1)
  };
}

// Get plan data for a specific day
function getPlanDayData(plan, dayNumber) {
  if (!plan) return null;
  
  const derived = plan._derived || derivePlanRuntime(plan);
  
  // Check multiple locations for days data
  let days = [];
  if (Array.isArray(plan.days) && plan.days.length > 0) {
    days = plan.days;
  } else if (Array.isArray(derived?.days) && derived.days.length > 0) {
    days = derived.days;
  } else if (Array.isArray(derived?.lightDays) && derived.lightDays.length > 0) {
    days = derived.lightDays;
  } else if (plan.light && Array.isArray(plan.light.days) && plan.light.days.length > 0) {
    days = plan.light.days;
  }
  
  // Find the specific day or interpolate to nearest
  let dayData = days.find(d => (d.day === dayNumber || d.d === dayNumber));
  
  if (!dayData && days.length > 0) {
    // Find the closest day <= requested day
    const sortedDays = days
      .map(d => ({ ...d, dayNum: d.day || d.d || 0 }))
      .sort((a, b) => a.dayNum - b.dayNum);
    
    const closestDay = sortedDays.reduce((prev, curr) => {
      if (curr.dayNum <= dayNumber) return curr;
      return prev;
    }, sortedDays[0]);
    
    dayData = closestDay;
  }
  
  if (!dayData) {
    // Fallback to plan defaults
    return {
      spectrum: plan.spectrum || derived?.spectrum || { cw: 45, ww: 45, bl: 0, rd: 0 },
      ppfd: plan.ppfd || derived?.ppfd || 0,
      dli: plan.dli || derived?.dli || 0,
      photoperiod: plan.photoperiod || derived?.photoperiod || 0,
      tempC: plan.tempC || (plan.env && plan.env.tempC) || 22
    };
  }
  
  // Extract day-specific data
  // Check for spectrum in multiple formats: mix, spectrum, or flat keys (cw/ww/bl/rd)
  let spectrum;
  if (dayData.mix && typeof dayData.mix === 'object') {
    console.log('[getPlanDayData] Using dayData.mix:', dayData.mix);
    spectrum = dayData.mix;
  } else if (dayData.spectrum && typeof dayData.spectrum === 'object') {
    console.log('[getPlanDayData] Using dayData.spectrum:', dayData.spectrum);
    spectrum = dayData.spectrum;
  } else if (typeof dayData.cw !== 'undefined' || typeof dayData.ww !== 'undefined') {
    // Flat format: cw, ww, bl, rd at top level of dayData
    console.log('[getPlanDayData] Using flat format. dayData:', { cw: dayData.cw, ww: dayData.ww, bl: dayData.bl, rd: dayData.rd, blue: dayData.blue, red: dayData.red });
    spectrum = {
      cw: dayData.cw || 0,
      ww: dayData.ww || 0,
      bl: dayData.bl || dayData.blue || 0,
      rd: dayData.rd || dayData.red || 0
    };
    console.log('[getPlanDayData] Created spectrum:', spectrum);
  } else {
    console.log('[getPlanDayData] Using fallback spectrum');
    spectrum = plan.spectrum || derived?.spectrum || { cw: 45, ww: 45, bl: 0, rd: 0 };
  }
  
  const ppfd = dayData.ppfd || dayData.intensity || 0;
  const photoperiodHours = dayData.hours || dayData.photoperiod || plan.photoperiod || derived?.photoperiod || 0;
  const dli = dayData.dli || ((ppfd && photoperiodHours) ? (ppfd * photoperiodHours * 3600 / 1000000) : 0);
  const tempC = dayData.tempC || dayData.temp || (plan.env && plan.env.tempC) || 22;
  
  return {
    spectrum,
    ppfd,
    dli,
    photoperiod: typeof photoperiodHours === 'string' ? photoperiodHours : photoperiodHours,
    tempC,
    day: dayNumber
  };
}

// Get total number of days in a plan
function getPlanTotalDays(plan) {
  if (!plan) return 1;
  
  const derived = plan._derived || derivePlanRuntime(plan);
  
  // Check multiple locations for days data
  let days = [];
  if (Array.isArray(plan.days) && plan.days.length > 0) {
    days = plan.days;
  } else if (Array.isArray(derived?.days) && derived.days.length > 0) {
    days = derived.days;
  } else if (Array.isArray(derived?.lightDays) && derived.lightDays.length > 0) {
    days = derived.lightDays;
  } else if (plan.light && Array.isArray(plan.light.days) && plan.light.days.length > 0) {
    days = plan.light.days;
  }
  
  if (days.length === 0) return 1;
  
  // Find the maximum day number
  let maxDay = 0;
  days.forEach(d => {
    const dayNum = d.day || d.d || 0;
    if (dayNum > maxDay) maxDay = dayNum;
  });
  
  return maxDay || days.length || 1;
}

// Render the plan card for Group V2 Setup
function renderGroupsV2PlanCard(plan, dayNumber) {
  let card = document.getElementById('groupsV2PlanCard');
  if (!card) {
    const planControls = document.getElementById('groupsV2PlanControls');
    const planForm = document.getElementById('groupsV2PlanForm');
    card = document.createElement('section');
    card.id = 'groupsV2PlanCard';
    card.className = 'group-info-card';
    card.style.margin = '12px 0 18px 0';
    if (planControls && planControls.parentNode) {
      planControls.parentNode.insertBefore(card, planControls.nextSibling);
    } else if (planForm) {
      planForm.appendChild(card);
    }
  }
  if (!plan) {
    card.innerHTML = '<div class="tiny text-muted">Select a plan to view spectrum, DLI, and PPFD targets.</div>';
    return;
  }
  
  // Determine current day
  const totalDays = getPlanTotalDays(plan);
  const currentDay = Number.isFinite(dayNumber) ? Math.max(1, Math.min(dayNumber, totalDays)) : 1;
  
  // Get day-specific data
  const dayData = getPlanDayData(plan, currentDay);
  const spectrum = dayData.spectrum;
  const ppfd = dayData.ppfd;
  const dli = dayData.dli;
  const photoperiod = dayData.photoperiod;
  const tempC = dayData.tempC;
  
  const hasPpfd = Number.isFinite(ppfd) && ppfd > 0;
  const hasDli = Number.isFinite(dli) && dli > 0;
  const hasTemp = Number.isFinite(tempC);
  
  const ppfdLabel = hasPpfd ? `${Number(ppfd).toFixed(0)} µmol·m⁻²·s⁻¹` : '—';
  const dliLabel = hasDli ? `${Number(dli).toFixed(2)} mol·m⁻²·d⁻¹` : '—';
  const photoperiodLabel = Number.isFinite(photoperiod) && photoperiod > 0 ? `${Number(photoperiod).toFixed(1)} h` : '—';
  const tempLabel = hasTemp ? `${Number(tempC).toFixed(1)}°C` : '—';
  
  const description = plan.description || 'Spectrum and targets for this plan.';
  
  // Get spectrum weighting percentages
  const cwPct = Number(spectrum.cw || 0);
  const wwPct = Number(spectrum.ww || 0);
  const blPct = Number(spectrum.bl || 0);
  const rdPct = Number(spectrum.rd || 0);
  
  // Card HTML
  card.innerHTML = `
    <header class="group-info-card__header">
      <div>
        <h3>Plan: ${escapeHtml(plan.name || 'Untitled')}</h3>
        <p class="tiny text-muted">${escapeHtml(description)}</p>
      </div>
    </header>
    <div class="group-info-card__body" style="flex-direction: row; align-items: flex-start; gap: 12px;">
      <div style="display: flex; flex-direction: column; gap: 8px; width: 50%;">
        <canvas id="groupsV2PlanSpectrumCanvas" class="group-info-card__canvas" width="280" height="100" role="img" aria-label="Plan spectrum preview" style="width: 100%;"></canvas>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px;">
          <div class="tiny" style="font-weight: 600; margin-bottom: 6px; color: #475569;">Channel Mix</div>
          <dl class="group-info-card__metrics" style="width: 100%; grid-template-columns: repeat(2, 1fr); gap: 4px 8px; font-size: 0.75rem;">
            <dt style="font-size: 0.65rem;">Cool White</dt><dd id="groupsV2PlanCw">${cwPct.toFixed(1)}%</dd>
            <dt style="font-size: 0.65rem;">Warm White</dt><dd id="groupsV2PlanWw">${wwPct.toFixed(1)}%</dd>
            <dt style="font-size: 0.65rem;">Blue</dt><dd id="groupsV2PlanBl">${blPct.toFixed(1)}%</dd>
            <dt style="font-size: 0.65rem;">Red</dt><dd id="groupsV2PlanRd">${rdPct.toFixed(1)}%</dd>
          </dl>
        </div>
        <div id="groupsV2PlanColorBreakdown" style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 8px; display: none;">
          <div class="tiny" style="font-weight: 600; margin-bottom: 6px; color: #0369a1;">Color Distribution</div>
          <dl class="group-info-card__metrics" style="width: 100%; grid-template-columns: repeat(2, 1fr); gap: 4px 8px; font-size: 0.75rem;">
            <dt style="font-size: 0.65rem;">Blue (400-500nm)</dt><dd id="groupsV2PlanBlue">—</dd>
            <dt style="font-size: 0.65rem;">Green (500-600nm)</dt><dd id="groupsV2PlanGreen">—</dd>
            <dt style="font-size: 0.65rem;">Red (600-680nm)</dt><dd id="groupsV2PlanRed">—</dd>
            <dt style="font-size: 0.65rem;">Deep Red (680-750nm)</dt><dd id="groupsV2PlanDeepRed">—</dd>
          </dl>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px; width: 50%;">
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px;">
          <div class="tiny" style="font-weight: 600; margin-bottom: 6px; color: #166534;">Plan Day Targets</div>
          <dl class="group-info-card__metrics" style="width: 100%; gap: 6px 8px;">
            <dt>Target PPFD</dt><dd id="groupsV2PlanPpfd">${ppfdLabel}</dd>
            <dt>Target DLI</dt><dd id="groupsV2PlanDli">${dliLabel}</dd>
            <dt>Photoperiod</dt><dd id="groupsV2PlanPhotoperiod">${photoperiodLabel}</dd>
            <dt>Temperature</dt><dd id="groupsV2PlanTemp">${tempLabel}</dd>
          </dl>
        </div>
      </div>
    </div>
    <div style="background: #fefce8; border: 1px solid #fde047; border-radius: 6px; padding: 12px; margin-top: 12px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
        <label for="groupsV2PlanDaySlider" class="tiny" style="font-weight: 600; color: #854d0e;">Day Timeline</label>
        <span id="groupsV2PlanDayLabel" class="tiny" style="font-weight: 600; color: #854d0e;">Day ${currentDay} of ${totalDays}</span>
      </div>
      ${totalDays > 1 ? `
      <input 
        type="range" 
        id="groupsV2PlanDaySlider" 
        min="1" 
        max="${totalDays}" 
        value="${currentDay}" 
        step="1"
      >
      <div style="display: flex; justify-content: space-between; margin-top: 4px;">
        <span class="tiny text-muted">Day 1</span>
        <span class="tiny text-muted">Day ${totalDays}</span>
      </div>
      ` : `
      <div class="tiny text-muted" style="text-align: center; padding: 8px; background: #fef9c3; border-radius: 4px;">
        This plan has only one day. Multi-day plans will show an interactive timeline here.
      </div>
      `}
    </div>
  `;
  
  // Store plan reference for slider updates
  card._currentPlan = plan;
  
  // Render spectrum graph if function available
  const canvas = document.getElementById('groupsV2PlanSpectrumCanvas');
  if (canvas && typeof renderSpectrumCanvas === 'function' && typeof computeWeightedSPD === 'function') {
    const mix = { cw: cwPct, ww: wwPct, bl: blPct, rd: rdPct };
    const spd = computeWeightedSPD(mix);
    renderSpectrumCanvas(canvas, spd, { width: canvas.width, height: canvas.height });
    
    // Calculate and display color percentages from SPD
    const colorPcts = calculateSpectrumColorPercentages(spd);
    const colorBreakdownDiv = document.getElementById('groupsV2PlanColorBreakdown');
    if (colorBreakdownDiv) {
      colorBreakdownDiv.style.display = 'block';
      document.getElementById('groupsV2PlanBlue').textContent = `${colorPcts.blue}%`;
      document.getElementById('groupsV2PlanGreen').textContent = `${colorPcts.green}%`;
      document.getElementById('groupsV2PlanRed').textContent = `${colorPcts.red}%`;
      document.getElementById('groupsV2PlanDeepRed').textContent = `${colorPcts.deepRed}%`;
    }
  }
  
  // Attach slider event handler (must happen after innerHTML is set, and only if slider exists for multi-day plans)
  setTimeout(() => {
    const slider = document.getElementById('groupsV2PlanDaySlider');
    if (slider && !slider._listenerAttached) {
      let rafId = null;
      
      // Use 'input' for real-time updates with throttling via requestAnimationFrame
      slider.addEventListener('input', (e) => {
        const newDay = parseInt(e.target.value, 10);
        
        // Cancel any pending animation frame
        if (rafId) {
          cancelAnimationFrame(rafId);
        }
        
        // Schedule update on next animation frame (throttles to 60fps)
        rafId = requestAnimationFrame(() => {
          updatePlanCardForDay(card._currentPlan, newDay);
          rafId = null;
        });
      });
      
      // Use 'change' for final value logging
      slider.addEventListener('change', (e) => {
        const newDay = parseInt(e.target.value, 10);
        console.log('[Groups V2] Day changed to:', newDay);
        updatePlanCardForDay(card._currentPlan, newDay);
      });
      
      slider._listenerAttached = true;
    } else if (totalDays === 1) {
      console.log('[Groups V2] Plan has only 1 day - slider not rendered');
    }
  }, 0);
}

// Update plan card data for a specific day without full re-render
function updatePlanCardForDay(plan, dayNumber) {
  if (!plan) return;
  
  const totalDays = getPlanTotalDays(plan);
  const currentDay = Math.max(1, Math.min(dayNumber, totalDays));
  const dayData = getPlanDayData(plan, currentDay);
  
  // Update day label
  const dayLabel = document.getElementById('groupsV2PlanDayLabel');
  if (dayLabel) dayLabel.textContent = `Day ${currentDay} of ${totalDays}`;
  
  // Update spectrum values
  const spectrum = dayData.spectrum;
  console.log(`[updatePlanCardForDay] Day ${currentDay} spectrum:`, spectrum);
  const cwPct = Number(spectrum.cw || 0);
  const wwPct = Number(spectrum.ww || 0);
  const blPct = Number(spectrum.bl || 0);
  const gnPct = Number(spectrum.gn || 0);
  const rdPct = Number(spectrum.rd || 0);
  const frPct = Number(spectrum.fr || 0);
  console.log(`[updatePlanCardForDay] Extracted: CW=${cwPct}, WW=${wwPct}, BL=${blPct}, GN=${gnPct}, RD=${rdPct}, FR=${frPct}`);
  
  const cwEl = document.getElementById('groupsV2PlanCw');
  const wwEl = document.getElementById('groupsV2PlanWw');
  const blEl = document.getElementById('groupsV2PlanBl');
  const gnEl = document.getElementById('groupsV2PlanGn');
  const rdEl = document.getElementById('groupsV2PlanRd');
  const frEl = document.getElementById('groupsV2PlanFr');
  
  if (cwEl) cwEl.textContent = `${cwPct.toFixed(1)}%`;
  if (wwEl) wwEl.textContent = `${wwPct.toFixed(1)}%`;
  if (blEl) blEl.textContent = `${blPct.toFixed(1)}%`;
  if (gnEl) gnEl.textContent = `${gnPct.toFixed(1)}%`;
  if (rdEl) rdEl.textContent = `${rdPct.toFixed(1)}%`;
  if (frEl) frEl.textContent = `${frPct.toFixed(1)}%`;
  
  // Update targets
  const ppfd = dayData.ppfd;
  const dli = dayData.dli;
  const photoperiod = dayData.photoperiod;
  const tempC = dayData.tempC;
  
  const ppfdEl = document.getElementById('groupsV2PlanPpfd');
  const dliEl = document.getElementById('groupsV2PlanDli');
  const photoperiodEl = document.getElementById('groupsV2PlanPhotoperiod');
  const tempEl = document.getElementById('groupsV2PlanTemp');
  
  if (ppfdEl) ppfdEl.textContent = Number.isFinite(ppfd) && ppfd > 0 ? `${Number(ppfd).toFixed(0)} µmol·m⁻²·s⁻¹` : '—';
  if (dliEl) dliEl.textContent = Number.isFinite(dli) && dli > 0 ? `${Number(dli).toFixed(2)} mol·m⁻²·d⁻¹` : '—';
  if (photoperiodEl) photoperiodEl.textContent = Number.isFinite(photoperiod) && photoperiod > 0 ? `${Number(photoperiod).toFixed(1)} h` : '—';
  if (tempEl) tempEl.textContent = Number.isFinite(tempC) ? `${Number(tempC).toFixed(1)}°C` : '—';
  
  // Re-render spectrum canvas
  const canvas = document.getElementById('groupsV2PlanSpectrumCanvas');
  if (canvas && typeof renderSpectrumCanvas === 'function' && typeof computeWeightedSPD === 'function') {
    const mix = { cw: cwPct, ww: wwPct, bl: blPct, gn: gnPct, rd: rdPct, fr: frPct };
    console.log('[updatePlanCardForDay] Computing SPD with mix:', mix);
    const spd = computeWeightedSPD(mix);
    console.log('[updatePlanCardForDay] SPD weights:', spd.weights);
    console.log('[updatePlanCardForDay] SPD display sample count:', spd.display?.length);
    console.log('[updatePlanCardForDay] SPD display first 10 values:', spd.display?.slice(0, 10));
    renderSpectrumCanvas(canvas, spd, { width: canvas.width, height: canvas.height });
    
    // Update color distribution
    const colorPcts = calculateSpectrumColorPercentages(spd);
    console.log('[updatePlanCardForDay] Color percentages:', colorPcts);
    document.getElementById('groupsV2PlanBlue').textContent = `${colorPcts.blue}%`;
    document.getElementById('groupsV2PlanGreen').textContent = `${colorPcts.green}%`;
    document.getElementById('groupsV2PlanRed').textContent = `${colorPcts.red}%`;
    document.getElementById('groupsV2PlanDeepRed').textContent = `${colorPcts.deepRed}%`;
  }
}

function populateGroupsV2ScheduleDropdown() {
  const select = document.getElementById('groupsV2ScheduleSelect');
  if (!select) return;
  
  // Don't repopulate if user is actively interacting with the dropdown
  if (document.activeElement === select) {
    console.log('[Groups V2] Skipping schedule dropdown repopulation - user is interacting with it');
    return;
  }
  
  while (select.options.length > 1) select.remove(1);
  const schedules = (window.STATE && Array.isArray(window.STATE.schedules)) ? window.STATE.schedules : [];
  schedules.forEach(sched => {
    const opt = document.createElement('option');
    opt.value = sched.id || sched.name || '';
    opt.textContent = sched.name || sched.label || sched.id || '(unnamed schedule)';
    select.appendChild(opt);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // ...existing code...
  initializeGroupsV2Form();
  // Initial population (may be empty if data not yet loaded)
  populateGroupsV2PlanSearchDropdown();
  populateGroupsV2PlanDropdown(groupsV2FormState.planSearch);
  populateGroupsV2ScheduleDropdown();
  
  // Listen for plan/schedule updates
  document.addEventListener('plans-updated', () => {
    console.log('[Groups V2] plans-updated event received');
    populateGroupsV2PlanSearchDropdown();
    populateGroupsV2PlanDropdown(groupsV2FormState.planSearch);
  });
  document.addEventListener('schedules-updated', () => {
    console.log('[Groups V2] schedules-updated event received');
    populateGroupsV2ScheduleDropdown();
  });

  updateGroupsV2Preview();
});

// Listen for farmDataChanged event (attach once)
if (!window._groupsV2FarmDataListenerAttached) {
  window.addEventListener('farmDataChanged', () => {
    console.log('[Groups V2] farmDataChanged event received - repopulating dropdowns');
    populateGroupsV2PlanSearchDropdown();
    populateGroupsV2PlanDropdown(groupsV2FormState.planSearch);
    populateGroupsV2ScheduleDropdown();
    updateGroupsV2Preview();
  });
  window._groupsV2FarmDataListenerAttached = true;
}

document.addEventListener('DOMContentLoaded', () => {
  const select = document.getElementById('groupsV2LoadGroup');
  if (!select || select._groupsV2ListenerAttached) return;
  select.addEventListener('change', () => {
    const groupId = select.value;
    if (!groupId) return;
    const groups = (window.STATE && Array.isArray(window.STATE.groups)) ? window.STATE.groups : [];
    const matchById = groups.find((g) => g && typeof g.id === 'string' && g.id === groupId);
    const matchByLabel = groups.find((g) => {
      if (!g) return false;
      const label = [g.room || g.roomName || '', g.zone || '', g.name || g.label || '']
        .filter(Boolean)
        .join(':');
      return label === groupId;
    });
    const group = matchById || matchByLabel || null;
    if (!group) return;
    const planId = typeof group.plan === 'string'
      ? group.plan
      : (group.plan && typeof group.plan === 'object' ? (group.plan.id || group.plan.name) : '');
    groupsV2FormState.planId = planId || '';
    groupsV2FormState.planSearch = '';
    const cfg = group.planConfig && typeof group.planConfig === 'object' ? group.planConfig : {};
    const anchor = cfg.anchor && typeof cfg.anchor === 'object' ? cfg.anchor : {};
    const seed = typeof anchor.seedDate === 'string' ? anchor.seedDate : '';
    const parsedSeed = parseLocalDateInput(seed);
    groupsV2FormState.anchorMode = anchor.mode === 'dps' ? 'dps' : 'seedDate';
    groupsV2FormState.seedDate = parsedSeed ? formatDateInputValue(parsedSeed) : '';
    groupsV2FormState.dps = toNumberOrNull(anchor.dps);
    const scheduleCfg = cfg.schedule && typeof cfg.schedule === 'object' ? cfg.schedule : {};
    groupsV2FormState.schedule = hydrateGroupsV2ScheduleState(scheduleCfg);
    const gradientCfg = cfg.gradients && typeof cfg.gradients === 'object' ? cfg.gradients : {};
    groupsV2FormState.gradients = {
      ppfd: toNumberOrNull(gradientCfg.ppfd) ?? GROUPS_V2_DEFAULTS.gradients.ppfd,
      blue: toNumberOrNull(gradientCfg.blue) ?? GROUPS_V2_DEFAULTS.gradients.blue,
      tempC: toNumberOrNull(gradientCfg.tempC) ?? GROUPS_V2_DEFAULTS.gradients.tempC,
      rh: toNumberOrNull(gradientCfg.rh) ?? GROUPS_V2_DEFAULTS.gradients.rh,
    };
    // Load target humidity if present
    groupsV2FormState.targetHumidity = toNumberOrNull(cfg.targetHumidity);
    populateGroupsV2PlanSearchDropdown();
    populateGroupsV2PlanDropdown(groupsV2FormState.planSearch);
    applyGroupsV2StateToInputs();
    updateGroupsV2AnchorInputs();
    updateGroupsV2Preview();
  });
  select._groupsV2ListenerAttached = true;
});
// Populate Groups V2 Load Group dropdown with saved groups, format: Room Name:Zone:Name
function populateGroupsV2LoadGroupDropdown() {
  const select = document.getElementById('groupsV2LoadGroup');
  if (!select) return;
  // Remove all except the first (none)
  while (select.options.length > 1) select.remove(1);
  // Example: get groups from window.STATE.groups or similar
  const groups = (window.STATE && Array.isArray(window.STATE.groups)) ? window.STATE.groups : [];
  groups.forEach(group => {
    const room = group.room || group.roomName || '';
    const zone = group.zone || '';
    const name = group.name || group.label || '';
    const label = [room, zone, name].filter(Boolean).join(':');
    const opt = document.createElement('option');
    opt.value = group.id || label;
    opt.textContent = label || '(unnamed group)';
    select.appendChild(opt);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // ...existing code...
  populateGroupsV2LoadGroupDropdown();
  // If groups can change dynamically, listen for a custom event to refresh
  document.addEventListener('groups-updated', populateGroupsV2LoadGroupDropdown);
});
// Populate Groups V2 Room dropdown with 'GreenReach' and rooms from STATE.rooms
function populateGroupsV2RoomDropdown() {
  const select = document.getElementById('groupsV2RoomSelect');
  if (!select) return;
  // Remove all except the first (GreenReach)
  while (select.options.length > 1) select.remove(1);
  const seen = new Set(['GreenReach']);
  if (window.STATE && Array.isArray(window.STATE.rooms)) {
    window.STATE.rooms.forEach(room => {
      if (!room || !room.name || seen.has(room.name)) return;
      const opt = document.createElement('option');
      opt.value = room.name;
      opt.textContent = room.name;
      select.appendChild(opt);
      seen.add(room.name);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  populateGroupsV2RoomDropdown();
  // If rooms can change dynamically, listen for a custom event to refresh
  document.addEventListener('rooms-updated', populateGroupsV2RoomDropdown);
});
// Wire up Groups V2 sidebar button to open Group V2 Setup card
document.addEventListener('DOMContentLoaded', () => {
  const groupsV2Btn = document.querySelector('[data-sidebar-link][data-target="groups-v2"]');
  if (groupsV2Btn) {
    groupsV2Btn.addEventListener('click', (e) => {
      e.preventDefault();
      setActivePanel('groups-v2');
    });
  }
});

// Wire up Seed Date button to toggle anchor mode
document.addEventListener('DOMContentLoaded', () => {
  const seedDateBtn = document.getElementById('groupsV2SeedDateBtn');
  if (seedDateBtn) {
    seedDateBtn.addEventListener('click', () => {
      const isPressed = seedDateBtn.getAttribute('aria-pressed') === 'true';
      if (!isPressed) {
        groupsV2FormState.anchorMode = 'seedDate';
        seedDateBtn.setAttribute('aria-pressed', 'true');
        // Update DPS button
        const dpsBtn = document.getElementById('groupsV2DpsBtn');
        if (dpsBtn) dpsBtn.setAttribute('aria-pressed', 'false');
        updateGroupsV2AnchorInputs();
        updateGroupsV2Preview();
      }
    });
  }
});

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

// Wire up Remove Cycle 2 button
document.addEventListener('DOMContentLoaded', () => {
  const removeCycle2Btn = document.getElementById('groupsV2RemoveCycle2Btn');
  const cycle2Container = document.getElementById('groupsV2Cycle2Container');
  const addCycle2Btn = document.getElementById('groupsV2AddCycle2Btn');
  if (removeCycle2Btn && cycle2Container && addCycle2Btn) {
    removeCycle2Btn.addEventListener('click', () => {
      const schedule = ensureGroupsV2ScheduleState();
      const updated = normalizeGroupsV2Schedule({
        ...schedule,
        mode: 'one',
      });
      groupsV2FormState.schedule = updated;
      cycle2Container.style.display = 'none';
      addCycle2Btn.style.display = 'inline-block';
      updateGroupsV2ScheduleUI();
      updateGroupsV2Preview();
    });
  }
});

// Handle assign-lights-to-zone event
document.addEventListener('assign-lights-to-zone', (evt) => {
  const { lightIds, zoneId } = evt.detail || {};
  if (!lightIds || !zoneId || !Array.isArray(lightIds)) return;
  
  // Update lights in STATE
  if (!window.STATE) window.STATE = {};
  if (!Array.isArray(window.STATE.lights)) window.STATE.lights = [];
  
  lightIds.forEach(lightId => {
    const light = window.STATE.lights.find(l => l.id === lightId);
    if (light) {
      light.zoneId = zoneId;
    }
  });
  
  // Save to server
  if (typeof window.saveLights === 'function') {
    window.saveLights();
  }
  
  // Refresh the unassigned lights dropdown
  populateGroupsV2UnassignedLightsDropdown();
  
  // Show success message
  if (typeof window.showToast === 'function') {
    window.showToast({
      title: 'Lights Assigned',
      msg: `${lightIds.length} light(s) assigned to Zone ${zoneId}`,
      kind: 'success',
      icon: ''
    }, 2000);
  }
  
  // Dispatch lights-updated event
  document.dispatchEvent(new Event('lights-updated'));
});

// Feature flag: opt-in to simplified room-only group matching
