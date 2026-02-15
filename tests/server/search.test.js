import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, closeTestDatabase } from '../helpers/mock-database.js';
import { createChannel, createVideo, resetCounters } from '../helpers/fixtures.js';

describe('FTS5 search', () => {
  let db;

  // Use relative dates so tests don't break when the calendar rolls over
  const today = new Date();
  const todayISO = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10).toISOString();
  const yesterdayISO = new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgoISO = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const lastMonthISO = new Date(today.getTime() - 35 * 24 * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    resetCounters();
    db = createTestDatabase();

    // Set up test data
    db.upsertChannel(createChannel({ channelId: 'UCsearch01', channelName: 'Tech Reviews' }));
    db.upsertChannel(createChannel({ channelId: 'UCsearch02', channelName: 'Cooking Show' }));

    db.insertVideos([
      createVideo({
        videoId: 'vid_react',
        channelId: 'UCsearch01',
        channelName: 'Tech Reviews',
        title: 'React Hooks Tutorial for Beginners',
        description: 'Learn how to use React hooks in this comprehensive tutorial.',
        published: yesterdayISO,
        duration: 'PT15M30S',
      }),
      createVideo({
        videoId: 'vid_vue',
        channelId: 'UCsearch01',
        channelName: 'Tech Reviews',
        title: 'Vue.js 4 First Look',
        description: 'Exploring the new features in Vue.js version 4.',
        published: twoDaysAgoISO,
        duration: 'PT8M45S',
      }),
      createVideo({
        videoId: 'vid_pasta',
        channelId: 'UCsearch02',
        channelName: 'Cooking Show',
        title: 'Perfect Homemade Pasta Recipe',
        description: 'Step by step guide to making fresh pasta from scratch.',
        published: lastMonthISO,
        duration: 'PT22M10S',
      }),
      createVideo({
        videoId: 'vid_react_adv',
        channelId: 'UCsearch01',
        channelName: 'Tech Reviews',
        title: 'Advanced React Patterns',
        description: 'Compound components, render props, and custom hooks explained.',
        published: todayISO,
        duration: 'PT45M00S',
      }),
    ]);
  });

  afterEach(() => {
    closeTestDatabase();
  });

  it('finds videos matching a single keyword in title', () => {
    const { results, total } = db.searchVideos({ query: 'React' });
    expect(total).toBe(2);
    expect(results).toHaveLength(2);
    expect(results.every(v => v.title.toLowerCase().includes('react'))).toBe(true);
  });

  it('finds videos matching keywords in description', () => {
    const { results } = db.searchVideos({ query: 'scratch' });
    expect(results).toHaveLength(1);
    expect(results[0].videoId).toBe('vid_pasta');
  });

  it('finds videos matching channel name', () => {
    const { results } = db.searchVideos({ query: 'Cooking' });
    expect(results).toHaveLength(1);
    expect(results[0].channelName).toBe('Cooking Show');
  });

  it('handles multi-keyword AND search', () => {
    const { results } = db.searchVideos({ query: 'React tutorial' });
    // "React" AND "tutorial" — title has both for vid_react; description has "tutorial" for vid_react too
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(v => v.videoId === 'vid_react')).toBe(true);
  });

  it('handles quoted phrase search', () => {
    const { results } = db.searchVideos({ query: '"React Hooks"' });
    // Exact phrase "React Hooks" only in vid_react title
    expect(results).toHaveLength(1);
    expect(results[0].videoId).toBe('vid_react');
  });

  it('matches partial words with prefix search', () => {
    // "Reac" should match "React" videos via prefix matching (Reac*)
    const { results } = db.searchVideos({ query: 'Reac' });
    expect(results).toHaveLength(2);
    expect(results.every(v => v.title.toLowerCase().includes('react'))).toBe(true);
  });

  it('matches channel name prefix', () => {
    // "Cook" should match "Cooking Show" channel via prefix matching
    const { results } = db.searchVideos({ query: 'Cook' });
    expect(results).toHaveLength(1);
    expect(results[0].channelName).toBe('Cooking Show');
  });

  it('returns empty results for no match', () => {
    const { results, total } = db.searchVideos({ query: 'nonexistentxyz' });
    expect(results).toHaveLength(0);
    expect(total).toBe(0);
  });

  it('returns empty results for empty query', () => {
    const { results, total } = db.searchVideos({ query: '' });
    expect(results).toHaveLength(0);
    expect(total).toBe(0);
  });

  it('respects limit and offset pagination', () => {
    const page1 = db.searchVideos({ query: 'React', limit: 1, offset: 0 });
    expect(page1.results).toHaveLength(1);
    expect(page1.total).toBe(2);

    const page2 = db.searchVideos({ query: 'React', limit: 1, offset: 1 });
    expect(page2.results).toHaveLength(1);
    expect(page2.total).toBe(2);

    // Different results on different pages
    expect(page1.results[0].videoId).not.toBe(page2.results[0].videoId);
  });

  it('applies time range filter with search', () => {
    // Only vid_react_adv was published "today"
    const { results } = db.searchVideos({
      query: 'React',
      timeRange: 'today',
    });
    expect(results).toHaveLength(1);
    expect(results[0].videoId).toBe('vid_react_adv');
  });

  it('applies duration filter with search', () => {
    // Only videos under 10 minutes
    const { results } = db.searchVideos({
      query: 'Tech Reviews',
      durationFilter: { min: 0, max: 10 },
    });
    // vid_vue is 8:45 min, the others are 15:30 and 45:00
    expect(results).toHaveLength(1);
    expect(results[0].videoId).toBe('vid_vue');
  });

  it('handles FTS5 special characters safely', () => {
    // These should not throw SQL errors
    expect(() => db.searchVideos({ query: 'react AND vue' })).not.toThrow();
    expect(() => db.searchVideos({ query: 'test*' })).not.toThrow();
    expect(() => db.searchVideos({ query: 'a OR b' })).not.toThrow();
    expect(() => db.searchVideos({ query: '"unclosed quote' })).not.toThrow();
    expect(() => db.searchVideos({ query: 'NEAR(a b)' })).not.toThrow();
    expect(() => db.searchVideos({ query: '{brackets}' })).not.toThrow();
  });

  it('FTS index stays in sync after insert', () => {
    db.insertVideos([
      createVideo({
        videoId: 'vid_new_search',
        channelId: 'UCsearch01',
        channelName: 'Tech Reviews',
        title: 'Svelte 5 Runes Explained',
        description: 'Understanding runes in Svelte 5.',
        published: '2026-02-14T12:00:00Z',
      }),
    ]);

    const { results } = db.searchVideos({ query: 'Svelte' });
    expect(results).toHaveLength(1);
    expect(results[0].videoId).toBe('vid_new_search');
  });

  it('returns results with expected fields', () => {
    const { results } = db.searchVideos({ query: 'pasta' });
    expect(results).toHaveLength(1);
    const v = results[0];
    expect(v).toHaveProperty('videoId');
    expect(v).toHaveProperty('channelId');
    expect(v).toHaveProperty('title');
    expect(v).toHaveProperty('channelName');
    expect(v).toHaveProperty('published');
    expect(v).toHaveProperty('thumbnail');
    expect(v).toHaveProperty('description');
    expect(v).toHaveProperty('duration');
    expect(v).toHaveProperty('views');
  });

  it('results are ranked by BM25 relevance', () => {
    const { results } = db.searchVideos({ query: 'React' });
    expect(results.length).toBe(2);
    // BM25 rank values should be present (negative = better in FTS5)
    expect(results[0]).toHaveProperty('rank');
    expect(typeof results[0].rank).toBe('number');
  });
});
