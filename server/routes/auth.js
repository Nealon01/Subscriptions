import { Router } from 'express';
import { google } from 'googleapis';
import { randomBytes } from 'crypto';
import { createSession, destroySession } from '../services/session.js';
import { saveAuthState, consumeAuthState, cleanExpiredAuthStates } from '../services/database.js';

const router = Router();

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube',
];

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback',
  );
}

/**
 * GET /auth/login?returnUrl=http://localhost:5174
 * Returns a JSON object with the Google OAuth URL.
 * The frontend passes its origin so the callback knows where to redirect.
 */
router.get('/login', (req, res) => {
  const oauth2Client = createOAuth2Client();
  const state = randomBytes(16).toString('hex');
  const returnUrl = req.query.returnUrl || '';

  // Persist state in SQLite (survives server restarts in --watch mode)
  const expiresAt = Date.now() + 10 * 60 * 1000;
  saveAuthState(state, returnUrl, expiresAt);

  // Clean up expired states
  cleanExpiredAuthStates();

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent',
  });

  console.log(`[auth] Login initiated, returnUrl=${returnUrl || '(none)'}`);
  res.json({ url, state });
});

/**
 * GET /auth/callback
 * Handles the OAuth callback from Google. Exchanges the authorization code
 * for tokens, creates a session, and redirects to the frontend with the session ID.
 */
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('[auth] OAuth error:', error);
    return res.status(400).json({ error: `OAuth error: ${error}` });
  }

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  // Validate state parameter (CSRF protection) — consumed from SQLite
  const authState = consumeAuthState(state);
  if (!authState) {
    return res.status(400).json({ error: 'Invalid or expired state parameter' });
  }

  if (Date.now() > authState.expires_at) {
    return res.status(400).json({ error: 'State parameter expired' });
  }

  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    const sid = createSession(tokens);
    console.log('[auth] New session created:', sid.substring(0, 8) + '...');

    // Redirect back to the frontend origin (handles any Vite port)
    const returnUrl = authState.return_url || '';
    res.redirect(`${returnUrl}/?sid=${sid}`);
  } catch (err) {
    console.error('[auth] Token exchange failed:', err.message);
    res.status(500).json({ error: 'Failed to exchange authorization code for tokens' });
  }
});

/**
 * GET /auth/status
 */
router.get('/status', (req, res) => {
  res.json({
    authenticated: !!(req.session && req.session.tokens),
  });
});

/**
 * POST /auth/logout
 */
router.post('/logout', (req, res) => {
  if (req.sessionId) {
    console.log(`[auth] Logout session ${req.sessionId.substring(0, 8)}...`);
    destroySession(req.sessionId);
  }
  res.json({ ok: true });
});

export default router;
