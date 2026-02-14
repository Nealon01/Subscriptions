export function createWebSocket() {
  let ws = null;
  let listeners = [];
  let statusListeners = [];
  let reconnectTimer = null;
  let intentionallyClosed = false;

  function notifyStatus(connected) {
    statusListeners.forEach((cb) => cb(connected));
  }

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      notifyStatus(true);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      notifyStatus(false);
      if (!intentionallyClosed) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        listeners.forEach((cb) => cb(message));
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };
  }

  connect();

  return {
    onMessage(callback) {
      listeners.push(callback);
      return () => {
        listeners = listeners.filter((cb) => cb !== callback);
      };
    },

    onStatusChange(callback) {
      statusListeners.push(callback);
      // Fire immediately with current state
      callback(ws && ws.readyState === WebSocket.OPEN);
      return () => {
        statusListeners = statusListeners.filter((cb) => cb !== callback);
      };
    },

    isConnected() {
      return ws && ws.readyState === WebSocket.OPEN;
    },

    close() {
      intentionallyClosed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
      listeners = [];
      statusListeners = [];
    },
  };
}
