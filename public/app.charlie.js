// Light Engine Charlie - Comprehensive Dashboard Application
const $ = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>r.querySelectorAll(s);
const setStatus = m => { const el=$("#status"); if(el) el.textContent = m; };

// Global State Management
const STATE = {
  devices: [],
  groups: [],
  schedules: [],
  plans: [],
  farm: null,
  environment: [],
  calibrations: [],
  currentGroup: null,
  currentSchedule: null,
  researchMode: false
};

// --- Research Mode Feature Flag ---
const RESEARCH_MODE_KEY = 'gr.researchMode';
function getResearchMode() {
  const raw = localStorage.getItem(RESEARCH_MODE_KEY);
  return raw === 'true';
}
function setResearchMode(val) {
  localStorage.setItem(RESEARCH_MODE_KEY, val ? 'true' : 'false');
  STATE.researchMode = val;
}

// --- Data Loading Utilities ---
async function loadJSON(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    console.warn(`Failed to load ${path}:`, err);
    return null;
  }
}

async function saveJSON(path, data) {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data, null, 2)
    });
    return response.ok;
  } catch (err) {
    console.error(`Failed to save ${path}:`, err);
    return false;
  }
}

// --- API Utilities ---
async function api(path, opts = {}) {
  const response = await fetch(`${location.origin}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers }
  });
  return response.json();
}

async function patch(id, body) {
  const response = await fetch(`/api/devicedatas/device/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}

function buildHex12(p) {
  const v = x => Math.round(x * 255 / 100).toString(16).padStart(2, '0').toUpperCase();
  return `${v(p)}${v(p)}${v(p)}${v(p)}0000`;
}

// --- DLI and Energy Calculation Utilities ---
const CHANNELS = {
  cw: { nm: 570, factor: 0.85 },
  ww: { nm: 620, factor: 0.75 },
  bl: { nm: 450, factor: 1.0 },
  rd: { nm: 660, factor: 1.0 }
};

function estimateDLI(spectrum, powerW, hoursOn) {
  let par = 0;
  for (const ch in CHANNELS) {
    if (spectrum[ch] !== undefined) {
      par += (spectrum[ch] / 100) * CHANNELS[ch].factor;
    }
  }
  const parUmol = powerW * par * 4.6;
  const dli = (parUmol * 3600 * hoursOn) / 1e6;
  return dli;
}

function estimateEnergy(powerW, hoursOn) {
  return (powerW * hoursOn) / 1000;
}

// --- Tooltip System ---
function showTipFor(el) {
  const tip = document.getElementById('tooltip');
  const content = document.getElementById('tooltip-content');
  if (!tip || !content) return;
  
  const text = el.getAttribute('data-tip') || '';
  content.textContent = text || '';
  
  const rect = el.getBoundingClientRect();
  const top = window.scrollY + rect.top - tip.offsetHeight - 10;
  const left = Math.max(10, Math.min(window.scrollX + rect.left, 
    window.scrollX + document.documentElement.clientWidth - 340));
  
  tip.style.top = (top > 0 ? top : (window.scrollY + rect.bottom + 10)) + 'px';
  tip.style.left = left + 'px';
  tip.setAttribute('data-show', '1');
  tip.setAttribute('aria-hidden', 'false');
}

function hideTip() {
  const tip = document.getElementById('tooltip');
  if (!tip) return;
  tip.removeAttribute('data-show');
  tip.setAttribute('aria-hidden', 'true');
}

function wireHints() {
  document.querySelectorAll('.hint').forEach(hint => {
    hint.addEventListener('mouseenter', () => showTipFor(hint));
    hint.addEventListener('mouseleave', hideTip);
    hint.addEventListener('focus', () => showTipFor(hint));
    hint.addEventListener('blur', hideTip);
    hint.addEventListener('click', (e) => {
      e.preventDefault();
      showTipFor(hint);
      setTimeout(hideTip, 2000);
    });
    hint.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideTip();
    });
  });
  window.addEventListener('scroll', hideTip, { passive: true });
}

// --- Device Card Rendering ---
function deviceCard(device) {
  const card = document.createElement('div');
  card.className = 'card device-card';
  card.dataset.deviceId = device.id;

  // DLI/Energy Metrics Section
  function getFarmPricePerKWh() {
    if (STATE.farm?.pricePerKWh) return STATE.farm.pricePerKWh;
    const raw = localStorage.getItem('gr.farmPriceKWh');
    return raw ? parseFloat(atob(raw)) : 0.18;
  }

  function addTooltip(el, text) {
    el.classList.add('hint');
    el.setAttribute('data-tip', text);
  }

  function getTimeSeriesStats() {
    const stats = device.stats || {};
    const dliArr = stats.dli || [14.4, 14.2, 14.6, 14.1, 14.3, 14.5, 14.0];
    const energyArr = stats.energy || [2.1, 2.0, 2.2, 1.9, 2.1, 2.0, 2.2];
    return {
      dliToday: dliArr[0] || 0,
      dli7d: dliArr.slice(0,7).reduce((a,b)=>a+b,0)/Math.max(1,Math.min(7,dliArr.length)),
      dli30d: dliArr.reduce((a,b)=>a+b,0)/Math.max(1,dliArr.length),
      energyToday: energyArr[0] || 0,
      energy7d: energyArr.slice(0,7).reduce((a,b)=>a+b,0)/Math.max(1,Math.min(7,energyArr.length)),
      energy30d: energyArr.reduce((a,b)=>a+b,0)/Math.max(1,energyArr.length),
      measured: !!stats.measured
    };
  }

  // Create metrics section
  const metricsSection = document.createElement('div');
  metricsSection.className = 'device-metrics';

  const tsStats = getTimeSeriesStats();
  const priceKWh = getFarmPricePerKWh();

  // DLI row
  const dliRow = document.createElement('div');
  dliRow.className = 'device-metric-row';
  dliRow.innerHTML = `<strong>DLI</strong> <span>${tsStats.dliToday.toFixed(2)} mol m⁻² day⁻¹</span> <span>(7d avg: ${tsStats.dli7d.toFixed(2)}, 30d avg: ${tsStats.dli30d.toFixed(2)})</span>`;
  addTooltip(dliRow, 'DLI = PPFD × (3600 × photoperiod) ÷ 1,000,000. Daily Light Integral in mol m⁻² day⁻¹.');
  metricsSection.appendChild(dliRow);

  // Energy row
  const energyRow = document.createElement('div');
  energyRow.className = 'device-metric-row';
  const energyType = tsStats.measured ? 'Measured' : 'Estimated';
  energyRow.innerHTML = `<strong>Energy</strong> <span>${tsStats.energyToday.toFixed(2)} kWh</span> <span>(7d avg: ${tsStats.energy7d.toFixed(2)}, 30d avg: ${tsStats.energy30d.toFixed(2)}) <em>${energyType}</em></span>`;
  addTooltip(energyRow, 'Energy (kWh) = Watts ÷ 1,000 × hours. Measured values use DIN-rail meter; estimated uses fixture wattage × driver %.');
  metricsSection.appendChild(energyRow);

  // Cost row
  const costRow = document.createElement('div');
  costRow.className = 'device-metric-row';
  const costToday = tsStats.energyToday * priceKWh;
  costRow.innerHTML = `<strong>Cost</strong> <span>$${costToday.toFixed(2)} today</span> <span>(rate: $${priceKWh.toFixed(2)}/kWh)</span>`;
  addTooltip(costRow, 'Cost = kWh × electricity rate. Edit rate in farm settings.');
  metricsSection.appendChild(costRow);

  card.appendChild(metricsSection);

  // Device header
  const header = document.createElement('div');
  header.className = 'device-head';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'device-head__title';

  const statusDot = document.createElement('span');
  statusDot.className = 'device-status';
  titleWrap.appendChild(statusDot);

  const title = document.createElement('h3');
  title.className = 'device-title';
  title.textContent = device.deviceName || `Device ${device.id}`;
  titleWrap.appendChild(title);

  const powerBadge = document.createElement('span');
  powerBadge.className = 'device-power';
  powerBadge.textContent = device.onOffStatus ? 'ON' : 'OFF';
  if (!device.onOffStatus) powerBadge.setAttribute('data-status', 'off');
  titleWrap.appendChild(powerBadge);

  const onlineBadge = document.createElement('span');
  onlineBadge.className = 'device-online';
  onlineBadge.textContent = device.online ? 'Online' : 'Offline';

  header.append(titleWrap, onlineBadge);
  card.appendChild(header);

  // Advanced controls (Research Mode conditional)
  const badgeRow = document.createElement('div');
  badgeRow.className = 'device-badges';

  const spectraChip = document.createElement('span');
  spectraChip.className = 'device-spectra-chip';
  spectraChip.textContent = 'SpectraSync';
  badgeRow.appendChild(spectraChip);

  // Find device's group and plan
  const deviceGroup = STATE.groups.find(g => g.lights?.some(l => l.id === device.id));
  if (deviceGroup) {
    const groupChip = document.createElement('span');
    groupChip.className = 'chip';
    groupChip.textContent = deviceGroup.name;
    badgeRow.appendChild(groupChip);
  }

  card.appendChild(badgeRow);

  // Research Mode conditional rendering
  if (!STATE.researchMode) {
    badgeRow.style.display = 'none';
  }

  // Control buttons
  const controls = document.createElement('div');
  controls.className = 'device-controls';

  const onBtn = document.createElement('button');
  onBtn.textContent = 'ON (Safe)';
  onBtn.onclick = () => patch(device.id, {status: "on", value: buildHex12(45)})
    .then(() => setStatus(`${device.deviceName} ON`));

  const offBtn = document.createElement('button');
  offBtn.textContent = 'OFF';
  offBtn.onclick = () => patch(device.id, {status: "off", value: null})
    .then(() => setStatus(`${device.deviceName} OFF`));

  controls.append(onBtn, offBtn);
  card.appendChild(controls);

  return card;
}

// --- Farm Registration System ---
class FarmWizard {
  constructor() {
    this.modal = $('#farmModal');
    this.form = $('#farmWizardForm');
    this.steps = ['farm-name', 'locations', 'contact-name', 'contact-email', 'contact-phone', 'crops', 'review'];
    this.currentStep = 0;
    this.data = {
      farmName: '',
      locations: [],
      contact: { name: '', email: '', phone: '' },
      crops: []
    };
    this.init();
  }

  init() {
    // Wire up modal controls
    $('#btnLaunchFarm')?.addEventListener('click', () => this.open());
    $('#farmModalClose')?.addEventListener('click', () => this.close());
    $('#farmModalBackdrop')?.addEventListener('click', () => this.close());
    
    // Navigation
    $('#farmPrev')?.addEventListener('click', () => this.prevStep());
    $('#farmNext')?.addEventListener('click', () => this.nextStep());
    $('#btnSaveFarm')?.addEventListener('click', (e) => this.saveFarm(e));

    // Step-specific handlers
    this.wireStepHandlers();
    
    // Load existing farm data
    this.loadExistingFarm();
  }

  wireStepHandlers() {
    // Location management
    $('#addFarmLocation')?.addEventListener('click', () => this.addLocation());
    $('#farmLocation')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addLocation();
      }
    });

    // Crop selection
    document.querySelectorAll('.farmCropOption').forEach(checkbox => {
      checkbox.addEventListener('change', () => this.updateCrops());
    });

    $('#farmCropOtherToggle')?.addEventListener('change', (e) => {
      const textInput = $('#farmCropOtherText');
      if (textInput) {
        textInput.style.display = e.target.checked ? 'block' : 'none';
        if (e.target.checked) textInput.focus();
      }
    });
  }

  async loadExistingFarm() {
    const farmData = await loadJSON('./data/farm.json');
    if (farmData) {
      STATE.farm = farmData;
      this.updateFarmDisplay();
    }
  }

  updateFarmDisplay() {
    if (!STATE.farm) return;
    
    const badge = $('#farmBadge');
    const panel = $('#farmPanel');
    const launchBtn = $('#btnLaunchFarm');
    const editBtn = $('#btnEditFarm');
    
    if (badge && panel) {
      badge.style.display = 'block';
      badge.innerHTML = `<strong>${STATE.farm.farmName}</strong> • ${STATE.farm.locations[0]} • ${STATE.farm.contact.name}`;
      
      launchBtn.style.display = 'none';
      editBtn.style.display = 'inline-block';
      editBtn.addEventListener('click', () => this.edit());
    }
  }

  open() {
    this.currentStep = 0;
    this.showStep(0);
    this.modal.setAttribute('aria-hidden', 'false');
  }

  close() {
    this.modal.setAttribute('aria-hidden', 'true');
  }

  edit() {
    this.data = { ...STATE.farm };
    this.open();
  }

  showStep(index) {
    // Hide all steps
    document.querySelectorAll('.farm-step').forEach(step => {
      step.removeAttribute('data-active');
    });

    // Show current step
    const currentStepEl = document.querySelector(`[data-step="${this.steps[index]}"]`);
    if (currentStepEl) {
      currentStepEl.setAttribute('data-active', '');
    }

    // Update progress
    $('#farmModalProgress').textContent = `Step ${index + 1} of ${this.steps.length}`;

    // Update navigation buttons
    const prevBtn = $('#farmPrev');
    const nextBtn = $('#farmNext');
    const saveBtn = $('#btnSaveFarm');

    prevBtn.style.display = index === 0 ? 'none' : 'inline-block';
    
    if (index === this.steps.length - 1) {
      nextBtn.style.display = 'none';
      saveBtn.style.display = 'inline-block';
    } else {
      nextBtn.style.display = 'inline-block';
      saveBtn.style.display = 'none';
    }

    // Step-specific updates
    if (index === this.steps.length - 1) {
      this.updateReview();
    }
  }

  nextStep() {
    if (this.validateCurrentStep()) {
      this.currentStep++;
      this.showStep(this.currentStep);
    }
  }

  prevStep() {
    this.currentStep--;
    this.showStep(this.currentStep);
  }

  validateCurrentStep() {
    const stepName = this.steps[this.currentStep];
    
    switch (stepName) {
      case 'farm-name':
        const farmName = $('#farmName').value.trim();
        if (!farmName) {
          alert('Please enter a farm name');
          return false;
        }
        this.data.farmName = farmName;
        break;
      
      case 'locations':
        if (this.data.locations.length === 0) {
          alert('Please add at least one location');
          return false;
        }
        break;
      
      case 'contact-name':
        const contactName = $('#farmContact').value.trim();
        if (!contactName) {
          alert('Please enter a contact name');
          return false;
        }
        this.data.contact.name = contactName;
        break;
      
      case 'contact-email':
        const email = $('#farmContactEmail').value.trim();
        if (!email || !email.includes('@')) {
          alert('Please enter a valid email address');
          return false;
        }
        this.data.contact.email = email;
        break;
      
      case 'contact-phone':
        this.data.contact.phone = $('#farmContactPhone').value.trim();
        break;
      
      case 'crops':
        // Crops are updated via checkbox handlers
        break;
    }
    
    return true;
  }

  addLocation() {
    const input = $('#farmLocation');
    const location = input.value.trim();
    
    if (location && !this.data.locations.includes(location)) {
      this.data.locations.push(location);
      this.renderLocations();
      input.value = '';
    }
  }

  renderLocations() {
    const list = $('#farmLocationList');
    if (!list) return;
    
    list.innerHTML = this.data.locations.map(location => 
      `<li>${location} <button type="button" onclick="farmWizard.removeLocation('${location}')">×</button></li>`
    ).join('');
  }

  removeLocation(location) {
    this.data.locations = this.data.locations.filter(l => l !== location);
    this.renderLocations();
  }

  updateCrops() {
    this.data.crops = [];
    document.querySelectorAll('.farmCropOption:checked').forEach(checkbox => {
      if (checkbox.value === 'Other') {
        const otherText = $('#farmCropOtherText').value.trim();
        if (otherText) this.data.crops.push(otherText);
      } else {
        this.data.crops.push(checkbox.value);
      }
    });
  }

  updateReview() {
    const review = $('#farmReview');
    if (!review) return;
    
    review.innerHTML = `
      <div><strong>Farm Name:</strong> ${this.data.farmName}</div>
      <div><strong>Locations:</strong> ${this.data.locations.join(', ')}</div>
      <div><strong>Contact:</strong> ${this.data.contact.name}</div>
      <div><strong>Email:</strong> ${this.data.contact.email}</div>
      ${this.data.contact.phone ? `<div><strong>Phone:</strong> ${this.data.contact.phone}</div>` : ''}
      <div><strong>Crops:</strong> ${this.data.crops.join(', ')}</div>
    `;
  }

  async saveFarm(e) {
    e.preventDefault();
    
    const farmData = {
      ...this.data,
      timezone: 'America/Toronto',
      pricePerKWh: 0.18,
      currency: 'CAD',
      registered: new Date().toISOString()
    };

    // Save to state and local storage
    STATE.farm = farmData;
    localStorage.setItem('gr.farm', JSON.stringify(farmData));
    
    // Save to server
    const saved = await saveJSON('./data/farm.json', farmData);
    
    if (saved) {
      setStatus('Farm registration saved successfully');
      this.updateFarmDisplay();
      this.close();
    } else {
      alert('Failed to save farm registration. Please try again.');
    }
  }
}

// --- Data Loading and Initialization ---
async function loadAllData() {
  try {
    // Load device data from API
    const deviceResponse = await api('/api/devicedatas');
    STATE.devices = deviceResponse?.data || [];
    
    // Load static data files
    const [groups, schedules, plans, environment, calibrations] = await Promise.all([
      loadJSON('./data/groups.json'),
      loadJSON('./data/schedules.json'), 
      loadJSON('./data/plans.json'),
      loadJSON('./data/env.json'),
      loadJSON('./data/calibration.json')
    ]);
    
    STATE.groups = groups?.groups || [];
    STATE.schedules = schedules?.schedules || [];
    STATE.plans = plans?.plans || [];
    STATE.environment = environment?.zones || [];
    STATE.calibrations = calibrations?.calibrations || [];
    
    setStatus(`Loaded ${STATE.devices.length} devices, ${STATE.groups.length} groups, ${STATE.schedules.length} schedules`);
    
    // Render UI
    renderDevices();
    renderGroups();
    renderSchedules();
    renderEnvironment();
    renderPlans();
    
  } catch (error) {
    setStatus(`Error loading data: ${error.message}`);
    console.error('Data loading error:', error);
  }
}

function renderDevices() {
  const container = $('#devices');
  if (!container) return;
  
  container.innerHTML = '';
  STATE.devices.forEach(device => {
    const card = deviceCard(device);
    container.appendChild(card);
  });
}

function renderGroups() {
  const select = $('#groupSelect');
  if (!select) return;
  
  select.innerHTML = '<option value="">Select group...</option>' +
    STATE.groups.map(group => `<option value="${group.id}">${group.name}</option>`).join('');
}

function renderSchedules() {
  const select = $('#groupSchedule');
  if (!select) return;
  
  select.innerHTML = '<option value="">No schedule</option>' +
    STATE.schedules.map(schedule => `<option value="${schedule.id}">${schedule.name}</option>`).join('');
}

function renderEnvironment() {
  const container = $('#envZones');
  if (!container) return;
  
  container.innerHTML = STATE.environment.map(zone => `
    <div class="env-zone">
      <div class="env-zone__header">
        <h3 class="env-zone__name">${zone.name}</h3>
        <div class="env-zone__status">
          <span class="env-status-dot"></span>
          <span class="tiny">Normal</span>
        </div>
      </div>
      <div class="env-metrics">
        ${Object.entries(zone.sensors).map(([key, sensor]) => `
          <div class="env-metric">
            <div>
              <div class="env-metric__label">${key.toUpperCase()}</div>
              <div class="env-metric__value">${sensor.current}${key === 'tempC' ? '°C' : key === 'rh' ? '%' : key === 'vpd' ? ' kPa' : ' ppm'}</div>
            </div>
            <div class="env-metric__trend"></div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function renderPlans() {
  const select = $('#planSelect');
  if (!select) return;
  
  select.innerHTML = '<option value="">Select plan...</option>' +
    STATE.plans.map(plan => `<option value="${plan.id}">${plan.name}</option>`).join('');
}

// --- Research Mode Integration ---
function refreshDeviceCards() {
  renderDevices(); // Simple re-render for now
}

// --- Global Event Handlers ---
function wireGlobalEvents() {
  // Research Mode toggle
  const toggle = $('#researchModeToggle');
  if (toggle) {
    STATE.researchMode = getResearchMode();
    toggle.checked = STATE.researchMode;
    toggle.addEventListener('change', () => {
      STATE.researchMode = toggle.checked;
      setResearchMode(STATE.researchMode);
      refreshDeviceCards();
    });
  }

  // Global device controls
  $('#refresh')?.addEventListener('click', loadAllData);
  $('#allOn')?.addEventListener('click', async () => {
    const promises = STATE.devices.map(device => 
      patch(device.id, {status: "on", value: buildHex12(45)})
    );
    await Promise.all(promises);
    setStatus("All devices ON (Safe mode)");
  });
  $('#allOff')?.addEventListener('click', async () => {
    const promises = STATE.devices.map(device => 
      patch(device.id, {status: "off", value: null})
    );
    await Promise.all(promises);
    setStatus("All devices OFF");
  });

  // Modal close handlers
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('[aria-hidden="false"]').forEach(modal => {
        modal.setAttribute('aria-hidden', 'true');
      });
    }
  });
}

// --- Application Initialization ---
let farmWizard;

document.addEventListener('DOMContentLoaded', async () => {
  wireHints();
  wireGlobalEvents();
  
  // Initialize farm wizard
  farmWizard = new FarmWizard();
  
  // Load all data
  await loadAllData();
  
  setStatus("Dashboard loaded");
});
