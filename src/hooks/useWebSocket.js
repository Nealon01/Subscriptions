import { useEffect, useRef, useState } from 'react';
import { createWebSocket } from '../services/websocket.js';

export function useWebSocket(handlers = {}) {
  const wsRef = useRef(null);
  const handlersRef = useRef(handlers);
  const [isConnected, setIsConnected] = useState(false);

  // Keep handlers ref updated without causing reconnections
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const ws = createWebSocket();
    wsRef.current = ws;

    // Poll connection status
    const statusInterval = setInterval(() => {
      setIsConnected(ws.isConnected());
    }, 1000);

    const unsubscribe = ws.onMessage((message) => {
      const h = handlersRef.current;

      switch (message.type) {
        case 'videoAdded':
          if (h.onVideoAdded) h.onVideoAdded(message.data);
          break;
        case 'videoRemoved':
          if (h.onVideoRemoved) h.onVideoRemoved(message.data);
          break;
        case 'refreshProgress':
          if (h.onRefreshProgress) h.onRefreshProgress(message.data);
          break;
        case 'refreshComplete':
          if (h.onRefreshComplete) h.onRefreshComplete(message.data);
          break;
        case 'refreshError':
          if (h.onRefreshError) h.onRefreshError(message.data);
          break;
        default:
          break;
      }
    });

    return () => {
      clearInterval(statusInterval);
      unsubscribe();
      ws.close();
      wsRef.current = null;
    };
  }, []); // Only connect once

  return { isConnected };
}
