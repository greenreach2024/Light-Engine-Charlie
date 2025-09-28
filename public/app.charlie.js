const $ = (s, r=document)=>r.querySelector(s);
const setStatus = m => { const el=$("#status"); if(el) el.textContent = m; };

const ENV_METRICS = [
  { key:'tempC', label:'Temperature', unit:'°C', decimals:1, historyKey:'tempC', marginMin:0.5 },
  { key:'rh', label:'Humidity', unit:'%', decimals:1, historyKey:'rh', marginMin:2 },
  { key:'vpd', label:'VPD', unit:'kPa', decimals:2, historyKey:'vpd', marginMin:0.05 },
  { key:'co2', label:'CO₂', unit:'ppm', decimals:0, historyKey:'co2', marginMin:50 },
  { key:'light', label:'Light', unit:'%', decimals:0, historyKey:'light', marginMin:5 },
  { key:'airflow', label:'Airflow', unit:'%', decimals:0, historyKey:'airflow', marginMin:5 }
];

// Global device cache
let DEVICES_CACHE = [];
let ENV_CACHE = null;
let DEVICE_CARD_MAP = new Map();

// --- Research Mode Feature Flag ---
const RESEARCH_MODE_KEY = 'gr.researchMode';
function getResearchMode() {
  const raw = localStorage.getItem(RESEARCH_MODE_KEY);
  return raw === 'true';
}
function setResearchMode(val) {
  localStorage.setItem(RESEARCH_MODE_KEY, val ? 'true' : 'false');
}
let researchMode = getResearchMode();

// Wire up Research Mode toggle UI
window.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('researchModeToggle');
  if (toggle) {
    toggle.checked = researchMode;
    toggle.addEventListener('change', () => {
      researchMode = toggle.checked;
      setResearchMode(researchMode);
      refreshDeviceCards();
    });
  }
});

// --- DLI and Energy Calculation Utilities ---
const CHANNELS = {
  cw: { nm: 570, factor: 0.85 }, // cool white
  ww: { nm: 620, factor: 0.75 }, // warm white
  bl: { nm: 450, factor: 1.0 },  // blue
  rd: { nm: 660, factor: 1.0 }   // red
};

// Calculate DLI (mol/m²/day) from channel % and total power (W)
function estimateDLI(spectrum, powerW, hoursOn) {
  let par = 0;
  for (const ch in CHANNELS) {
    if (spectrum[ch] !== undefined) {
      par += (spectrum[ch] / 100) * CHANNELS[ch].factor;
    }
  }
  const parUmol = powerW * par * 4.6; // Assume 1W ≈ 4.6 umol/s for LEDs
  const dli = (parUmol * 3600 * hoursOn) / 1e6;
  return dli;
}

// Calculate energy usage (kWh/day)
function estimateEnergy(powerW, hoursOn) {
  return (powerW * hoursOn) / 1000;
}

function showTipFor(el){
  const tip = document.getElementById('tooltip');
  const content = document.getElementById('tooltip-content');
  if (!tip || !content) return;
  const text = el.getAttribute('data-tip') || '';
  content.textContent = text || '';
  const r = el.getBoundingClientRect();
  const top = window.scrollY + r.top - tip.offsetHeight - 10;
  const left = Math.max(10, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - 340));
  tip.style.top = (top > 0 ? top : (window.scrollY + r.bottom + 10)) + 'px';
  tip.style.left = left + 'px';
  tip.setAttribute('data-show','1');
  tip.setAttribute('aria-hidden','false');
}

function hideTip(){
  const tip = document.getElementById('tooltip');
  if (!tip) return;
  tip.removeAttribute('data-show');
  tip.setAttribute('aria-hidden','true');
}

function wireHints(){
  document.querySelectorAll('.hint').forEach(h=>{
    h.addEventListener('mouseenter', ()=> showTipFor(h));
    h.addEventListener('mouseleave', hideTip);
    h.addEventListener('focus', ()=> showTipFor(h));
    h.addEventListener('blur', hideTip);
    h.addEventListener('click', (e)=>{ e.preventDefault(); showTipFor(h); setTimeout(hideTip, 2000); });
    h.addEventListener('keydown', (e)=>{ if(e.key==='Escape') hideTip(); });
  });
  window.addEventListener('scroll', hideTip, { passive:true });
}

// Original API utilities
async function api(path, opts={}){
  const res = await fetch(`${location.origin}${path}`, { ...opts, headers:{'Content-Type':'application/json'} });
  return res.json();
}

function buildHex12(p){ const v=x=>Math.round(x*255/100).toString(16).padStart(2,'0').toUpperCase(); return `${v(p)}${v(p)}${v(p)}${v(p)}0000`; }

async function patch(id, body){
  const res = await fetch(`/api/devicedatas/device/${id}`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return res.json();
}

function deviceCard(dev){
  const card = document.createElement('div');
  card.className = 'card device-card';

  // --- DLI/Energy Metrics Section ---
  function getFarmPricePerKWh() {
    const raw = localStorage.getItem('gr.farmPriceKWh');
    return raw ? parseFloat(atob(raw)) : 0.18; // default $0.18/kWh
  }

  function addTooltip(el, text) {
    el.classList.add('hint');
    el.setAttribute('data-tip', text);
  }

  function getTimeSeriesStats() {
    const stats = dev.stats || {};
    const dliArr = stats.dli || [];
    const energyArr = stats.energy || [];
    return {
      dliToday: dliArr[0] || 0,
      dli7d: dliArr.slice(0,7).reduce((a,b)=>a+b,0)/Math.max(1,Math.min(7,dliArr.length)),
      dli30d: dliArr.slice(0,30).reduce((a,b)=>a+b,0)/Math.max(1,Math.min(30,dliArr.length)),
      energyToday: energyArr[0] || 0,
      energy7d: energyArr.slice(0,7).reduce((a,b)=>a+b,0)/Math.max(1,Math.min(7,energyArr.length)),
      energy30d: energyArr.slice(0,30).reduce((a,b)=>a+b,0)/Math.max(1,Math.min(30,energyArr.length)),
      measured: !!stats.measured
    };
  }

  // Metrics UI
  const metricsSection = document.createElement('div');
  metricsSection.className = 'device-metrics';

  const tsStats = getTimeSeriesStats();
  const priceKWh = getFarmPricePerKWh();

  // DLI metrics
  const dliRow = document.createElement('div');
  dliRow.className = 'device-metric-row';
  dliRow.innerHTML = `<strong>DLI</strong> <span>${tsStats.dliToday.toFixed(2)} mol m⁻² day⁻¹</span> <span>(7d avg: ${tsStats.dli7d.toFixed(2)}, 30d avg: ${tsStats.dli30d.toFixed(2)})</span>`;
  addTooltip(dliRow, 'DLI = PPFD × (3600 × photoperiod) ÷ 1,000,000. DLI is Daily Light Integral in mol m⁻² day⁻¹.');
  metricsSection.appendChild(dliRow);

  // Energy metrics
  const energyRow = document.createElement('div');
  energyRow.className = 'device-metric-row';
  const energyType = tsStats.measured ? 'Measured' : 'Estimated';
  energyRow.innerHTML = `<strong>Energy</strong> <span>${tsStats.energyToday.toFixed(2)} kWh</span> <span>(7d avg: ${tsStats.energy7d.toFixed(2)}, 30d avg: ${tsStats.energy30d.toFixed(2)}) <em>${energyType}</em></span>`;
  addTooltip(energyRow, 'Energy (kWh) = Watts ÷ 1,000 × hours. Measured values use DIN-rail meter; estimated uses fixture wattage × driver %.');
  metricsSection.appendChild(energyRow);

  // Cost estimate
  const costRow = document.createElement('div');
  costRow.className = 'device-metric-row';
  const costToday = tsStats.energyToday * priceKWh;
  costRow.innerHTML = `<strong>Cost</strong> <span>$${costToday.toFixed(2)} today</span> <span>(rate: $${priceKWh.toFixed(2)}/kWh)</span>`;
  addTooltip(costRow, 'Cost = kWh × electricity rate. Edit rate in farm settings.');
  metricsSection.appendChild(costRow);

  card.appendChild(metricsSection);

  const head = document.createElement('div');
  head.className = 'device-head';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'device-head__title';

  const statusDot = document.createElement('span');
  statusDot.className = 'device-status';
  titleWrap.appendChild(statusDot);

  const title = document.createElement('h3');
  title.className = 'device-title';
  title.textContent = dev.deviceName || `Device ${dev.id}`;
  titleWrap.appendChild(title);

  const powerBadge = document.createElement('span');
  powerBadge.className = 'device-power';
  powerBadge.textContent = dev.onOffStatus ? 'ON' : 'OFF';
  titleWrap.appendChild(powerBadge);

  const onlineBadge = document.createElement('span');
  onlineBadge.className = 'device-online';
  onlineBadge.textContent = dev.online ? 'Online' : 'Offline';

  head.append(titleWrap, onlineBadge);
  card.appendChild(head);

  const badgeRow = document.createElement('div');
  badgeRow.className = 'device-badges';
  
  const spectraChip = document.createElement('span');
  spectraChip.className = 'device-spectra-chip';
  spectraChip.textContent = 'SpectraSync';
  badgeRow.appendChild(spectraChip);
  
  card.appendChild(badgeRow);

  // Research Mode Conditional Rendering
  if (!researchMode) {
    // Hide advanced controls
    badgeRow.style.display = 'none';
    spectraChip.style.display = 'none';
  } else {
    // Show all advanced controls
    badgeRow.style.display = '';
    spectraChip.style.display = '';
  }

  // Original control buttons
  const controls = document.createElement('div');
  controls.className = 'device-controls';
  const onBtn = document.createElement('button');
  onBtn.textContent = 'ON (Safe)';
  onBtn.onclick = () => patch(dev.id,{status:"on",value:buildHex12(45)}).then(()=>setStatus(`${dev.deviceName} ON`));
  
  const offBtn = document.createElement('button');
  offBtn.textContent = 'OFF';
  offBtn.onclick = () => patch(dev.id,{status:"off",value:null}).then(()=>setStatus(`${dev.deviceName} OFF`));
  
  controls.append(onBtn, offBtn);
  card.appendChild(controls);

  return card;
}

// Refresh device cards when research mode changes
function refreshDeviceCards() {
  const container = document.getElementById('devices');
  if (!container) return;
  
  DEVICES_CACHE.forEach(dev => {
    const existingCard = DEVICE_CARD_MAP.get(dev.id);
    if (existingCard) {
      const newCard = deviceCard(dev);
      existingCard.replaceWith(newCard);
      DEVICE_CARD_MAP.set(dev.id, newCard);
    }
  });
}

async function fetchDevices(){
  try {
    const j = await api('/api/devicedatas');
    const list = j?.data || [];
    DEVICES_CACHE = list;
    
    const container = $("#devices");
    container.innerHTML = '';
    DEVICE_CARD_MAP.clear();
    
    list.forEach(dev => {
      const card = deviceCard(dev);
      DEVICE_CARD_MAP.set(dev.id, card);
      container.appendChild(card);
    });
    
    setStatus(`Found ${list.length} device(s).`);
  } catch(e){
    setStatus(`Error loading devices: ${e.message}`);
  }
}

function render(devs){ 
  const h=$("#devices"); 
  h.innerHTML=''; 
  devs.forEach(d=>h.append(deviceCard(d))); 
}

// Load devices on page load
document.addEventListener('DOMContentLoaded', ()=>{
  wireHints();
  $('#refresh')?.addEventListener('click', fetchDevices);
  $('#allOn')?.addEventListener('click', ()=>api('/api/devicedatas').then(j=>Promise.all(j.data.map(d=>patch(d.id,{status:"on",value:buildHex12(45)})))).then(()=>setStatus("All ON Safe")));
  $('#allOff')?.addEventListener('click', ()=>api('/api/devicedatas').then(j=>Promise.all(j.data.map(d=>patch(d.id,{status:"off",value:null})))).then(()=>setStatus("All OFF")));
  fetchDevices();
});

// Farm registration functionality
const farmModal = $("#farmModal");
const btnLaunchFarm = $("#btnLaunchFarm");
const btnEditFarm = $("#btnEditFarm");
const farmModalClose = farmModal?.querySelector(".farm-modal__close");

btnLaunchFarm?.addEventListener('click', () => {
  farmModal.setAttribute('aria-hidden', 'false');
});

farmModalClose?.addEventListener('click', () => {
  farmModal.setAttribute('aria-hidden', 'true');
});

// Close modal on escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && farmModal.getAttribute('aria-hidden') === 'false') {
    farmModal.setAttribute('aria-hidden', 'true');
  }
});

// Close modal on backdrop click
farmModal?.querySelector('.farm-modal__backdrop')?.addEventListener('click', () => {
  farmModal.setAttribute('aria-hidden', 'true');
});
