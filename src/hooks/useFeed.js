import { useState, useCallback, useRef } from 'react';
import { getFeed } from '../services/api.js';
import { parseDurationToMinutes } from '../utils/format.js';

export function useFeed() {
  const [videos, setVideos] = useState([]);
  const [channels, setChannels] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cacheTimestamp, setCacheTimestamp] = useState(null);
  const loadedRef = useRef(false);

  const loadFeed = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getFeed();
      if (data && data.videos) {
        setVideos(data.videos);
        setChannels(data.channels || []);
        setCacheTimestamp(data.timestamp);
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

      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        vids = vids.filter(
          (v) =>
            v.title.toLowerCase().includes(q) ||
            v.channelName.toLowerCase().includes(q)
        );
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
    loadFeed,
    setVideos,
    setChannels,
    setCacheTimestamp,
    getFilteredVideos,
    hasLoaded: loadedRef.current,
  };
}
