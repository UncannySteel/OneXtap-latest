/**
 * Error text for JSON responses, shared by the routers in server/routes/.
 */
import { formatSupabaseError } from '../supabase.js';

export function apiErrorMessage(error) {
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }
  return formatSupabaseError(error);
}

/** Provider/database error text in a JSON body. Enough to act on, never a stack. */
const CLIENT_ERROR_CHARS = 300;

/**
 * A provider or database error, trimmed to something a client can display.
 *
 * postgrest-js puts the whole `TypeError: fetch failed` stack into `details`,
 * and formatSupabaseError joins message + details — so an unreachable database
 * produces a JSON body containing a multi-line Node stack trace. It is JSON
 * rather than Express's HTML error page, but a stack in a response body is
 * still a stack in a response body: it tells the user nothing, it is the kind
 * of internal detail that should not cross a trust boundary, and it makes the
 * actual message impossible to find.
 *
 * The first line carries the diagnosis; the rest is for the log, which already
 * has it under the same X-Request-Id.
 *
 * Applied in the job routes only. The existing routes are left exactly as they
 * were — changing what they return is a separate decision from adding these.
 *
 * @param {unknown} error
 * @returns {string} A single line, never empty.
 */
export function clientErrorMessage(error) {
  const raw = apiErrorMessage(error);
  const firstLine = String(raw).split('\n')[0].trim();
  return (firstLine || 'Request failed').slice(0, CLIENT_ERROR_CHARS);
}
