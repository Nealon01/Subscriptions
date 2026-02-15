/**
 * Creates an in-memory SQLite database for testing.
 *
 * Uses the production initDatabase() function from server/services/database.js
 * with ':memory:' to get an identical schema without touching disk.
 *
 * IMPORTANT: The production database module uses a module-level singleton.
 * Each test suite should call createTestDatabase() in beforeEach and
 * closeTestDatabase() in afterEach to ensure isolation.
 */

import {
  initDatabase,
  closeDatabase,
  upsertChannel,
  getChannel,
  getChannelVideoIds,
  insertVideos,
  updateVideoMeta,
  getAllVideos,
  getAllChannels,
  totalVideos,
  latestCheck,
  getSession,
  saveSession,
  destroySession,
  touchSession,
  getQuotaUsage,
  saveQuotaUsage,
  searchVideos,
  rebuildFtsIndex,
} from '../../server/services/database.js';

/**
 * Initialize a fresh in-memory database using the production schema.
 * Returns the raw db instance plus all exported database functions.
 *
 * @returns {{ db: import('better-sqlite3').Database, upsertChannel: Function, getChannel: Function, getChannelVideoIds: Function, insertVideos: Function, updateVideoMeta: Function, getAllVideos: Function, getAllChannels: Function, totalVideos: Function, latestCheck: Function, getSession: Function, saveSession: Function, destroySession: Function, touchSession: Function, getQuotaUsage: Function, saveQuotaUsage: Function }}
 */
export function createTestDatabase() {
  // Close any existing connection first (production uses a singleton)
  closeDatabase();

  const db = initDatabase(':memory:');

  return {
    db,
    upsertChannel,
    getChannel,
    getChannelVideoIds,
    insertVideos,
    updateVideoMeta,
    getAllVideos,
    getAllChannels,
    totalVideos,
    latestCheck,
    getSession,
    saveSession,
    destroySession,
    touchSession,
    getQuotaUsage,
    saveQuotaUsage,
    searchVideos,
    rebuildFtsIndex,
  };
}

/**
 * Close the test database and release the singleton.
 * Call this in afterEach to ensure test isolation.
 */
export function closeTestDatabase() {
  closeDatabase();
}
