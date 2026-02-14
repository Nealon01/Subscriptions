import React, { useEffect, useRef } from 'react';
import styles from './PlayerView.module.css';

// Global YouTube IFrame API readiness
let ytApiPromise = null;

function loadYouTubeAPI() {
  if (ytApiPromise) return ytApiPromise;
  if (window.YT && window.YT.Player) {
    return Promise.resolve();
  }

  ytApiPromise = new Promise((resolve) => {
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevCallback) prevCallback();
      resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript.parentNode.insertBefore(tag, firstScript);
  });
  return ytApiPromise;
}

export default function PlayerView({
  videoId,
  title,
  channelName,
  channelId,
  onVideoEnd,
  onProgress90,
}) {
  const playerRef = useRef(null);
  const containerRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const markedRef = useRef(null);
  const videoIdRef = useRef(videoId);
  const onVideoEndRef = useRef(onVideoEnd);
  const onProgress90Ref = useRef(onProgress90);

  // Keep refs current
  useEffect(() => { videoIdRef.current = videoId; }, [videoId]);
  useEffect(() => { onVideoEndRef.current = onVideoEnd; }, [onVideoEnd]);
  useEffect(() => { onProgress90Ref.current = onProgress90; }, [onProgress90]);

  // Initialize YouTube player (once)
  useEffect(() => {
    let destroyed = false;

    function cleanupInterval() {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    }

    function checkProgress() {
      const player = playerRef.current;
      if (!player || !player.getDuration) return;

      const duration = player.getDuration();
      const current = player.getCurrentTime();

      if (duration > 0 && current > 0) {
        const progress = current / duration;
        if (progress >= 0.9 && markedRef.current !== videoIdRef.current) {
          markedRef.current = videoIdRef.current;
          if (onProgress90Ref.current) onProgress90Ref.current(videoIdRef.current);
        }
      }
    }

    loadYouTubeAPI().then(() => {
      if (destroyed || !containerRef.current) return;

      playerRef.current = new window.YT.Player(containerRef.current, {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 0,
          controls: 1,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onStateChange: (event) => {
            if (event.data === window.YT.PlayerState.PLAYING) {
              if (!progressIntervalRef.current) {
                progressIntervalRef.current = setInterval(checkProgress, 5000);
              }
            } else if (
              event.data === window.YT.PlayerState.PAUSED ||
              event.data === window.YT.PlayerState.ENDED
            ) {
              cleanupInterval();
            }

            if (event.data === window.YT.PlayerState.ENDED) {
              if (onVideoEndRef.current) onVideoEndRef.current();
            }
          },
        },
      });
    });

    return () => {
      destroyed = true;
      cleanupInterval();
      if (playerRef.current && playerRef.current.destroy) {
        try {
          playerRef.current.destroy();
        } catch (e) {
          // Player may already be destroyed
        }
      }
      playerRef.current = null;
    };
  }, []);

  // Load video when videoId changes
  useEffect(() => {
    if (!videoId || !playerRef.current) return;

    // Reset marked state for new video
    markedRef.current = null;

    const player = playerRef.current;
    if (player.cueVideoById) {
      player.cueVideoById(videoId);
    }
  }, [videoId]);

  return (
    <div className={styles.playerSection}>
      <div className={styles.playerWrapper}>
        <div ref={containerRef} className={styles.player} />
        {!videoId && (
          <div className={styles.emptyPlayer}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.emptyIcon}>
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <div className={styles.emptyTitle}>No video playing</div>
            <div className={styles.emptySubtitle}>Select a video from the playlist</div>
          </div>
        )}
      </div>
      {videoId && title && (
        <div className={styles.playerInfo}>
          <div className={styles.playerTitle}>{title}</div>
          <div className={styles.playerMeta}>
            <span
              className={styles.playerChannel}
              onClick={() => window.open(`https://www.youtube.com/channel/${channelId}`, '_blank')}
            >
              {channelName}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
