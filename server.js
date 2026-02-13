require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Logging & Quota
// ---------------------------------------------------------------------------
const LOG_FILE = path.join(__dirname, 'api-usage.log');

function log(message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message} ${JSON.stringify(data)}\n`;
  console.log(logEntry.trim());
  fs.appendFileSync(LOG_FILE, logEntry);
}

let quotaUsedToday = 0;
let quotaResetDate = new Date().toDateString();

function trackQuota(operation, units) {
  const today = new Date().toDateString();
  if (today !== quotaResetDate) {
    log('QUOTA RESET', { previousTotal: quotaUsedToday });
    quotaUsedToday = 0;
    quotaResetDate = today;
  }
  quotaUsedToday += units;
  const remaining = 10000 - quotaUsedToday;
  log(`API QUOTA: ${operation}`, { units, totalToday: quotaUsedToday, remaining });
  if (remaining < 1000 && remaining > 0) {
    console.warn(`WARNING: Only ${remaining} quota units remaining today!`);
  } else if (remaining <= 0) {
    console.error(`QUOTA EXCEEDED: ${quotaUsedToday}/10000 units used today!`);
  }
}

function canSpendQuota(units) {
  const today = new Date().toDateString();
  if (today !== quotaResetDate) { quotaUsedToday = 0; quotaResetDate = today; }
  return quotaUsedToday + units <= 8000; // 20% reserve
}

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// SQLite setup
// ---------------------------------------------------------------------------
fs.mkdirSync(path.join(__dirname, 'cache'), { recursive: true });
const db = new Database(path.join(__dirname, 'cache', 'videos.db'));
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

// Prepared statements
const sql = {
  getChannel: db.prepare('SELECT * FROM channels WHERE channel_id = ?'),
  getChannelVideoIds: db.prepare('SELECT video_id FROM videos WHERE channel_id = ?'),
  upsertChannel: db.prepare(`
    INSERT INTO channels (channel_id, channel_name, uploads_playlist_id, last_checked, backfill_complete, next_page_token, total_results)
    VALUES (@channel_id, @channel_name, @uploads_playlist_id, @last_checked, @backfill_complete, @next_page_token, @total_results)
    ON CONFLICT(channel_id) DO UPDATE SET
      channel_name = @channel_name, last_checked = @last_checked,
      backfill_complete = @backfill_complete, next_page_token = @next_page_token,
      total_results = @total_results
  `),
  insertVideo: db.prepare(`
    INSERT OR IGNORE INTO videos (video_id, channel_id, title, channel_name, published, thumbnail, description, duration, views)
    VALUES (@videoId, @channelId, @title, @channelName, @published, @thumbnail, @description, @duration, @views)
  `),
  getAllVideos: db.prepare(`
    SELECT video_id AS videoId, title, channel_id AS channelId, channel_name AS channelName,
           published, thumbnail, description, duration, views
    FROM videos ORDER BY published DESC
  `),
  getAllChannels: db.prepare('SELECT channel_id AS channelId, channel_name AS title FROM channels ORDER BY channel_name'),
  totalVideos: db.prepare('SELECT COUNT(*) AS count FROM videos'),
  latestCheck: db.prepare('SELECT MAX(last_checked) AS ts FROM channels'),
};

const insertVideos = db.transaction((videos) => {
  let inserted = 0;
  for (const v of videos) { inserted += sql.insertVideo.run(v).changes; }
  return inserted;
});

// ---------------------------------------------------------------------------
// Google OAuth2 setup
// ---------------------------------------------------------------------------
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`
);

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube',
];

// Simple in-memory session store
const sessions = new Map();

function sessionMiddleware(req, res, next) {
  let sid = req.headers['x-session-id'];
  if (sid && sessions.has(sid)) {
    req.session = sessions.get(sid);
  }
  next();
}
app.use(sessionMiddleware);

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  ws.on('close', () => console.log('WebSocket client disconnected'));
});

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

// ---------------------------------------------------------------------------
// Helper: authenticated YouTube client
// ---------------------------------------------------------------------------
function getYoutube(session) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`
  );
  client.setCredentials(session.tokens);
  return google.youtube({ version: 'v3', auth: client });
}

function getUploadsPlaylistId(channelId) {
  if (channelId.startsWith('UC')) return 'UU' + channelId.slice(2);
  return null;
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.get('/auth/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent',
  });
  res.json({ url, state });
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    log('OAuth callback received');
    const { tokens } = await oauth2Client.getToken(code);
    const sid = crypto.randomBytes(32).toString('hex');
    sessions.set(sid, {
      tokens,
      created: Date.now(),
      settings: { videosPerRow: 1, thumbSize: 168, density: 'normal', playlistId: null },
    });
    log('Session created', { sid: sid.substring(0, 8) + '...' });
    res.redirect(`/?sid=${sid}`);
  } catch (err) {
    log('OAuth callback error', { error: err.message });
    res.redirect('/?error=auth_failed');
  }
});

app.get('/auth/status', (req, res) => {
  res.json({ authenticated: !!req.session });
});

app.get('/api/quota', (req, res) => {
  res.json({
    used: quotaUsedToday,
    total: 10000,
    remaining: 10000 - quotaUsedToday,
    resetDate: quotaResetDate,
    warning: 10000 - quotaUsedToday < 1000,
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
app.get('/api/settings', (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });
  res.json(req.session.settings || { videosPerRow: 1, thumbSize: 168, density: 'normal', playlistId: null });
});

app.post('/api/settings', (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });
  req.session.settings = { ...req.session.settings, ...req.body };
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Core YouTube API fetch logic
// ---------------------------------------------------------------------------
async function fetchAllSubscriptions(youtube) {
  let allSubs = [];
  let pageToken = undefined;
  let pageCount = 0;

  do {
    const resp = await youtube.subscriptions.list({
      part: 'snippet',
      mine: true,
      maxResults: 50,
      pageToken,
      order: 'alphabetical',
    });
    allSubs.push(
      ...resp.data.items.map((item) => ({
        channelId: item.snippet.resourceId.channelId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails?.default?.url || '',
      }))
    );
    pageToken = resp.data.nextPageToken;
    pageCount++;
  } while (pageToken);

  trackQuota('subscriptions.list', pageCount * 3);
  return allSubs;
}

async function fetchChannelVideos(youtube, channel) {
  const uploadsPlaylistId = getUploadsPlaylistId(channel.channelId);
  if (!uploadsPlaylistId) {
    return { newVideos: [], totalResults: 0, backfillComplete: true, nextPageToken: null };
  }

  const existingVideoIds = new Set(
    sql.getChannelVideoIds.all(channel.channelId).map((r) => r.video_id)
  );
  const meta = sql.getChannel.get(channel.channelId);

  const newVideos = [];
  const seenInFetch = new Set();
  let pageToken = undefined;
  let totalResults = 0;
  let reachedExisting = false;

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
      if (err.code === 404) {
        return { newVideos: [], totalResults: 0, backfillComplete: true, nextPageToken: null };
      }
      throw err;
    }

    trackQuota('playlistItems.list', 1);
    totalResults = response.data.pageInfo.totalResults;

    for (const item of response.data.items) {
      const videoId = item.contentDetails.videoId;
      if (existingVideoIds.has(videoId)) { reachedExisting = true; break; }
      if (seenInFetch.has(videoId)) continue;
      seenInFetch.add(videoId);

      newVideos.push({
        videoId,
        title: item.snippet.title,
        channelId: channel.channelId,
        channelName: channel.title,
        published: item.contentDetails.videoPublishedAt || item.snippet.publishedAt,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
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
      ? meta?.backfill_complete === 1
      : false;
  const nextPageTokenToSave = !reachedExisting && pageToken
    ? pageToken
    : meta?.next_page_token || null;

  return { newVideos, totalResults, backfillComplete, nextPageToken: nextPageTokenToSave };
}

async function enrichVideos(youtube, videos) {
  for (let i = 0; i < videos.length; i += 50) {
    if (!canSpendQuota(1)) break;
    const batch = videos.slice(i, i + 50);
    const response = await youtube.videos.list({
      part: 'contentDetails,statistics',
      id: batch.map((v) => v.videoId).join(','),
    });
    trackQuota('videos.list', 1);
    for (const detail of response.data.items) {
      const video = batch.find((v) => v.videoId === detail.id);
      if (video) {
        video.duration = detail.contentDetails?.duration || '';
        video.views = detail.statistics?.viewCount || '0';
      }
    }
  }
}

async function backfillChannel(youtube, channel) {
  const meta = sql.getChannel.get(channel.channelId);
  if (!meta || meta.backfill_complete === 1 || !meta.next_page_token) return 0;

  const uploadsPlaylistId = getUploadsPlaylistId(channel.channelId);
  let pageToken = meta.next_page_token;
  let newVideos = [];

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
      log('Backfill error', { channel: channel.title, error: err.message });
      break;
    }

    trackQuota('playlistItems.list', 1);

    for (const item of response.data.items) {
      newVideos.push({
        videoId: item.contentDetails.videoId,
        title: item.snippet.title,
        channelId: channel.channelId,
        channelName: channel.title,
        published: item.contentDetails.videoPublishedAt || item.snippet.publishedAt,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
        description: item.snippet.description || '',
        duration: '',
        views: '0',
      });
    }

    pageToken = response.data.nextPageToken;
    sql.upsertChannel.run({
      channel_id: channel.channelId,
      channel_name: channel.title,
      uploads_playlist_id: uploadsPlaylistId,
      last_checked: Date.now(),
      backfill_complete: pageToken ? 0 : 1,
      next_page_token: pageToken || null,
      total_results: meta.total_results,
    });
  } while (pageToken && canSpendQuota(1));

  await enrichVideos(youtube, newVideos);
  return insertVideos(newVideos);
}

// ---------------------------------------------------------------------------
// Feed endpoints
// ---------------------------------------------------------------------------
app.get('/api/feed', (req, res) => {
  const videos = sql.getAllVideos.all();
  const channels = sql.getAllChannels.all();
  const latest = sql.latestCheck.get();
  res.json({
    timestamp: latest?.ts || null,
    channels,
    videos,
    totalVideos: videos.length,
    totalChannels: channels.length,
  });
});

let activeRefresh = null;

app.post('/api/feed/refresh', (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });
  if (activeRefresh) return res.json({ status: 'already_running' });

  activeRefresh = doRefresh(req.session)
    .catch((err) => {
      log('Refresh error', { error: err.message });
      broadcast('refreshError', { error: err.message });
    })
    .finally(() => { activeRefresh = null; });

  res.json({ status: 'started' });
});

async function doRefresh(session) {
  const youtube = getYoutube(session);

  // Phase 1: Get subscriptions
  broadcast('refreshProgress', { phase: 'subscriptions', message: 'Loading subscriptions...' });
  const channels = await fetchAllSubscriptions(youtube);
  log('Refresh: subscriptions loaded', { count: channels.length });

  // Phase 2: Incremental refresh (10 concurrent)
  broadcast('refreshProgress', { phase: 'videos', processed: 0, total: channels.length });
  let processed = 0;
  let totalNew = 0;

  for (let i = 0; i < channels.length; i += 10) {
    if (!canSpendQuota(1)) {
      broadcast('refreshProgress', { phase: 'quota_limit', message: 'Quota budget reached, saving progress' });
      break;
    }

    const batch = channels.slice(i, i + 10);
    await Promise.all(
      batch.map(async (ch) => {
        try {
          // Upsert channel FIRST so FOREIGN KEY is satisfied when inserting videos
          sql.upsertChannel.run({
            channel_id: ch.channelId,
            channel_name: ch.title,
            uploads_playlist_id: getUploadsPlaylistId(ch.channelId),
            last_checked: Date.now(),
            backfill_complete: 0,
            next_page_token: null,
            total_results: 0,
          });
          const result = await fetchChannelVideos(youtube, ch);
          if (result.newVideos.length > 0) {
            await enrichVideos(youtube, result.newVideos);
            totalNew += insertVideos(result.newVideos);
          }
          sql.upsertChannel.run({
            channel_id: ch.channelId,
            channel_name: ch.title,
            uploads_playlist_id: getUploadsPlaylistId(ch.channelId),
            last_checked: Date.now(),
            backfill_complete: result.backfillComplete ? 1 : 0,
            next_page_token: result.nextPageToken || null,
            total_results: result.totalResults,
          });
        } catch (err) {
          log('Channel fetch error', { channel: ch.title, error: err.message });
        }
      })
    );

    processed += batch.length;
    broadcast('refreshProgress', {
      phase: 'videos',
      processed: Math.min(processed, channels.length),
      total: channels.length,
      newVideos: totalNew,
      quotaUsed: quotaUsedToday,
    });
  }

  // Phase 3: Backfill (if quota allows)
  if (canSpendQuota(1)) {
    let totalBackfilled = 0;
    for (const ch of channels) {
      if (!canSpendQuota(1)) break;
      totalBackfilled += await backfillChannel(youtube, ch);
    }
    if (totalBackfilled > 0) {
      log('Backfill complete', { totalBackfilled });
    }
  }

  const totalVideos = sql.totalVideos.get().count;
  broadcast('refreshComplete', {
    totalVideos,
    newVideos: totalNew,
    quotaUsed: quotaUsedToday,
  });
  log('Refresh complete', { totalVideos, newVideos: totalNew, quotaUsed: quotaUsedToday });
}

// ---------------------------------------------------------------------------
// Subscriptions endpoint (still available for direct use)
// ---------------------------------------------------------------------------
app.get('/api/subscriptions', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const youtube = getYoutube(req.session);
    const channels = await fetchAllSubscriptions(youtube);
    res.json({ channels, count: channels.length });
  } catch (err) {
    log('Subscriptions error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Playlist management
// ---------------------------------------------------------------------------
app.post('/api/playlist/ensure', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });

  try {
    log('Checking for To Watch playlist');
    const youtube = getYoutube(req.session);

    const existing = await youtube.playlists.list({
      part: 'snippet',
      mine: true,
      maxResults: 50,
    });
    trackQuota('playlists.list', 1);

    let playlist = existing.data.items.find((p) => p.snippet.title === 'To Watch');

    if (!playlist) {
      log('Creating To Watch playlist');
      const created = await youtube.playlists.insert({
        part: 'snippet,status',
        requestBody: {
          snippet: {
            title: 'To Watch',
            description: 'Videos queued from my custom subscriptions feed',
          },
          status: { privacyStatus: 'private' },
        },
      });
      playlist = created.data;
      trackQuota('playlists.insert', 50);
      log('Playlist created', { id: playlist.id });
    } else {
      log('Playlist already exists', { id: playlist.id });
    }

    if (!req.session.settings) {
      req.session.settings = { videosPerRow: 1, thumbSize: 168, density: 'normal' };
    }
    req.session.settings.playlistId = playlist.id;

    res.json({
      playlistId: playlist.id,
      title: playlist.snippet.title,
      url: `https://www.youtube.com/playlist?list=${playlist.id}`,
    });
  } catch (err) {
    log('Playlist ensure error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/playlist/add', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });

  const { playlistId, videoId } = req.body;
  if (!playlistId || !videoId) {
    return res.status(400).json({ error: 'playlistId and videoId required' });
  }

  try {
    log('Adding video to playlist', { videoId });
    const youtube = getYoutube(req.session);
    await youtube.playlistItems.insert({
      part: 'snippet',
      requestBody: {
        snippet: {
          playlistId,
          position: 0,
          resourceId: { kind: 'youtube#video', videoId },
        },
      },
    });
    trackQuota('playlistItems.insert', 50);
    log('Video added successfully', { videoId });
    broadcast('videoAdded', { videoId, playlistId });
    res.json({ success: true });
  } catch (err) {
    log('Playlist add error', { videoId, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/playlist/remove', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });

  const { playlistId, videoId } = req.body;
  if (!playlistId || !videoId) {
    return res.status(400).json({ error: 'playlistId and videoId required' });
  }

  try {
    log('Removing video from playlist', { videoId });
    const youtube = getYoutube(req.session);

    let pageToken;
    let itemId = null;
    let pageCount = 0;
    do {
      const resp = await youtube.playlistItems.list({
        part: 'snippet',
        playlistId,
        maxResults: 50,
        pageToken,
      });
      pageCount++;
      const found = resp.data.items.find((item) => item.snippet.resourceId.videoId === videoId);
      if (found) { itemId = found.id; break; }
      pageToken = resp.data.nextPageToken;
    } while (pageToken);

    trackQuota('playlistItems.list', pageCount * 3);

    if (itemId) {
      await youtube.playlistItems.delete({ id: itemId });
      trackQuota('playlistItems.delete', 50);
      log('Video removed successfully', { videoId });
      broadcast('videoRemoved', { videoId, playlistId });
    }

    res.json({ success: true });
  } catch (err) {
    log('Playlist remove error', { videoId, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/playlist/items', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });

  let playlistId = req.query.playlistId || req.session.settings?.playlistId;
  if (!playlistId) {
    return res.status(400).json({ error: 'playlistId required' });
  }

  try {
    log('Fetching playlist items', { playlistId });
    const youtube = getYoutube(req.session);

    let allItems = [];
    let pageToken = undefined;
    let pageCount = 0;

    do {
      const resp = await youtube.playlistItems.list({
        part: 'snippet,contentDetails',
        playlistId,
        maxResults: 50,
        pageToken,
      });
      pageCount++;

      allItems.push(
        ...resp.data.items.map((item) => ({
          id: item.id,
          videoId: item.contentDetails.videoId,
          title: item.snippet.title,
          channelName: item.snippet.videoOwnerChannelTitle || item.snippet.channelTitle,
          channelId: item.snippet.videoOwnerChannelId || item.snippet.channelId,
          thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
          published: item.contentDetails.videoPublishedAt || item.snippet.publishedAt,
          position: item.snippet.position,
        }))
      );

      pageToken = resp.data.nextPageToken;
    } while (pageToken);

    trackQuota('playlistItems.list', pageCount * 3);

    // Fetch video details for correct channel names and durations
    if (allItems.length > 0) {
      for (let i = 0; i < allItems.length; i += 50) {
        const batch = allItems.slice(i, i + 50);
        const videoResp = await youtube.videos.list({
          part: 'snippet,contentDetails',
          id: batch.map((item) => item.videoId).join(','),
        });
        trackQuota('videos.list', 1);

        videoResp.data.items.forEach((video) => {
          const item = allItems.find((i) => i.videoId === video.id);
          if (item) {
            item.channelName = video.snippet.channelTitle;
            item.channelId = video.snippet.channelId;
            item.duration = video.contentDetails.duration;
          }
        });
      }
    }

    res.json({ items: allItems, count: allItems.length });
  } catch (err) {
    log('Playlist items fetch error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Serve pages
// ---------------------------------------------------------------------------
app.get('/playlist', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'playlist.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  const videoCount = sql.totalVideos.get().count;
  const channelCount = sql.getAllChannels.all().length;
  console.log(`\n  YouTube Subs Viewer running at http://localhost:${PORT}`);
  console.log(`  SQLite: ${videoCount} videos across ${channelCount} channels`);
  console.log(`  WebSocket server ready\n`);
});
