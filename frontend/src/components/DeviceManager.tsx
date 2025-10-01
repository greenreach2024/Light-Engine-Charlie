import React, { useMemo, useState } from "react";
import { Device, useDevices } from "../store/devices";

const PROTOCOL_ORDER = ["kasa", "mqtt", "switchbot", "other"] as const;

const protocolLabel = (protocol: string): string => {
  switch (protocol) {
    case "kasa":
      return "Kasa";
    case "mqtt":
      return "MQTT";
    case "switchbot":
      return "SwitchBot";
    default:
      return protocol.toUpperCase();
  }
};

const getProtocolIndex = (protocol: string): number => {
  const index = PROTOCOL_ORDER.indexOf(protocol as (typeof PROTOCOL_ORDER)[number]);
  return index === -1 ? PROTOCOL_ORDER.length : index;
};

const filterDevices = (devices: Device[], protocolFilter: string, search: string): Device[] => {
  return devices
    .filter((device) => (protocolFilter === "all" ? true : device.protocol === protocolFilter))
    .filter((device) => {
      const haystack = `${device.name} ${device.category} ${device.device_id}`.toLowerCase();
      return haystack.includes(search.toLowerCase());
    })
    .sort((a, b) => {
      const protocolIndexA = getProtocolIndex(a.protocol);
      const protocolIndexB = getProtocolIndex(b.protocol);
      if (protocolIndexA !== protocolIndexB) {
        return protocolIndexA - protocolIndexB;
      }
      return a.name.localeCompare(b.name);
    });
};

export const DeviceManager: React.FC = () => {
  const { devices, loading, error, refresh } = useDevices();
  const [protocolFilter, setProtocolFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  const filteredDevices = useMemo(() => filterDevices(devices, protocolFilter, search), [devices, protocolFilter, search]);

  return (
    <section className="device-manager">
      <header className="device-manager__header">
        <h2>Device Manager</h2>
        <div className="device-manager__controls">
          <label>
            Filter by type
            <select value={protocolFilter} onChange={(event) => setProtocolFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="kasa">Kasa</option>
              <option value="mqtt">MQTT</option>
              <option value="switchbot">SwitchBot</option>
            </select>
          </label>
          <label>
            Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, ID or category" />
          </label>
          <button type="button" onClick={refresh} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      {error && <p className="device-manager__error">{error}</p>}
      {loading && <p className="device-manager__loading">Loading devices…</p>}

      {!loading && filteredDevices.length === 0 && <p className="device-manager__empty">No devices match the current filters.</p>}

      <div className="device-manager__grid">
        {filteredDevices.map((device) => (
          <article key={device.device_id} className="device-card" data-protocol={device.protocol}>
            <header className="device-card__header">
              <h3>{device.name}</h3>
              <span className={`device-card__status device-card__status--${device.online ? "online" : "offline"}`}>
                {device.online ? "Online" : "Offline"}
              </span>
            </header>
            <dl className="device-card__meta">
              <div>
                <dt>Type</dt>
                <dd>{device.category}</dd>
              </div>
              <div>
                <dt>Protocol</dt>
                <dd>{protocolLabel(device.protocol)}</dd>
              </div>
              <div>
                <dt>Identifier</dt>
                <dd>{device.device_id}</dd>
              </div>
            </dl>
            {Object.keys(device.capabilities).length > 0 && (
              <div className="device-card__capabilities">
                <h4>Capabilities</h4>
                <ul>
                  {Object.entries(device.capabilities).map(([key, value]) => (
                    <li key={key}>
                      <strong>{key}:</strong> {String(value)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
};

export default DeviceManager;
