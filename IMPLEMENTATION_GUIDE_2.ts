/* 
IMPLEMENTATION GUIDE 2: Enhanced React Device Store
================================================

File: frontend/src/store/devices.ts

This guide shows the enhanced Device interface and store pattern for Light Engine Charlie V2.
Key changes:
1. Enhanced Device interface with assignedEquipment field
2. Assignment actions (assignDevice, unassignDevice)
3. Better error handling and loading states
4. Utility hooks for common operations

Enhanced Device Interface:
*/

export interface Device {
  device_id: string;
  name: string;
  category: 'lighting' | 'switch' | 'sensor' | 'climate' | 'other' | 'unknown';
  protocol: 'kasa' | 'mqtt' | 'switchbot' | 'other';
  online: boolean;
  capabilities: {
    power?: boolean;
    spectrum?: boolean;
    remote?: boolean;
  };
  details: {
    manufacturer: string;
    model: string;
    serial: string;
    watts?: number;
    spectrumMode?: string;
    farm: string;
    room: string;
    zone: string;
    module: string;
    level: string;
    side: string;
    [key: string]: any;
  };
  assignedEquipment: string[]; // NEW: Equipment assignments
}

/*
Enhanced DeviceStore Interface:
*/

export interface DeviceStore {
  devices: Device[];
  loading: boolean;
  error: string | null;
  refreshDevices: () => Promise<void>;
  assignDevice: (deviceId: string, equipmentId: string) => Promise<void>;    // NEW
  unassignDevice: (deviceId: string, equipmentId: string) => Promise<void>;  // NEW
  updateDeviceDetails: (deviceId: string, updates: Partial<Device['details']>) => Promise<void>; // NEW
}

/*
Key Implementation Notes:

1. Assignment Methods:
   - POST /api/devices/{deviceId}/assign with {equipmentId}
   - POST /api/devices/{deviceId}/unassign with {equipmentId}
   - Update local state optimistically, then refresh

2. Response Format Handling:
   - Handle both {devices: [...]} and [...] formats
   - Graceful fallback for malformed responses

3. Error Handling:
   - Store errors in state for UI display
   - Throw errors from assignment methods for component handling

4. Utility Hooks:
   - useDeviceAssignment for toggle operations
   - Standardized success/error return format

Example Usage in Components:

const { devices, assignDevice, unassignDevice, loading, error } = useDevices();
const { handleAssignment } = useDeviceAssignment();

// Toggle assignment
const result = await handleAssignment(deviceId, equipmentId, isCurrentlyAssigned);
if (result.success) {
  // Show success toast
} else {
  // Show error toast with result.error
}
*/