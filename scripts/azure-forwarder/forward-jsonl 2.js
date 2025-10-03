#!/usr/bin/env node
/**
 * Local JSONL forwarder for environment telemetry → POST /ingest/env
 * Each line should be a JSON object with fields:
 * { zoneId, name, temperature, humidity, vpd, co2, battery, rssi, source }
 */

import fs from 'fs';
import http from 'http';

const [, , filePath, host = '127.0.0.1', port = '8091'] = process.argv;
if (!filePath) {
  console.error('Usage: node forward-jsonl.js <file.jsonl> [host] [port]');
  process.exit(1);
}

const post = (payload) => new Promise((resolve, reject) => {
  const data = Buffer.from(JSON.stringify(payload));
  const req = http.request({
    hostname: host,
    port: Number(port),
    path: '/ingest/env',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
  }, (res) => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', reject);
  req.write(data);
  req.end();
});

(async () => {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  let buf = '';
  let count = 0;
  stream.on('data', async (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        const { zoneId, name, temperature, humidity, vpd, co2, battery, rssi, source } = obj;
        if (!zoneId) { console.warn('Skipping line without zoneId'); continue; }
        const payload = { zoneId, name, temperature, humidity, vpd, co2, battery, rssi, source };
        const res = await post(payload);
        if (res.status !== 200) console.error('POST failed:', res.status, res.body);
        count++;
        if (count % 50 === 0) {
          console.log(`Forwarded ${count} messages...`);
        }
      } catch (e) {
        console.error('Invalid JSON line:', e.message);
      }
    }
  });
  stream.on('end', () => console.log(`Done. Forwarded ~${count} messages.`));
  stream.on('error', (e) => { console.error('Stream error:', e.message); process.exit(1); });
})();
