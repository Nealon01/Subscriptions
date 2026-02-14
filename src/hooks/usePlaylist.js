import { useState, useCallback } from 'react';
import {
  ensurePlaylist as apiEnsurePlaylist,
  addToPlaylist,
  removeFromPlaylist,
  getPlaylistItems,
} from '../services/api.js';

export function usePlaylist(sessionId) {
  const [playlistId, setPlaylistId] = useState(null);
  const [playlistItems, setPlaylistItems] = useState([]);
  const [queuedVideoIds, setQueuedVideoIds] = useState(new Set());

  const ensurePlaylistExists = useCallback(async () => {
    if (!sessionId) return null;
    try {
      const data = await apiEnsurePlaylist(sessionId);
      setPlaylistId(data.playlistId);
      return data.playlistId;
    } catch (err) {
      console.warn('Failed to ensure playlist:', err);
      return null;
    }
  }, [sessionId]);

  const loadPlaylistItems = useCallback(
    async (plId) => {
      const id = plId || playlistId;
      if (!id || !sessionId) return [];
      try {
        const data = await getPlaylistItems(sessionId, id);
        setPlaylistItems(data.items || []);
        const ids = new Set((data.items || []).map((item) => item.videoId));
        setQueuedVideoIds(ids);
        return data.items || [];
      } catch (err) {
        if (err.message === 'SESSION_EXPIRED') throw err;
        console.warn('Failed to load playlist items:', err);
        return [];
      }
    },
    [sessionId, playlistId]
  );

  const addToQueue = useCallback(
    async (videoId, videoMeta) => {
      if (!playlistId || !sessionId) return false;

      // Optimistic update — show queued immediately
      setQueuedVideoIds((prev) => new Set([...prev, videoId]));

      try {
        await addToPlaylist(sessionId, playlistId, videoId, videoMeta);
        return true;
      } catch (err) {
        // Rollback on failure
        setQueuedVideoIds((prev) => {
          const next = new Set(prev);
          next.delete(videoId);
          return next;
        });
        console.error('Failed to add to queue:', err);
        return false;
      }
    },
    [sessionId, playlistId]
  );

  const removeFromQueue = useCallback(
    async (videoId) => {
      if (!playlistId || !sessionId) return false;

      // Optimistic update — remove from UI immediately
      const prevItems = [];
      setQueuedVideoIds((prev) => {
        const next = new Set(prev);
        next.delete(videoId);
        return next;
      });
      setPlaylistItems((prev) => {
        prevItems.push(...prev);
        return prev.filter((item) => item.videoId !== videoId);
      });

      try {
        await removeFromPlaylist(sessionId, playlistId, videoId);
        return true;
      } catch (err) {
        // Rollback on failure
        setQueuedVideoIds((prev) => new Set([...prev, videoId]));
        setPlaylistItems(prevItems);
        console.error('Failed to remove from queue:', err);
        return false;
      }
    },
    [sessionId, playlistId]
  );

  return {
    playlistId,
    setPlaylistId,
    playlistItems,
    setPlaylistItems,
    queuedVideoIds,
    setQueuedVideoIds,
    ensurePlaylist: ensurePlaylistExists,
    addToQueue,
    removeFromQueue,
    loadPlaylistItems,
  };
}
