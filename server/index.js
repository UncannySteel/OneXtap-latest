import './load-env.js';
// Imported after ./load-env.js on purpose: logger.js reads LOG_LEVEL at module load.
import { log } from './logger.js';
// Lifted out of this file so the ranking graph can share them without
// importing an Express app that calls app.listen(). Behaviour unchanged.
import { GROQ_ANSWER_MODEL } from './groqClient.js';
// The app itself: middleware order in ./app.js, routes in ./routes/.
import app from './app.js';

// ------------------------------------------------------------------
// Start Server (only when running locally, not on Vercel)
// ------------------------------------------------------------------
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    log.info(`Onextap server running on port ${PORT}`);
    log.info(`Webhook endpoint: POST /api/webhook`);
    log.info(`Health check:     GET  /api/health`);
    log.info(
      `[Answer Studio] provider=groq model=${GROQ_ANSWER_MODEL} GROQ_API_KEY=${process.env.GROQ_API_KEY ? 'set' : 'MISSING'}`
    );
  });
}

export default app;
