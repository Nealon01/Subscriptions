import { randomBytes } from 'crypto';
import {
  getSession as dbGetSession,
  saveSession as dbSaveSession,
  destroySession as dbDestroySession,
  touchSession as dbTouchSession,
} from './database.js';

/**
 * Generate a cryptographically random session ID.
 * @returns {string} 32-byte hex string
 */
function generateSid() {
  return randomBytes(32).toString('hex');
}

/**
 * Create a new session with the given OAuth tokens.
 * @param {object} tokens - Google OAuth2 tokens
 * @param {object} [settings={}] - Initial user settings
 * @returns {string} The new session ID
 */
export function createSession(tokens, settings = {}) {
  const sid = generateSid();
  dbSaveSession(sid, tokens, settings);
  return sid;
}

/**
 * Destroy a session by ID.
 * @param {string} sid
 */
export function destroySession(sid) {
  dbDestroySession(sid);
}

/**
 * Get a session by ID, parsing the JSON fields.
 * Returns null if the session doesn't exist.
 * @param {string} sid
 * @returns {{ sid: string, tokens: object, settings: object, createdAt: number, lastUsed: number }|null}
 */
export function getSession(sid) {
  const row = dbGetSession(sid);
  if (!row) return null;

  return {
    sid: row.sid,
    tokens: JSON.parse(row.tokens_json),
    settings: JSON.parse(row.settings_json || '{}'),
    createdAt: row.created_at,
    lastUsed: row.last_used,
  };
}

/**
 * Update the tokens for an existing session.
 * @param {string} sid
 * @param {object} tokens - Updated OAuth tokens
 */
export function updateSessionTokens(sid, tokens) {
  const session = getSession(sid);
  if (!session) return;
  dbSaveSession(sid, tokens, session.settings);
}

/**
 * Express middleware that reads the session ID from the `x-session-id` header
 * (or `sid` query parameter) and attaches the session to `req.session`.
 *
 * Does NOT reject requests without a session -- that's the job of requireAuth.
 *
 * @returns {import('express').RequestHandler}
 */
export function sessionMiddleware() {
  return (req, res, next) => {
    const sid = req.headers['x-session-id'] || req.query.sid;

    if (sid) {
      const session = getSession(sid);
      if (session) {
        req.session = session;
        req.sessionId = sid;
        // Touch to keep session alive
        dbTouchSession(sid);
      } else {
        // Session ID provided but not found -- don't attach anything
        req.session = null;
        req.sessionId = null;
      }
    } else {
      req.session = null;
      req.sessionId = null;
    }

    next();
  };
}
