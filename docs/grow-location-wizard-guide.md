Grow Location Wizard Step-by-Step Implementation Guide
=====================================================

The Grow Location wizard is an interactive intake flow for indoor farms.  It collects the minimum information needed to set up dashboards and device integrations while keeping the user experience as simple as possible.  Each step below includes a **chat starter** to open discussion with stakeholders, detailed **instructions** for developers and designers, and **rules** to guide implementation.  Use this sequence to build the wizard and onboard farms effectively.

1. Define the wizard purpose and basic structure
-----------------------------------------------

**Chat starter:**
```
Let’s design the Grow Location wizard to gather basic farm information using natural language and progressive questions.
```

**Instructions:**

- Begin the wizard by asking the grower to name the location (e.g., “What should we call this farm?”) and identify the number of rooms and zones.  Use a simple add/edit list so they can define rooms and subdivide them into zones.
- Employ **progressive disclosure**: start with broad questions (e.g., “Do you have any environmental control equipment?”) and reveal follow-up questions only when the answer is “Yes.”  This reduces cognitive load and keeps the form concise.
- Present prompts as conversational language and provide **tap-chip** answers whenever possible (e.g., Yes/No, Unknown, Mixed).  Typing should be a last resort.
- Summarise the user’s selections in a side drawer or stepper so they can see progress at a glance.

**Rules:**

- Keep questions natural and friendly; avoid technical jargon unless the user explicitly asks for more detail.
- Use short forms (1–3 taps) rather than free-text fields.  When text is necessary (e.g., farm name), limit the input length and validate it.
- Store each answer immediately in the wizard’s state so the session can resume if interrupted.

2. Implement device selection with type-ahead search and knowledge base
-----------------------------------------------------------------------

**Chat starter:**
```
We need a device selection step with type-ahead search that auto-populates lights, HVAC units and sensors from a knowledge base.
```

**Instructions:**

- Create a **knowledge base** of common indoor-farm equipment.  For each light or fixture, store the vendor, model, rated wattage, control options (0-10 V, Modbus, LAN API, BLE) and a coarse spectral distribution.  For sensors, record measurement ranges, accuracy and supported protocols.  This allows auto-populating fields when the user selects a device.
- Provide a **type-ahead search** in the wizard: when the user begins typing “Gavita 1700e,” the wizard pre-fills its wattage, 0-10 V control method and typical spectrum.  Keep values editable for cases where the farm uses customised drivers.
- Allow a “Mixed/Unknown” option that defers model details to a later step or uses default values.  Support uploading photos of nameplates or datasheets; parse them offline to update the knowledge base.
- Use coarse spectral bins (20–40 nm) when storing LED spectra so the dashboard can render the spectrum bar efficiently.[Shelly Plus 0-10V Dimmer Knowledge Base](https://kb.shelly.cloud/knowledge-base/shelly-plus-0-10v-dimmer#:~:text=)

**Rules:**

- Continuously update the knowledge base as new equipment is encountered.  Tag each entry with a confidence level (e.g., confirmed by vendor vs. user-entered).
- When the user selects a device not in the database, prompt them for the minimal necessary details: model name, wattage and control method.  Use defaults and highlight missing information for follow-up.
- For lights, group devices into “groups” if they are controlled collectively.  Provide chips for common control methods (0-10 V, Modbus/RS-485, Wi-Fi, Bluetooth, Smart plug, Other).

3. Build micro-forms for environmental equipment
-----------------------------------------------

**Chat starter:**
```
We need to gather counts and control methods for HVAC, dehumidifiers, stand-alone AC/heat units and fans using short forms.
```

**Instructions:**

- Use a **three-tap micro-form** for each environmental device class:
  1. Ask **how many units** of that type exist.
  2. Ask **how they are controlled** using chips: Thermostat (Wi-Fi/Zigbee), Modbus/BACnet, Smart plug, Relay, IR remote, 0-10 V or “Other.”
  3. Ask **how energy will be measured**: built-in meter, CT/branch meter, smart plug metering, or “None.”
- For HVAC, optionally ask if the system is packaged rooftop, split or VRF.  For dehumidifiers, ask the pints-per-day class (small/medium/large) to set expected kWh ranges and monitor performance.
- For stand-alone AC/heat units, ask whether they are portable or mini-split and if they expose any control interface (thermostat, IR, 0-10 V).
- For fans, distinguish between oscillating/HAF fans (smart plugs suffice) and inline or VFD fans (require 0-10 V or Modbus control).  Capture the control address for VFDs and assign them to zones or groups.

**Rules:**

- Keep the micro-form concise; if the user selects “0-10 V,” provide a note that 0-10 V controllers like the Shelly Plus 0-10 V Dimmer offer remote control, schedules and local automation.[Shelly Plus 0-10V Dimmer Knowledge Base](https://kb.shelly.cloud/knowledge-base/shelly-plus-0-10v-dimmer#:~:text=)
- Support both single and three-phase loads; if the user chooses CT metering, remind them that CT sensors are non-invasive and safe to install, whereas inline meters require rewiring and are more accurate.[OpenEnergyMonitor community guidance](https://community.openenergymonitor.org/t/monitoring-ct-sensors-modbus-meters-and-or-plugs/16926#:~:text=,those%20from%20Sonoff%20or%20Shelly)
- When the user selects “Smart plug,” warn that plugs are suitable for individual devices but not entire circuits.[OpenEnergyMonitor community guidance](https://community.openenergymonitor.org/t/monitoring-ct-sensors-modbus-meters-and-or-plugs/16926#:~:text=,those%20from%20Sonoff%20or%20Shelly)

4. Add sensor selection and location specification
------------------------------------------------

**Chat starter:**
```
Let’s implement a sensor selection step with quick pickers for categories and locations.
```

**Instructions:**

- Present chips for common sensor categories: **Temperature/Humidity**, **CO₂**, **Dewpoint/VPD**, **Light/PPFD**, **Energy/Power**, and **Water (flow, EC, pH)**.  Users can select multiple categories.
- For each selected category, prompt for **location** using chips: Room, Zone, Canopy, Intake, Exhaust or “Outdoor.”  This ensures the dashboard tags data correctly.
- Offer an **outdoor baseline** choice: either pull local weather via API or use a physical outdoor probe.  Select “Weather API” by default and allow the user to add an outdoor sensor later.
- Educate users about sensor technologies: recommend **NTC thermistors** for temperature measurement due to their high sensitivity and cost-effectiveness.[Amphenol Sensors – Temperature and Humidity in Agriculture](https://blog.amphenol-sensors.com/industrial-blog/temperature-and-humidity-sensors-in-agriculture#:~:text=What%20is%20an%20NTC%20Thermistor%3F)  Highlight **capacitive humidity sensors** for relative humidity because they provide high accuracy, stability and longevity.[Amphenol Sensors – Temperature and Humidity in Agriculture](https://blog.amphenol-sensors.com/industrial-blog/temperature-and-humidity-sensors-in-agriculture#:~:text=,humidity%20readings%20that%20are%20repeatable)  Suggest **NDIR CO₂ sensors** like the SenseCAP SOLO CO₂ 5000 for carbon-dioxide monitoring; they support Modbus RTU and SDI-12, offer built-in calibration and accurate readings from 400–5000 ppm.[SenseCAP SOLO CO₂ 5000 Datasheet](https://solution.seeedstudio.com/product/sensecap-solo-co2-5000-ndir-co2-sensor-supporting-modbus-rtu-rs485-and-sdi-12/#:~:text=,fast%20response%2C%20and%20superior%20stability)
- For energy monitoring, recommend CT-based branch meters for circuits and smart plugs for individual devices.  Note that CT sensors are safe and non-invasive, while inline meters require rewiring but offer revenue-grade accuracy.[OpenEnergyMonitor community guidance](https://community.openenergymonitor.org/t/monitoring-ct-sensors-modbus-meters-and-or-plugs/16926#:~:text=,those%20from%20Sonoff%20or%20Shelly)

**Rules:**

- Only present follow-up questions relevant to selected sensor categories.  If no sensors are selected, allow the user to skip this step and revisit later.
- Validate that each sensor has a location; default to the whole farm if unspecified.
- Provide tooltips describing the accuracy and range of each sensor type and the importance of calibration (e.g., annual calibration for NDIR CO₂ sensors).

5. Gather connectivity and security details
-----------------------------------------

**Chat starter:**
```
We need to collect connectivity details: do you have a local hub and which cloud tenant should we connect to?  Who can edit farm settings?
```

**Instructions:**

- Ask if there is a **local hub** (e.g., reTerminal or similar).  If yes, prompt for its IP address or hostname.  Confirm whether Node-RED is installed on the hub.
- Ask for the **cloud tenant** (e.g., Azure) and collect necessary identifiers.  Provide guidance on where to find tenant IDs.
- Present a **role picker** to assign permissions (e.g., Admin, Operator, Viewer) for editing farm settings.  Save roles in the farm’s configuration.
- Emphasise the benefits of **edge computing**: processing data locally reduces latency and allows real-time control even with intermittent connectivity.  Sources note that edge devices reduce network dependency and can operate autonomously.[Digi – Edge Computing vs. Cloud Computing](https://www.digi.com/blog/post/edge-computing-vs-cloud-computing#:~:text=Latency%20and%20Responsiveness)
- Highlight that using a local gateway with Node-RED allows quick prototyping and supports multiple protocols (Modbus, MQTT).[qbee – Node-RED for industrial low-code development](https://qbee.io/node-red-is-perfect-for-industrial-low-code-development/#:~:text=)

**Rules:**

- Do not store or display passwords.  Use secure storage for IP addresses and keys.  Provide a “Test connection” button to verify the hub is reachable.
- Encourage farms without a local hub to obtain one; connecting devices directly to the cloud may introduce latency and reliability issues.[Digi – Edge Computing vs. Cloud Computing](https://www.digi.com/blog/post/edge-computing-vs-cloud-computing#:~:text=Connectivity%20Dependency)
- Assign at least one Admin role; prevent the creation of orphaned farms without an administrator.

6. Implement a setup queue and device onboarding workflow
-------------------------------------------------------

**Chat starter:**
```
Let’s implement a setup queue so every time users confirm a device or sensor, a ‘todo chip’ appears to guide them through onboarding.
```

**Instructions:**

- For each **affirmative answer** (e.g., “Yes, we have dehumidifiers”), add a **todo chip** to a persistent queue.  Clicking the chip opens the corresponding onboarding card for that device category (lights, HVAC, dehumidifiers, fans, sensors, etc.).
- Provide a structured onboarding card for each category: list unconfigured devices, allow discovery (if supported) or manual entry (model, control method, location).  For lights, include group assignment; for sensors, include channel mapping; for controllers, include communication parameters.
- Once a device is fully configured (all required fields completed and tested), mark the chip as done and remove it from the queue.  Persist partially completed configurations so users can resume later.

**Rules:**

- Prevent the user from finishing the wizard while there are unresolved chips; instead, prompt them to skip or configure later.
- Provide tooltips and examples for each field in the onboarding cards.  Keep forms short and focused.
- Support resuming the onboarding flow across sessions; store the queue state server-side.

7. Configure Node-RED integration and data flows
-----------------------------------------------

**Chat starter:**
```
Set up Node-RED flows on the local hub to discover devices, collect data and publish it to the cloud via MQTT.
```

**Instructions:**

- Install Node-RED on the reTerminal or equivalent gateway.  Node-RED is a low-code IoT tool with a web-based editor and a large library of connectors, making it ideal for rapid prototyping and stable enough for production.[qbee – Node-RED for industrial low-code development](https://qbee.io/node-red-is-perfect-for-industrial-low-code-development/#:~:text=)
- Build flows to **poll Modbus registers** from energy meters and 0-10 V controllers, parse the data and publish it via MQTT to the cloud.  The qbee article shows that Node-RED can collect electricity data from Modbus devices and forward it to a cloud backend.[qbee – Node-RED for industrial low-code development](https://qbee.io/node-red-is-perfect-for-industrial-low-code-development/#:~:text=Above%20you%20see%20an%20example,function%20important%20for%20the%20system)
- For BLE sensors (e.g., SwitchBot), use a Node-RED node or a companion service to read values and publish them to MQTT.  For Wi-Fi devices with REST APIs, use HTTP nodes.
- Create a **central configuration** in Node-RED to map device IDs to rooms, zones and groups.  Use this map when publishing data so that the dashboard can associate readings with the correct location.
- Ensure Node-RED flows handle reconnection logic and backpressure (e.g., caching readings during network outages).  Provide debug dashboards for administrators.

**Rules:**

- Do not hard-code credentials or network addresses in flows; use environment variables or secure configuration nodes.
- Document each flow, including which devices it serves and the expected data format.  Keep flows modular so they can be reused across farms.
- Test flows thoroughly before deployment; use simulation inputs when physical devices are unavailable.

8. Design data management and AI integration
-------------------------------------------

**Chat starter:**
```
Design the data storage and AI integration so we can aggregate sensor readings and eventually optimise energy use.
```

**Instructions:**

- Store the farm profile (rooms, zones, devices) in a relational database.  Use unique identifiers (UUIDs) for farms, rooms, zones, groups and devices.
- Store time-series data (sensor readings, energy measurements, driver percentages) in a dedicated time-series database or service.  Aggregate data per minute/hour/day and compute derived metrics like DLI, kWh and VPD.
- Start by offering an **advisory AI mode**: compute correlation coefficients (Pearson/Spearman) between light intensity/spectrum and environmental variables (temperature, RH, VPD), between outdoor weather and HVAC/dehumidifier energy and between group-level changes and hot/cold zones.  Display insights along with supporting charts in the dashboard.
- Plan for an optional **autopilot mode** after sufficient data collection.  Research from Cornell University shows that integrating AI for climate control can reduce energy consumption in indoor farming by approximately 25 %.[Cornell University – AI boosts indoor food production](https://news.cornell.edu/stories/2024/09/ai-boosts-indoor-food-productions-energy-sustainability#:~:text=Integrating%20artificial%20intelligence%20into%20today%E2%80%99s,rises%2C%20Cornell%20engineers%20have%20found)  Autopilot should respect guardrails (PPFD and VPD limits, maximum rate of change) and require human approval.

**Rules:**

- Keep AI components modular.  Use cloud services like Azure Machine Learning or custom Python back-ends for analytics, but never let them directly override device settings without approval.
- Log all AI recommendations and user responses for accountability.  Allow users to disable AI suggestions on a per-farm basis.
- Update AI models periodically as more data becomes available; use labeled events (e.g., high-humidity anomalies, energy peaks) to improve accuracy.

9. Create a hardware recommendation library
------------------------------------------

**Chat starter:**
```
Let’s identify recommended hardware for sensors, lights and energy monitoring to populate the wizard’s auto-suggest and ensure compatibility.
```

**Instructions:**

- Maintain a library of **open-protocol grow lights**.  Prioritise fixtures that support 0-10 V dimming, Modbus/RS-485 or IP APIs; these allow central control without proprietary gateways.  Suggest using a **0-10 V bridge** like the Shelly Plus 0-10 V Dimmer, which enables remote control, schedules, local automation and webhooks.[Shelly Plus 0-10V Dimmer Knowledge Base](https://kb.shelly.cloud/knowledge-base/shelly-plus-0-10v-dimmer#:~:text=)
- For environmental sensors, recommend **NTC thermistors** for precise, low-cost temperature monitoring.[Amphenol Sensors – Temperature and Humidity in Agriculture](https://blog.amphenol-sensors.com/industrial-blog/temperature-and-humidity-sensors-in-agriculture#:~:text=What%20is%20an%20NTC%20Thermistor%3F)  Highlight **capacitive humidity sensors** for stable and accurate relative humidity readings.[Amphenol Sensors – Temperature and Humidity in Agriculture](https://blog.amphenol-sensors.com/industrial-blog/temperature-and-humidity-sensors-in-agriculture#:~:text=,humidity%20readings%20that%20are%20repeatable)  Recommend **NDIR CO₂ sensors** like the SenseCAP SOLO CO₂ 5000, which support Modbus RTU/SDI-12, include built-in calibration and provide high accuracy.[SenseCAP SOLO CO₂ 5000 Datasheet](https://solution.seeedstudio.com/product/sensecap-solo-co2-5000-ndir-co2-sensor-supporting-modbus-rtu-rs485-and-sdi-12/#:~:text=,fast%20response%2C%20and%20superior%20stability)
- For energy monitoring, stock **CT-based branch energy meters** (e.g., DIN-rail meters with CT clamps).  These sensors are non-invasive and safe to install.[OpenEnergyMonitor community guidance](https://community.openenergymonitor.org/t/monitoring-ct-sensors-modbus-meters-and-or-plugs/16926#:~:text=,those%20from%20Sonoff%20or%20Shelly)  Use inline meters only when rewiring is acceptable; note that smart plugs are suitable for individual devices but not entire circuits.[OpenEnergyMonitor community guidance](https://community.openenergymonitor.org/t/monitoring-ct-sensors-modbus-meters-and-or-plugs/16926#:~:text=,those%20from%20Sonoff%20or%20Shelly)
- Keep a list of **smart plugs** with energy monitoring for small devices; ensure they support MQTT or REST APIs.  Document each plug’s current rating (≥15 A), voltage and supported protocols.
- Suggest optional handheld or fixed **PAR/PPFD meters** for validating light intensity; connect them via analog (0–5 V) or Modbus.
- Include **IR blasters** for controlling stand-alone AC/heat units that lack digital interfaces.  Document compatibility with common brands.

**Rules:**

- Only recommend devices with open communication protocols (Modbus, MQTT, HTTP or BLE via hub).  Avoid vendor-locked ecosystems whenever possible.
- Keep the library updated with device firmware versions and deprecation notices.  Provide a rating or certification column to indicate reliability.
- Encourage users to select devices from the library by default; allow manual entry for other devices but warn that integration effort may be higher.
