import React from 'react';
import { formatDuration, timeAgo, formatViews } from '../utils/format.js';
import styles from './VideoCard.module.css';

export default function VideoCard({
  video,
  isQueued,
  isActive,
  thumbSize,
  isGrid,
  channelThumbnail,
  onThumbnailClick,
  onTitleClick,
  onChannelClick,
  onRemove,
  compact,
}) {
  const duration = video.duration ? formatDuration(video.duration) : '';
  const views = video.views && video.views !== '0' ? `${formatViews(video.views)} views` : '';
  const time = video.published ? timeAgo(video.published) : '';

  const thumbStyle = !isGrid
    ? { width: `${thumbSize}px`, height: `${Math.round(thumbSize * 9 / 16)}px` }
    : undefined;

  const cardClasses = [
    styles.card,
    isQueued ? styles.queued : '',
    isActive ? styles.active : '',
    compact ? styles.compact : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cardClasses}
      data-video-id={video.videoId}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          window.open(`https://www.youtube.com/watch?v=${video.videoId}`, '_blank');
        }
      }}
    >
      <div
        className={styles.thumbWrap}
        style={thumbStyle}
        onClick={(e) => {
          e.stopPropagation();
          onThumbnailClick(video);
        }}
      >
        <img
          src={video.thumbnail}
          alt=""
          loading="lazy"
          className={styles.thumbImg}
        />
        {duration && <div className={styles.duration}>{duration}</div>}
        <div className={styles.queueIndicator}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </div>
      <div className={styles.info}>
        <div
          className={styles.title}
          onClick={(e) => {
            e.stopPropagation();
            onTitleClick(video);
          }}
        >
          {video.title}
        </div>
        <div className={styles.channelRow}>
          {channelThumbnail && (
            <img
              src={channelThumbnail}
              alt=""
              className={styles.channelIcon}
              onClick={(e) => {
                e.stopPropagation();
                onChannelClick(video);
              }}
            />
          )}
          <span
            className={styles.channel}
            onClick={(e) => {
              e.stopPropagation();
              onChannelClick(video);
            }}
          >
            {video.channelName}
          </span>
        </div>
        {!isGrid && video.description && (
          <div
            className={styles.description}
            onClick={(e) => {
              e.stopPropagation();
              onTitleClick(video);
            }}
          >
            {video.description}
          </div>
        )}
        <div className={styles.meta}>
          {views && (
            <>
              <span className={styles.views}>{views}</span>
              <span className={styles.metaSep}>&bull;</span>
            </>
          )}
          {time && <span className={styles.time}>{time}</span>}
        </div>
      </div>
      {onRemove && (
        <button
          className={styles.removeBtn}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(video.videoId);
          }}
          title="Remove from playlist"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
