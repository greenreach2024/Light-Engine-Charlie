Project: Light Engine Charlie · Path: /Users/petergilbert/Desktop/GreenReach/Light Engine Charlie/public · Server: server-charlie.js on :8091 · UI: index.html + app.charlie.js + styles.charlie.css · Controller: http://192.168.2.80:3000. One HTML, one CSS, one JS, one server. No sidecars/shims.

Two-options rule (always write Option A: quick fix, Option B: robust fix; choose lowest risk, most scalable) and log the choice.

Never live-edit compiled bundles; edit source and rebuild. If an emergency patch is unavoidable: restore .bak, make one minimal patch, and run node --check + bracket-balance check before reload.

DOM boot shape must end cleanly: document.addEventListener('DOMContentLoaded', async () => { /*...*/ }); — no stray })();.

Proxy/CORS must always pass preflight (OPTIONS, echo requested headers, dynamic Access-Control-Allow-Origin). UI reads window.API_BASE only—never hardcode ports.

Controller is the single source of truth for device IDs; never guess. Build UI from controller IDs then join live /api/devicedatas.

Device control contract (HEX12): {"status":"on","value":"CW WW BL RD 00 00"} with each channel 00–64 hex (≈0–100%). Safe ON default: 737373730000; OFF: {"status":"off","value":null}. Auto-scale on 400 “power-cap” once.

Verification after every patch (in this order):
No console errors → /healthz 200 → /api/devicedatas returns IDs → PATCH ON/OFF works → live spectrum/DLI/kWh appear if enabled. Rollback to last .bak or git state on failure.

Editing hygiene for Codex/macOS: back up before edits, use nano +<line> (lines from grep -n), sed -i '' for in-place one-liners, and never put inline # comments inside multi-line shell blocks.

Mode management:
FILE-ONLY (shim): USE_SHIM=true; API_BASE="" for UI-only tests.
LIVE: USE_SHIM=false; API_BASE=<proxy/controller>.
Always log window.USE_SHIM, window.API_BASE.

Follow the Charlie Playbook phases (Farm → Devices → Groups → Schedules → Tooltips → Calibration → Environmental → Plans/DLI/Energy → Tests → Consolidation). Use the provided endpoints & JSON schemas.

Groups + Schedules: save to /groups and /sched; prefer group-level schedule IDs; show badges; confirm before overwrite. Support 1-day and validated 2-cycle (sum to 24h, cycle B auto-computes).

Calibration multipliers (cw/ww/bl/rd) persist to /calibration; apply to ON payload before PATCH.

Environmental HUD: show Temp/RH/VPD + targets; ingest sensors via /env; clearly mark “derived/estimated” metrics; Advisory-first for any AI suggestions.

DLI & Energy as first-class data: compute and display units (mol m⁻² day⁻¹, kWh), today/7/30-day views, and per-farm kWh cost using stored rate (not plaintext).

Spectrum math & visuals: SPD per channel, weighted sum by channel %, coarse bins (20–40 nm), cached server-side; bar/area chart updated ~1 min.

Research Mode & feature flags: hide advanced controls by default; gate unfinished panels; keep flags per user/device; don’t comment-out code—runtime-guard it.

Excel → Plans bridge (reTerminal): treat Excel (Recipes/Lights/Schedules) as source of truth; on file change: publish /plans, optionally sync names & schedules; placeholders for sensor-based dimming.

Dynamic lighting guardrails: only dim adaptively when env exceeds thresholds; blue affects stomata/transpiration most; prefer gentle ramps; log ENV ADJUST with factors.

Ops memory: after each session append to the playbook—problem, Option A/B, commands, outcome, next actions—so we stop repeating brittle fixes.

UI/UX baseline: device names derive from Farm lists (no free-text), tooltips on Farm/Groups/Schedules, header “Discover devices” and Centralized Automation icon may be mock but wired.

Quick-recovery when “things feel weird”: restore bundle from .bak, node --check, start CORS-safe proxy, verify /healthz + /api/devicedatas in browser console, rebuild cards from controller IDs, then re-enable optional panels.

GreenReach uniqueness context (for copy): modular public-facing R&D farm, dynamic 4-channel spectrum via E.V.I.E., smart trays, per-tray ESG scoring; keep this narrative consistent across badges and tooltips.

Dashboard equipment assumptions (for wiring & docs): prefer open protocols (Modbus/MQTT/HTTP, 0–10 V), CT meters for branches + smart-plug granularity, SwitchBot for quick RH/T baselines, SenseCAP for CO₂.


Choice log: Option A: quick fix, Option B: robust fix.
Chosen: Option A (quick fix) — low risk, logged here; produce anchor and proceed with minimal repository-safe edits. If changes grow, escalate to Option B.
