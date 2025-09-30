# Light-Engine-Charlie

Light Engine Charlie provides automated discovery and control for a mixed fleet of horticulture lighting devices. The backend is implemented with FastAPI and integrates TP-Link Kasa, MQTT and SwitchBot discovery alongside a rules-driven automation engine. A lightweight frontend component renders a device manager UI that scales to multiple devices and protocols.

## Backend

* **Directory:** `backend/`
* **Entry point:** `python -m backend`
* **Environment variables:**
  * `ENVIRONMENT` – `production` by default; drives configuration defaults.
  * `MQTT_HOST`, `MQTT_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_TOPICS` – configure MQTT discovery.
  * `SWITCHBOT_TOKEN`, `SWITCHBOT_SECRET`, `SWITCHBOT_REGION` – enable SwitchBot Cloud discovery.
  * `KASA_DISCOVERY_TIMEOUT` – discovery timeout in seconds (default `10`).
  * `DISCOVERY_INTERVAL` – seconds between automatic discovery sweeps (default `300`).
  * `TARGET_LUX`, `OCCUPIED_BRIGHTNESS`, `VACANT_BRIGHTNESS` – automation tuning parameters.
* **Lighting inventory:** defined in `data/lighting_inventory.yaml` with real fixture metadata.

Run the server locally:

```bash
pip install -r requirements.txt  # ensure fastapi, uvicorn, paho-mqtt, python-kasa, requests, pyyaml are available
python -m backend
```

## Frontend

* **Directory:** `frontend/`
* **Device state:** provided via `DeviceProvider` (`frontend/src/store/devices.ts`).
* **Device manager component:** `frontend/src/components/DeviceManager.tsx` renders multi-device lists with protocol filters and search.

Integrate the store by wrapping your application with `<DeviceProvider>` and include `<DeviceManager />` within the dashboard layout.
