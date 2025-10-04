import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Device, DeviceAssignment, useDevices } from "../store/devices";

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

type ToastOptions = {
  title?: string;
  msg?: string;
  kind?: string;
  icon?: string;
};

const emitToast = (options: ToastOptions, ttlMs?: number) => {
  if (typeof window !== "undefined" && typeof (window as Record<string, unknown>).showToast === "function") {
    (window as { showToast: (opts: ToastOptions, ttl?: number) => void }).showToast(options, ttlMs);
  }
};

interface RoomOption {
  id: string;
  name: string;
}

interface EquipmentOption {
  id: string;
  label: string;
  category?: string;
}

const normalizeRoom = (room: unknown, index: number): RoomOption => {
  if (!room || typeof room !== "object") {
    return { id: `room-${index + 1}`, name: `Room ${index + 1}` };
  }
  const source = room as Record<string, unknown>;
  const idRaw = typeof source.id === "string" && source.id.trim().length > 0 ? source.id.trim() : null;
  const nameRaw = typeof source.name === "string" && source.name.trim().length > 0 ? source.name.trim() : null;
  const fallback = `room-${index + 1}`;
  return {
    id: idRaw || fallback,
    name: nameRaw || idRaw || fallback,
  };
};

const normalizeEquipment = (item: unknown, index: number): EquipmentOption => {
  if (!item || typeof item !== "object") {
    const fallback = `equipment-${index + 1}`;
    return { id: fallback, label: fallback };
  }
  const source = item as Record<string, unknown>;
  const vendor = typeof source.vendor === "string" ? source.vendor : "";
  const model = typeof source.model === "string" ? source.model : "";
  const category = typeof source.category === "string" ? source.category : undefined;
  const readable = [vendor, model].filter(Boolean).join(" ").trim() || `Equipment ${index + 1}`;
  const fallbackId = readable.toLowerCase().replace(/[^a-z0-9]+/gi, "-") || `equipment-${index + 1}`;
  const id = typeof source.id === "string" && source.id.trim().length > 0 ? source.id.trim() : fallbackId;
  const label = category ? `${readable} (${category})` : readable;
  return { id, label, category };
};

export const DeviceManager: React.FC = () => {
  const { devices, loading, error, refresh, assignDevice, unassignDevice } = useDevices();
  const [protocolFilter, setProtocolFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, DeviceAssignment>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    setAssignmentDrafts(() => {
      const next: Record<string, DeviceAssignment> = {};
      devices.forEach((device) => {
        next[device.device_id] = {
          roomId: device.assignedEquipment?.roomId ?? null,
          equipmentId: device.assignedEquipment?.equipmentId ?? null,
        };
      });
      return next;
    });
  }, [devices]);

  useEffect(() => {
    let cancelled = false;

    const loadRooms = async () => {
      try {
        const response = await fetch("/farm");
        if (!response.ok) {
          throw new Error(`Failed to load rooms (${response.status})`);
        }
        const data = (await response.json()) as {
          rooms?: unknown[];
          farm?: { rooms?: unknown[] };
        };
        const rawRooms = Array.isArray(data.rooms)
          ? data.rooms
          : Array.isArray(data.farm?.rooms)
          ? data.farm?.rooms
          : [];
        if (!cancelled) {
          const normalized = (rawRooms as unknown[]).map((room, index) => normalizeRoom(room, index));
          const unique = normalized.filter(
            (room, index, arr) => arr.findIndex((candidate) => candidate.id === room.id) === index
          );
          setRooms(unique);
        }
      } catch (err) {
        if (!cancelled) {
          setRooms([]);
        }
      }
    };

    const loadEquipment = async () => {
      try {
        const response = await fetch("/data/equipment-kb.json");
        if (!response.ok) {
          throw new Error(`Failed to load equipment (${response.status})`);
        }
        const data = (await response.json()) as { equipment?: unknown[] };
        const rawEquipment = Array.isArray(data.equipment) ? data.equipment : [];
        if (!cancelled) {
          const normalized = (rawEquipment as unknown[]).map((item, index) => normalizeEquipment(item, index));
          const deduped = normalized.filter(
            (item, index, arr) => arr.findIndex((candidate) => candidate.id === item.id) === index
          );
          deduped.sort((a, b) => a.label.localeCompare(b.label));
          setEquipment(deduped);
        }
      } catch (err) {
        if (!cancelled) {
          setEquipment([]);
        }
      }
    };

    loadRooms();
    loadEquipment();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredDevices = useMemo(
    () => filterDevices(devices, protocolFilter, search),
    [devices, protocolFilter, search]
  );

  const roomLookup = useMemo(() => {
    return rooms.reduce<Record<string, RoomOption>>((acc, room) => {
      acc[room.id] = room;
      return acc;
    }, {});
  }, [rooms]);

  const equipmentLookup = useMemo(() => {
    return equipment.reduce<Record<string, EquipmentOption>>((acc, item) => {
      acc[item.id] = item;
      return acc;
    }, {});
  }, [equipment]);

  const isExpanded = useCallback(
    (deviceId: string) => expanded.includes(deviceId),
    [expanded]
  );

  const toggleExpanded = useCallback((deviceId: string) => {
    setExpanded((prev) =>
      prev.includes(deviceId) ? prev.filter((id) => id !== deviceId) : [...prev, deviceId]
    );
  }, []);

  const setDraft = useCallback((deviceId: string, draft: DeviceAssignment) => {
    setAssignmentDrafts((prev) => ({ ...prev, [deviceId]: draft }));
  }, []);

  const setPendingState = useCallback((deviceId: string, value: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (value) {
        next.add(deviceId);
      } else {
        next.delete(deviceId);
      }
      return next;
    });
  }, []);

  const handleSubmitAssignment = useCallback(
    async (device: Device) => {
      const draft = assignmentDrafts[device.device_id] ?? {
        roomId: null,
        equipmentId: null,
      };
      if (!draft.roomId || !draft.equipmentId) {
        emitToast({
          title: "Assignment required",
          msg: "Select both a room and equipment to assign this device.",
          kind: "warn",
          icon: "⚠️",
        });
        throw new Error("Room and equipment are required");
      }
      setPendingState(device.device_id, true);
      try {
        const updated = await assignDevice(device.device_id, draft);
        const roomName = updated.assignedEquipment.roomId
          ? roomLookup[updated.assignedEquipment.roomId]?.name || updated.assignedEquipment.roomId
          : "room";
        const equipmentName = updated.assignedEquipment.equipmentId
          ? equipmentLookup[updated.assignedEquipment.equipmentId]?.label || updated.assignedEquipment.equipmentId
          : "equipment";
        emitToast({
          title: "Assignment saved",
          msg: `${updated.name} mapped to ${equipmentName} in ${roomName}.`,
          kind: "success",
          icon: "✅",
        });
        toggleExpanded(device.device_id);
      } catch (err) {
        emitToast({
          title: "Assignment failed",
          msg: err instanceof Error ? err.message : String(err),
          kind: "warn",
          icon: "⚠️",
        });
        throw err;
      } finally {
        setPendingState(device.device_id, false);
      }
    },
    [assignmentDrafts, assignDevice, equipmentLookup, roomLookup, setPendingState, toggleExpanded]
  );

  const handleUnassign = useCallback(
    async (device: Device) => {
      setPendingState(device.device_id, true);
      try {
        await unassignDevice(device.device_id);
        emitToast({
          title: "Device unassigned",
          msg: `${device.name} is now unassigned.`,
          kind: "info",
          icon: "ℹ️",
        });
      } catch (err) {
        emitToast({
          title: "Unassign failed",
          msg: err instanceof Error ? err.message : String(err),
          kind: "warn",
          icon: "⚠️",
        });
      } finally {
        setPendingState(device.device_id, false);
      }
    },
    [setPendingState, unassignDevice]
  );

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
        {filteredDevices.map((device) => {
          const assignment = assignmentDrafts[device.device_id] ?? {
            roomId: device.assignedEquipment?.roomId ?? null,
            equipmentId: device.assignedEquipment?.equipmentId ?? null,
          };
          const expandedForDevice = isExpanded(device.device_id);
          const pendingForDevice = pending.has(device.device_id);
          const assignedRoomName = device.assignedEquipment?.roomId
            ? roomLookup[device.assignedEquipment.roomId]?.name || device.assignedEquipment.roomId
            : null;
          const assignedEquipmentName = device.assignedEquipment?.equipmentId
            ? equipmentLookup[device.assignedEquipment.equipmentId]?.label || device.assignedEquipment.equipmentId
            : null;
          const assignmentSummary = (() => {
            if (assignedRoomName && assignedEquipmentName) {
              return `Assigned to ${assignedEquipmentName} in ${assignedRoomName}`;
            }
            if (assignedRoomName) {
              return `Assigned to ${assignedRoomName}`;
            }
            if (assignedEquipmentName) {
              return `Assigned to ${assignedEquipmentName}`;
            }
            return "Not yet assigned";
          })();

          const handleRoomChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
            const value = event.target.value || null;
            setDraft(device.device_id, {
              roomId: value,
              equipmentId: assignment.equipmentId,
            });
          };

          const handleEquipmentChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
            const value = event.target.value || null;
            setDraft(device.device_id, {
              roomId: assignment.roomId,
              equipmentId: value,
            });
          };

          const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            try {
              await handleSubmitAssignment(device);
            } catch {
              // handled via toast
            }
          };

          return (
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
              <div className="device-manager__assignment">
                <div className="device-manager__assignment-summary">
                  <span>{assignmentSummary}</span>
                  <div className="device-manager__assignment-actions">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(device.device_id)}
                      className="ghost"
                      disabled={pendingForDevice}
                    >
                      {expandedForDevice ? "Close" : "Assign"}
                    </button>
                    {(device.assignedEquipment?.roomId || device.assignedEquipment?.equipmentId) && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => handleUnassign(device)}
                        disabled={pendingForDevice}
                      >
                        Unassign
                      </button>
                    )}
                  </div>
                </div>
                {expandedForDevice && (
                  rooms.length > 0 && equipment.length > 0 ? (
                    <form className="device-manager__assign-form" onSubmit={handleSubmit}>
                      <label>
                        Room
                        <select value={assignment.roomId ?? ""} onChange={handleRoomChange} required>
                          <option value="">Select room</option>
                          {rooms.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Equipment
                        <select value={assignment.equipmentId ?? ""} onChange={handleEquipmentChange} required>
                          <option value="">Select equipment</option>
                          {equipment.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="device-manager__assign-form-actions">
                        <button type="submit" className="primary" disabled={pendingForDevice}>
                          Save assignment
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => toggleExpanded(device.device_id)}
                          disabled={pendingForDevice}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="device-manager__assign-form device-manager__assign-form--empty">
                      <p className="tiny">
                        Add rooms and equipment data to enable assignments.
                      </p>
                    </div>
                  )
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default DeviceManager;
