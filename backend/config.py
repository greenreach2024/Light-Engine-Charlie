"""Configuration helpers for Light Engine Charlie."""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

import yaml

LOGGER = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class MQTTConfig:
    """Configuration for connecting to an MQTT broker."""

    host: str
    port: int = 1883
    username: Optional[str] = None
    password: Optional[str] = None
    topics: str = "sensors/#"


@dataclass(frozen=True)
class SwitchBotConfig:
    """SwitchBot Cloud API configuration."""

    token: str
    secret: str
    region: str = "us"

    @property
    def base_headers(self) -> Dict[str, str]:
        return {
            "Authorization": self.token,
            "sign": self.secret,
            "Content-Type": "application/json",
        }


@dataclass(frozen=True)
class LightingFixture:
    """Represents a lighting fixture from the on-site inventory."""

    name: str
    model: str
    address: str
    min_brightness: int
    max_brightness: int
    control_interface: str
    spectrum_min: int
    spectrum_max: int


@dataclass(frozen=True)
class EnvironmentConfig:
    """Bundle of configuration for a specific deployment environment."""

    kasa_discovery_timeout: int = 10
    mqtt: Optional[MQTTConfig] = None
    switchbot: Optional[SwitchBotConfig] = None
    lighting_inventory: Optional[List[LightingFixture]] = None


def get_environment() -> str:
    """Return the current environment name."""

    return os.getenv("ENVIRONMENT", "production").lower()


def load_lighting_inventory(path: Optional[Path] = None) -> List[LightingFixture]:
    """Load lighting inventory entries from disk."""

    inventory_path = path or BASE_DIR / "data" / "lighting_inventory.yaml"
    fixtures: List[LightingFixture] = []

    if not inventory_path.exists():
        LOGGER.warning("Lighting inventory file %s missing", inventory_path)
        return fixtures

    try:
        raw_data = yaml.safe_load(inventory_path.read_text(encoding="utf-8")) or []
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.error("Failed to read lighting inventory: %s", exc)
        return fixtures

    for entry in raw_data:
        try:
            fixtures.append(
                LightingFixture(
                    name=entry["name"],
                    model=entry["model"],
                    address=entry["address"],
                    min_brightness=int(entry.get("min_brightness", 0)),
                    max_brightness=int(entry.get("max_brightness", 100)),
                    control_interface=entry["control_interface"],
                    spectrum_min=int(entry.get("spectrum_min", 2700)),
                    spectrum_max=int(entry.get("spectrum_max", 6500)),
                )
            )
        except KeyError as exc:
            LOGGER.error("Invalid lighting inventory entry %s: %s", entry, exc)

    return fixtures


def build_environment_config() -> EnvironmentConfig:
    """Construct an :class:`EnvironmentConfig` from the environment."""

    env = get_environment()
    LOGGER.info("Loading configuration for environment: %s", env)

    mqtt_config = None
    if os.getenv("MQTT_HOST"):
        mqtt_config = MQTTConfig(
            host=os.environ["MQTT_HOST"],
            port=int(os.getenv("MQTT_PORT", "1883")),
            username=os.getenv("MQTT_USERNAME"),
            password=os.getenv("MQTT_PASSWORD"),
            topics=os.getenv("MQTT_TOPICS", "sensors/#"),
        )

    switchbot_config = None
    if os.getenv("SWITCHBOT_TOKEN") and os.getenv("SWITCHBOT_SECRET"):
        switchbot_config = SwitchBotConfig(
            token=os.environ["SWITCHBOT_TOKEN"],
            secret=os.environ["SWITCHBOT_SECRET"],
            region=os.getenv("SWITCHBOT_REGION", "us"),
        )

    lighting_inventory = load_lighting_inventory()

    timeout = int(os.getenv("KASA_DISCOVERY_TIMEOUT", "10"))

    return EnvironmentConfig(
        kasa_discovery_timeout=timeout,
        mqtt=mqtt_config,
        switchbot=switchbot_config,
        lighting_inventory=lighting_inventory,
    )


__all__ = [
    "MQTTConfig",
    "SwitchBotConfig",
    "LightingFixture",
    "EnvironmentConfig",
    "build_environment_config",
    "get_environment",
    "load_lighting_inventory",
]
