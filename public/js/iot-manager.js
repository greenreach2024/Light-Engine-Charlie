// IoT Devices Manager
class IoTDevicesManager {
  constructor() {
    this.devices = [];
    this.scanning = false;
    this.templateContent = document.getElementById('iot-device-template').content;
    this.deviceGroups = document.querySelectorAll('.iot-device-group');
    this.loadingState = document.querySelector('.iot-loading-state');
    
    // Initialize
    this.init();
  }

  async init() {
    // Setup event listeners
    document.getElementById('scanDevicesBtn').addEventListener('click', () => this.scanDevices());
    
    // Load initial device list
    await this.loadDevices();
    
    // Setup room/zone data from farm registration
    await this.setupAssignmentData();
  }

  async loadDevices() {
    try {
      const response = await fetch('/iot/devices');
      const data = await response.json();
      this.devices = data.devices;
      this.renderDevices();
    } catch (error) {
      console.error('Failed to load IoT devices:', error);
      // TODO: Show error state
    }
  }

  async scanDevices() {
    if (this.scanning) return;
    
    this.scanning = true;
    this.loadingState.hidden = false;
    document.getElementById('scanDevicesBtn').disabled = true;
    
    try {
      const response = await fetch('/iot/devices/scan', { method: 'POST' });
      const data = await response.json();
      this.devices = data.devices;
      this.renderDevices();
    } catch (error) {
      console.error('Device scan failed:', error);
      // TODO: Show error state
    } finally {
      this.scanning = false;
      this.loadingState.hidden = true;
      document.getElementById('scanDevicesBtn').disabled = false;
    }
  }

  async setupAssignmentData() {
    // Load room/zone data from farm registration
    try {
      const [roomsResponse, zonesResponse] = await Promise.all([
        fetch('/farm/rooms'),
        fetch('/farm/zones')
      ]);
      
      const rooms = await roomsResponse.json();
      const zones = await zonesResponse.json();
      
      this.roomOptions = rooms.map(room => ({
        value: room.id,
        label: room.name
      }));
      
      this.zoneOptions = zones.map(zone => ({
        value: zone.id,
        label: zone.name
      }));
    } catch (error) {
      console.error('Failed to load assignment data:', error);
    }
  }

  createDeviceElement(device) {
    const element = this.templateContent.cloneNode(true);
    const card = element.querySelector('.iot-device-card');
    
    // Set device info
    card.querySelector('.device-name').textContent = device.name;
    card.querySelector('.device-type').textContent = device.type;
    card.querySelector('.device-id').textContent = `ID: ${device.id}`;
    card.querySelector('.device-last-seen').textContent = 
      `Last seen: ${new Date(device.lastSeen).toLocaleString()}`;
    
    // Setup assignment dropdowns
    const roomSelect = card.querySelector('.room-select');
    const zoneSelect = card.querySelector('.zone-select');
    
    // Populate room options
    this.roomOptions.forEach(option => {
      const optionEl = document.createElement('option');
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      if (device.room === option.value) optionEl.selected = true;
      roomSelect.appendChild(optionEl);
    });
    
    // Populate zone options
    this.zoneOptions.forEach(option => {
      const optionEl = document.createElement('option');
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      if (device.zone === option.value) optionEl.selected = true;
      zoneSelect.appendChild(optionEl);
    });
    
    // Setup event listeners
    roomSelect.addEventListener('change', () => this.updateDevice(device.id, { room: roomSelect.value }));
    zoneSelect.addEventListener('change', () => this.updateDevice(device.id, { zone: zoneSelect.value }));
    
    card.querySelector('.setup-device').addEventListener('click', () => this.setupDevice(device));
    card.querySelector('.remove-device').addEventListener('click', () => this.removeDevice(device.id));
    
    return card;
  }

  renderDevices() {
    // Clear existing devices
    this.deviceGroups.forEach(group => {
      group.querySelector('.device-list').innerHTML = '';
      group.querySelector('.device-count').textContent = '(0)';
    });
    
    // Group devices by protocol
    const grouped = this.devices.reduce((acc, device) => {
      const protocol = device.protocol || 'unknown';
      if (!acc[protocol]) acc[protocol] = [];
      acc[protocol].push(device);
      return acc;
    }, {});
    
    // Render each group
    Object.entries(grouped).forEach(([protocol, devices]) => {
      const group = document.querySelector(`.iot-device-group[data-protocol="${protocol}"]`);
      if (!group) return;
      
      const list = group.querySelector('.device-list');
      devices.forEach(device => {
        list.appendChild(this.createDeviceElement(device));
      });
      
      group.querySelector('.device-count').textContent = `(${devices.length})`;
    });
  }

  async updateDevice(deviceId, updates) {
    try {
      const response = await fetch(`/iot/devices/${deviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      
      if (!response.ok) throw new Error('Failed to update device');
      
      // Update local device data
      const updatedDevice = await response.json();
      this.devices = this.devices.map(d => 
        d.id === deviceId ? updatedDevice : d
      );
      
      // Re-render devices
      this.renderDevices();
    } catch (error) {
      console.error('Failed to update device:', error);
      // TODO: Show error state
    }
  }

  async removeDevice(deviceId) {
    if (!confirm('Are you sure you want to remove this device?')) return;
    
    try {
      const response = await fetch(`/iot/devices/${deviceId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) throw new Error('Failed to remove device');
      
      // Update local device data
      this.devices = this.devices.filter(d => d.id !== deviceId);
      
      // Re-render devices
      this.renderDevices();
    } catch (error) {
      console.error('Failed to remove device:', error);
      // TODO: Show error state
    }
  }

  async setupDevice(device) {
    // Launch appropriate setup wizard based on protocol
    const wizardId = `${device.protocol}-setup`;
    if (window.SetupWizard && window.SetupWizard.launch) {
      window.SetupWizard.launch(wizardId, {
        deviceId: device.id,
        deviceMetadata: device.config
      });
    }
  }
}

// Initialize IoT Devices Manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.iotManager = new IoTDevicesManager();
});