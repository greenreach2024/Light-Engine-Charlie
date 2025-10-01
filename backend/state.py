"""In-memory state containers for devices, schedules, and lighting."""
from __future__ import annotations

import threading
from datetime import datetime
from typing import Dict, Iterable, List, Optional

from .config import LightingFixture
from .device_models import Device, Schedule, SensorEvent


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


__all__ = [
    "DeviceRegistry",
    "SensorEventBuffer",
    "LightingState",
    "ScheduleStore",
]
