# Azure IoT -> Charlie Env Forwarder (Local)

This optional helper consumes environment telemetry and forwards it to Charlie's local `/ingest/env` endpoint.

You can use it when prototyping Azure IoT ingestion or when replaying recorded payloads.

## Usage

1. Prepare a JSONL file with one JSON object per line containing fields compatible with `/ingest/env`:

- zoneId (string)
- name (string)
- temperature (number, °C)
- humidity (number, %)
- vpd (number, kPa)
- co2 (number, ppm)
- battery (number, %)
- rssi (number, dBm)
- source (string)

2. Run the forwarder and point it at your file.

```sh
node forward-jsonl.js ./sample-env.jsonl
```

3. Open the dashboard. The Environment section will poll `/env` every 10 seconds and reflect updates.

## Notes

- This script is a local helper, not a production pipeline. Replace with your Azure Function, IoT Hub consumer, or Logic App as needed.
