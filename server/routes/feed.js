import { Router } from 'express';
import { google } from 'googleapis';
import { requireAuth } from '../middleware/auth.js';
import { updateSessionTokens } from '../services/session.js';
import {
  getAllVideos,
  getAllChannels,
  latestCheck,
  totalVideos,
  upsertChannel,
  getChannelVideoIds,
  insertVideos,
  updateVideoMeta,
} from '../services/database.js';
import {
  fetchAllSubscriptions,
  fetchChannelVideos,
  enrichVideos,
  getUploadsPlaylistId,
} from '../services/youtube.js';
import * as quota from '../services/quota.js';
import { broadcast } from '../services/websocket.js';

const router = Router();

let refreshInProgress = false;

/**
 * GET /api/feed
 * Returns all cached videos, channels, and cache metadata.
 */
router.get('/', (req, res) => {
  try {
    const videos = getAllVideos();
    const channels = getAllChannels();
    const lastChecked = latestCheck();
    const total = totalVideos();

    res.json({
      videos,
      channels,
      lastChecked,
      totalVideos: total,
      timestamp: lastChecked ? new Date(lastChecked).getTime() : null,
      quotaStatus: quota.getStatus(),
    });
  } catch (err) {
    console.error('[feed] Error fetching feed:', err);
    res.status(500).json({ error: 'Failed to fetch feed data' });
  }
});

/**
 * POST /api/feed/refresh
 * Key design:
 *   - Videos inserted PER CHANNEL immediately (crash-safe, no data loss)
 *   - Fresh channels only fetch 1 page (50 videos) to save quota
 *   - Enrichment at the end (cheap: 1 unit per 50 videos)
 *   - WebSocket messages use camelCase types to match frontend
 */
router.post('/refresh', requireAuth, async (req, res) => {
  if (refreshInProgress) {
    return res.json({ status: 'already_running' });
  }

  refreshInProgress = true;
  res.json({ status: 'started' });

  try {
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

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const db = {
      upsertChannel,
      getChannelVideoIds,
      insertVideos,
      updateVideoMeta,
    };

    broadcast('refreshStart', { timestamp: new Date().toISOString() });
    broadcast('refreshProgress', { phase: 'subscriptions' });

    // Step 1: Fetch all subscriptions
    let subscriptions;
    try {
      subscriptions = await fetchAllSubscriptions(youtube, quota);
    } catch (err) {
      console.error('[feed] Failed to fetch subscriptions:', err.message);
      broadcast('refreshError', { error: 'Failed to fetch subscriptions: ' + err.message });
      refreshInProgress = false;
      return;
    }

    // Step 2: For each channel, fetch new videos and INSERT IMMEDIATELY
    const allNewVideoIds = [];
    let channelsProcessed = 0;
    let totalNewVideos = 0;

    for (const sub of subscriptions) {
      if (!quota.canSpend(1)) {
        broadcast('refreshProgress', { phase: 'quota_limit' });
        console.log(`[feed] Quota budget reached after ${channelsProcessed} channels`);
        break;
      }

      const uploadsPlaylistId = getUploadsPlaylistId(sub.channelId);
      upsertChannel({
        channelId: sub.channelId,
        channelName: sub.title,
        thumbnail: sub.thumbnail,
        uploadsPlaylistId,
        lastChecked: new Date().toISOString(),
      });

      try {
        const channel = {
          channelId: sub.channelId,
          channelName: sub.title,
          uploadsPlaylistId,
        };

        // Fresh channels: 1 page only. Known channels: fetch until known video.
        const knownIds = getChannelVideoIds(sub.channelId);
        const isFresh = knownIds.size === 0;

        const newVideos = await fetchChannelVideos(youtube, channel, db, quota, {
          maxPages: isFresh ? 1 : Infinity,
        });

        // INSERT IMMEDIATELY — progress saved even if process is killed
        if (newVideos.length > 0) {
          insertVideos(newVideos);
          totalNewVideos += newVideos.length;
          allNewVideoIds.push(...newVideos.map(v => v.videoId));
        }

        // Mark backfill status for fresh channels
        if (isFresh) {
          upsertChannel({
            channelId: sub.channelId,
            channelName: sub.title,
            uploadsPlaylistId,
            backfillComplete: newVideos.length < 50 ? 1 : 0,
          });
        }
      } catch (err) {
        console.error(`[feed] Error fetching videos for ${sub.title}:`, err.message);
      }

      channelsProcessed++;

      if (channelsProcessed % 10 === 0 || channelsProcessed === subscriptions.length) {
        broadcast('refreshProgress', {
          phase: 'videos',
          processed: channelsProcessed,
          total: subscriptions.length,
        });
      }
    }

    // Step 3: Enrich new videos with duration/views
    if (allNewVideoIds.length > 0) {
      try {
        const videosToEnrich = allNewVideoIds.map(id => ({ videoId: id }));
        const enrichmentData = await enrichVideos(youtube, videosToEnrich, quota);
        if (enrichmentData.length > 0) {
          updateVideoMeta(enrichmentData);
          console.log(`[feed] Enriched ${enrichmentData.length} videos`);
        }
      } catch (err) {
        console.error('[feed] Error enriching videos:', err.message);
      }
    }

    const quotaStatus = quota.getStatus();
    broadcast('refreshComplete', {
      timestamp: new Date().toISOString(),
      newVideos: totalNewVideos,
      channelsProcessed,
      totalChannels: subscriptions.length,
      quotaStatus,
    });

    console.log(`[feed] Refresh complete: ${totalNewVideos} new videos from ${channelsProcessed} channels (${quotaStatus.used}/${quotaStatus.budget} quota)`);
  } catch (err) {
    console.error('[feed] Refresh pipeline error:', err);
    broadcast('refreshError', { error: err.message });
  } finally {
    refreshInProgress = false;
  }
});

export default router;
