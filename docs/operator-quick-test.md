# Operator Quick Test

This checklist combines the "preflight five" and the lighting scale probe into a repeatable workflow that operators can run before enabling **Groups** control in a new environment.

## Scripted preflight

Run the helper script from the repository root:

```bash
./scripts/preflight-scale-probe.sh
```

Environment variables:

- `API_BASE` – Overrides the default target of `http://127.0.0.1:8091`.
- `DEVICE_ID` – Device used for the scale probe (default `2`). Choose a single, easy-to-observe fixture for the verification pulse.

The script performs four checks:

1. `GET /healthz` — confirms the server is responding.
2. `GET /api/devicedatas` — verifies that at least one device is visible from the controller. The raw payload is parsed server-side to catch schema drift.
3. `OPTIONS /api/devicedatas` — sends a realistic CORS preflight (Origin + Access-Control-Request headers) and fails if the proxy does not echo `Access-Control-Allow-Origin` **and** `Access-Control-Allow-Headers`.
4. Scale probe — tests both `00-FF` and `00-64` channel scales by issuing the documented payload to `/api/devicedatas/device/{id}`. The first `2xx` response wins, the result is printed, and the device is reset to OFF (`{"status":"off","value":null}`) for safety. The successful scale is written to `config/channel-scale.json`, keeping the dashboard, SpectraSync helpers, and the Recipe Bridge on the same byte range.

If any step fails, the script exits non-zero. Resolve the issue before editing Groups or schedules.

## Manual confirmations

After the script succeeds:

- Open the dashboard in a browser and run `console.log(window.API_BASE, window.USE_SHIM);` to ensure the UI is reading the runtime configuration instead of a hard-coded port.
- Confirm there are no console errors or red network requests before proceeding to Groups.
- If you have a reference mix (e.g., safe ON), re-run the probe scale in the UI using the discovered range to double-check brightness expectations.

## Record the outcome

Document the chosen scale and the device used for the probe in your site log. This avoids future drift between the UI, Recipe Bridge, and any downstream automation. The script output can be attached directly to the onboarding ticket for traceability, and `config/channel-scale.json` provides the machine-readable record consumed by the backend.
