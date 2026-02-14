import { Router } from 'express';
import { google } from 'googleapis';
import { requireAuth } from '../middleware/auth.js';
import { updateSessionTokens } from '../services/session.js';
import * as quota from '../services/quota.js';

const router = Router();

// All playlist routes require authentication
router.use(requireAuth);

/**
 * Create an authenticated YouTube client from session tokens.
 * Also sets up token refresh handling.
 * @param {object} req - Express request with session attached
 * @returns {import('googleapis').youtube_v3.Youtube}
 */
function createYouTubeClient(req) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback',
  );
  oauth2Client.setCredentials(req.session.tokens);

  oauth2Client.on('tokens', (newTokens) => {
    const merged = { ...req.session.tokens, ...newTokens };
    updateSessionTokens(req.sessionId, merged);
  });

  return google.youtube({ version: 'v3', auth: oauth2Client });
}

/**
 * POST /api/playlist/ensure
 * Finds or creates a "To Watch" playlist on the user's YouTube account.
 * Returns the playlist ID.
 *
 * Cost: 1 unit to list, 50 units to create (if needed)
 */
router.post('/ensure', async (req, res) => {
  try {
    const youtube = createYouTubeClient(req);

    if (!quota.canSpend(1)) {
      return res.status(429).json({ error: 'Daily quota budget reached' });
    }

    // Search for existing "To Watch" playlist
    const listResponse = await youtube.playlists.list({
      part: 'snippet',
      mine: true,
      maxResults: 50,
    });
    quota.trackQuota('playlists.list', 1);

    const existing = (listResponse.data.items || []).find(
      p => p.snippet.title === 'To Watch'
    );

    if (existing) {
      console.log(`[playlist] Found existing "To Watch" playlist: ${existing.id}`);
      return res.json({ playlistId: existing.id, title: existing.snippet.title, created: false });
    }

    // Create it if it doesn't exist
    if (!quota.canSpend(50)) {
      return res.status(429).json({ error: 'Insufficient quota to create playlist' });
    }

    const createResponse = await youtube.playlists.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: 'To Watch',
          description: 'Videos queued from YouTube Subscriptions Viewer',
        },
        status: {
          privacyStatus: 'private',
        },
      },
    });
    quota.trackQuota('playlists.insert', 50);

    console.log(`[playlist] Created new "To Watch" playlist: ${createResponse.data.id}`);
    res.json({
      playlistId: createResponse.data.id,
      title: createResponse.data.snippet.title,
      created: true,
    });
  } catch (err) {
    console.error('[playlist] Error ensuring playlist:', err.message);
    res.status(500).json({ error: 'Failed to ensure playlist: ' + err.message });
  }
});

/**
 * POST /api/playlist/add
 * Adds a video to the "To Watch" playlist at position 0 (top).
 *
 * Body: { playlistId: string, videoId: string }
 * Cost: 50 units
 */
router.post('/add', async (req, res) => {
  const { playlistId, videoId, videoMeta } = req.body;

  if (!playlistId || !videoId) {
    return res.status(400).json({ error: 'Missing playlistId or videoId' });
  }

  if (!quota.canSpend(50)) {
    return res.status(429).json({ error: 'Daily quota budget reached' });
  }

  try {
    const youtube = createYouTubeClient(req);

    const response = await youtube.playlistItems.insert({
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
    quota.trackQuota('playlistItems.insert', 50);

    const result = {
      playlistItemId: response.data.id,
      videoId,
      position: 0,
    };

    console.log(`[playlist] Added video ${videoId} to playlist ${playlistId}`);

    // Broadcast to all connected clients
    const broadcast = req.app.locals.broadcast;
    if (broadcast) {
      broadcast('videoAdded', { playlistId, videoId, playlistItemId: result.playlistItemId, videoMeta: videoMeta || null });
    }

    res.json(result);
  } catch (err) {
    console.error('[playlist] Error adding video:', err.message);
    res.status(500).json({ error: 'Failed to add video to playlist: ' + err.message });
  }
});

/**
 * POST /api/playlist/remove
 * Removes a video from the "To Watch" playlist.
 * First finds the playlistItem by videoId, then deletes it.
 *
 * Body: { playlistId: string, videoId: string }
 * Cost: 1 unit to find + 50 units to delete = 51 units
 */
router.post('/remove', async (req, res) => {
  const { playlistId, videoId } = req.body;

  if (!playlistId || !videoId) {
    return res.status(400).json({ error: 'Missing playlistId or videoId' });
  }

  if (!quota.canSpend(51)) {
    return res.status(429).json({ error: 'Daily quota budget reached' });
  }

  try {
    const youtube = createYouTubeClient(req);

    // Find the playlist item for this video
    let playlistItemId = null;
    let pageToken = undefined;

    searchLoop:
    do {
      if (!quota.canSpend(1)) break;

      const listResponse = await youtube.playlistItems.list({
        part: 'snippet',
        playlistId,
        maxResults: 50,
        pageToken,
      });
      quota.trackQuota('playlistItems.list', 1);

      for (const item of (listResponse.data.items || [])) {
        if (item.snippet.resourceId?.videoId === videoId) {
          playlistItemId = item.id;
          break searchLoop;
        }
      }

      pageToken = listResponse.data.nextPageToken;
    } while (pageToken);

    if (!playlistItemId) {
      return res.status(404).json({ error: 'Video not found in playlist' });
    }

    // Delete the playlist item
    if (!quota.canSpend(50)) {
      return res.status(429).json({ error: 'Insufficient quota to remove video' });
    }

    await youtube.playlistItems.delete({ id: playlistItemId });
    quota.trackQuota('playlistItems.delete', 50);

    // Broadcast to all connected clients
    const broadcast = req.app.locals.broadcast;
    if (broadcast) {
      broadcast('videoRemoved', { playlistId, videoId, playlistItemId });
    }

    console.log(`[playlist] Removed video ${videoId} from playlist ${playlistId}`);
    res.json({ removed: true, videoId, playlistItemId });
  } catch (err) {
    console.error('[playlist] Error removing video:', err.message);
    res.status(500).json({ error: 'Failed to remove video from playlist: ' + err.message });
  }
});

/**
 * POST /api/playlist/move
 * Moves a video to a new position in the playlist (top or bottom).
 * Finds the playlistItem by videoId, then updates its position.
 *
 * Body: { playlistId: string, videoId: string, to: 'top' | 'bottom' }
 * Cost: 1 unit to find + 50 units to update = 51 units
 */
router.post('/move', async (req, res) => {
  const { playlistId, videoId, to } = req.body;

  if (!playlistId || !videoId || !['top', 'bottom'].includes(to)) {
    return res.status(400).json({ error: 'Missing playlistId, videoId, or invalid "to" (top|bottom)' });
  }

  if (!quota.canSpend(51)) {
    return res.status(429).json({ error: 'Daily quota budget reached' });
  }

  try {
    const youtube = createYouTubeClient(req);

    // Find the playlist item for this video and count total items
    let playlistItemId = null;
    let totalItems = 0;
    let pageToken = undefined;

    searchLoop:
    do {
      if (!quota.canSpend(1)) break;

      const listResponse = await youtube.playlistItems.list({
        part: 'snippet',
        playlistId,
        maxResults: 50,
        pageToken,
      });
      quota.trackQuota('playlistItems.list', 1);

      totalItems = listResponse.data.pageInfo?.totalResults || 0;

      for (const item of (listResponse.data.items || [])) {
        if (item.snippet.resourceId?.videoId === videoId) {
          playlistItemId = item.id;
          break searchLoop;
        }
      }

      pageToken = listResponse.data.nextPageToken;
    } while (pageToken);

    if (!playlistItemId) {
      return res.status(404).json({ error: 'Video not found in playlist' });
    }

    if (!quota.canSpend(50)) {
      return res.status(429).json({ error: 'Insufficient quota to move video' });
    }

    const newPosition = to === 'top' ? 0 : Math.max(0, totalItems - 1);

    await youtube.playlistItems.update({
      part: 'snippet',
      requestBody: {
        id: playlistItemId,
        snippet: {
          playlistId,
          position: newPosition,
          resourceId: {
            kind: 'youtube#video',
            videoId,
          },
        },
      },
    });
    quota.trackQuota('playlistItems.update', 50);

    console.log(`[playlist] Moved video ${videoId} to ${to} (position ${newPosition})`);
    res.json({ moved: true, videoId, position: newPosition });
  } catch (err) {
    console.error('[playlist] Error moving video:', err.message);
    res.status(500).json({ error: 'Failed to move video: ' + err.message });
  }
});

/**
 * GET /api/playlist/items
 * Lists all items in the "To Watch" playlist with full video details.
 *
 * Query: { playlistId: string }
 * Cost: 1 unit per page + 1 unit per 50 videos for enrichment
 */
router.get('/items', async (req, res) => {
  const { playlistId } = req.query;

  if (!playlistId) {
    return res.status(400).json({ error: 'Missing playlistId query parameter' });
  }

  if (!quota.canSpend(1)) {
    return res.status(429).json({ error: 'Daily quota budget reached' });
  }

  try {
    const youtube = createYouTubeClient(req);

    // Fetch all playlist items
    const allItems = [];
    let pageToken = undefined;

    do {
      if (!quota.canSpend(1)) break;

      const response = await youtube.playlistItems.list({
        part: 'snippet',
        playlistId,
        maxResults: 50,
        pageToken,
      });
      quota.trackQuota('playlistItems.list', 1);

      const items = response.data.items || [];
      for (const item of items) {
        allItems.push({
          playlistItemId: item.id,
          videoId: item.snippet.resourceId?.videoId,
          title: item.snippet.title,
          channelName: item.snippet.videoOwnerChannelTitle || '',
          channelId: item.snippet.videoOwnerChannelId || '',
          thumbnail: item.snippet.thumbnails?.medium?.url
            || item.snippet.thumbnails?.default?.url
            || '',
          position: item.snippet.position,
          addedAt: item.snippet.publishedAt,
        });
      }

      pageToken = response.data.nextPageToken;
    } while (pageToken);

    // Enrich with duration and views (batch in groups of 50)
    if (allItems.length > 0) {
      const videoIds = allItems.map(i => i.videoId).filter(Boolean);

      for (let i = 0; i < videoIds.length; i += 50) {
        if (!quota.canSpend(1)) break;

        const batch = videoIds.slice(i, i + 50);
        const detailsResponse = await youtube.videos.list({
          part: 'contentDetails,statistics,snippet',
          id: batch.join(','),
        });
        quota.trackQuota('videos.list', 1);

        const detailsMap = new Map();
        for (const item of (detailsResponse.data.items || [])) {
          detailsMap.set(item.id, {
            duration: item.contentDetails?.duration || null,
            views: parseInt(item.statistics?.viewCount || '0', 10),
            channelName: item.snippet?.channelTitle || '',
            channelId: item.snippet?.channelId || '',
            published: item.snippet?.publishedAt || null,
          });
        }

        // Merge enrichment into items
        for (const playlistItem of allItems) {
          const details = detailsMap.get(playlistItem.videoId);
          if (details) {
            playlistItem.duration = details.duration;
            playlistItem.views = details.views;
            playlistItem.published = details.published;
            if (details.channelName) {
              playlistItem.channelName = details.channelName;
            }
            if (details.channelId) {
              playlistItem.channelId = details.channelId;
            }
          }
        }
      }
    }

    console.log(`[playlist] Listed ${allItems.length} items from playlist ${playlistId}`);
    res.json({
      playlistId,
      items: allItems,
      totalItems: allItems.length,
    });
  } catch (err) {
    console.error('[playlist] Error listing items:', err.message);
    res.status(500).json({ error: 'Failed to list playlist items: ' + err.message });
  }
});

export default router;
