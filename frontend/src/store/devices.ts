import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type DeviceProtocol = "kasa" | "mqtt" | "switchbot" | "other";

export interface DeviceAssignment {
  roomId: string | null;
  equipmentId: string | null;
}

export interface Device {
  device_id: string;
  name: string;
  category: string;
  protocol: DeviceProtocol | string;
  online: boolean;
  capabilities: Record<string, unknown>;
  details: Record<string, unknown>;
  assignedEquipment: DeviceAssignment;
}

interface DeviceContextValue {
  devices: Device[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  assignDevice: (deviceId: string, assignment: DeviceAssignment) => Promise<Device>;
  unassignDevice: (deviceId: string) => Promise<Device>;
}

const DeviceContext = createContext<DeviceContextValue | undefined>(undefined);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const canonicalizeProtocol = (value: unknown): DeviceProtocol => {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "kasa" || normalized === "kasa-wifi" || normalized === "tplink" || normalized === "kasa_cloud") {
    return "kasa";
  }
  if (normalized === "mqtt" || normalized === "mqtt-tls" || normalized === "mqtt_tls") {
    return "mqtt";
  }
  if (normalized === "switchbot" || normalized === "switchbot-cloud" || normalized === "ble-switchbot") {
    return "switchbot";
  }
  return "other";
};

const normalizeCapabilities = (value: unknown): Record<string, unknown> => {
  if (!value) {
    return {};
  }
  if (Array.isArray(value)) {
    return value.reduce<Record<string, boolean>>((acc, entry) => {
      const key = typeof entry === "string" ? entry : String(entry);
      acc[key] = true;
      return acc;
    }, {});
  }
  if (isRecord(value)) {
    return value;
  }
  return { value };
};

const normalizeAssignment = (value: unknown): DeviceAssignment => {
  const direct = isRecord(value) ? value : null;
  const maybeContainer = !direct && value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const nestedAssigned = maybeContainer?.assignedEquipment;
  const nestedAssignment = maybeContainer?.assignment;
  const source =
    direct ?? (isRecord(nestedAssigned) ? nestedAssigned : null) ?? (isRecord(nestedAssignment) ? nestedAssignment : null);
  if (!source) {
    return { roomId: null, equipmentId: null };
  }
  const roomIdCandidate =
    typeof source.roomId === "string"
      ? source.roomId
      : typeof source.room === "string"
      ? source.room
      : typeof source.room_id === "string"
      ? source.room_id
      : null;
  const equipmentIdCandidate =
    typeof source.equipmentId === "string"
      ? source.equipmentId
      : typeof source.equipment === "string"
      ? source.equipment
      : typeof source.equipment_id === "string"
      ? source.equipment_id
      : null;
  const roomId = roomIdCandidate && roomIdCandidate.length > 0 ? roomIdCandidate : null;
  const equipmentId = equipmentIdCandidate && equipmentIdCandidate.length > 0 ? equipmentIdCandidate : null;
  return { roomId, equipmentId };
};

const normalizeDevice = (raw: unknown): Device => {
  const source = isRecord(raw) ? raw : {};

  const deviceIdCandidate =
    source.device_id ?? source.deviceId ?? source.id ?? source.uuid ?? source._id ?? "";
  const rawId = String(deviceIdCandidate ?? "").trim();

  const nameCandidate =
    source.name ?? source.deviceName ?? source.label ?? (rawId ? `Device ${rawId.slice(-6)}` : "");
  const rawName = String(nameCandidate ?? "").trim() || rawId || "";

  const categoryCandidate = source.category ?? source.type ?? source.deviceType ?? source.model ?? "device";
  const rawCategory = String(categoryCandidate ?? "device").trim() || "device";

  const protocolCandidate =
    source.protocol ?? source.transport ?? source.conn ?? source.connectivity ?? source.protocolType;
  const protocol = canonicalizeProtocol(protocolCandidate);

  const onlineValue = source.online ?? source.status ?? source.state;
  const online =
    typeof onlineValue === "boolean"
      ? onlineValue
      : String(onlineValue ?? "").toLowerCase() === "online" || Boolean(onlineValue);

  const capabilities = normalizeCapabilities(source.capabilities);

  const details: Record<string, unknown> = {
    ...(isRecord(source.details) ? source.details : {}),
  };

  const assignDetail = (key: string, ...values: unknown[]) => {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== "") {
        details[key] = value;
        break;
      }
    }
  };

  assignDetail("manufacturer", details.manufacturer, source.manufacturer, source.vendor);
  assignDetail("model", details.model, source.model, source.deviceModel, source.device_type);
  assignDetail("address", details.address, source.address, source.host, source.ip);
  assignDetail("lastSeen", details.lastSeen, source.lastSeen, source.updatedAt, source.last_seen);

  if (!details.raw) {
    details.raw = source;
  }

  const assignmentSource =
    source.assignedEquipment ?? source.assignment ?? (isRecord(source.assigned_equipment) ? source.assigned_equipment : null);

  return {
    device_id: rawId,
    name: rawName,
    category: rawCategory,
    protocol,
    online,
    capabilities,
    details,
    assignedEquipment: normalizeAssignment(assignmentSource),
  };
};

export const DeviceProvider: React.FC<React.PropsWithChildren<unknown>> = ({ children }) => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/devices");
      if (!response.ok) {
        throw new Error(`Failed to load devices (${response.status})`);
      }
      const payload = await response.json();
      const list: unknown[] = Array.isArray(payload?.devices) ? payload.devices : Array.isArray(payload) ? payload : [];
      setDevices(list.map((item: unknown) => normalizeDevice(item)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateAssignment = useCallback(
    async (deviceId: string, assignment: DeviceAssignment): Promise<Device> => {
      try {
        const response = await fetch(`/devices/${encodeURIComponent(deviceId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignedEquipment: assignment }),
        });
        if (!response.ok) {
          throw new Error(`Failed to update assignment (${response.status})`);
        }
        const body = await response
          .json()
          .catch(() => ({ device: { device_id: deviceId, assignedEquipment: assignment } }));
        const updated = normalizeDevice((body as Record<string, unknown>)?.device ?? body);
        setDevices((prev: Device[]) => {
          const next = prev.map((device: Device) => (device.device_id === updated.device_id ? updated : device));
          if (next.some((device: Device) => device.device_id === updated.device_id)) {
            return next;
          }
          return [...next, updated];
        });
        return updated;
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
    [setDevices]
  );

  const assignDevice = useCallback(
    (deviceId: string, assignment: DeviceAssignment) => updateAssignment(deviceId, assignment),
    [updateAssignment]
  );

  const unassignDevice = useCallback(
    (deviceId: string) => updateAssignment(deviceId, { roomId: null, equipmentId: null }),
    [updateAssignment]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<DeviceContextValue>(
    () => ({
      devices,
      loading,
      error,
      refresh,
      assignDevice,
      unassignDevice,
    }),
    [devices, loading, error, refresh, assignDevice, unassignDevice]
  );

  return React.createElement(DeviceContext.Provider, { value }, children);
};

export const useDevices = (): DeviceContextValue => {
  const context = useContext(DeviceContext);
  if (!context) {
    throw new Error("useDevices must be used within a DeviceProvider");
  }
  return context;
};
