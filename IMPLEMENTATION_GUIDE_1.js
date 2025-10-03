// Guide: Update deviceDocToJson function in server-charlie.js (Light Engine Charlie V2)

// Current deviceDocToJson function needs to be updated to emit the Device shape expected by React store:

function deviceDocToJson(d) {
  if (!d) return null;
  const { _id, ...rest } = d;
  
  // Transform to React store expected shape
  return {
    device_id: d.id || d.device_id || _id,
    name: d.deviceName || d.name || d.device_id || _id,
    category: d.category || inferCategoryFromId(d.id || _id),
    protocol: mapTransportToProtocol(d.transport),
    online: d.online ?? true, // Default to true if not specified
    capabilities: d.capabilities || extractCapabilities(d),
    details: {
      manufacturer: d.manufacturer || '',
      model: d.model || '',
      serial: d.serial || '',
      watts: d.watts,
      spectrumMode: d.spectrumMode || '',
      farm: d.farm || '',
      room: d.room || '',
      zone: d.zone || '',
      module: d.module || '',
      level: d.level || '',
      side: d.side || '',
      ...d.extra
    },
    assignedEquipment: d.assignedEquipment || [] // New field for equipment assignments
  };
}

// Helper functions to add:
function mapTransportToProtocol(transport) {
  if (!transport) return 'other';
  const t = transport.toLowerCase();
  if (t.includes('kasa') || t.includes('tplink')) return 'kasa';
  if (t.includes('mqtt')) return 'mqtt';
  if (t.includes('switchbot')) return 'switchbot';
  return 'other';
}

function inferCategoryFromId(id) {
  if (!id) return 'unknown';
  const lower = id.toLowerCase();
  if (lower.includes('light') || lower.includes('led')) return 'lighting';
  if (lower.includes('switch') || lower.includes('outlet')) return 'switch';
  if (lower.includes('sensor')) return 'sensor';
  if (lower.includes('thermostat') || lower.includes('temp')) return 'climate';
  return 'other';
}

function extractCapabilities(device) {
  const caps = {};
  if (device.watts || device.nominalW) caps.power = true;
  if (device.spectrumMode) caps.spectrum = true;
  if (device.transport) caps.remote = true;
  return caps;
}

// Update NeDB seed to include new properties:
async function seedDevicesFromMetaNedb(store) {
  try {
    const count = await store.count({});
    if (count > 0) return;
    const metaPath = path.join(DATA_DIR, 'device-meta.json');
    if (!fs.existsSync(metaPath)) return;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const devices = meta?.devices || {};
    const rows = Object.entries(devices).map(([id, m]) => ({
      id,
      deviceName: m.deviceName || (/^light-/i.test(id) ? id.replace('light-','Light ').toUpperCase() : id),
      manufacturer: m.manufacturer || '',
      model: m.model || '',
      serial: m.serial || '',
      watts: m.watts || m.nominalW || null,
      spectrumMode: m.spectrumMode || '',
      transport: m.transport || m.conn || m.connectivity || '',
      farm: m.farm || '', 
      room: m.room || '', 
      zone: m.zone || '', 
      module: m.module || '', 
      level: m.level || '', 
      side: m.side || '',
      online: m.online ?? true, // NEW: Default online status
      capabilities: m.capabilities || {}, // NEW: Device capabilities
      assignedEquipment: m.assignedEquipment || [], // NEW: Equipment assignments
      category: m.category || inferCategoryFromId(id), // NEW: Device category
      extra: m
    }));
    await store.insert(rows);
    console.log(`[charlie] seeded ${rows.length} device(s) from device-meta.json`);
  } catch (e) {
    console.warn('[charlie] seedDevicesFromMeta (NeDB) failed:', e.message);
  }
}