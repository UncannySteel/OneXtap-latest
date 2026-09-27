import { h, ico, fill, uid } from '../ui/dom.js';
import { section, field, input, select, textarea, checkbox, button, iconButton, setBusy, spinner } from '../ui/controls.js';
import { fileDrop } from '../ui/file-drop.js';
import { profileSwitcher } from '../ui/switchers.js';
import { COUNTRIES, GENDERS } from '../../../../extension/constants.js';
import {
  DEFAULT_PROFILE, RACES, VETERAN_STATUS,
  emptyCertificate, emptyCustomField, emptyEducation, emptyExperience,
} from '@app/profileDefaults.js';
import { getActiveLegacyProfile, loadProfileStore, saveLegacyUserProfile } from '@app/profileStore.js';
import { parseResumeFile, RESUME_ACCEPT_ATTR, MAX_RESUME_LABEL } from '@app/resumeParse.js';
import { mergeParsedResumeIntoProfile } from '@app/resumeToProfile.js';
import { saveParsedResume } from '@app/resumeStore.js';
import { log as baseLog } from '@app/logger.js';

const log = baseLog.child('ui');

// My Profiles — the whole profile autofill fills from, as the backend's
// ProfilesPage had it: personal details, links, address, education,
// experience, certificates, skills, current job, pay, EEO, custom fields.
//
// Resume upload: parseResumeFile (src/resumeParse.js) does the transport,
// mergeParsedResumeIntoProfile (src/resumeToProfile.js) the translation, and
// the result is merged OVER the profile in the editor — never replacing it —
// for the user to review and save. The parse is also filed in the resume
// library (best effort: losing that copy must never cost the merge), handed
// the RAW parser output, because the corpus indexes the parser's field names.
//
// Saving writes the local profile store and pushes the profile to the
// extension (ONEXTAP_SYNC_DATA); a failed push is reported, never fatal.

const URL_TYPES = ['LinkedIn', 'GitHub', 'Portfolio', 'Other'].map((t) => ({ value: t, label: t }));

/** A stored profile, ready to render: every key the editor binds, filled in. */
const hydrate = (saved) => mergeParsedResumeIntoProfile(saved, {});

export function mount(body, ctx) {
  let profile = hydrate(DEFAULT_PROFILE);
  let loaded = false;
  let dirty = false;
  let parsing = false;
  let uploadError = '';
  let alive = true;
  let resumeDrop = null;

  // ---------- chrome ----------
  const switcher = profileSwitcher({ onChange: () => load() });
  const statusEl = h('span.savebar-status', { role: 'status' });
  const saveBtn = button('Save changes', { kind: 'citrine', icon: 'save', onClick: save });
  const sectionsEl = h('div.ws-sections');
  const savebar = h('div.savebar', null, h('div.savebar-pill', null, statusEl, saveBtn));

  fill(body,
    h('div.ws-toolbar', null, switcher.el,
      h('p.ws-toolbar-note', null, 'Each profile keeps its own details, answers and cover letters. Autofill uses the one selected here.')),
    sectionsEl,
    savebar);

  function setStatus(text, tone) {
    statusEl.textContent = text || '';
    statusEl.dataset.tone = tone || '';
  }
  function touch() {
    if (!dirty) {
      dirty = true;
      setStatus('Unsaved changes', 'dirty');
    }
  }
  const beforeUnload = (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnload);

  // ---------- binding helpers ----------
  // Inputs write straight into `profile` and mark it dirty; only a change of
  // shape (a row added or removed, a country that moves the dial code)
  // rebuilds a section, so typing never loses focus.
  const text = (get, set, props = {}) => input({
    value: get() ?? '',
    oninput: (e) => { set(e.target.value); touch(); },
    ...props,
  });
  const area = (get, set, props = {}) => textarea({
    value: get() ?? '',
    oninput: (e) => { set(e.target.value); touch(); },
    ...props,
  });
  const pick = (options, get, set, props = {}) => select(options, {
    value: get() ?? '',
    onchange: (e) => { set(e.target.value); touch(); },
    ...props,
  });
  const rowsOf = (key) => (Array.isArray(profile[key]) ? profile[key] : (profile[key] = []));

  // ---------- sections ----------
  const builders = {
    resume: buildResume,
    basic: buildBasic,
    links: buildLinks,
    address: buildAddress,
    education: buildEducation,
    experience: buildExperience,
    certificates: buildCertificates,
    skills: buildSkills,
    job: buildJob,
    pay: buildPay,
    eeo: buildEeo,
    custom: buildCustom,
  };
  const built = {};

  function renderAll() {
    fill(sectionsEl, Object.keys(builders).map((key) => (built[key] = builders[key]())));
  }
  function rerender(key, focus) {
    const next = builders[key]();
    built[key].replaceWith(next);
    built[key] = next;
    if (focus) next.querySelector(focus)?.focus();
  }

  function buildResume() {
    const pickInput = h('input', { type: 'file', accept: RESUME_ACCEPT_ATTR, hidden: true });
    pickInput.addEventListener('change', () => {
      const file = pickInput.files?.[0];
      pickInput.value = ''; // the same file twice fires no change otherwise
      startUpload(file);
    });
    const uploadBtn = button(parsing ? 'Parsing…' : 'Upload resume', { kind: 'solid', icon: 'upload', size: 'sm', onClick: () => pickInput.click(), disabled: parsing });
    if (parsing) uploadBtn.classList.add('is-busy');
    const zone = h('div.drop', null,
      h('div.drop-icon', null, ico(parsing ? 'spark' : 'file', 22)),
      h('div.drop-text', null,
        h('p.drop-title', null, parsing ? 'Reading your resume…' : 'Fill this profile from a resume'),
        h('p.drop-sub', null, parsing
          ? 'Pulling out your details, history and skills. Review them, then save.'
          : `Drop a PDF or image here, or pick one — up to ${MAX_RESUME_LABEL}. It fills the fields below; nothing is saved until you save.`)),
      h('div.drop-act', null, uploadBtn, pickInput),
      uploadError && h('p.drop-err', { role: 'alert' }, uploadError));
    // One zone at a time: a rebuilt section replaces the last one's listeners.
    resumeDrop?.destroy();
    resumeDrop = fileDrop(zone, {
      isDisabled: () => parsing,
      onDragChange: (on) => { if (on && uploadError) { uploadError = ''; zone.querySelector('.drop-err')?.remove(); } },
      onDrop: (files) => {
        if (files.length > 1) {
          uploadError = 'Drop one resume at a time.';
          rerender('resume');
          return;
        }
        startUpload(files[0]);
      },
    });
    return section({ num: 1, label: 'Resume', title: 'Start from a resume', desc: 'The quickest way in: upload one and every field it can read is filled for you.' }, zone);
  }

  function buildBasic() {
    const dial = h('span.f-addon', { 'aria-hidden': 'true' }, profile.countryCode || '+1');
    const phoneId = uid('phone');
    return section({ num: 2, label: 'Basic info', title: 'Who you are' },
      h('div.fgrid', null,
        field({ label: 'First name', span: 3, control: text(() => profile.firstName, (v) => { profile.firstName = v; }, { autocomplete: 'given-name' }) }),
        field({ label: 'Last name', span: 3, control: text(() => profile.lastName, (v) => { profile.lastName = v; }, { autocomplete: 'family-name' }) }),
        field({ label: 'Email', span: 6, control: text(() => profile.email, (v) => { profile.email = v; }, { type: 'email', autocomplete: 'email' }) }),
        field({
          label: 'Country',
          span: 3,
          control: select(COUNTRIES.map((c) => ({ value: c.name, label: c.name })), {
            value: profile.country,
            onchange: (e) => onCountry(e.target.value),
          }),
        }),
        field({
          label: `Phone (${profile.countryCode || '+1'})`,
          span: 3,
          labelFor: phoneId,
          control: h('div.f-group', null, dial, text(() => profile.phone, (v) => { profile.phone = v; }, { type: 'tel', autocomplete: 'tel-national', id: phoneId })),
        }),
        field({ label: 'Birth date', span: 3, control: text(() => profile.birthDate, (v) => { profile.birthDate = v; }, { type: 'date' }) }),
        field({
          label: 'Gender',
          span: 3,
          control: pick([{ value: '', label: 'Select…' }, ...GENDERS.map((g) => ({ value: g, label: g }))], () => profile.gender, (v) => { profile.gender = v; }),
        })));
  }

  /**
   * The top-level country sets the phone's dial code, and the address
   * country too — but only while the address is still following it. A
   * deliberately different address country (a mailing address abroad) is
   * left alone, as the backend's editor does.
   */
  function onCountry(name) {
    const chosen = COUNTRIES.find((c) => c.name === name);
    const addr = profile.address || {};
    const following = !addr.country || addr.country === profile.country;
    profile.country = name;
    if (chosen) profile.countryCode = chosen.dial_code;
    if (following) profile.address = { ...DEFAULT_PROFILE.address, ...addr, country: name };
    touch();
    rerender('basic', 'select');
    if (following) rerender('address');
  }

  function buildLinks() {
    const urls = rowsOf('urls');
    return section({ num: 3, label: 'Links', title: 'Where to find you' },
      h('div.rows', null, urls.map((u, i) => h('div.row-inline', null,
        pick(URL_TYPES, () => u.type, (v) => { u.type = v; }, { class: 'w-narrow', 'aria-label': 'Link type' }),
        text(() => u.value, (v) => { u.value = v; }, { type: 'url', placeholder: 'https://…', 'aria-label': `${u.type || 'Link'} URL` }),
        iconButton('trash', { label: 'Remove link', danger: true, onClick: () => { urls.splice(i, 1); touch(); rerender('links'); } })))),
      addButton('Add link', () => { urls.push({ type: 'Other', value: '' }); touch(); rerender('links', '.row-inline:last-child input'); }));
  }

  function buildAddress() {
    const addr = profile.address || (profile.address = { ...DEFAULT_PROFILE.address });
    const set = (key) => (v) => { profile.address = { ...DEFAULT_PROFILE.address, ...profile.address, [key]: v }; };
    const get = (key) => () => profile.address?.[key] || '';
    return section({ num: 4, label: 'Address', title: 'Where you live' },
      h('div.fgrid', null,
        field({ label: 'Address line 1', span: 6, control: text(get('addressLine1'), set('addressLine1'), { autocomplete: 'address-line1' }) }),
        field({ label: 'Address line 2', span: 6, control: text(get('addressLine2'), set('addressLine2'), { autocomplete: 'address-line2' }) }),
        field({ label: 'Address line 3', span: 6, control: text(get('addressLine3'), set('addressLine3'), { autocomplete: 'address-line3' }) }),
        field({ label: 'City', span: 2, control: text(get('city'), set('city'), { autocomplete: 'address-level2' }) }),
        field({ label: 'State', span: 2, control: text(get('state'), set('state'), { autocomplete: 'address-level1' }) }),
        field({ label: 'Postal code', span: 2, control: text(get('postalCode'), set('postalCode'), { autocomplete: 'postal-code' }) }),
        field({
          label: 'Country',
          span: 6,
          control: select(COUNTRIES.map((c) => ({ value: c.name, label: c.name })), {
            value: addr.country || '',
            onchange: (e) => { set('country')(e.target.value); touch(); },
          }),
        })));
  }

  /** A removable card for one repeated row (education, experience, certificate). */
  function rowCard(key, index, children, label) {
    const rows = rowsOf(key);
    return h('div.row-card', null,
      h('div.row-card-head', null,
        h('span.row-card-num', null, String(index + 1).padStart(2, '0')),
        iconButton('trash', { label: `Remove ${label}`, danger: true, onClick: () => { rows.splice(index, 1); touch(); rerender(key); } })),
      h('div.fgrid', null, children));
  }

  function buildEducation() {
    const rows = rowsOf('education');
    return section({ num: 5, label: 'Education', title: 'Where you studied' },
      h('div.rows', null, rows.map((ed, i) => {
        const t = (k, props) => text(() => ed[k], (v) => { ed[k] = v; }, props);
        return rowCard('education', i, [
          field({ label: 'School', span: 6, control: t('school', { placeholder: 'School name' }) }),
          field({ label: 'Degree', span: 3, control: t('degree', { placeholder: 'e.g. B.S.' }) }),
          field({ label: 'Field', span: 3, control: t('field', { placeholder: 'e.g. Computer Science' }) }),
          field({ label: 'Start', span: 2, control: t('start', { placeholder: 'YYYY' }) }),
          field({ label: 'End', span: 2, control: t('end', { placeholder: 'YYYY' }) }),
          field({ label: 'GPA / CGPA', span: 2, control: t('cgpa', { placeholder: 'e.g. 3.8' }) }),
          field({ label: 'Specialization', span: 3, control: t('specialization') }),
          field({ label: 'Minor', span: 3, control: t('minor') }),
          field({ label: 'Graduation year', span: 2, control: t('graduationYear', { placeholder: 'YYYY' }) }),
          field({ label: 'Enrollment year', span: 2, control: t('enrollmentYear', { placeholder: 'YYYY' }) }),
          field({ label: 'Expected graduation', span: 2, control: t('expectedGraduation', { placeholder: 'YYYY' }) }),
        ], 'education');
      })),
      addButton('Add education', () => { rows.push(emptyEducation()); touch(); rerender('education', '.row-card:last-child input'); }));
  }

  function buildExperience() {
    const rows = rowsOf('experience');
    return section({ num: 6, label: 'Experience', title: 'Where you have worked' },
      h('div.rows', null, rows.map((ex, i) => {
        const t = (k, props) => text(() => ex[k], (v) => { ex[k] = v; }, props);
        return rowCard('experience', i, [
          field({ label: 'Company', span: 3, control: t('company') }),
          field({ label: 'Title', span: 3, control: t('title') }),
          field({ label: 'Start', span: 2, control: t('start', { placeholder: 'YYYY-MM' }) }),
          field({ label: 'End', span: 2, control: t('end', { placeholder: 'YYYY-MM or Present' }) }),
          h('div.f.span-2.f-check', null, checkbox({ label: 'Current role', checked: !!ex.isCurrent, onChange: (on) => { ex.isCurrent = on; touch(); } })),
          field({ label: 'Description', span: 6, control: area(() => ex.description, (v) => { ex.description = v; }, { placeholder: 'Responsibilities, achievements…' }) }),
        ], 'experience');
      })),
      addButton('Add experience', () => { rows.push(emptyExperience()); touch(); rerender('experience', '.row-card:last-child input'); }));
  }

  function buildCertificates() {
    const rows = rowsOf('certificates');
    return section({ num: 7, label: 'Certificates', title: 'What you are certified in' },
      h('div.rows', null, rows.map((cert, i) => {
        const t = (k, props) => text(() => cert[k], (v) => { cert[k] = v; }, props);
        return rowCard('certificates', i, [
          field({ label: 'Name', span: 3, control: t('name', { placeholder: 'Certification name' }) }),
          field({ label: 'Issuer', span: 3, control: t('issuer') }),
          field({ label: 'Date', span: 3, control: t('date', { placeholder: 'e.g. March 2023' }) }),
          field({ label: 'Expiry', span: 3, control: t('expiry', { placeholder: 'e.g. March 2026' }) }),
        ], 'certificate');
      })),
      addButton('Add certificate', () => { rows.push(emptyCertificate()); touch(); rerender('certificates', '.row-card:last-child input'); }));
  }

  function buildSkills() {
    const skills = rowsOf('skills');
    const box = input({ placeholder: 'Add a skill (e.g. JavaScript), then press Enter', 'aria-label': 'Add a skill' });
    const add = () => {
      const s = box.value.trim();
      if (!s) return;
      if (!skills.some((x) => String(x).toLowerCase() === s.toLowerCase())) {
        skills.push(s);
        touch();
      }
      rerender('skills', 'input');
    };
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); add(); }
    });
    return section({ num: 8, label: 'Skills', title: 'What you know' },
      skills.length
        ? h('div.chips', null, skills.map((s) => h('span.chip', null, s,
          h('button.chip-x', { type: 'button', 'aria-label': `Remove ${s}`, onclick: () => { skills.splice(skills.indexOf(s), 1); touch(); rerender('skills'); } }, ico('x', 12)))))
        : h('p.muted', null, 'No skills yet.'),
      h('div.row-inline', null, box, button('Add', { kind: 'solid', size: 'sm', onClick: add })));
  }

  function buildJob() {
    const job = () => profile.currentJob || (profile.currentJob = { ...DEFAULT_PROFILE.currentJob });
    return section({ num: 9, label: 'Current job', title: 'What you do now' },
      h('div.fgrid', null,
        field({ label: 'Company', span: 3, control: text(() => job().company, (v) => { profile.currentJob = { ...job(), company: v }; }) }),
        field({ label: 'Title', span: 3, control: text(() => job().title, (v) => { profile.currentJob = { ...job(), title: v }; }) }),
        h('div.f.span-6', null, checkbox({ label: 'Currently employed here', checked: !!job().isCurrent, onChange: (on) => { profile.currentJob = { ...job(), isCurrent: on }; touch(); } }))));
  }

  function buildPay() {
    return section({ num: 10, label: 'Pay', title: 'Compensation and availability' },
      h('div.fgrid', null,
        field({ label: 'Current salary', span: 2, control: text(() => profile.currentSalary, (v) => { profile.currentSalary = v; }, { placeholder: 'e.g. 80,000' }) }),
        field({ label: 'Pay expectation', span: 2, control: text(() => profile.payExpectation, (v) => { profile.payExpectation = v; }, { placeholder: 'e.g. 90,000' }) }),
        field({ label: 'Notice period', span: 2, control: text(() => profile.noticePeriod, (v) => { profile.noticePeriod = v; }, { placeholder: 'e.g. 2 weeks' }) })));
  }

  function buildEeo() {
    const races = rowsOf('race');
    return section({ num: 11, label: 'EEO', title: 'Self-identification', desc: 'Optional. Some applications ask; autofill answers only what you fill in here.' },
      h('div.fgrid', null,
        h('div.f.span-6', null,
          h('p.f-k', null, 'Race'),
          h('div.chips', { role: 'group', 'aria-label': 'Race' }, (RACES || []).map((race) => h('button.chip.is-toggle', {
            type: 'button',
            'aria-pressed': String(races.includes(race)),
            onclick: (e) => {
              const i = races.indexOf(race);
              if (i >= 0) races.splice(i, 1); else races.push(race);
              e.currentTarget.setAttribute('aria-pressed', String(i < 0));
              touch();
            },
          }, race)))),
        field({ label: 'Ethnicity', span: 3, control: text(() => profile.ethnicity, (v) => { profile.ethnicity = v; }, { placeholder: 'Optional' }) }),
        field({
          label: 'Veteran status',
          span: 3,
          control: pick([{ value: '', label: 'Select…' }, ...(VETERAN_STATUS || []).map((v) => ({ value: v, label: v }))], () => profile.veteran, (v) => { profile.veteran = v; }),
        }),
        field({ label: 'Disability', span: 6, control: text(() => profile.disability, (v) => { profile.disability = v; }, { placeholder: 'Optional — decline to identify or describe' }) })));
  }

  function buildCustom() {
    const rows = rowsOf('customFields');
    // The label is not decoration: it is what autofill matches a form's
    // field against (the customFields block of buildIntents() in
    // public/content.js), so it asks for the name as a form would print it.
    return section({
      num: 12,
      label: 'Custom',
      title: 'Anything else forms ask',
      desc: 'Mother’s name, roll number, visa status. Name it the way a form labels it, and autofill will match it.',
    },
    rows.length
      ? h('div.rows', null, rows.map((f, i) => h('div.row-inline', null,
        text(() => f.label, (v) => { f.label = v; }, { class: 'w-narrow', placeholder: 'Field name (e.g. Mother’s Name)', 'aria-label': 'Field name' }),
        text(() => f.value, (v) => { f.value = v; }, { placeholder: 'Value', 'aria-label': `${f.label || 'Field'} value` }),
        iconButton('trash', { label: 'Remove field', danger: true, onClick: () => { rows.splice(i, 1); touch(); rerender('custom'); } }))))
      : h('p.muted', null, 'No custom fields yet.'),
    addButton('Add field', () => { rows.push(emptyCustomField()); touch(); rerender('custom', '.row-inline:last-child input'); }));
  }

  function addButton(label, onClick) {
    return h('button.add-row', { type: 'button', onclick: onClick }, ico('plus', 14), label);
  }

  // ---------- load / upload / save ----------
  async function load() {
    await loadProfileStore();
    const saved = await getActiveLegacyProfile();
    if (!alive) return;
    profile = hydrate(saved || DEFAULT_PROFILE);
    loaded = true;
    dirty = false;
    setStatus('');
    renderAll();
  }

  async function startUpload(file) {
    if (!file || parsing) return;
    uploadError = '';
    parsing = true;
    rerender('resume');
    try {
      const result = await parseResumeFile(file);
      if (!alive) return;
      if (!result.ok) {
        uploadError = result.error.message;
        return;
      }
      profile = mergeParsedResumeIntoProfile(profile, result.parsed);
      touch();

      // The library copy lets Job Matches and the popup reuse this one upload.
      // Strictly non-blocking: a full store must never cost the merge above.
      let storeWarning = '';
      try {
        await saveParsedResume(result);
      } catch (e) {
        storeWarning = e?.message || 'Could not save this resume to your library.';
        log.warn('resume library write failed; profile merge kept', { errName: e?.name });
      }
      ctx.toast(storeWarning
        ? `Resume read. ${storeWarning}`
        : 'Resume read — review the fields, then save.', storeWarning ? 'error' : 'success');
    } catch (e) {
      log.error('resume upload failed', e);
      uploadError = e?.message || 'Could not read that file. Try again.';
    } finally {
      parsing = false;
      if (alive) renderAll();
    }
  }

  async function save() {
    if (!loaded) return;
    setBusy(saveBtn, true, 'Saving…');
    try {
      await saveLegacyUserProfile(profile);
      const synced = await ctx.syncToExtension(profile);
      dirty = false;
      if (synced) {
        setStatus('Saved and synced to the extension', 'ok');
        ctx.toast('Saved.');
      } else if (ctx.hasExtension) {
        setStatus('Saved here — the extension didn’t confirm the sync', 'warn');
        ctx.toast('Saved (sync to extension failed).', 'error');
      } else {
        setStatus('Saved on this device', 'ok');
        ctx.toast('Saved.');
      }
      ctx.onProfileSaved?.(profile);
    } catch (error) {
      log.error('save failed', error);
      setStatus('Couldn’t save', 'error');
      ctx.toast('Couldn’t save your profile. Try again.', 'error');
    } finally {
      setBusy(saveBtn, false);
    }
  }

  // First paint: the sections, as skeletons, until the store is read.
  fill(sectionsEl, spinner('Loading your profile…'));
  load();

  return {
    unmount() {
      alive = false;
      window.removeEventListener('beforeunload', beforeUnload);
      resumeDrop?.destroy();
      switcher.destroy();
    },
  };
}
