# Controller Management Architecture

The dashboard exposes a single **Manage Controllers** workflow, but each vendor-specific experience (SwitchBot, Kasa, Code3, etc.) is powered by a controller manager that lives on the backend. Those managers are responsible for translating generic automation intents into the protocol the hardware expects.

## Why protocols stay in controller managers

1. **Separation of concerns** – The UI components (IoT Devices card, setup wizards, automations) can describe capabilities in a vendor-agnostic way. They never embed raw byte strings or MQTT topics.
2. **Hardware reuse** – Multiple surfaces (web dashboard, scheduled tasks, recovery scripts) can share the same protocol implementation instead of duplicating it in JavaScript and Python.
3. **Security** – Sensitive credentials or command frames remain server-side and can be protected with RBAC and audit logging.

## Repository layout

Controller managers live under `server/controllers/`:

```
server/controllers/
  README.md                # shared guidance
  code3/                   # Code3 dynamic light manager
    protocol.json          # controller proxy + hex payload manifest
    README.md              # usage guidance
  ...additional vendors...
```

Each manager should provide a metadata endpoint (for example `/controllers/code3/metadata`) so the dashboard can render buttons and tooltips without hardcoding the protocol.

## Code3 example

The Code3 manager now captures the end-to-end communication contract between the Charlie server (`server-charlie.js`) and the Code3 controller that ultimately drives the dynamic fixtures. This allows front-end experiences—such as the IoT Devices card or the Grow Room Setup modal—to simply read metadata from the manager instead of hardcoding addresses or payloads.

### GreenReach Light Engine — Controller Communication Summary

1. **Server ↔ Controller connection**
   - Server: `server-charlie.js` listening on **:8091**.
   - Controller: Code3 appliance at **http://192.168.2.80:3000**.
   - Exposed endpoints:
     - `GET /healthz` – confirms the proxy link and controller URL.
     - `GET /api/devicedatas` – returns light metadata (id, name, status, online).
     - `PATCH /api/devicedatas/device/:id` – toggles power and sets the HEX payload.
     - `POST /plans` and `POST /sched` – publishes lighting recipes and schedules.
2. **Device IDs** – the controller is the source of truth for the mapping:

   | Controller ID | Fixture ID |
   | ------------- | ---------- |
   | 2             | F00001     |
   | 3             | F00002     |
   | 4             | F00003     |
   | 5             | F00005     |
   | 6             | F00004     |

3. **HEX payload format** – `[CW][WW][BL][RD][00][00]` where each channel uses `00–64` hex (0–100%). Examples:
   - Safe ON (~45% across channels): `{"status":"on","value":"737373730000"}`
   - All OFF: `{"status":"off","value":null}`
   - Red 100%: `{"status":"on","value":"000000640000"}`
   - Blue 50%: `{"status":"on","value":"000032000000"}`
4. **Dynamic lighting script (Excel bridge)**
   - Workbook: `/home/greenreach/LightRecipes.xlsx`.
   - Sheets: **Lights**, **Recipes**, **Schedules**.
   - Logic: converts CW/WW/BL/RD percentages into HEX12 via `round(pct * 0.64)` and publishes to `/plans` and `/sched`.
   - Default “safe on” payload: `737373730000`.
5. **Verification checklist**
   1. `curl -s http://127.0.0.1:8091/healthz` → expect `200 OK`.
   2. `curl -s http://127.0.0.1:8091/api/devicedatas` → Code3 fixture IDs visible.
   3. `curl -X PATCH -H 'Content-Type: application/json' -d '{"status":"on","value":"737373730000"}' http://127.0.0.1:8091/api/devicedatas/device/2`
      → light responds.
   4. Dashboard UI shows the live spectrum matching the controller state.
   5. `POST /plans` and `POST /sched` both return `200`.

With this layout the answer to the original question remains **yes**: the Code3 hex protocol belongs to the Code3 controller manager. The IoT Devices card should surface the manager UI, but the manager is the source of truth for the protocol, including proxy endpoints, payload formats, and validation steps.
