import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useToast } from '../components/Toast.jsx';
import { getPlaylistItems, getSettings, ensurePlaylist as apiEnsurePlaylist, removeFromPlaylist, moveInPlaylist } from '../services/api.js';
import PlayerView from '../components/PlayerView.jsx';
import PlaylistSidebar from '../components/PlaylistSidebar.jsx';
import styles from './Playlist.module.css';

export default function Playlist() {
  const { sessionId, isAuthenticated, authChecked } = useAuth();
  const showToast = useToast();

  const [playlistId, setPlaylistId] = useState(null);
  const [playlistItems, setPlaylistItems] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const markedRef = useRef(null);

  // Set page title
  useEffect(() => { document.title = 'To Watch'; }, []);

  const currentVideo = currentIndex >= 0 && currentIndex < playlistItems.length
    ? playlistItems[currentIndex]
    : null;

  // WebSocket handlers
  const wsHandlers = useMemo(
    () => ({
      onVideoAdded: (data) => {
        if (data.playlistId === playlistId) {
          showToast('Video added to playlist', 'success');
          if (data.videoMeta) {
            // Insert into local state immediately using metadata from the broadcast
            setPlaylistItems((prev) => [{
              playlistItemId: data.playlistItemId,
              videoId: data.videoId,
              ...data.videoMeta,
              position: 0,
              addedAt: new Date().toISOString(),
            }, ...prev]);
          } else {
            // Fallback: reload after delay if no metadata available
            setTimeout(() => loadPlaylist(playlistId), 2000);
          }
        }
      },
      onVideoRemoved: (data) => {
        if (data.playlistId === playlistId) {
          // Remove from local state immediately (no API call needed)
          setPlaylistItems((prev) => prev.filter((item) => item.videoId !== data.videoId));
        }
      },
    }),
    [playlistId, showToast]
  );

  const { isConnected } = useWebSocket(wsHandlers);

  // Load playlist from API
  const loadPlaylist = useCallback(
    async (plId) => {
      const id = plId || playlistId;
      if (!id || !sessionId) return;
      try {
        const data = await getPlaylistItems(sessionId, id);
        setPlaylistItems(data.items || []);
      } catch (err) {
        if (err.message === 'SESSION_EXPIRED') {
          showToast('Session expired. Please sign in again.', 'error');
          setTimeout(() => { window.location.href = '/'; }, 2000);
          return;
        }
        showToast('Error loading playlist: ' + err.message, 'error');
      }
    },
    [sessionId, playlistId, showToast]
  );

  // Initial load
  useEffect(() => {
    if (!authChecked || !isAuthenticated || !sessionId) return;

    let cancelled = false;

    (async () => {
      try {
        // Get playlist ID from settings
        const settingsData = await getSettings(sessionId);
        let plId = settingsData?.playlistId;

        if (!plId) {
          // Ensure playlist exists
          const ensureData = await apiEnsurePlaylist(sessionId);
          plId = ensureData.playlistId;
        }

        if (cancelled) return;

        setPlaylistId(plId);
        await loadPlaylist(plId);
      } catch (err) {
        if (!cancelled) {
          showToast('Failed to load playlist. Please go back to the main feed.', 'error');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [authChecked, isAuthenticated, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-play first video when playlist loads and no video is playing
  useEffect(() => {
    if (currentIndex === -1 && playlistItems.length > 0) {
      setCurrentIndex(0);
    }
  }, [playlistItems, currentIndex]);

  // Play a video by index
  const handlePlayVideo = useCallback((index) => {
    // Before switching, check if current video was marked for removal at 90%
    if (markedRef.current !== null && currentIndex >= 0) {
      const prevVideo = playlistItems[currentIndex];
      if (prevVideo && prevVideo.videoId === markedRef.current) {
        removeVideo(markedRef.current, currentIndex, false);
        markedRef.current = null;
        // Adjust index if needed
        if (index > currentIndex) {
          index--;
        }
      } else {
        markedRef.current = null;
      }
    }

    setCurrentIndex(index);
  }, [currentIndex, playlistItems]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remove a video from the playlist
  const removeVideo = useCallback(
    (videoId, index, autoPlay = true) => {
      // Capture snapshot inside functional updater to avoid stale closure
      let snapshot = null;

      setPlaylistItems((prev) => {
        snapshot = prev;
        const next = prev.filter((item) => item.videoId !== videoId);

        if (index === currentIndex) {
          const nextIndex = Math.min(index, next.length - 1);
          if (nextIndex >= 0 && autoPlay) {
            setTimeout(() => setCurrentIndex(nextIndex), 100);
          } else {
            setCurrentIndex(-1);
          }
        } else if (index < currentIndex) {
          setCurrentIndex((prev) => prev - 1);
        }

        return next;
      });

      // Fire API call in background, rollback on failure
      removeFromPlaylist(sessionId, playlistId, videoId)
        .then(() => {
          showToast(autoPlay ? 'Video marked as watched and removed' : 'Removed from playlist', 'success');
        })
        .catch(() => {
          if (snapshot) setPlaylistItems(snapshot);
          showToast('Failed to remove video', 'error');
        });
    },
    [sessionId, playlistId, currentIndex, showToast]
  );

  // Handle remove from sidebar
  const handleRemoveVideo = useCallback(
    (videoId) => {
      const index = playlistItems.findIndex((item) => item.videoId === videoId);
      if (index >= 0) {
        removeVideo(videoId, index, false);
      }
    },
    [playlistItems, removeVideo]
  );

  // Handle move to top/bottom or to a specific position (drag reorder)
  const handleMoveVideo = useCallback(
    (videoId, to) => {
      const index = playlistItems.findIndex((item) => item.videoId === videoId);
      if (index < 0) return;

      const snapshot = [...playlistItems];

      if (typeof to === 'number') {
        // Drag reorder to specific position
        if (to === index) return;
        setPlaylistItems((prev) => {
          const next = [...prev];
          const [item] = next.splice(index, 1);
          next.splice(to, 0, item);
          return next;
        });
        if (index === currentIndex) {
          setCurrentIndex(to);
        } else if (index < currentIndex && to >= currentIndex) {
          setCurrentIndex((prev) => prev - 1);
        } else if (index > currentIndex && to <= currentIndex) {
          setCurrentIndex((prev) => prev + 1);
        }
      } else {
        // Move to top/bottom
        setPlaylistItems((prev) => {
          const item = prev[index];
          const without = prev.filter((_, i) => i !== index);
          if (to === 'top') {
            return [item, ...without];
          } else {
            return [...without, item];
          }
        });
        if (index === currentIndex) {
          setCurrentIndex(to === 'top' ? 0 : playlistItems.length - 1);
        } else if (to === 'top' && index > currentIndex) {
          setCurrentIndex((prev) => prev + 1);
        } else if (to === 'top' && index < currentIndex) {
          // no change
        } else if (to === 'bottom' && index < currentIndex) {
          setCurrentIndex((prev) => prev - 1);
        }
      }

      moveInPlaylist(sessionId, playlistId, videoId, to)
        .then(() => {
          if (typeof to !== 'number') showToast(`Moved to ${to}`, 'success');
        })
        .catch(() => {
          setPlaylistItems(snapshot);
          showToast('Failed to move video', 'error');
        });
    },
    [sessionId, playlistId, playlistItems, currentIndex, showToast]
  );

  // Handle video end — auto-remove and advance
  const handleVideoEnd = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < playlistItems.length) {
      const video = playlistItems[currentIndex];
      removeVideo(video.videoId, currentIndex, true);
    }
  }, [currentIndex, playlistItems, removeVideo]);

  // Handle 90% progress mark
  const handleProgress90 = useCallback(
    (videoId) => {
      markedRef.current = videoId;
    },
    []
  );

  if (!authChecked) return null;

  if (!isAuthenticated) {
    return (
      <div className={styles.errorScreen}>
        <h2>Not authenticated</h2>
        <p>Please sign in from the main feed first.</p>
        <a href="/" className={styles.backLink}>Go to main feed</a>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.headerTitle}>To Watch</h1>
          <span className={styles.playlistCount}>
            {playlistItems.length} video{playlistItems.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className={styles.connectionStatus}>
          <div className={`${styles.statusDot} ${isConnected ? styles.connected : ''}`} />
          <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </header>

      {/* Main content */}
      <div className={styles.container}>
        <PlayerView
          videoId={currentVideo?.videoId || null}
          title={currentVideo?.title || null}
          channelName={currentVideo?.channelName || null}
          channelId={currentVideo?.channelId || null}
          onVideoEnd={handleVideoEnd}
          onProgress90={handleProgress90}
        />
        <PlaylistSidebar
          items={playlistItems}
          currentIndex={currentIndex}
          onPlayVideo={handlePlayVideo}
          onRemoveVideo={handleRemoveVideo}
          onMoveVideo={handleMoveVideo}
        />
      </div>
    </div>
  );
}
