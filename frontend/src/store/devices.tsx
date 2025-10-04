import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type DeviceProtocol = "kasa" | "mqtt" | "switchbot" | "other";

export interface Device {
  device_id: string;
  name: string;
  category: string;
  protocol: DeviceProtocol | string;
  online: boolean;
  capabilities: Record<string, unknown>;
  details: Record<string, unknown>;
}

interface DeviceContextValue {
  devices: Device[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const DeviceContext = createContext<DeviceContextValue | undefined>(undefined);

export const DeviceProvider: React.FC<React.PropsWithChildren> = ({ children }: React.PropsWithChildren) => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Helpers to normalize backend payloads to our Device shape
  const canonicalizeProtocol = (p: unknown): DeviceProtocol => {
    const v = String(p || '').toLowerCase();
    if (v === 'kasa' || v === 'kasa-wifi' || v === 'tplink' || v === 'kasa_cloud') return 'kasa';
    if (v === 'mqtt' || v === 'mqtt-tls' || v === 'mqtt_tls') return 'mqtt';
    if (v === 'switchbot' || v === 'switchbot-cloud' || v === 'ble-switchbot') return 'switchbot';
    return 'other';
  };

  const normalizeCapabilities = (c: any): Record<string, unknown> => {
    if (!c) return {};
    if (Array.isArray(c)) {
      // Convert array of capability names into an object with boolean flags
      return c.reduce((acc: Record<string, boolean>, key: any) => {
        const k = typeof key === 'string' ? key : String(key);
        acc[k] = true;
        return acc;
      }, {});
    }
    if (typeof c === 'object') return c as Record<string, unknown>;
    return { value: c } as Record<string, unknown>;
  };

  const toDevice = (row: any): Device => {
    const device_id = (
      row?.device_id ?? row?.id ?? row?.deviceId ?? row?.uuid ?? row?._id ?? ''
    );
    const name = (
      row?.name ?? row?.deviceName ?? row?.label ?? `Device ${String(device_id || '').slice(-6)}`
    );
    const category = (
      row?.category ?? row?.type ?? row?.deviceType ?? row?.model ?? 'device'
    );
    const protocol = canonicalizeProtocol(row?.protocol ?? row?.transport ?? row?.conn ?? row?.connectivity);
    const onlineVal = row?.online ?? row?.status ?? row?.state;
    const online = typeof onlineVal === 'boolean' ? onlineVal : String(onlineVal || '').toLowerCase() === 'online';
    const capabilities = normalizeCapabilities(row?.capabilities);
    const details = {
      // Preserve common useful fields if present
      manufacturer: row?.manufacturer ?? row?.vendor ?? undefined,
      model: row?.model ?? row?.deviceModel ?? undefined,
      address: row?.address ?? row?.host ?? row?.ip ?? undefined,
      lastSeen: row?.lastSeen ?? row?.updatedAt ?? row?.last_seen ?? undefined,
      raw: row,
    } as Record<string, unknown>;

    return { device_id: String(device_id), name: String(name), category: String(category), protocol, online, capabilities, details };
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/devices");
      if (!response.ok) {
        throw new Error(`Failed to load devices (${response.status})`);
      }
      const payload: unknown = await response.json();
      // Support both { devices: [...] } and [...] shapes
      const rawList: any[] = Array.isArray(payload)
        ? (payload as any[])
        : Array.isArray((payload as any)?.devices)
          ? ((payload as any).devices as any[])
          : [];
      const mapped = rawList.map(toDevice);
      setDevices(mapped);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<DeviceContextValue>(
    () => ({
      devices,
      loading,
      error,
      refresh,
    }),
    [devices, loading, error, refresh]
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

export default DeviceProvider;
