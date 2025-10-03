import { Router } from 'express';

export function createDevicesRouter({ devicesStore, deviceDocToJson, setApiCors, asyncHandler }) {
  const r = Router();

  // CORS preflight
  r.options('/devices', (req, res) => { setApiCors(res); res.status(204).end(); });
  r.options('/devices/:id', (req, res) => { setApiCors(res); res.status(204).end(); });

  // List devices
  r.get('/devices', asyncHandler(async (req, res) => {
    setApiCors(res);
    const rows = await devicesStore.find({});
    rows.sort((a,b)=> String(a.id||'').localeCompare(String(b.id||'')));
    res.json({ devices: rows.map(deviceDocToJson) });
  }));

  // Get one device
  r.get('/devices/:id', asyncHandler(async (req, res) => {
    setApiCors(res);
    const row = await devicesStore.findOne({ id: req.params.id });
    if (!row) return res.status(404).json({ ok:false, error:'not found' });
    res.json(deviceDocToJson(row));
  }));

  // Upsert device
  r.post('/devices', asyncHandler(async (req, res) => {
    setApiCors(res);
    const body = req.body || {};
    const id = String(body.id || body.device_id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });

    const existing = await devicesStore.findOne({ id });
    const doc = {
      id,
      deviceName: body.deviceName || body.name || existing?.deviceName || existing?.name || id,
      manufacturer: body.manufacturer || existing?.manufacturer || '',
      model: body.model || existing?.model || '',
      transport: body.transport || body.protocol || existing?.transport || existing?.protocol || 'other',
      room: body.room || existing?.room || '',
      assignedEquipment: body.assignedEquipment !== undefined ? body.assignedEquipment : (existing?.assignedEquipment || null),
      online: body.online !== undefined ? !!body.online : (existing?.online ?? true),
      updatedAt: new Date().toISOString()
    };

    if (existing) {
      await devicesStore.update({ id }, { $set: doc }, {});
      const updated = await devicesStore.findOne({ id });
      return res.json({ ok: true, device: deviceDocToJson(updated) });
    } else {
      const created = await devicesStore.insert({ ...doc, createdAt: new Date().toISOString() });
      return res.status(201).json({ ok: true, device: deviceDocToJson(created) });
    }
  }));

  // Assign
  r.post('/devices/:id/assign', asyncHandler(async (req, res) => {
    setApiCors(res);
    const { equipmentId } = req.body || {};
    if (!equipmentId) return res.status(400).json({ ok: false, error: 'equipmentId required' });

    const device = await devicesStore.findOne({ id: req.params.id });
    if (!device) return res.status(404).json({ ok: false, error: 'device not found' });

    await devicesStore.update(
      { id: req.params.id },
      { $set: { assignedEquipment: equipmentId, updatedAt: new Date().toISOString() } },
      {}
    );

    const updated = await devicesStore.findOne({ id: req.params.id });
    res.json({ ok: true, device: deviceDocToJson(updated) });
  }));

  // Unassign
  r.delete('/devices/:id/assign', asyncHandler(async (req, res) => {
    setApiCors(res);
    const id = req.params.id;
    const device = await devicesStore.findOne({ id });
    if (!device) return res.status(404).json({ ok: false, error: 'device not found' });
    await devicesStore.update({ id }, { $set: { assignedEquipment: null, updatedAt: new Date().toISOString() } }, {});
    const updated = await devicesStore.findOne({ id });
    res.json({ ok: true, device: deviceDocToJson(updated) });
  }));

  return r;
}
