/**
 * Server-side Supabase Admin Client & JWT Auth Middleware
 *
 * Uses the service_role key so the server can bypass RLS and
 * manage profiles / credits on behalf of authenticated users.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    '[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in server .env'
  );
} else if (
  supabaseServiceKey.includes('PASTE_') ||
  supabaseServiceKey === 'eyJ...your-service-role-key...'
) {
  console.error(
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
// Helper: get or create a profile row for a user
// ------------------------------------------------------------------
export async function getProfile(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId, updates) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ------------------------------------------------------------------
// JWT Auth Middleware
// Extracts the Supabase JWT from the Authorization header,
// verifies it, and attaches req.userId + req.userEmail.
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
        console.error('[Auth] Token verification failed:', error?.message || 'No user in response');
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      req.userId = data.user.id;
      req.userEmail = data.user.email;
      req.accessToken = token;
      next();
    })
    .catch((err) => {
      console.error('[Auth] Token verification error:', err?.message || err);
      res.status(401).json({ error: 'Token verification failed' });
    });
}
