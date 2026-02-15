import { useState, useCallback, useRef } from 'react';
import { getFeed, searchFeed } from '../services/api.js';
import { parseDurationToMinutes } from '../utils/format.js';
import { matchesSearch } from '../utils/search.js';

export function useFeed() {
  const [videos, setVideos] = useState([]);
  const [channels, setChannels] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cacheTimestamp, setCacheTimestamp] = useState(null);
  const [totalVideos, setTotalVideos] = useState(0);
  const loadedRef = useRef(false);

  // Search state
  const [searchResults, setSearchResults] = useState(null);
  const [searchTotal, setSearchTotal] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  const loadFeed = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getFeed();
      if (data && data.videos) {
        setVideos(data.videos);
        setChannels(data.channels || []);
        setCacheTimestamp(data.timestamp);
        setTotalVideos(data.totalVideos || data.videos.length);
        loadedRef.current = true;
        return data;
      }
      return null;
    } catch (err) {
      console.error('Failed to load feed:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Server-side FTS5 search
  const doSearch = useCallback(async ({ query, timeRange, durationFilter, sort = 'date', limit = 30, offset = 0 }) => {
    if (!query || !query.trim()) {
      setSearchResults(null);
      setSearchTotal(0);
      return null;
    }

    setIsSearching(true);
    try {
      const data = await searchFeed({
        query,
        timeRange,
        durationMin: durationFilter?.min || 0,
        durationMax: durationFilter?.max,
        sort,
        limit,
        offset,
      });
      if (data && data.videos) {
        if (offset === 0) {
          setSearchResults(data.videos);
        } else {
          setSearchResults(prev => prev ? [...prev, ...data.videos] : data.videos);
        }
        setSearchTotal(data.searchTotal || 0);
        if (data.channels) setChannels(data.channels);
        return data;
      }
      return null;
    } catch (err) {
      console.error('Failed to search:', err);
      return null;
    } finally {
      setIsSearching(false);
    }
  }, []);

  const clearSearch = useCallback(() => {
    setSearchResults(null);
    setSearchTotal(0);
  }, []);

  // Client-side filtering (for non-search feed view)
  const getFilteredVideos = useCallback(
    (searchQuery = '', timeRange = 'all', durationFilter = { min: 0, max: Infinity }) => {
      let vids = videos;

      // Time filter
      if (timeRange !== 'all') {
        const now = new Date();
        let cutoff;
        if (timeRange === 'today') {
          cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (timeRange === 'week') {
          cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (timeRange === 'month') {
          cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        if (cutoff) {
          vids = vids.filter((v) => new Date(v.published) >= cutoff);
        }
      }

      // Search filter (multi-keyword, quoted phrases)
      if (searchQuery) {
        vids = vids.filter((v) => matchesSearch(searchQuery, v.title, v.channelName));
      }

      // Duration filter
      if (durationFilter.min > 0 || durationFilter.max < Infinity) {
        vids = vids.filter((v) => {
          const minutes = parseDurationToMinutes(v.duration);
          if (minutes === null) return true; // Include videos without duration data
          if (durationFilter.min > 0 && minutes < durationFilter.min) return false;
          if (durationFilter.max < Infinity && minutes > durationFilter.max) return false;
          return true;
        });
      }

      return vids;
    },
    [videos]
  );

  return {
    videos,
    channels,
    isLoading,
    cacheTimestamp,
    totalVideos,
    loadFeed,
    setVideos,
    setChannels,
    setCacheTimestamp,
    getFilteredVideos,
    hasLoaded: loadedRef.current,
    // Search
    searchResults,
    searchTotal,
    isSearching,
    doSearch,
    clearSearch,
  };
}
