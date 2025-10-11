# Zone Group Design Decision

## North Star
- Maintain a single source of truth for rooms/zones via Farm Setup.
- Provide progressively narrower context for device and group cards.
- Prevent lighting schedules from conflicting with environmental automation.
- Allow SwitchBot sensors to drive zone targets through the `/env` contract while lights follow `/plans` and `/sched`.

## Selected Approach: Option B — Typed Groups with Zone Wrapper
We will adopt a robust, scalable separation of concerns by introducing two distinct group types that are referenced by a high-level Zone card.

### Group Types
- **LightGroup**
  - Membership: light fixtures only.
  - Responsibilities: orchestrate the full lighting program for a zone — photoperiod blocks, sunrise/sunset ramps, spectrum curves, and DLI targets.
  - Integrations: consumes `/plans` for recipe spectra and publishes schedules through `/sched`, keeping lighting orchestration isolated from plug automation.
- **EquipGroup**
  - Membership: environmental control equipment (dehumidifiers, fans, etc.).
  - Responsibilities: manage temperature, relative humidity, and VPD targets along with control parameters such as hysteresis bands (`rhBand`/`tempBand`), `control.step`, and `control.dwell` so the rules engine can pace plug actions.
  - Integrations: owns `/env` targets and equipment control actions, including persistence of dwell timers and hysteresis tuning.

### Zone Card
- Represents a specific room/zone.
- References exactly one LightGroup and one EquipGroup.
- Wraps the typed groups in a single summary card so operators always see the lighting and environmental pair for the active room/zone before drilling into edits.
- Editing a zone opens the relevant group view (lighting or environment) while keeping Farm Setup as the source of truth for spatial context.

## Benefits
- **Clear contracts:** `/sched` and `/env` concerns remain isolated, reducing the chance of conflicting writes such as a light schedule trying to fight a plug cutoff rule.
- **Operational safety:** UI naturally separates lighting versus equipment updates, lowering the risk of accidental cross-updates.
- **Telemetry and auditing:** Typed groups make it easier to track changes and gather metrics for each domain.
- **Scalability:** Mirrors handbook guidance, enabling future automation and analytics enhancements without schema churn.

## Implementation Notes
- Zone saves will trigger independent persistence for LightGroup and EquipGroup, ensuring deliberate updates.
- Telemetry should capture group references to aid debugging.
- UI navigation should emphasize the linkage between the zone and its associated groups while enforcing device type membership rules.

## Two-Paths Framing
- **Option A – Direct/Fast**
  - Maintain a single "Zone Group" that mixes lights and equipment behind tabbed navigation.
  - Intended for one operator managing a small number of devices when the priority is a quick demo or rapid iteration.
- **Option B – Robust/Systemic**
  - Keep typed LightGroup and EquipGroup resources with a Zone wrapper to preserve API contracts and audit trails.
  - Recommended baseline because it respects Charlie's guardrails, scales to many rooms, and keeps domain boundaries explicit.

Default to Option B unless time-boxed validation requires the lighter-weight approach. When Option A is selected, document the rationale and capture follow-up tasks to migrate to Option B before expanding beyond the initial scope.

## Quick Bring-Up Checklist
Follow this sequence when activating a new zone on the farm:

1. **Farm setup:** Save updated Rooms and Zones in Farm Setup so downstream pickers stay in sync.
2. **Sensors:** In SwitchBot Manager assign each sensor to the correct Room and Zone, then mark the primary sensor for the zone.
3. **Plugs:** Assign Room/Zone metadata plus the correct `controlledType`. For any light controlled via an API, force its plug to `ON` and remove it from EquipGroup membership to avoid contention.
4. **Groups:** Create `…-Lights` and `…-Equip` groups per zone and add the appropriate members.
5. **Lights:** Push lighting recipes and schedules through the Recipe Bridge tooling (Excel) so `/plans` and `/sched` stay aligned.
6. **Environment:** Configure relative humidity (`rh`), allowable band (`rhBand` at 5%), and dwell time (10 minutes) for the zone, then persist the payload to `/env`.

## UI Behavior
- **SwitchBot Manager cards**
  - The header row surfaces the device name alongside battery state, RSSI, and a relative "last seen" timestamp so operators can audit health at a glance.
  - Placement controls expose Room, Zone, Level, and Side selectors that are pre-populated from Farm Setup; selections write back to device metadata.
  - Sensors surface a primary toggle plus a weight slider with a live preview of the zone median contribution to make balancing easy.
  - Plugs offer controlled-type and energy-source pickers and retain managed-equipment notes while inheriting the same placement guardrails.
  - Group attachments render LightGroup and EquipGroup dropdowns filtered by the card's room/zone context so devices can only join compatible groups.
- **Group setup surface (Option B)**
  - The UI renders separate LightGroup and EquipGroup cards under a shared zone summary so operators always understand the current binding.
  - Each card filters its membership list by device kind and persists changes independently, keeping `/sched` and `/env` updates isolated.

