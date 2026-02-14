import { getQuotaUsage, saveQuotaUsage } from './database.js';

const DAILY_BUDGET = 8000;    // Conservative budget (20% reserve of 10,000 hard limit)
const HARD_LIMIT = 10000;     // YouTube API daily hard limit
const WARNING_THRESHOLD = 6000; // Warn when usage exceeds this

/**
 * Get today's date string in Pacific timezone (YYYY-MM-DD).
 * YouTube API quota resets at midnight Pacific.
 * @returns {string}
 */
export function getPacificDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/**
 * Get how many units have been used today.
 * @returns {number}
 */
export function getUsedToday() {
  return getQuotaUsage(getPacificDate());
}

/**
 * Track quota usage for an operation.
 * @param {string} operation - Name of the API operation (for logging)
 * @param {number} units - Quota units consumed
 */
export function trackQuota(operation, units) {
  const date = getPacificDate();
  const current = getQuotaUsage(date);
  const newTotal = current + units;
  saveQuotaUsage(date, newTotal);
  console.log(`[quota] ${operation}: +${units} units (total: ${newTotal}/${DAILY_BUDGET})`);
}

/**
 * Check if we can afford to spend the given number of units.
 * @param {number} units - Units we want to spend
 * @param {{ hardLimit?: boolean }} [options] - Use hard limit (10,000) instead of budget (8,000)
 * @returns {boolean}
 */
export function canSpend(units, { hardLimit = false } = {}) {
  const used = getUsedToday();
  const cap = hardLimit ? HARD_LIMIT : DAILY_BUDGET;
  return (used + units) <= cap;
}

/**
 * Get full quota status for display.
 * @returns {{ used: number, budget: number, total: number, remaining: number, warning: boolean }}
 */
export function getStatus() {
  const used = getUsedToday();
  const remaining = Math.max(0, DAILY_BUDGET - used);
  return {
    used,
    budget: DAILY_BUDGET,
    total: HARD_LIMIT,
    remaining,
    warning: used >= WARNING_THRESHOLD,
  };
}
