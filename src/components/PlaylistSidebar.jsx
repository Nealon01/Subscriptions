import React, { useState, useMemo, useCallback } from 'react';
import { parseDurationToMinutes } from '../utils/format.js';
import VideoCard from './VideoCard.jsx';
import styles from './PlaylistSidebar.module.css';

const SORT_MODES = ['original', 'shortest', 'longest'];
const SORT_LABELS = { original: 'Order: Added', shortest: 'Shortest first', longest: 'Longest first' };

export default function PlaylistSidebar({
  items,
  currentIndex,
  onPlayVideo,
  onRemoveVideo,
  onMoveVideo,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState('original');

  const cycleSortMode = useCallback(() => {
    setSortMode((prev) => SORT_MODES[(SORT_MODES.indexOf(prev) + 1) % SORT_MODES.length]);
  }, []);

  const filteredItems = useMemo(() => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (item) =>
          item.title?.toLowerCase().includes(q) ||
          item.channelName?.toLowerCase().includes(q)
      );
    }
    if (sortMode !== 'original') {
      result = [...result].sort((a, b) => {
        const da = parseDurationToMinutes(a.duration) ?? 0;
        const db = parseDurationToMinutes(b.duration) ?? 0;
        return sortMode === 'shortest' ? da - db : db - da;
      });
    }
    return result;
  }, [items, searchQuery, sortMode]);

  const handleChannelClick = useCallback((video) => {
    if (video.channelId) {
      window.open(`https://www.youtube.com/channel/${video.channelId}`, '_blank');
    }
  }, []);

  const handleTitleClick = useCallback((video) => {
    window.open(`https://www.youtube.com/watch?v=${video.videoId}`, '_blank');
  }, []);

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <div>
            <h2 className={styles.headerTitle}>Playlist</h2>
            <div className={styles.stats}>
              {items.length} video{items.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button
            className={`${styles.sortBtn} ${sortMode !== 'original' ? styles.sortBtnActive : ''}`}
            onClick={cycleSortMode}
            title="Cycle sort: Added → Shortest → Longest"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M3 12h12M3 18h6" />
            </svg>
            <span>{SORT_LABELS[sortMode]}</span>
          </button>
        </div>
        <div className={styles.searchWrap}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search playlist..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
      <div className={styles.list}>
        {filteredItems.length === 0 ? (
          <div className={styles.empty}>
            {searchQuery ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.emptyIcon}>
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <h3>No videos found</h3>
                <p>Try adjusting your search</p>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.emptyIcon}>
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
                <h3>No videos in playlist</h3>
                <p>Add videos from the main feed to start watching</p>
              </>
            )}
          </div>
        ) : (
          filteredItems.map((item) => {
            const originalIndex = items.indexOf(item);
            return (
              <VideoCard
                key={item.videoId}
                video={item}
                isActive={originalIndex === currentIndex}
                isQueued={false}
                thumbSize={168}
                isGrid={false}
                onThumbnailClick={() => onPlayVideo(originalIndex)}
                onTitleClick={handleTitleClick}
                onChannelClick={handleChannelClick}
                onRemove={onRemoveVideo}
                onMoveToTop={onMoveVideo && originalIndex > 0 ? (videoId) => onMoveVideo(videoId, 'top') : undefined}
                onMoveToBottom={onMoveVideo && originalIndex < items.length - 1 ? (videoId) => onMoveVideo(videoId, 'bottom') : undefined}
                compact
              />
            );
          })
        )}
      </div>
    </div>
  );
}
