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

  // FTS5 full-text search index on videos
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS videos_fts USING fts5(
      title, channel_name, description,
      content='videos', content_rowid='rowid',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS videos_ai AFTER INSERT ON videos BEGIN
      INSERT INTO videos_fts(rowid, title, channel_name, description)
      VALUES (new.rowid, new.title, new.channel_name, new.description);
    END;

    CREATE TRIGGER IF NOT EXISTS videos_ad AFTER DELETE ON videos BEGIN
      INSERT INTO videos_fts(videos_fts, rowid, title, channel_name, description)
      VALUES('delete', old.rowid, old.title, old.channel_name, old.description);
    END;

    CREATE TRIGGER IF NOT EXISTS videos_au AFTER UPDATE ON videos BEGIN
      INSERT INTO videos_fts(videos_fts, rowid, title, channel_name, description)
      VALUES('delete', old.rowid, old.title, old.channel_name, old.description);
      INSERT INTO videos_fts(rowid, title, channel_name, description)
      VALUES (new.rowid, new.title, new.channel_name, new.description);
    END;
  `);

  // Auto-populate FTS index if videos exist but index is empty.
  // NOTE: With content='videos', COUNT(*) on the FTS table returns the content table
  // row count, NOT the actual index size. We test with a real MATCH query instead.
  const videoCount = db.prepare('SELECT COUNT(*) as c FROM videos').get().c;
  if (videoCount > 0) {
    let needsRebuild = false;
    try {
      const sample = db.prepare('SELECT title FROM videos LIMIT 1').get();
      const word = sample?.title?.match(/[\p{L}\p{N}]+/u)?.[0];
      if (word) {
        const hits = db.prepare('SELECT COUNT(*) as c FROM videos_fts WHERE videos_fts MATCH ?').get(word + '*').c;
        needsRebuild = hits === 0;
      }
    } catch {
      needsRebuild = true;
    }
    if (needsRebuild) {
      console.log(`[database] FTS index empty — rebuilding for ${videoCount} existing videos...`);
      db.exec(`INSERT INTO videos_fts(videos_fts) VALUES('rebuild')`);
      console.log('[database] FTS index rebuild complete');
    }
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
// Full-text search
// ---------------------------------------------------------------------------

/**
 * Field prefix aliases → FTS5 column names.
 * Usage: title:cheese, channel:"Winter Starcraft", desc:tutorial
 */
const FIELD_MAP = {
  'title': 'title', 't': 'title',
  'channel': 'channel_name', 'ch': 'channel_name',
  'description': 'description', 'desc': 'description',
};

/**
 * Sanitize user input for FTS5 query syntax.
 *
 * Supported syntax:
 *   word          — prefix match (word*)
 *   "exact phrase" — phrase match
 *   title:word    — field-specific prefix match
 *   channel:"phrase" — field-specific phrase match
 *
 * Field aliases: title/t, channel/ch, description/desc
 *
 * @param {string} query - Raw user input
 * @returns {string} FTS5-safe query string
 */
function sanitizeFtsQuery(query) {
  if (!query || !query.trim()) return '';

  const tokens = [];
  // Match: field:"phrase" | "phrase" | non-whitespace token
  const regex = /(\w+):"([^"]*)"|"([^"]*)"|\S+/g;
  let match;
  const FTS5_KEYWORDS = new Set(['AND', 'OR', 'NOT', 'NEAR']);

  while ((match = regex.exec(query)) !== null) {
    if (match[1] !== undefined && match[2] !== undefined) {
      // Field-specific quoted phrase: title:"diamond in the ruff"
      const field = FIELD_MAP[match[1].toLowerCase()];
      const phrase = match[2].trim();
      if (field && phrase) {
        tokens.push(field + ' : "' + phrase.replace(/"/g, '""') + '"');
      } else if (phrase) {
        // Unknown field prefix — treat the whole thing as a quoted phrase
        tokens.push('"' + phrase.replace(/"/g, '""') + '"');
      }
    } else if (match[3] !== undefined) {
      // Standalone quoted phrase: "diamond in the ruff"
      const phrase = match[3].trim();
      if (phrase) {
        tokens.push('"' + phrase.replace(/"/g, '""') + '"');
      }
    } else {
      const raw = match[0];
      const colonIdx = raw.indexOf(':');

      // Field-specific bare word: channel:PiG
      if (colonIdx > 0 && colonIdx < raw.length - 1) {
        const prefix = raw.substring(0, colonIdx);
        const field = FIELD_MAP[prefix.toLowerCase()];
        if (field) {
          const value = raw.substring(colonIdx + 1);
          const parts = value.replace(/[^\p{L}\p{M}\p{N}]/gu, ' ').trim().split(/\s+/);
          for (const part of parts) {
            if (part) tokens.push(field + ' : ' + part + '*');
          }
          continue;
        }
      }

      // Regular bare word — prefix match
      const parts = raw.replace(/[^\p{L}\p{M}\p{N}]/gu, ' ').trim().split(/\s+/);
      for (const part of parts) {
        if (!part) continue;
        if (FTS5_KEYWORDS.has(part.toUpperCase())) {
          tokens.push('"' + part + '"');
        } else {
          tokens.push(part + '*');
        }
      }
    }
  }

  return tokens.join(' ');
}

/**
 * Parse ISO 8601 duration to total minutes.
 * PT4M13S -> 4.22, PT1H2M3S -> 62.05
 * @param {string} isoDuration
 * @returns {number|null}
 */
function parseDurationMinutes(isoDuration) {
  if (!isoDuration) return null;
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 60 + minutes + seconds / 60;
}

/**
 * Full-text search on videos using FTS5.
 * @param {{ query: string, timeRange?: string, durationFilter?: { min: number, max: number }, sort?: 'date'|'relevance', limit?: number, offset?: number }} params
 * @returns {{ results: Array<object>, total: number }}
 */
export function searchVideos({ query, timeRange = 'all', durationFilter, sort = 'date', limit = 30, offset = 0 }) {
  const ftsQuery = sanitizeFtsQuery(query);
  if (!ftsQuery) return { results: [], total: 0 };

  const whereClauses = [];
  const params = { query: ftsQuery };

  // Time range filter
  if (timeRange !== 'all') {
    whereClauses.push('v.published >= @cutoff');
    const now = new Date();
    if (timeRange === 'today') {
      params.cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    } else if (timeRange === 'week') {
      params.cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (timeRange === 'month') {
      params.cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }
  }

  const whereStr = whereClauses.length > 0 ? 'AND ' + whereClauses.join(' AND ') : '';

  const countSql = `
    SELECT COUNT(*) as total
    FROM videos_fts
    JOIN videos v ON v.rowid = videos_fts.rowid
    WHERE videos_fts MATCH @query
    ${whereStr}
  `;

  const resultSql = `
    SELECT
      v.video_id AS videoId,
      v.channel_id AS channelId,
      v.title,
      v.channel_name AS channelName,
      v.published,
      v.thumbnail,
      SUBSTR(v.description, 1, 200) AS description,
      v.duration,
      v.views,
      rank
    FROM videos_fts
    JOIN videos v ON v.rowid = videos_fts.rowid
    WHERE videos_fts MATCH @query
    ${whereStr}
    ORDER BY ${sort === 'relevance' ? 'rank' : 'v.published DESC'}
    LIMIT @limit OFFSET @offset
  `;

  const allParams = { ...params, limit, offset };
  const { total } = getDb().prepare(countSql).get(allParams);
  let results = getDb().prepare(resultSql).all(allParams);

  // Post-filter duration (ISO 8601 can't be compared in SQL)
  if (durationFilter && (durationFilter.min > 0 || durationFilter.max < Infinity)) {
    results = results.filter(v => {
      const minutes = parseDurationMinutes(v.duration);
      if (minutes === null) return true;
      if (durationFilter.min > 0 && minutes < durationFilter.min) return false;
      if (durationFilter.max < Infinity && minutes > durationFilter.max) return false;
      return true;
    });
  }

  return { results, total };
}

/**
 * Rebuild the FTS5 index from the videos table.
 */
export function rebuildFtsIndex() {
  getDb().exec(`INSERT INTO videos_fts(videos_fts) VALUES('rebuild')`);
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
