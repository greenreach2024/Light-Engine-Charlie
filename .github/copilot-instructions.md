# Light Engine Charlie - Copilot Instructions

## Project Overview

Light Engine Charlie is a comprehensive platform for **indoor farming automation**, specializing in intelligent lighting control for controlled environment agriculture (CEA). The system manages grow lights, environmental sensors, and automation workflows for commercial vertical farms and greenhouse operations.

### Core Purpose
- **Intelligent Lighting Control**: Dynamic spectrum management for optimizing plant growth
- **Environmental Monitoring**: Real-time tracking of temperature, humidity, CO₂, VPD, and light levels (PPFD/DLI)
- **Multi-Protocol Device Integration**: Support for WiFi, BLE, Zigbee, RS485, MQTT, IFTTT, webhooks, and analog (0-10V) control
- **Automation Engine**: Rules-based and schedule-driven lighting adjustments
- **Device Discovery**: Automatic detection and setup wizards for IoT devices across farm networks

## Architecture

### Dual Backend System

**Node.js Backend** (`server-charlie.js`)
- Primary application server running on port 8091
- Express-based REST API and static file server
- SwitchBot API integration with HMAC-SHA256 authentication
- Real-time environmental data aggregation and visualization
- Device setup wizard system
- Data persistence via JSON files in `public/data/`

**Python Backend** (`backend/`)
- FastAPI-based device discovery and automation service
- Asynchronous device discovery for TP-Link Kasa, MQTT brokers, BLE, and SwitchBot
- Rules-driven automation engine with lux balancing and occupancy detection
- Multi-protocol device management
- Configuration via YAML inventory files

### Frontend
- Vanilla JavaScript with modern ES6+ features
- No bundler - direct browser-native modules
- Real-time dashboard with WebSocket-ready architecture
- Responsive design optimized for Raspberry Pi reTerminal displays
- TypeScript types defined in `src/types/`

## Technology Stack

### Node.js Stack
- **Runtime**: Node.js 18+ (ES Modules)
- **Framework**: Express 4.19+
- **Database**: NeDB (embedded document store)
- **Device Libraries**: tplink-smarthome-api
- **Proxy**: http-proxy-middleware for device forwarding

### Python Stack
- **Runtime**: Python 3.8+
- **Framework**: FastAPI with Uvicorn
- **Device Libraries**: 
  - `python-kasa` for TP-Link devices
  - `paho-mqtt` for MQTT broker integration
  - `requests` for HTTP device APIs
- **Data Formats**: YAML for configuration, JSON for API responses

### Frontend Stack
- Vanilla JavaScript (ES6+)
- No React/Vue/Angular - keep it lightweight
- CSS custom properties for theming
- Native Fetch API for HTTP requests

## Domain-Specific Context

### Horticultural Terms
- **PPFD**: Photosynthetic Photon Flux Density (μmol/m²/s) - light intensity measurement
- **DLI**: Daily Light Integral (mol/m²/day) - cumulative light exposure
- **VPD**: Vapor Pressure Deficit (kPa) - humidity/temperature relationship for plant transpiration
- **Spectrum**: Light wavelength composition (e.g., "CW/WW + 450nm + 660nm" for cool white/warm white plus blue and red)
- **Photoperiod**: Light/dark cycle duration (e.g., 18/6 for vegetative growth)

### Device Types
- **Managed Devices**: Pre-configured via Light Engine (Grow3, Lynx3)
- **WiFi Devices**: Vendor API-controlled smart lights
- **Analog (0-10V)**: Industry-standard dimming protocol
- **RS485/Modbus**: Industrial communication for sensors and controllers
- **IFTTT/Webhook**: Cloud-based automation integrations

## Code Style and Standards

### Node.js/JavaScript
- **Module System**: ES Modules (`type: "module"` in package.json)
- **Formatting**: 2-space indentation, single quotes for strings
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Error Handling**: Use try-catch with descriptive error messages; return error objects via REST API
- **Async Patterns**: Prefer async/await over callbacks
- **Comments**: JSDoc for public functions, inline comments for complex logic only

### Python
- **Style Guide**: Follow PEP 8
- **Type Hints**: Use type annotations for function signatures
- **Formatting**: 4-space indentation, Black-compatible
- **Docstrings**: Google-style docstrings for modules, classes, and public functions
- **Error Handling**: Use logging.LOGGER for errors, raise specific exceptions
- **Async**: Use asyncio for concurrent operations

### TypeScript (Types Only)
- Located in `src/types/index.ts`
- Export interfaces for data models used across the application
- Keep types synchronized with backend JSON schemas

## File Organization

```
Light-Engine-Charlie/
├── .github/
│   ├── workflows/          # CI/CD workflows
│   └── copilot-instructions.md
├── backend/                # Python FastAPI backend
│   ├── __init__.py
│   ├── server.py          # FastAPI app entry point
│   ├── device_discovery.py # Multi-protocol device discovery
│   ├── automation.py      # Rules engine
│   ├── config.py          # Configuration management
│   └── lighting.py        # Lighting controller
├── public/                 # Static web assets
│   ├── index.html         # Main dashboard
│   ├── app.charlie.js     # Frontend application logic
│   ├── styles.charlie.css # Styling
│   └── data/              # JSON data files (persisted state)
├── src/                    # Shared TypeScript definitions
│   ├── data/              # Seed data (lights, setup guides)
│   └── types/             # TypeScript interfaces
├── docs/                   # Documentation
├── scripts/                # Utility scripts
├── server-charlie.js      # Node.js main server
├── package.json           # Node.js dependencies
└── requirements.txt       # Python dependencies
```

## Key Design Patterns

### Data Persistence
- JSON files in `public/data/` serve as lightweight database
- POST to `/data/:name` endpoint to persist UI state
- GET `/data/:name` to retrieve state
- No SQL database - keep deployment simple

### Device Discovery
- Network scanning for devices on subnet
- Protocol-specific discovery (mDNS for Kasa, MQTT broker enumeration, SwitchBot Cloud API)
- Wizard-based setup flow with confidence scoring
- Store discovered devices in `public/data/device-kb.json`

### Setup Wizards
- Defined in `SETUP_WIZARDS` constant (server-charlie.js)
- Step-by-step configuration flows
- Field validation and requirements per step
- State tracking in memory (ephemeral)
- See `SETUP_WIZARD_SYSTEM.md` for details

### Environmental Data Flow
1. **Ingestion**: Sensors → `/ingest/env` endpoint
2. **Storage**: Append to `public/data/env.json` with timestamps
3. **Aggregation**: Build 24-hour histories per zone/metric
4. **Visualization**: Sparklines and trend charts on dashboard

## Environment Variables

### Node.js Server
```bash
PORT=8091                           # Server port (default: 8091)
HOST=127.0.0.1                      # Bind address
SWITCHBOT_TOKEN=...                 # SwitchBot Cloud API token
SWITCHBOT_SECRET=...                # SwitchBot Cloud API secret
ENV_SOURCE=azure                    # Use Azure Functions for /env (optional)
AZURE_LATEST_URL=https://...        # Azure endpoint for environmental data
```

### Python Backend
```bash
ENVIRONMENT=production              # Environment name (production, development)
MQTT_HOST=192.168.2.38             # MQTT broker hostname
MQTT_PORT=1883                     # MQTT broker port
MQTT_USERNAME=...                   # MQTT auth username
MQTT_PASSWORD=...                   # MQTT auth password
MQTT_TOPICS=sensors/#              # MQTT topic pattern
SWITCHBOT_TOKEN=...                 # SwitchBot API token
SWITCHBOT_SECRET=...                # SwitchBot API secret
KASA_DISCOVERY_TIMEOUT=10          # Kasa device discovery timeout (seconds)
DISCOVERY_INTERVAL=300             # Auto-discovery interval (seconds)
TARGET_LUX=800                     # Target lux for automation rules
OCCUPIED_BRIGHTNESS=100            # Brightness when room occupied
VACANT_BRIGHTNESS=30               # Brightness when room vacant
```

**IMPORTANT**: Never commit credentials to version control. Use environment variables or `.env` files (add to `.gitignore`).

## Testing

### Node.js Tests
```bash
npm run smoke          # Smoke test against localhost:8091
npm run smoke:8089     # Test against port 8089 (VPN/forwarder)
```

### Python Tests
- No formal test suite yet
- Manual testing via `curl` or Postman against FastAPI endpoints
- Future: pytest with fixtures for device mocking

### CI Pipeline
- GitHub Actions workflow: `.github/workflows/ci.yml`
- Runs on push to `main` and on pull requests
- Steps: Install deps → Lint → Start server → Smoke test
- Must pass before merge

## Development Workflow

### Starting the Node.js Server
```bash
npm install                    # Install dependencies
npm run start                  # Start on default port 8091
PORT=8089 npm run start        # Start on custom port
```

### Starting the Python Backend
```bash
pip install -r requirements.txt
python -m backend              # Starts FastAPI on port 8000
```

### VPN/Forwarder Development
When working remotely via VPN with a Raspberry Pi forwarder:
```bash
# On Pi (forwarder)
PORT=8089 CTRL="http://192.168.2.80:3000" node forwarder.js

# On development machine
npm run start:vpn              # Starts server pointing to Pi forwarder
```

## Common Tasks

### Adding a New Device Type
1. Define setup guide in `src/data/setupGuides.ts`
2. Add device definition to `src/data/lightsSeed.ts`
3. Update `CommType` enum in `src/types/index.ts` if new protocol
4. Implement discovery logic in `backend/device_discovery.py` (Python) or server (Node.js)
5. Add wizard to `SETUP_WIZARDS` in `server-charlie.js`

### Adding a New API Endpoint
**Node.js**:
```javascript
app.get('/api/my-endpoint', (req, res) => {
  // Implement logic
  res.json({ status: 'ok', data: ... });
});
```

**Python**:
```python
@app.get("/api/my-endpoint")
async def my_endpoint() -> dict:
    """Endpoint description."""
    return {"status": "ok", "data": ...}
```

### Modifying the Dashboard UI
1. Edit `public/index.html` for markup
2. Edit `public/app.charlie.js` for behavior
3. Edit `public/styles.charlie.css` for styling
4. Test in browser - no build step required
5. Check console for errors

## Important Notes

### Research Mode
- Toggle via localStorage: `gr.researchMode = true`
- Unlocks advanced controls and diagnostic data
- Used for debugging and field configuration

### Guardrails
- Offline devices are skipped with toast notifications
- Brightness/intensity values capped at 100% per channel
- Fail-safe defaults applied on automation errors
- No destructive operations without user confirmation

### Performance Considerations
- Keep JSON files in `public/data/` under 1MB each
- Limit sparkline data to 24 hours (288 5-minute intervals)
- Discovery scans should timeout after 30 seconds
- MQTT subscriptions should filter by topic pattern

### Security Considerations
- No authentication on local endpoints (assumes trusted LAN)
- SwitchBot API uses HMAC-SHA256 signatures
- MQTT supports TLS and username/password auth
- Device credentials stored in environment variables only

## Anti-Patterns to Avoid

❌ **Don't** commit secrets or API keys to the repository
❌ **Don't** add heavy frontend frameworks (React, Vue) - keep it vanilla
❌ **Don't** introduce SQL databases - JSON files are sufficient
❌ **Don't** use synchronous file I/O in Node.js server routes
❌ **Don't** hard-code IP addresses or device IDs - use discovery
❌ **Don't** remove or modify working device integration code
❌ **Don't** break CI pipeline - ensure tests pass before commit

## Helpful Resources

### External Documentation
- [SwitchBot API v1.1](https://github.com/OpenWonderLabs/SwitchBotAPI)
- [TP-Link Kasa Protocol](https://github.com/python-kasa/python-kasa)
- [MQTT Protocol Specification](https://mqtt.org/mqtt-specification/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Express.js Guide](https://expressjs.com/en/guide/routing.html)

### Internal Documentation
- `SETUP_WIZARD_SYSTEM.md` - Wizard architecture and API
- `docs/DISCOVERY_IMPLEMENTATION.md` - Device discovery details
- `docs/SWITCHBOT-INTEGRATION.md` - SwitchBot integration guide
- `README.md` - Quick start and smoke test instructions

## Questions to Ask Before Making Changes

1. **Does this change require both Node.js and Python backend updates?**
2. **Will this affect existing device integrations or automation rules?**
3. **Does this introduce new dependencies? Are they lightweight and necessary?**
4. **Is this change backwards-compatible with existing JSON data files?**
5. **Have I tested this on a Raspberry Pi reTerminal (target hardware)?**
6. **Does this maintain the "no-build" philosophy for the frontend?**
7. **Are environment variables properly documented and not hard-coded?**

## Final Notes

This project prioritizes **simplicity and reliability** over cutting-edge technology. The goal is a system that farm operators can deploy on a Raspberry Pi without needing a DevOps team. Keep changes minimal, well-tested, and documented.

When in doubt, ask clarifying questions and review existing patterns in the codebase before implementing new features.
