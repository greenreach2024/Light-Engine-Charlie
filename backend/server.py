from __future__ import annotations

"""FastAPI server wiring together discovery, automation, and RBAC."""

import asyncio
import contextlib
import logging
import os
from datetime import date, datetime, time, timezone
from typing import Any, Dict, List, Optional

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator

from .ai_assist import SetupAssistError, SetupAssistService
from .automation import AutomationEngine, lux_balancing_rule, occupancy_rule
from .config import EnvironmentConfig, LightingFixture, build_environment_config
from .device_discovery import fetch_switchbot_status, full_discovery_cycle
from .device_models import (
    Device,
    GroupSchedule,
    PhotoperiodScheduleConfig,
    Schedule as ScheduleModel,
    UserContext,
)
from .lighting import LightingController
from .logging_config import configure_logging
from .state import (
    DeviceDataStore,
    DeviceRegistry,
    EnvironmentStateStore,
    EnvironmentTelemetryStore,
    GroupScheduleStore,
    LightingState,
    PlanStore,
    ScheduleStore,
    SensorEventBuffer,
)

LOGGER = logging.getLogger(__name__)

configure_logging()

app = FastAPI(title="Light Engine Charlie", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CONFIG: EnvironmentConfig = build_environment_config()
REGISTRY = DeviceRegistry()
BUFFER = SensorEventBuffer()
LIGHTING_STATE = LightingState(CONFIG.lighting_inventory or [])
CONTROLLER = LightingController(CONFIG.lighting_inventory or [], LIGHTING_STATE)
SCHEDULES = ScheduleStore()
GROUP_SCHEDULES = GroupScheduleStore()
PLAN_STORE = PlanStore()
ENVIRONMENT_STATE = EnvironmentStateStore()
ENVIRONMENT_TELEMETRY = EnvironmentTelemetryStore()
DEVICE_DATA = DeviceDataStore()
AUTOMATION = AutomationEngine(CONTROLLER, SCHEDULES)
AI_ASSIST_SERVICE: Optional[SetupAssistService] = None

if CONFIG.ai_assist and CONFIG.ai_assist.enabled:
    try:
        AI_ASSIST_SERVICE = SetupAssistService(CONFIG.ai_assist)
    except SetupAssistError as exc:
        LOGGER.error("Failed to initialise AI Assist: %s", exc)
        AI_ASSIST_SERVICE = None

ZONE_MAP = {fixture.name: fixture.address for fixture in CONFIG.lighting_inventory or []}
if ZONE_MAP:
    target_lux = int(os.getenv("TARGET_LUX", "500"))
    occupied_level = int(os.getenv("OCCUPIED_BRIGHTNESS", "80"))
    vacant_level = int(os.getenv("VACANT_BRIGHTNESS", "30"))
    AUTOMATION.register_rule(lux_balancing_rule(ZONE_MAP, target_lux))
    AUTOMATION.register_rule(occupancy_rule(ZONE_MAP, occupied_level, vacant_level))

FIXTURE_INVENTORY = CONFIG.lighting_inventory or []
DEVICE_ID_MAP: Dict[str, LightingFixture] = {}
DEVICE_ID_BY_ADDRESS: Dict[str, str] = {}
for index, fixture in enumerate(FIXTURE_INVENTORY, start=1):
    device_id = str(index)
    DEVICE_ID_MAP[device_id] = fixture
    DEVICE_ID_BY_ADDRESS[fixture.address] = device_id
    DEVICE_DATA.upsert(
        device_id,
        {
            "status": "off",
            "value": None,
            "name": fixture.name,
            "address": fixture.address,
            "model": fixture.model,
        },
    )

_AUTOMATION_TASK: Optional[asyncio.Task] = None
_DISCOVERY_TASK: Optional[asyncio.Task] = None


def _parse_time_range(value: Optional[Any]) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        seconds = int(float(value))
        return seconds if seconds > 0 else None
    text = str(value).strip().lower()
    if not text:
        return None
    factors = {"h": 3600, "m": 60, "s": 1}
    for suffix, factor in factors.items():
        if text.endswith(suffix):
            number_text = text[:-1].strip()
            try:
                amount = float(number_text)
            except ValueError:
                return None
            seconds = int(amount * factor)
            return seconds if seconds > 0 else None
    try:
        seconds = int(float(text))
    except ValueError:
        return None
    return seconds if seconds > 0 else None


def _parse_timestamp(value: Any) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 1e12:
            ts /= 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return datetime.now(timezone.utc)
        try:
            numeric = float(text)
        except ValueError:
            numeric = None
        if numeric is not None:
            return _parse_timestamp(numeric)
        normalised = text
        if normalised.endswith("Z"):
            normalised = normalised[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(normalised).astimezone(timezone.utc)
        except ValueError as exc:
            raise ValueError("Invalid timestamp format") from exc
    raise ValueError("Invalid timestamp format")


def _extract_scope(payload: Dict[str, Any]) -> Optional[str]:
    for key in ("scope", "zoneId", "zone", "room", "roomId"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _collect_metadata(payload: Dict[str, Any]) -> Dict[str, Any]:
    metadata: Dict[str, Any] = {}
    meta_payload = payload.get("meta")
    if isinstance(meta_payload, dict):
        for key, value in meta_payload.items():
            if value is not None:
                metadata[key] = value
    alias_map = {"device_id": "deviceId", "sensor_id": "sensorId"}
    for key in ("name", "label", "battery", "rssi", "source", "deviceId", "device_id", "sensorId", "sensor_id", "location"):
        if key in payload and payload[key] is not None:
            target = alias_map.get(key, key)
            metadata[target] = payload[key]
    return metadata


def _is_telemetry_payload(payload: Dict[str, Any]) -> bool:
    if not isinstance(payload, dict):
        return False
    if not isinstance(payload.get("sensors"), dict):
        return False
    return _extract_scope(payload) is not None


def _ingest_environment_telemetry(payload: Dict[str, Any]) -> Dict[str, Any]:
    scope = _extract_scope(payload)
    if not scope:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="scope is required for telemetry payloads")
    sensors = payload.get("sensors")
    if not isinstance(sensors, dict) or not sensors:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="sensors must be a non-empty object")
    timestamp_value = payload.get("ts") or payload.get("timestamp")
    try:
        moment = _parse_timestamp(timestamp_value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    metadata = _collect_metadata(payload)
    zone = ENVIRONMENT_TELEMETRY.add_reading(scope, moment, sensors, metadata)
    response: Dict[str, Any] = {"status": "ok", "zone": zone}
    last_updated = ENVIRONMENT_TELEMETRY.last_updated()
    if last_updated:
        response["updatedAt"] = last_updated
    env_snapshot = ENVIRONMENT_STATE.snapshot()
    if env_snapshot:
        response["env"] = env_snapshot
    return response


@app.get("/")
def root() -> Dict[str, str]:
    return {"message": "Light Engine Charlie API is running. See /docs for API documentation."}


class DeviceResponse(BaseModel):
    device_id: str
    name: str
    category: str
    protocol: str
    online: bool
    capabilities: dict
    details: dict


class PlugStateResponse(BaseModel):
    online: Optional[bool] = None
    on: Optional[bool] = None
    power: Optional[float] = None
    power_w: Optional[float] = Field(None, alias="powerW")
    wattage: Optional[float] = None

    class Config:
        allow_population_by_field_name = True


class PlugResponse(BaseModel):
    id: str
    deviceId: str
    name: str
    vendor: Optional[str] = None
    model: Optional[str] = None
    category: Optional[str] = None
    protocol: Optional[str] = None
    state: PlugStateResponse = Field(default_factory=PlugStateResponse)
    capabilities: Dict[str, Any] = Field(default_factory=dict)
    details: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        allow_population_by_field_name = True


class ScheduleRequest(BaseModel):
    schedule_id: str = Field(..., description="Unique identifier for the schedule")
    name: str
    group: str = Field(..., description="Fixture or group identifier")
    start_time: str = Field(..., description="HH:MM start time in 24h format")
    end_time: str = Field(..., description="HH:MM end time in 24h format")
    brightness: int = Field(..., ge=0, le=100)
    spectrum: Optional[int] = Field(None, description="Optional spectrum/temperature value")


class LightingFixtureResponse(BaseModel):
    name: str
    model: str
    address: str
    control_interface: str
    min_brightness: int
    max_brightness: int
    spectrum_min: int
    spectrum_max: int


class DeviceDataPatch(BaseModel):
    status: Optional[str] = None
    value: Optional[str] = None

    class Config:
        extra = "allow"

    @validator("status")
    def _normalize_status(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("status must be a string")
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("status must be a non-empty string")
        return trimmed.lower()

    @validator("value")
    def _normalize_value(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("value must be a string")
        stripped = value.strip()
        if not stripped:
            return None
        if stripped.lower().startswith("0x"):
            stripped = stripped[2:]
        stripped = stripped.replace(" ", "")
        if len(stripped) % 2 != 0:
            raise ValueError("value must be an even-length hexadecimal string")
        allowed = set("0123456789abcdefABCDEF")
        if any(ch not in allowed for ch in stripped):
            raise ValueError("value must be hexadecimal")
        return stripped.upper()

    def to_payload(self) -> Dict[str, Any]:
        payload = self.dict(exclude_unset=True)
        return {key: value for key, value in payload.items() if value is not None}


class ScheduleOverridePayload(BaseModel):
    mode: str
    value: Optional[Any] = None

    class Config:
        extra = "allow"

    @validator("mode")
    def _validate_mode(cls, value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("override mode must be a non-empty string")
        return value.strip()

    def to_dict(self) -> Dict[str, Any]:
        return self.dict(exclude_unset=True)


class PhotoperiodSchedulePayload(BaseModel):
    type: str
    start: time
    duration_hours: int = Field(..., alias="durationHours")
    ramp_up_min: int = Field(..., alias="rampUpMin")
    ramp_down_min: int = Field(..., alias="rampDownMin")

    class Config:
        allow_population_by_field_name = True

    @validator("type")
    def _enforce_photoperiod(cls, value: str) -> str:
        if value != "photoperiod":
            raise ValueError("only photoperiod schedules are supported")
        return value

    @validator("start", pre=True)
    def _validate_start(cls, value: Any) -> time:
        if isinstance(value, time):
            if value.second or value.microsecond:
                raise ValueError("start time must not include seconds")
            return value
        if isinstance(value, str):
            try:
                parsed = datetime.strptime(value.strip(), "%H:%M").time()
            except ValueError as exc:  # pragma: no cover - defensive guard
                raise ValueError("start must use HH:MM format") from exc
            return parsed
        raise TypeError("start must be a HH:MM string")

    @validator("duration_hours")
    def _validate_duration(cls, value: int) -> int:
        if not isinstance(value, int):
            raise TypeError("durationHours must be an integer")
        if value < 0 or value > 24:
            raise ValueError("durationHours must be between 0 and 24")
        return value

    @validator("ramp_up_min", "ramp_down_min")
    def _validate_ramps(cls, value: int) -> int:
        if not isinstance(value, int):
            raise TypeError("ramp durations must be integers")
        if value < 0:
            raise ValueError("ramp durations must be non-negative")
        return value

    def to_config(self) -> PhotoperiodScheduleConfig:
        return PhotoperiodScheduleConfig(
            start=self.start,
            duration_hours=self.duration_hours,
            ramp_up_minutes=self.ramp_up_min,
            ramp_down_minutes=self.ramp_down_min,
        )


class GroupScheduleRequest(BaseModel):
    device_id: str = Field(..., alias="deviceId")
    plan_key: Optional[str] = Field(None, alias="planKey")
    seed_date: date = Field(..., alias="seedDate")
    override: Optional[ScheduleOverridePayload] = None
    schedule: PhotoperiodSchedulePayload
    offsets: Dict[str, int] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        allow_population_by_field_name = True
        extra = "forbid"

    @validator("device_id")
    def _validate_device(cls, value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("deviceId must be a non-empty string")
        return value.strip()

    @validator("plan_key")
    def _normalize_plan_key(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    @validator("metadata", pre=True)
    def _validate_metadata(cls, value: Any) -> Dict[str, Any]:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise TypeError("metadata must be an object")
        return value

    @validator("offsets", pre=True)
    def _validate_offsets(cls, value: Any) -> Dict[str, int]:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise TypeError("offsets must be an object of integer adjustments")
        normalized: Dict[str, int] = {}
        for key, raw in value.items():
            if raw is None:
                continue
            if isinstance(raw, bool):
                raise TypeError(f"offset {key} must be an integer value")
            if isinstance(raw, int):
                normalized[str(key)] = raw
                continue
            if isinstance(raw, float) and raw.is_integer():
                normalized[str(key)] = int(raw)
                continue
            raise TypeError(f"offset {key} must be an integer value")
        return normalized

    def to_group_schedule(self) -> GroupSchedule:
        schedule_config = self.schedule.to_config()
        override_payload = self.override.to_dict() if self.override else None
        return GroupSchedule(
            device_id=self.device_id,
            plan_key=self.plan_key,
            seed_date=self.seed_date,
            schedule=schedule_config,
            override=override_payload,
            offsets=dict(self.offsets),
            metadata=dict(self.metadata),
        )


def _extract_group(device_id: str) -> Optional[str]:
    if device_id.startswith("group:"):
        group = device_id.split(":", 1)[1].strip()
        return group or None
    return None


def _serialize_group_schedule(schedule: GroupSchedule) -> Dict[str, Any]:
    return schedule.to_response_payload()


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _is_plug_device(device: Device) -> bool:
    category = (device.category or "").lower()
    name = (device.name or "").lower()
    details = device.details or {}
    detail_category = str(
        details.get("category")
        or details.get("deviceType")
        or details.get("type")
        or details.get("kind")
        or ""
    ).lower()
    detail_name = str(details.get("label") or details.get("name") or "").lower()
    protocol = (device.protocol or "").lower()

    if any("plug" in value for value in (category, name, detail_category, detail_name)):
        return True

    if protocol in {"kasa", "tplink", "shelly", "tasmota", "switchbot"}:
        if any("outlet" in value or "switch" in value for value in (category, detail_category)):
            return True

    return False


def _build_plug_state(device: Device) -> PlugStateResponse:
    details = device.details or {}
    state_payload: Dict[str, Any] = {"online": device.online}

    for key in ("on", "power", "powerW", "power_w", "wattage"):
        if key in details and details[key] is not None:
            if key in {"powerW", "power_w"}:
                state_payload["powerW"] = details[key]
            else:
                state_payload[key] = details[key]

    status = details.get("status")
    if isinstance(status, dict):
        for key in ("on", "power", "powerW", "power_w"):
            if key in status and status[key] is not None:
                if key in {"powerW", "power_w"}:
                    state_payload["powerW"] = status[key]
                else:
                    state_payload[key] = status[key]

    try:
        return PlugStateResponse.parse_obj(state_payload)
    except Exception:  # pylint: disable=broad-except
        LOGGER.debug("Failed to parse plug state payload: %s", state_payload)
        return PlugStateResponse(online=device.online)


def _serialize_plug(device: Device) -> PlugResponse:
    details = dict(device.details or {})
    vendor = details.get("vendor") or details.get("manufacturer") or device.protocol
    model = details.get("model") or details.get("deviceType") or device.category

    state = _build_plug_state(device)

    return PlugResponse(
        id=device.device_id,
        deviceId=device.device_id,
        name=device.name,
        vendor=(vendor or None),
        model=(model or None),
        category=device.category,
        protocol=device.protocol,
        state=state,
        capabilities=dict(device.capabilities or {}),
        details=details,
    )


def _collect_plug_payloads() -> List[Dict[str, Any]]:
    plugs: Dict[str, Dict[str, Any]] = {}
    for device in REGISTRY.list():
        if not _is_plug_device(device):
            continue
        plug_payload = _serialize_plug(device).dict(by_alias=True)
        plug_id = plug_payload.get("id") or plug_payload.get("deviceId")
        if plug_id:
            plugs[str(plug_id)] = plug_payload
        else:
            plugs[str(len(plugs))] = plug_payload
    return list(plugs.values())


def _resolve_fixture(device_identifier: str) -> tuple[str, LightingFixture]:
    candidate = device_identifier.strip()
    if candidate in DEVICE_ID_MAP:
        return candidate, DEVICE_ID_MAP[candidate]
    if candidate in DEVICE_ID_BY_ADDRESS:
        resolved = DEVICE_ID_BY_ADDRESS[candidate]
        return resolved, DEVICE_ID_MAP[resolved]
    for device_id, fixture in DEVICE_ID_MAP.items():
        if fixture.name == candidate:
            return device_id, fixture
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")


def _hex_to_channels(value: str) -> List[int]:
    stripped = value.strip()
    if stripped.startswith("0x"):
        stripped = stripped[2:]
    if len(stripped) % 2 != 0:
        return []
    channels: List[int] = []
    for index in range(0, len(stripped), 2):
        try:
            channels.append(int(stripped[index : index + 2], 16))
        except ValueError:
            return []
    return channels


def _estimate_brightness(value: Optional[str], fixture: LightingFixture) -> Optional[int]:
    if not value:
        return None
    channels = _hex_to_channels(value)
    if not channels:
        return None
    window = channels[:4] or channels
    if not window:
        return None
    average = sum(window) / len(window)
    percentage = int(round((average / 255.0) * 100))
    clamped = max(fixture.min_brightness, min(fixture.max_brightness, percentage))
    return clamped


def _apply_device_patch(fixture: LightingFixture, entry: Dict[str, Any]) -> None:
    status_text = entry.get("status")
    value_text = entry.get("value")
    brightness: Optional[int] = None
    if isinstance(status_text, str) and status_text.lower() == "off":
        brightness = fixture.min_brightness
    else:
        brightness = _estimate_brightness(value_text, fixture)
        if brightness is None and isinstance(status_text, str) and status_text.lower() == "on":
            brightness = fixture.max_brightness
    if brightness is not None:
        try:
            CONTROLLER.set_output(fixture.address, brightness)
        except ValueError:
            LOGGER.warning("Failed to apply lighting update for %s", fixture.address)


def _serialize_device_data(device_id: str, fixture: LightingFixture) -> Dict[str, Any]:
    stored = DEVICE_DATA.get(device_id) or {}
    last_state = LIGHTING_STATE.get_state(fixture.address) or {}
    status_text = stored.get("status")
    if not status_text:
        brightness = last_state.get("brightness", 0)
        status_text = "on" if brightness and brightness > fixture.min_brightness else "off"
    value_text = stored.get("value")
    response: Dict[str, Any] = {
        "id": device_id,
        "deviceId": device_id,
        "name": fixture.name,
        "model": fixture.model,
        "address": fixture.address,
        "status": status_text,
        "value": value_text,
        "online": True,
        "updatedAt": stored.get("updatedAt"),
        "controlInterface": fixture.control_interface,
        "lastKnown": last_state,
    }
    channels = _hex_to_channels(value_text) if isinstance(value_text, str) else []
    if channels:
        response["channels"] = channels
        response["estimatedBrightness"] = _estimate_brightness(value_text, fixture)
    elif stored.get("estimatedBrightness") is not None:
        response["estimatedBrightness"] = stored.get("estimatedBrightness")
    return response


def get_user_context(
    x_user_id: str = Header("system", alias="X-User-Id"),
    x_user_groups: str = Header("", alias="X-User-Groups"),
) -> UserContext:
    groups = [group.strip() for group in x_user_groups.split(",") if group.strip()]
    if not groups:
        groups = ["default"]
    return UserContext(user_id=x_user_id or "system", groups=groups)


# Live device discovery endpoint: orchestrates all protocol-specific discovery functions
from fastapi.responses import JSONResponse
from .device_discovery import discover_kasa_devices, discover_ble_devices, discover_mdns_devices


@app.get("/sched")
async def list_group_schedules(
    device_id: Optional[str] = Query(None, alias="deviceId"),
    group: Optional[str] = None,
    user: UserContext = Depends(get_user_context),
) -> Dict[str, Any]:
    if group and not user.can_access_group(group):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for group")

    schedules: List[GroupSchedule] = []
    if device_id:
        schedule = GROUP_SCHEDULES.get(device_id)
        if schedule is not None:
            target_group = schedule.target_group()
            if target_group and not user.can_access_group(target_group):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for group")
            schedules = [schedule]
    else:
        candidate_schedules = GROUP_SCHEDULES.list(group=group)
        for entry in candidate_schedules:
            target_group = entry.target_group()
            if target_group and not user.can_access_group(target_group):
                continue
            schedules.append(entry)

    return {"status": "ok", "schedules": [_serialize_group_schedule(entry) for entry in schedules]}


@app.post("/sched", status_code=status.HTTP_201_CREATED)
async def save_group_schedule(
    request: GroupScheduleRequest, user: UserContext = Depends(get_user_context)
) -> Dict[str, Any]:
    target_group = _extract_group(request.device_id)
    LOGGER.debug("Received schedule save for %s (user groups=%s)", request.device_id, user.groups)
    if target_group and not user.can_access_group(target_group):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User cannot access target group")

    schedule = request.to_group_schedule()
    saved = GROUP_SCHEDULES.upsert(schedule)
    return {"status": "ok", "schedule": _serialize_group_schedule(saved)}


@app.get("/plans")
async def list_plans() -> Dict[str, Any]:
    plans = PLAN_STORE.list()
    metadata = PLAN_STORE.metadata()
    response: Dict[str, Any] = {"status": "ok", "plans": plans}
    if metadata:
        response["metadata"] = metadata
    return response


@app.get("/plans/{plan_key}")
async def get_plan(plan_key: str) -> Dict[str, Any]:
    plan = PLAN_STORE.get(plan_key)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    response: Dict[str, Any] = {"status": "ok", "planKey": plan_key, "plan": plan}
    metadata = PLAN_STORE.metadata().get(plan_key)
    if metadata:
        response["metadata"] = metadata
    return response


@app.post("/plans", status_code=status.HTTP_201_CREATED)
async def publish_plans(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    if not isinstance(payload, dict) or not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Request body must be a non-empty object",
        )
    normalized: Dict[str, Dict[str, Any]] = {}
    for key, value in payload.items():
        if not isinstance(key, str) or not key.strip():
            continue
        if not isinstance(value, dict):
            continue
        normalized[key.strip()] = value
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid plans supplied")
    PLAN_STORE.upsert_many(normalized)
    saved_plans = {key: PLAN_STORE.get(key) for key in normalized.keys() if PLAN_STORE.get(key) is not None}
    response: Dict[str, Any] = {
        "status": "ok",
        "saved": sorted(saved_plans.keys()),
        "plans": saved_plans,
    }
    metadata = PLAN_STORE.metadata()
    if metadata:
        response["metadata"] = {key: metadata[key] for key in saved_plans.keys() if key in metadata}
    return response


@app.get("/env")
async def get_environment(
    scope: Optional[str] = Query(None),
    time_range: Optional[str] = Query(None, alias="range"),
    zone_id: Optional[str] = Query(None, alias="zoneId"),
) -> Dict[str, Any]:
    range_seconds = _parse_time_range(time_range)
    identifier = (scope or zone_id or "").strip()
    response: Dict[str, Any] = {"status": "ok"}

    if identifier:
        telemetry_zone = ENVIRONMENT_TELEMETRY.get_zone(identifier, range_seconds)
        if telemetry_zone:
            response["zone"] = telemetry_zone
        else:
            zone = ENVIRONMENT_STATE.get_zone(identifier)
            if zone is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scope not found")
            response["zone"] = zone
    else:
        response["zones"] = ENVIRONMENT_TELEMETRY.list_zones(range_seconds)

    env_snapshot = ENVIRONMENT_STATE.snapshot()
    if env_snapshot:
        response["env"] = env_snapshot

    last_updated = ENVIRONMENT_TELEMETRY.last_updated()
    if last_updated:
        response["updatedAt"] = last_updated

    return response


@app.post("/env", status_code=status.HTTP_200_OK)
async def upsert_environment(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    if isinstance(payload, list):
        ingested = []
        for item in payload:
            if not isinstance(item, dict) or not _is_telemetry_payload(item):
                continue
            result = _ingest_environment_telemetry(item)
            if "zone" in result:
                ingested.append(result["zone"])
        if not ingested:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid telemetry entries supplied",
            )
        response: Dict[str, Any] = {"status": "ok", "zones": ingested}
        last_updated = ENVIRONMENT_TELEMETRY.last_updated()
        if last_updated:
            response["updatedAt"] = last_updated
        env_snapshot = ENVIRONMENT_STATE.snapshot()
        if env_snapshot:
            response["env"] = env_snapshot
        return response

    if not isinstance(payload, dict) or not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Request body must be a non-empty object",
        )

    if _is_telemetry_payload(payload):
        return _ingest_environment_telemetry(payload)

    response: Dict[str, Any] = {"status": "ok"}

    rooms_payload = payload.get("rooms")
    if isinstance(rooms_payload, dict):
        response["rooms"] = ENVIRONMENT_STATE.upsert_rooms(rooms_payload)

    processed_zone = False
    zone_identifier = payload.get("zoneId") or payload.get("zone_id")
    if isinstance(zone_identifier, str) and zone_identifier.strip():
        zone_payload = dict(payload)
        zone_payload.pop("rooms", None)
        zone_payload.pop("zoneId", None)
        zone_payload.pop("zone_id", None)
        zone_payload.pop("zones", None)
        response["zone"] = ENVIRONMENT_STATE.upsert_zone(zone_identifier.strip(), zone_payload)
        processed_zone = True

    zones_payload = payload.get("zones")
    if isinstance(zones_payload, dict) and not processed_zone:
        merged_zones: Dict[str, Any] = {}
        for zone_key, zone_body in zones_payload.items():
            if not isinstance(zone_key, str) or not isinstance(zone_body, dict):
                continue
            merged_zones[zone_key] = ENVIRONMENT_STATE.upsert_zone(zone_key, zone_body)
        if merged_zones:
            response["zones"] = merged_zones

    remaining = {
        key: value
        for key, value in payload.items()
        if key not in {"rooms", "zoneId", "zone_id", "zones"}
    }
    if remaining:
        if processed_zone:
            extra = {
                key: value
                for key, value in remaining.items()
                if key not in {"targets", "control", "metadata", "sensors"}
            }
            if extra:
                ENVIRONMENT_STATE.merge(extra)
        else:
            ENVIRONMENT_STATE.merge(remaining)

    snapshot = ENVIRONMENT_STATE.snapshot()
    for key, value in snapshot.items():
        response.setdefault(key, value)
    return response

@app.get("/discovery/devices", response_class=JSONResponse)
async def discovery_devices() -> dict:
    """Perform a live scan for all supported device types and return fresh results."""
    results = await asyncio.gather(
        discover_kasa_devices(REGISTRY, timeout=5),
        discover_ble_devices(REGISTRY, scan_duration=8.0),
        discover_mdns_devices(REGISTRY, scan_duration=5.0),
        return_exceptions=True
    )
    devices = []
    protocols = ["kasa", "bluetooth-le", "mdns"]
    for idx, res in enumerate(results):
        if isinstance(res, Exception):
            LOGGER.warning(f"Discovery for {protocols[idx]} failed: {res}")
            continue
        devices.extend([d.__dict__ for d in res])
    return {"devices": devices, "timestamp": asyncio.get_event_loop().time()}

class SetupAssistRequest(BaseModel):
    device_metadata: Dict[str, Any] = Field(default_factory=dict)
    wizard_state: Dict[str, Any] = Field(default_factory=dict)
    environment_context: Dict[str, Any] = Field(default_factory=dict)
    stage: str = Field("start", description="Call stage: start, mid, or complete")


class SetupAssistResponse(BaseModel):
    suggested_fields: Dict[str, Any] = Field(default_factory=dict)
    next_steps: List[str] = Field(default_factory=list)
    summary: Optional[str] = None
    provider: str = Field("heuristic", description="Identifier for the backing AI provider")


def _parse_time(value: str) -> tuple[int, int]:
    parts = value.split(":", 1)
    if len(parts) != 2:
        raise ValueError("Invalid time format")
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour < 24 and 0 <= minute < 60):
        raise ValueError("Hour or minute out of range")
    return hour, minute


def _schedule_from_request(request: ScheduleRequest) -> ScheduleModel:
    from datetime import time

    start_hour, start_minute = _parse_time(request.start_time)
    end_hour, end_minute = _parse_time(request.end_time)
    return ScheduleModel(
        schedule_id=request.schedule_id,
        name=request.name,
        group=request.group,
        start_time=time(hour=start_hour, minute=start_minute),
        end_time=time(hour=end_hour, minute=end_minute),
        brightness=request.brightness,
        spectrum=request.spectrum,
    )


async def _discovery_loop() -> None:
    interval = int(os.getenv("DISCOVERY_INTERVAL", "300"))
    LOGGER.info("Starting discovery loop with interval %s", interval)
    while True:
        try:
            await full_discovery_cycle(CONFIG, REGISTRY, BUFFER, event_handler=AUTOMATION.publish)
        except Exception as exc:  # pylint: disable=broad-except
            LOGGER.exception("Discovery cycle failed: %s", exc)
        await asyncio.sleep(interval)


@app.on_event("startup")
async def startup() -> None:
    global _AUTOMATION_TASK, _DISCOVERY_TASK
    _AUTOMATION_TASK = asyncio.create_task(AUTOMATION.start())
    _DISCOVERY_TASK = asyncio.create_task(_discovery_loop())
    await full_discovery_cycle(CONFIG, REGISTRY, BUFFER, event_handler=AUTOMATION.publish)


@app.on_event("shutdown")
async def shutdown() -> None:
    await AUTOMATION.stop()
    for task in (_AUTOMATION_TASK, _DISCOVERY_TASK):
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "devices": len(REGISTRY.list()),
        "timestamp": _iso_now(),
        "version": app.version,
    }


@app.get("/healthz")
async def healthz() -> dict:
    return await health()


@app.post("/ai/setup-assist", response_model=SetupAssistResponse)
async def setup_assist(request: SetupAssistRequest) -> SetupAssistResponse:
    if not AI_ASSIST_SERVICE:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI Assist not configured")
    try:
        result = await AI_ASSIST_SERVICE.generate(
            device_metadata=request.device_metadata,
            wizard_state=request.wizard_state,
            environment_context=request.environment_context,
            stage=request.stage,
        )
    except SetupAssistError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.exception("AI setup assist failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to obtain AI suggestions") from exc
    return SetupAssistResponse(**result)


@app.get("/devices", response_model=List[DeviceResponse])
async def list_devices() -> List[DeviceResponse]:
    return [DeviceResponse(**device.__dict__) for device in REGISTRY.list()]


@app.get("/plugs")
async def list_plugs() -> Dict[str, Any]:
    plugs = _collect_plug_payloads()
    return {"ok": True, "count": len(plugs), "plugs": plugs}


@app.post("/plugs/discover")
async def discover_plugs() -> Dict[str, Any]:
    await full_discovery_cycle(CONFIG, REGISTRY, BUFFER, event_handler=AUTOMATION.publish)
    plugs = _collect_plug_payloads()
    return {"ok": True, "refreshedAt": _iso_now(), "count": len(plugs), "plugs": plugs}


@app.get("/api/devicedatas")
async def list_device_data() -> Dict[str, Any]:
    devices = [_serialize_device_data(device_id, fixture) for device_id, fixture in DEVICE_ID_MAP.items()]
    return {"data": devices, "count": len(devices), "updatedAt": _iso_now()}


@app.patch("/api/devicedatas/device/{device_id}")
async def update_device_data(device_id: str, request: DeviceDataPatch) -> Dict[str, Any]:
    resolved_id, fixture = _resolve_fixture(device_id)
    payload = request.to_payload()
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No updates supplied")

    status_text = payload.get("status")
    value_text = payload.get("value")
    estimated = None
    if isinstance(value_text, str) and value_text:
        estimated = _estimate_brightness(value_text, fixture)
    elif isinstance(status_text, str) and status_text.lower() == "off":
        estimated = fixture.min_brightness
    elif isinstance(status_text, str) and status_text.lower() == "on":
        estimated = fixture.max_brightness
    if estimated is not None:
        payload["estimatedBrightness"] = estimated

    entry = DEVICE_DATA.upsert(resolved_id, payload)
    _apply_device_patch(fixture, entry)
    return {"status": "ok", "device": _serialize_device_data(resolved_id, fixture)}


@app.post("/discovery/run", status_code=status.HTTP_202_ACCEPTED)
async def trigger_discovery() -> dict:
    asyncio.create_task(full_discovery_cycle(CONFIG, REGISTRY, BUFFER, AUTOMATION.publish))
    return {"status": "scheduled"}


@app.get("/api/devices/kasa", response_model=dict)
async def get_kasa_devices() -> dict:
    """Get TP-Link Kasa devices discovered on the network."""
    from .device_discovery import discover_kasa_devices
    
    devices = await discover_kasa_devices(REGISTRY, timeout=5)
    return {
        "devices": [device.__dict__ for device in devices],
        "protocol": "kasa-wifi",
        "timestamp": asyncio.get_event_loop().time()
    }


@app.get("/api/devices/mqtt", response_model=dict) 
async def get_mqtt_devices() -> dict:
    """Get MQTT devices that have been discovered."""
    mqtt_devices = [device for device in REGISTRY.list() if device.protocol == "mqtt"]
    return {
        "devices": [device.__dict__ for device in mqtt_devices],
        "protocol": "mqtt",
        "timestamp": asyncio.get_event_loop().time()
    }


@app.get("/api/devices/ble", response_model=dict)
async def get_ble_devices() -> dict:
    """Get Bluetooth Low Energy devices discovered nearby."""
    from .device_discovery import discover_ble_devices
    
    devices = await discover_ble_devices(REGISTRY, scan_duration=8.0)
    return {
        "devices": [device.__dict__ for device in devices],
        "protocol": "bluetooth-le", 
        "timestamp": asyncio.get_event_loop().time()
    }


@app.get("/api/devices/mdns", response_model=dict)
async def get_mdns_devices() -> dict:
    """Get mDNS/Bonjour devices discovered on the network."""
    from .device_discovery import discover_mdns_devices
    
    devices = await discover_mdns_devices(REGISTRY, scan_duration=5.0)
    return {
        "devices": [device.__dict__ for device in devices],
        "protocol": "mdns",
        "timestamp": asyncio.get_event_loop().time()
    }


@app.get("/lighting/fixtures", response_model=List[LightingFixtureResponse])
async def list_fixtures() -> List[LightingFixtureResponse]:
    return [
        LightingFixtureResponse(
            name=fixture.name,
            model=fixture.model,
            address=fixture.address,
            control_interface=fixture.control_interface,
            min_brightness=fixture.min_brightness,
            max_brightness=fixture.max_brightness,
            spectrum_min=fixture.spectrum_min,
            spectrum_max=fixture.spectrum_max,
        )
        for fixture in CONFIG.lighting_inventory or []
    ]


@app.get("/schedules")
async def list_schedules(user: UserContext = Depends(get_user_context), group: Optional[str] = None) -> List[dict]:
    if group and not user.can_access_group(group):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for group")
    schedules = SCHEDULES.list(group)
    result = []
    for schedule in schedules:
        if not user.can_access_group(schedule.group):
            continue
        result.append(
            {
                "schedule_id": schedule.schedule_id,
                "name": schedule.name,
                "group": schedule.group,
                "start_time": schedule.start_time.strftime("%H:%M"),
                "end_time": schedule.end_time.strftime("%H:%M"),
                "brightness": schedule.brightness,
                "spectrum": schedule.spectrum,
            }
        )
    return result


@app.post("/schedules", status_code=status.HTTP_201_CREATED)
async def create_schedule(request: ScheduleRequest, user: UserContext = Depends(get_user_context)) -> dict:
    schedule = _schedule_from_request(request)
    if not user.can_access_group(schedule.group):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User cannot access target group")
    AUTOMATION.apply_schedule(schedule, user)
    return {"status": "created", "schedule_id": schedule.schedule_id}


@app.get("/switchbot/{device_id}/status")
async def switchbot_status(device_id: str) -> dict:
    if not CONFIG.switchbot:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SwitchBot not configured")
    status_payload = fetch_switchbot_status(device_id, CONFIG.switchbot)
    if status_payload is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to fetch device status")
    return status_payload


@app.post("/lighting/failsafe")
async def trigger_failsafe() -> dict:
    AUTOMATION.enforce_fail_safe()
    return {"status": "ok"}


__all__ = ["app"]
