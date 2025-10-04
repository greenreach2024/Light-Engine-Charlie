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

const normalizeAssignment = (value: unknown): DeviceAssignment => {
  if (!isRecord(value)) {
    return { roomId: null, equipmentId: null };
  }
  const roomId = typeof value.roomId === "string" ? value.roomId : typeof value.room === "string" ? value.room : null;
  const equipmentId =
    typeof value.equipmentId === "string"
      ? value.equipmentId
      : typeof value.equipment === "string"
      ? value.equipment
      : null;
  return {
    roomId: roomId && roomId.length > 0 ? roomId : null,
    equipmentId: equipmentId && equipmentId.length > 0 ? equipmentId : null,
  };
};

const normalizeDevice = (raw: unknown): Device => {
  const source = isRecord(raw) ? raw : {};
  const rawId =
    typeof source.device_id === "string" && source.device_id.trim().length > 0
      ? source.device_id.trim()
      : typeof source.id === "string" && source.id.trim().length > 0
      ? source.id.trim()
      : "";
  const rawName =
    typeof source.name === "string" && source.name.trim().length > 0
      ? source.name.trim()
      : typeof source.deviceName === "string" && source.deviceName.trim().length > 0
      ? source.deviceName.trim()
      : rawId;
  const rawCategory =
    typeof source.category === "string" && source.category.trim().length > 0
      ? source.category.trim()
      : typeof source.type === "string" && source.type.trim().length > 0
      ? source.type.trim()
      : "device";
  const protocol =
    typeof source.protocol === "string" && source.protocol.trim().length > 0
      ? source.protocol.trim().toLowerCase()
      : typeof source.transport === "string" && source.transport.trim().length > 0
      ? source.transport.trim().toLowerCase()
      : "other";
  const online = typeof source.online === "boolean" ? source.online : Boolean(source.online);
  const capabilities = isRecord(source.capabilities) ? source.capabilities : {};
  const details = isRecord(source.details) ? source.details : {};

  return {
    device_id: rawId,
    name: rawName,
    category: rawCategory,
    protocol: protocol || "other",
    online,
    capabilities,
    details,
    assignedEquipment: normalizeAssignment(source.assignedEquipment),
  };
};

export const DeviceProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
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
      const list = Array.isArray(payload?.devices) ? payload.devices : Array.isArray(payload) ? payload : [];
      setDevices(list.map((item) => normalizeDevice(item)));
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
        setDevices((prev) => {
          const next = prev.map((device) => (device.device_id === updated.device_id ? updated : device));
          if (next.some((device) => device.device_id === updated.device_id)) {
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

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
};

export const useDevices = (): DeviceContextValue => {
  const context = useContext(DeviceContext);
  if (!context) {
    throw new Error("useDevices must be used within a DeviceProvider");
  }
  return context;
};
