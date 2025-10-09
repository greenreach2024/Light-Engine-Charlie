# Light Control Review

## Control Requirements for Lighting Hardware
- **Controller managers remain the protocol source of truth.** Each vendor-specific manager under `server/controllers/` exposes REST endpoints such as `/healthz`, `/api/devicedatas`, and `/controller/plans` so the dashboard never embeds raw controller payloads.【F:docs/CONTROLLER_MANAGEMENT.md†L3-L48】
- **HEX payload expectations are standardized.** The Code3 controller accepts `[CW][WW][BL][RD][00][00]` frames, scaled by `config/channel-scale.json`, which must be populated via `scripts/preflight-scale-probe.sh` before operators push live recipes.【F:docs/CONTROLLER_MANAGEMENT.md†L49-L87】
- **Operational verification is scripted.** Routine checks confirm controller reachability (`/healthz`), device enumeration (`/api/devicedatas`), and fixture responsiveness through targeted `PATCH` requests before exposing controls to users.【F:docs/CONTROLLER_MANAGEMENT.md†L88-L101】

## Reviewing Control Assignments
- **Assignments begin in the Light Fixture workflow.** Operators align discovered fixtures with controllers, capture metadata, and persist the normalized list into `public/data/farm.devices.json`, ensuring that downstream features read from an authoritative roster.【F:docs/LIGHT_FIXTURE_WORKFLOW.md†L1-L34】
- **Reconciliation protects accuracy.** The Controller Light Confirmation gate compares wizard expectations with live controller responses and forces operators to choose per-fixture, banked, or shadow device models before saving assignments.【F:docs/LIGHT_FIXTURE_WORKFLOW.md†L9-L31】
- **Artifacts document assignment outcomes.** Persisted entries record the controller, manufacturer, addressing mode, and fanout counts so analytics, schedules, and automations share the same topology.【F:docs/LIGHT_FIXTURE_WORKFLOW.md†L32-L46】

## Impact on Groups Card Behavior
- **Groups only render normalized fixtures.** When the Groups card loads, it reruns the Controller Light Confirmation gate and hydrates its light selector from the vetted `farm.devices.json` list rather than raw wizard data, preserving fidelity with the assigned controllers.【F:docs/LIGHT_FIXTURE_WORKFLOW.md†L48-L53】
- **Plan edits stay synchronized.** Any recipe adjustments trigger spectrum previews and slider updates that respect the controller-backed device roster, preventing drift between group UI state and the fixtures staged during assignment.【F:docs/LIGHT_FIXTURE_WORKFLOW.md†L53-L54】
