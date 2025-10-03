const request = require('supertest');
const { startServer, stopServer } = require('../wizards/serverHarness.cjs');

let PORT = 8299;

function api(method, path, body){
  let r = request(`http://127.0.0.1:${PORT}`)[method.toLowerCase()](path).set('Content-Type','application/json');
  if (body) r = r.send(body);
  return r;
}

beforeAll(async ()=>{
  await startServer(PORT);
});

afterAll(()=> stopServer());

describe('Device assignment route singleton', () => {
  test('only one POST/DELETE implementation is mounted', async () => {
    const dbg = await api('GET','/__debug/routes');
    expect(dbg.status).toBe(200);
    const assignPost = dbg.body.routes.filter(r => r.method==='POST' && r.path==='/devices/:id/assign');
    const assignDelete = dbg.body.routes.filter(r => r.method==='DELETE' && r.path==='/devices/:id/assign');
    expect(assignPost.length).toBe(1);
    expect(assignDelete.length).toBe(1);
  });

  test('assign then unassign device works', async () => {
    // Seed a device directly via upsert endpoint (if exists) or fallback create
    const deviceId = 'test-device-assign';
    // Upsert/create device (leveraging PATCH or POST /devices if available)
    // Use POST /devices with id
    const upsert = await api('POST','/devices',{ id: deviceId, name: 'Test Device' });
    expect([200,201,204]).toContain(upsert.status);

    const assign = await api('POST', `/devices/${deviceId}/assign`, { equipmentId: 'equip-123' });
    expect(assign.status).toBe(200);
    expect(assign.body.device.assignedEquipment).toBe('equip-123');

    const unassign = await api('DELETE', `/devices/${deviceId}/assign`);
    expect(unassign.status).toBe(200);
    expect(unassign.body.device.assignedEquipment).toBe(null);
  });
});
