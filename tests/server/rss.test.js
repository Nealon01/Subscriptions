/**
 * Tests for server/services/rss.js
 *
 * Mocks global.fetch to return sample YouTube RSS XML.
 * Tests parsing, field mapping, incremental dedup, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchChannelRSS, fetchNewVideosRSS } from '../../server/services/rss.js';

// Sample RSS XML matching real YouTube format
const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <title>Test Channel</title>
  <yt:channelId>UCtest123</yt:channelId>
  <entry>
    <yt:videoId>vid_001</yt:videoId>
    <title>First Video</title>
    <published>2026-02-14T10:00:00+00:00</published>
    <author><name>Test Channel</name></author>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/vid_001/hqdefault.jpg" width="480" height="360"/>
      <media:description>A great video about testing</media:description>
      <media:community>
        <media:starRating count="100" average="4.9" min="1" max="5"/>
        <media:statistics views="5000"/>
      </media:community>
    </media:group>
  </entry>
  <entry>
    <yt:videoId>vid_002</yt:videoId>
    <title>Second Video</title>
    <published>2026-02-13T15:30:00+00:00</published>
    <author><name>Test Channel</name></author>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/vid_002/hqdefault.jpg" width="480" height="360"/>
      <media:description>Another video</media:description>
      <media:community>
        <media:statistics views="1200"/>
      </media:community>
    </media:group>
  </entry>
  <entry>
    <yt:videoId>vid_003</yt:videoId>
    <title>Third Video</title>
    <published>2026-02-12T08:00:00+00:00</published>
    <author><name>Test Channel</name></author>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/vid_003/hqdefault.jpg" width="480" height="360"/>
      <media:description>Yet another video</media:description>
      <media:community>
        <media:statistics views="300"/>
      </media:community>
    </media:group>
  </entry>
</feed>`;

// RSS with a single entry (not wrapped in array by parser)
const SINGLE_ENTRY_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <title>One Video Channel</title>
  <entry>
    <yt:videoId>solo_vid</yt:videoId>
    <title>Solo Video</title>
    <published>2026-02-14T12:00:00+00:00</published>
    <author><name>One Video Channel</name></author>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/solo_vid/hqdefault.jpg" width="480" height="360"/>
      <media:description>The only video</media:description>
      <media:community>
        <media:statistics views="42"/>
      </media:community>
    </media:group>
  </entry>
</feed>`;

// RSS with no entries
const EMPTY_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <title>Empty Channel</title>
</feed>`;

// RSS with missing optional fields
const MINIMAL_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <title>Minimal Channel</title>
  <entry>
    <yt:videoId>min_vid</yt:videoId>
    <title>Minimal Video</title>
    <published>2026-02-14T00:00:00+00:00</published>
    <media:group>
    </media:group>
  </entry>
</feed>`;

function mockFetch(body, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  });
}

describe('RSS service', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('fetchChannelRSS', () => {
    it('parses all video fields correctly', async () => {
      global.fetch = mockFetch(SAMPLE_RSS);

      const videos = await fetchChannelRSS('UCtest123', 'Test Channel');

      expect(videos).toHaveLength(3);

      const first = videos[0];
      expect(first.videoId).toBe('vid_001');
      expect(first.channelId).toBe('UCtest123');
      expect(first.title).toBe('First Video');
      expect(first.channelName).toBe('Test Channel');
      expect(first.published).toBe('2026-02-14T10:00:00+00:00');
      expect(first.thumbnail).toBe('https://i.ytimg.com/vi/vid_001/hqdefault.jpg');
      expect(first.description).toBe('A great video about testing');
      expect(first.views).toBe(5000);
    });

    it('constructs correct RSS URL', async () => {
      global.fetch = mockFetch(SAMPLE_RSS);

      await fetchChannelRSS('UCtest123', 'Test Channel');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://www.youtube.com/feeds/videos.xml?channel_id=UCtest123',
        expect.objectContaining({
          headers: expect.any(Object),
        })
      );
    });

    it('handles single entry (not array)', async () => {
      global.fetch = mockFetch(SINGLE_ENTRY_RSS);

      const videos = await fetchChannelRSS('UCsingle', 'One Video Channel');

      expect(videos).toHaveLength(1);
      expect(videos[0].videoId).toBe('solo_vid');
      expect(videos[0].views).toBe(42);
    });

    it('returns empty array for empty feed', async () => {
      global.fetch = mockFetch(EMPTY_RSS);

      const videos = await fetchChannelRSS('UCempty', 'Empty Channel');

      expect(videos).toHaveLength(0);
    });

    it('handles missing optional fields gracefully', async () => {
      global.fetch = mockFetch(MINIMAL_RSS);

      const videos = await fetchChannelRSS('UCmin', 'Minimal Channel');

      expect(videos).toHaveLength(1);
      const vid = videos[0];
      expect(vid.videoId).toBe('min_vid');
      expect(vid.title).toBe('Minimal Video');
      expect(vid.description).toBe('');
      expect(vid.views).toBe(0);
      // Falls back to constructed thumbnail URL
      expect(vid.thumbnail).toContain('min_vid');
    });

    it('throws on 404 response', async () => {
      global.fetch = mockFetch('Not Found', 404);

      await expect(fetchChannelRSS('UCgone', 'Gone Channel'))
        .rejects.toThrow('HTTP 404');
    });

    it('throws on 500 response', async () => {
      global.fetch = mockFetch('Server Error', 500);

      await expect(fetchChannelRSS('UCbad', 'Bad Channel'))
        .rejects.toThrow('HTTP 500');
    });

    it('attaches channelId to errors', async () => {
      global.fetch = mockFetch('Not Found', 404);

      try {
        await fetchChannelRSS('UCgone', 'Gone Channel');
      } catch (err) {
        expect(err.channelId).toBe('UCgone');
        expect(err.status).toBe(404);
      }
    });

    it('truncates description to 200 chars', async () => {
      const longDesc = 'A'.repeat(500);
      const rss = SAMPLE_RSS.replace('A great video about testing', longDesc);
      global.fetch = mockFetch(rss);

      const videos = await fetchChannelRSS('UCtest123', 'Test Channel');
      expect(videos[0].description.length).toBe(200);
    });
  });

  describe('fetchNewVideosRSS', () => {
    it('filters out known video IDs', async () => {
      global.fetch = mockFetch(SAMPLE_RSS);

      const knownIds = new Set(['vid_001', 'vid_003']);
      const newVideos = await fetchNewVideosRSS('UCtest123', 'Test Channel', knownIds);

      expect(newVideos).toHaveLength(1);
      expect(newVideos[0].videoId).toBe('vid_002');
    });

    it('returns all videos when none are known', async () => {
      global.fetch = mockFetch(SAMPLE_RSS);

      const knownIds = new Set();
      const newVideos = await fetchNewVideosRSS('UCtest123', 'Test Channel', knownIds);

      expect(newVideos).toHaveLength(3);
    });

    it('returns empty array when all videos are known', async () => {
      global.fetch = mockFetch(SAMPLE_RSS);

      const knownIds = new Set(['vid_001', 'vid_002', 'vid_003']);
      const newVideos = await fetchNewVideosRSS('UCtest123', 'Test Channel', knownIds);

      expect(newVideos).toHaveLength(0);
    });
  });
});
