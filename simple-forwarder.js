import express from 'express';

const app = express();
app.use(express.json());

// In-memory device registry used to emulate the greenhouse controller.
const devices = new Map([
  ['light-001', {
    id: 'light-001',
    deviceName: 'GreenReach Demo Fixture · Propagation · light-001',
    status: 'off',
    value: '000000000000',
    meta: {
      room: 'Propagation Bay',
      zone: 'Propagation North',
      channels: 'CW/WW/Blue/Red'
    }
  }],
  ['light-002', {
    id: 'light-002',
    deviceName: 'GreenReach Demo Fixture · Propagation · light-002',
    status: 'off',
    value: '000000000000',
    meta: {
      room: 'Propagation Bay',
      zone: 'Propagation North',
      channels: 'CW/WW/Blue/Red'
    }
  }],
  ['light-003', {
    id: 'light-003',
    deviceName: 'GreenReach Demo Fixture · Flower · light-003',
    status: 'off',
    value: '000000000000',
    meta: {
      room: 'Flower Bay',
      zone: 'Flower East',
      channels: 'CW/WW/Blue/Red'
    }
  }],
  ['light-004', {
    id: 'light-004',
    deviceName: 'GreenReach Demo Fixture · Flower · light-004',
    status: 'off',
    value: '000000000000',
    meta: {
      room: 'Flower Bay',
      zone: 'Flower East',
      channels: 'CW/WW/Blue/Red'
    }
  }],
  ['light-005', {
    id: 'light-005',
    deviceName: 'GreenReach Demo Fixture · Flower · light-005',
    status: 'off',
    value: '000000000000',
    meta: {
      room: 'Flower Bay',
      zone: 'Flower East',
      channels: 'CW/WW/Blue/Red'
    }
  }]
]);

function serializeDevice(device) {
  return {
    id: device.id,
    deviceName: device.deviceName,
    status: device.status,
    value: device.value,
    meta: device.meta
  };
}

// Basic controller health check used by Charlie's proxy when available.
app.get('/api/healthz', (_req, res) => {
  res.json({ ok: true, status: 'running', service: 'simple-forwarder' });
});

// Enumerate fixtures known to the controller.
app.get('/api/devicedatas', (_req, res) => {
  const data = Array.from(devices.values()).map(serializeDevice);
  res.json({ data, total: data.length });
});

// Inspect a single device record.
app.get('/api/devicedatas/device/:id', (req, res) => {
  const device = devices.get(req.params.id);
  if (!device) return res.status(404).json({ ok: false, error: 'Device not found' });
  res.json({ ok: true, device: serializeDevice(device) });
});

// Update controller state for a specific device (status/value/name).
app.patch('/api/devicedatas/device/:id', (req, res) => {
  const existing = devices.get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Device not found' });

  const body = req.body ?? {};
  if (typeof body.deviceName === 'string' && body.deviceName.trim()) {
    existing.deviceName = body.deviceName.trim();
  }
  if (typeof body.status === 'string' && body.status.trim()) {
    const lowered = body.status.trim().toLowerCase();
    if (lowered === 'on' || lowered === 'off') {
      existing.status = lowered;
    }
  }
  if (typeof body.value === 'string' && /^[0-9a-fA-F]{12}$/.test(body.value.trim())) {
    existing.value = body.value.trim().toUpperCase();
  }

  devices.set(existing.id, existing);
  res.json({ ok: true, device: serializeDevice(existing) });
});

// Catch-all for other API requests so callers receive a structured error.
app.use('/api/*', (_req, res) => {
  res.status(404).json({ ok: false, error: 'Endpoint not implemented in simple forwarder' });
});

const PORT = 8089;
app.listen(PORT, () => {
  console.log(`Simple forwarder running on http://localhost:${PORT}`);
});
