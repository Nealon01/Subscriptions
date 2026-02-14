import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createWriteStream } from 'fs';

import { initDatabase, closeDatabase } from './services/database.js';
import { sessionMiddleware } from './services/session.js';
import { setupWebSocket } from './services/websocket.js';
import { requestLogger } from './middleware/requestLogger.js';
import authRoutes from './routes/auth.js';
import feedRoutes from './routes/feed.js';
import playlistRoutes from './routes/playlist.js';
import settingsRoutes from './routes/settings.js';
import quotaRoutes from './routes/quota.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// File logging — mirror all console output to server.log
// ---------------------------------------------------------------------------
const logStream = createWriteStream(join(PROJECT_ROOT, 'server.log'), { flags: 'a' });

const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;

console.log = (...args) => {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  logStream.write(line);
  origLog.apply(console, args);
};

console.error = (...args) => {
  const line = `[${new Date().toISOString()}] ERROR: ${args.join(' ')}\n`;
  logStream.write(line);
  origError.apply(console, args);
};

console.warn = (...args) => {
  const line = `[${new Date().toISOString()}] WARN: ${args.join(' ')}\n`;
  logStream.write(line);
  origWarn.apply(console, args);
};

const PORT = parseInt(process.env.PORT || '3000', 10);
const isDev = process.env.NODE_ENV !== 'production';

// ---------------------------------------------------------------------------
// Initialize database
// ---------------------------------------------------------------------------
initDatabase(join(PROJECT_ROOT, 'cache', 'videos.db'));

// ---------------------------------------------------------------------------
// Create Express app
// ---------------------------------------------------------------------------
const app = express();

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS -- in development, allow any localhost origin (Vite picks available ports)
if (isDev) {
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }));
}

// Request logger — logs every HTTP request to server.log
app.use(requestLogger());

// Session middleware -- reads x-session-id header or sid query param
app.use(sessionMiddleware());

// ---------------------------------------------------------------------------
// Mount routes
// ---------------------------------------------------------------------------
app.use('/auth', authRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/playlist', playlistRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/quota', quotaRoutes);

// ---------------------------------------------------------------------------
// Serve Vite build in production
// ---------------------------------------------------------------------------
if (!isDev) {
  const distPath = join(PROJECT_ROOT, 'dist');
  app.use(express.static(distPath));

  // SPA fallback: serve index.html for any unmatched route
  app.get('*', (req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
}

// ---------------------------------------------------------------------------
// Create HTTP server + WebSocket
// ---------------------------------------------------------------------------
const server = createServer(app);
const { broadcast } = setupWebSocket(server);

// Make broadcast available to route handlers via app.locals
app.locals.broadcast = broadcast;

// ---------------------------------------------------------------------------
// Start listening
// ---------------------------------------------------------------------------
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] Port ${PORT} is already in use. Kill the old process and retry.`);
  } else {
    console.error(`[server] Server error:`, err.message);
  }
});

server.listen(PORT, () => {
  console.log(`[server] YouTube Subscriptions Viewer running on http://localhost:${PORT}`);
  console.log(`[server] Mode: ${isDev ? 'development' : 'production'}`);
  if (isDev) {
    console.log(`[server] Frontend dev server expected at http://localhost:5173`);
  }
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
  console.log(`\n[server] Received ${signal}, shutting down...`);
  server.close(() => {
    closeDatabase();
    console.log('[server] Clean shutdown complete');
    process.exit(0);
  });

  // Force exit after 5 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error('[server] Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app, server };
