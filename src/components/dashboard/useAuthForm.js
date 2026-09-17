import { useState } from 'react';
import { signIn as supaSignIn, signInWithOAuth, signUp as supaSignUp } from '../../auth';
import { log as baseLog } from '../../logger';

const log = baseLog.child('auth');

/**
 * Password strength for the sign-up form.
 * @param {string} password
 * @returns {'weak'|'medium'|'strong'|null} null for an empty password.
 */
const getPasswordStrength = (password) => {
  if (!password) return null;

  const lengthScore = password.length;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  // Very basic guardrails
  if (lengthScore < 8 || !(hasUpper && hasLower && hasNumber)) {
    return 'weak';
  }

  // Strong: long and uses multiple character types
  if (lengthScore >= 12 && hasUpper && hasLower && hasNumber && hasSymbol) {
    return 'strong';
  }

  // Everything else that passes the minimum is "medium"
  return 'medium';
};

/**
 * Email/password + Google sign-in form state and handlers.
 *
 * Extracted from DashboardView, which was carrying eight pieces of state and
 * two handlers purely to feed PublicLandingPage. The returned object is
 * exactly PublicLandingPage's auth prop interface, so callers spread it:
 *
 *   const authForm = useAuthForm({ onAuthenticated });
 *   <PublicLandingPage {...authForm} ... />
 *
 * The hook owns no session — it reports success through `onAuthenticated` and
 * lets the caller remain the auth boundary. Google sign-in redirects, so it
 * resolves nothing on the happy path and only clears the busy flag on failure.
 *
 * @param {object} props
 * @param {(user: object) => void} props.onAuthenticated Called with the signed-in user.
 */
export function useAuthForm({ onAuthenticated }) {
  const [authMode, setAuthMode] = useState('signin'); // 'signin' | 'signup'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(null); // 'weak' | 'medium' | 'strong' | null
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSignIn = async () => {
    if (!authEmail || !authPassword) {
      setAuthError('Please enter your email and password.');
      return;
    }

    // On signup, enforce at least a medium-strength password
    if (authMode === 'signup') {
      const strength = getPasswordStrength(authPassword);
      setPasswordStrength(strength);
      if (strength === 'weak') {
        setAuthError('Please use a stronger password (min 8 characters, with upper/lowercase letters and numbers).');
        return;
      }
    }

    setIsSigningIn(true);
    setAuthError('');
    try {
      if (authMode === 'signup') {
        const { user: newUser, error } = await supaSignUp(authEmail, authPassword, authName);
        if (error) throw error;
        if (newUser) {
          onAuthenticated(newUser);
        } else {
          setAuthError('Check your email for a confirmation link.');
        }
      } else {
        const { user: existingUser, session, error } = await supaSignIn(authEmail, authPassword);
        if (error) throw error;
        const signedInUser = existingUser || session?.user || null;
        if (!signedInUser) {
          setAuthError('Sign in succeeded but no session was returned. Please try again.');
          return;
        }
        onAuthenticated(signedInUser);
      }
    } catch (error) {
      log.error('Auth failed:', error);
      setAuthError(error.message || 'Authentication failed. Please try again.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setAuthError('');
    try {
      const { error } = await signInWithOAuth('google');
      if (error) throw error;
      // OAuth redirect will handle the rest
    } catch (error) {
      log.error('Google sign in failed:', error);
      setAuthError(error.message || 'Google sign-in failed.');
      setIsSigningIn(false);
    }
  };

  return {
    authMode, setAuthMode,
    authName, setAuthName,
    authEmail, setAuthEmail,
    authPassword, setAuthPassword,
    showPassword, setShowPassword,
    passwordStrength, setPasswordStrength,
    authError,
    isSigningIn,
    handleSignIn,
    handleGoogleSignIn,
  };
}
