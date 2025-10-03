/* 
IMPLEMENTATION GUIDE 3: Enhanced DeviceManager Component
=====================================================

File: frontend/src/components/DeviceManager.tsx

Key enhancements:
1. Assignment form with room/equipment dropdowns
2. Toast notifications for success/error states
3. Expanded device cards with assignment status
4. Filtering by assignment status
5. Bulk operations support

Enhanced Component Structure:
*/

/*
Class Names to Add to CSS:

.device-manager {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.device-manager__filters {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 1rem;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.device-manager__assign-form {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
}

.device-manager__assign-form h3 {
  margin: 0 0 1rem 0;
  color: var(--text-primary);
}

.device-manager__form-row {
  display: flex;
  gap: 1rem;
  align-items: end;
  flex-wrap: wrap;
}

.device-manager__form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 200px;
}

.device-manager__form-group label {
  font-weight: 500;
  color: var(--text-secondary);
}

.device-manager__select {
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.device-manager__assign-btn {
  padding: 0.5rem 1rem;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
}

.device-manager__assign-btn:hover {
  background: var(--accent-hover);
}

.device-manager__assign-btn:disabled {
  background: var(--border);
  cursor: not-allowed;
}

.device-card {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: start;
}

.device-card__info {
  flex: 1;
}

.device-card__name {
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
}

.device-card__details {
  font-size: 0.875rem;
  color: var(--text-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.device-card__assignments {
  margin-top: 0.5rem;
}

.device-card__assignment-tag {
  display: inline-block;
  background: var(--accent-light);
  color: var(--accent);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  margin-right: 0.5rem;
  margin-bottom: 0.25rem;
}

.device-card__actions {
  display: flex;
  gap: 0.5rem;
}

.device-card__status {
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.device-card__status--online {
  background: var(--success-light);
  color: var(--success);
}

.device-card__status--offline {
  background: var(--error-light);
  color: var(--error);
}

.toast {
  position: fixed;
  top: 1rem;
  right: 1rem;
  padding: 1rem;
  border-radius: 4px;
  color: white;
  font-weight: 500;
  z-index: 1000;
  animation: slideIn 0.3s ease-out;
}

.toast--success {
  background: var(--success);
}

.toast--error {
  background: var(--error);
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
*/

/*
Enhanced DeviceManager Component Logic:

Key Props Interface:
*/

interface DeviceManagerProps {
  onDeviceSelect?: (device: Device) => void;
  showAssignmentForm?: boolean;
  allowBulkOperations?: boolean;
  filterByRoom?: string;
  filterByProtocol?: string;
}

/*
Key State Management:

const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
const [showAssignForm, setShowAssignForm] = useState(false);
const [selectedRoom, setSelectedRoom] = useState('');
const [selectedEquipment, setSelectedEquipment] = useState('');
const [toast, setToast] = useState<{message: string, type: 'success'|'error'} | null>(null);

Key Methods:

const handleDeviceAssignment = async (deviceId: string, equipmentId: string) => {
  const device = devices.find(d => d.device_id === deviceId);
  const isAssigned = device?.assignedEquipment.includes(equipmentId) || false;
  
  const result = await handleAssignment(deviceId, equipmentId, isAssigned);
  
  if (result.success) {
    showToast(`Device ${isAssigned ? 'unassigned from' : 'assigned to'} equipment successfully`, 'success');
  } else {
    showToast(result.error || 'Assignment failed', 'error');
  }
};

const handleBulkAssignment = async () => {
  if (!selectedEquipment || selectedDevices.length === 0) return;
  
  const results = await Promise.allSettled(
    selectedDevices.map(deviceId => 
      handleAssignment(deviceId, selectedEquipment, false)
    )
  );
  
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.length - successful;
  
  if (failed === 0) {
    showToast(`${successful} devices assigned successfully`, 'success');
  } else {
    showToast(`${successful} succeeded, ${failed} failed`, 'error');
  }
  
  setSelectedDevices([]);
  setShowAssignForm(false);
};

const showToast = (message: string, type: 'success' | 'error') => {
  setToast({ message, type });
  setTimeout(() => setToast(null), 3000);
};

Filter Logic:

const filteredDevices = devices.filter(device => {
  if (filterByRoom && device.details.room !== filterByRoom) return false;
  if (filterByProtocol && device.protocol !== filterByProtocol) return false;
  return true;
});

Assignment Form JSX:

{showAssignmentForm && (
  <div className="device-manager__assign-form">
    <h3>Assign Equipment to Devices</h3>
    <div className="device-manager__form-row">
      <div className="device-manager__form-group">
        <label>Room</label>
        <select 
          value={selectedRoom} 
          onChange={(e) => setSelectedRoom(e.target.value)}
          className="device-manager__select"
        >
          <option value="">All Rooms</option>
          {rooms.map(room => (
            <option key={room.id} value={room.id}>{room.name}</option>
          ))}
        </select>
      </div>
      
      <div className="device-manager__form-group">
        <label>Equipment</label>
        <select 
          value={selectedEquipment} 
          onChange={(e) => setSelectedEquipment(e.target.value)}
          className="device-manager__select"
        >
          <option value="">Select Equipment</option>
          {equipment.map(item => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </div>
      
      <button 
        onClick={handleBulkAssignment}
        disabled={!selectedEquipment || selectedDevices.length === 0}
        className="device-manager__assign-btn"
      >
        Assign to {selectedDevices.length} Device(s)
      </button>
    </div>
  </div>
)}

Enhanced Device Card JSX:

<div key={device.device_id} className="device-card">
  <div className="device-card__info">
    <div className="device-card__name">{device.name}</div>
    <div className="device-card__details">
      <span>Protocol: {device.protocol}</span>
      <span>Category: {device.category}</span>
      {device.details.watts && <span>Power: {device.details.watts}W</span>}
      <span>Room: {device.details.room || 'Unassigned'}</span>
    </div>
    
    {device.assignedEquipment.length > 0 && (
      <div className="device-card__assignments">
        {device.assignedEquipment.map(equipId => (
          <span key={equipId} className="device-card__assignment-tag">
            {getEquipmentName(equipId)}
          </span>
        ))}
      </div>
    )}
  </div>
  
  <div className="device-card__actions">
    <span className={`device-card__status device-card__status--${device.online ? 'online' : 'offline'}`}>
      {device.online ? 'Online' : 'Offline'}
    </span>
    
    {allowBulkOperations && (
      <input 
        type="checkbox"
        checked={selectedDevices.includes(device.device_id)}
        onChange={(e) => {
          if (e.target.checked) {
            setSelectedDevices(prev => [...prev, device.device_id]);
          } else {
            setSelectedDevices(prev => prev.filter(id => id !== device.device_id));
          }
        }}
      />
    )}
  </div>
</div>

Toast Component JSX:

{toast && (
  <div className={`toast toast--${toast.type}`}>
    {toast.message}
  </div>
)}
*/