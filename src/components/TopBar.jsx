import React from 'react';
import styles from './TopBar.module.css';

export default function TopBar({
  channelCount,
  videoCount,
  filteredVideoCount,
  queueCount,
  isAuthenticated,
  onPlaylistClick,
  onSettingsClick,
  onRefreshClick,
  onAuthClick,
  showControls,
}) {
  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <div className={styles.logo}>
          <span className={styles.logoAccent}>&#9654;</span> subs
        </div>
        {showControls && channelCount > 0 && (
          <div className={styles.stats}>
            {channelCount} channels &middot;{' '}
            {filteredVideoCount != null && filteredVideoCount !== videoCount
              ? `${filteredVideoCount} / ${videoCount} videos`
              : `${videoCount} videos`}
          </div>
        )}
      </div>
      <div className={styles.right}>
        {showControls && (
          <>
            <button
              className={`${styles.btn} ${styles.btnPlaylist}`}
              onClick={onPlaylistClick}
              title="Open To Watch playlist"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
              <span>To Watch</span>
              {queueCount > 0 && (
                <span className={styles.queueCount}>({queueCount})</span>
              )}
            </button>
            <button
              className={`${styles.btn} ${styles.btnIcon}`}
              onClick={onSettingsClick}
              title="Settings"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v6m0 6v6M5.6 5.6l4.2 4.2m4.2 4.2l4.2 4.2M1 12h6m6 0h6M5.6 18.4l4.2-4.2m4.2-4.2l4.2-4.2" />
              </svg>
            </button>
            <button
              className={styles.btn}
              onClick={onRefreshClick}
              title="Refresh feed"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 4v6h6M23 20v-6h-6" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
              </svg>
            </button>
          </>
        )}
        <button className={styles.btn} onClick={onAuthClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span>{isAuthenticated ? 'Sign Out' : 'Sign In'}</span>
        </button>
      </div>
    </header>
  );
}
