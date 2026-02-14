/**
 * Tests for server/services/database.js
 *
 * Uses a real in-memory SQLite database (not mocked) to verify:
 * - Channel CRUD and upsert behavior
 * - Video insertion with dedup (INSERT OR IGNORE)
 * - Sort order (published DESC)
 * - Foreign key integrity
 * - Session CRUD operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, closeTestDatabase } from '../helpers/mock-database.js';
import { createChannel, createVideo, createVideosForChannel } from '../helpers/fixtures.js';
import { resetCounters } from '../helpers/fixtures.js';

describe('database service', () => {
  let db;

  beforeEach(() => {
    resetCounters();
    db = createTestDatabase();
  });

  afterEach(() => {
    closeTestDatabase();
  });

  // -----------------------------------------------------------------------
  // Channel operations
  // -----------------------------------------------------------------------

  describe('upsertChannel', () => {
    it('creates a new channel and retrieves it correctly', () => {
      const channel = createChannel({ channelId: 'UCtest001', channelName: 'My Channel' });
      db.upsertChannel(channel);

      const result = db.getChannel('UCtest001');
      expect(result).toBeDefined();
      expect(result.channel_id).toBe('UCtest001');
      expect(result.channel_name).toBe('My Channel');
    });

    it('updates an existing channel on conflict (upsert)', () => {
      const channel = createChannel({ channelId: 'UCtest002', channelName: 'Original Name' });
      db.upsertChannel(channel);

      // Upsert with new name
      db.upsertChannel({ channelId: 'UCtest002', channelName: 'Updated Name' });

      const result = db.getChannel('UCtest002');
      expect(result.channel_name).toBe('Updated Name');
    });
  });

  // -----------------------------------------------------------------------
  // Video operations
  // -----------------------------------------------------------------------

  describe('insertVideos', () => {
    it('inserts videos via transaction', () => {
      const channel = createChannel({ channelId: 'UCvid001', channelName: 'Video Channel' });
      db.upsertChannel(channel);

      const videos = createVideosForChannel('UCvid001', 5, { channelName: 'Video Channel' });
      const { inserted } = db.insertVideos(videos);

      expect(inserted).toBe(5);
      expect(db.totalVideos()).toBe(5);
    });

    it('handles duplicate videoIds with INSERT OR IGNORE', () => {
      const channel = createChannel({ channelId: 'UCdup001', channelName: 'Dup Channel' });
      db.upsertChannel(channel);

      const video = createVideo({
        videoId: 'vid_duplicate',
        channelId: 'UCdup001',
        channelName: 'Dup Channel',
        title: 'Original Title',
      });

      // Insert once
      db.insertVideos([video]);
      expect(db.totalVideos()).toBe(1);

      // Insert same videoId again (should be ignored)
      const dupe = { ...video, title: 'Different Title' };
      const { inserted } = db.insertVideos([dupe]);
      expect(inserted).toBe(0);
      expect(db.totalVideos()).toBe(1);

      // Original title should be preserved (IGNORE means skip, not update)
      const allVideos = db.getAllVideos();
      expect(allVideos[0].title).toBe('Original Title');
    });
  });

  describe('getAllVideos', () => {
    it('returns videos in published DESC order (newest first)', () => {
      const channel = createChannel({ channelId: 'UCsort001', channelName: 'Sort Channel' });
      db.upsertChannel(channel);

      const videos = [
        createVideo({
          videoId: 'vid_old',
          channelId: 'UCsort001',
          channelName: 'Sort Channel',
          published: '2026-01-01T00:00:00Z',
          title: 'Old Video',
        }),
        createVideo({
          videoId: 'vid_new',
          channelId: 'UCsort001',
          channelName: 'Sort Channel',
          published: '2026-02-01T00:00:00Z',
          title: 'New Video',
        }),
        createVideo({
          videoId: 'vid_mid',
          channelId: 'UCsort001',
          channelName: 'Sort Channel',
          published: '2026-01-15T00:00:00Z',
          title: 'Mid Video',
        }),
      ];

      db.insertVideos(videos);

      const result = db.getAllVideos();
      expect(result).toHaveLength(3);
      expect(result[0].title).toBe('New Video');
      expect(result[1].title).toBe('Mid Video');
      expect(result[2].title).toBe('Old Video');
    });
  });

  // -----------------------------------------------------------------------
  // Foreign key integrity
  // -----------------------------------------------------------------------

  describe('foreign key constraints', () => {
    it('fails to insert a video without a matching channel', () => {
      const video = createVideo({
        videoId: 'vid_orphan',
        channelId: 'UCnonexistent',
        channelName: 'Ghost Channel',
      });

      expect(() => db.insertVideos([video])).toThrow();
    });

    it('succeeds when channel is upserted first, then video is inserted', () => {
      const channelId = 'UCfk001';
      db.upsertChannel(createChannel({ channelId, channelName: 'FK Channel' }));

      const video = createVideo({
        videoId: 'vid_fk_ok',
        channelId,
        channelName: 'FK Channel',
      });

      const { inserted } = db.insertVideos([video]);
      expect(inserted).toBe(1);

      const allVideos = db.getAllVideos();
      expect(allVideos).toHaveLength(1);
      expect(allVideos[0].videoId).toBe('vid_fk_ok');
    });
  });

  // -----------------------------------------------------------------------
  // Session operations
  // -----------------------------------------------------------------------

  describe('sessions', () => {
    it('creates, retrieves, touches, and destroys a session', () => {
      const sid = 'test-session-001';
      const tokens = { access_token: 'at123', refresh_token: 'rt456' };
      const settings = { theme: 'dark' };

      // Create
      db.saveSession(sid, tokens, settings);

      // Retrieve
      const session = db.getSession(sid);
      expect(session).toBeDefined();
      expect(session.sid).toBe(sid);
      expect(JSON.parse(session.tokens_json)).toEqual(tokens);
      expect(JSON.parse(session.settings_json)).toEqual(settings);
      expect(session.created_at).toBeGreaterThan(0);

      const originalLastUsed = session.last_used;

      // Touch (update last_used)
      // Small delay to ensure timestamp changes
      const before = Date.now();
      db.touchSession(sid);
      const after = Date.now();

      const touched = db.getSession(sid);
      expect(touched.last_used).toBeGreaterThanOrEqual(before);
      expect(touched.last_used).toBeLessThanOrEqual(after);

      // Destroy
      db.destroySession(sid);
      const destroyed = db.getSession(sid);
      expect(destroyed).toBeUndefined();
    });
  });
});
