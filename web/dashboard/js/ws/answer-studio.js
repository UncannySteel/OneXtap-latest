import { h, ico, fill } from '../ui/dom.js';
import { section, field, input, select, textarea, button, iconButton, setBusy, note, tag, emptyState } from '../ui/controls.js';
import { fabricationNotice } from '../ui/fabrication.js';
import { profileSwitcher } from '../ui/switchers.js';
import {
  AI_TIMEOUT_SEC, ANSWER_STYLE_INSTRUCTIONS, ANSWER_STYLE_OPTIONS, CREDIT_API_TIMEOUT_MS, withTimeout,
} from '@app/answerStudio.js';
import { getAccessToken } from '@app/auth.js';
import { ANSWER_STUDIO_MODEL, API_URL } from '@app/config.js';
import { creditManager } from '@app/creditManager.js';
import { DEFAULT_PROFILE } from '@app/profileDefaults.js';
import { getActiveLegacyProfile, loadProfileStore, saveLegacyUserProfile } from '@app/profileStore.js';
import { loadFabricationCorpus } from '@app/fabricationCorpus.js';
import { log as baseLog } from '@app/logger.js';

const log = baseLog.child('ui');

// Answer Studio — save reusable application answers and improve them with AI,
// as the backend's VaultPage had it. Generation is POST
// /api/answer-vault/generate (Groq), with the same prompt, tone presets and
// fabrication check (the active resume's corpus goes along when there is one).
//
// Credit rule, unchanged: one credit buys the FIRST generation for an answer
// and three follow-up improvements to it, which are free and are kept with the
// saved answer. Premium never deducts. Credits come off only after a
// successful generation, so a failed call costs nothing.
//
// Job context: the pasted description (and company). The popup additionally
// reads the job page it is opened on; the dashboard does not try to, because
// from here "the active tab" is the dashboard itself — its own text is not a
// job description, and sending it as one would tailor the answer to nothing.

const normalizeVault = (items = []) => (Array.isArray(items) ? items : []).map((item) => ({
  ...item,
  aiImprovementsLeft: Number.isFinite(Number(item?.aiImprovementsLeft)) ? Math.max(0, Number(item.aiImprovementsLeft)) : 0,
}));

export function mount(body, ctx) {
  let alive = true;
  let profile = { ...DEFAULT_PROFILE, vault: normalizeVault(DEFAULT_PROFILE.vault) };
  let activeId = null;
  let generatedOnce = false;
  let improvementsLeft = 0;
  let generating = false;
  let credits = null;       // number, Infinity (premium), or null (not read)
  let creditsError = '';
  let premium = false;
  let flags = [];

  // ---------- the editor ----------
  const question = input({ placeholder: 'e.g. Why do you want to work here?' });
  const company = input({ placeholder: 'Optional — the company you are applying to' });
  const jd = textarea({ rows: 5, placeholder: 'Optional — paste the job description to tailor the answer to the role' });
  const tone = select(ANSWER_STYLE_OPTIONS.map((o) => ({ value: o.value, label: o.label })), { value: 'balanced' });
  const answer = textarea({ rows: 8, placeholder: 'Optional — your own draft. Generate writes one; Improve rewrites what is here.' });

  const saveBtn = button('Save answer', { kind: 'solid', icon: 'save', onClick: saveToVault });
  const aiBtn = button('Generate answer', { kind: 'citrine', icon: 'spark', onClick: improve });
  const cancelEdit = button('New answer', { kind: 'ghost', size: 'sm', icon: 'plus', onClick: () => resetEditor() });
  const meta = h('div.editor-meta');
  const messages = h('div.editor-messages');
  const editingLabel = h('p.label.editor-editing');

  const editor = h('div.card.editor', null,
    editingLabel,
    h('div.fgrid', null,
      field({ label: 'Question', span: 6, control: question }),
      field({ label: 'Company', span: 3, control: company }),
      field({ label: 'Tone', span: 3, control: tone }),
      field({ label: 'Job description', span: 6, control: jd }),
      field({ label: 'Your answer', span: 6, control: answer })),
    h('div.editor-actions', null, saveBtn, aiBtn, cancelEdit, meta),
    messages);

  const savedList = h('div.saved');
  const savedSec = h('div');

  const switcher = profileSwitcher({ onChange: () => load() });

  fill(body,
    h('div.ws-toolbar', null, switcher.el,
      h('p.ws-toolbar-note', null, 'Saved answers belong to the selected profile, and the extension fills from them.')),
    section({ num: 1, label: 'Write', title: 'Answer a question', desc: 'Type the question, paste the job description if you have it, and let the AI draft or sharpen your answer.' }, editor),
    savedSec);

  // Typing a new question starts a new answer, unless one is being edited.
  question.addEventListener('input', () => {
    clearError();
    if (!activeId) {
      generatedOnce = false;
      improvementsLeft = 0;
    }
    refreshControls();
  });
  answer.addEventListener('input', refreshControls);
  [company, jd, tone].forEach((el) => el.addEventListener('input', clearError));

  let errorText = '';
  function clearError() {
    if (!errorText) return;
    errorText = '';
    renderMessages();
  }

  // ---------- rendering ----------
  function refreshControls() {
    const q = question.value.trim();
    const a = answer.value.trim();
    saveBtn.disabled = !q || !a;
    if (!generating) {
      aiBtn.disabled = !q;
      aiBtn.querySelector('.btn-label').textContent = !a ? 'Generate answer' : generatedOnce ? 'Improve answer' : 'Generate answer';
    }
    cancelEdit.hidden = !activeId && !q && !a;
    editingLabel.textContent = activeId ? 'Editing a saved answer' : 'New answer';
    fill(meta,
      credits === null
        ? null
        : premium
          ? tag('Premium · unlimited', 'ink')
          : h('span.credit-pill', { class: credits === 0 ? 'is-empty' : '' }, ico('coins', 13), `${credits} credit${credits === 1 ? '' : 's'} left`),
      !premium && credits !== null && h('span.meta-note', null, `Free improvements on this answer: ${improvementsLeft}`));
  }

  function renderMessages() {
    fill(messages,
      !premium && h('p.editor-rule', null,
        '1 credit writes an answer and includes 3 free improvements to it. Improvements left are kept with each saved answer.'),
      creditsError && note('amber',
        h('p', null, `Couldn’t load your credits: ${creditsError}`),
        h('button.link-btn', { type: 'button', onclick: loadCredits }, 'Try again')),
      errorText && note('clay',
        h('p', null, errorText),
        /no credits/i.test(errorText) && h('button.link-btn', { type: 'button', onclick: () => ctx.openSubscription() }, 'See Premium')),
      !generating && fabricationNotice(flags));
  }

  function renderSaved() {
    const vault = profile.vault || [];
    fill(savedSec, section({ num: 2, label: 'Saved', title: `Saved answers${vault.length ? ` (${vault.length})` : ''}` },
      vault.length
        ? h('div.saved', null, vault.map((item) => h('article.saved-item', { class: item.id === activeId ? 'is-active' : '' },
          h('h4.saved-q', null, item.question),
          h('p.saved-a', null, item.answer),
          h('div.saved-foot', null,
            !premium && h('span.meta-note', null, `Free improvements left: ${Math.max(0, Number(item.aiImprovementsLeft || 0))}`),
            h('div.saved-acts', null,
              button('Use in editor', { kind: 'ghost', size: 'sm', icon: 'edit', onClick: () => loadIntoEditor(item) }),
              iconButton('trash', { label: 'Delete this answer', danger: true, onClick: () => removeItem(item.id) }))))))
        : emptyState({ iconName: 'pen', title: 'No saved answers yet', body: 'Write or generate an answer above, then save it. The extension fills application questions from these.' })));
  }

  function resetEditor() {
    activeId = null;
    question.value = '';
    answer.value = '';
    generatedOnce = false;
    improvementsLeft = 0;
    flags = [];
    errorText = '';
    refreshControls();
    renderMessages();
    renderSaved();
  }

  function loadIntoEditor(item) {
    activeId = item.id;
    question.value = String(item.question || '');
    answer.value = String(item.answer || '');
    improvementsLeft = premium ? 0 : Math.max(0, Number(item.aiImprovementsLeft || 0));
    generatedOnce = true;
    errorText = '';
    flags = [];
    refreshControls();
    renderMessages();
    renderSaved();
    question.focus();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- data ----------
  async function loadCredits() {
    creditsError = '';
    const res = await creditManager.getCreditsWithStatus();
    if (!alive) return;
    premium = res.isPremium;
    if (res.error) {
      creditsError = res.error;
      credits = null;
    } else {
      credits = premium ? Infinity : (res.credits ?? 0);
      ctx.setCredits(credits);
    }
    refreshControls();
    renderMessages();
    renderSaved();
  }

  async function load() {
    await loadProfileStore();
    const saved = await getActiveLegacyProfile();
    if (!alive) return;
    profile = saved
      ? { ...DEFAULT_PROFILE, ...saved, vault: normalizeVault(saved.vault ?? DEFAULT_PROFILE.vault) }
      : { ...DEFAULT_PROFILE, vault: normalizeVault(DEFAULT_PROFILE.vault) };
    resetEditor();
  }

  async function persist(nextProfile) {
    profile = nextProfile;
    await saveLegacyUserProfile(profile);
    await ctx.syncToExtension(profile);
  }

  async function saveToVault() {
    const q = question.value.trim();
    const a = answer.value.trim();
    if (!q || !a) return;
    const vault = profile.vault || [];
    if (activeId) {
      const next = vault.map((item) => (item.id === activeId
        ? { ...item, question: q, answer: a, aiImprovementsLeft: premium ? 0 : improvementsLeft }
        : item));
      await persist({ ...profile, vault: normalizeVault(next) });
      ctx.toast('Changes saved.');
    } else {
      const duplicate = vault.some((item) => (item.question || '').trim().toLowerCase() === q.toLowerCase()
        || (item.answer || '').trim().toLowerCase() === a.toLowerCase());
      if (duplicate) {
        ctx.toast('That answer is already saved.', 'error');
        return;
      }
      await persist({ ...profile, vault: normalizeVault([...vault, { id: Date.now(), question: q, answer: a, aiImprovementsLeft: premium ? 0 : improvementsLeft }]) });
      ctx.toast('Answer saved.');
    }
    resetEditor();
  }

  async function removeItem(id) {
    await persist({ ...profile, vault: normalizeVault((profile.vault || []).filter((i) => i.id !== id)) });
    if (activeId === id) resetEditor();
    else renderSaved();
    ctx.toast('Answer deleted.');
  }

  /** The improvement balance and the answer, written back to the saved answer being edited. */
  async function persistActive(nextAnswer, nextImprovements) {
    if (!activeId) return;
    const next = (profile.vault || []).map((item) => (item.id === activeId
      ? { ...item, answer: nextAnswer, aiImprovementsLeft: premium ? 0 : Math.max(0, Number(nextImprovements || 0)) }
      : item));
    await persist({ ...profile, vault: normalizeVault(next) });
    renderSaved();
  }

  function profileContext() {
    const skills = (profile.skills || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8).join(', ');
    const role = [profile.currentJob?.title, profile.currentJob?.company].map((v) => String(v || '').trim()).filter(Boolean).join(' at ');
    const recent = (profile.experience || [])
      .filter((ex) => ex?.title || ex?.company)
      .slice(0, 2)
      .map((ex) => [String(ex?.title || '').trim(), String(ex?.company || '').trim()].filter(Boolean).join(' at '))
      .filter(Boolean)
      .join(' | ');
    return [
      role ? `Current role: ${role}` : '',
      skills ? `Core skills: ${skills}` : '',
      recent ? `Recent experience: ${recent}` : '',
    ].filter(Boolean).join('\n');
  }

  async function improve() {
    const q = question.value.trim();
    if (!q) {
      errorText = 'Enter a question first.';
      renderMessages();
      return;
    }

    let latest = credits;
    if (!premium && latest === null) {
      const res = await creditManager.getCreditsWithStatus();
      if (!res.error && Number.isFinite(res.credits)) {
        latest = res.credits;
        credits = res.credits;
      }
    }
    const consumesCredit = !premium && improvementsLeft <= 0;
    if (consumesCredit && Number(latest || 0) <= 0) {
      errorText = 'No credits remaining. Premium makes answers unlimited.';
      renderMessages();
      ctx.toast('No credits remaining. Upgrade to continue.', 'error');
      return;
    }

    generating = true;
    errorText = '';
    flags = [];
    const draft = answer.value.trim();
    setBusy(aiBtn, true, draft ? 'Improving…' : 'Writing…');
    renderMessages();
    ctx.toast('The AI is writing…', 'loading');

    try {
      const pasted = jd.value.trim();
      const hasJobContext = !!pasted;
      const jdSnippet = hasJobContext ? pasted.substring(0, 6000) : '';
      const companyName = (company.value.trim() || 'Not specified').trim();
      const hasGeneric = draft.length > 0;

      const lengthRule = 'Target length: 170-240 words unless the question clearly needs less.';
      const impactRule = 'Include at least one measurable or observable impact/result. Prefer numbers/percentages/timeframes when truthful; never invent facts.';
      let taskHint;
      if (hasGeneric) {
        taskHint = hasJobContext
          ? `Rewrite the candidate draft to target the job description and company. Answer the application question directly. Tone: human, natural, confident. ${lengthRule} First person. At least two concrete details tied to the role; weave in 2-4 phrases from the job description. ${impactRule} No filler, cliches, headings, or bullet points.`
          : `Improve the candidate draft so it is stronger and clearer. Answer the application question directly. Preserve the candidate's intent; add specificity and one concrete example or outcome. ${lengthRule} First person. ${impactRule} No filler, cliches, headings, or bullet points.`;
      } else {
        taskHint = hasJobContext
          ? `Write a tailored answer to the application question. Use the job description and company to ground specifics. ${lengthRule} First person. At least two concrete details; reflect 2-4 ideas from the job description. ${impactRule} Interview-ready, not a template. No filler, cliches, headings, or bullet points.`
          : `Write a strong, portable first-draft answer that works across employers. Target length: 160-230 words unless the question clearly needs less. First person. At least one concrete skill and one measurable or observable result. ${impactRule} Specific enough to sound real; broadly reusable. No filler, cliches, headings, or bullet points.`;
      }

      const token = await getAccessToken();
      if (!token) throw new Error('Please sign in first.');
      const corpus = await loadFabricationCorpus();
      const context = profileContext();

      const requestBody = {
        question: q,
        draft,
        jobContext: hasJobContext ? `${companyName ? `Company: ${companyName}\n\n` : ''}${jdSnippet}` : 'Not provided',
        vaultAnswers: (profile.vault || []).map((item) => ({ question: String(item.question || ''), answer: String(item.answer || '') })),
        ...(context ? { profileContext: context } : {}),
        taskHint,
        styleHint: ANSWER_STYLE_INSTRUCTIONS[tone.value] || ANSWER_STYLE_INSTRUCTIONS.balanced,
        model: ANSWER_STUDIO_MODEL,
        ...(corpus.length ? { corpus } : {}),
      };

      const result = await withTimeout(
        fetch(`${API_URL}/api/answer-vault/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(requestBody),
        }).then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || `Generation failed (${res.status})`);
          return data;
        }),
        AI_TIMEOUT_SEC * 1000,
        'The AI is taking too long. Check your connection and try again.',
      );
      if (!alive) return;
      const improved = String(result?.text || '').trim();
      if (!improved) throw new Error('The model returned an empty answer. Try again.');

      answer.value = improved;
      generatedOnce = true;
      // Advisory only: the answer stands, and nothing is regenerated.
      flags = Array.isArray(result?.fabricationFlags) ? result.fabricationFlags : [];

      if (!premium) {
        let nextImprovements = improvementsLeft;
        if (consumesCredit) {
          try {
            const deduct = await withTimeout(creditManager.deductCredit(), CREDIT_API_TIMEOUT_MS, 'Credit update timed out after generation.');
            if (!deduct.success) {
              errorText = deduct.error || 'Answer written, but your credits could not be updated.';
              nextImprovements = 0;
            } else {
              credits = deduct.isPremium ? Infinity : deduct.remaining;
              ctx.setCredits(credits);
              nextImprovements = 3;
            }
          } catch (creditErr) {
            log.warn('Credit deduction failed after generation:', creditErr);
            errorText = 'Answer written, but the credit update failed. Refresh to see your balance.';
            nextImprovements = 0;
          }
        } else {
          nextImprovements = Math.max(0, improvementsLeft - 1);
        }
        improvementsLeft = nextImprovements;
        try {
          await persistActive(improved, nextImprovements);
        } catch (persistErr) {
          log.warn('Could not persist the improvement balance:', persistErr);
        }
      }

      ctx.toast(hasJobContext
        ? 'Answer written for this job description.'
        : 'Answer written. Paste a job description and improve it to tailor it to the role.');
    } catch (e) {
      if (!alive) return;
      errorText = e?.message || 'Something went wrong.';
      ctx.toast(errorText, 'error');
    } finally {
      generating = false;
      if (alive) {
        setBusy(aiBtn, false);
        refreshControls();
        renderMessages();
      }
    }
  }

  refreshControls();
  renderMessages();
  renderSaved();
  load().then(loadCredits);

  return {
    unmount() {
      alive = false;
      switcher.destroy();
    },
  };
}
