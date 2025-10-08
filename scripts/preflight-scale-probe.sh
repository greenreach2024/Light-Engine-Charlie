#!/usr/bin/env bash
# Light Engine Charlie preflight checks + controller scale probe.
# Supports both legacy /api/devicedatas and namespaced /controller/devicedatas routes
# and provides Managed Edge (medge) overrides for TLS headers and custom paths.

set -euo pipefail

DEFAULT_BASE_URL="http://127.0.0.1:8091"
DEFAULT_DEVICE_ID="2"

print_usage() {
  cat <<'USAGE'
Usage: preflight-scale-probe.sh [options]

Options:
  -b, --base <url>           Override API base URL (default: $DEFAULT_BASE_URL or $API_BASE)
  -d, --device <id>          Device ID to probe (default: $DEVICE_ID or 2)
      --controller-path <p>  Explicit controller listing path or URL
      --device-path <p>      Override device PATCH path (relative or absolute URL)
      --device-url <url>     Override device PATCH endpoint (may include :id token)
  -H, --header "K: V"       Additional header to include on all controller requests
      --skip-probe           Run preflight checks without toggling any devices
      --insecure             Allow self-signed TLS certificates (adds curl -k)
  -h, --help                 Show this help message

Environment overrides:
  API_BASE                   Alias for --base
  DEVICE_ID                  Alias for --device
  CONTROLLER_COLLECTION_PATH Alias for --controller-path
  CONTROLLER_DEVICE_PATH     Alias for --device-path
  CONTROLLER_DEVICE_URL      Alias for --device-url (may contain :id)
  CONTROLLER_HEADERS         One header per line to append to controller requests
  CURL_INSECURE              When set to "1" behaves like --insecure
USAGE
}

info()  { echo "➜ $*"; }
pass()  { echo "  ✔ $*"; }
fail()  { echo "  ✖ $*"; }
warn()  { echo "  ⚠ $*"; }

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required dependency: $1" >&2
    exit 1
  fi
}

require_command curl
require_command node

# Defaults before CLI parsing.
BASE_URL="${API_BASE:-$DEFAULT_BASE_URL}"
DEVICE_ID="${DEVICE_ID:-$DEFAULT_DEVICE_ID}"
COLLECTION_CANDIDATE="${CONTROLLER_COLLECTION_PATH:-}"
DEVICE_PATH_OVERRIDE="${CONTROLLER_DEVICE_PATH:-}"
DEVICE_URL_OVERRIDE="${CONTROLLER_DEVICE_URL:-}"
INSECURE=false
SKIP_PROBE=false

EXTRA_HEADERS=()
if [[ -n "${CONTROLLER_HEADERS:-}" ]]; then
  while IFS= read -r header_line; do
    header_line="${header_line%%$'\r'}"
    if [[ -n "$header_line" ]]; then
      EXTRA_HEADERS+=("$header_line")
    fi
  done <<<"${CONTROLLER_HEADERS}" || true
fi

if [[ "${CURL_INSECURE:-}" == "1" ]]; then
  INSECURE=true
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    -b|--base)
      [[ $# -lt 2 ]] && { echo "Missing argument for $1" >&2; exit 1; }
      BASE_URL="$2"
      shift 2
      ;;
    -d|--device)
      [[ $# -lt 2 ]] && { echo "Missing argument for $1" >&2; exit 1; }
      DEVICE_ID="$2"
      shift 2
      ;;
    --controller-path)
      [[ $# -lt 2 ]] && { echo "Missing argument for $1" >&2; exit 1; }
      COLLECTION_CANDIDATE="$2"
      shift 2
      ;;
    --device-path)
      [[ $# -lt 2 ]] && { echo "Missing argument for $1" >&2; exit 1; }
      DEVICE_PATH_OVERRIDE="$2"
      shift 2
      ;;
    --device-url)
      [[ $# -lt 2 ]] && { echo "Missing argument for $1" >&2; exit 1; }
      DEVICE_URL_OVERRIDE="$2"
      shift 2
      ;;
    -H|--header)
      [[ $# -lt 2 ]] && { echo "Missing argument for $1" >&2; exit 1; }
      EXTRA_HEADERS+=("$2")
      shift 2
      ;;
    --skip-probe)
      SKIP_PROBE=true
      shift
      ;;
    --insecure)
      INSECURE=true
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      print_usage
      exit 1
      ;;
  esac
done

# Normalize base URL (strip trailing slash only when the URL is just host/path).
if [[ ! "$BASE_URL" =~ ^https?:// ]]; then
  echo "Base URL must include protocol (http:// or https://)." >&2
  exit 1
fi
BASE_URL="${BASE_URL%/}"

candidate_controller_paths=()
if [[ -n "$COLLECTION_CANDIDATE" ]]; then
  candidate_controller_paths+=("$COLLECTION_CANDIDATE")
fi
candidate_controller_paths+=(
  "/controller/devicedatas"
  "/api/devicedatas"
  "/forwarder/devicedatas"
  "controller/devicedatas"
  "api/devicedatas"
)

join_url() {
  node - "$1" "$2" <<'NODE'
const [base, path] = process.argv.slice(1);
const normalized = base.endsWith('/') ? base : base + '/';
try {
  const resolved = new URL(path, normalized);
  process.stdout.write(resolved.toString());
} catch (err) {
  process.exit(1);
}
NODE
}

resolve_candidate_url() {
  local candidate="$1"
  if [[ "$candidate" =~ ^https?:// ]]; then
    printf '%s' "$candidate"
  else
    join_url "$BASE_URL" "$candidate"
  fi
}

curl_common=()
if [[ "$INSECURE" == true ]]; then
  curl_common+=(-k)
fi
for header in "${EXTRA_HEADERS[@]}"; do
  curl_common+=(-H "$header")
done

die_select_fail() {
  echo "Unable to reach controller device list from ${BASE_URL}." >&2
  echo "Tried: ${candidate_controller_paths[*]}" >&2
  exit 2
}

curl_status() {
  local method="$1"; shift
  curl -s -o /dev/null -w "%{http_code}" "${curl_common[@]}" -X "$method" "$@"
}

COLLECTION_URL=""
COLLECTION_DISPLAY=""
if [[ ${#candidate_controller_paths[@]} -eq 0 ]]; then
  die_select_fail
fi
for candidate in "${candidate_controller_paths[@]}"; do
  url=$(resolve_candidate_url "$candidate" 2>/dev/null) || continue
  status=$(curl_status GET "$url") || status=""
  if [[ "$status" =~ ^2 ]]; then
    COLLECTION_URL="$url"
    COLLECTION_DISPLAY="$candidate"
    break
  fi
done

if [[ -z "$COLLECTION_URL" ]]; then
  die_select_fail
fi

# Determine device endpoint template
DEVICE_TEMPLATE=""
if [[ -n "$DEVICE_URL_OVERRIDE" ]]; then
  DEVICE_TEMPLATE="$DEVICE_URL_OVERRIDE"
elif [[ -n "$DEVICE_PATH_OVERRIDE" ]]; then
  DEVICE_TEMPLATE="$DEVICE_PATH_OVERRIDE"
else
  DEVICE_TEMPLATE="device"
fi

build_device_endpoint() {
  local template="$1" resolved=""
  if [[ "$template" =~ ^https?:// ]]; then
    resolved="$template"
  else
    resolved=$(join_url "${COLLECTION_URL%/}/" "$template") || return 1
  fi

  if [[ "$resolved" == *":id"* ]]; then
    printf '%s' "${resolved/:id/$DEVICE_ID}"
  else
    resolved="${resolved%/}/$DEVICE_ID"
    printf '%s' "$resolved"
  fi
}

if ! DEVICE_ENDPOINT=$(build_device_endpoint "$DEVICE_TEMPLATE"); then
  echo "Unable to determine device endpoint from template: $DEVICE_TEMPLATE" >&2
  exit 2
fi

info "Using base URL: $BASE_URL"
info "Resolved collection: $COLLECTION_URL"
if [[ "$COLLECTION_DISPLAY" != "$COLLECTION_URL" ]]; then
  info "Collection candidate: $COLLECTION_DISPLAY"
fi
info "Device endpoint: $DEVICE_ENDPOINT"
info "Target device ID: $DEVICE_ID"
if [[ ${#EXTRA_HEADERS[@]} -gt 0 ]]; then
  info "Custom headers: ${#EXTRA_HEADERS[@]} added"
fi
if [[ "$INSECURE" == true ]]; then
  info "TLS verification: DISABLED (insecure mode)"
fi

overall_status=0

run_step() {
  local name="$1"
  shift
  info "$name"
  if "$@"; then
    pass "$name"
    echo
  else
    fail "$name"
    echo
    overall_status=1
  fi
}

check_healthz() {
  curl "${curl_common[@]}" -fsS "$BASE_URL/healthz" >/dev/null
}

check_device_inventory() {
  local payload
  if ! payload=$(curl "${curl_common[@]}" -fsS "$COLLECTION_URL" 2>/dev/null); then
    echo "  Failed to retrieve controller inventory"
    return 1
  fi
  printf '%s' "$payload" | node - "$DEVICE_ID" <<'NODE'
const fs = require('fs');
const deviceId = process.argv[2];
const raw = fs.readFileSync(0, 'utf8');
let parsed;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  console.log(`  Failed to parse JSON: ${err.message}`);
  process.exit(1);
}
const items = Array.isArray(parsed?.data) ? parsed.data : [];
console.log(`  Devices discovered: ${items.length}`);
const match = items.find((item) => String(item?.id) === String(deviceId));
const format = (value) => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};
if (match) {
  console.log(`  Snapshot for ${deviceId}: status=${format(match.status)} value=${format(match.value)}`);
} else {
  console.log(`  Warning: device ${deviceId} not found in inventory`);
}
process.exit(items.length > 0 ? 0 : 1);
NODE
}

check_cors_preflight() {
  local headers status
  headers=$(mktemp)
  status=$(curl -s -D "$headers" -o /dev/null -w "%{http_code}" "${curl_common[@]}" -X OPTIONS \
    "$COLLECTION_URL" \
    -H 'Origin: http://localhost' \
    -H 'Access-Control-Request-Method: PATCH' \
    -H 'Access-Control-Request-Headers: content-type,x-request-id')
  echo "  HTTP status: $status"
  echo "  Response headers:"
  sed 's/^/    /' "$headers"
  local allow_origin allow_headers
  allow_origin=$(grep -i 'Access-Control-Allow-Origin' "$headers" || true)
  allow_headers=$(grep -i 'Access-Control-Allow-Headers' "$headers" || true)
  rm -f "$headers"
  [[ "$status" =~ ^2 ]] && [[ -n "$allow_origin" ]] && [[ -n "$allow_headers" ]]
}

run_scale_probe() {
  local original_status="" original_value=""
  local snapshot
  if snapshot=$(curl "${curl_common[@]}" -fsS "$DEVICE_ENDPOINT" 2>/dev/null); then
    mapfile -t state < <(printf '%s' "$snapshot" | node - <<'NODE'
const fs = require('fs');
const raw = fs.readFileSync(0, 'utf8');
let parsed;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  process.exit(0);
}
const status = parsed?.status ?? '';
let value = parsed?.value ?? '';
if (value === null) value = '';
if (typeof value === 'object') value = JSON.stringify(value);
console.log(String(status ?? ''));
console.log(String(value ?? ''));
NODE
)
    if ((${#state[@]} >= 2)); then
      original_status="${state[0]}"
      original_value="${state[1]}"
    fi
    if [[ -n "$original_status" || -n "$original_value" ]]; then
      echo "  Initial state: status=${original_status:-unknown} value=${original_value:-unknown}"
    fi
  else
    echo "  Could not capture initial state (endpoint may not support GET)."
  fi

  attempt_probe() {
    local label="$1" payload="$2"
    local tmp status body
    tmp=$(mktemp)
    status=$(curl "${curl_common[@]}" -s -o "$tmp" -w "%{http_code}" -X PATCH "$DEVICE_ENDPOINT" \
      -H 'Content-Type: application/json' \
      -H 'X-Requested-By: preflight-scale-probe' \
      -d "$payload")
    body=$(cat "$tmp")
    rm -f "$tmp"
    echo "  Attempt ${label}: status ${status}"
    if [[ -n "$body" ]]; then
      echo "    Body: ${body}"
    fi
    [[ "$status" =~ ^2 ]]
  }

  local chosen=""
  if attempt_probe "00-FF" '{"status":"on","value":"000000FF0000"}'; then
    chosen="00-FF"
  elif attempt_probe "00-64" '{"status":"on","value":"000000640000"}'; then
    chosen="00-64"
  else
    echo "  Controller rejected both scales"
    return 1
  fi

  pass "Controller accepted scale ${chosen}"

  local restore_payload
  if [[ -n "$original_status" ]]; then
    if [[ "$original_status" == "off" ]]; then
      restore_payload='{"status":"off","value":null}'
    else
      restore_payload=$(node - "$original_status" "$original_value" <<'NODE'
const status = process.argv[2] || 'on';
const value = process.argv[3] || '';
const payload = { status };
if (!value || value.toLowerCase?.() === 'null') {
  payload.value = null;
} else {
  payload.value = value;
}
process.stdout.write(JSON.stringify(payload));
NODE
)
    fi
  else
    restore_payload='{"status":"off","value":null}'
  fi

  echo "  Restoring device to prior state"
  curl "${curl_common[@]}" -s -o /dev/null -w "%{http_code}" -X PATCH "$DEVICE_ENDPOINT" \
    -H 'Content-Type: application/json' \
    -H 'X-Requested-By: preflight-scale-probe' \
    -d "$restore_payload" >/dev/null || true

  echo "  Selected scale: ${chosen}"
  return 0
}

print_header() {
  echo "========================================"
  echo "$1"
  echo "========================================"
}

print_header "Light Engine Charlie – Preflight"

run_step "Server health" check_healthz
run_step "Device inventory" check_device_inventory
run_step "CORS preflight" check_cors_preflight

if [[ "$SKIP_PROBE" == true ]]; then
  warn "Skipping controller scale probe (requested via --skip-probe)"
  echo
else
  run_step "Controller scale probe" run_scale_probe
fi

echo "Summary:"
if [[ $overall_status -eq 0 ]]; then
  pass "All checks passed"
else
  fail "One or more checks failed"
fi

echo "Next steps:"
echo "  • Verify window.API_BASE and window.USE_SHIM in the browser console."
echo "  • Ensure the dashboard shows no red network errors before using Groups."

echo
exit $overall_status
