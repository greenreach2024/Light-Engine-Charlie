const request = require('supertest');
const { startServer, stopServer } = require('./serverHarness.cjs');

let PORT = 8200;

beforeAll(async () => {
  await startServer(PORT);
});

afterAll(() => {
  stopServer();
});

describe('Wizard Suggest & Validation Edge Cases', () => {
  test('Suggest wizards returns sorted confidence', async () => {
    const devices = [
      { ip: '192.168.1.10', hostname: 'mqtt-broker', type: 'mqtt', services: ['mqtt'] },
      { ip: '192.168.1.11', hostname: 'kasa-plug', type: 'smart-plug', services: ['kasa'] }
    ];

    const res = await request(`http://127.0.0.1:${PORT}`)
      .post('/discovery/suggest-wizards')
      .send({ devices })
      .set('Content-Type','application/json');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.suggestions)).toBe(true);

    // Find mqtt suggestion and verify ordering of recommendedWizards
    const mqttSug = res.body.suggestions.find(s => s.device.type === 'mqtt');
    if (mqttSug) {
      const confidences = mqttSug.recommendedWizards.map(w => w.confidence);
      const sorted = [...confidences].sort((a,b)=>b-a);
      expect(confidences).toEqual(sorted);
    }
  });

  test('Suggest wizards respects minConfidence filter', async () => {
    const devices = [
      { ip: '192.168.1.20', hostname: 'multi-device', type: 'mqtt', services: ['mqtt','kasa'] }
    ];

    const res = await request(`http://127.0.0.1:${PORT}`)
      .post('/discovery/suggest-wizards')
      .send({ devices, minConfidence: 50 })
      .set('Content-Type','application/json');

    expect(res.status).toBe(200);
    const mqttSug = res.body.suggestions.find(s => s.device.type === 'mqtt');
    if (mqttSug) {
      expect(mqttSug.recommendedWizards.every(w => w.confidence >= 50)).toBe(true);
    }
  });

  test('Validation rejects missing required field (broker host)', async () => {
    const res = await request(`http://127.0.0.1:${PORT}`)
      .post('/setup/wizards/mqtt-setup/execute-validated')
      .send({ stepId: 'broker-connection', data: { port: 1883 } })
      .set('Content-Type','application/json');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors.some(e => e.toLowerCase().includes('host'))).toBe(true);
  });

  test('Validation rejects out-of-range port', async () => {
    const res = await request(`http://127.0.0.1:${PORT}`)
      .post('/setup/wizards/mqtt-setup/execute-validated')
      .send({ stepId: 'broker-connection', data: { host: 'invalid-host!', port: 70000 } })
      .set('Content-Type','application/json');
    expect(res.status).toBe(400);
    expect(res.body.errors.find(e => e.toLowerCase().includes('port'))).toBeDefined();
  });
});
