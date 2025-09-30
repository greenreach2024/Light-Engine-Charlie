# Light Engine Charlie

Light Engine Charlie is a comprehensive platform for indoor farming automation, featuring both Node.js and Python backends for different deployment scenarios.

## Quick Start

### Node.js Implementation (Dashboard & API)
1. Install dependencies and start the server.
2. Open the dashboard in a browser at http://127.0.0.1:8091.

### Python Implementation (Device Discovery & Automation)
1. Install Python dependencies: `pip install -r requirements.txt`
2. Start the backend: `python -m backend`

## Architecture Overview

**Node.js Backend (`server-charlie.js`)**
- Primary dashboard server with web UI
- SwitchBot API integration with proper authentication
- Environmental monitoring and data visualization
- Device setup wizard and configuration management
- Live farm device discovery and control

**Python Backend (`backend/`)**
- Automated device discovery for TP-Link Kasa, MQTT, and SwitchBot
- Rules-driven automation engine
- Multi-protocol device management
- FastAPI-based REST endpoints

**Frontend Components**
- React/TypeScript device manager (`frontend/src/components/DeviceManager.tsx`)
- Device state management (`frontend/src/store/devices.ts`)
- Interactive dashboard with real-time monitoring

## Node.js Dashboard Features

### Standard Operating Procedure (SOP)

- Launch: Start the local server and confirm /healthz returns ok.
- Environment: Ensure /env returns zones with sensors; click a metric to view the 24h trend.
- Devices: Use device cards to view PPFD/DLI/energy. Research Mode reveals more controls.
- Groups: Select a group to view roster, schedule preview, and apply spectrum safely.
- Guardrails: Offline devices are skipped with a toast. Payloads cap to 100% per channel.
- Persistence: UI saves to public/data via POST /data/:name.

### Live Farm Configuration
- **WiFi Network**: `greenreach` (password: `Farms2024`)
- **Device Discovery**: Scans for HLG, Spider Farmer, MARS HYDRO LED lights
- **Environmental Controls**: TrolMaster, AC Infinity, SwitchBot sensors
- **Power Monitoring**: Shelly Pro 4PM devices

### Smoke Test

Run the smoke test to verify key endpoints and assets.

```bash
npm run smoke
```

The script checks:
- GET /healthz
- GET /config
- GET /env
- GET /index.html
- POST /data/device-meta.json (dry-run to temp file)

## Python Backend Configuration

### Environment Variables
* `ENVIRONMENT` – `production` by default; drives configuration defaults.
* `MQTT_HOST`, `MQTT_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_TOPICS` – configure MQTT discovery.
* `SWITCHBOT_TOKEN`, `SWITCHBOT_SECRET`, `SWITCHBOT_REGION` – enable SwitchBot Cloud discovery.
* `KASA_DISCOVERY_TIMEOUT` – discovery timeout in seconds (default `10`).
* `DISCOVERY_INTERVAL` – seconds between automatic discovery sweeps (default `300`).
* `TARGET_LUX`, `OCCUPIED_BRIGHTNESS`, `VACANT_BRIGHTNESS` – automation tuning parameters.

### Lighting Inventory
Defined in `data/lighting_inventory.yaml` with real fixture metadata for:
- HLG 550 V2 R-Spec LED grow lights
- Spider Farmer SF-7000
- MARS HYDRO FC-E6500
- Environmental sensors and controllers

Run the Python backend locally:

```bash
pip install -r requirements.txt  # ensure fastapi, uvicorn, paho-mqtt, python-kasa, requests, pyyaml are available
python -m backend
```

## SwitchBot Integration

### Direct API Access (Node.js)
- Proper HMAC-SHA256 signature generation
- v1.1 API endpoints with rate limiting
- Real device data (no mock fallbacks)
- Live status monitoring and control

### Environment Variables (do NOT commit these)
```bash
export SWITCHBOT_TOKEN=...   # from SwitchBot app
export SWITCHBOT_SECRET=...  # from SwitchBot app
export ZONE=LettuceRoom      # optional, default "SwitchBot"
export HOST=127.0.0.1        # optional, default 127.0.0.1
export PORT=8091             # optional, default 8091
```

### Direct SwitchBot Ingestion
```bash
npm run switchbot:once
# or loop every 10s
npm run switchbot:watch
```

Filter devices (optional):
```bash
INCLUDE_REGEX="CO2|TempHumid" npm run switchbot:once
EXCLUDE_REGEX="Button|Curtain" npm run switchbot:once
```

## Notes

- Research Mode is persisted in localStorage under `gr.researchMode`.
- Runtime config is available at /config and displayed as a chip in the header.
- Environment tiles show 12h sparklines, colored by setpoint status; click to open a larger 24h view.
- All mock/demo device fallbacks have been disabled to enforce live data only.
- Farm network discovery includes real lighting equipment and environmental controls.

## VPN + Forwarder workflow

When working over VPN with a Raspberry Pi forwarder:

- Mac dashboard server → http://127.0.0.1:8089 (your browser connects here)
- Mac dashboard CTRL → http://100.65.187.59:8089 (the Pi forwarder URL; replace with your Pi’s address)
- Pi forwarder target → http://192.168.2.80:3000 (the actual light controller)

On the Pi (forwarder):

```bash
# Foreground run so you can see [→] lines
PORT=8089 CTRL="http://192.168.2.80:3000" node forwarder.js
```

On your Mac (dashboard):

```bash
# Start Charlie bound to 8089 and pointing to the Pi forwarder
npm run start:vpn
```

Quick endpoint checks:

```bash
npm run smoke:8089   # test against 8089
npm run smoke:8091   # test against 8091
```

## Azure Functions as Environment Source

You can point the dashboard's /env endpoint to an Azure Functions HTTP that returns latest readings
as described in the SwitchBot → Azure → App plan. Enable it by setting these environment variables:

```bash
# Example: local dev against your Function (replace with your URL)
AZURE_LATEST_URL="https://<FUNC_NAME>.azurewebsites.net/api/env/latest" \
ENV_SOURCE=azure \
PORT=8091 node server-charlie.js
```

Behavior:
- When `ENV_SOURCE=azure` (or `AZURE_LATEST_URL` is set), GET /env fetches from `AZURE_LATEST_URL`.
- The server transforms results to the local `{ zones: [...] }` shape and maintains short in-memory histories per metric for sparklines.
- `/config` and `/healthz` expose `envSource` and `azureLatestUrl` for visibility.

Troubleshooting:
- If Azure is unreachable, /env returns HTTP 502 and, if available, serves the last cached values.
- Switch back to local file mode by unsetting ENV_SOURCE/AZURE_LATEST_URL.

## Direct SwitchBot ingestion (no Azure)

You can pull readings from SwitchBot OpenAPI and push directly into Charlie's `/ingest/env`.

Environment variables (do NOT commit these):

```bash
export SWITCHBOT_TOKEN=...   # from SwitchBot app
export SWITCHBOT_SECRET=...  # from SwitchBot app
export ZONE=LettuceRoom      # optional, default "SwitchBot"
export HOST=127.0.0.1        # optional, default 127.0.0.1
export PORT=8091             # optional, default 8091
```

Run once or watch:

```bash
npm run switchbot:once
# or loop every 10s
npm run switchbot:watch
```

Filter devices (optional):

```bash
INCLUDE_REGEX="CO2|TempHumid" npm run switchbot:once
EXCLUDE_REGEX="Button|Curtain" npm run switchbot:once
```

The script maps common SwitchBot device status fields into `{ zoneId, name, temperature, humidity, co2, battery, rssi, source }`
and posts them to `/ingest/env`, which updates `public/data/env.json` and UI tiles/sparklines.

## Frontend Integration

### React/TypeScript Components
Integrate the device store by wrapping your application with `<DeviceProvider>` and include `<DeviceManager />` within the dashboard layout:

```typescript
import { DeviceProvider } from './store/devices';
import { DeviceManager } from './components/DeviceManager';

function App() {
  return (
    <DeviceProvider>
      <DeviceManager />
    </DeviceProvider>
  );
}
```
