import { Router } from 'express';
import { getStatus } from '../services/quota.js';

const router = Router();

/**
 * GET /api/quota
 * Returns the current quota usage status.
 * No auth required -- quota info is useful for debugging even without login.
 */
router.get('/', (req, res) => {
  try {
    const status = getStatus();
    res.json(status);
  } catch (err) {
    console.error('[quota] Error fetching quota status:', err);
    res.status(500).json({ error: 'Failed to fetch quota status' });
  }
});

export default router;
