// Backend boundary. Everything the dashboard asks of the account, the API or
// the extension goes through here, on the same client modules the extension
// popup uses (src/): Supabase auth, the server-verified credit manager, the
// local profile store, the extension messaging helpers.
//
// Two rules from the backend carry over unchanged (CLAUDE.md):
//   - credits and premium are the server's (creditManager); nothing here
//     computes or adjusts a balance;
//   - profile data stays on the device (localStorage here, chrome.storage in
//     the extension) and reaches the extension only by ONEXTAP_SYNC_DATA.

import { supabase } from '@app/supabaseClient.js';
import { signOut, onAuthStateChange } from '@app/auth.js';
import { creditManager } from '@app/creditManager.js';
import { storage } from '@app/storage.js';
import { getActiveLegacyProfile } from '@app/profileStore.js';
import { getExtensionInfo, hasExtensionRuntime, sendToExtension, syncProfileToExtension } from '@app/extensionClient.js';
import { log as baseLog } from '@app/logger.js';

const log = baseLog.child('dashboard');

// ---------- Session ----------

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

/**
 * Off to the landing page's sign-in window, coming back here afterwards.
 * A session that did not work is dropped first, locally, so the landing page
 * does not read it as signed in (and nothing bounces between the two).
 */
export async function sendToSignIn() {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    /* nothing to drop */
  }
  const back = location.pathname + location.search + location.hash;
  location.replace(`/?login=1&next=${encodeURIComponent(back)}`);
}

/** Signed out in another tab, or the session could not be refreshed. */
export function onSignedOut(fn) {
  return onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') fn();
  });
}

// ---------- The user ----------

const AVATAR_KEY = (userId) => `onextap_avatar_${userId}`;

function nameFrom(authUser, account, profile) {
  const meta = authUser?.user_metadata || {};
  const fromProfile = [profile?.firstName, profile?.lastName].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  const candidates = [meta.full_name, meta.name, account?.displayName, fromProfile, String(authUser?.email || '').split('@')[0]];
  return String(candidates.find((c) => String(c || '').trim()) || 'You').trim();
}

/**
 * The signed-in user, as the dashboard shows them. Throws when the account
 * cannot be read (GET /api/me); a 401 there means the session is dead.
 *
 * `credits` is `Infinity` on Premium — guard with Number.isFinite before
 * rendering or comparing (CLAUDE.md rule 3).
 */
export async function getCurrentUser(session) {
  const authUser = session.user;
  const meta = authUser.user_metadata || {};
  const [account, profile, storedAvatar] = await Promise.all([
    creditManager.getAccount(),
    getActiveLegacyProfile().catch(() => null),
    storage.get(AVATAR_KEY(authUser.id)).catch(() => null),
  ]);
  const isPremium = account.isPremium === true;
  return {
    id: authUser.id,
    name: nameFrom(authUser, account, profile),
    // The account's own name wins; only without one does the profile's
    // stand in (and follow it when the profile is saved).
    nameFromAccount: !!(meta.full_name || meta.name || String(account.displayName || '').trim()),
    email: authUser.email || account.email || '',
    plan: isPremium ? 'pro' : 'standard',
    credits: isPremium ? Infinity : (Number.isFinite(account.credits) ? account.credits : 0),
    renewsOn: null,
    cancelAtPeriodEnd: false,
    // Chosen here and kept on this device (settings → Change avatar), else
    // the Google photo, else initials.
    avatarUrl: (typeof storedAvatar === 'string' && storedAvatar) || meta.avatar_url || meta.picture || null,
    createdAt: authUser.created_at || account.createdAt || null,
  };
}

/**
 * Premium status re-checked against Dodo, with the billing dates the
 * subscription panel shows. Resolves null when the check itself failed, so
 * a network blip never reads as a downgrade.
 */
export async function getSubscription() {
  const sub = await creditManager.getSubscription();
  if (sub.error) return null;
  return {
    plan: sub.isPremium ? 'pro' : 'standard',
    renewsOn: sub.nextBillingDate ? String(sub.nextBillingDate).slice(0, 10) : null,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd === true,
  };
}

/** The current balance: a number, `Infinity` on Premium, or null if it could not be read. */
export async function getCredits() {
  const { credits, error } = await creditManager.getCreditsWithStatus();
  return error ? null : credits;
}

// ---------- Avatar (kept on this device) ----------

const AVATAR_SIZE = 256;

function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read.'));
    };
    img.src = url;
  });
}

/**
 * Crops the picture square, shrinks it to 256px and keeps it in this
 * browser's storage — like the profile, it never goes to a server. Resolves
 * with the image's data URL.
 */
export async function updateAvatar(file, userId) {
  const { img, url } = await readImage(file);
  try {
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const out = Math.min(AVATAR_SIZE, side);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = out;
    canvas.getContext('2d').drawImage(img,
      (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
      0, 0, out, out);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    await storage.setStrict(AVATAR_KEY(userId), dataUrl);
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Plan ----------

/**
 * Moves the user to another plan.
 *   → pro:      with a cancellation pending, keeps Premium (withdraws it);
 *               otherwise off to Dodo's checkout — the page unloads, and
 *               the return lands on ?payment=success (main.js).
 *   → standard: cancels Premium at the end of the paid period (Premium runs
 *               until then), or at once if it is not in good standing.
 * Resolves with the change to apply to the user.
 */
export async function changePlan(plan, user) {
  if (plan === 'pro') {
    if (user?.cancelAtPeriodEnd) {
      const res = await creditManager.resumeSubscription();
      return { plan: 'pro', cancelAtPeriodEnd: false, renewsOn: res.nextBillingDate ? String(res.nextBillingDate).slice(0, 10) : user.renewsOn };
    }
    const { url } = await creditManager.createCheckoutSession();
    location.assign(url);
    return new Promise(() => {}); // the page is leaving
  }

  const res = await creditManager.cancelSubscription();
  if (res.cancelAtPeriodEnd) {
    return { plan: 'pro', cancelAtPeriodEnd: true, renewsOn: res.endsAt ? String(res.endsAt).slice(0, 10) : user?.renewsOn ?? null };
  }
  const credits = await getCredits();
  return { plan: 'standard', cancelAtPeriodEnd: false, renewsOn: null, credits: credits ?? 0 };
}

/**
 * Dodo's billing portal (invoices, the card on file), in a new tab. The tab
 * is opened on the click itself and pointed at the portal once the link
 * arrives — opened after an await, browsers block it as a pop-up.
 */
export async function openSubscriptionPortal() {
  const tab = window.open('', '_blank');
  try {
    const { url } = await creditManager.createPortalSession();
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      location.assign(url);
    }
  } catch (error) {
    tab?.close();
    throw error;
  }
}

// ---------- Leaving ----------

// The keys signing out clears, as the backend's dashboard did: the active
// profile's flat copy and the profile store. (Resumes and the avatar stay.)
const SIGN_OUT_KEYS = ['user_profile', 'onextap_profiles'];

/** Signs out, clears this browser's profile copy, and goes to the landing page. */
export async function logOut() {
  await signOut();
  try {
    SIGN_OUT_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch (err) {
    log.warn('Storage clear on sign-out:', err);
  }
  location.assign('/');
}

/**
 * What deleting the account does to the extension in this browser, from its
 * answer to ONEXTAP_HELLO (docs/extension-protocol.md, "The wipe"):
 *   'wipes'  a current extension with `wipe-local`: its copy is cleared too;
 *   'keeps'  one that cannot clear it (store 1.0.2, or a current build
 *            without the capability): its copy stays until it is removed;
 *   'none'   no extension answers from this page.
 * The delete dialog's copy follows it; deleteAccount() asks again. Never
 * rejects.
 */
export async function extensionWipeState() {
  const { state, capabilities } = await getExtensionInfo();
  if (state === 'current' && capabilities.includes('wipe-local')) return 'wipes';
  return state === 'absent' ? 'none' : 'keeps';
}

/** How long the wipe may take before the deletion goes home without it. */
const WIPE_TIMEOUT_MS = 5000;

/**
 * ONEXTAP_WIPE_LOCAL, after the account is gone. Resolves with what became of
 * the extension's copy:
 *   'cleared'  the extension confirmed it;
 *   'failed'   it was asked (the dialog promised it) and did not confirm: no
 *              reply within WIPE_TIMEOUT_MS, `success` not true, or a throw;
 *   null       not asked: the extension can't clear it, or there is none, as
 *              the dialog said.
 * Never rejects: the account is already deleted, and a copy left in the
 * extension does not undo that.
 */
async function wipeExtension() {
  if (await extensionWipeState() !== 'wipes') return null;
  let timer;
  try {
    const reply = await Promise.race([
      sendToExtension('ONEXTAP_WIPE_LOCAL'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('No reply from the extension')), WIPE_TIMEOUT_MS); }),
    ]);
    if (reply?.success === true) return 'cleared';
    log.warn('the extension did not clear its copy', { reason: reply?.error || 'no success' });
  } catch (err) {
    log.warn('the extension could not be asked to clear its copy', { reason: err?.message });
  } finally {
    clearTimeout(timer);
  }
  return 'failed';
}

/**
 * Deletes the account on the server (DELETE /api/account: cancels any live
 * subscription, then the Supabase user and everything keyed to it), then the
 * extension's copy when it can clear it (ONEXTAP_WIPE_LOCAL), then everything
 * this browser holds for the dashboard, then signs out. Throws with the
 * server's message if the deletion did not happen — nothing local, in the
 * extension or here, is touched in that case.
 *
 * Going home: signing out raises SIGNED_OUT, and the dashboard's handler for
 * it (onSignedOut, main.js) takes the page home; this does it only when signing
 * out failed, so the page leaves once.
 *
 * @param {{ beforeLeaving?: (extension: 'cleared'|'failed'|null) => (void|Promise<void>) }} [options]
 *   Awaited once this browser's copy is cleared and before signing out, with
 *   wipeExtension()'s outcome: the page's last chance to say what happened.
 */
export async function deleteAccount({ beforeLeaving } = {}) {
  await creditManager.deleteAccount();
  const extension = await wipeExtension();
  try {
    localStorage.clear();
  } catch (err) {
    log.warn('Storage clear after account deletion:', err);
  }
  try {
    await beforeLeaving?.(extension);
  } catch (err) {
    log.warn('before leaving, after account deletion:', err);
  }
  let signedOut = false;
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    signedOut = !error;
  } catch {
    /* the user is already gone */
  }
  if (!signedOut) location.assign('/');
}

// ---------- The extension ----------

/** True when this page can message an installed Onextap extension. */
export const hasExtension = () => hasExtensionRuntime();

/**
 * Pushes the active profile (the flat `user_profile` shape) to the extension
 * over ONEXTAP_SYNC_DATA, after asking which extension is there
 * (getExtensionInfo, docs/extension-protocol.md). Resolves with
 * `{ state, synced }`:
 *   state   'current', 'legacy' (store 1.0.2: sent anyway, but its popup
 *           reads it only before its first open), 'absent' (not sent), or
 *           null when there was no profile to send;
 *   synced  true only when a current extension confirmed it.
 * The extension's failures never throw: the local save this follows has
 * already happened.
 */
export async function syncToExtension(payload) {
  const profile = payload || await getActiveLegacyProfile();
  if (!profile) return { state: null, synced: false };
  const { state, synced } = await syncProfileToExtension(profile);
  return { state, synced };
}

// ---------- First run ----------

export const tourSeen = {
  get: () => storage.get('onextap_tutorial_seen'),
  set: () => storage.set('onextap_tutorial_seen', true),
};
