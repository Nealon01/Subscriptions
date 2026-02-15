import { Router } from 'express';
import { google } from 'googleapis';
import { requireAuth } from '../middleware/auth.js';
import { updateSessionTokens } from '../services/session.js';
import {
  getAllVideos,
  getAllChannels,
  latestCheck,
  totalVideos,
  searchVideos,
  upsertChannel,
  getChannel,
  getChannelVideoIds,
  getChannelsNeedingBackfill,
  insertVideos,
  updateVideoMeta,
  setChannelError,
} from '../services/database.js';
import {
  fetchAllSubscriptions,
  enrichVideos,
  backfillChannel,
  getUploadsPlaylistId,
} from '../services/youtube.js';
import { fetchNewVideosRSS } from '../services/rss.js';
import * as quota from '../services/quota.js';
import { broadcast } from '../services/websocket.js';

const router = Router();

let refreshInProgress = false;

/**
 * GET /api/feed
 * Returns cached videos, channels, and cache metadata.
 * When ?q= is provided, performs FTS5 full-text search with pagination.
 *
 * Query params (all optional):
 *   q           - Search query (triggers FTS5 mode)
 *   timeRange   - 'today' | 'week' | 'month' | 'all' (default: 'all')
 *   durationMin - Min duration in minutes (default: 0)
 *   durationMax - Max duration in minutes (default: Infinity)
 *   limit       - Results per page, max 100 (default: 30)
 *   offset      - Pagination offset (default: 0)
 */
router.get('/', (req, res) => {
  try {
    const { q, timeRange, durationMin, durationMax, sort, limit, offset } = req.query;

    // FTS5 search mode
    if (q && q.trim()) {
      const durationFilter = {
        min: durationMin ? parseFloat(durationMin) : 0,
        max: durationMax ? parseFloat(durationMax) : Infinity,
      };

      const { results, total: searchTotal } = searchVideos({
        query: q.trim(),
        timeRange: timeRange || 'all',
        durationFilter,
        sort: sort === 'relevance' ? 'relevance' : 'date',
        limit: limit ? Math.min(parseInt(limit, 10), 100) : 30,
        offset: offset ? parseInt(offset, 10) : 0,
      });

      return res.json({
        videos: results,
        searchTotal,
        isSearch: true,
        channels: getAllChannels(),
        lastChecked: latestCheck(),
        totalVideos: totalVideos(),
        timestamp: latestCheck() ? new Date(latestCheck()).getTime() : null,
        quotaStatus: quota.getStatus(),
      });
    }

    // Standard feed mode (no search)
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

    // Step 2: For each channel, fetch new videos via RSS (free, no quota)
    const allNewVideoIds = [];
    let channelsProcessed = 0;
    let totalNewVideos = 0;
    let rssErrors = 0;
    const RSS_CONCURRENCY = 10;

    for (let i = 0; i < subscriptions.length; i += RSS_CONCURRENCY) {
      const batch = subscriptions.slice(i, i + RSS_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(async (sub) => {
          // Skip channels with persistent fetch errors
          const existingChannel = getChannel(sub.channelId);
          if (existingChannel?.fetch_error) {
            return { skipped: true };
          }

          // Upsert channel BEFORE video insert (FK integrity)
          const uploadsPlaylistId = getUploadsPlaylistId(sub.channelId);
          upsertChannel({
            channelId: sub.channelId,
            channelName: sub.title,
            thumbnail: sub.thumbnail,
            uploadsPlaylistId,
            lastChecked: new Date().toISOString(),
          });

          const knownIds = getChannelVideoIds(sub.channelId);
          const isFresh = knownIds.size === 0;

          const newVideos = await fetchNewVideosRSS(sub.channelId, sub.title, knownIds);

          // INSERT IMMEDIATELY — progress saved even if process is killed
          if (newVideos.length > 0) {
            insertVideos(newVideos);
          }

          // Fresh channels with videos need backfill for full history
          if (isFresh && newVideos.length > 0) {
            upsertChannel({
              channelId: sub.channelId,
              channelName: sub.title,
              uploadsPlaylistId,
              backfillComplete: 0,
            });
          }

          return { newCount: newVideos.length, videoIds: newVideos.map(v => v.videoId) };
        })
      );

      for (const result of results) {
        channelsProcessed++;
        if (result.status === 'fulfilled' && !result.value.skipped) {
          const { newCount, videoIds } = result.value;
          totalNewVideos += newCount;
          allNewVideoIds.push(...videoIds);
        } else if (result.status === 'rejected') {
          rssErrors++;
          const err = result.reason;
          if (err.status === 404) {
            if (err.channelId) setChannelError(err.channelId, 'rss_not_found');
          } else {
            console.error(`[feed] RSS error:`, err.message);
          }
        }
      }

      if (channelsProcessed % 50 === 0 || channelsProcessed >= subscriptions.length) {
        broadcast('refreshProgress', {
          phase: 'videos',
          processed: channelsProcessed,
          total: subscriptions.length,
        });
      }
    }

    console.log(`[feed] RSS complete: ${totalNewVideos} new videos from ${channelsProcessed} channels (${rssErrors} errors, 0 quota)`);

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

    // Step 4: Backfill channels with incomplete history using remaining quota
    let backfillVideos = 0;
    let backfillChannelsProcessed = 0;

    if (quota.canSpend(1)) {
      const channelsToBackfill = getChannelsNeedingBackfill();

      if (channelsToBackfill.length > 0) {
        broadcast('refreshProgress', { phase: 'backfill', total: channelsToBackfill.length });
        console.log(`[feed] Starting backfill for ${channelsToBackfill.length} channels`);

        for (const ch of channelsToBackfill) {
          if (!quota.canSpend(1)) {
            console.log(`[feed] Backfill paused — quota budget reached after ${backfillChannelsProcessed} channels`);
            break;
          }

          try {
            const result = await backfillChannel(youtube, ch, db, quota);
            backfillVideos += result.videosFound;
            backfillChannelsProcessed++;

            if (backfillChannelsProcessed % 20 === 0) {
              broadcast('refreshProgress', {
                phase: 'backfill',
                processed: backfillChannelsProcessed,
                total: channelsToBackfill.length,
              });
            }
          } catch (err) {
            const msg = err.message || '';
            if (msg.includes('playlistId') && msg.includes('cannot be found')) {
              console.warn(`[feed] Marking ${ch.channelName} as broken during backfill`);
              setChannelError(ch.channelId, 'playlist_not_found');
            } else {
              console.error(`[feed] Backfill error for ${ch.channelName}:`, msg);
            }
          }
        }

        console.log(`[feed] Backfill complete: ${backfillVideos} videos from ${backfillChannelsProcessed} channels`);
      }
    }

    const quotaStatus = quota.getStatus();
    broadcast('refreshComplete', {
      timestamp: new Date().toISOString(),
      newVideos: totalNewVideos,
      backfillVideos,
      channelsProcessed,
      totalChannels: subscriptions.length,
      quotaStatus,
    });

    console.log(`[feed] Refresh complete: ${totalNewVideos} new + ${backfillVideos} backfill videos from ${channelsProcessed} channels (${quotaStatus.used}/${quotaStatus.budget} quota)`);
  } catch (err) {
    console.error('[feed] Refresh pipeline error:', err);
    broadcast('refreshError', { error: err.message });
  } finally {
    refreshInProgress = false;
  }
});

export default router;
