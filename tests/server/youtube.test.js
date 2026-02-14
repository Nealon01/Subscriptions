/**
 * Tests for server/services/youtube.js — THE CRITICAL TEST FILE
 *
 * Uses the mock YouTube client (zero quota cost) and a real in-memory SQLite DB.
 * Validates the refresh pipeline that is the single most important code path:
 * - Subscription fetching with pagination
 * - Incremental refresh (stop at known videoId)
 * - Budget enforcement (stop when canSpend returns false)
 * - Video enrichment batching
 * - Backfill resume from saved page token
 * - Full refresh simulation with quota cost verification
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockYouTube } from '../helpers/mock-youtube.js';
import { createTestDatabase, closeTestDatabase } from '../helpers/mock-database.js';
import {
  createChannel,
  createChannels,
  createVideo,
  createVideosForChannel,
  createVideoDetails,
  resetCounters,
} from '../helpers/fixtures.js';

import {
  fetchAllSubscriptions,
  fetchChannelVideos,
  enrichVideos,
  backfillChannel,
} from '../../server/services/youtube.js';

describe('youtube service', () => {
  let testDb;

  // Create a minimal quota service that delegates to our test database
  function createTestQuota(budgetOverride) {
    let totalTracked = 0;
    const budget = budgetOverride ?? 8000;

    return {
      trackQuota(operation, units) {
        totalTracked += units;
      },
      canSpend(units) {
        return (totalTracked + units) <= budget;
      },
      getStatus() {
        return {
          used: totalTracked,
          budget,
          remaining: Math.max(0, budget - totalTracked),
        };
      },
      getTotalTracked() {
        return totalTracked;
      },
    };
  }

  beforeEach(() => {
    resetCounters();
    testDb = createTestDatabase();
  });

  afterEach(() => {
    closeTestDatabase();
  });

  // -----------------------------------------------------------------------
  // fetchAllSubscriptions
  // -----------------------------------------------------------------------

  describe('fetchAllSubscriptions', () => {
    it('pages through all results and tracks quota correctly', async () => {
      // Create 120 channels — should require 3 pages (50 + 50 + 20)
      const channels = [];
      for (let i = 0; i < 120; i++) {
        channels.push({ channelId: `UC${String(i).padStart(22, '0')}`, title: `Channel ${i}` });
      }

      const youtube = createMockYouTube({ channels });
      const quota = createTestQuota();

      const result = await fetchAllSubscriptions(youtube, quota);

      // Should get all 120 channels
      expect(result).toHaveLength(120);

      // Should have made 3 API calls (3 pages of 50)
      expect(youtube.getCallCount('subscriptions.list')).toBe(3);

      // Each call costs 1 unit, so total tracked quota should be 3
      expect(quota.getTotalTracked()).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // fetchChannelVideos
  // -----------------------------------------------------------------------

  describe('fetchChannelVideos', () => {
    it('stops when hitting a known videoId (incremental refresh)', async () => {
      const channelId = 'UCincr00000000000000001';
      const channelName = 'Incremental Channel';
      const uploadsPlaylistId = 'UUincr00000000000000001';

      // Set up: channel already exists in DB with some known videos
      testDb.upsertChannel({
        channelId,
        channelName,
        uploadsPlaylistId,
      });
      testDb.insertVideos([
        {
          videoId: 'known_vid_3',
          channelId,
          title: 'Known Video 3',
          channelName,
          published: '2026-01-01T00:00:00Z',
        },
      ]);

      // Mock returns 5 videos: 2 new, then the known one, then 2 more after it
      const youtube = createMockYouTube({
        channelVideos: {
          [channelId]: [
            { videoId: 'new_vid_1', title: 'New Video 1', published: '2026-02-03T00:00:00Z' },
            { videoId: 'new_vid_2', title: 'New Video 2', published: '2026-02-02T00:00:00Z' },
            { videoId: 'known_vid_3', title: 'Known Video 3', published: '2026-01-01T00:00:00Z' },
            { videoId: 'old_vid_4', title: 'Old Video 4', published: '2025-12-15T00:00:00Z' },
            { videoId: 'old_vid_5', title: 'Old Video 5', published: '2025-12-01T00:00:00Z' },
          ],
        },
      });

      const quota = createTestQuota();
      const { videos: result } = await fetchChannelVideos(
        youtube,
        { channelId, channelName, uploadsPlaylistId },
        testDb,
        quota
      );

      // Should only return the 2 new videos (stopped at known_vid_3)
      expect(result).toHaveLength(2);
      expect(result[0].videoId).toBe('new_vid_1');
      expect(result[1].videoId).toBe('new_vid_2');

      // Only 1 API call needed (all videos fit on first page)
      expect(youtube.getCallCount('playlistItems.list')).toBe(1);
    });

    it('stops when canSpend returns false (budget enforcement)', async () => {
      const channelId = 'UCbudg00000000000000001';
      const channelName = 'Budget Channel';
      const uploadsPlaylistId = 'UUbudg00000000000000001';

      // Create 120 videos (needs 3 pages)
      const videos = [];
      for (let i = 0; i < 120; i++) {
        videos.push({
          videoId: `budget_vid_${i}`,
          title: `Budget Video ${i}`,
          published: new Date(Date.now() - i * 3600000).toISOString(),
        });
      }

      const youtube = createMockYouTube({
        channelVideos: { [channelId]: videos },
      });

      // Budget of only 2 — should stop after 2 pages
      const quota = createTestQuota(2);

      const { videos: result } = await fetchChannelVideos(
        youtube,
        { channelId, channelName, uploadsPlaylistId },
        testDb,
        quota
      );

      // Should have made exactly 2 API calls then stopped
      expect(youtube.getCallCount('playlistItems.list')).toBe(2);
      // Should have fetched 100 videos (2 pages of 50)
      expect(result).toHaveLength(100);
    });

    it('returns correct video shape', async () => {
      const channelId = 'UCshap00000000000000001';
      const channelName = 'Shape Channel';
      const uploadsPlaylistId = 'UUshap00000000000000001';

      const youtube = createMockYouTube({
        channelVideos: {
          [channelId]: [
            {
              videoId: 'shape_vid_1',
              title: 'Shape Test',
              published: '2026-02-10T12:00:00Z',
              thumbnail: 'https://example.com/thumb.jpg',
              description: 'A test description',
            },
          ],
        },
      });

      const quota = createTestQuota();
      const { videos: result } = await fetchChannelVideos(
        youtube,
        { channelId, channelName, uploadsPlaylistId },
        testDb,
        quota
      );

      expect(result).toHaveLength(1);
      const video = result[0];
      expect(video).toMatchObject({
        videoId: 'shape_vid_1',
        channelId,
        title: 'Shape Test',
        channelName,
        published: '2026-02-10T12:00:00Z',
        description: 'A test description',
      });
      // Thumbnail should be present
      expect(video.thumbnail).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // enrichVideos
  // -----------------------------------------------------------------------

  describe('enrichVideos', () => {
    it('batches in groups of 50 (120 videos = exactly 3 API calls)', async () => {
      // Create 120 video stubs and their details
      const videos = [];
      const videoDetails = {};
      for (let i = 0; i < 120; i++) {
        const id = `enrich_vid_${String(i).padStart(3, '0')}`;
        videos.push({ videoId: id });
        videoDetails[id] = { duration: 'PT4M13S', viewCount: '12345' };
      }

      const youtube = createMockYouTube({ videoDetails });
      const quota = createTestQuota();

      const result = await enrichVideos(youtube, videos, quota);

      // Should return all 120 enriched results
      expect(result).toHaveLength(120);

      // Should have made exactly 3 API calls (50 + 50 + 20)
      expect(youtube.getCallCount('videos.list')).toBe(3);

      // Total quota cost: 3 units (1 per batch)
      expect(quota.getTotalTracked()).toBe(3);
    });

    it('populates duration and viewCount correctly', async () => {
      const videoDetails = {
        vid_a: { duration: 'PT1H2M3S', viewCount: '999999' },
        vid_b: { duration: 'PT30S', viewCount: '42' },
      };

      const youtube = createMockYouTube({ videoDetails });
      const quota = createTestQuota();

      const result = await enrichVideos(
        youtube,
        [{ videoId: 'vid_a' }, { videoId: 'vid_b' }],
        quota
      );

      expect(result).toHaveLength(2);

      const vidA = result.find((v) => v.videoId === 'vid_a');
      expect(vidA.duration).toBe('PT1H2M3S');
      expect(vidA.views).toBe(999999);

      const vidB = result.find((v) => v.videoId === 'vid_b');
      expect(vidB.duration).toBe('PT30S');
      expect(vidB.views).toBe(42);
    });
  });

  // -----------------------------------------------------------------------
  // backfillChannel
  // -----------------------------------------------------------------------

  describe('backfillChannel', () => {
    it('resumes from saved next_page_token', async () => {
      const channelId = 'UCback00000000000000001';
      const channelName = 'Backfill Channel';
      const uploadsPlaylistId = 'UUback00000000000000001';

      // Create 80 videos (will need 2 pages: 50 + 30)
      const videos = [];
      for (let i = 0; i < 80; i++) {
        videos.push({
          videoId: `back_vid_${String(i).padStart(3, '0')}`,
          title: `Backfill Video ${i}`,
          published: new Date(Date.now() - i * 3600000).toISOString(),
        });
      }

      const youtube = createMockYouTube({
        channelVideos: { [channelId]: videos },
      });

      // First: simulate that we already fetched page 0, so we start at page_1
      testDb.upsertChannel({
        channelId,
        channelName,
        uploadsPlaylistId,
        nextPageToken: 'page_1', // Resume from second page
      });

      const quota = createTestQuota();
      const result = await backfillChannel(
        youtube,
        { channelId, channelName, uploadsPlaylistId, nextPageToken: 'page_1' },
        testDb,
        quota
      );

      // Should only have fetched page 1 (the second page of 30 videos)
      expect(youtube.getCallCount('playlistItems.list')).toBe(1);

      // Should have found 30 videos (remaining from page 1)
      expect(result.videosFound).toBe(30);
      expect(result.complete).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Full refresh simulation
  // -----------------------------------------------------------------------

  describe('full refresh simulation', () => {
    it('50 channels with 10 videos each — verify total quota cost', async () => {
      // Build 50 channels, each with 10 videos (1 page each)
      const channels = [];
      const channelVideos = {};
      const allVideoDetails = {};

      for (let c = 0; c < 50; c++) {
        const channelId = `UCfull${String(c).padStart(18, '0')}`;
        const channelName = `Full Channel ${c}`;
        channels.push({ channelId, title: channelName });

        channelVideos[channelId] = [];
        for (let v = 0; v < 10; v++) {
          const videoId = `full_vid_${c}_${v}`;
          channelVideos[channelId].push({
            videoId,
            title: `Video ${v} of Channel ${c}`,
            published: new Date(Date.now() - v * 3600000).toISOString(),
          });
          allVideoDetails[videoId] = {
            duration: 'PT5M0S',
            viewCount: '1000',
          };
        }
      }

      const youtube = createMockYouTube({
        channels,
        channelVideos,
        videoDetails: allVideoDetails,
      });

      const quota = createTestQuota();

      // Step 1: Fetch subscriptions
      // 50 channels = 1 page (50 per page), costs 1 unit
      const subs = await fetchAllSubscriptions(youtube, quota);
      expect(subs).toHaveLength(50);

      // Step 2: Fetch videos for each channel
      // fetchChannelVideos does NOT insert into DB — it returns new videos.
      // The caller is responsible for upserting channels and inserting videos.
      // 50 channels * 1 page each = 50 units
      const allNewVideos = [];
      for (const sub of subs) {
        const uploadsPlaylistId = 'UU' + sub.channelId.slice(2);

        // Upsert channel first (FK integrity) — as a real caller would
        testDb.upsertChannel({
          channelId: sub.channelId,
          channelName: sub.title,
          uploadsPlaylistId,
        });

        const { videos: newVideos } = await fetchChannelVideos(
          youtube,
          {
            channelId: sub.channelId,
            channelName: sub.title,
            uploadsPlaylistId,
          },
          testDb,
          quota
        );

        if (newVideos.length > 0) {
          testDb.insertVideos(newVideos);
          allNewVideos.push(...newVideos);
        }
      }
      expect(allNewVideos).toHaveLength(500); // 50 channels * 10 videos

      // Step 3: Enrich all videos
      // 500 videos / 50 per batch = 10 API calls, 10 units
      const enriched = await enrichVideos(
        youtube,
        allNewVideos.map((v) => ({ videoId: v.videoId })),
        quota
      );
      expect(enriched).toHaveLength(500);

      // Total quota: 1 (subs) + 50 (video fetches) + 10 (enrichment) = 61 units
      expect(quota.getTotalTracked()).toBe(61);

      // Verify the mock's internal tracking matches
      expect(youtube.getQuotaCost()).toBe(61);
    });
  });
});
