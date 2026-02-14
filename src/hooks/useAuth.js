import { useState, useEffect, useCallback } from 'react';
import { checkAuth, getLoginUrl } from '../services/api.js';

const STORAGE_KEY = 'yt_subs_sid';

export function useAuth() {
  const [sessionId, setSessionId] = useState(() => {
    // Check URL params first (OAuth callback), then localStorage
    const params = new URLSearchParams(window.location.search);
    const sidFromUrl = params.get('sid');
    if (sidFromUrl) {
      localStorage.setItem(STORAGE_KEY, sidFromUrl);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
      return sidFromUrl;
    }
    return localStorage.getItem(STORAGE_KEY);
  });

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setIsAuthenticated(false);
      setAuthChecked(true);
      return;
    }

    let cancelled = false;
    checkAuth(sessionId).then((data) => {
      if (cancelled) return;
      if (data.authenticated) {
        setIsAuthenticated(true);
      } else {
        // Invalid session
        setSessionId(null);
        setIsAuthenticated(false);
        localStorage.removeItem(STORAGE_KEY);
      }
      setAuthChecked(true);
    }).catch(() => {
      if (cancelled) return;
      setAuthChecked(true);
    });

    return () => { cancelled = true; };
  }, [sessionId]);

  const login = useCallback(async () => {
    const data = await getLoginUrl();
    window.location.href = data.url;
  }, []);

  const logout = useCallback(() => {
    setSessionId(null);
    setIsAuthenticated(false);
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  }, []);

  return { sessionId, isAuthenticated, authChecked, login, logout };
}
