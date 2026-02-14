import { useState, useCallback, useEffect, useRef } from 'react';
import { getSettings, saveSettings as apiSaveSettings } from '../services/api.js';

const DEFAULT_SETTINGS = {
  thumbSize: 168,
  videosPerRow: 1,
  density: 'normal',
  durationFilter: { min: 0, max: Infinity },
  playlistId: null,
};

export function useSettings(sessionId) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const loadedRef = useRef(false);

  // Load settings from server on mount (when authenticated)
  useEffect(() => {
    if (!sessionId || loadedRef.current) return;

    let cancelled = false;
    getSettings(sessionId)
      .then((data) => {
        if (cancelled || !data) return;
        // API returns { settings: {...} } — unwrap before merging
        const saved = data.settings || data;
        const merged = { ...DEFAULT_SETTINGS, ...saved };
        // Ensure durationFilter has proper structure
        if (merged.durationFilter) {
          merged.durationFilter = {
            min: merged.durationFilter.min || 0,
            max: merged.durationFilter.max === null || merged.durationFilter.max === undefined || merged.durationFilter.max >= 999
              ? Infinity
              : merged.durationFilter.max,
          };
        }
        setSettings(merged);
        loadedRef.current = true;
      })
      .catch((err) => {
        console.warn('Failed to load settings:', err);
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  const updateSetting = useCallback(
    (key, value) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        // Save to server in background
        if (sessionId) {
          // Serialize Infinity as a large number for JSON
          const toSave = { ...next };
          if (toSave.durationFilter && toSave.durationFilter.max === Infinity) {
            toSave.durationFilter = { ...toSave.durationFilter, max: 999 };
          }
          apiSaveSettings(sessionId, toSave).catch((err) => {
            console.warn('Failed to save settings:', err);
          });
        }
        return next;
      });
    },
    [sessionId]
  );

  return { settings, updateSetting, setSettings };
}
