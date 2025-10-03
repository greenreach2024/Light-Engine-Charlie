import React, { useMemo, useState, ChangeEvent, FormEvent } from "react";
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
  const { devices, loading, error, refresh, assignDevice, unassignDevice } = useDevices();
  const [protocolFilter, setProtocolFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [assigning, setAssigning] = useState<Record<string, boolean>>({});
  // Track equipment input per device so multiple forms don't share a single value
  const [equipmentById, setEquipmentById] = useState<Record<string, string>>({});

  const filteredDevices = useMemo(() => filterDevices(devices, protocolFilter, search), [devices, protocolFilter, search]);

  return (
    <section className="device-manager">
      <header className="device-manager__header">
        <h2>Device Manager</h2>
        <div className="device-manager__controls">
          <label htmlFor="protocolFilter">
            Filter by type
            <select
              id="protocolFilter"
              value={protocolFilter}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setProtocolFilter(event.target.value)}
            >
              <option value="all">All</option>
              <option value="kasa">Kasa</option>
              <option value="mqtt">MQTT</option>
              <option value="switchbot">SwitchBot</option>
            </select>
          </label>
          <label htmlFor="deviceSearch">
            Search
            <input
              id="deviceSearch"
              value={search}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
              placeholder="Name, ID or category"
            />
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
            {Object.keys(device.capabilities ?? {}).length > 0 && (
              <div className="device-card__capabilities">
                <h4>Capabilities</h4>
                <ul>
                  {Object.entries(device.capabilities ?? {}).map(([key, value]) => (
                    <li key={key}>
                      <strong>{key}:</strong> {String(value)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="device-card__assignment">
              {device.assignedEquipment ? (
                <div className="assignment-row">
                  <span className="assignment-chip">Assigned: {device.assignedEquipment}</span>
                  <button
                    type="button"
                    className="tiny"
                    disabled={!!assigning[device.device_id]}
                    onClick={async () => {
                      setAssigning((a) => ({ ...a, [device.device_id]: true }));
                      try { await unassignDevice(device.device_id); } finally {
                        setAssigning((a) => ({ ...a, [device.device_id]: false }));
                      }
                    }}
                  >Unassign</button>
                </div>
              ) : (
                <form
                  className="device-manager__assign-form"
                  onSubmit={async (e: FormEvent<HTMLFormElement>) => {
                    e.preventDefault();
                    const value = (equipmentById[device.device_id] ?? "").trim();
                    if (!value) return;
                    setAssigning((a: Record<string, boolean>) => ({ ...a, [device.device_id]: true }));
                    try {
                      await assignDevice(device.device_id, value);
                      setEquipmentById((m: Record<string, string>) => ({ ...m, [device.device_id]: "" }));
                    } finally {
                      setAssigning((a: Record<string, boolean>) => ({ ...a, [device.device_id]: false }));
                    }
                  }}
                >
                  <label className="tiny" htmlFor={`equip-${device.device_id}`}>
                    Equipment
                    <input
                      id={`equip-${device.device_id}`}
                      value={equipmentById[device.device_id] ?? ""}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setEquipmentById((m: Record<string, string>) => ({ ...m, [device.device_id]: e.target.value }))
                      }
                      placeholder="e.g. rack-1-bay-2"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={!!assigning[device.device_id] || !(equipmentById[device.device_id] ?? "").trim()}
                    className="tiny primary"
                  >Assign</button>
                </form>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

export default DeviceManager;
