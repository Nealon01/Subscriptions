/**
 * YouTube Data API service — the single source of truth for all API interactions.
 *
 * Every function takes its dependencies as parameters for testability:
 *   - youtube: authenticated googleapis youtube client
 *   - db: database service module (or subset of functions needed)
 *   - quota: quota service module (or subset of functions needed)
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a channel ID (UC...) to its uploads playlist ID (UU...).
 * YouTube stores every channel's uploads in a playlist whose ID is the
 * channel ID with the 'UC' prefix replaced by 'UU'.
 * @param {string} channelId
 * @returns {string}
 */
export function getUploadsPlaylistId(channelId) {
  if (channelId.startsWith('UC')) {
    return 'UU' + channelId.slice(2);
  }
  return channelId;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * Fetch all subscriptions for the authenticated user, paging through all results.
 * Cost: 1 unit per page (50 results per page).
 *
 * @param {object} youtube - googleapis youtube client
 * @param {object} quota - quota service { trackQuota, canSpend }
 * @returns {Promise<Array<{ channelId: string, title: string, thumbnail: string }>>}
 */
export async function fetchAllSubscriptions(youtube, quota) {
  const subscriptions = [];
  let pageToken = undefined;

  do {
    if (!quota.canSpend(1)) {
      console.log('[youtube] Quota budget reached during subscription fetch');
      break;
    }

    const response = await youtube.subscriptions.list({
      part: 'snippet',
      mine: true,
      maxResults: 50,
      pageToken,
    });

    quota.trackQuota('subscriptions.list', 1);

    const items = response.data.items || [];
    for (const item of items) {
      subscriptions.push({
        channelId: item.snippet.resourceId.channelId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails?.default?.url || '',
      });
    }

    pageToken = response.data.nextPageToken;
  } while (pageToken);

  console.log(`[youtube] Fetched ${subscriptions.length} subscriptions`);
  return subscriptions;
}

// ---------------------------------------------------------------------------
// Channel Videos (Incremental Refresh)
// ---------------------------------------------------------------------------

/**
 * Fetch new videos from a channel's uploads playlist using incremental refresh.
 * Stops when it encounters a video ID that already exists in the database.
 *
 * IMPORTANT: The caller must upsert the channel BEFORE calling this function
 * so that FK integrity is maintained when videos are inserted.
 *
 * Cost: 1 unit per page (50 results per page).
 *
 * @param {object} youtube - googleapis youtube client
 * @param {{ channelId: string, channelName: string, uploadsPlaylistId: string }} channel
 * @param {object} db - database service { getChannelVideoIds, insertVideos, upsertChannel }
 * @param {object} quota - quota service { trackQuota, canSpend }
 * @param {object} [options={}]
 * @param {number} [options.maxPages=Infinity] - Max pages to fetch (1 for first-time channels)
 * @returns {Promise<Array<object>>} All newly fetched videos (before enrichment)
 */
export async function fetchChannelVideos(youtube, channel, db, quota, options = {}) {
  const { maxPages = Infinity } = options;
  const uploadsPlaylistId = channel.uploadsPlaylistId || getUploadsPlaylistId(channel.channelId);
  const knownIds = db.getChannelVideoIds(channel.channelId);
  const newVideos = [];
  let pageToken = undefined;
  let hitKnown = false;
  let pagesProcessed = 0;

  do {
    if (!quota.canSpend(1)) {
      console.log(`[youtube] Quota budget reached while fetching videos for ${channel.channelName}`);
      break;
    }

    const response = await youtube.playlistItems.list({
      part: 'snippet',
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken,
    });

    quota.trackQuota('playlistItems.list', 1);
    pagesProcessed++;

    const items = response.data.items || [];

    for (const item of items) {
      const videoId = item.snippet.resourceId?.videoId;
      if (!videoId) continue;

      if (knownIds.has(videoId)) {
        hitKnown = true;
        break;
      }

      newVideos.push({
        videoId,
        channelId: channel.channelId,
        title: item.snippet.title,
        channelName: channel.channelName,
        published: item.snippet.publishedAt,
        thumbnail: item.snippet.thumbnails?.medium?.url
          || item.snippet.thumbnails?.default?.url
          || '',
        description: item.snippet.description || '',
      });
    }

    if (hitKnown) break;
    if (pagesProcessed >= maxPages) break;
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  console.log(`[youtube] ${channel.channelName}: ${newVideos.length} new videos`);
  return newVideos;
}

// ---------------------------------------------------------------------------
// Video Enrichment (duration + views)
// ---------------------------------------------------------------------------

/**
 * Enrich videos with duration and view count by calling videos.list in batches of 50.
 * Cost: 1 unit per batch.
 *
 * @param {object} youtube - googleapis youtube client
 * @param {Array<{ videoId: string }>} videos - Videos to enrich
 * @param {object} quota - quota service { trackQuota, canSpend }
 * @returns {Promise<Array<{ videoId: string, duration: string, views: number }>>}
 */
export async function enrichVideos(youtube, videos, quota) {
  if (!videos || videos.length === 0) return [];

  const enriched = [];

  // Process in batches of 50
  for (let i = 0; i < videos.length; i += 50) {
    if (!quota.canSpend(1)) {
      console.log('[youtube] Quota budget reached during video enrichment');
      break;
    }

    const batch = videos.slice(i, i + 50);
    const ids = batch.map(v => v.videoId).join(',');

    const response = await youtube.videos.list({
      part: 'contentDetails,statistics',
      id: ids,
    });

    quota.trackQuota('videos.list', 1);

    const items = response.data.items || [];
    for (const item of items) {
      enriched.push({
        videoId: item.id,
        duration: item.contentDetails?.duration || null,
        views: parseInt(item.statistics?.viewCount || '0', 10),
      });
    }
  }

  return enriched;
}

// ---------------------------------------------------------------------------
// Backfill (resume from saved page token)
// ---------------------------------------------------------------------------

/**
 * Continue backfilling a channel's video history from where we left off.
 * Uses the saved next_page_token to resume fetching older videos.
 *
 * IMPORTANT: The channel must already exist in the database.
 *
 * Cost: 1 unit per page.
 *
 * @param {object} youtube - googleapis youtube client
 * @param {{ channelId: string, channelName: string, uploadsPlaylistId: string, nextPageToken?: string, backfillComplete?: number }} channel
 * @param {object} db - database service { insertVideos, upsertChannel }
 * @param {object} quota - quota service { trackQuota, canSpend }
 * @returns {Promise<{ videosFound: number, complete: boolean }>}
 */
export async function backfillChannel(youtube, channel, db, quota) {
  if (channel.backfillComplete) {
    return { videosFound: 0, complete: true };
  }

  const uploadsPlaylistId = channel.uploadsPlaylistId || getUploadsPlaylistId(channel.channelId);
  let pageToken = channel.nextPageToken || undefined;
  let totalFound = 0;
  let complete = false;

  // If no pageToken and no backfillComplete flag, start from the beginning.
  // But typically this is called after the initial incremental fetch has run,
  // so pageToken should be set.

  do {
    if (!quota.canSpend(1)) {
      console.log(`[youtube] Quota budget reached during backfill for ${channel.channelName}`);
      // Save progress so we can resume later
      db.upsertChannel({
        channelId: channel.channelId,
        channelName: channel.channelName,
        uploadsPlaylistId,
        nextPageToken: pageToken || null,
        backfillComplete: 0,
      });
      break;
    }

    const response = await youtube.playlistItems.list({
      part: 'snippet',
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken,
    });

    quota.trackQuota('playlistItems.list', 1);

    const items = response.data.items || [];
    const videos = items
      .filter(item => item.snippet.resourceId?.videoId)
      .map(item => ({
        videoId: item.snippet.resourceId.videoId,
        channelId: channel.channelId,
        title: item.snippet.title,
        channelName: channel.channelName,
        published: item.snippet.publishedAt,
        thumbnail: item.snippet.thumbnails?.medium?.url
          || item.snippet.thumbnails?.default?.url
          || '',
        description: item.snippet.description || '',
      }));

    if (videos.length > 0) {
      db.insertVideos(videos);
      totalFound += videos.length;
    }

    pageToken = response.data.nextPageToken;

    if (!pageToken) {
      complete = true;
      // Mark backfill as finished
      db.upsertChannel({
        channelId: channel.channelId,
        channelName: channel.channelName,
        uploadsPlaylistId,
        nextPageToken: null,
        backfillComplete: 1,
      });
    } else {
      // Save progress page token
      db.upsertChannel({
        channelId: channel.channelId,
        channelName: channel.channelName,
        uploadsPlaylistId,
        nextPageToken: pageToken,
        backfillComplete: 0,
      });
    }
  } while (pageToken);

  console.log(`[youtube] Backfill ${channel.channelName}: ${totalFound} videos, complete=${complete}`);
  return { videosFound: totalFound, complete };
}
