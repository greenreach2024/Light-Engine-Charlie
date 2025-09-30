"""FastAPI server wiring together discovery, automation, and RBAC."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .automation import AutomationEngine, lux_balancing_rule, occupancy_rule
from .config import EnvironmentConfig, build_environment_config
from .device_discovery import fetch_switchbot_status, full_discovery_cycle
from .device_models import Schedule as ScheduleModel
from .device_models import UserContext
from .lighting import LightingController
from .logging_config import configure_logging
from .state import DeviceRegistry, LightingState, ScheduleStore, SensorEventBuffer

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
AUTOMATION = AutomationEngine(CONTROLLER, SCHEDULES)

ZONE_MAP = {fixture.name: fixture.address for fixture in CONFIG.lighting_inventory or []}
if ZONE_MAP:
    target_lux = int(os.getenv("TARGET_LUX", "500"))
    occupied_level = int(os.getenv("OCCUPIED_BRIGHTNESS", "80"))
    vacant_level = int(os.getenv("VACANT_BRIGHTNESS", "30"))
    AUTOMATION.register_rule(lux_balancing_rule(ZONE_MAP, target_lux))
    AUTOMATION.register_rule(occupancy_rule(ZONE_MAP, occupied_level, vacant_level))

_AUTOMATION_TASK: Optional[asyncio.Task] = None
_DISCOVERY_TASK: Optional[asyncio.Task] = None


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


def get_user_context(x_user_id: str = Query("system", alias="X-User-Id"), x_user_groups: str = Query("", alias="X-User-Groups")) -> UserContext:
    groups = [group.strip() for group in x_user_groups.split(",") if group.strip()]
    if not groups:
        groups = ["default"]
    return UserContext(user_id=x_user_id or "system", groups=groups)


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


@app.get("/devices", response_model=List[DeviceResponse])
async def list_devices() -> List[DeviceResponse]:
    return [DeviceResponse(**device.__dict__) for device in REGISTRY.list()]


@app.post("/discovery/run", status_code=status.HTTP_202_ACCEPTED)
async def trigger_discovery() -> dict:
    asyncio.create_task(full_discovery_cycle(CONFIG, REGISTRY, BUFFER, AUTOMATION.publish))
    return {"status": "scheduled"}


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
