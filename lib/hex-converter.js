/**
 * HEX Conversion Utilities for Grow3 Controller
 * Converts plan recipes (CW/WW/BL/RD percentages) to HEX12 format
 * 
 * Format: [CW][WW][BL][RD][00][00] where each channel is 2 hex digits
 * Example: "737373730000" = 45% on all channels (using 0x00-0xFF scale)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load channel scale configuration
 * Returns maxByte value (either 0xFF or 0x64)
 */
async function loadChannelScale() {
  try {
    const configPath = path.join(__dirname, '../config/channel-scale.json');
    const data = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(data);
    return config.maxByte || 0xFF; // Default to 0xFF if not specified
  } catch (error) {
    console.warn('[HEX Converter] Failed to load channel-scale.json, using default 0xFF:', error.message);
    return 0xFF;
  }
}

/**
 * Convert a single channel percentage to hex
 * @param {number} percent - Value from 0-100
 * @param {number} maxByte - Maximum byte value (0xFF or 0x64)
 * @returns {string} - 2-character hex string (e.g., "73")
 */
function percentToHex(percent, maxByte = 0xFF) {
  if (percent === null || percent === undefined || isNaN(percent)) {
    return '00';
  }
  
  // Clamp to 0-100
  const clamped = Math.max(0, Math.min(100, Number(percent)));
  
  // Calculate byte value
  const byteValue = Math.round((clamped / 100) * maxByte);
  
  // Convert to hex and pad
  return byteValue.toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Convert recipe object to HEX12 payload
 * @param {Object} recipe - Recipe with cw, ww, bl, rd properties (percentages)
 * @param {number} maxByte - Optional max byte value (auto-loaded if not provided)
 * @returns {Promise<string>} - HEX12 string (e.g., "737373730000")
 */
export async function recipeToHex(recipe, maxByte = null) {
  if (!recipe || typeof recipe !== 'object') {
    throw new Error('Invalid recipe: must be an object');
  }
  
  // Load maxByte if not provided
  if (maxByte === null) {
    maxByte = await loadChannelScale();
  }
  
  // Extract channel values (default to 0 if missing)
  const cw = recipe.cw ?? recipe.CW ?? 0;
  const ww = recipe.ww ?? recipe.WW ?? 0;
  const bl = recipe.bl ?? recipe.BL ?? recipe.blue ?? 0;
  const rd = recipe.rd ?? recipe.RD ?? recipe.red ?? 0;
  
  // Convert each channel
  const cwHex = percentToHex(cw, maxByte);
  const wwHex = percentToHex(ww, maxByte);
  const blHex = percentToHex(bl, maxByte);
  const rdHex = percentToHex(rd, maxByte);
  
  // Combine into HEX12 format
  return `${cwHex}${wwHex}${blHex}${rdHex}0000`;
}

/**
 * Calculate Days Post Seed (DPS) from seed date
 * @param {string|Date} seedDate - ISO date string or Date object
 * @param {Date} currentDate - Current date (defaults to now)
 * @returns {number} - Number of days since seed date
 */
export function calculateDPS(seedDate, currentDate = new Date()) {
  if (!seedDate) {
    throw new Error('Seed date is required');
  }
  
  const seed = new Date(seedDate);
  const current = new Date(currentDate);
  
  // Reset time to midnight for accurate day calculation
  seed.setHours(0, 0, 0, 0);
  current.setHours(0, 0, 0, 0);
  
  const diffMs = current - seed;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  return Math.max(0, diffDays); // Never negative
}

/**
 * Get current recipe from plan based on DPS or seed date
 * @param {Object} plan - Plan object with env.days array
 * @param {Object} config - Config with either dps or seedDate
 * @param {Date} currentDate - Current date (defaults to now)
 * @returns {Object|null} - Recipe for current day, or null if not found
 */
export function getCurrentRecipe(plan, config, currentDate = new Date()) {
  if (!plan?.env?.days || !Array.isArray(plan.env.days)) {
    throw new Error('Invalid plan: missing env.days array');
  }
  
  let dayIndex;
  
  if (config.anchorMode === 'dps' && typeof config.dps === 'number') {
    // Direct DPS mode
    dayIndex = config.dps;
  } else if (config.seedDate) {
    // Calculate from seed date
    dayIndex = calculateDPS(config.seedDate, currentDate);
  } else {
    throw new Error('Config must have either dps or seedDate');
  }
  
  // Handle cycle wrapping if needed
  const days = plan.env.days;
  if (dayIndex >= days.length) {
    // Loop back to start (some plans cycle)
    dayIndex = dayIndex % days.length;
  }
  
  return days[dayIndex] || null;
}

/**
 * Parse time string to minutes since midnight
 * @param {string} timeStr - Time in HH:MM format (e.g., "06:00")
 * @returns {number} - Minutes since midnight
 */
export function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return (hours * 60) + (minutes || 0);
}

/**
 * Check if schedule is currently active
 * @param {Object} schedule - Schedule object with cycles array
 * @param {Date} currentDate - Current date/time (defaults to now)
 * @returns {boolean} - True if schedule is active
 */
export function isScheduleActive(schedule, currentDate = new Date()) {
  if (!schedule?.cycles || !Array.isArray(schedule.cycles)) {
    return false;
  }
  
  const currentMinutes = currentDate.getHours() * 60 + currentDate.getMinutes();
  
  // Check if current time falls within any cycle
  for (const cycle of schedule.cycles) {
    if (!cycle.on || !cycle.off) continue;
    
    const onMinutes = timeToMinutes(cycle.on);
    const offMinutes = timeToMinutes(cycle.off);
    
    // Handle cycles that cross midnight
    if (offMinutes < onMinutes) {
      // e.g., on: 22:00, off: 06:00
      if (currentMinutes >= onMinutes || currentMinutes < offMinutes) {
        return true;
      }
    } else {
      // Normal case: e.g., on: 06:00, off: 22:00
      if (currentMinutes >= onMinutes && currentMinutes < offMinutes) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Create a safe default HEX payload (all channels at 45%)
 * @param {number} maxByte - Optional max byte value
 * @returns {Promise<string>} - Safe default HEX12 string
 */
export async function createSafeDefaultHex(maxByte = null) {
  const safeRecipe = { cw: 45, ww: 45, bl: 45, rd: 45 };
  return recipeToHex(safeRecipe, maxByte);
}

export default {
  recipeToHex,
  calculateDPS,
  getCurrentRecipe,
  isScheduleActive,
  timeToMinutes,
  createSafeDefaultHex
};
