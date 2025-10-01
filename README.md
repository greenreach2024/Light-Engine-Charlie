# Light-Engine-Charlie

Light Engine Charlie exposes a lightweight controller proxy and a multi-control wizard for the **GROW3 TopLight™ — MH Model, 300 W** fixture. The UI runs from `/public`, while `server-charlie.js` serves the static assets and implements the controller contract.

## Getting started

```bash
node server-charlie.js
```

The server listens on port `8091` by default. Override by exporting `PORT`.

## API contract

All API responses honour the locked PATCH contract:

- `GET /healthz` — controller heartbeat.
- `GET /api/devicedatas` — controller sourced device metadata and MH profile information.
- `PATCH /api/devicedatas/device/:id` — accepts `{"status":"on","value":"<HEX12>"}` or `{ "status": "off", "value": null }`.

The HEX payload layout is `[CW][WW][Blue][Red][00][00]` and expects 00–FF scaling (`round(percent*255/100)`).

CORS is origin-aware. `OPTIONS` preflight returns the same `Access-Control-Request-Headers` and allows `GET, POST, PATCH, DELETE, OPTIONS`.

## UI wizard

Open `http://localhost:8091/` to:

1. Verify connectivity and run deep search discovery (RS‑485, mDNS/IP, BLE, MQTT lanes).
2. Add the TopLight MH 300 W to the farm inventory.
3. Create multiple control profiles (0‑10 V, Wi‑Fi, BLE, smart plug).
4. Assign controller sourced devices to rooms/zones/groups.
5. Compute MH-specific channel allocations, build HEX12 payloads, and PATCH them live per device.

Group cards surface the MH datasheet values, Red:Blue defaults, DLI and kWh estimates, and expose the locked `Apply to Group` action.
