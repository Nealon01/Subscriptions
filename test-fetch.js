/**
 * test-fetch.js — Standalone test of per-channel YouTube API caching with SQLite
 *
 * Tests the core playlistItems.list fetch + SQLite caching logic
 * against 10 curated channels before wiring into the main server.
 *
 * Usage:
 *   node test-fetch.js          # First run: opens browser for OAuth, then fetches
 *   node test-fetch.js          # Second run: reuses saved tokens, tests incremental
 *   node test-fetch.js migrate  # Migrate existing JSON cache files into SQLite
 */

require('dotenv').config();
const { google } = require('googleapis');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CACHE_DIR = path.join(__dirname, 'cache');
const JSON_CACHE_DIR = path.join(CACHE_DIR, 'channels');
const DB_PATH = path.join(CACHE_DIR, 'videos.db');
const TOKENS_FILE = path.join(CACHE_DIR, 'tokens.json');
const QUOTA_BUDGET = 8000; // 80% of 10,000 daily limit

const TEST_CHANNELS = [
  { channelId: 'UC28n0tlcNSa1iPe5mettocg', title: 'voidzilla' },
  { channelId: 'UCeeFfhMcJa1kjtfZAGskOCA', title: 'TechLinked' },
  { channelId: 'UCPnb-3TfAVwgOxIlODB42pw', title: 'scotty7117' },
  { channelId: 'UCq8ZAAsI89IoJ-fn1gYpO3g', title: 'Nightshift – Kurzgesagt After Dark' },
  { channelId: 'UCWiHJYoHWyO56dlo_vjTleA', title: 'Norm Macdonald' },
  { channelId: 'UCXKCiTquPMavBqgXgrM9mBg', title: 'Bobby Fingers' },
  { channelId: 'UCUHW94eEFW7hkUMVaZz4eDg', title: 'minutephysics' },
  { channelId: 'UCfdNM3NAhaBOXCafH7krzrA', title: 'The Infographics Show' },
  { channelId: 'UCSHZKyawb77ixDdsGog4iWA', title: 'Lex Fridman' },
  { channelId: 'UC1DoqbBY6dl8CEMVV9SK2FA', title: 'MKBHD Shorts' },
];

// ---------------------------------------------------------------------------
// SQLite setup
// ---------------------------------------------------------------------------
function openDatabase() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const db = new Database(DB_PATH);

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      channel_id TEXT PRIMARY KEY,
      channel_name TEXT NOT NULL,
      uploads_playlist_id TEXT,
      last_checked INTEGER,
      backfill_complete INTEGER DEFAULT 0,
      next_page_token TEXT,
      total_results INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS videos (
      video_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      published TEXT,
      thumbnail TEXT DEFAULT '',
      description TEXT DEFAULT '',
      duration TEXT DEFAULT '',
      views TEXT DEFAULT '0',
      FOREIGN KEY (channel_id) REFERENCES channels(channel_id)
    );

    CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
    CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published DESC);
  `);

  return db;
}

// ---------------------------------------------------------------------------
// SQLite helpers (replace JSON file I/O)
// ---------------------------------------------------------------------------
function getChannelMeta(db, channelId) {
  return db.prepare('SELECT * FROM channels WHERE channel_id = ?').get(channelId);
}

function getChannelVideoIds(db, channelId) {
  const rows = db.prepare('SELECT video_id FROM videos WHERE channel_id = ?').all(channelId);
  return new Set(rows.map(r => r.video_id));
}

function getChannelVideoCount(db, channelId) {
  const row = db.prepare('SELECT COUNT(*) as count FROM videos WHERE channel_id = ?').get(channelId);
  return row.count;
}

function upsertChannel(db, channel) {
  db.prepare(`
    INSERT INTO channels (channel_id, channel_name, uploads_playlist_id, last_checked, backfill_complete, next_page_token, total_results)
    VALUES (@channel_id, @channel_name, @uploads_playlist_id, @last_checked, @backfill_complete, @next_page_token, @total_results)
    ON CONFLICT(channel_id) DO UPDATE SET
      channel_name = @channel_name,
      last_checked = @last_checked,
      backfill_complete = @backfill_complete,
      next_page_token = @next_page_token,
      total_results = @total_results
  `).run(channel);
}

const insertVideoStmt = (db) => db.prepare(`
  INSERT OR IGNORE INTO videos (video_id, channel_id, title, channel_name, published, thumbnail, description, duration, views)
  VALUES (@videoId, @channelId, @title, @channelName, @published, @thumbnail, @description, @duration, @views)
`);

function insertVideos(db, videos) {
  if (videos.length === 0) return 0;
  const stmt = insertVideoStmt(db);
  let inserted = 0;
  const insertMany = db.transaction((vids) => {
    for (const v of vids) {
      const result = stmt.run(v);
      inserted += result.changes;
    }
  });
  insertMany(videos);
  return inserted;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let quotaUsed = 0;

function getUploadsPlaylistId(channelId) {
  if (channelId.startsWith('UC')) {
    return 'UU' + channelId.slice(2);
  }
  return null;
}

function canSpendQuota(units) {
  return quotaUsed + units <= QUOTA_BUDGET;
}

// ---------------------------------------------------------------------------
// OAuth — saves tokens to file for reuse
// ---------------------------------------------------------------------------
async function getAuthenticatedYoutube() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback'
  );

  // Try saved tokens first
  if (fs.existsSync(TOKENS_FILE)) {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    oauth2Client.setCredentials(tokens);

    oauth2Client.on('tokens', (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      fs.writeFileSync(TOKENS_FILE, JSON.stringify(merged, null, 2));
      console.log('  Tokens refreshed and saved');
    });

    console.log('Using saved tokens from cache/tokens.json');
    return google.youtube({ version: 'v3', auth: oauth2Client });
  }

  // No saved tokens — do OAuth flow
  console.log('No saved tokens found. Starting OAuth flow...');
  const tokens = await doOAuthFlow(oauth2Client);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  console.log('Tokens saved to cache/tokens.json');
  return google.youtube({ version: 'v3', auth: oauth2Client });
}

function doOAuthFlow(oauth2Client) {
  return new Promise((resolve, reject) => {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/youtube',
      ],
      prompt: 'consent',
    });

    const callbackPath = new URL(process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback').pathname;
    const port = parseInt(new URL(process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback').port) || 3000;

    const server = http.createServer(async (req, res) => {
      if (req.url.startsWith(callbackPath)) {
        const url = new URL(req.url, `http://localhost:${port}`);
        const code = url.searchParams.get('code');
        try {
          const { tokens } = await oauth2Client.getToken(code);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Auth successful! You can close this tab.</h1>');
          server.close();
          resolve(tokens);
        } catch (err) {
          res.writeHead(500);
          res.end('Auth failed: ' + err.message);
          server.close();
          reject(err);
        }
      }
    });

    server.listen(port, () => {
      console.log(`\nOpen this URL in your browser:\n\n${authUrl}\n`);
      const { exec } = require('child_process');
      exec(`start "" "${authUrl}"`);
    });
  });
}

// ---------------------------------------------------------------------------
// Core fetch logic
// ---------------------------------------------------------------------------

/**
 * Fetch videos for a single channel using playlistItems.list
 * Returns { newVideos, totalResults, backfillComplete, nextPageToken }
 */
async function fetchChannelVideos(youtube, channel, db) {
  const uploadsPlaylistId = getUploadsPlaylistId(channel.channelId);
  if (!uploadsPlaylistId) {
    console.log(`  [SKIP] ${channel.title} — cannot derive uploads playlist ID`);
    return { newVideos: [], totalResults: 0, backfillComplete: true, nextPageToken: null };
  }

  const existingVideoIds = getChannelVideoIds(db, channel.channelId);
  const meta = getChannelMeta(db, channel.channelId);

  const newVideos = [];
  const seenInFetch = new Set();
  let pageToken = undefined;
  let totalResults = 0;
  let reachedExisting = false;
  let pagesRead = 0;

  do {
    if (!canSpendQuota(1)) {
      console.log(`  [QUOTA] Budget exhausted at ${quotaUsed} units`);
      break;
    }

    let response;
    try {
      response = await youtube.playlistItems.list({
        part: 'snippet,contentDetails',
        playlistId: uploadsPlaylistId,
        maxResults: 50,
        pageToken,
      });
    } catch (err) {
      if (err.code === 404) {
        console.log(`  [404] ${channel.title} — uploads playlist not found`);
        return { newVideos: [], totalResults: 0, backfillComplete: true, nextPageToken: null, error: 'notFound' };
      }
      throw err;
    }

    quotaUsed += 1;
    pagesRead += 1;
    totalResults = response.data.pageInfo.totalResults;

    for (const item of response.data.items) {
      const videoId = item.contentDetails.videoId;

      if (existingVideoIds.has(videoId)) {
        reachedExisting = true;
        break;
      }

      if (seenInFetch.has(videoId)) continue;
      seenInFetch.add(videoId);

      newVideos.push({
        videoId,
        title: item.snippet.title,
        channelId: channel.channelId,
        channelName: channel.title,
        published: item.contentDetails.videoPublishedAt || item.snippet.publishedAt,
        thumbnail: item.snippet.thumbnails?.medium?.url
          || item.snippet.thumbnails?.default?.url || '',
        description: item.snippet.description || '',
        duration: '',
        views: '0',
      });
    }

    pageToken = reachedExisting ? null : response.data.nextPageToken;
  } while (pageToken && !reachedExisting && canSpendQuota(1));

  const backfillComplete = !pageToken && !reachedExisting
    ? true
    : reachedExisting
      ? (meta?.backfill_complete === 1)
      : false;

  const nextPageTokenToSave = (!reachedExisting && pageToken) ? pageToken : (meta?.next_page_token || null);

  console.log(`  [FETCH] ${channel.title}: ${newVideos.length} new videos, ${pagesRead} pages, totalResults=${totalResults}, backfillComplete=${backfillComplete}`);

  return { newVideos, totalResults, backfillComplete, nextPageToken: nextPageTokenToSave };
}

/**
 * Enrich videos with duration and view count from videos.list
 */
async function enrichVideos(youtube, videos) {
  if (videos.length === 0) return;

  for (let i = 0; i < videos.length; i += 50) {
    if (!canSpendQuota(1)) {
      console.log(`  [QUOTA] Skipping enrichment — budget exhausted`);
      break;
    }

    const batch = videos.slice(i, i + 50);
    const videoIds = batch.map(v => v.videoId).join(',');

    const response = await youtube.videos.list({
      part: 'contentDetails,statistics',
      id: videoIds,
    });
    quotaUsed += 1;

    for (const detail of response.data.items) {
      const video = batch.find(v => v.videoId === detail.id);
      if (video) {
        video.duration = detail.contentDetails?.duration || '';
        video.views = detail.statistics?.viewCount || '0';
      }
    }
  }
}

/**
 * Backfill older videos for a channel that isn't fully indexed
 */
async function backfillChannel(youtube, channel, db) {
  const meta = getChannelMeta(db, channel.channelId);
  if (!meta || meta.backfill_complete === 1 || !meta.next_page_token) return { newVideos: 0 };

  const uploadsPlaylistId = getUploadsPlaylistId(channel.channelId);
  let pageToken = meta.next_page_token;
  let newVideos = [];
  let pagesRead = 0;

  do {
    if (!canSpendQuota(1)) break;

    let response;
    try {
      response = await youtube.playlistItems.list({
        part: 'snippet,contentDetails',
        playlistId: uploadsPlaylistId,
        maxResults: 50,
        pageToken,
      });
    } catch (err) {
      console.log(`  [BACKFILL ERROR] ${channel.title}: ${err.message}`);
      break;
    }

    quotaUsed += 1;
    pagesRead += 1;

    for (const item of response.data.items) {
      newVideos.push({
        videoId: item.contentDetails.videoId,
        title: item.snippet.title,
        channelId: channel.channelId,
        channelName: channel.title,
        published: item.contentDetails.videoPublishedAt || item.snippet.publishedAt,
        thumbnail: item.snippet.thumbnails?.medium?.url
          || item.snippet.thumbnails?.default?.url || '',
        description: item.snippet.description || '',
        duration: '',
        views: '0',
      });
    }

    pageToken = response.data.nextPageToken;

    // Update channel meta after each page
    upsertChannel(db, {
      channel_id: channel.channelId,
      channel_name: channel.title,
      uploads_playlist_id: uploadsPlaylistId,
      last_checked: Date.now(),
      backfill_complete: pageToken ? 0 : 1,
      next_page_token: pageToken || null,
      total_results: meta.total_results,
    });
  } while (pageToken && canSpendQuota(1));

  // Enrich backfilled videos
  await enrichVideos(youtube, newVideos);

  // INSERT OR IGNORE handles dedup naturally
  const inserted = insertVideos(db, newVideos);

  console.log(`  [BACKFILL] ${channel.title}: +${inserted} older videos, ${pagesRead} pages, complete=${!pageToken}`);
  return { newVideos: inserted };
}

// ---------------------------------------------------------------------------
// Migration: JSON cache files → SQLite
// ---------------------------------------------------------------------------
function migrateJsonToSqlite(db) {
  console.log('--- Migrating JSON cache files to SQLite ---');

  if (!fs.existsSync(JSON_CACHE_DIR)) {
    console.log('  No JSON cache directory found. Nothing to migrate.');
    return;
  }

  const files = fs.readdirSync(JSON_CACHE_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('  No JSON cache files found. Nothing to migrate.');
    return;
  }

  let totalVideos = 0;
  let totalInserted = 0;

  for (const file of files) {
    const filePath = path.join(JSON_CACHE_DIR, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Upsert channel metadata
    upsertChannel(db, {
      channel_id: data.channelId,
      channel_name: data.channelName,
      uploads_playlist_id: data.uploadsPlaylistId,
      last_checked: data.lastChecked,
      backfill_complete: data.backfillComplete ? 1 : 0,
      next_page_token: data.nextPageToken || null,
      total_results: data.totalResults || 0,
    });

    // Insert videos (INSERT OR IGNORE deduplicates)
    const inserted = insertVideos(db, data.videos);
    totalVideos += data.videos.length;
    totalInserted += inserted;

    console.log(`  [MIGRATED] ${data.channelName}: ${inserted}/${data.videos.length} videos inserted`);
  }

  console.log(`\n  Migration complete: ${totalInserted}/${totalVideos} videos inserted across ${files.length} channels`);
  console.log(`  (${totalVideos - totalInserted} duplicates were naturally ignored by PRIMARY KEY)\n`);
}

// ---------------------------------------------------------------------------
// Main test flow
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Per-Channel Cache Test (SQLite) ===\n');

  const db = openDatabase();

  // Check if we need to migrate from JSON
  const existingChannelCount = db.prepare('SELECT COUNT(*) as count FROM channels').get().count;
  const jsonFiles = fs.existsSync(JSON_CACHE_DIR)
    ? fs.readdirSync(JSON_CACHE_DIR).filter(f => f.endsWith('.json'))
    : [];

  if (existingChannelCount === 0 && jsonFiles.length > 0) {
    migrateJsonToSqlite(db);
  }

  // If migrate-only mode, stop here
  if (process.argv[2] === 'migrate') {
    if (existingChannelCount > 0) {
      console.log('SQLite already has data. Skipping migration.');
    }
    db.close();
    return;
  }

  // Authenticate
  const youtube = await getAuthenticatedYoutube();
  console.log('');

  // Phase A: Incremental refresh (new videos)
  console.log('--- Phase A: Incremental refresh ---');
  let totalNewVideos = 0;

  for (const channel of TEST_CHANNELS) {
    const existingCount = getChannelVideoCount(db, channel.channelId);

    const result = await fetchChannelVideos(youtube, channel, db);

    if (result.newVideos.length > 0) {
      await enrichVideos(youtube, result.newVideos);
      totalNewVideos += result.newVideos.length;
    }

    // INSERT OR IGNORE — natural dedup via PRIMARY KEY
    const inserted = insertVideos(db, result.newVideos);

    // Update channel metadata
    upsertChannel(db, {
      channel_id: channel.channelId,
      channel_name: channel.title,
      uploads_playlist_id: getUploadsPlaylistId(channel.channelId),
      last_checked: Date.now(),
      backfill_complete: result.backfillComplete ? 1 : 0,
      next_page_token: result.nextPageToken || null,
      total_results: result.totalResults,
    });

    const newCount = getChannelVideoCount(db, channel.channelId);
    console.log(`    → DB: ${newCount} videos (was ${existingCount}, +${inserted} inserted), API says ${result.totalResults} total`);
  }

  console.log(`\n  Incremental done: ${totalNewVideos} new videos fetched, ${quotaUsed} quota used\n`);

  // Phase B: Backfill (older videos for incomplete channels)
  console.log('--- Phase B: Backfill ---');
  let totalBackfilled = 0;

  for (const channel of TEST_CHANNELS) {
    const meta = getChannelMeta(db, channel.channelId);
    if (!meta || meta.backfill_complete === 1) {
      const count = getChannelVideoCount(db, channel.channelId);
      console.log(`  [SKIP] ${channel.title} — already complete (${count}/${meta?.total_results || '?'} videos)`);
      continue;
    }

    const result = await backfillChannel(youtube, channel, db);
    totalBackfilled += result.newVideos;
  }

  console.log(`\n  Backfill done: +${totalBackfilled} older videos, ${quotaUsed} total quota used\n`);

  // Verification
  console.log('--- Verification ---');
  let allGood = true;

  for (const channel of TEST_CHANNELS) {
    const meta = getChannelMeta(db, channel.channelId);
    if (!meta) {
      console.log(`  [FAIL] ${channel.title} — no channel record!`);
      allGood = false;
      continue;
    }

    const videoCount = getChannelVideoCount(db, channel.channelId);

    // Dupes are impossible with PRIMARY KEY, but let's confirm
    const dupeCheck = db.prepare(`
      SELECT video_id, COUNT(*) as cnt FROM videos
      WHERE channel_id = ?
      GROUP BY video_id HAVING cnt > 1
    `).all(channel.channelId);

    const status = meta.backfill_complete === 1
      ? (videoCount === meta.total_results ? 'COMPLETE' : `MISMATCH ${videoCount}/${meta.total_results}`)
      : `PARTIAL ${videoCount}/${meta.total_results}`;

    const issues = [];
    if (dupeCheck.length > 0) issues.push(`${dupeCheck.length} dupes (should be impossible!)`);

    const issueStr = issues.length > 0 ? ` [ISSUES: ${issues.join(', ')}]` : '';
    const mark = issues.length > 0 ? 'WARN' : 'OK';

    console.log(`  [${mark}] ${channel.title}: ${status}${issueStr}`);
    if (issues.length > 0) allGood = false;
  }

  // Total count
  const totalVideos = db.prepare('SELECT COUNT(*) as count FROM videos').get().count;
  const totalChannels = db.prepare('SELECT COUNT(*) as count FROM channels').get().count;
  console.log(`\n  Total: ${totalVideos} videos across ${totalChannels} channels`);
  console.log(`  Total quota used: ${quotaUsed} units`);
  console.log(`  ${allGood ? 'All checks passed!' : 'Some issues found — see above'}`);

  db.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
