import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

/** @type {Database.Database} */
let db;

/**
 * Initialize the database connection. Call once at startup.
 * @param {string} [dbPath='cache/videos.db'] - Path to the SQLite file, or ':memory:' for tests
 * @returns {Database.Database}
 */
export function initDatabase(dbPath = 'cache/videos.db') {
  if (db) return db;

  // Create directory for db file if it doesn't exist (skip for :memory:)
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      channel_id    TEXT PRIMARY KEY,
      channel_name  TEXT NOT NULL,
      thumbnail     TEXT DEFAULT '',
      uploads_playlist_id TEXT,
      last_checked  TEXT,
      backfill_complete INTEGER DEFAULT 0,
      next_page_token TEXT,
      total_results INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS videos (
      video_id     TEXT PRIMARY KEY,
      channel_id   TEXT NOT NULL REFERENCES channels(channel_id),
      title        TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      published    TEXT NOT NULL,
      thumbnail    TEXT,
      description  TEXT,
      duration     TEXT,
      views        INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);

    CREATE TABLE IF NOT EXISTS sessions (
      sid          TEXT PRIMARY KEY,
      tokens_json  TEXT NOT NULL,
      settings_json TEXT DEFAULT '{}',
      created_at   INTEGER NOT NULL,
      last_used    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quota_usage (
      date        TEXT PRIMARY KEY,
      units_used  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS auth_states (
      state       TEXT PRIMARY KEY,
      return_url  TEXT,
      expires_at  INTEGER NOT NULL
    );
  `);

  // Migrate: add thumbnail column to channels if missing (for existing DBs)
  try {
    db.exec('ALTER TABLE channels ADD COLUMN thumbnail TEXT DEFAULT \'\'');
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate: add fetch_error column to channels (skip broken channels on refresh)
  try {
    db.exec('ALTER TABLE channels ADD COLUMN fetch_error TEXT DEFAULT NULL');
  } catch (e) {
    // Column already exists — ignore
  }

  return db;
}

/**
 * Get the raw database instance. Throws if not initialized.
 * @returns {Database.Database}
 */
export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

/**
 * Close the database connection. Used in tests and graceful shutdown.
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = undefined;
  }
}

// ---------------------------------------------------------------------------
// Channel operations
// ---------------------------------------------------------------------------

/**
 * Insert or update a channel record.
 * @param {{ channelId: string, channelName: string, thumbnail?: string, uploadsPlaylistId?: string, lastChecked?: string, backfillComplete?: number, nextPageToken?: string, totalResults?: number }} data
 */
export function upsertChannel(data) {
  const stmt = getDb().prepare(`
    INSERT INTO channels (channel_id, channel_name, thumbnail, uploads_playlist_id, last_checked, backfill_complete, next_page_token, total_results)
    VALUES (@channelId, @channelName, @thumbnail, @uploadsPlaylistId, @lastChecked, @backfillComplete, @nextPageToken, @totalResults)
    ON CONFLICT(channel_id) DO UPDATE SET
      channel_name = COALESCE(@channelName, channels.channel_name),
      thumbnail = COALESCE(@thumbnail, channels.thumbnail),
      uploads_playlist_id = COALESCE(@uploadsPlaylistId, channels.uploads_playlist_id),
      last_checked = COALESCE(@lastChecked, channels.last_checked),
      backfill_complete = COALESCE(@backfillComplete, channels.backfill_complete),
      next_page_token = COALESCE(@nextPageToken, channels.next_page_token),
      total_results = COALESCE(@totalResults, channels.total_results)
  `);

  stmt.run({
    channelId: data.channelId,
    channelName: data.channelName,
    thumbnail: data.thumbnail || null,
    uploadsPlaylistId: data.uploadsPlaylistId || null,
    lastChecked: data.lastChecked || null,
    backfillComplete: data.backfillComplete ?? 0,
    nextPageToken: data.nextPageToken || null,
    totalResults: data.totalResults ?? 0,
  });
}

/**
 * Get a single channel by ID.
 * @param {string} channelId
 * @returns {object|undefined}
 */
export function getChannel(channelId) {
  return getDb().prepare('SELECT * FROM channels WHERE channel_id = ?').get(channelId);
}

/**
 * Mark a channel as having a fetch error (skip on future refreshes).
 * @param {string} channelId
 * @param {string} error
 */
export function setChannelError(channelId, error) {
  getDb().prepare('UPDATE channels SET fetch_error = ? WHERE channel_id = ?').run(error, channelId);
}

/**
 * Clear a channel's fetch error.
 * @param {string} channelId
 */
export function clearChannelError(channelId) {
  getDb().prepare('UPDATE channels SET fetch_error = NULL WHERE channel_id = ?').run(channelId);
}

/**
 * Get all video IDs for a channel (used for incremental refresh dedup).
 * @param {string} channelId
 * @returns {Set<string>}
 */
export function getChannelVideoIds(channelId) {
  const rows = getDb()
    .prepare('SELECT video_id FROM videos WHERE channel_id = ?')
    .all(channelId);
  return new Set(rows.map(r => r.video_id));
}

/**
 * Insert multiple videos in a single transaction. Skips duplicates (INSERT OR IGNORE).
 * @param {Array<{ videoId: string, channelId: string, title: string, channelName: string, published: string, thumbnail?: string, description?: string, duration?: string, views?: number }>} videos
 * @returns {{ inserted: number }} Number of rows actually inserted
 */
export function insertVideos(videos) {
  if (!videos || videos.length === 0) return { inserted: 0 };

  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO videos (video_id, channel_id, title, channel_name, published, thumbnail, description, duration, views)
    VALUES (@videoId, @channelId, @title, @channelName, @published, @thumbnail, @description, @duration, @views)
  `);

  const insertMany = getDb().transaction((videoList) => {
    let inserted = 0;
    for (const v of videoList) {
      const result = stmt.run({
        videoId: v.videoId,
        channelId: v.channelId,
        title: v.title,
        channelName: v.channelName,
        published: v.published,
        thumbnail: v.thumbnail || null,
        description: v.description || null,
        duration: v.duration || null,
        views: v.views ?? 0,
      });
      inserted += result.changes;
    }
    return { inserted };
  });

  return insertMany(videos);
}

/**
 * Update video metadata (duration, views) for enrichment.
 * @param {Array<{ videoId: string, duration?: string, views?: number }>} updates
 */
export function updateVideoMeta(updates) {
  if (!updates || updates.length === 0) return;

  const stmt = getDb().prepare(`
    UPDATE videos SET duration = @duration, views = @views WHERE video_id = @videoId
  `);

  const updateMany = getDb().transaction((list) => {
    for (const u of list) {
      stmt.run({
        videoId: u.videoId,
        duration: u.duration || null,
        views: u.views ?? 0,
      });
    }
  });

  updateMany(updates);
}

// ---------------------------------------------------------------------------
// Video queries
// ---------------------------------------------------------------------------

/**
 * Get recent videos ordered by published date descending.
 * Returns camelCase field names for frontend compatibility.
 * @param {number} [limit=2000] - Max rows to return (covers ~2 months of content)
 * @returns {Array<object>}
 */
export function getAllVideos(limit = 2000) {
  return getDb().prepare(`
    SELECT
      video_id AS videoId,
      channel_id AS channelId,
      title,
      channel_name AS channelName,
      published,
      thumbnail,
      SUBSTR(description, 1, 200) AS description,
      duration,
      views
    FROM videos
    ORDER BY published DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Get all channels.
 * Returns camelCase field names for frontend compatibility.
 * @returns {Array<object>}
 */
export function getAllChannels() {
  return getDb().prepare(`
    SELECT
      channel_id AS channelId,
      channel_name AS channelName,
      thumbnail,
      uploads_playlist_id AS uploadsPlaylistId,
      last_checked AS lastChecked,
      backfill_complete AS backfillComplete,
      next_page_token AS nextPageToken,
      total_results AS totalResults
    FROM channels
    ORDER BY channel_name COLLATE NOCASE
  `).all();
}

/**
 * Get channels that still need backfill (incomplete history).
 * Excludes channels with fetch errors.
 * @returns {Array<{ channelId: string, channelName: string, uploadsPlaylistId: string, nextPageToken: string|null, backfillComplete: number }>}
 */
export function getChannelsNeedingBackfill() {
  return getDb().prepare(`
    SELECT
      channel_id AS channelId,
      channel_name AS channelName,
      uploads_playlist_id AS uploadsPlaylistId,
      next_page_token AS nextPageToken,
      backfill_complete AS backfillComplete
    FROM channels
    WHERE backfill_complete = 0
      AND (fetch_error IS NULL OR fetch_error = '')
    ORDER BY channel_name COLLATE NOCASE
  `).all();
}

/**
 * Total number of videos in DB.
 * @returns {number}
 */
export function totalVideos() {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM videos').get();
  return row.count;
}

/**
 * Timestamp of the most recent channel check.
 * @returns {string|null}
 */
export function latestCheck() {
  const row = getDb()
    .prepare('SELECT MAX(last_checked) as latest FROM channels')
    .get();
  return row.latest || null;
}

// ---------------------------------------------------------------------------
// Session operations
// ---------------------------------------------------------------------------

/**
 * Get a session by session ID.
 * @param {string} sid
 * @returns {{ sid: string, tokens_json: string, settings_json: string, created_at: number, last_used: number }|undefined}
 */
export function getSession(sid) {
  return getDb().prepare('SELECT * FROM sessions WHERE sid = ?').get(sid);
}

/**
 * Create or update a session.
 * @param {string} sid
 * @param {object} tokens - OAuth tokens
 * @param {object} [settings={}] - User settings
 */
export function saveSession(sid, tokens, settings = {}) {
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO sessions (sid, tokens_json, settings_json, created_at, last_used)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(sid) DO UPDATE SET
      tokens_json = excluded.tokens_json,
      settings_json = excluded.settings_json,
      last_used = excluded.last_used
  `).run(sid, JSON.stringify(tokens), JSON.stringify(settings), now, now);
}

/**
 * Delete a session.
 * @param {string} sid
 */
export function destroySession(sid) {
  getDb().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
}

/**
 * Touch a session (update last_used timestamp).
 * @param {string} sid
 */
export function touchSession(sid) {
  getDb().prepare('UPDATE sessions SET last_used = ? WHERE sid = ?').run(Date.now(), sid);
}

// ---------------------------------------------------------------------------
// Quota operations
// ---------------------------------------------------------------------------

/**
 * Get quota usage for a given date string (YYYY-MM-DD).
 * @param {string} date
 * @returns {number} Units used
 */
export function getQuotaUsage(date) {
  const row = getDb().prepare('SELECT units_used FROM quota_usage WHERE date = ?').get(date);
  return row ? row.units_used : 0;
}

/**
 * Save quota usage for a given date.
 * @param {string} date
 * @param {number} units
 */
export function saveQuotaUsage(date, units) {
  getDb().prepare(`
    INSERT INTO quota_usage (date, units_used)
    VALUES (?, ?)
    ON CONFLICT(date) DO UPDATE SET units_used = excluded.units_used
  `).run(date, units);
}

// ---------------------------------------------------------------------------
// Auth state operations (CSRF tokens for OAuth flow)
// ---------------------------------------------------------------------------

/**
 * Save a pending OAuth state token.
 * @param {string} state
 * @param {string} returnUrl - Frontend origin to redirect back to
 * @param {number} expiresAt - Timestamp when this state expires
 */
export function saveAuthState(state, returnUrl, expiresAt) {
  getDb().prepare(`
    INSERT INTO auth_states (state, return_url, expires_at) VALUES (?, ?, ?)
  `).run(state, returnUrl, expiresAt);
}

/**
 * Get and delete a pending auth state (single use).
 * @param {string} state
 * @returns {{ state: string, return_url: string, expires_at: number }|undefined}
 */
export function consumeAuthState(state) {
  const row = getDb().prepare('SELECT * FROM auth_states WHERE state = ?').get(state);
  if (row) {
    getDb().prepare('DELETE FROM auth_states WHERE state = ?').run(state);
  }
  return row;
}

/**
 * Remove expired auth states.
 */
export function cleanExpiredAuthStates() {
  getDb().prepare('DELETE FROM auth_states WHERE expires_at < ?').run(Date.now());
}
