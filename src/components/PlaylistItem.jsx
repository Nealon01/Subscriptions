import React from 'react';
import styles from './PlaylistItem.module.css';

export default function PlaylistItem({ item, isActive, onPlay, onRemove, onChannelClick }) {
  return (
    <div
      className={`${styles.item} ${isActive ? styles.active : ''}`}
      onClick={(e) => {
        if (!e.target.closest(`.${styles.removeBtn}`)) {
          onPlay();
        }
      }}
    >
      <div className={styles.thumb}>
        <img
          src={item.thumbnail}
          alt=""
          loading="lazy"
          className={styles.thumbImg}
        />
      </div>
      <div className={styles.info}>
        <div className={styles.title}>{item.title}</div>
        <div
          className={styles.channel}
          onClick={(e) => {
            e.stopPropagation();
            onChannelClick(item.channelId);
          }}
        >
          {item.channelName}
        </div>
      </div>
      <button
        className={styles.removeBtn}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(item.videoId);
        }}
        title="Remove from playlist"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
