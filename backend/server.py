from __future__ import annotations

"""FastAPI server wiring together discovery, automation, and RBAC."""

import asyncio
import contextlib
import logging
import os
from datetime import date, datetime, time
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator

from .ai_assist import SetupAssistError, SetupAssistService
from .automation import AutomationEngine, lux_balancing_rule, occupancy_rule
from .config import EnvironmentConfig, build_environment_config
from .device_discovery import fetch_switchbot_status, full_discovery_cycle
from .device_models import (
    GroupSchedule,
    PhotoperiodScheduleConfig,
    Schedule as ScheduleModel,
    UserContext,
)
from .lighting import LightingController
from .logging_config import configure_logging
from .state import (
    DeviceRegistry,
    GroupScheduleStore,
    LightingState,
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

_AUTOMATION_TASK: Optional[asyncio.Task] = None
_DISCOVERY_TASK: Optional[asyncio.Task] = None


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
    return {"status": "ok", "devices": len(REGISTRY.list())}


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
