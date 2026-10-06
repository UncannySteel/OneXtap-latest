import { overview, plans, workspaces, legacyViews } from './config.js';
import { initCursor } from './cursor.js';
import { initDock } from './dock.js';
import { hydrateIcons, icon } from './icons.js';
import { reducedMotion, riseWords } from './motion.js';
import { initSettings } from './settings.js';
import { toast, transition } from './util.js';
import { h } from './ui/dom.js';
import { installGlobalErrorHandlers } from '@app/logger.js';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const PAYMENT_POLL_MS = 8000;
const PAYMENT_POLL_ATTEMPTS = 15;           // two minutes, as the backend waited for the webhook
const NEW_ACCOUNT_MS = 2 * 60 * 1000;       // the tour is for accounts made in the last two minutes

const $ = (id) => document.getElementById(id);
const app = $('app');
const nav = $('nav');
const workspaceEl = $('workspace');

let user = null;
let services = null;
let renderWorkspace = null;
let clearWorkspace = null;
let subscription = null;
let dock = null;

// ---------- Profile ----------

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || '·';
}

// Premium reports Infinity credits (CLAUDE.md rule 3): never render it as a
// number. null means the balance could not be read.
const creditsLabel = (credits) => {
  if (credits === null || credits === undefined) return '—';
  return Number.isFinite(credits) ? credits.toLocaleString() : 'Unlimited';
};

function renderUser() {
  const values = {
    name: user.name,
    email: user.email,
    credits: creditsLabel(user.credits),
    plan: plans.find((p) => p.id === user.plan)?.name ?? '',
  };
  app.querySelectorAll('[data-bind]').forEach((el) => {
    el.textContent = values[el.dataset.bind] ?? '';
  });
  $('plan-tag').dataset.plan = user.plan;

  const avatar = $('avatar');
  if (user.avatarUrl) {
    const img = new Image();
    img.src = user.avatarUrl;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => { avatar.textContent = initials(user.name); };
    avatar.replaceChildren(img);
  } else {
    avatar.textContent = initials(user.name);
  }
  avatar.setAttribute('aria-label', `${user.name}'s avatar`);
  avatar.setAttribute('role', 'img');

  const first = user.name.split(' ')[0];
  const isNew = user.createdAt && Date.now() - new Date(user.createdAt).getTime() < 24 * 60 * 60 * 1000;
  $('tagline').textContent = isNew
    ? `Welcome, ${first}. Start with your profile — it’s what Onextap fills in for you.`
    : `Welcome back, ${first}. Pick up where you left off.`;
}

/** A change to the user (plan, credits…), shown everywhere it appears. */
function applyChange(change) {
  if (!user || !change) return;
  Object.assign(user, change);
  if (user.plan === 'pro') user.credits = Infinity;
  renderUser();
  subscription?.refresh();
}

// ---------- Navigation + routing (#/<workspace-id>, empty hash = dashboard) ----------

// Each item is numbered like a landing chapter (00 is the overview). Its label
// carries an italic twin for the home cards' hover roll (aria-hidden, so the
// name is read once).
function renderNav() {
  const items = [overview, ...workspaces];
  nav.innerHTML = '<span class="nav-thumb" aria-hidden="true"></span>' + items
    .map((item, n) => {
      const href = item === overview ? '#/' : `#/${item.id}`;
      return `<a class="nav-link" href="${href}" data-id="${item.id}" title="${item.label}"
                 style="view-transition-name: nav-${item.id}; --n: ${n}">
                <span class="nav-num" aria-hidden="true">${String(n).padStart(2, '0')}</span>
                ${icon(item.icon, 20)}<span class="nav-label"><span class="nav-word">${item.label}</span><span class="nav-word nav-word-alt" aria-hidden="true">${item.label}</span></span>
              </a>`;
    })
    .join('');
}

// Slides the dock's citrine thumb to the open workspace. `instant` places it
// without the slide: when the dock has just appeared, or the layout changed.
function moveThumb({ instant = false } = {}) {
  const active = nav.querySelector('.nav-link[aria-current="page"]');
  if (!active || app.dataset.view !== 'workspace') return;
  if (instant) nav.classList.add('is-placing');
  nav.style.setProperty('--thumb-y', `${active.offsetTop}px`);
  nav.style.setProperty('--thumb-h', `${active.offsetHeight}px`);
  if (instant) {
    nav.offsetHeight; // commit the new place before transitions come back
    nav.classList.remove('is-placing');
  }
}

const routeId = () => decodeURIComponent(location.hash.replace(/^#\/?/, ''));
const routeView = () => (workspaces.some((w) => w.id === routeId()) ? 'workspace' : 'home');

function renderRoute() {
  const ws = workspaces.find((w) => w.id === routeId()) ?? null;
  const dockAppears = app.dataset.view !== 'workspace';
  app.dataset.view = ws ? 'workspace' : 'home';

  nav.querySelectorAll('.nav-link').forEach((link) => {
    const active = link.dataset.id === (ws ? ws.id : overview.id);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  if (ws) renderWorkspace(workspaceEl, ws, workspaces.indexOf(ws) + 1, context);
  else clearWorkspace(workspaceEl);
  document.title = ws ? `${ws.label} — Onextap` : 'Dashboard — Onextap';
  dock.refresh();
  moveThumb({ instant: dockAppears });
}

// What a workspace view gets from the shell (js/workspaces.js).
const context = {
  toast,
  getUser: () => user,
  /** A fresh balance from a workspace (a credit spent): the settings pill follows. */
  setCredits(credits) {
    if (!user || credits === null || credits === undefined) return;
    user.credits = credits;
    renderUser();
  },
  getCredits: () => services.getCredits(),
  openSubscription: () => user && subscription.open(),
  syncToExtension: (payload) => services.syncToExtension(payload),
  get hasExtension() { return services.hasExtension(); },
  /** The profile's name stands in for the account's when the account has none. */
  onProfileSaved(profile) {
    if (!user || user.nameFromAccount) return;
    const name = [profile?.firstName, profile?.lastName].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
    if (name && name !== user.name) {
      user.name = name;
      renderUser();
    }
  },
};

// ---------- Settings actions ----------

const deleteDialog = $('delete-dialog');
const deleteConfirm = $('delete-confirm');
const deleteSubmit = $('delete-submit');
const avatarInput = $('avatar-input');

const actions = {
  'change-avatar': () => avatarInput.click(),
  'manage-subscription': () => user && subscription.open(),
  'log-out': async () => {
    toast('Logging out…', 'loading');
    try {
      await services.logOut();
    } catch {
      toast('Couldn’t log out. Try again.', 'error');
    }
  },
  'delete-account': () => {
    deleteConfirm.value = '';
    deleteSubmit.disabled = true;
    deleteDialog.returnValue = '';
    deleteDialog.showModal();
  },
};

avatarInput.addEventListener('change', async () => {
  const file = avatarInput.files[0];
  avatarInput.value = '';
  if (!file || !user) return;
  if (!file.type.startsWith('image/')) return toast('Please choose an image file.', 'error');
  if (file.size > MAX_AVATAR_BYTES) return toast('Images must be 5 MB or smaller.', 'error');
  try {
    user.avatarUrl = await services.updateAvatar(file, user.id);
    renderUser();
    toast('Avatar updated. It’s kept on this device.');
  } catch (error) {
    toast(error?.message || 'Couldn’t update your avatar. Try again.', 'error');
  }
});

deleteConfirm.addEventListener('input', () => {
  deleteSubmit.disabled = deleteConfirm.value.trim() !== 'DELETE';
});

deleteDialog.addEventListener('close', async () => {
  if (deleteDialog.returnValue !== 'confirm') return;
  toast('Deleting your account…', 'loading');
  try {
    await services.deleteAccount();   // goes home when it is done
  } catch (error) {
    toast(error?.message || 'Couldn’t delete your account. Try again.', 'error');
  }
});

// ---------- Arriving with something to do ----------

// Query parameters that only ever mean something on arrival, and go once read.
function takeParams(names) {
  const url = new URL(location.href);
  const out = {};
  for (const name of names) {
    if (url.searchParams.has(name)) {
      out[name] = url.searchParams.get(name);
      url.searchParams.delete(name);
    }
  }
  if (Object.keys(out).length) history.replaceState(history.state, '', url);
  return out;
}

/** The extension popup opens a workspace as ?view=vault|cover|jobs|profiles. */
function applyLegacyView() {
  const { view } = takeParams(['view']);
  const id = view && legacyViews[view];
  if (id && !location.hash.replace(/^#\/?/, '')) {
    history.replaceState(history.state, '', `${location.pathname}${location.search}#/${id}`);
  }
}

/**
 * Back from Dodo's checkout. The webhook that turns Premium on can take a
 * moment, so the account is re-checked every 8s for up to two minutes.
 */
function handlePaymentReturn() {
  const { payment } = takeParams(['payment', 'session_id', 'payment_id', 'status', 'email', 'license_key', 'subscription_id']);
  if (payment === 'cancelled') {
    toast('Payment cancelled.', 'error');
    return;
  }
  if (payment !== 'success') return;
  toast('Payment received! Activating your Premium subscription…', 'loading');
  let attempts = 0;
  const check = async () => {
    attempts += 1;
    const sub = await services.getSubscription();
    if (sub?.plan === 'pro') {
      applyChange(sub);
      toast('Premium activated! You now have unlimited AI credits.');
      return;
    }
    if (attempts >= PAYMENT_POLL_ATTEMPTS) {
      toast('Payment received! Premium may take a moment to activate — refresh shortly.');
      return;
    }
    setTimeout(check, PAYMENT_POLL_MS);
  };
  check();
}

async function maybeStartTour() {
  const seen = await services.tourSeen.get();
  if (seen) return;
  const created = user?.createdAt ? new Date(user.createdAt).getTime() : 0;
  if (!created || Date.now() - created >= NEW_ACCOUNT_MS) {
    // Older accounts never see it; remember that so they never do.
    await services.tourSeen.set();
    return;
  }
  if (routeView() !== 'home') return;
  const { startTour } = await import('./tour.js');
  setTimeout(() => startTour({ onDone: () => services.tourSeen.set() }), reducedMotion.matches ? 0 : 1400);
}

// ---------- Boot ----------

function bootNote({ title, body, action }) {
  app.setAttribute('aria-busy', 'false');
  document.body.append(h('div.boot-note', { role: 'alert' }, h('h2', null, title), body && h('p', null, body), action));
}

async function boot() {
  // A password-reset link belongs to the reset page. Checked before the
  // account's modules load: Supabase's client would otherwise take the link
  // as an ordinary sign-in, and the new password would never be asked for.
  if (/[#&]type=recovery/.test(location.hash)) {
    location.replace(`/reset-password/${location.search}${location.hash}`);
    return;
  }

  hydrateIcons();
  renderNav();

  dock = initDock({
    app,
    dock: $('dock'),
    handle: $('dock-bar'),
    resizer: $('dock-resize'),
    hints: [...document.querySelectorAll('.snap-hint')],
  });

  initSettings({
    root: $('settings'),
    trigger: $('settings-trigger'),
    menu: $('settings-menu'),
    onAction: (name) => actions[name]?.(),
  });

  initCursor(app);

  // The account's modules load here rather than at the top: a build missing
  // its Supabase settings then says so, instead of leaving a blank page.
  try {
    let subscriptionModule;
    let workspacesModule;
    [services, workspacesModule, subscriptionModule] = await Promise.all([
      import('./services.js'),
      import('./workspaces.js'),
      import('./subscription.js'),
    ]);
    ({ renderWorkspace, clearWorkspace } = workspacesModule);
    subscription = subscriptionModule.initSubscription({
      dialog: $('subscription-dialog'),
      getUser: () => user,
      onChange: applyChange,
    });
  } catch (error) {
    bootNote({
      title: 'The dashboard couldn’t start.',
      body: 'Its connection to the account service is not set up. If you run this site, check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env, then rebuild.',
    });
    throw error;
  }

  // Signed in? If not, off to sign in, and back here afterwards.
  const session = await services.getSession();
  if (!session) {
    await services.sendToSignIn();
    return;
  }
  services.onSignedOut(() => location.assign('/'));

  applyLegacyView();
  const arrival = takeParams(['upgrade']);

  renderRoute();
  // The kind of move tells the CSS how to deal the workspace sheet.
  addEventListener('hashchange', () => {
    const from = app.dataset.view;
    const to = routeView();
    const kind = from === 'home' ? (to === 'workspace' ? 'enter' : '') : to === 'workspace' ? 'swap' : 'leave';
    transition(renderRoute, kind);
  });
  addEventListener('resize', () => moveThumb({ instant: true }));
  document.fonts?.ready.then(() => moveThumb({ instant: true }));

  try {
    user = await services.getCurrentUser(session);
  } catch (error) {
    if (/not authenticated|invalid|expired|jwt|401/i.test(error?.message || '')) {
      await services.sendToSignIn();
      return;
    }
    // The server could not be reached: show what the session knows, and say so.
    const meta = session.user?.user_metadata || {};
    user = {
      id: session.user.id,
      name: meta.full_name || meta.name || String(session.user.email || '').split('@')[0] || 'You',
      email: session.user.email || '',
      plan: 'standard',
      credits: null,
      renewsOn: null,
      cancelAtPeriodEnd: false,
      avatarUrl: meta.avatar_url || meta.picture || null,
      createdAt: session.user.created_at || null,
      nameFromAccount: !!(meta.full_name || meta.name),
    };
    toast(`Couldn’t load your account: ${error?.message || 'the server did not answer'}. Credits and plan may be out of date.`, 'error');
  }
  renderUser();
  app.removeAttribute('aria-busy');

  // The entrance, once: the name rises word by word, the rest follows on a stagger.
  if (!reducedMotion.matches && app.dataset.view === 'home') {
    app.classList.add('is-entering');
    riseWords(app.querySelector('.user-name'), { delay: 150, restore: true });
    setTimeout(() => app.classList.remove('is-entering'), 1800);
  }

  handlePaymentReturn();
  if (arrival.upgrade) subscription.open();

  // Premium re-checked against Dodo, with its dates, once per visit and
  // without holding anything up. A Premium that has lapsed since the account
  // was read comes back to a real balance.
  services.getSubscription().then(async (sub) => {
    if (!sub) return;
    if (sub.plan === 'pro') {
      applyChange(sub);
    } else if (user.plan === 'pro') {
      const credits = await services.getCredits();
      applyChange({ ...sub, credits: credits ?? 0 });
    }
  });

  // Arriving to upgrade, the plan panel comes first; the tour waits for it.
  const panel = $('subscription-dialog');
  if (panel.open) panel.addEventListener('close', maybeStartTour, { once: true });
  else maybeStartTour();
}

// Uncaught errors and rejections go through the logger (redacted, kept for
// __onextapIssues() in the console), as they do in the popup.
installGlobalErrorHandlers();
boot();
