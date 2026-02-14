import React, { useState, useEffect } from 'react';
import { getQuota } from '../services/api.js';
import styles from './SettingsPanel.module.css';

const DENSITY_OPTIONS = ['compact', 'normal', 'comfortable'];

export default function SettingsPanel({ isOpen, settings, onUpdateSetting, cacheTimestamp }) {
  const [quotaData, setQuotaData] = useState(null);
  const [, setTick] = useState(0);

  // Fetch quota when panel opens
  useEffect(() => {
    if (!isOpen) return;
    getQuota().then(setQuotaData).catch(() => {});
  }, [isOpen]);

  // Update cache age display every 30s
  useEffect(() => {
    if (!cacheTimestamp) return;
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [cacheTimestamp]);

  // Compute cache age display
  const cacheDisplay = (() => {
    if (!cacheTimestamp) return 'No cache';
    const age = Date.now() - cacheTimestamp;
    const minutes = Math.floor(age / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `Updated ${hours}h ${minutes % 60}m ago`;
    if (minutes < 1) return 'Updated just now';
    return `Updated ${minutes}m ago`;
  })();

  // Duration filter values
  const durMin = settings.durationFilter?.min || 0;
  const durMax = settings.durationFilter?.max ?? Infinity;
  const isAllDurations = durMin === 0 && durMax === Infinity;

  const durationDisplay = (() => {
    if (isAllDurations) return 'All durations';
    if (durMin === 0) return `Up to ${durMax} min`;
    if (durMax === Infinity) return `${durMin}+ min`;
    return `${durMin} – ${durMax} min`;
  })();

  const stepDuration = (field, delta) => {
    const curMin = settings.durationFilter?.min || 0;
    const curMax = settings.durationFilter?.max ?? Infinity;

    if (field === 'min') {
      const next = Math.max(0, curMin + delta);
      // Don't let min exceed max (unless max is Infinity)
      const clamped = curMax === Infinity ? next : Math.min(next, curMax);
      onUpdateSetting('durationFilter', { min: clamped, max: curMax });
    } else {
      if (curMax === Infinity) {
        // Stepping from "no limit" — start at 60 (down) or delta value (up)
        const start = delta > 0 ? delta : 60;
        onUpdateSetting('durationFilter', { min: Math.min(curMin, start), max: start });
        return;
      }
      const next = Math.max(0, curMax + delta);
      onUpdateSetting('durationFilter', { min: Math.min(curMin, next), max: next || Infinity });
    }
  };

  const setDurationField = (field, value) => {
    const curMin = settings.durationFilter?.min || 0;
    const curMax = settings.durationFilter?.max ?? Infinity;
    const num = Math.max(0, parseInt(value) || 0);

    if (field === 'min') {
      const clamped = curMax === Infinity ? num : Math.min(num, curMax);
      onUpdateSetting('durationFilter', { min: clamped, max: curMax });
    } else {
      onUpdateSetting('durationFilter', { min: Math.min(curMin, num), max: num || Infinity });
    }
  };

  const resetDuration = () => {
    onUpdateSetting('durationFilter', { min: 0, max: Infinity });
  };

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
              <span className={styles.durationFieldLabel}>Min</span>
              <div className={styles.stepper}>
                <button className={styles.stepBtn} onClick={() => stepDuration('min', -60)}>-1h</button>
                <button className={styles.stepBtn} onClick={() => stepDuration('min', -10)}>-10</button>
                <button className={styles.stepBtn} onClick={() => stepDuration('min', -1)}>-1</button>
                <input
                  type="number"
                  className={styles.durationInput}
                  min="0"
                  value={durMin}
                  onChange={(e) => setDurationField('min', e.target.value)}
                />
                <button className={styles.stepBtn} onClick={() => stepDuration('min', 1)}>+1</button>
                <button className={styles.stepBtn} onClick={() => stepDuration('min', 10)}>+10</button>
                <button className={styles.stepBtn} onClick={() => stepDuration('min', 60)}>+1h</button>
              </div>
            </div>
            <div className={styles.durationRow}>
              <span className={styles.durationFieldLabel}>Max</span>
              <div className={styles.stepper}>
                <button className={styles.stepBtn} onClick={() => stepDuration('max', -60)}>-1h</button>
                <button className={styles.stepBtn} onClick={() => stepDuration('max', -10)}>-10</button>
                <button className={styles.stepBtn} onClick={() => stepDuration('max', -1)}>-1</button>
                {durMax === Infinity ? (
                  <input
                    type="text"
                    className={styles.durationInput}
                    value="No limit"
                    readOnly
                    onClick={() => stepDuration('max', -1)}
                  />
                ) : (
                  <input
                    type="number"
                    className={styles.durationInput}
                    min="0"
                    value={durMax}
                    onChange={(e) => setDurationField('max', e.target.value)}
                  />
                )}
                <button className={styles.stepBtn} onClick={() => stepDuration('max', 1)}>+1</button>
                <button className={styles.stepBtn} onClick={() => stepDuration('max', 10)}>+10</button>
                <button className={styles.stepBtn} onClick={() => stepDuration('max', 60)}>+1h</button>
              </div>
            </div>
            {!isAllDurations && (
              <button className={styles.resetBtn} onClick={resetDuration}>Reset to All</button>
            )}
          </div>
          <div className={styles.value}>{durationDisplay}</div>
        </div>

        {/* Status */}
        <div className={styles.group}>
          <div className={styles.label}>Status</div>
          <div className={styles.infoText}>{cacheDisplay}</div>
          <div
            className={styles.infoText}
            style={quotaData?.warning ? { color: 'var(--accent)' } : undefined}
          >
            {quotaData
              ? `Quota: ${quotaData.used} / ${quotaData.total} (${quotaData.total - quotaData.used} left)`
              : 'Quota: loading...'}
          </div>
        </div>
      </div>
    </div>
  );
}
