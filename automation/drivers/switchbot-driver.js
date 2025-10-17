// SwitchBot Driver for PlugManager
// Loads real SwitchBot devices via API

import fetch from 'node-fetch';
import crypto from 'crypto';

class SwitchBotDriver {
  constructor(config) {
    this.token = config.token;
    this.secret = config.secret;
    this.apiBase = config.apiBase || 'https://api.switch-bot.com/v1.1';
  }

  async getDevices(refresh = false) {
    const url = `${this.apiBase}/devices${refresh ? '?refresh=1' : ''}`;
    const headers = this._getAuthHeaders();
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`SwitchBot API error: ${response.status}`);
    const data = await response.json();
    if (data.statusCode === 100 && data.body && data.body.deviceList) {
      return data.body.deviceList;
    }
    throw new Error('No deviceList in SwitchBot response');
  }

  _getAuthHeaders() {
    const t = Date.now().toString();
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const strToSign = this.token + t + nonce;
    const sign = crypto.createHmac('sha256', this.secret)
      .update(strToSign, 'utf8')
      .digest('base64');

    return {
      'Authorization': this.token,
      't': t,
      'sign': sign,
      'nonce': nonce,
      'Content-Type': 'application/json',
      'charset': 'utf8'
    };
  }

  vendor() {
    return 'switchbot';
  }

  async discover() {
    try {
      const devices = await this.getDevices(true); // Force refresh
      return devices.map(device => ({
        id: device.deviceId,
        name: device.deviceName || 'SwitchBot Device',
        model: device.deviceType,
        vendor: this.vendor(),
        hubId: device.hubDeviceId,
        online: true, // SwitchBot API only returns online devices
        data: device
      }));
    } catch (error) {
      console.error('[switchbot] Discovery failed:', error);
      return []; // Return empty array on error to match driver interface
    }
  }
}

export default SwitchBotDriver;
