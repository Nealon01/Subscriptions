/**
 * Mock YouTube API client factory.
 *
 * Returns a fake YouTube client that matches the real googleapis interface
 * (google.youtube('v3')). Tracks every API call for quota assertions.
 *
 * Usage:
 *   const youtube = createMockYouTube({
 *     channels: [{ channelId: 'UCxxx', title: 'My Channel' }],
 *     channelVideos: { 'UCxxx': [{ videoId: 'v1', title: 'Video 1', published: '...' }] },
 *     videoDetails: { 'v1': { duration: 'PT4M13S', viewCount: '12345' } },
 *   });
 */

const PAGE_SIZE = 50;

// Quota costs per YouTube Data API v3 documentation
const QUOTA_COSTS = {
  'subscriptions.list': 1,
  'playlistItems.list': 1,
  'videos.list': 1,
  'playlists.list': 1,
  'playlists.insert': 50,
  'playlistItems.insert': 50,
  'playlistItems.delete': 50,
};

/**
 * Paginate an array into pages, returning the requested page and a nextPageToken if more exist.
 * @param {Array} items - Full array of items
 * @param {number} pageSize - Items per page
 * @param {string|undefined} pageToken - Token indicating which page to return (format: "page_N")
 * @returns {{ pageItems: Array, nextPageToken: string|undefined }}
 */
function paginate(items, pageSize, pageToken) {
  const pageIndex = pageToken ? parseInt(pageToken.replace('page_', ''), 10) : 0;
  const start = pageIndex * pageSize;
  const end = start + pageSize;
  const pageItems = items.slice(start, end);
  const nextPageToken = end < items.length ? `page_${pageIndex + 1}` : undefined;
  return { pageItems, nextPageToken };
}

/**
 * Create a mock YouTube API client.
 *
 * @param {object} config
 * @param {Array<{ channelId: string, title: string, thumbnail?: string }>} [config.channels=[]] - Subscribed channels
 * @param {Object<string, Array<{ videoId: string, title: string, published: string, thumbnail?: string, description?: string }>>} [config.channelVideos={}] - Videos per channel (keyed by channelId)
 * @param {Object<string, { duration: string, viewCount: string }>} [config.videoDetails={}] - Video details (keyed by videoId)
 * @param {Array<{ playlistItemId: string, videoId: string, title: string }>} [config.playlistItems=[]] - Existing playlist items
 * @returns {object} Mock YouTube client with callLog and getQuotaCost()
 */
export function createMockYouTube(config = {}) {
  const {
    channels = [],
    channelVideos = {},
    videoDetails = {},
    playlistItems: initialPlaylistItems = [],
  } = config;

  /** @type {Array<{ method: string, params: object, timestamp: number }>} */
  const callLog = [];

  // Mutable copy of playlist items for insert/delete tests
  const playlistItems = [...initialPlaylistItems];
  let playlistItemIdCounter = playlistItems.length;

  function logCall(method, params) {
    callLog.push({ method, params: { ...params }, timestamp: Date.now() });
  }

  // -------------------------------------------------------------------------
  // subscriptions.list
  // -------------------------------------------------------------------------
  const subscriptionItems = channels.map((ch) => ({
    snippet: {
      resourceId: { channelId: ch.channelId },
      title: ch.title,
      thumbnails: {
        default: { url: ch.thumbnail || `https://yt3.ggpht.com/${ch.channelId}/default.jpg` },
      },
    },
  }));

  // -------------------------------------------------------------------------
  // Build the mock client
  // -------------------------------------------------------------------------
  const youtube = {
    callLog,

    /**
     * Calculate total quota cost from all logged API calls.
     * @returns {number}
     */
    getQuotaCost() {
      return callLog.reduce((sum, entry) => {
        const cost = QUOTA_COSTS[entry.method] || 0;
        return sum + cost;
      }, 0);
    },

    /**
     * Get call count for a specific method.
     * @param {string} method
     * @returns {number}
     */
    getCallCount(method) {
      return callLog.filter((e) => e.method === method).length;
    },

    subscriptions: {
      list: async (params = {}) => {
        logCall('subscriptions.list', params);

        const maxResults = params.maxResults || PAGE_SIZE;
        const { pageItems, nextPageToken } = paginate(
          subscriptionItems,
          maxResults,
          params.pageToken
        );

        return {
          data: {
            items: pageItems,
            pageInfo: {
              totalResults: subscriptionItems.length,
              resultsPerPage: maxResults,
            },
            nextPageToken,
          },
        };
      },
    },

    playlistItems: {
      list: async (params = {}) => {
        logCall('playlistItems.list', params);

        const playlistId = params.playlistId || '';
        const maxResults = params.maxResults || PAGE_SIZE;

        // Determine which items to return based on playlistId
        let items;

        // Check if this is a channel uploads playlist (UU prefix)
        if (playlistId.startsWith('UU')) {
          // Convert UU -> UC to find the channelId
          const channelId = 'UC' + playlistId.slice(2);
          const videos = channelVideos[channelId] || [];

          items = videos.map((v) => ({
            contentDetails: {
              videoId: v.videoId,
              videoPublishedAt: v.published,
            },
            snippet: {
              resourceId: { videoId: v.videoId },
              title: v.title,
              publishedAt: v.published,
              thumbnails: {
                medium: {
                  url: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
                },
              },
              description: v.description || '',
            },
          }));
        } else {
          // User playlist (e.g., "To Watch" playlist)
          items = playlistItems.map((pi) => ({
            id: pi.playlistItemId,
            contentDetails: {
              videoId: pi.videoId,
              videoPublishedAt: pi.published || new Date().toISOString(),
            },
            snippet: {
              resourceId: { videoId: pi.videoId },
              title: pi.title,
              publishedAt: pi.published || new Date().toISOString(),
              thumbnails: {
                medium: {
                  url: `https://i.ytimg.com/vi/${pi.videoId}/mqdefault.jpg`,
                },
              },
              description: pi.description || '',
            },
          }));
        }

        const { pageItems, nextPageToken } = paginate(items, maxResults, params.pageToken);

        return {
          data: {
            items: pageItems,
            pageInfo: {
              totalResults: items.length,
              resultsPerPage: maxResults,
            },
            nextPageToken,
          },
        };
      },

      insert: async (params = {}) => {
        logCall('playlistItems.insert', params);

        const videoId = params.requestBody?.snippet?.resourceId?.videoId || 'unknown';
        const newItem = {
          playlistItemId: `PLI_${++playlistItemIdCounter}`,
          videoId,
          title: `Queued Video ${videoId}`,
        };
        playlistItems.unshift(newItem); // Insert at position 0

        return {
          data: {
            id: newItem.playlistItemId,
            snippet: {
              resourceId: { videoId },
              title: newItem.title,
              position: 0,
            },
          },
        };
      },

      delete: async (params = {}) => {
        logCall('playlistItems.delete', params);

        const id = params.id;
        const index = playlistItems.findIndex((pi) => pi.playlistItemId === id);
        if (index !== -1) {
          playlistItems.splice(index, 1);
        }

        return { data: {} };
      },
    },

    videos: {
      list: async (params = {}) => {
        logCall('videos.list', params);

        // params.id is a comma-separated string of video IDs
        const ids = (params.id || '').split(',').filter(Boolean);
        const items = ids
          .map((id) => {
            const details = videoDetails[id];
            if (!details) return null;
            return {
              id,
              contentDetails: {
                duration: details.duration || 'PT0S',
              },
              statistics: {
                viewCount: String(details.viewCount || '0'),
              },
            };
          })
          .filter(Boolean);

        return {
          data: {
            items,
            pageInfo: {
              totalResults: items.length,
              resultsPerPage: ids.length,
            },
          },
        };
      },
    },

    playlists: {
      list: async (params = {}) => {
        logCall('playlists.list', params);

        // Return a single playlist for "mine" queries
        return {
          data: {
            items: [
              {
                id: 'PL_test_playlist_001',
                snippet: {
                  title: 'To Watch',
                  description: 'Auto-managed queue',
                },
              },
            ],
            pageInfo: { totalResults: 1, resultsPerPage: 5 },
          },
        };
      },

      insert: async (params = {}) => {
        logCall('playlists.insert', params);

        return {
          data: {
            id: 'PL_new_playlist_001',
            snippet: {
              title: params.requestBody?.snippet?.title || 'New Playlist',
              description: params.requestBody?.snippet?.description || '',
            },
          },
        };
      },
    },
  };

  return youtube;
}
