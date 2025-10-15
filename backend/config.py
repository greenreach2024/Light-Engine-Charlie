
from __future__ import annotations

def load_config(*args, **kwargs):
    """
    Alias for build_environment_config().
    Allows newer code to call load_config(env=...) while using
    the existing legacy implementation.
    """
    return build_environment_config(*args, **kwargs)
"""Configuration helpers for Light Engine Charlie."""

import base64
import hashlib
import hmac
import logging
import os
import time
import uuid
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
        """Return the authenticated header set required by the SwitchBot API."""

        timestamp = str(int(time.time() * 1000))
        nonce = uuid.uuid4().hex
        payload = f"{self.token}{timestamp}{nonce}".encode("utf-8")
        signature = hmac.new(self.secret.encode("utf-8"), payload, hashlib.sha256)
        sign = base64.b64encode(signature.digest()).decode("utf-8")

        return {
            "Authorization": self.token,
            "sign": sign,
            "t": timestamp,
            "nonce": nonce,
            "Content-Type": "application/json; charset=utf8",
        }

    @property
    def base_url(self) -> str:
        region = (self.region or "us").lower()
        hosts = {
            "us": "https://api.switch-bot.com",
            "eu": "https://eu-apia.switch-bot.com",
            "cn": "https://cn-apia.switch-bot.com",
            "ap": "https://api.switch-bot.com",
        }
        base = hosts.get(region, hosts["us"])
        return f"{base}/v1.1"


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
class AIConfig:
    """Configuration for AI Assist integrations."""

    enabled: bool = False
    provider: str = "heuristic"
    api_url: Optional[str] = None


@dataclass(frozen=True)
class EnvironmentConfig:
    """Bundle of configuration for a specific deployment environment."""

    kasa_discovery_timeout: int = 10
    mqtt: Optional[MQTTConfig] = None
    switchbot: Optional[SwitchBotConfig] = None
    lighting_inventory: Optional[List[LightingFixture]] = None
    ai_assist: Optional[AIConfig] = None


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


def build_environment_config(env: Optional[str] = None) -> EnvironmentConfig:
    """Construct an :class:`EnvironmentConfig` from the environment.

    Parameters
    ----------
    env:
        Optional override for the environment name. If not provided the
        environment will be resolved using :func:`get_environment`.
    """

    resolved_env = (env or get_environment()).lower()
    LOGGER.info("Loading configuration for environment: %s", resolved_env)

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

    ai_assist_config = None
    raw_ai_enabled = os.getenv("AI_ASSIST_ENABLED", "").strip().lower()
    if raw_ai_enabled in {"1", "true", "yes", "on"}:
        ai_assist_config = AIConfig(
            enabled=True,
            provider=os.getenv("AI_ASSIST_PROVIDER", "heuristic"),
            api_url=os.getenv("AI_ASSIST_API_URL"),
        )

    return EnvironmentConfig(
        kasa_discovery_timeout=timeout,
        mqtt=mqtt_config,
        switchbot=switchbot_config,
        lighting_inventory=lighting_inventory,
        ai_assist=ai_assist_config,
    )


__all__ = [
    "MQTTConfig",
    "SwitchBotConfig",
    "LightingFixture",
    "AIConfig",
    "EnvironmentConfig",
    "build_environment_config",
    "get_environment",
    "load_lighting_inventory",
]
