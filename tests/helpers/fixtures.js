/**
 * Test data factory functions.
 * Creates realistic test data matching the shapes used in production code.
 */

let channelCounter = 0;
let videoCounter = 0;

/**
 * Reset counters between test suites to ensure predictable IDs.
 */
export function resetCounters() {
  channelCounter = 0;
  videoCounter = 0;
}

/**
 * Create a single channel object with realistic defaults.
 * @param {object} [overrides] - Properties to override
 * @returns {{ channelId: string, channelName: string, uploadsPlaylistId: string, lastChecked: string|null, backfillComplete: number, nextPageToken: string|null, totalResults: number }}
 */
export function createChannel(overrides = {}) {
  channelCounter++;
  const id = `UC${String(channelCounter).padStart(22, '0')}`;
  const uploadsId = `UU${String(channelCounter).padStart(22, '0')}`;
  return {
    channelId: id,
    channelName: `Test Channel ${channelCounter}`,
    uploadsPlaylistId: uploadsId,
    lastChecked: null,
    backfillComplete: 0,
    nextPageToken: null,
    totalResults: 0,
    ...overrides,
  };
}

/**
 * Create a single video object with realistic defaults.
 * @param {object} [overrides] - Properties to override
 * @returns {{ videoId: string, channelId: string, title: string, channelName: string, published: string, thumbnail: string, description: string, duration: string|null, views: number }}
 */
export function createVideo(overrides = {}) {
  videoCounter++;
  const channelNum = overrides.channelId
    ? parseInt(overrides.channelId.replace(/\D/g, ''), 10) || 1
    : 1;
  const defaultChannelId = `UC${String(channelNum).padStart(22, '0')}`;

  // Generate a date that's videoCounter hours ago so videos have different timestamps
  const published = new Date(Date.now() - videoCounter * 3600000).toISOString();

  return {
    videoId: `vid_${String(videoCounter).padStart(6, '0')}`,
    channelId: defaultChannelId,
    title: `Test Video ${videoCounter}`,
    channelName: `Test Channel ${channelNum}`,
    published,
    thumbnail: `https://i.ytimg.com/vi/vid_${String(videoCounter).padStart(6, '0')}/mqdefault.jpg`,
    description: `Description for test video ${videoCounter}`,
    duration: null,
    views: 0,
    ...overrides,
  };
}

/**
 * Create an array of channels with unique IDs.
 * @param {number} count - Number of channels to create
 * @param {object} [overrides] - Overrides applied to each channel
 * @returns {Array<object>}
 */
export function createChannels(count, overrides = {}) {
  return Array.from({ length: count }, () => createChannel(overrides));
}

/**
 * Create an array of videos for a specific channel.
 * @param {string} channelId - The channel ID to assign to each video
 * @param {number} count - Number of videos to create
 * @param {object} [overrides] - Additional overrides per video
 * @returns {Array<object>}
 */
export function createVideosForChannel(channelId, count, overrides = {}) {
  const channelNum = parseInt(channelId.replace(/\D/g, ''), 10) || 1;
  const channelName = overrides.channelName || `Test Channel ${channelNum}`;
  return Array.from({ length: count }, () =>
    createVideo({ channelId, channelName, ...overrides })
  );
}

/**
 * Create a video details object (as returned by enrichment / videos.list).
 * @param {string} videoId
 * @param {object} [overrides]
 * @returns {{ videoId: string, duration: string, viewCount: string }}
 */
export function createVideoDetails(videoId, overrides = {}) {
  return {
    videoId,
    duration: 'PT4M13S',
    viewCount: '12345',
    ...overrides,
  };
}
