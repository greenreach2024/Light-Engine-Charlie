# Operator Quick Test

This checklist combines the "preflight five" and the lighting scale probe into a repeatable workflow that operators can run before enabling **Groups** control in a new environment.

## Scripted preflight

Run the helper script from the repository root (requires `curl` and `node` in `$PATH`):

```bash
./scripts/preflight-scale-probe.sh
```

Environment variables:

- `API_BASE` – Overrides the default target of `http://127.0.0.1:8091`.
- `DEVICE_ID` – Device used for the scale probe (default `2`). Choose a single, easy-to-observe fixture for the verification pulse.
- `CONTROLLER_COLLECTION_PATH` – Force a particular controller listing endpoint when medge deployments expose a custom namespace.
- `CONTROLLER_DEVICE_PATH` – Supplies a relative or absolute path for the device PATCH endpoint when it cannot be inferred from the collection.
- `CONTROLLER_DEVICE_URL` – Absolute URL (may include `:id`) for the device PATCH endpoint.
- `CONTROLLER_HEADERS` – Additional headers (one per line) appended to every controller request for auth tokens or medge feature flags.
- `CURL_INSECURE=1` – Skip TLS verification when the proxy terminates with a self-signed certificate.

Flags and options:

- `--controller-path /controller/devicedatas` – Equivalent to setting `CONTROLLER_COLLECTION_PATH`. The script also tests `/api/devicedatas` and `/forwarder/devicedatas` for compatibility with older stacks.
- `--device-path /controller/devicedatas/device/:id` – Shortcut for `CONTROLLER_DEVICE_PATH`; useful when the medge proxy exposes a rewritten hierarchy.
- `--device-url https://edge.local/controller/devicedatas/device/:id` – Absolute endpoint override for patched tunnels.
- `-H "Authorization: Bearer …"` – Append custom headers to every request (repeatable). Matches `CONTROLLER_HEADERS`.
- `--insecure` – Equivalent to `CURL_INSECURE=1`; ignores TLS errors on self-signed certs.
- `--skip-probe` – Only runs the "preflight five" HTTP validations (useful when devices are in production and you only need a health snapshot).

The script performs four checks:

1. `GET /healthz` — confirms the server is responding.
2. `GET /controller/devicedatas` (or the legacy `/api/devicedatas`) — verifies that at least one device is visible from the controller. The raw payload is parsed to catch schema drift and ensure the probe device is present.
3. `OPTIONS` against the detected device collection endpoint — sends a realistic CORS preflight (Origin + Access-Control-Request headers) and fails if the proxy does not echo `Access-Control-Allow-Origin` **and** `Access-Control-Allow-Headers`.
4. Scale probe — tests both `00-FF` and `00-64` channel scales by issuing the documented payload to `/.../device/{id}`. The script records the initial state, restores it after the probe, and reports the accepted scale.

If any step fails, the script exits non-zero. Resolve the issue before editing Groups or schedules.

## Manual confirmations

After the script succeeds:

- Open the dashboard in a browser and run `console.log(window.API_BASE, window.USE_SHIM);` to ensure the UI is reading the runtime configuration instead of a hard-coded port.
- Confirm there are no console errors or red network requests before proceeding to Groups.
- If you have a reference mix (e.g., safe ON), re-run the probe scale in the UI using the discovered range to double-check brightness expectations.

## Record the outcome

Document the chosen scale and the device used for the probe in your site log. This avoids future drift between the UI, Recipe Bridge, and any downstream automation. The script output can be attached directly to the onboarding ticket for traceability.
