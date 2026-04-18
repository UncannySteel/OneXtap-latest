/**
 * Load server/.env relative to this file so keys work no matter where `node` is started from
 * (e.g. repo root vs server/).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });
