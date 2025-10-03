const request = require('supertest');
const { startServer, stopServer } = require('./serverHarness.cjs');

function api(path, method, body, port) {
  let r = request(`http://127.0.0.1:${port}`)[method.toLowerCase()](path).set('Content-Type','application/json');
  if (body) r = r.send(body);
  return r;
}

let PORT = 8199;

beforeAll(async () => {
  await startServer(PORT);
});

afterAll(() => {
  stopServer();
});

describe('Wizard Regression Flows', () => {
  test('MQTT wizard basic step sequence with validation endpoint', async () => {
    // Step 1: execute broker credentials
    const step1 = await api('/setup/wizards/mqtt-setup/execute-validated','POST',{
      stepId: 'broker-connection',
      data: { host: '127.0.0.1', port: 1883, secure: false }
    }, PORT);
    expect(step1.status).toBe(200);
    expect(step1.body.success).toBe(true);
    expect(step1.body.result.success).toBe(true);

    const status1 = await request(`http://127.0.0.1:${PORT}`).get('/setup/wizards/mqtt-setup/status');
    expect(status1.status).toBe(200);
    const progress1 = status1.body.status.progress;

    // Step 2: topic discovery
    const step2 = await api('/setup/wizards/mqtt-setup/execute-validated','POST',{
      // discoverTime must be >= 10 per validation rules
      stepId: 'topic-discovery', data: { baseTopic: 'farm/#', discoverTime: 15 }
    }, PORT);
    expect(step2.status).toBe(200);
    expect(step2.body.success).toBe(true);

    const status2 = await request(`http://127.0.0.1:${PORT}`).get('/setup/wizards/mqtt-setup/status');
    expect(status2.status).toBe(200);
    expect(status2.body.status.progress).toBeGreaterThanOrEqual(progress1);

    // Step 3: sensor mapping (dynamic)
    const step3 = await api('/setup/wizards/mqtt-setup/execute-validated','POST',{
      stepId: 'sensor-mapping', data: { sensorType: 'temperature', topic: 'farm/room1/temp', unit: 'C' }
    }, PORT);
    expect(step3.status).toBe(200);
    expect(step3.body.success).toBe(true);

    // Status
  const status = await request(`http://127.0.0.1:${PORT}`).get('/setup/wizards/mqtt-setup/status');
  expect(status.status).toBe(200);
  expect(status.body.success).toBe(true);
  expect(status.body.status).toBeDefined();
  expect(status.body.status.progress).toBeGreaterThanOrEqual(status2.body.status.progress);
  }, 20000);

  test('Kasa wizard credential + discovery flow', async () => {
    // Execute Kasa discovery step directly if exists
    const step1 = await api('/setup/wizards/kasa-setup/execute','POST',{
      stepId: 'device-discovery', data: { discoveryTimeout: 5, broadcastDiscovery: true }
    }, PORT);
  expect(step1.status).toBe(200);
  // Kasa discovery may fail without devices; ensure response shape exists
  expect(step1.body).toHaveProperty('success');

    const kstatus = await request(`http://127.0.0.1:${PORT}`).get('/setup/wizards/kasa-setup/status');
    expect(kstatus.status).toBe(200);
    expect(kstatus.body.success).toBe(true);
  }, 15000);

  test('SwitchBot wizard api credentials + discovery', async () => {
    // API credentials step (if defined)
    const cred = await api('/setup/wizards/switchbot-setup/execute','POST',{
      stepId: 'api-credentials', data: { apiKey: 'dummy', secret: 'dummy' }
    }, PORT);
    expect([200,400]).toContain(cred.status);

    // Discovery step
    const disc = await api('/setup/wizards/switchbot-setup/execute','POST',{
      stepId: 'device-discovery', data: { discoveryTimeout: 5 }
    }, PORT);
    expect(disc.status).toBe(200);
    expect(disc.body.success).toBe(true);
  }, 15000);
});
