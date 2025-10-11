# Light Fixture Workflow

## 5. Controller assignment workflow

* Operators assign controllers to the lights defined during room configuration. Editing an entry opens a modal that restates device metadata, warns when equipment is already operational, and lets the user capture notes alongside the controller choice.【F:public/app.charlie.js†L7331-L7384】

## 5.5 Controller Light Confirmation (Reconciliation Gate)

**When this runs:** First time the operator opens **Group Configuration** for a room/zone (and any time controller or light setup changes).

**Why:** Many vendors expose a single banked control channel, but Code3 exposes each fixture as its own device. Groups and schedules must reflect what the controller actually enumerates (controller = source of truth)【F:docs/CONTROLLER_MANAGEMENT.md†L32-L48】【F:public/app.charlie.js†L7221-L7318】.

**Flow:**
1. Fetch `/api/devicedatas` via the proxy and enumerate controller IDs (e.g., F00001…F00005).
2. Compare to the wizard’s declared “lights per controller” and manufacturer profiles (addr_mode: bank vs per-fixture).
3. If mismatch, show a confirmation dialog with three choices:
   - **Use controller list (recommended):** adopt N separate fixtures (per-fixture).
   - **Keep banked model:** 1 logical device with `fanout=N`.
   - **Create shadow devices:** 1 banked physical device with N virtual children for analytics; commands fan out to the parent.
4. Persist the normalized devices to `public/data/farm.devices.json`. This list becomes the single source for Groups/Schedules rendering.

**Artifacts written:**
```json
// public/data/farm.devices.json (examples)
[{ "id":"F00001","manufacturer":"code3","addr_mode":"per-fixture","controller":"ctl-1","room":"R1","zone":"Z1" },
 { "id":"F00002","manufacturer":"code3","addr_mode":"per-fixture","controller":"ctl-1","room":"R1","zone":"Z1" }]
// OR a banked representation
[{ "id":"BANK-ACME-A","manufacturer":"acme","addr_mode":"bank","fanout":5,"controller":"ctl-9","room":"R1","zone":"Z2" }]
```

**Verification:** `/healthz` 200, `/api/devicedatas` returns IDs; PATCH to a per-fixture device affects only that device; banked device mirrors to fanout.【F:docs/CONTROLLER_MANAGEMENT.md†L50-L66】

## 6. Groups card integration

* When the Groups card renders, it first runs the **Controller Light Confirmation** gate (Section 5.5). The light selection bar is then seeded from the **normalized** `public/data/farm.devices.json` for the active room/zone (per-fixture or banked as confirmed), not directly from the raw wizard state.【F:public/app.charlie.js†L6634-L6667】
* Plan changes automatically synchronize the spectrum preview and slider controls, keeping the group recipe in step with the fixtures that were staged through the light wizard.【F:public/app.charlie.js†L6610-L6629】

## 7. Farm Setup → Groups workflow

* **Farm Setup** is the starting point for spatial structure. Operators define `rooms[]`, `zones[]`, `levels[]`, and `sides[]`, then persist the composite configuration under `/farm` for downstream features.
* **SwitchBot Manager** bridges the spatial data to real hardware:
  * Assign every SwitchBot sensor to its room/zone. Exactly one sensor per zone must be marked **Primary**; others receive weight sliders so zone medians can be tuned.
  * Assign each managed plug to the appropriate room/zone and capture its `controlledType` so automation can filter by equipment role.
* **Groups** inherit the curated device placements:
  * Create a **LightGroup** for each zone and add only lighting fixtures; this group owns photoperiod blocks, sunrise/sunset ramps, spectrum choices, and DLI math via `/plans` + `/sched`.
  * Create an **EquipGroup** for the same zone and add only plugs or environmental equipment; this group steers `/env` targets, hysteresis ranges, and dwell timers so automation rules have clear guardrails.
  * Present both groups together inside a **Zone summary card** for the room/zone so operators see the paired lighting and environmental context before drilling into edits.
* **Plans & Schedules (Lights)** flow through the Recipe Bridge: publish lighting recipes to `/plans` and time-based schedules to `/sched` via the Excel integration.
* **Environment Targets (Equipment)** are authored per zone through `/env`, setting `temp`, `rh`, `rhBand`, `control.step`, and `control.dwell` to guide plug automation.
* **Verification** relies on the playbook curls: `/healthz` returns `OK`, device inventories load, group JSON documents exist, PATCH calls against lights succeed, and `/sched` plus `/env` echo the saved configurations.

## 8. Naming and conventions

* **Zones:** `ROOM-Zn` (example: `LeafyGreens-Z2`).
* **LightGroup IDs:** `ROOM · Zn · Lights` (UI label) and `LG-Z2-Lights` (identifier).
* **EquipGroup IDs:** `ROOM · Zn · Equip` (UI label) and `LG-Z2-Equip` (identifier).
* **Plugs:** `ROOM-Zn-<type>-##` (example: `LG-Z2-dehu-01`).

Consistently applying the patterns above keeps the Farm, Group, and Environment schemas aligned so operators can navigate quickly without deciphering aliases.
