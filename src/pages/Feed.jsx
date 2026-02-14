import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { useFeed } from '../hooks/useFeed.js';
import { usePlaylist } from '../hooks/usePlaylist.js';
import { useSettings } from '../hooks/useSettings.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useToast } from '../components/Toast.jsx';
import { triggerRefresh as apiTriggerRefresh } from '../services/api.js';
import { getDateLabel } from '../utils/format.js';
import TopBar from '../components/TopBar.jsx';
import FilterBar from '../components/FilterBar.jsx';
import SettingsPanel from '../components/SettingsPanel.jsx';
import VideoCard from '../components/VideoCard.jsx';
import VideoGrid from '../components/VideoGrid.jsx';
import DateSeparator from '../components/DateSeparator.jsx';
import styles from './Feed.module.css';

const CACHE_FRESH_THRESHOLD = 60 * 60 * 1000; // 1 hour
const VIDEOS_PER_PAGE = 30;

export default function Feed() {
  const { sessionId, isAuthenticated, authChecked, login, logout } = useAuth();
  const feed = useFeed();
  const playlist = usePlaylist(sessionId);
  const { settings, updateSetting } = useSettings(sessionId);
  const showToast = useToast();

  // UI state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeRange, setTimeRange] = useState('all');
  const [displayCount, setDisplayCount] = useState(VIDEOS_PER_PAGE);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState({ pct: 0, title: '', text: '' });
  const [showFeed, setShowFeed] = useState(false);

  const refreshIsBackgroundRef = useRef(false);
  const isLoadingMoreRef = useRef(false);

  // Set page title
  useEffect(() => { document.title = 'Subs'; }, []);

  // Build channel thumbnail map
  const channelThumbnailMap = useMemo(() => {
    const map = {};
    for (const ch of feed.channels) {
      if (ch.thumbnail) map[ch.channelId] = ch.thumbnail;
    }
    return map;
  }, [feed.channels]);

  // Filtered videos
  const filteredVideos = useMemo(
    () => feed.getFilteredVideos(searchQuery, timeRange, settings.durationFilter || { min: 0, max: Infinity }),
    [feed.getFilteredVideos, searchQuery, timeRange, settings.durationFilter]
  );

  const videosToShow = useMemo(
    () => filteredVideos.slice(0, displayCount),
    [filteredVideos, displayCount]
  );

  // Group videos by date
  const groupedVideos = useMemo(() => {
    const groups = [];
    let currentLabel = '';

    videosToShow.forEach((video) => {
      const label = getDateLabel(video.published);
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ type: 'date', label });
      }
      groups.push({ type: 'video', video });
    });

    return groups;
  }, [videosToShow]);

  // WebSocket handlers
  const wsHandlers = useMemo(
    () => ({
      onVideoAdded: (data) => {
        if (data.playlistId === playlist.playlistId) {
          playlist.setQueuedVideoIds((prev) => new Set([...prev, data.videoId]));
        }
      },
      onVideoRemoved: (data) => {
        if (data.playlistId === playlist.playlistId) {
          playlist.setQueuedVideoIds((prev) => {
            const next = new Set(prev);
            next.delete(data.videoId);
            return next;
          });
        }
      },
      onRefreshProgress: (data) => {
        if (data.phase === 'subscriptions') {
          setRefreshProgress({ pct: 5, title: 'Loading subscriptions...', text: '' });
        } else if (data.phase === 'videos') {
          const pct = 10 + Math.round((data.processed / data.total) * 85);
          setRefreshProgress({
            pct: Math.min(pct, 95),
            title: 'Fetching videos...',
            text: `${data.processed} / ${data.total} channels`,
          });
        } else if (data.phase === 'quota_limit') {
          setRefreshProgress({ pct: 95, title: 'Quota limit reached', text: 'Saving progress...' });
        }
      },
      onRefreshComplete: async (data) => {
        setRefreshProgress({ pct: 100, title: 'Done!', text: '' });

        const feedData = await feed.loadFeed();
        if (feedData) {
          await playlist.ensurePlaylist();
          const plId = playlist.playlistId;
          if (plId) {
            await playlist.loadPlaylistItems(plId);
          }
        }

        if (!refreshIsBackgroundRef.current) {
          await new Promise((r) => setTimeout(r, 300));
          setIsRefreshing(false);
          setShowFeed(true);
        } else {
          setDisplayCount(VIDEOS_PER_PAGE);
        }

        if (data.newVideos > 0) {
          showToast(`Found ${data.newVideos} new video${data.newVideos > 1 ? 's' : ''}!`, 'success');
        } else {
          showToast('Feed is up to date', 'success');
        }
      },
      onRefreshError: (data) => {
        showToast('Refresh error: ' + data.error, 'error');
        if (!refreshIsBackgroundRef.current) {
          setIsRefreshing(false);
          setShowFeed(true);
        }
      },
    }),
    [feed, playlist, showToast]
  );

  useWebSocket(wsHandlers);

  // Initial load
  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthenticated) return;

    let cancelled = false;

    (async () => {
      const feedData = await feed.loadFeed();

      if (cancelled) return;

      if (feedData && feedData.videos && feedData.videos.length > 0) {
        setShowFeed(true);

        const plData = await playlist.ensurePlaylist();
        if (plData) {
          await playlist.loadPlaylistItems(plData);
        }

        // Background refresh if stale
        const dataAge = feedData.timestamp ? Date.now() - feedData.timestamp : Infinity;
        if (dataAge > CACHE_FRESH_THRESHOLD) {
          setTimeout(() => doRefresh(true), 1000);
        }
      } else {
        // No data — trigger full refresh
        doRefresh(false);
      }
    })();

    return () => { cancelled = true; };
  }, [authChecked, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll
  useEffect(() => {
    const handleScroll = () => {
      if (isLoadingMoreRef.current) return;
      const scrollPosition = window.scrollY + window.innerHeight;
      const threshold = document.documentElement.scrollHeight - 500;

      if (scrollPosition > threshold) {
        if (displayCount < filteredVideos.length) {
          isLoadingMoreRef.current = true;
          setDisplayCount((prev) => prev + VIDEOS_PER_PAGE);
          setTimeout(() => {
            isLoadingMoreRef.current = false;
          }, 100);
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [displayCount, filteredVideos.length]);

  // Reset display count when filters change
  useEffect(() => {
    setDisplayCount(VIDEOS_PER_PAGE);
  }, [searchQuery, timeRange, settings.durationFilter]);

  // Refresh handler
  const doRefresh = useCallback(
    async (background = false) => {
      refreshIsBackgroundRef.current = background;

      if (!background) {
        setIsRefreshing(true);
        setShowFeed(false);
        setRefreshProgress({ pct: 2, title: 'Starting refresh...', text: 'Connecting to YouTube API' });
      } else {
        showToast('Checking for new videos...', 'info');
      }

      try {
        const data = await apiTriggerRefresh(sessionId);
        if (data.status === 'already_running') {
          showToast('Refresh already in progress', 'info');
          if (!background) {
            setIsRefreshing(false);
            setShowFeed(true);
          }
          return;
        }
        // Progress updates arrive via WebSocket
      } catch (err) {
        if (err.message === 'SESSION_EXPIRED') {
          showToast('Session expired. Please sign in again.', 'error');
          logout();
          return;
        }
        console.error('Refresh error:', err);
        showToast('Error starting refresh: ' + err.message, 'error');
        if (!background) {
          setIsRefreshing(false);
          setShowFeed(true);
        }
      }
    },
    [sessionId, showToast, logout]
  );

  // Video action handlers
  const handleThumbnailClick = useCallback(
    async (video) => {
      const isQueued = playlist.queuedVideoIds.has(video.videoId);
      if (isQueued) {
        const ok = await playlist.removeFromQueue(video.videoId);
        if (ok) showToast('Removed from queue', 'success');
        else showToast('Failed to remove from queue', 'error');
      } else {
        const ok = await playlist.addToQueue(video.videoId, {
          title: video.title,
          channelName: video.channelName,
          channelId: video.channelId,
          thumbnail: video.thumbnail,
          duration: video.duration,
          views: video.views,
          published: video.published,
        });
        if (ok) showToast(`Queued: ${video.title.substring(0, 50)}...`, 'success');
        else showToast('Failed to add to queue', 'error');
      }
    },
    [playlist, showToast]
  );

  const handleTitleClick = useCallback((video) => {
    window.open(`https://www.youtube.com/watch?v=${video.videoId}`, '_blank');
  }, []);

  const handleChannelClick = useCallback((video) => {
    window.open(`https://www.youtube.com/channel/${video.channelId}`, '_blank');
  }, []);

  const handlePlaylistClick = useCallback(() => {
    window.open('/playlist', '_blank');
  }, []);

  // Render states
  if (!authChecked) return null;

  const isGrid = settings.videosPerRow > 1;

  return (
    <>
      <TopBar
        channelCount={feed.channels.length}
        videoCount={feed.videos.length}
        filteredVideoCount={filteredVideos.length}
        queueCount={playlist.queuedVideoIds.size}
        isAuthenticated={isAuthenticated}
        onPlaylistClick={handlePlaylistClick}
        onSettingsClick={() => setSettingsOpen((prev) => !prev)}
        onRefreshClick={() => doRefresh(false)}
        onAuthClick={isAuthenticated ? logout : login}
        showControls={isAuthenticated && showFeed}
      />

      {isAuthenticated && showFeed && (
        <div className={styles.stickyControls}>
          <SettingsPanel
            isOpen={settingsOpen}
            settings={settings}
            onUpdateSetting={updateSetting}
            cacheTimestamp={feed.cacheTimestamp}
          />
          <FilterBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
          />
        </div>
      )}

      <main className={styles.main}>
        {/* Login screen */}
        {!isAuthenticated && (
          <div className={styles.statusScreen}>
            <svg
              width="48" height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.5"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <h2>Your subscriptions, unfiltered</h2>
            <p>
              See every video from every channel you subscribe to, sorted by release date.
              No algorithm, no filtering, no surprises. Add videos to your "To Watch" queue with one click.
            </p>
            <button className={styles.loginBtn} onClick={login}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
              </svg>
              Sign in with Google
            </button>
          </div>
        )}

        {/* Loading / refresh screen */}
        {isRefreshing && (
          <div className={styles.statusScreen}>
            <div className={styles.spinner} />
            <h2>{refreshProgress.title}</h2>
            <p>{refreshProgress.text}</p>
            <div className={styles.progressWrap}>
              <div
                className={styles.progressFill}
                style={{ width: `${refreshProgress.pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Feed */}
        {showFeed && (
          <div className={styles.feedWrapper}>
            {videosToShow.length === 0 ? (
              <div className={styles.statusScreen} style={{ minHeight: '40vh' }}>
                <h2>No videos found</h2>
                <p>Try adjusting your search or time filter.</p>
              </div>
            ) : (
              (() => {
                // Group items by date for VideoGrid containers
                const sections = [];
                let currentGrid = [];
                let currentLabel = null;

                groupedVideos.forEach((item, i) => {
                  if (item.type === 'date') {
                    // Push previous grid if exists
                    if (currentGrid.length > 0) {
                      sections.push({
                        label: currentLabel,
                        videos: currentGrid,
                      });
                      currentGrid = [];
                    }
                    currentLabel = item.label;
                  } else {
                    currentGrid.push(item.video);
                  }
                });
                // Push last group
                if (currentGrid.length > 0) {
                  sections.push({ label: currentLabel, videos: currentGrid });
                }

                return sections.map((section) => (
                  <React.Fragment key={section.label}>
                    <DateSeparator label={section.label} />
                    <VideoGrid
                      videosPerRow={settings.videosPerRow}
                      density={settings.density}
                    >
                      {section.videos.map((video) => (
                        <VideoCard
                          key={video.videoId}
                          video={video}
                          isQueued={playlist.queuedVideoIds.has(video.videoId)}
                          thumbSize={settings.thumbSize}
                          isGrid={isGrid}
                          channelThumbnail={channelThumbnailMap[video.channelId]}
                          onThumbnailClick={handleThumbnailClick}
                          onTitleClick={handleTitleClick}
                          onChannelClick={handleChannelClick}
                        />
                      ))}
                    </VideoGrid>
                  </React.Fragment>
                ));
              })()
            )}
          </div>
        )}
      </main>
    </>
  );
}
