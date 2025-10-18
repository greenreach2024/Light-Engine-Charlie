/**
 * Schedule Executor - Automated Plan/Schedule Application for Grow3 Lights
 * 
 * This service runs continuously and applies lighting schedules to Grow3 controllers
 * based on configured plans, schedules, and group assignments.
 */

import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  recipeToHex, 
  getCurrentRecipe, 
  isScheduleActive,
  createSafeDefaultHex 
} from './hex-converter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ScheduleExecutor {
  constructor(options = {}) {
    this.interval = options.interval || 60000; // Default: 1 minute
    this.baseUrl = options.baseUrl || 'http://127.0.0.1:8091';
    this.grow3Target = options.grow3Target || 'http://192.168.2.80:3000';
    this.enabled = options.enabled !== false; // Default: enabled
    this.intervalId = null;
    this.isRunning = false;
    this.lastExecution = null;
    this.executionCount = 0;
    this.errorCount = 0;
    
    // Data directory for JSON files
    this.dataDir = options.dataDir || path.join(__dirname, '../public/data');
    
    // Device registry: maps light IDs to Grow3 controller device IDs
    this.deviceRegistry = options.deviceRegistry || {
      'F00001': 2,
      'F00002': 3,
      'F00003': 4,
      'F00004': 6,
      'F00005': 5
    };
    
    console.log('[ScheduleExecutor] Initialized with interval:', this.interval, 'ms');
    console.log('[ScheduleExecutor] Data directory:', this.dataDir);
  }
  
  /**
   * Start the executor service
   */
  start() {
    if (this.isRunning) {
      console.warn('[ScheduleExecutor] Already running');
      return;
    }
    
    if (!this.enabled) {
      console.log('[ScheduleExecutor] Disabled, not starting');
      return;
    }
    
    console.log('[ScheduleExecutor] Starting...');
    this.isRunning = true;
    
    // Execute immediately on start
    this.tick().catch(err => {
      console.error('[ScheduleExecutor] Initial tick failed:', err);
    });
    
    // Then run on interval
    this.intervalId = setInterval(() => {
      this.tick().catch(err => {
        console.error('[ScheduleExecutor] Tick failed:', err);
      });
    }, this.interval);
    
    console.log('[ScheduleExecutor] Started successfully');
  }
  
  /**
   * Stop the executor service
   */
  stop() {
    if (!this.isRunning) {
      console.warn('[ScheduleExecutor] Not running');
      return;
    }
    
    console.log('[ScheduleExecutor] Stopping...');
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    console.log('[ScheduleExecutor] Stopped');
  }
  
  /**
   * Main execution tick - called on interval
   */
  async tick() {
    if (!this.enabled || !this.isRunning) return;
    
    const startTime = Date.now();
    const now = new Date();
    
    try {
      console.log(`[ScheduleExecutor] Tick #${this.executionCount + 1} at ${now.toISOString()}`);
      
      // Load data
      const [groups, plans, schedules] = await Promise.all([
        this.loadGroups(),
        this.loadPlans(),
        this.loadSchedules()
      ]);
      
      console.log(`[ScheduleExecutor] Loaded ${groups.length} groups, ${plans.length} plans, ${schedules.length} schedules`);
      
      // Process each group
      const results = [];
      for (const group of groups) {
        try {
          const result = await this.processGroup(group, plans, schedules, now);
          if (result) results.push(result);
        } catch (error) {
          console.error(`[ScheduleExecutor] Failed to process group ${group.id}:`, error.message);
          this.errorCount++;
        }
      }
      
      this.lastExecution = now;
      this.executionCount++;
      
      const duration = Date.now() - startTime;
      console.log(`[ScheduleExecutor] Tick completed in ${duration}ms, processed ${results.length} groups`);
      
      return results;
      
    } catch (error) {
      console.error('[ScheduleExecutor] Tick failed:', error);
      this.errorCount++;
      throw error;
    }
  }
  
  /**
   * Process a single group
   */
  async processGroup(group, plans, schedules, now) {
    // Skip groups without plan or schedule
    if (!group.plan || !group.schedule) {
      return null;
    }
    
    // Skip groups without lights
    if (!group.lights || !Array.isArray(group.lights) || group.lights.length === 0) {
      return null;
    }
    
    // Find plan and schedule
    const plan = plans.find(p => p.id === group.plan || p.name === group.plan);
    const schedule = schedules.find(s => s.id === group.schedule || s.groupId === group.id);
    
    if (!plan) {
      console.warn(`[ScheduleExecutor] Plan ${group.plan} not found for group ${group.id}`);
      return null;
    }
    
    if (!schedule) {
      console.warn(`[ScheduleExecutor] Schedule ${group.schedule} not found for group ${group.id}`);
      return null;
    }
    
    // Check if schedule is active
    const active = isScheduleActive(schedule, now);
    
    console.log(`[ScheduleExecutor] Group ${group.id}: schedule ${active ? 'ACTIVE' : 'INACTIVE'}`);
    
    // Get current recipe based on plan config
    let recipe;
    try {
      recipe = getCurrentRecipe(plan, group.planConfig || {}, now);
    } catch (error) {
      console.error(`[ScheduleExecutor] Failed to get recipe for group ${group.id}:`, error.message);
      return null;
    }
    
    if (!recipe) {
      console.warn(`[ScheduleExecutor] No recipe found for group ${group.id}`);
      return null;
    }
    
    // Determine target state
    let hexPayload;
    let status;
    
    if (active) {
      // Schedule is active - apply recipe
      hexPayload = await recipeToHex(recipe);
      status = 'on';
    } else {
      // Schedule is inactive - turn off
      hexPayload = null;
      status = 'off';
    }
    
    console.log(`[ScheduleExecutor] Group ${group.id}: ${status.toUpperCase()} with payload ${hexPayload || 'null'}`);
    
    // Apply to all lights in group
    const deviceResults = [];
    for (const light of group.lights) {
      try {
        const result = await this.controlLight(light, status, hexPayload);
        deviceResults.push({ light: light.id, success: true, result });
      } catch (error) {
        console.error(`[ScheduleExecutor] Failed to control light ${light.id}:`, error.message);
        deviceResults.push({ light: light.id, success: false, error: error.message });
      }
    }
    
    return {
      group: group.id,
      plan: plan.name || plan.id,
      schedule: schedule.name || schedule.id,
      active,
      recipe: active ? recipe : null,
      hexPayload,
      devices: deviceResults,
      timestamp: now.toISOString()
    };
  }
  
  /**
   * Control a single light
   */
  async controlLight(light, status, hexPayload) {
    const lightId = light.id || light.deviceId || light.name;
    
    // Map light ID to Grow3 controller device ID
    const deviceId = this.deviceRegistry[lightId];
    
    if (!deviceId) {
      console.warn(`[ScheduleExecutor] Light ${lightId} not in device registry, skipping`);
      return null;
    }
    
    // Send command to Grow3 controller via proxy
    const url = `${this.baseUrl}/api/grow3/devicedatas/device/${deviceId}`;
    const payload = {
      status,
      value: hexPayload
    };
    
    console.log(`[ScheduleExecutor] PATCH ${url}`, payload);
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    
    const result = await response.json();
    return result;
  }
  
  /**
   * Load groups from JSON file
   */
  async loadGroups() {
    try {
      const filePath = path.join(this.dataDir, 'groups.json');
      const fileContent = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(fileContent);
      return data.groups || [];
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn('[ScheduleExecutor] groups.json not found, returning empty array');
        return [];
      }
      console.error('[ScheduleExecutor] Failed to load groups:', error);
      return [];
    }
  }
  
  /**
   * Load plans from JSON file
   */
  async loadPlans() {
    try {
      const filePath = path.join(this.dataDir, 'plans.json');
      const fileContent = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(fileContent);
      return data.plans || [];
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn('[ScheduleExecutor] plans.json not found, returning empty array');
        return [];
      }
      console.error('[ScheduleExecutor] Failed to load plans:', error);
      return [];
    }
  }
  
  /**
   * Load schedules from JSON file
   */
  async loadSchedules() {
    try {
      const filePath = path.join(this.dataDir, 'schedules.json');
      const fileContent = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(fileContent);
      return data.schedules || [];
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn('[ScheduleExecutor] schedules.json not found, returning empty array');
        return [];
      }
      console.error('[ScheduleExecutor] Failed to load schedules:', error);
      return [];
    }
  }
  
  /**
   * Get executor status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      running: this.isRunning,
      interval: this.interval,
      lastExecution: this.lastExecution,
      executionCount: this.executionCount,
      errorCount: this.errorCount,
      deviceRegistry: Object.keys(this.deviceRegistry).length
    };
  }
  
  /**
   * Update device registry
   */
  updateDeviceRegistry(registry) {
    this.deviceRegistry = { ...this.deviceRegistry, ...registry };
    console.log('[ScheduleExecutor] Device registry updated:', Object.keys(this.deviceRegistry).length, 'devices');
  }
}

export default ScheduleExecutor;
