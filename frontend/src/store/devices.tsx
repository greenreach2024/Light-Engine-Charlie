import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, PropsWithChildren } from "react";

export type DeviceProtocol = "kasa" | "mqtt" | "switchbot" | "other";

export interface Device {
  device_id: string;
  name: string;
  category: string;
  protocol: DeviceProtocol | string;
  online: boolean;
  capabilities: Record<string, unknown>;
  details: Record<string, unknown>;
  assignedEquipment?: string | null;
}

interface DeviceContextValue {
  devices: Device[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  assignDevice: (deviceId: string, equipmentId: string) => Promise<void>;
  unassignDevice: (deviceId: string) => Promise<void>;
}

const DeviceContext = createContext<DeviceContextValue | undefined>(undefined);

export const DeviceProvider: React.FC<PropsWithChildren> = ({ children }) => {
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
      const json = await response.json();
      const list: unknown = (json && json.devices) || json;
      if (!Array.isArray(list)) throw new Error("Malformed device payload");
      const mapped: Device[] = list.map((raw: any): Device => ({
        device_id: raw.device_id || raw.id || "",
        name: raw.name || raw.deviceName || raw.device_id || "Unnamed Device",
        category: raw.category || "device",
        protocol: raw.protocol || raw.transport || "other",
        online: raw.online !== undefined ? !!raw.online : true,
        capabilities: raw.capabilities || {},
        details: raw.details || {},
        assignedEquipment: raw.assignedEquipment ?? null,
      }));
      setDevices(mapped);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const assignDevice = useCallback(async (deviceId: string, equipmentId: string) => {
    await fetch(`/devices/${encodeURIComponent(deviceId)}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ equipmentId }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`Assign failed (${r.status})`);
      await refresh();
    });
  }, [refresh]);

  const unassignDevice = useCallback(async (deviceId: string) => {
    await fetch(`/devices/${encodeURIComponent(deviceId)}/assign`, { method: "DELETE" }).then(async (r) => {
      if (!r.ok) throw new Error(`Unassign failed (${r.status})`);
      await refresh();
    });
  }, [refresh]);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo<DeviceContextValue>(
    () => ({ devices, loading, error, refresh, assignDevice, unassignDevice }),
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
