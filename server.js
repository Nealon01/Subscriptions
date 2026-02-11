require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const xml2js = require('xml2js');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
app.use(express.json({ limit: '10mb' })); // Increase limit for cache with 5000+ videos
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Logging setup
// ---------------------------------------------------------------------------
const LOG_FILE = path.join(__dirname, 'api-usage.log');
const CACHE_FILE = path.join(__dirname, 'feed-cache.json');

function log(message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message} ${JSON.stringify(data)}\n`;
  console.log(logEntry.trim());
  fs.appendFileSync(LOG_FILE, logEntry);
}

// Quota tracking (rough estimates)
let quotaUsedToday = 0;
let quotaResetDate = new Date().toDateString();

function trackQuota(operation, units) {
  // Reset quota counter at midnight
  const today = new Date().toDateString();
  if (today !== quotaResetDate) {
    log('QUOTA RESET', { previousTotal: quotaUsedToday });
    quotaUsedToday = 0;
    quotaResetDate = today;
  }

  quotaUsedToday += units;
  const remaining = 10000 - quotaUsedToday;
  log(`API QUOTA: ${operation}`, { units, totalToday: quotaUsedToday, remaining });

  // Warn if getting close to limit
  if (remaining < 1000 && remaining > 0) {
    console.warn(`⚠️  WARNING: Only ${remaining} quota units remaining today!`);
  } else if (remaining <= 0) {
    console.error(`❌ QUOTA EXCEEDED: ${quotaUsedToday}/10000 units used today!`);
  }
}

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Google OAuth2 setup
// ---------------------------------------------------------------------------
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`
);

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',      // read subs
  'https://www.googleapis.com/auth/youtube',                // manage playlists
];

// Simple in-memory session store (swap for Redis/DB in prod)
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
// WebSocket setup for real-time playlist updates
// ---------------------------------------------------------------------------
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('📡 WebSocket client connected');

  ws.on('close', () => {
    console.log('📡 WebSocket client disconnected');
  });
});

// Broadcast playlist updates to all connected clients
function broadcastPlaylistUpdate(type, data) {
  const message = JSON.stringify({ type, data });
  console.log(`📡 Broadcasting ${type} to ${wss.clients.size} clients:`, data);
  let sentCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sentCount++;
    }
  });
  console.log(`📡 Broadcast sent to ${sentCount}/${wss.clients.size} connected clients`);
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
      settings: {
        videosPerRow: 1,
        thumbSize: 168,
        density: 'normal',
        playlistId: null
      }
    });
    log('Session created', { sid: sid.substring(0, 8) + '...' });

    // Redirect back to the app with the session id
    res.redirect(`/?sid=${sid}`);
  } catch (err) {
    log('OAuth callback error', { error: err.message });
    console.error('OAuth callback error:', err.message);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/auth/status', (req, res) => {
  res.json({ authenticated: !!req.session });
});

app.get('/api/quota', (req, res) => {
  const remaining = 10000 - quotaUsedToday;
  res.json({
    used: quotaUsedToday,
    total: 10000,
    remaining,
    resetDate: quotaResetDate,
    warning: remaining < 1000
  });
});

// Settings endpoints
app.get('/api/settings', (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });
  const settings = req.session.settings || {
    videosPerRow: 1,
    thumbSize: 168,
    density: 'normal',
    playlistId: null
  };
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });
  req.session.settings = {
    ...req.session.settings,
    ...req.body
  };
  res.json({ success: true });
});

// Cache endpoints
app.get('/api/cache', (req, res) => {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      res.json(cache);
    } else {
      res.status(404).json({ error: 'No cache found' });
    }
  } catch (err) {
    log('Cache load error', { error: err.message });
    res.status(500).json({ error: 'Failed to load cache' });
  }
});

app.post('/api/cache', (req, res) => {
  try {
    const cache = {
      timestamp: Date.now(),
      channels: req.body.channels,
      videos: req.body.videos,
      playlistId: req.body.playlistId,
      playlistUrl: req.body.playlistUrl
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    log('Cache saved', {
      channels: cache.channels?.length || 0,
      videos: cache.videos?.length || 0,
      sizeKB: Math.round(JSON.stringify(cache).length / 1024)
    });
    res.json({ success: true });
  } catch (err) {
    log('Cache save error', { error: err.message });
    res.status(500).json({ error: 'Failed to save cache' });
  }
});

// ---------------------------------------------------------------------------
// Helper: get an authenticated YouTube client for a session
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

// ---------------------------------------------------------------------------
// API: Fetch subscriptions (paginated)
// ---------------------------------------------------------------------------
app.get('/api/subscriptions', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });

  try {
    log('Fetching subscriptions');
    const youtube = getYoutube(req.session);
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

    const quotaUsed = pageCount * 3; // ~3 units per page
    trackQuota('subscriptions.list', quotaUsed);
    log('Subscriptions fetched', { channels: allSubs.length, pages: pageCount });

    res.json({ channels: allSubs, count: allSubs.length });
  } catch (err) {
    log('Subscriptions error', { error: err.message });
    console.error('Subscriptions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// API: Fetch videos via RSS for a batch of channel IDs
// Accepts POST { channelIds: string[] }
// Returns recent videos for each channel (RSS gives ~15 most recent)
// ---------------------------------------------------------------------------
app.post('/api/videos', async (req, res) => {
  const { channelIds } = req.body;
  if (!Array.isArray(channelIds) || channelIds.length === 0) {
    return res.status(400).json({ error: 'channelIds required' });
  }

  const parser = new xml2js.Parser();
  const results = [];

  // Fetch RSS feeds in parallel (batch of 10 at a time to be polite)
  const batchSize = 10;
  for (let i = 0; i < channelIds.length; i += batchSize) {
    const batch = channelIds.slice(i, i + batchSize);
    const promises = batch.map(async (channelId) => {
      try {
        const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        const resp = await fetch(url, { timeout: 8000 });
        if (!resp.ok) return [];
        const xml = await resp.text();
        const parsed = await parser.parseStringPromise(xml);
        const entries = parsed?.feed?.entry || [];
        return entries.map((entry) => ({
          videoId: entry['yt:videoId']?.[0] || '',
          channelId: entry['yt:channelId']?.[0] || channelId,
          channelName: parsed.feed?.title?.[0] || '',
          title: entry.title?.[0] || '',
          published: entry.published?.[0] || '',
          updated: entry.updated?.[0] || '',
          thumbnail: entry['media:group']?.[0]?.['media:thumbnail']?.[0]?.$?.url || '',
          description: entry['media:group']?.[0]?.['media:description']?.[0] || '',
          views: entry['media:group']?.[0]?.['media:community']?.[0]?.['media:statistics']?.[0]?.$?.views || '0',
        }));
      } catch {
        return [];
      }
    });
    const batchResults = await Promise.all(promises);
    batchResults.forEach((vids) => results.push(...vids));
  }

  // Sort by published date descending
  results.sort((a, b) => new Date(b.published) - new Date(a.published));

  res.json({ videos: results, count: results.length });
});

// ---------------------------------------------------------------------------
// API: Playlist management
// ---------------------------------------------------------------------------

// Get or create the "To Watch" playlist
app.post('/api/playlist/ensure', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });

  try {
    log('Checking for To Watch playlist');
    const youtube = getYoutube(req.session);

    // Check if playlist already exists
    const existing = await youtube.playlists.list({
      part: 'snippet',
      mine: true,
      maxResults: 50,
    });
    trackQuota('playlists.list', 1);

    let playlist = existing.data.items.find(
      (p) => p.snippet.title === 'To Watch'
    );

    if (!playlist) {
      // Create it
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

    // Save playlist ID in session settings
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
    console.error('Playlist ensure error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Add a video to the "To Watch" playlist (at position 0 = top)
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
          resourceId: {
            kind: 'youtube#video',
            videoId,
          },
        },
      },
    });
    trackQuota('playlistItems.insert', 50);
    log('Video added successfully', { videoId });
    broadcastPlaylistUpdate('videoAdded', { videoId, playlistId });
    res.json({ success: true });
  } catch (err) {
    log('Playlist add error', { videoId, error: err.message });
    console.error('Playlist add error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Remove a video from the "To Watch" playlist
app.post('/api/playlist/remove', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });

  const { playlistId, videoId } = req.body;
  if (!playlistId || !videoId) {
    return res.status(400).json({ error: 'playlistId and videoId required' });
  }

  try {
    log('Removing video from playlist', { videoId });
    const youtube = getYoutube(req.session);

    // Find the playlist item ID for this video
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
      const found = resp.data.items.find(
        (item) => item.snippet.resourceId.videoId === videoId
      );
      if (found) {
        itemId = found.id;
        break;
      }
      pageToken = resp.data.nextPageToken;
    } while (pageToken);

    trackQuota('playlistItems.list', pageCount * 3);

    if (itemId) {
      await youtube.playlistItems.delete({ id: itemId });
      trackQuota('playlistItems.delete', 50);
      log('Video removed successfully', { videoId });
      broadcastPlaylistUpdate('videoRemoved', { videoId, playlistId });
    } else {
      log('Video not found in playlist', { videoId });
    }

    res.json({ success: true });
  } catch (err) {
    log('Playlist remove error', { videoId, error: err.message });
    console.error('Playlist remove error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fetch all items in a playlist
app.get('/api/playlist/items', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });

  // Get playlistId from query param or session settings
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

      allItems.push(...resp.data.items.map((item) => ({
        id: item.id,
        videoId: item.contentDetails.videoId,
        title: item.snippet.title,
        channelName: item.snippet.videoOwnerChannelTitle || item.snippet.channelTitle,
        channelId: item.snippet.videoOwnerChannelId || item.snippet.channelId,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
        published: item.contentDetails.videoPublishedAt || item.snippet.publishedAt,
        position: item.snippet.position,
      })));

      pageToken = resp.data.nextPageToken;
    } while (pageToken);

    trackQuota('playlistItems.list', pageCount * 3);

    // Fetch video details for correct channel names and durations (batches of 50)
    // Always fetch to ensure we have the actual video channel, not playlist owner
    if (allItems.length > 0) {
      log('Fetching video details for channel names and durations', { count: allItems.length });

      for (let i = 0; i < allItems.length; i += 50) {
        const batch = allItems.slice(i, i + 50);
        const videoIds = batch.map(item => item.videoId).join(',');

        const videoResp = await youtube.videos.list({
          part: 'snippet,contentDetails',
          id: videoIds,
        });

        trackQuota('videos.list', 1);

        // Update channel info and duration for these items
        videoResp.data.items.forEach(video => {
          const item = allItems.find(i => i.videoId === video.id);
          if (item) {
            item.channelName = video.snippet.channelTitle;
            item.channelId = video.snippet.channelId;
            item.duration = video.contentDetails.duration;
          }
        });
      }
    }

    log('Playlist items fetched', { count: allItems.length, pages: pageCount });

    res.json({ items: allItems, count: allItems.length });
  } catch (err) {
    log('Playlist items fetch error', { error: err.message });
    console.error('Playlist items fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Serve playlist page
// ---------------------------------------------------------------------------
app.get('/playlist', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'playlist.html'));
});

// ---------------------------------------------------------------------------
// Catch-all: serve the SPA
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`\n  🎬 YouTube Subs Viewer running at http://localhost:${PORT}\n`);
  console.log(`  📡 WebSocket server ready for real-time playlist updates\n`);
});
