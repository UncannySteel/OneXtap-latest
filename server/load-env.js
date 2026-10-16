/**
 * Load server/.env relative to this file so keys work no matter where `node` is started from
 * (e.g. repo root vs server/).
 *
 * ONEXTAP_SKIP_DOTENV=1 skips the file entirely. Only test/server/harness.js
 * sets it: a test run imports the real app, and must never pick up the live
 * keys a developer's server/.env holds.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.ONEXTAP_SKIP_DOTENV !== '1') {
  dotenv.config({ path: path.join(__dirname, '.env') });
}
