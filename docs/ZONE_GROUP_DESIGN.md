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
  - Responsibilities: maintain lighting plans and schedules.
  - Integrations: consumes `/plans` for recipes and owns `/sched` CRUD.
- **EquipGroup**
  - Membership: environmental control equipment (dehumidifiers, fans, etc.).
  - Responsibilities: manage temperature, relative humidity, and VPD targets along with control parameters such as `control.step` and `control.dwell`.
  - Integrations: owns `/env` targets and equipment control actions.

### Zone Card
- Represents a specific room/zone.
- References exactly one LightGroup and one EquipGroup.
- Editing a zone opens the relevant group view (lighting or environment) while keeping Farm Setup as the source of truth for spatial context.

## Benefits
- **Clear contracts:** `/sched` and `/env` concerns remain isolated, reducing the chance of conflicting writes.
- **Operational safety:** UI naturally separates lighting versus equipment updates, lowering the risk of accidental cross-updates.
- **Telemetry and auditing:** Typed groups make it easier to track changes and gather metrics for each domain.
- **Scalability:** Mirrors handbook guidance, enabling future automation and analytics enhancements without schema churn.

## Implementation Notes
- Zone saves will trigger independent persistence for LightGroup and EquipGroup, ensuring deliberate updates.
- Telemetry should capture group references to aid debugging.
- UI navigation should emphasize the linkage between the zone and its associated groups while enforcing device type membership rules.

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

