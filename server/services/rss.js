/**
 * RSS feed service for YouTube channels.
 *
 * Fetches and parses YouTube's free RSS feeds to detect new videos
 * without consuming API quota. Each channel has a feed at:
 *   https://www.youtube.com/feeds/videos.xml?channel_id=UC...
 *
 * Returns the last ~15 videos with all fields needed for insertVideos
 * except duration (which requires API enrichment).
 */

import { XMLParser } from 'fast-xml-parser';

const RSS_BASE = 'https://www.youtube.com/feeds/videos.xml';
const FETCH_TIMEOUT = 15000; // 15 seconds

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  trimValues: true,
});

/**
 * Fetch and parse a single channel's RSS feed.
 *
 * @param {string} channelId - YouTube channel ID (UC...)
 * @param {string} channelName - Channel display name (used as fallback)
 * @returns {Promise<Array<{ videoId: string, channelId: string, title: string, channelName: string, published: string, thumbnail: string, description: string, views: number }>>}
 */
export async function fetchChannelRSS(channelId, channelName) {
  const url = `${RSS_BASE}?channel_id=${channelId}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    headers: { 'User-Agent': 'YouTube-Subscriptions-Viewer/1.0' },
  });

  if (!response.ok) {
    const err = new Error(`RSS fetch failed for ${channelName}: HTTP ${response.status}`);
    err.channelId = channelId;
    err.status = response.status;
    throw err;
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);

  const feed = parsed.feed;
  if (!feed) {
    const err = new Error(`RSS parse error for ${channelName}: no <feed> element`);
    err.channelId = channelId;
    throw err;
  }

  // Handle single entry (not wrapped in array) or no entries
  let entries = feed.entry || [];
  if (!Array.isArray(entries)) entries = [entries];

  return entries
    .filter((entry) => entry['yt:videoId'])
    .map((entry) => {
      const mediaGroup = entry['media:group'] || {};
      const community = mediaGroup['media:community'] || {};
      const stats = community['media:statistics'] || {};
      const thumbnail = mediaGroup['media:thumbnail'];

      return {
        videoId: entry['yt:videoId'],
        channelId,
        title: entry.title || '',
        channelName: entry.author?.name || channelName,
        published: entry.published || '',
        thumbnail: thumbnail?.['@_url'] || `https://i.ytimg.com/vi/${entry['yt:videoId']}/hqdefault.jpg`,
        description: (mediaGroup['media:description'] || '').slice(0, 200),
        views: parseInt(stats['@_views'] || '0', 10),
      };
    });
}

/**
 * Fetch new videos from a channel's RSS feed, filtering out known IDs.
 *
 * @param {string} channelId
 * @param {string} channelName
 * @param {Set<string>} knownVideoIds - Video IDs already in database
 * @returns {Promise<Array<object>>} Only new videos not in knownVideoIds
 */
export async function fetchNewVideosRSS(channelId, channelName, knownVideoIds) {
  const allVideos = await fetchChannelRSS(channelId, channelName);
  return allVideos.filter((v) => !knownVideoIds.has(v.videoId));
}
