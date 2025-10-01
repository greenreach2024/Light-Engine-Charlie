"""Dataclasses for device and scheduling models."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time
from typing import Any, Dict, List, Optional


@dataclass
class Device:
    """Represents a discovered device regardless of protocol."""

    device_id: str
    name: str
    category: str
    protocol: str
    online: bool
    capabilities: Dict[str, Any] = field(default_factory=dict)
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SensorEvent:
    """Represents a sensor update received via MQTT."""

    topic: str
    payload: Dict[str, Any]
    received_at: datetime


@dataclass
class Schedule:
    """Lighting schedule definition."""

    schedule_id: str
    name: str
    group: str
    start_time: time
    end_time: time
    brightness: int
    spectrum: Optional[int] = None


@dataclass
class UserContext:
    """Represents the authenticated user making a request."""

    user_id: str
    groups: List[str]

    def can_access_group(self, group: str) -> bool:
        return group in self.groups


__all__ = ["Device", "SensorEvent", "Schedule", "UserContext"]
