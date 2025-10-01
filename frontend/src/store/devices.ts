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
      const payload: Device[] = await response.json();
      setDevices(payload);
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
