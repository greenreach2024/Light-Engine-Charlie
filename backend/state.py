"""In-memory state containers for devices, schedules, and lighting."""
from __future__ import annotations

import threading
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from .config import LightingFixture
from .device_models import Device, GroupSchedule, Schedule, SensorEvent


class DeviceRegistry:
    """Thread-safe registry of devices."""

    def __init__(self) -> None:
        self._devices: Dict[str, Device] = {}
        self._lock = threading.RLock()

    def upsert(self, device: Device) -> None:
        with self._lock:
            self._devices[device.device_id] = device

    def list(self) -> List[Device]:
        with self._lock:
            return list(self._devices.values())

    def by_protocol(self, protocol: str) -> List[Device]:
        with self._lock:
            return [device for device in self._devices.values() if device.protocol == protocol]


class SensorEventBuffer:
    """Fixed-size buffer of sensor events to power automations."""

    def __init__(self, max_events: int = 1000) -> None:
        self._events: List[SensorEvent] = []
        self._max_events = max_events
        self._lock = threading.RLock()

    def add_event(self, event: SensorEvent) -> None:
        with self._lock:
            self._events.append(event)
            if len(self._events) > self._max_events:
                self._events = self._events[-self._max_events :]

    def latest(self, topic: Optional[str] = None) -> Optional[SensorEvent]:
        with self._lock:
            if topic is None:
                return self._events[-1] if self._events else None
            for event in reversed(self._events):
                if event.topic == topic:
                    return event
            return None


def _merge_dicts(base: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merge two dictionaries without mutating the inputs."""

    merged = dict(base)
    for key, value in updates.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_dicts(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def _utc_isoformat(ts: Optional[datetime] = None) -> str:
    moment = ts or datetime.now(timezone.utc)
    return moment.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class LightingState:
    """Track the last known output for fixtures to provide fail-safe defaults."""

    def __init__(self, fixtures: Iterable[LightingFixture]) -> None:
        self._state: Dict[str, Dict[str, int]] = {}
        self._lock = threading.RLock()
        for fixture in fixtures:
            self._state[fixture.address] = {
                "brightness": fixture.min_brightness,
                "spectrum": fixture.spectrum_min,
                "updated_at": int(datetime.utcnow().timestamp()),
            }

    def apply_setting(self, address: str, brightness: int, spectrum: Optional[int] = None) -> Dict[str, int]:
        with self._lock:
            state = self._state.setdefault(
                address,
                {"brightness": brightness, "spectrum": spectrum or 0, "updated_at": 0},
            )
            state["brightness"] = brightness
            if spectrum is not None:
                state["spectrum"] = spectrum
            state["updated_at"] = int(datetime.utcnow().timestamp())
            return dict(state)

    def get_state(self, address: str) -> Optional[Dict[str, int]]:
        with self._lock:
            return self._state.get(address)


class ScheduleStore:
    """In-memory schedule manager with RBAC-aware retrieval."""

    def __init__(self) -> None:
        self._schedules: Dict[str, Schedule] = {}
        self._lock = threading.RLock()

    def upsert(self, schedule: Schedule) -> None:
        with self._lock:
            self._schedules[schedule.schedule_id] = schedule

    def list(self, group: Optional[str] = None) -> List[Schedule]:
        with self._lock:
            if group is None:
                return list(self._schedules.values())
            return [schedule for schedule in self._schedules.values() if schedule.group == group]


class GroupScheduleStore:
    """Thread-safe storage for group or device scoped schedules."""

    def __init__(self) -> None:
        self._entries: Dict[str, GroupSchedule] = {}
        self._lock = threading.RLock()

    def upsert(self, schedule: GroupSchedule) -> GroupSchedule:
        with self._lock:
            self._entries[schedule.device_id] = schedule
            return schedule

    def get(self, device_id: str) -> Optional[GroupSchedule]:
        with self._lock:
            return self._entries.get(device_id)

    def list(self, group: Optional[str] = None) -> List[GroupSchedule]:
        with self._lock:
            values = list(self._entries.values())
            if group is None:
                return values
            return [entry for entry in values if entry.target_group() == group]

    def delete(self, device_id: str) -> None:
        with self._lock:
            self._entries.pop(device_id, None)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


class PlanStore:
    """Thread-safe storage for lighting plans published via /plans."""

    def __init__(self) -> None:
        self._plans: Dict[str, Dict[str, Any]] = {}
        self._updated: Dict[str, str] = {}
        self._lock = threading.RLock()

    def upsert_many(self, plans: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            for key, payload in plans.items():
                if not isinstance(key, str) or not key.strip():
                    continue
                normalized_key = key.strip()
                existing = self._plans.get(normalized_key, {})
                if isinstance(payload, dict):
                    base = existing if isinstance(existing, dict) else {}
                    merged = _merge_dicts(base, payload)
                else:
                    merged = deepcopy(payload)
                self._plans[normalized_key] = merged
                self._updated[normalized_key] = _utc_isoformat()
        return self.list()

    def list(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            return {key: deepcopy(value) for key, value in self._plans.items()}

    def get(self, plan_key: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            if plan_key not in self._plans:
                return None
            return deepcopy(self._plans[plan_key])

    def metadata(self) -> Dict[str, Dict[str, str]]:
        with self._lock:
            return {key: {"updatedAt": value} for key, value in self._updated.items()}

    def clear(self) -> None:
        with self._lock:
            self._plans.clear()
            self._updated.clear()


class EnvironmentStateStore:
    """Maintain the latest environmental targets and telemetry configuration."""

    def __init__(self) -> None:
        self._state: Dict[str, Any] = {"rooms": {}, "zones": {}}
        self._lock = threading.RLock()

    def upsert_rooms(self, rooms: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            current_rooms = self._state.get("rooms", {})
            merged = _merge_dicts(current_rooms, rooms)
            self._state["rooms"] = merged
            self._state["updatedAt"] = _utc_isoformat()
            return deepcopy(merged)

    def upsert_zone(self, zone_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            zones = self._state.setdefault("zones", {})
            existing = zones.get(zone_id, {"zoneId": zone_id})
            incoming = dict(payload)
            incoming["zoneId"] = zone_id
            incoming["updatedAt"] = _utc_isoformat()
            zones[zone_id] = _merge_dicts(existing, incoming)
            self._state["updatedAt"] = _utc_isoformat()
            return deepcopy(zones[zone_id])

    def merge(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            self._state = _merge_dicts(self._state, payload)
            self._state["updatedAt"] = _utc_isoformat()
            return self.snapshot()

    def get_zone(self, zone_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            zone = self._state.get("zones", {}).get(zone_id)
            return deepcopy(zone) if zone else None

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return deepcopy(self._state)

    def clear(self) -> None:
        with self._lock:
            self._state = {"rooms": {}, "zones": {}}


class DeviceDataStore:
    """Persist best-effort controller state for /api/devicedatas."""

    def __init__(self) -> None:
        self._entries: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()

    def upsert(self, device_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            entry = self._entries.get(device_id, {"deviceId": device_id})
            merged = _merge_dicts(entry, payload)
            merged["deviceId"] = device_id
            merged["updatedAt"] = _utc_isoformat()
            self._entries[device_id] = merged
            return deepcopy(merged)

    def get(self, device_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            entry = self._entries.get(device_id)
            return deepcopy(entry) if entry else None

    def list(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [deepcopy(entry) for entry in self._entries.values()]

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


__all__ = [
    "DeviceRegistry",
    "SensorEventBuffer",
    "LightingState",
    "ScheduleStore",
    "GroupScheduleStore",
    "PlanStore",
    "EnvironmentStateStore",
    "DeviceDataStore",
]
