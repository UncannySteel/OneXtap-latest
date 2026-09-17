/**
 * Server-side Supabase Admin Client & JWT Auth Middleware
 *
 * Uses the service_role key so the server can bypass RLS and
 * manage profiles / credits on behalf of authenticated users.
 */
import { createClient } from '@supabase/supabase-js';
import { log } from './logger.js';

const authLog = log.child('auth');
const dbLog = log.child('db');

/** Human-readable message for API JSON + logs (PostgREST / Postgres). */
export function formatSupabaseError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  const msg = err.message || err.msg || '';
  const details = err.details || '';
  const hint = err.hint || '';
  const code = err.code || '';
  const parts = [msg, details, hint].filter(Boolean);
  if (parts.length) return parts.join(' — ');
  if (code) return `Database error (code ${code})`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  dbLog.error(
    '[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in server .env'
  );
} else if (
  supabaseServiceKey.includes('PASTE_') ||
  supabaseServiceKey === 'eyJ...your-service-role-key...'
) {
  dbLog.error(
    '[Supabase] SUPABASE_SERVICE_ROLE_KEY appears to be a placeholder. Replace it with your real key from Supabase → Settings → API → service_role'
  );
}

/**
 * Admin client — bypasses RLS. Use for server-side operations only.
 */
export const supabaseAdmin = createClient(
  supabaseUrl || '',
  supabaseServiceKey || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ------------------------------------------------------------------
// Helper: get profile row; create one if missing (e.g. no auth trigger in DB)
// ------------------------------------------------------------------
export async function getProfile(userId, userEmail = null) {
  if (!userId) throw new Error('Missing user id');
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Server misconfiguration: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env'
    );
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new Error(formatSupabaseError(error));
  if (data) return data;

  const email = typeof userEmail === 'string' ? userEmail.trim() : '';
  const displayName = email.includes('@')
    ? email.split('@')[0]
    : (email || 'User');

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: userId,
      email: email || null,
      display_name: displayName,
      credits: 3,
      is_premium: false,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: retry, error: retryErr } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (retryErr) throw new Error(formatSupabaseError(retryErr));
      if (retry) return retry;
    }
    throw new Error(
      `Could not create profile row: ${formatSupabaseError(insertError)}. ` +
        'Confirm public.profiles exists and matches supabase/schema.sql.'
    );
  }

  const { error: backfillTxError } = await supabaseAdmin
    .from('credit_transactions')
    .insert({
      user_id: userId,
      amount: 3,
      type: 'initial',
      description: 'Profile backfill: welcome credits (row was missing)',
    });
  if (backfillTxError) {
    dbLog.warn(
      '[Supabase] credit_transactions backfill failed after profile insert:',
      formatSupabaseError(backfillTxError)
    );
  }

  return inserted;
}

export async function updateProfile(userId, updates) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw new Error(formatSupabaseError(error));
  return data;
}

// ------------------------------------------------------------------
// JWT Auth Middleware
// Extracts the Supabase JWT from the Authorization header, verifies it,
// and attaches req.userId, req.userEmail and req.accessToken.
// Responds 401 (never calls next()) when the header is missing or the
// token fails verification.
// ------------------------------------------------------------------
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);

  // Use Supabase to verify the token and retrieve the user
  supabaseAdmin.auth
    .getUser(token)
    .then(({ data, error }) => {
      if (error || !data?.user) {
        authLog.error('token verification failed:', error?.message || 'No user in response');
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      req.userId = data.user.id;
      req.userEmail = data.user.email;
      req.accessToken = token;
      next();
    })
    .catch((err) => {
      authLog.error('token verification error:', err?.message || err);
      res.status(401).json({ error: 'Token verification failed' });
    });
}
