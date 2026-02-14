import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { saveSession } from '../services/database.js';

const router = Router();

// All settings routes require authentication
router.use(requireAuth);

/**
 * GET /api/settings
 * Returns the current user's settings from their session.
 */
router.get('/', (req, res) => {
  res.json({
    settings: req.session.settings || {},
  });
});

/**
 * POST /api/settings
 * Merges the request body into the user's session settings.
 * Only updates keys that are provided -- does not overwrite the entire object.
 *
 * Body: Partial settings object (e.g. { layout: 'grid', columns: 4 })
 */
router.post('/', (req, res) => {
  try {
    const currentSettings = req.session.settings || {};
    const updatedSettings = { ...currentSettings, ...req.body };

    // Persist to database by re-saving the session with updated settings
    saveSession(
      req.sessionId,
      req.session.tokens,
      updatedSettings,
    );

    // Update in-memory session for the current request
    req.session.settings = updatedSettings;

    console.log(`[settings] Updated: ${Object.keys(req.body).join(', ')}`);
    res.json({
      settings: updatedSettings,
    });
  } catch (err) {
    console.error('[settings] Error saving settings:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

export default router;
