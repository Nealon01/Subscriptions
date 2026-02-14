import { WebSocketServer } from 'ws';

/** @type {WebSocketServer} */
let wss;

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

/**
 * Set up WebSocket server attached to an existing HTTP server.
 * @param {import('http').Server} server - The HTTP server to attach to
 * @returns {{ broadcast: (type: string, data: any) => void }}
 */
export function setupWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[ws] Client connected (${clients.size} total)`);

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[ws] Client disconnected (${clients.size} total)`);
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        console.log(`[ws] Received "${msg.type}" from client`);
      } catch {
        console.warn(`[ws] Received non-JSON message from client: ${raw.toString().slice(0, 100)}`);
      }
    });

    ws.on('error', (err) => {
      console.error('[ws] Client error:', err.message);
      clients.delete(ws);
    });
  });

  return { broadcast };
}

/**
 * Broadcast a JSON message to all connected WebSocket clients.
 * @param {string} type - Message type (e.g. 'refresh:progress', 'refresh:complete')
 * @param {any} data - Payload to send
 */
export function broadcast(type, data) {
  const message = JSON.stringify({ type, data });
  let sent = 0;

  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
      sent++;
    }
  }

  if (sent > 0) {
    console.log(`[ws] Broadcast "${type}" to ${sent} client(s)`);
  } else {
    console.log(`[ws] Broadcast "${type}" (no clients connected)`);
  }
}
