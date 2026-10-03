import { h, ico, fill } from '../ui/dom.js';
import { section, field, input, textarea, button, iconButton, setBusy, note, tag, emptyState, skeleton } from '../ui/controls.js';
import { fabricationNotice } from '../ui/fabrication.js';
import { profileSwitcher } from '../ui/switchers.js';
import { loadProfileStore, updateActiveProfileData, MAX_COVER_LETTERS_PER_PROFILE } from '@app/profileStore.js';
import { getAccessToken } from '@app/auth.js';
import { getApplicationTypeConfig } from '@app/applicationTypes.js';
import { ANSWER_STUDIO_MODEL, API_URL } from '@app/config.js';
import { ANSWER_STYLE_INSTRUCTIONS, CREDIT_API_TIMEOUT_MS, withTimeout } from '@app/answerStudio.js';
import { creditManager } from '@app/creditManager.js';
import { applicationKey, consumesCredit, allowanceAfter } from '@app/coverLetterCredits.js';
import { loadFabricationCorpus } from '@app/fabricationCorpus.js';
import { log as baseLog } from '@app/logger.js';

const log = baseLog.child('ui');

// Cover Letter — the backend's CoverLetterPanel, for the web: templates for
// the active profile (up to MAX_COVER_LETTERS_PER_PROFILE), personalised per
// application through POST /api/answer-vault/generate, and the versions worth
// keeping saved against their template.
//
// What the popup does that this does not: read the job page it is opened on,
// and fill the letter into it. Both need the extension's tab APIs, which a
// web page does not get — so here the target application is typed or pasted,
// and the finished letter is copied (or saved, and filled from the popup).
//
// Personalising costs what @app/coverLetterCredits.js says: one credit buys a
// personalisation and one free re-run of it (same template, same job
// description); Premium is unlimited. As in Answer Studio, the credit is
// checked before the call and deducted through the server after a successful
// one, and the re-run allowance is kept on the template.

const APP_TYPE = 'job';
const NAME_MAX = 32;
const SAVE_DEBOUNCE_MS = 500;

const normalize = (templates = []) => templates.map((t) => ({ ...t, variants: Array.isArray(t.variants) ? t.variants : [] }));
const excerpt = (text, n) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function mount(body, ctx) {
  const appConfig = getApplicationTypeConfig(APP_TYPE);
  const LABEL = appConfig.coverLetterLabel;           // "Cover Letter"
  const noun = LABEL.toLowerCase();

  let alive = true;
  let letters = [];
  let activeId = null;
  let expandedId = null;
  let adding = false;
  let generating = false;
  let suggestion = '';
  let original = '';
  let errorText = '';
  let flags = [];
  let lastContext = { company: '', description: '' };
  let saveTimer = null;
  // The account's balance, as Answer Studio keeps it: null until loaded or
  // when it could not be; Infinity on Premium.
  let premium = false;
  let credits = null;

  // ---------- persistence ----------
  async function persist(templates) {
    letters = normalize(templates);
    await updateActiveProfileData({ coverLetters: letters });
    await ctx.syncToExtension();
  }

  /**
   * Debounced writes of template fields, read-modify-write against the store.
   * Edits made within the debounce are merged (a rename and a body edit in
   * the same half-second both land), and leaving the workspace flushes them.
   */
  let pending = {};
  function saveFieldSoon(templateId, patch) {
    pending[templateId] = { ...pending[templateId], ...patch };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSaves, SAVE_DEBOUNCE_MS);
  }
  async function flushSaves() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const patches = pending;
    pending = {};
    if (!Object.keys(patches).length) return;
    const store = await loadProfileStore();
    const current = normalize(store.profiles[store.activeProfileId]?.coverLetters || []);
    await persist(current.map((t) => (patches[t.id] ? { ...t, ...patches[t.id] } : t)));
    if (alive) renderTemplates();
  }

  async function load() {
    const store = await loadProfileStore();
    if (!alive) return;
    letters = normalize(store.profiles[store.activeProfileId]?.coverLetters || []);
    activeId = letters[0]?.id || null;
    original = letters[0]?.body || '';
    expandedId = null;
    suggestion = '';
    flags = [];
    errorText = '';
    renderAll();
  }

  async function loadCredits() {
    const res = await creditManager.getCreditsWithStatus();
    if (!alive) return;
    premium = res.isPremium;
    if (!res.error) {
      credits = premium ? Infinity : (res.credits ?? 0);
      ctx.setCredits(credits);
    }
    refreshPersonalize();
  }

  /** What personalising the selected template for the pasted description will cost, in words. */
  function costNote(template) {
    if (premium || !template || !descIn.value.trim()) return '';
    if (!consumesCredit({ premium, template, key: applicationKey(descIn.value) })) return 'This one is a free re-run.';
    if (credits === 0) return 'No credits left: Premium makes cover letters unlimited.';
    return 'Uses 1 credit, which includes one free re-run.';
  }

  // ---------- the target application ----------
  const companyIn = input({ placeholder: 'Company or organisation' });
  const roleIn = input({ placeholder: 'Role' });
  const descIn = textarea({ rows: 7, placeholder: 'Paste the job description — the letter is rewritten around what it asks for.' });
  const personalizeBtn = button(`Personalise for this ${appConfig.shortLabel.toLowerCase()}`, { kind: 'citrine', icon: 'spark', onClick: personalize });
  [companyIn, roleIn, descIn].forEach((el) => el.addEventListener('input', () => { if (errorText) { errorText = ''; renderResult(); } refreshPersonalize(); }));

  // ---------- layout ----------
  const templatesEl = h('div');
  const resultEl = h('div');
  // Edits still waiting on the debounce belong to the profile being left.
  const switcher = profileSwitcher({ beforeChange: flushSaves, onChange: () => load() });

  fill(body,
    h('div.ws-toolbar', null, switcher.el,
      h('p.ws-toolbar-note', null, `Templates belong to the selected profile. Save a version here and the extension can fill it on the application page.`)),
    templatesEl,
    section({ num: 2, label: 'Tailor', title: 'Aim it at one application', desc: 'Name the company and role and paste the description. Your template is rewritten for it, in your own voice.' },
      h('div.card', null,
        h('div.fgrid', null,
          field({ label: 'Company', span: 3, control: companyIn }),
          field({ label: 'Role', span: 3, control: roleIn }),
          field({ label: 'Job description', span: 6, control: descIn })),
        h('div.editor-actions', null, personalizeBtn, h('span.meta-note', { id: 'cl-hint' })))),
    resultEl);

  function activeTemplate() {
    return letters.find((t) => t.id === activeId) || null;
  }

  function refreshPersonalize() {
    const template = activeTemplate();
    const hint = body.querySelector('#cl-hint');
    let why = '';
    if (!letters.length) why = `Add a ${noun} template first.`;
    else if (!template?.body?.trim()) why = `The selected template is empty.`;
    else if (!descIn.value.trim()) why = 'Paste the job description to personalise.';
    else why = template ? [`Using “${template.name}”.`, costNote(template)].filter(Boolean).join(' ') : '';
    if (hint) hint.textContent = why;
    if (!generating) personalizeBtn.disabled = !(template?.body?.trim() && descIn.value.trim());
  }

  // ---------- templates ----------
  function renderTemplates() {
    const full = letters.length >= MAX_COVER_LETTERS_PER_PROFILE;
    const fileInput = h('input', { type: 'file', accept: '.txt,.text,.md', hidden: true, onchange: onFile });
    const addBar = h('div.add-bar', null,
      !full && h('button.add-row', { type: 'button', onclick: () => fileInput.click() }, ico('upload', 14), 'Upload a file'),
      !full && !adding && h('button.add-row', { type: 'button', onclick: () => { adding = true; renderTemplates(); } }, ico('plus', 14), 'Add a template'),
      full && h('p.muted', null, `That’s the limit of ${MAX_COVER_LETTERS_PER_PROFILE} templates for this profile.`),
      fileInput);

    const nameIn = input({ placeholder: 'Template name (e.g. Formal)', maxLength: NAME_MAX });
    const addForm = adding && h('div.card.add-form', null,
      field({ label: 'New template', control: nameIn }),
      h('div.editor-actions', null,
        button('Create', { kind: 'solid', size: 'sm', onClick: () => addTemplate(nameIn.value) }),
        button('Cancel', { kind: 'ghost', size: 'sm', onClick: () => { adding = false; renderTemplates(); } })));
    if (adding) requestAnimationFrame(() => nameIn.focus());
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTemplate(nameIn.value); } });

    const list = letters.length
      ? h('div.tpl-list', null, letters.map(templateCard))
      : !adding && emptyState({
        iconName: 'file',
        title: `No ${noun}s yet`,
        body: `Upload one (.txt or .md) or paste it in. It becomes the base every tailored version starts from.`,
      });

    fill(templatesEl, section({ num: 1, label: 'Templates', title: `Your ${noun}s`, desc: `The letters you actually send, kept as templates — ${letters.length} of ${MAX_COVER_LETTERS_PER_PROFILE}.` },
      list, addForm, addBar));
    refreshPersonalize();
  }

  function templateCard(t) {
    const open = expandedId === t.id;
    const selected = activeId === t.id;
    const variants = t.variants || [];
    const head = h('button.tpl-head', {
      type: 'button',
      'aria-expanded': String(open),
      onclick: () => {
        expandedId = open ? null : t.id;
        if (activeId !== t.id) {
          activeId = t.id;
          original = t.body || '';
          suggestion = '';
          flags = [];
          renderResult();
        }
        renderTemplates();
      },
    },
    h('span.tpl-radio', { 'aria-hidden': 'true' }),
    h('span.tpl-text', null,
      h('span.tpl-name', null, t.name),
      h('span.tpl-excerpt', null, excerpt(t.body, 90) || 'Empty — open it to write or paste the letter.')),
    variants.length > 0 && tag(`${variants.length} saved`, 'olive'),
    ico('chevron', 16));

    const bodyIn = textarea({ rows: 10, value: t.id === activeId ? original : (t.body || ''), placeholder: `Paste your base ${noun}…` });
    bodyIn.addEventListener('input', () => {
      if (t.id === activeId) original = bodyIn.value;
      t.body = bodyIn.value;
      saveFieldSoon(t.id, { body: bodyIn.value });
      refreshPersonalize();
    });
    const nameIn = input({ value: t.name, maxLength: NAME_MAX, 'aria-label': 'Template name' });
    nameIn.addEventListener('input', () => {
      t.name = nameIn.value.slice(0, NAME_MAX);
      saveFieldSoon(t.id, { name: t.name });
    });

    return h('article.tpl', { class: [open && 'is-open', selected && 'is-selected'].filter(Boolean).join(' ') },
      h('div.tpl-bar', null, head,
        iconButton('trash', { label: `Delete ${t.name}`, danger: true, onClick: () => deleteTemplate(t.id) })),
      open && h('div.tpl-body', null,
        h('div.fgrid', null,
          field({ label: 'Name', span: 6, control: nameIn }),
          field({ label: 'Letter', span: 6, control: bodyIn })),
        variants.length > 0 && h('div.variants', null,
          h('p.label', null, 'Saved for specific applications'),
          variants.map((v) => h('div.variant', null,
            h('div.variant-text', null,
              h('p.variant-name', null, [v.company, v.role].filter(Boolean).join(' · ') || 'Custom version'),
              h('p.variant-sub', null, `${v.createdAt ? `${dateFormat.format(new Date(v.createdAt))} · ` : ''}${excerpt(v.body, 80)}`)),
            h('div.variant-acts', null,
              button('Open', { kind: 'ghost', size: 'sm', onClick: () => { activeId = t.id; original = t.body || ''; suggestion = v.body; flags = []; renderResult(true); } }),
              iconButton('trash', { label: 'Delete this version', danger: true, onClick: () => deleteVariant(t.id, v.id) })))))));
  }

  async function addTemplate(name) {
    if (letters.length >= MAX_COVER_LETTERS_PER_PROFILE) {
      ctx.toast(`Maximum ${MAX_COVER_LETTERS_PER_PROFILE} templates per profile.`, 'error');
      return;
    }
    const template = {
      id: `cl-${Date.now()}`,
      name: (name || `Template ${letters.length + 1}`).trim().slice(0, NAME_MAX) || `Template ${letters.length + 1}`,
      body: '',
      createdAt: new Date().toISOString(),
      applicationType: APP_TYPE,
      variants: [],
    };
    await persist([...letters, template]);
    activeId = template.id;
    expandedId = template.id;
    original = '';
    adding = false;
    renderTemplates();
    templatesEl.querySelector('.tpl.is-open textarea')?.focus();
    ctx.toast('Template added.');
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      if (!text.trim()) { ctx.toast('That file is empty.', 'error'); return; }
      if (letters.length >= MAX_COVER_LETTERS_PER_PROFILE) {
        ctx.toast(`Maximum ${MAX_COVER_LETTERS_PER_PROFILE} templates per profile.`, 'error');
        return;
      }
      const template = {
        id: `cl-${Date.now()}`,
        name: file.name.replace(/\.[^.]+$/, '').slice(0, NAME_MAX) || `Template ${letters.length + 1}`,
        body: text.trim(),
        createdAt: new Date().toISOString(),
        applicationType: APP_TYPE,
        variants: [],
      };
      await persist([...letters, template]);
      activeId = template.id;
      expandedId = template.id;
      original = template.body;
      renderTemplates();
      ctx.toast(`${LABEL} uploaded.`);
    } catch {
      ctx.toast('Couldn’t read that file — try a .txt file.', 'error');
    }
  }

  async function deleteTemplate(id) {
    const next = letters.filter((t) => t.id !== id);
    await persist(next);
    if (activeId === id) {
      activeId = next[0]?.id || null;
      original = next[0]?.body || '';
      suggestion = '';
      flags = [];
      renderResult();
    }
    if (expandedId === id) expandedId = null;
    renderTemplates();
    ctx.toast('Template removed.');
  }

  async function deleteVariant(templateId, variantId) {
    await persist(letters.map((t) => (t.id === templateId ? { ...t, variants: (t.variants || []).filter((v) => v.id !== variantId) } : t)));
    renderTemplates();
    ctx.toast('Saved version removed.');
  }

  // ---------- personalising ----------
  async function personalize() {
    const template = activeTemplate();
    if (!template?.body?.trim()) {
      errorText = `Add a ${noun} template first.`;
      renderResult();
      return;
    }
    const description = descIn.value.trim();
    if (!description) {
      errorText = 'Paste the job description below the role.';
      renderResult();
      return;
    }

    const key = applicationKey(description);
    let latest = credits;
    if (!premium && latest === null) {
      const res = await creditManager.getCreditsWithStatus();
      if (!res.error && Number.isFinite(res.credits)) {
        latest = res.credits;
        credits = res.credits;
      }
    }
    const charged = consumesCredit({ premium, template, key });
    if (charged && Number(latest || 0) <= 0) {
      errorText = 'No credits remaining. Premium makes cover letters unlimited.';
      renderResult();
      ctx.toast('No credits remaining. Upgrade to continue.', 'error');
      return;
    }

    generating = true;
    errorText = '';
    suggestion = '';
    flags = [];
    original = template.body;
    setBusy(personalizeBtn, true, 'Personalising…');
    renderResult(true);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Please sign in first.');
      const companyName = companyIn.value.trim();
      const role = roleIn.value.trim();
      const roleLine = role ? `Role: ${role}\n\n` : '';
      const taskHint = 'Rewrite the cover letter template for this specific opportunity. Preserve the candidate\'s writing style and voice — do not make it generic. Reference the company and role by name. Weave in 2-4 key requirements from the description. Keep length within ±10% of the original. First person. No headings or bullet points.';
      const corpus = await loadFabricationCorpus();

      const res = await fetch(`${API_URL}/api/answer-vault/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          question: `${LABEL} for this application`,
          draft: template.body,
          jobContext: `${companyName ? `Organization: ${companyName}\n` : ''}${roleLine}${description.substring(0, 6000)}`,
          taskHint,
          styleHint: ANSWER_STYLE_INSTRUCTIONS.balanced,
          model: ANSWER_STUDIO_MODEL,
          ...(corpus.length ? { corpus } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Generation failed (${res.status})`);
      if (!alive) return;

      const text = String(data?.text || '').trim();
      if (!text) throw new Error('The AI returned nothing. Try again.');
      suggestion = text;
      flags = Array.isArray(data?.fabricationFlags) ? data.fabricationFlags : [];
      lastContext = { company: companyName, description };

      let deducted = false;
      if (charged) {
        try {
          const deduct = await withTimeout(creditManager.deductCredit(), CREDIT_API_TIMEOUT_MS, 'Credit update timed out after generation.');
          if (!deduct.success) {
            errorText = deduct.error || 'Letter written, but your credits could not be updated.';
          } else {
            deducted = true;
            credits = deduct.isPremium ? Infinity : deduct.remaining;
            ctx.setCredits(credits);
          }
        } catch (creditErr) {
          log.warn('Credit deduction failed after generation:', creditErr);
          errorText = 'Letter written, but the credit update failed. Refresh to see your balance.';
        }
      }
      const allowance = allowanceAfter({ premium, charged, deducted, template, key });
      await persist(letters.map((t) => (t.id === template.id ? { ...t, lastUsed: new Date().toISOString(), ...allowance } : t)));
      ctx.toast(charged || premium ? `${LABEL} personalised.` : `${LABEL} personalised, on its free re-run.`);
    } catch (e) {
      if (!alive) return;
      errorText = e?.message || 'The AI couldn’t write this one.';
      ctx.toast(errorText, 'error');
    } finally {
      generating = false;
      if (alive) {
        setBusy(personalizeBtn, false);
        renderResult();
        refreshPersonalize();
      }
    }
  }

  async function saveVersion() {
    if (!suggestion.trim() || !activeId) return;
    const variant = {
      id: `clv-${Date.now()}`,
      company: companyIn.value.trim() || lastContext.company || '',
      role: roleIn.value.trim(),
      jdSnippet: (lastContext.description || descIn.value || '').slice(0, 500),
      body: suggestion.trim(),
      createdAt: new Date().toISOString(),
    };
    await persist(letters.map((t) => (t.id === activeId ? { ...t, variants: [variant, ...(t.variants || [])] } : t)));
    renderTemplates();
    ctx.toast('Version saved with its template.');
  }

  async function copySuggestion() {
    try {
      await navigator.clipboard.writeText(suggestion);
      ctx.toast('Copied to the clipboard.');
    } catch {
      ctx.toast('Couldn’t copy — select the text and copy it instead.', 'error');
    }
  }

  // ---------- the result ----------
  function renderResult(scrollTo = false) {
    const showing = generating || suggestion || errorText;
    if (!showing) {
      fill(resultEl);
      return;
    }
    const originalIn = textarea({ rows: 14, value: original, 'aria-label': 'Original' });
    originalIn.addEventListener('input', () => {
      original = originalIn.value;
      if (activeId) saveFieldSoon(activeId, { body: original });
    });
    const suggestionIn = textarea({ rows: 14, value: suggestion, 'aria-label': 'Personalised version' });
    suggestionIn.addEventListener('input', () => { suggestion = suggestionIn.value; });

    fill(resultEl, section({ num: 3, label: 'Result', title: 'Your tailored letter', desc: 'Edit either side. Changes to the original are saved to the template.' },
      (suggestion || generating) && h('div.compare', null,
        h('div.compare-col', null,
          h('p.label', null, 'Original'),
          originalIn),
        h('div.compare-col', null,
          h('p.label', null, 'Personalised'),
          generating ? h('div.compare-wait', null, skeleton(6, ['92%', '100%', '86%', '97%', '74%', '40%'])) : suggestionIn,
          !generating && suggestion && h('div.editor-actions', null,
            button('Save version', { kind: 'solid', size: 'sm', icon: 'save', onClick: saveVersion }),
            button('Copy', { kind: 'ghost', size: 'sm', icon: 'copy', onClick: copySuggestion })))),
      !generating && fabricationNotice(flags),
      errorText && note('clay', h('p', null, errorText),
        h('button.link-btn', { type: 'button', onclick: personalize }, 'Try again'))));
    if (scrollTo) resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderAll() {
    renderTemplates();
    renderResult();
  }

  fill(templatesEl, section({ num: 1, label: 'Templates', title: `Your ${noun}s` }, skeleton(2)));
  load();
  loadCredits();

  return {
    unmount() {
      alive = false;
      flushSaves();
      switcher.destroy();
    },
  };
}
