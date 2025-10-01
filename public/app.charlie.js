const API_BASE = window.API_BASE ?? '';

const MH_PROFILE = {
  make: 'GROW3',
  model: 'TopLight MH 300W',
  wattageW: 300,
  ppf: 709,
  ppe: 2.59,
  spectrumType: 'MH static (blue-accented)',
  spectrumNotes: 'R:B default 0.68:1; adjustable 0.68:1–2:1; no UV/FR',
  controlBadges: ['Bluetooth®', 'Wi-Fi', 'LYNX3™', 'SmarTune™'],
  cctRangeNm: '400–700',
  dimming: true,
  ingress: 'IP66',
  dimensionsMm: '1240 × 140 × 76',
  weightKg: '6.35 kg'
};

const MODEL_KEY = `${MH_PROFILE.make}:${MH_PROFILE.model}`;

const state = {
  connectivity: {
    healthz: null,
    devices: null,
    errors: []
  },
  discovery: {
    runs: 0,
    channels: []
  },
  devices: [],
  farm: {
    lightInventory: [
      {
        key: MODEL_KEY,
        selected: true,
        ...MH_PROFILE,
        notes: 'R:B default 0.68:1; range 0.68:1–2:1; dimming: yes; UV/Far-Red: no.',
        controlProfiles: [
          {
            name: 'Room A — 0-10V',
            method: '0-10v',
            endpoint: { ip: '192.168.2.90' },
            limits: { min: 0, max: 100 }
          },
          {
            name: 'Room B — WiFi',
            method: 'wifi',
            endpoint: { ip: '192.168.2.71' },
            limits: { min: 0, max: 100 }
          }
        ]
      }
    ]
  },
  groups: []
};

const els = {
  connectivityStatus: document.querySelector('#connectivity-status'),
  discoveryResults: document.querySelector('#discovery-results'),
  inventoryPanel: document.querySelector('#inventory-panel'),
  controlProfiles: document.querySelector('#control-profile-panel'),
  groupBuilder: document.querySelector('#group-builder'),
  groupCards: document.querySelector('#group-cards'),
  steps: document.querySelector('#wizard-steps')
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function percentToHex(value) {
  const pct = clamp(Number(value) || 0, 0, 100);
  const hex = Math.round((pct * 255) / 100)
    .toString(16)
    .padStart(2, '0');
  return hex.toUpperCase();
}

function computeMhChannels({ master, ratio, whiteShare }) {
  const safeMaster = clamp(master, 0, 100);
  const safeRatio = clamp(ratio, 0.68, 2.0);
  const safeWhiteShare = clamp(whiteShare, 0, 1);

  const whitePortion = safeMaster * safeWhiteShare;
  const colourPortion = safeMaster - whitePortion;
  const blue = colourPortion / (1 + safeRatio);
  const red = blue * safeRatio;
  const cw = Math.max(0, whitePortion / 2);
  const ww = Math.max(0, whitePortion / 2);

  const total = cw + ww + blue + red;
  if (total > 0) {
    const scale = safeMaster / total;
    return {
      cw: cw * scale,
      ww: ww * scale,
      blue: blue * scale,
      red: red * scale
    };
  }

  return { cw: 0, ww: 0, blue: 0, red: 0 };
}

function buildHexString({ cw, ww, blue, red }) {
  return [cw, ww, blue, red].map(percentToHex).join('') + '0000';
}

function createElement(tag, options = {}) {
  const el = document.createElement(tag);
  if (options.className) el.className = options.className;
  if (options.textContent != null) el.textContent = options.textContent;
  if (options.html != null) el.innerHTML = options.html;
  if (options.attrs) {
    Object.entries(options.attrs).forEach(([key, value]) => {
      el.setAttribute(key, value);
    });
  }
  return el;
}

async function apiGet(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function apiPatch(path, payload) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function runConnectivity() {
  const statusList = els.connectivityStatus;
  statusList.innerHTML = '';
  state.connectivity.errors = [];

  const append = (label, value) => {
    const dt = createElement('dt', { textContent: label });
    const dd = createElement('dd', { textContent: value });
    statusList.appendChild(dt);
    statusList.appendChild(dd);
  };

  try {
    const health = await apiGet('/healthz');
    state.connectivity.healthz = health.status;
    append('Controller health', `Status: ${health.status}`);
  } catch (error) {
    state.connectivity.healthz = 'error';
    state.connectivity.errors.push(error.message);
    append('Controller health', `Error: ${error.message}`);
  }

  try {
    const deviceData = await apiGet('/api/devicedatas');
    state.connectivity.devices = 'ok';
    state.devices = (deviceData.devices || []).map(device => ({
      ...device
    }));
    append('Devices', `Loaded ${state.devices.length} fixtures`);
    renderDiscovery();
    renderGroupBuilder();
    renderGroupCards();
  } catch (error) {
    state.connectivity.devices = 'error';
    state.connectivity.errors.push(error.message);
    append('Devices', `Error: ${error.message}`);
  }
}

function runDiscovery() {
  state.discovery.runs += 1;
  const channels = new Set();
  state.devices.forEach(device => {
    (device.controlMethods || []).forEach(method => channels.add(method));
  });
  state.discovery.channels = Array.from(channels);
  renderDiscovery();
}

function renderDiscovery() {
  const container = els.discoveryResults;
  container.innerHTML = '';
  if (!state.devices.length) {
    container.textContent = 'No devices discovered yet.';
    return;
  }
  const header = createElement('p', {
    className: 'muted',
    textContent: `Discovered ${state.devices.length} device(s) across ${state.discovery.channels.length || 0} control lanes.`
  });
  container.appendChild(header);
  state.devices.forEach(device => {
    const tag = createElement('div', {
      className: 'discovery-tag',
      textContent: `${device.label} · ${device.controlMethods?.join(', ') || 'controller managed'}`
    });
    container.appendChild(tag);
  });
  state.discovery.channels.forEach(channel => {
    const tag = createElement('div', {
      className: 'discovery-tag',
      textContent: `Lane: ${channel}`
    });
    container.appendChild(tag);
  });
}

function renderInventory() {
  const panel = els.inventoryPanel;
  panel.innerHTML = '';
  state.farm.lightInventory.forEach(model => {
    const card = createElement('div', { className: 'model-card' });
    const header = createElement('header');
    const title = createElement('h3', { textContent: `${model.make} ${model.model}` });
    const subtitle = createElement('p', {
      className: 'model-card__subtitle',
      textContent: `${model.wattageW} W · PPF ${model.ppf} µmol/s · PPE ${model.ppe} µmol/J`
    });
    header.appendChild(title);
    header.appendChild(subtitle);

    const specs = createElement('dl', { className: 'model-card__specs' });
    const specEntries = [
      ['Spectrum', model.spectrumType],
      ['Spectrum notes', model.spectrumNotes],
      ['CCT range', `${model.cctRangeNm} nm`],
      ['Dimming', model.dimming ? 'Yes' : 'No'],
      ['Ingress', model.ingress],
      ['Dimensions', model.dimensionsMm],
      ['Weight', model.weightKg],
      ['R:B best range', '0.68:1 – 2:1']
    ];
    specEntries.forEach(([label, value]) => {
      specs.appendChild(createElement('dt', { textContent: label }));
      specs.appendChild(createElement('dd', { textContent: value }));
    });

    const footer = createElement('footer', { className: 'model-card__footer' });
    model.controlBadges.forEach(badge => {
      footer.appendChild(createElement('span', { className: 'badge', textContent: badge }));
    });

    const checkbox = createElement('label', { className: 'field-inline' });
    const input = createElement('input', {
      attrs: {
        type: 'checkbox',
        checked: model.selected ? 'checked' : null
      }
    });
    input.checked = Boolean(model.selected);
    input.addEventListener('change', () => {
      model.selected = input.checked;
      renderControlProfiles();
      renderGroupBuilder();
    });
    checkbox.appendChild(input);
    checkbox.appendChild(createElement('span', { textContent: 'Include this model' }));

    card.appendChild(header);
    card.appendChild(specs);
    card.appendChild(footer);
    card.appendChild(checkbox);
    panel.appendChild(card);
  });
}

function renderControlProfiles() {
  const panel = els.controlProfiles;
  panel.innerHTML = '';
  state.farm.lightInventory
    .filter(model => model.selected)
    .forEach(model => {
      const wrapper = createElement('div', { className: 'control-profile-list' });
      wrapper.appendChild(
        createElement('h3', {
          textContent: `${model.make} ${model.model} — Control Profiles`
        })
      );

      if (!model.controlProfiles.length) {
        wrapper.appendChild(
          createElement('p', {
            className: 'muted',
            textContent: 'No control profiles defined yet.'
          })
        );
      } else {
        model.controlProfiles.forEach(profile => {
          const card = createElement('div', { className: 'model-card' });
          card.appendChild(
            createElement('h4', {
              textContent: profile.name
            })
          );
          const details = createElement('p', {
            className: 'group-card__light-summary',
            textContent: `${profile.method.toUpperCase()} · Endpoint ${formatEndpoint(profile.endpoint)} · Limits ${profile.limits?.min ?? 0}–${profile.limits?.max ?? 100}`
          });
          card.appendChild(details);
          wrapper.appendChild(card);
        });
      }

      const form = createElement('form', { className: 'group-form' });
      form.innerHTML = `
        <label>Profile name
          <input type="text" name="name" placeholder="Room C — BLE" required />
        </label>
        <label>Method
          <select name="method" required>
            <option value="0-10v">0-10V</option>
            <option value="wifi">Wi-Fi</option>
            <option value="ble">BLE</option>
            <option value="smartPlug">Smart plug</option>
          </select>
        </label>
        <label>Endpoint (IP / host / token)
          <input type="text" name="endpoint" placeholder="192.168.2.120" required />
        </label>
        <label>Min / Max (%)
          <div class="field-inline">
            <input type="number" name="min" min="0" max="100" value="0" required />
            <input type="number" name="max" min="0" max="100" value="100" required />
          </div>
        </label>
        <button type="submit">Add control profile</button>
      `;
      form.addEventListener('submit', event => {
        event.preventDefault();
        const formData = new FormData(form);
        const name = formData.get('name');
        const method = formData.get('method');
        const endpointValue = formData.get('endpoint');
        const min = Number(formData.get('min'));
        const max = Number(formData.get('max'));
        model.controlProfiles.push({
          name,
          method,
          endpoint: parseEndpoint(endpointValue),
          limits: { min, max }
        });
        form.reset();
        renderControlProfiles();
        renderGroupBuilder();
      });
      wrapper.appendChild(form);
      panel.appendChild(wrapper);
    });
}

function parseEndpoint(text) {
  if (!text) return {};
  if (text.includes(':')) {
    const [key, value] = text.split(':', 2);
    return { [key.trim()]: value.trim() };
  }
  return { ip: text.trim() };
}

function formatEndpoint(endpoint = {}) {
  const entries = Object.entries(endpoint);
  if (!entries.length) return 'Not set';
  return entries.map(([key, value]) => `${key}=${value}`).join(', ');
}

function renderGroupBuilder() {
  const panel = els.groupBuilder;
  panel.innerHTML = '';
  const selectedModels = state.farm.lightInventory.filter(model => model.selected);
  if (!selectedModels.length) {
    panel.appendChild(
      createElement('p', {
        className: 'muted',
        textContent: 'Select at least one model to start grouping.'
      })
    );
    return;
  }

  selectedModels.forEach(model => {
    const wrapper = createElement('div', { className: 'group-form' });
    wrapper.appendChild(
      createElement('h3', {
        textContent: `Create a group — ${model.make} ${model.model}`
      })
    );

    const form = createElement('form', { className: 'group-form' });
    form.innerHTML = `
      <label>Group label
        <input type="text" name="label" value="Leafy — A" required />
      </label>
      <label>Plan key
        <input type="text" name="planKey" value="MH-Leafy-16/8" required />
      </label>
      <label>Photoperiod (hours)
        <input type="number" name="photoperiod" min="1" max="24" value="16" required />
      </label>
      <label>Ramp durations (minutes)
        <div class="field-inline">
          <input type="number" name="sunrise" min="0" max="120" value="10" required />
          <input type="number" name="sunset" min="0" max="120" value="10" required />
        </div>
      </label>
      <label>Master intensity (%)
        <input type="number" name="master" min="0" max="100" value="70" required />
      </label>
      <label>Red : Blue ratio (0.68 – 2.0)
        <input type="number" name="ratio" min="0.68" max="2" step="0.01" value="0.68" required />
      </label>
      <label>White share (0 – 1)
        <input type="number" name="whiteShare" min="0" max="1" step="0.01" value="0.6" required />
        <small>Portion of power allocated to CW/WW channels.</small>
      </label>
      <label>Control profile
        <select name="controlProfile" required>
          ${model.controlProfiles
            .map(profile => `<option value="${profile.name}">${profile.name} (${profile.method})</option>`)
            .join('')}
        </select>
      </label>
      <fieldset>
        <legend>Devices</legend>
        <ul class="checkbox-list">
          ${state.devices
            .filter(device => device.model === model.model)
            .map(device => `
              <li>
                <input type="checkbox" name="device" value="${device.id}" id="device-${device.id}" checked />
                <label for="device-${device.id}">${device.label} · Controller ID ${device.controllerId}</label>
              </li>
            `)
            .join('')}
        </ul>
      </fieldset>
      <button type="submit">Create group</button>
    `;

    form.addEventListener('submit', event => {
      event.preventDefault();
      const formData = new FormData(form);
      const members = formData.getAll('device');
      if (!members.length) {
        alert('Select at least one device.');
        return;
      }
      const label = formData.get('label');
      const planKey = formData.get('planKey');
      const photoperiod = Number(formData.get('photoperiod'));
      const sunrise = Number(formData.get('sunrise'));
      const sunset = Number(formData.get('sunset'));
      const master = Number(formData.get('master'));
      const ratio = Number(formData.get('ratio'));
      const whiteShare = Number(formData.get('whiteShare'));
      const controlProfile = formData.get('controlProfile');

      const targets = computeMhChannels({ master, ratio, whiteShare });
      const hex = buildHexString(targets);
      const devices = state.devices.filter(device => members.includes(device.id));

      const metrics = computePlanMetrics({ master, photoperiod });

      const group = {
        id: `g:${label.replace(/\s+/g, '-')}`,
        label,
        lightModel: model.key,
        controlProfile,
        members: devices.map(device => ({
          id: device.id,
          controllerId: device.controllerId,
          label: device.label
        })),
        plan: {
          planKey,
          photoperiod,
          ramp: { sunrise, sunset },
          master,
          ratio,
          whiteShare,
          targets,
          hex,
          metrics
        },
        lastApply: null
      };

      state.groups.push(group);
      renderGroupCards();
    });

    wrapper.appendChild(form);
    panel.appendChild(wrapper);
  });
}

function computePlanMetrics({ master, photoperiod }) {
  const intensityFraction = clamp(master, 0, 100) / 100;
  const energyKWh = (MH_PROFILE.wattageW * intensityFraction * photoperiod) / 1000;
  const dli = (MH_PROFILE.ppf * intensityFraction * photoperiod * 3600) / 1_000_000;
  return {
    energyKWh,
    dli
  };
}

function renderGroupCards() {
  const container = els.groupCards;
  container.innerHTML = '';
  if (!state.groups.length) {
    container.appendChild(
      createElement('p', {
        className: 'muted',
        textContent: 'No groups created yet. Build a group to view live cards.'
      })
    );
    return;
  }

  state.groups.forEach((group, index) => {
    const template = document.querySelector('#group-card-template');
    const fragment = template.content.cloneNode(true);
    const root = fragment.querySelector('.group-card');

    fragment.querySelector('.group-card__title').textContent = group.label;

    const lightSummary = `${MH_PROFILE.make} ${MH_PROFILE.model} · ${MH_PROFILE.wattageW} W · ${MH_PROFILE.spectrumType} · R:B default 0.68:1 (range 0.68–2:1) · Control: ${group.controlProfile}`;
    fragment.querySelector('.group-card__light-summary').textContent = lightSummary;

    const lightSpecs = fragment.querySelector('.group-card__light-specs');
    const specs = [
      ['Spectrum notes', MH_PROFILE.spectrumNotes],
      ['CCT range', `${MH_PROFILE.cctRangeNm} nm`],
      ['Dimming', 'Yes'],
      ['Ingress', MH_PROFILE.ingress],
      ['Dimensions', MH_PROFILE.dimensionsMm],
      ['Weight', MH_PROFILE.weightKg]
    ];
    specs.forEach(([label, value]) => {
      lightSpecs.appendChild(createElement('dt', { textContent: label }));
      lightSpecs.appendChild(createElement('dd', { textContent: value }));
    });

    fragment.querySelector('.group-card__members').textContent = `Members: ${group.members
      .map(member => member.controllerId)
      .join(', ')}`;

    const planSpecs = fragment.querySelector('.group-card__plan-specs');
    const { plan } = group;
    const channelLine = `CW ${plan.targets.cw.toFixed(1)}% · WW ${plan.targets.ww.toFixed(1)}% · Blue ${plan.targets.blue.toFixed(1)}% · Red ${plan.targets.red.toFixed(1)}%`;
    [
      ['Plan key', plan.planKey],
      ['Photoperiod', `${plan.photoperiod}h (ramp ${plan.ramp.sunrise}/${plan.ramp.sunset} min)`],
      ['Master intensity', `${plan.master}%`],
      ['Red:Blue ratio', plan.ratio.toFixed(2)],
      ['White share', plan.whiteShare.toFixed(2)],
      ['Channel allocation', channelLine]
    ].forEach(([label, value]) => {
      planSpecs.appendChild(createElement('dt', { textContent: label }));
      planSpecs.appendChild(createElement('dd', { textContent: value }));
    });

    const hexContainer = fragment.querySelector('.group-card__hex');
    hexContainer.innerHTML = `
      <span>HEX12 payload</span>
      <strong>${plan.hex}</strong>
      <span class="muted">Layout [CW][WW][Blue][Red][00][00]</span>
    `;

    const badges = fragment.querySelector('.group-card__badges');
    badges.appendChild(
      createElement('span', {
        className: 'group-card__badge',
        attrs: { title: 'Daily Light Integral (mol/m²/day)' },
        textContent: `DLI: ${plan.metrics.dli.toFixed(2)}`
      })
    );
    badges.appendChild(
      createElement('span', {
        className: 'group-card__badge',
        attrs: { title: 'Estimated energy consumption in kWh per day' },
        textContent: `kWh: ${plan.metrics.energyKWh.toFixed(2)}`
      })
    );

    const applyButton = fragment.querySelector('.group-card__apply');
    applyButton.dataset.groupIndex = String(index);
    applyButton.addEventListener('click', () => applyPlanToGroup(index));

    if (group.lastApply) {
      const statusLine = createElement('p', {
        className: 'group-card__members',
        textContent: `Last apply: ${group.lastApply}`
      });
      hexContainer.appendChild(statusLine);
    }

    container.appendChild(fragment);
  });
}

async function applyPlanToGroup(index) {
  const group = state.groups[index];
  if (!group) return;
  const payload = { status: 'on', value: group.plan.hex };
  const results = [];

  for (const member of group.members) {
    try {
      await apiPatch(`/api/devicedatas/device/${member.id}`, payload);
      results.push(`${member.controllerId}: OK`);
    } catch (error) {
      results.push(`${member.controllerId}: ${error.message}`);
    }
  }

  group.lastApply = `${new Date().toLocaleTimeString()} — ${results.join(' | ')}`;
  renderGroupCards();
}

function attachStepHandlers() {
  els.steps.querySelector('[data-action="run-connectivity"]').addEventListener('click', runConnectivity);
  els.steps.querySelector('[data-action="run-discovery"]').addEventListener('click', runDiscovery);
}

function bootstrap() {
  attachStepHandlers();
  renderInventory();
  renderControlProfiles();
  renderGroupBuilder();
  renderGroupCards();
  runConnectivity();
}

bootstrap();
