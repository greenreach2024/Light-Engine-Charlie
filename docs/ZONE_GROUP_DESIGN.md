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

