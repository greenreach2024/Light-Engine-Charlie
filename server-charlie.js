import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8091;

const MH_PROFILE = {
  make: 'GROW3',
  model: 'TopLight MH 300W',
  wattageW: 300,
  ppf: 709,
  ppe: 2.59,
  cctRangeNm: '400–700',
  spectrumType: 'Static MH (blue-accented)',
  spectrumNotes: 'R:B default 0.68:1; adjustable 0.68:1–2:1; no UV/FR',
  dimming: true,
  ingress: 'IP66',
  controlBadges: ['Bluetooth®', 'Wi-Fi', 'LYNX3™', 'SmarTune™'],
  dimensionsMm: '1240 × 140 × 76',
  weightKg: 6.35
};

const controllerState = {
  devices: [
    {
      id: '1',
      controllerId: 'F00001',
      label: 'TopLight MH 300W — Fixture 1',
      status: 'off',
      value: null,
      make: MH_PROFILE.make,
      model: MH_PROFILE.model,
      controlMethods: ['0-10v', 'wifi'],
      lastUpdated: new Date().toISOString()
    },
    {
      id: '2',
      controllerId: 'F00002',
      label: 'TopLight MH 300W — Fixture 2',
      status: 'off',
      value: null,
      make: MH_PROFILE.make,
      model: MH_PROFILE.model,
      controlMethods: ['0-10v', 'wifi'],
      lastUpdated: new Date().toISOString()
    }
  ]
};

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.headers['access-control-request-headers']) {
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers']);
  } else {
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function handleStatic(req, res, parsedUrl) {
  let pathname = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  }[ext] || 'text/plain; charset=utf-8';
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Payload too large'));
        req.connection.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function isHex12(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{12}$/.test(value);
}

const server = http.createServer(async (req, res) => {
  try {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/healthz' || pathname === '/healthz') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }

      if (pathname === '/api/devicedatas' && req.method === 'GET') {
        sendJson(res, 200, {
          devices: controllerState.devices,
          profile: MH_PROFILE
        });
        return;
      }

      const devicePatchMatch = pathname.match(/^\/api\/devicedatas\/device\/(\w+)$/);
      if (devicePatchMatch && req.method === 'PATCH') {
        const deviceId = devicePatchMatch[1];
        const device = controllerState.devices.find(d => d.id === deviceId);
        if (!device) {
          sendJson(res, 404, { error: 'Device not found' });
          return;
        }
        const bodyText = await readBody(req);
        let payload;
        try {
          payload = JSON.parse(bodyText || '{}');
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON' });
          return;
        }
        const { status, value } = payload;
        if (!['on', 'off'].includes(status)) {
          sendJson(res, 400, { error: 'Invalid status' });
          return;
        }
        if (status === 'on') {
          if (!isHex12(value)) {
            sendJson(res, 400, { error: 'HEX12 value required when status is on' });
            return;
          }
          device.value = value.toLowerCase();
        } else {
          device.value = null;
        }
        device.status = status;
        device.lastUpdated = new Date().toISOString();
        sendJson(res, 200, { ok: true, device });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    if (handleStatic(req, res, parsedUrl)) {
      return;
    }

    res.statusCode = 404;
    res.end('Not found');
  } catch (error) {
    console.error('Server error:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
});

server.listen(PORT, () => {
  console.log(`server-charlie listening on port ${PORT}`);
});
