# Batch 14 Verification Log

This log captures the outputs from the Batch 14 commit & test ritual.

1. `rg -n "\\.bak\\." -S` — no results returned, confirming no unexpected backup files.
2. `npm run lint` — reported missing "lint" script; command exited with an error as expected for the current package configuration.
3. `npm run build:charlie` — reported missing "build:charlie" script.
4. `npm run start:charlie` — reported missing "start:charlie" script.
5. `curl -sS $API_BASE/healthz` — failed because `API_BASE` is unset in this environment.
6. `curl -sS $API_BASE/api/devicedatas | jq '.data | length'` — also failed due to the missing `API_BASE` value.
7. `curl -sS $API_BASE/plans | jq 'length'` — same failure cause.
8. `curl -si -X OPTIONS $API_BASE/api/devicedatas | grep -i "204\\|allow"` — produced no output because the upstream request URL was invalid.

All commands were executed in order even where the configured scripts or environment variables were absent.
