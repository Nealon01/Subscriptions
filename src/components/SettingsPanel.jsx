import React, { useState, useEffect } from 'react';
import { getQuota } from '../services/api.js';
import styles from './SettingsPanel.module.css';

const DENSITY_OPTIONS = ['compact', 'normal', 'comfortable'];

export default function SettingsPanel({ isOpen, settings, onUpdateSetting, cacheTimestamp }) {
  const [quotaData, setQuotaData] = useState(null);

  // Fetch quota when panel opens
  useEffect(() => {
    if (!isOpen) return;
    getQuota().then(setQuotaData).catch(() => {});
  }, [isOpen]);

  // Compute cache age display
  const cacheDisplay = (() => {
    if (!cacheTimestamp) return 'No cache';
    const age = Date.now() - cacheTimestamp;
    const minutes = Math.floor(age / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `Updated ${hours}h ${minutes % 60}m ago`;
    return `Updated ${minutes}m ago`;
  })();

  // Duration filter display
  const durationDisplay = (() => {
    const { min, max } = settings.durationFilter || { min: 0, max: Infinity };
    if (min === 0 && max >= 120) return 'All durations';
    if (min === 0) return `Up to ${max} minutes`;
    if (max >= 120) return `${min}+ minutes`;
    return `${min} - ${max} minutes`;
  })();

  const durationMin = settings.durationFilter?.min || 0;
  const durationMax = settings.durationFilter?.max === Infinity || !settings.durationFilter?.max
    ? 120
    : Math.min(settings.durationFilter.max, 120);

  return (
    <div className={`${styles.panel} ${isOpen ? styles.open : ''}`}>
      <div className={styles.content}>
        {/* Thumbnail Size */}
        <div className={styles.group}>
          <div className={styles.label}>Thumbnail Size</div>
          <div className={styles.control}>
            <span className={styles.rangeLabel}>Small</span>
            <input
              type="range"
              className={styles.slider}
              min="120"
              max="500"
              step="8"
              value={settings.thumbSize}
              onChange={(e) => onUpdateSetting('thumbSize', parseInt(e.target.value))}
            />
            <span className={`${styles.rangeLabel} ${styles.rangeLabelRight}`}>Large</span>
          </div>
          <div className={styles.value}>{settings.thumbSize}px</div>
        </div>

        {/* Videos Per Row */}
        <div className={styles.group}>
          <div className={styles.label}>Videos Per Row</div>
          <div className={styles.control}>
            <span className={styles.rangeLabel}>1</span>
            <input
              type="range"
              className={styles.slider}
              min="1"
              max="6"
              step="1"
              value={settings.videosPerRow}
              onChange={(e) => onUpdateSetting('videosPerRow', parseInt(e.target.value))}
            />
            <span className={`${styles.rangeLabel} ${styles.rangeLabelRight}`}>6</span>
          </div>
          <div className={styles.value}>
            {settings.videosPerRow === 1 ? '1 column' : `${settings.videosPerRow} columns`}
          </div>
        </div>

        {/* Density */}
        <div className={styles.group}>
          <div className={styles.label}>Layout Density</div>
          <div className={styles.buttons}>
            {DENSITY_OPTIONS.map((d) => (
              <button
                key={d}
                className={`${styles.settingBtn} ${settings.density === d ? styles.settingBtnActive : ''}`}
                onClick={() => onUpdateSetting('density', d)}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Duration Filter */}
        <div className={styles.group}>
          <div className={styles.label}>Video Duration</div>
          <div className={styles.durationControls}>
            <div className={styles.durationRow}>
              <span className={styles.durationLabel}>{durationMin}m</span>
              <input
                type="range"
                className={styles.slider}
                min="0"
                max="120"
                step="1"
                value={durationMin}
                onChange={(e) => {
                  const min = parseInt(e.target.value);
                  const currentMax = settings.durationFilter?.max === Infinity ? 120 : (settings.durationFilter?.max || 120);
                  const max = Math.max(min, currentMax);
                  onUpdateSetting('durationFilter', {
                    min,
                    max: max >= 120 ? Infinity : max,
                  });
                }}
              />
            </div>
            <div className={styles.durationRow}>
              <span className={styles.durationLabel}>{durationMax >= 120 ? '\u221E' : `${durationMax}m`}</span>
              <input
                type="range"
                className={styles.slider}
                min="0"
                max="120"
                step="1"
                value={durationMax}
                onChange={(e) => {
                  const max = parseInt(e.target.value);
                  const currentMin = settings.durationFilter?.min || 0;
                  const min = Math.min(currentMin, max);
                  onUpdateSetting('durationFilter', {
                    min,
                    max: max >= 120 ? Infinity : max,
                  });
                }}
              />
            </div>
          </div>
          <div className={styles.value}>{durationDisplay}</div>
        </div>

        {/* Cache Status */}
        <div className={styles.group}>
          <div className={styles.label}>Cache Status</div>
          <div className={styles.infoText}>{cacheDisplay}</div>
        </div>

        {/* Quota Status */}
        <div className={styles.group}>
          <div className={styles.label}>API Quota (Today)</div>
          <div
            className={styles.infoText}
            style={quotaData?.warning ? { color: 'var(--accent)' } : undefined}
          >
            {quotaData
              ? `${quotaData.used} / ${quotaData.budget} budget used (${quotaData.remaining} remaining)`
              : 'Loading...'}
          </div>
        </div>
      </div>
    </div>
  );
}
