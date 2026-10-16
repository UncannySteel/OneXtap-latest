/**
 * GET /api/health. Unauthenticated.
 */
import express from 'express';

const router = express.Router();

// ------------------------------------------------------------------
// Health Check
// ------------------------------------------------------------------
router.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
