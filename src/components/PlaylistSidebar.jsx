import React, { useState, useMemo, useCallback } from 'react';
import VideoCard from './VideoCard.jsx';
import styles from './PlaylistSidebar.module.css';

export default function PlaylistSidebar({
  items,
  currentIndex,
  onPlayVideo,
  onRemoveVideo,
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.title?.toLowerCase().includes(q) ||
        item.channelName?.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

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
        <h2 className={styles.headerTitle}>Playlist</h2>
        <div className={styles.stats}>
          {items.length} video{items.length !== 1 ? 's' : ''}
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
              />
            );
          })
        )}
      </div>
    </div>
  );
}
