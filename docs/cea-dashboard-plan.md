# Step-by-Step Implementation Plan for a CEA Dashboard

## Introduction

Modern greenhouses and indoor farms need a flexible dashboard that caters to both everyday growers and researchers. The existing Java-based dashboard already visualises lighting, environmental readings, energy and schedules. To scale for larger facilities, the platform should support **two modes**: a simplified farmer view for daily operations and an advanced research view for deep control and analytics. The following sections break down the high-level design into **concrete implementation steps**. Each section includes **chat starters** to spark conversations with stakeholders and ensure requirements are clear. Citations are provided for key formulas and best practices.

## 1. Add a Research Mode Toggle

**Goal:** Keep day-to-day use simple while allowing power users to reveal full lighting controls and debugging tools.

### Implementation Steps

1. **Define a feature flag.** Use a runtime feature toggle library (e.g., FF4J or LaunchDarkly) or a database-backed configuration table. Feature flags are a recognised way to modify system behaviour without changing the code.
2. **Add a toggle to the UI.** Place a switch in the global header labelled “Research Mode.” The default state should be **off**. When off, each light card shows only the basics: name, status, PPFD, DLI and energy. When on, the card expands to display spectrum sliders, recipe details, calibration multipliers and debugging readouts.
3. **Persist user preferences.** Store the toggle state per user and per device (e.g., in a database table or browser local storage) so the setting is remembered across sessions.
4. **Control visibility with state.** Use conditional rendering or CSS classes to hide or show advanced controls. Avoid deleting code; the feature flag simply determines which components are visible.
5. **Test both modes thoroughly.** Verify that performance remains acceptable when Research Mode is on and that all advanced controls disappear when it is off.

### Chat Starters

- *“Which controls do growers need every day, and which should only appear in Research Mode?”*
- *“Do we want Research Mode to default to off for new users?”*
- *“Where should the toggle be stored—per browser, per user account or both?”*

## 2. Integrate Energy Usage and DLI Metrics

**Goal:** Treat light energy consumption and Daily Light Integral (DLI) as first-class metrics with daily, weekly and monthly summaries.

### Implementation Steps

1. **Calculate DLI.** Implement the formula **DLI = PPFD × (3,600 × photoperiod) ÷ 1,000,000** to convert instantaneous PPFD into moles of photons per square metre per day. Compute this daily for each device and roll up to weekly and monthly totals.
2. **Compute energy use.** Convert wattage to kilowatt-hours by dividing by 1,000 and multiplying by hours of operation; a 100 W device running 10 hours consumes 1 kWh. Summarise today, last seven days and last 30 days.
3. **Capture raw data.** Wherever possible, install DIN-rail energy meters with current-transformer clamps and Modbus/MQTT communication. Carlo Gavazzi’s EM24 meter, for example, supports Modbus and handles circuits up to 65 A.
4. **Handle grouped lights.** Ask the user during setup how many lights share each smart plug or daisy-chain. Record this count and divide aggregated energy and DLI measurements by it to estimate per-light values. Some LED systems allow multiple fixtures to run off a single power cord, so this step is essential.
5. **Implement fallback estimates.** If no meter is available, derive power from the driver’s wattage rating multiplied by its current dimming percentage. Tag these estimates clearly in the UI.
6. **Display metrics.** On each light or group card, show DLI and kWh for today, the last week and last month. Include a tooltip that explains the formulas used and optionally multiply kWh by a user-defined price to estimate cost.
7. **Forecast.** Use existing schedules (periods, start times and ramp durations) to project the remaining DLI and energy for the rest of the day.

### Chat Starters

- *“Do we have access to circuit-level meters, or will we derive energy from driver percentages?”*
- *“What electricity cost should be applied when calculating price?”*
- *“How should we handle fixtures that share a single plug or communication line?”*

## 3. Implement Spectral Mix Visualisation

**Goal:** Replace raw channel percentages with a physics-based spectrum bar that reflects the actual spectral power distribution (SPD).

### Implementation Steps

1. **Define the data model.** For each channel or driver, store its SPD as an array (e.g., values every 10 nm from 400–700 nm). Provide presets for common LEDs (cool white, warm white, blue, red) and allow administrators to upload vendor-provided SPDs.
2. **Compute weighted spectra.** On every update, multiply each SPD curve by the channel’s dimming percentage and sum the results. Normalise the combined spectrum to the highest value to generate a displayable bar. SPD curves quantify the power per unit wavelength of a light source, so this method yields the true mix.
3. **Cache results.** Update the spectrum calculation once per minute to reduce CPU load; recalculate immediately when a user adjusts the spectrum sliders.
4. **Render the bar.** Replace the existing “% per driver” bar with a stacked bar chart that spans 400–700 nm and optional far-red or UV zones. Use a chart library (Chart.js, D3.js or Recharts) for React, or embed a JavaScript chart in Vaadin for a Java-centric UI.
5. **Explain with tooltips.** Add a tooltip to the spectrum bar describing how the weighted SPD is computed, reinforcing that the display is physics-based rather than cosmetic.

### Chat Starters

- *“Which SPD presets should be available out of the box (e.g., 3000 K warm white, 5000 K cool white)?”*
- *“Do we want to display far-red or UV channels if present?”*
- *“How often should we recalculate the spectrum to balance accuracy and performance?”*

## 4. Link Schedules and Groups

**Goal:** Ensure that groups know which schedule they are following, and edits at the group level update the schedule endpoint accordingly.

### Implementation Steps

1. **Adopt a consistent ID scheme.** When saving a schedule for a group, use an identifier like `group:<name>` so the back-end knows it applies to multiple devices.
2. **Update the UI.** Add a schedule badge to each group card summarising the current cycle (e.g., “1-cycle 16/8 starting at 18:00” or “2-cycle 6 h/6 h”). Clicking the badge opens an editor.
3. **Modify the schedule editor.** When a user edits a group schedule, send a single `POST` or `PATCH` request to `/sched` with the group ID rather than duplicating requests for each device.
4. **Validate input.** Ensure that schedules do not overlap or conflict and provide a calendar-style visualisation to make timing clear.

### Chat Starters

- *“Should each group have only one active schedule at a time, or are multiple overlapping schedules allowed?”*
- *“How should we name schedules and groups to avoid confusion?”*
- *“What happens to existing device-level schedules when a group schedule is saved?”*

## 5. Build a Two-Cycle Photoperiod Editor

**Goal:** Allow operators to define two light cycles within a 24-hour day while preventing drift.

### Implementation Steps

1. **Design the form.** Provide inputs for Cycle A’s start time and photonic period in hours. Automatically calculate Cycle B’s start and end times so that the two cycles together equal 24 hours.
2. **Offer quick actions.** Include a button “Split 24 h evenly” that sets both cycles to 12 hours or, if Cycle A has been entered, evenly divides the remaining hours.
3. **Add validation.** Display warnings if the two periods do not sum to 24 hours and supply a one-click “Fix to 24 h” action.
4. **Persist the schedule.** Store the two cycles as an array of objects in a single schedule document (e.g., `{ "period": "2c", "cycles": [ { "start": "06:00", "duration": 6 }, { "start": "18:00", "duration": 6 } ] }`).
5. **Integrate with the scheduler.** Modify the back-end to trigger lighting changes at each cycle boundary.

### Chat Starters

- *“Do you prefer equal-length cycles or custom durations?”*
- *“Should the system automatically correct the total to 24 hours, or warn and prevent saving?”*
- *“What default start times should be offered for two-cycle schedules?”*

## 6. Ingest SwitchBot and Other Sensor Data via Azure

**Goal:** Display live temperature, humidity, VPD and CO₂ readings from SwitchBot and other sensors using VS Code and Azure IoT tools.

### Implementation Steps

1. **Install Azure IoT Tools.** In Visual Studio Code, search for the *Azure IoT Hub* extension and install it from the Marketplace. This extension adds Azure IoT Hub support so you can manage and interact with hubs, devices and modules directly from VS Code.
2. **Connect to your IoT hub.** Use the extension’s Explorer view to sign into your Azure account, select your subscription and choose the target IoT hub. Once connected, the Devices node shows your registered devices.
3. **Register sensors.** Add each SwitchBot sensor (via the Hub Mini or BLE bridge) as a device in the IoT hub. Use the extension’s device management commands to list, create and manage devices.
4. **Monitor telemetry.** The extension lets you generate sample code, send device-to-cloud messages and start/stop monitoring the built-in event endpoint; telemetry appears in VS Code’s Output panel. Use this to verify that sensor readings for temperature, RH, VPD and CO₂ are arriving.
5. **Standardise the payload.** Ensure that each message contains a JSON object with fields for temperature, humidity, VPD, CO₂, battery and signal strength plus a room/zone identifier. This unified schema will be consumed by the dashboard’s `/env` endpoint.
6. **Display environment data.** Add dashboard tiles per room or zone showing the latest temperature, relative humidity, VPD and CO₂. Label them “source: SwitchBot” to distinguish data sources. Provide a device list showing battery level and signal strength for maintenance.
7. **Optimise polling.** Balance sensor battery life with update frequency; long polling intervals extend battery life (SwitchBot sensors can operate for up to two years).

### Chat Starters

- *“Which rooms or zones require SwitchBot sensors, and what readings are most important?”*
- *“Are there other sensors (CO₂, airflow) that should be integrated via Azure?”*
- *“Who will manage device provisioning through Azure IoT Hub?”*

## 7. Build an All-Data Explorer and AI Copilot

**Goal:** Provide a unified table for all time-series data with filtering, summaries and AI-assisted insights.

### Implementation Steps

1. **Choose a time-series database.** Use InfluxDB, TimescaleDB or Azure Data Explorer to store raw high-resolution data (seconds or minutes) and daily aggregates. The reTerminal can forward telemetry to the cloud for storage.
2. **Design a table schema.** Represent each measurement as a row with a timestamp and namespaced columns (e.g., `light.ppfd`, `env.temp`, `energy.kWh`, `nutrients.ph`). Provide filters for “today,” “last 7 days,” “last 30 days” and custom ranges.
3. **Compute quick statistics.** Show current values, daily totals, daily averages, weekly totals and monthly totals at the top of the explorer.
4. **Implement export and pagination.** Enable users to download data for offline analysis and page through large result sets.
5. **Add an AI Copilot.** Create a button “Explain trends this week” that runs correlation analyses (Pearson or Spearman) on aggregated data. Present a narrative summarising relationships, such as how increased humidity raises cooling energy consumption.
6. **Generate charts.** Alongside the narrative, produce charts (e.g., PPFD vs. temperature) to visualise correlations. Use Python libraries like pandas and SciPy on the server side.

### Chat Starters

- *“What time ranges and granularity do you need for analysis?”*
- *“Which metrics should the AI focus on when looking for correlations?”*
- *“How should exported data be formatted (CSV, Excel)?”*

## 8. Create an Environment–Energy Breakdown Table

**Goal:** Visualise the relationship between environmental conditions and energy consumption to highlight cause-and-effect.

### Implementation Steps

1. **Compile metrics per zone.** For each room or zone, gather the average temperature, humidity, VPD and CO₂ for the interval, along with energy consumption of the HVAC, dehumidifier, fans and lights.
2. **Display side-by-side.** Build a table where rows correspond to zones and columns include environmental metrics and energy metrics. Show mini scatter plots (sparklines) that plot temperature vs. HVAC kWh and humidity vs. dehumidifier kWh.
3. **Highlight adaptive lighting.** Add a flag or icon indicating when the lighting system automatically dimmed or changed spectrum due to heat or humidity. This transparency helps operators understand automatic adjustments.
4. **Export for analysis.** Allow users to download this table for deeper offline analysis and include notes on the correlation between humidity and cooling energy.

### Chat Starters

- *“Which environmental metrics should be correlated with which energy metrics?”*
- *“Do we need visual indicators when adaptive lighting is engaged?”*
- *“What time intervals should this table support—hourly, daily, weekly?”*

## 9. Assemble a Detailed Lights Table

**Goal:** Provide a comprehensive view of each light, consolidating schedules, recipes, targets and performance metrics.

### Implementation Steps

1. **Define columns.** For each device, display its ID, group, recipe name, schedule summary, PPFD target and actual, DLI today, kWh today/week/month, average channel percentages (CW, WW, BL, RD), blue-to-red ratio, and optional heat index (derived from watt density and airflow).
2. **Include the spectrum bar.** Use the weighted SPD bar from Section 3 in each row to visualise the spectral mix.
3. **Link to trends.** Provide a link or button that opens a trend chart for the selected light (e.g., PPFD vs. plant growth metrics) to support decision making.
4. **Set update frequency.** Refresh real-time fields (status, driver percentages) every few seconds and aggregated fields (DLI, kWh) every minute or hour. Use websockets or server-sent events instead of frequent polling for efficiency.

### Chat Starters

- *“What additional metrics (e.g., heat index) would help you manage lights better?”*
- *“How often should the table refresh in real time?”*
- *“Do we want to include manual edit options (e.g., recipe changes) directly in this table?”*

## 10. Build a Farm-Wide Energy Drill-Down

**Goal:** Highlight where energy is consumed from the farm level down to individual devices and explain changes over time.

### Implementation Steps

1. **Aggregate energy data.** Summarise energy use at the farm, room and system levels (Lights, HVAC, Dehumidifiers, Pumps, IT, Other) and down to individual devices.
2. **Design visuals.** Use a treemap or sunburst chart to illustrate hierarchical consumption. Complement the visual with a ranked table listing systems and devices by kWh and percentage of total use.
3. **Add trend arrows.** Show whether each node’s consumption is increasing or decreasing compared with the previous period (e.g., week over week).
4. **Include an AI narrative.** Provide a “What changed?” button that compares energy usage between periods and runs correlation analyses to explain differences (e.g., energy spikes due to heat waves or humidity leading to longer HVAC runtimes).
5. **Ensure clarity.** Clearly indicate when values are measured versus estimated, especially when groups of lights share a plug or daisy-chain.

### Chat Starters

- *“At which level do you want to start the drill-down—farm, room or system?”*
- *“Should the visual emphasise absolute consumption or percentage of total?”*
- *“How should we present changes week over week (numeric values, arrows, or both)?”*

## 11. Establish Sane Defaults and Guardrails

**Goal:** Keep the system stable and easy to maintain by adopting guardrails and measuring success.

### Implementation Steps

1. **Define a quick-win and robust path.** For each feature, outline a minimal viable version and a more advanced version. Determine metrics to evaluate success (e.g., adoption rates, energy savings).
2. **Protect device contracts.** Maintain existing API endpoints and control contracts (e.g., hex-encoded commands for driver channels). Provide popovers or tooltips explaining channel mappings for developers.
3. **Use feature flags everywhere.** Introduce toggles for `researchMode`, `showEnergyEstimates` and `enableCopilot`. Load these from configuration at startup and avoid removing code paths.
4. **Isolate debug tools.** Only expose calibration and debugging controls when Research Mode is active or the user has a developer role.

### Chat Starters

- *“What metrics will we use to judge whether a feature is successful?”*
- *“Who should have access to advanced debugging controls?”*
- *“How will we roll back or disable features if something goes wrong?”*

## 12. Select Equipment and Integration Patterns

**Goal:** Recommend hardware and network architectures that suit both small and large installations.

### Implementation Steps

1. **Choose power meters.** Use DIN-rail meters with CT clamps (e.g., Carlo Gavazzi EM24) that measure single- or three-phase circuits and offer Modbus RTU/TCP or Ethernet. Ensure they can connect directly to circuits up to 65 A and support multiple tariffs.
2. **Deploy a gateway.** Use a rugged edge computer (industrial Raspberry Pi, Siemens reTerminal) with RS-485 and Ethernet. Install an MQTT broker (e.g., Mosquitto) and Modbus libraries to poll meters and publish data to the cloud.
3. **Wire the network.** Run shielded RS-485 cables for Modbus communication and connect the gateway to the farm’s LAN via Ethernet or Wi-Fi. When remote connectivity is needed, link the gateway to Azure IoT Hub.
4. **Add environmental sensors.** Deploy SwitchBot temperature-humidity sensors with optional CO₂ and VPD measurement. These battery-powered sensors boast up to two years of life and can calculate dewpoint and VPD. Place them in each room or micro-zone.
5. **Supplement with CO₂ and airflow sensors.** Use room-grade CO₂ sensors with MQTT or HTTP support and anemometers in areas prone to heat build-up.
6. **Verify lighting.** Purchase handheld or fixed PPFD sensors to validate that actual PPFD matches targets. Poll reference sensors periodically and log differences.
7. **Integrate with Azure.** Use Azure IoT Hub as the central ingest point. The gateway forwards telemetry, and cloud functions aggregate data into Azure Time Series Insights or Azure Data Explorer for long-term analytics.
8. **Extend the database schema.** Add optional fields to existing endpoints (`/env`, `/sched`) and introduce a `/energy` endpoint to return daily, weekly and monthly kWh summaries. Keep the JSON style consistent with existing APIs and mark new fields as optional to preserve backward compatibility.

### Chat Starters

- *“Which energy meters and sensors meet your budget and accuracy requirements?”*
- *“Do you need real-time data, or is hourly aggregation sufficient?”*
- *“Should we integrate with other cloud providers besides Azure?”*

## 13. Implementation Checklist and Next Steps

**Goal:** Provide a consolidated to-do list that ties the above steps together and ensures no details are missed.

### Implementation Steps

1. **Set up feature flags** for research mode, energy estimates and AI copilot and expose them in the UI.
2. **Extend setup forms** to ask how many lights are connected to each smart plug or daisy-chained line and persist this count.
3. **Enhance data contracts**: update `/env` to include temperature, RH, VPD and CO₂; update `/sched` to accept group IDs; add `/energy` summaries; include fixture counts on relevant resources.
4. **Create SPD management pages** to upload and edit SPD presets and compute weighted spectra.
5. **Build the two-cycle editor** with auto-calculations, split buttons and validations.
6. **Implement canonical tables**: the All-Data Explorer, the Environment–Energy table and the Detailed Lights table. Ensure they share common components for filtering, sorting and exporting.
7. **Develop the AI copilot** using simple correlation analyses and generate narratives and charts. Integrate it into the All-Data Explorer and the Energy Drill-Down.
8. **Install hardware**: meters, sensors, gateways and reference lights. Configure them to send telemetry to the reTerminal and onward to Azure IoT Hub.
9. **Configure the cloud**: set up Azure IoT Hub, storage and analytics services; verify data flows end-to-end.
10. **Iterate and measure**: launch a minimal set of features, gather feedback and metrics (e.g., energy savings, user engagement) and refine the system.

### Chat Starters

- *“What order should we implement these features, given resource availability?”*
- *“How will we track success metrics like energy savings or yield improvements?”*
- *“Which team members will be responsible for hardware deployment, software development and data science?”*

## Conclusion

By following this step-by-step plan, your CEA dashboard will evolve into a multi-modal, research-ready platform. Feature flags provide safe experimentation, precise formulas translate sensor data into actionable metrics, SPD curves deliver physics-based visualisations, and Azure-based sensor ingestion ensures reliable data flow. Transparent tables and AI insights help growers understand how environment and energy interact, while robust hardware choices and cloud integration ensure scalability. Regularly revisiting chat starters with stakeholders will keep development aligned with real-world needs.
