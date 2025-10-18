# Schedule Executor System

## Overview

The **Schedule Executor** is an automated service that applies lighting plans and schedules to Grow3 (Code3) controller devices. It runs continuously in the background, checking every minute whether groups should have their lights turned on/off and what spectrum to apply based on the assigned plan and current day.

## Architecture

```
Schedule Executor (runs every 60 seconds)
    ↓
1. Load Groups, Plans, Schedules from JSON files
    ↓
2. For each group with plan + schedule:
   - Check if schedule is currently active (time-based)
   - Calculate current DPS (Days Post Seed) from seedDate
   - Get recipe for current day from plan.env.days[]
   - Convert recipe (CW/WW/BL/RD percentages) → HEX12 payload
    ↓
3. For each light in group:
   - Map light ID (e.g., F00001) → Grow3 device ID (e.g., 2)
   - Send command: PATCH /api/grow3/devicedatas/device/{id}
    ↓
4. Grow3 Controller applies spectrum to physical fixtures
```

## Components

### 1. HEX Converter (`lib/hex-converter.js`)

Converts plan recipes to Grow3 HEX12 format.

**Key Functions:**
- `recipeToHex(recipe, maxByte)` - Convert CW/WW/BL/RD percentages to HEX
- `getCurrentRecipe(plan, config, date)` - Get recipe for current day
- `calculateDPS(seedDate, currentDate)` - Calculate days since seed date
- `isScheduleActive(schedule, date)` - Check if schedule is active now

**Example:**
```javascript
import { recipeToHex } from './lib/hex-converter.js';

const recipe = { cw: 45, ww: 45, bl: 50, rd: 60 };
const hex = await recipeToHex(recipe);
// Result: "737373800000" (using 0xFF scale)
```

### 2. Schedule Executor (`lib/schedule-executor.js`)

Background service that applies schedules automatically.

**Configuration:**
```javascript
const executor = new ScheduleExecutor({
  interval: 60000,              // Check every 60 seconds
  baseUrl: 'http://127.0.0.1:8091',
  grow3Target: 'http://192.168.2.80:3000',
  enabled: true,
  deviceRegistry: {
    'F00001': 2,  // Map light ID to controller device ID
    'F00002': 3,
    'F00003': 4
  }
});

executor.start();
```

### 3. Device Registry (`public/data/device-registry.json`)

Maps light IDs used in Groups V2 to Grow3 controller device IDs.

```json
{
  "devices": {
    "F00001": {
      "controllerId": 2,
      "name": "Fixture 1",
      "protocol": "grow3",
      "capabilities": ["spectrum", "dimming"],
      "channels": ["CW", "WW", "BL", "RD"]
    }
  }
}
```

## Server Integration

The executor is automatically started when `server-charlie.js` starts:

```javascript
// Environment Variables
SCHEDULE_EXECUTOR_ENABLED=true    // Default: true
SCHEDULE_EXECUTOR_INTERVAL=60000  // Default: 60 seconds

// Server startup (in server-charlie.js)
server.on('listening', () => {
  scheduleExecutor = new ScheduleExecutor({ ... });
  scheduleExecutor.start();
});
```

## API Endpoints

### Get Status
```bash
GET /api/schedule-executor/status

Response:
{
  "success": true,
  "enabled": true,
  "running": true,
  "interval": 60000,
  "lastExecution": "2025-10-17T12:34:56.789Z",
  "executionCount": 142,
  "errorCount": 0,
  "deviceRegistry": 5
}
```

### Start Executor
```bash
POST /api/schedule-executor/start

Response:
{
  "success": true,
  "message": "Schedule executor started"
}
```

### Stop Executor
```bash
POST /api/schedule-executor/stop

Response:
{
  "success": true,
  "message": "Schedule executor stopped"
}
```

### Manual Tick (Execute Immediately)
```bash
POST /api/schedule-executor/tick

Response:
{
  "success": true,
  "message": "Schedule executor tick completed",
  "results": [
    {
      "group": "room1:zone-a:Veg Group",
      "plan": "Lettuce 30-Day",
      "schedule": "18/6 Photoperiod",
      "active": true,
      "recipe": { "cw": 45, "ww": 45, "bl": 50, "rd": 60 },
      "hexPayload": "737373800000",
      "devices": [
        { "light": "F00001", "success": true, "result": {...} },
        { "light": "F00002", "success": true, "result": {...} }
      ],
      "timestamp": "2025-10-17T12:34:56.789Z"
    }
  ]
}
```

### Update Device Registry
```bash
POST /api/schedule-executor/device-registry
Content-Type: application/json

{
  "registry": {
    "F00006": 7,
    "F00007": 8
  }
}

Response:
{
  "success": true,
  "message": "Device registry updated"
}
```

## Usage Workflow

### 1. Configure Groups V2

In the dashboard:
1. Create a group (room + zone)
2. Assign a plan (e.g., "Lettuce 30-Day")
3. Set anchor mode: DPS or Seed Date
4. If Seed Date, specify when plants were seeded
5. Assign a schedule (e.g., "18/6 Photoperiod")
6. Assign lights to the group

**Example Group:**
```json
{
  "id": "room1:zone-a:Veg Group",
  "name": "Veg Group",
  "room": "room1",
  "zone": "zone-a",
  "plan": "lettuce-30day",
  "schedule": "18-6-schedule",
  "planConfig": {
    "anchorMode": "seedDate",
    "seedDate": "2025-10-01",
    "targetHumidity": 65
  },
  "lights": [
    { "id": "F00001", "name": "Fixture 1" },
    { "id": "F00002", "name": "Fixture 2" }
  ]
}
```

### 2. Define Plan

Plans contain daily recipes (CW/WW/BL/RD percentages):

```json
{
  "id": "lettuce-30day",
  "name": "Lettuce 30-Day",
  "description": "Lettuce growth cycle",
  "duration": 30,
  "env": {
    "days": [
      { "day": 0, "stage": "Seedling", "cw": 40, "ww": 40, "bl": 45, "rd": 30, "tempC": 22 },
      { "day": 1, "stage": "Seedling", "cw": 42, "ww": 42, "bl": 47, "rd": 32, "tempC": 22 },
      { "day": 7, "stage": "Vegetative", "cw": 45, "ww": 45, "bl": 50, "rd": 40, "tempC": 23 },
      { "day": 14, "stage": "Mature Veg", "cw": 45, "ww": 45, "bl": 55, "rd": 50, "tempC": 24 },
      { "day": 30, "stage": "Harvest", "cw": 40, "ww": 40, "bl": 50, "rd": 45, "tempC": 23 }
    ]
  }
}
```

### 3. Create Schedule

Schedules define on/off times:

```json
{
  "id": "18-6-schedule",
  "name": "18/6 Photoperiod",
  "mode": "one",
  "timezone": "America/Toronto",
  "cycles": [
    { "on": "06:00", "off": "00:00" }
  ]
}
```

### 4. Executor Runs Automatically

Every minute, the executor:
1. Checks if schedule is active (current time between 06:00 and 00:00)
2. Calculates DPS: `today - seedDate = 16 days`
3. Gets recipe for day 16 from plan
4. Converts recipe to HEX: `737373800000`
5. Sends to each light via Grow3 controller

## Troubleshooting

### Lights Not Responding

**Check executor status:**
```bash
curl http://127.0.0.1:8091/api/schedule-executor/status
```

**Verify device registry:**
- Ensure light IDs match those in `device-registry.json`
- Verify controller IDs match Grow3 hardware

**Manually trigger tick:**
```bash
curl -X POST http://127.0.0.1:8091/api/schedule-executor/tick
```

### Incorrect Spectrum

**Check plan recipe:**
- Verify percentages in plan.env.days[]
- Check current DPS calculation
- Ensure channel-scale.json has correct maxByte (0xFF or 0x64)

**Test HEX conversion:**
```javascript
import { recipeToHex } from './lib/hex-converter.js';
const recipe = { cw: 45, ww: 45, bl: 50, rd: 60 };
console.log(await recipeToHex(recipe));
```

### Schedule Not Activating

**Check schedule times:**
- Verify cycle on/off times
- Check timezone setting
- Test with `isScheduleActive()`:

```javascript
import { isScheduleActive } from './lib/hex-converter.js';
const schedule = { cycles: [{ on: "06:00", off: "22:00" }] };
console.log(isScheduleActive(schedule, new Date()));
```

## Environment Variables

```bash
# Enable/disable schedule executor
SCHEDULE_EXECUTOR_ENABLED=true

# Execution interval in milliseconds (default: 60000 = 1 minute)
SCHEDULE_EXECUTOR_INTERVAL=60000

# Grow3 controller URL (default from CTRL env var)
# Set via CTRL environment variable, defaults to http://192.168.2.80:3000
```

## Logging

The executor logs all operations:

```
[ScheduleExecutor] Initialized with interval: 60000 ms
[ScheduleExecutor] Started successfully
[ScheduleExecutor] Tick #1 at 2025-10-17T12:34:56.789Z
[ScheduleExecutor] Loaded 3 groups, 5 plans, 4 schedules
[ScheduleExecutor] Group room1:zone-a:Veg Group: schedule ACTIVE
[ScheduleExecutor] Group room1:zone-a:Veg Group: ON with payload 737373800000
[ScheduleExecutor] PATCH http://127.0.0.1:8091/api/grow3/devicedatas/device/2 {"status":"on","value":"737373800000"}
[ScheduleExecutor] Tick completed in 234ms, processed 3 groups
```

## Security Notes

- Executor runs server-side only
- No authentication required (assumes trusted LAN)
- Device commands go through existing Grow3 proxy
- Can be disabled via environment variable

## Future Enhancements

1. **Gradual Spectrum Transitions** - Smooth ramp between recipes
2. **Override Management** - Manual control takes precedence
3. **Logging & Metrics** - Track spectrum history
4. **Multi-Controller Support** - Beyond single Grow3 controller
5. **Fail-Safe Mode** - Safe defaults on error
6. **WebSocket Notifications** - Real-time UI updates

## Related Documentation

- [Groups V2 Design](/docs/GROUPS_V2_LIGHT_ASSIGNMENT.md)
- [Controller Management](/docs/CONTROLLER_MANAGEMENT.md)
- [Automation System](/docs/AUTOMATION_SYSTEM.md)
- [Setup Wizard System](/SETUP_WIZARD_SYSTEM.md)
