/**
 * Onextap Autofill Content Script
 *
 * Injected on demand via chrome.scripting.executeScript({ files: ['content.js'] }).
 * Plain classic browser script — no import/export, no bundler globals.
 *
 * Message contract — every handler replies synchronously (the listener
 * returns false) and every reply is either { success: true, ... } or
 * { success: false, error: <msg> }:
 *
 *   { action: "AUTOFILL_TRIGGERED", profile }  → { success, filled: <count> }
 *   { action: "SCRAPE_CONTEXT" }               → { success, context: { company, description } }
 *   { action: "DETECT_SECTIONS" }              → { success, sections: { personalInfo, education,
 *                                                    workExperience, openEnded, coverLetter } }
 *   { action: "FILL_COVER_LETTER", text }      → { success } — false when no field matched
 *
 * Messages without an `action` are ignored.
 */

// ── Duplicate-injection guard ────────────────────────────────────────────────
// The popup may call executeScript more than once. We only register the listener
// the very first time this script lands in the page's isolated world.
if (!window.__onextapAutofillLoaded) {
  window.__onextapAutofillLoaded = true;

  // ── Logging ────────────────────────────────────────────────────────────────
  // Inline on purpose: this file is copied verbatim into the build and cannot
  // import (see the header). It is the trimmed-down sibling of
  // src/logger.js and extension/logger.js.
  //
  // This code runs inside a third-party page, so its output lands in that
  // site's devtools console. Never log profile values, field values, or
  // scraped page text here — only error names, messages, and counts. The
  // richer diagnostics belong in the popup and the service worker.
  //
  // Errors and warnings always print. Set window.__onextapDebug = true in the
  // page console for the verbose ones.
  const log = {
    error: (msg, err) => console.error('[Onextap]', msg, err ? errShape(err) : ''),
    warn: (msg, err) => console.warn('[Onextap]', msg, err ? errShape(err) : ''),
    debug: (msg, extra) => {
      if (window.__onextapDebug) console.log('[Onextap]', msg, extra ?? '');
    },
  };

  function errShape(err) {
    if (!err || typeof err !== 'object') return { message: String(err) };
    return { name: err.name, message: String(err.message || '').slice(0, 300) };
  }

  // ── React/Vue-safe value setter ────────────────────────────────────────────
  /**
   * Sets the value of an input or textarea in a way that React and Vue detect,
   * then dispatches both 'input' and 'change' events so framework state updates.
   *
   * @param {HTMLInputElement|HTMLTextAreaElement} el
   * @param {string} value
   */
  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Visibility / fillability check ────────────────────────────────────────
  /**
   * Returns true when the element is visible and interactive.
   * Treats position:fixed elements as visible even when offsetParent is null.
   *
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  function isVisible(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.offsetParent !== null) return true;
    // offsetParent is null for fixed-position elements too — allow those.
    const style = window.getComputedStyle(el);
    return style.position === 'fixed' && style.display !== 'none' && style.visibility !== 'hidden';
  }

  // ── Label text resolver ────────────────────────────────────────────────────
  /**
   * Returns the text of the <label> associated with an element, checking:
   *   1. label[for=id]  (explicit association)
   *   2. Wrapping <label> ancestor  (implicit association)
   *
   * @param {HTMLElement} el
   * @returns {string}
   */
  function getLabelText(el) {
    // Explicit: <label for="fieldId">
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent || '';
    }
    // Implicit: el is a descendant of <label>
    const ancestor = el.closest('label');
    if (ancestor) return ancestor.textContent || '';
    return '';
  }

  // ── Field signature builder ────────────────────────────────────────────────
  /**
   * The matching alphabet: lowercase, punctuation flattened to spaces, runs of
   * whitespace collapsed.
   *
   * Both sides of every comparison go through this. A field signature and a
   * user's custom-field label are written by different people in different
   * places and must still line up — "Mother's Name" on a form and
   * "Mother's  Name" in the profile both have to reduce to "mother s name"
   * or the field silently never fills.
   *
   * Collapsing the runs also repairs built-in matches that used to miss:
   * `name="first__name"` flattened to "first  name", which `includes('first
   * name')` rejected.
   *
   * @param {string} text
   * @returns {string}
   */
  function normalizeForMatch(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Concatenates all identifying text attributes of a field into one
   * lowercase string used for keyword matching.
   *
   * @param {HTMLElement} el
   * @returns {string}
   */
  function fieldSignature(el) {
    const parts = [
      el.getAttribute('name') || '',
      el.id || '',
      el.getAttribute('placeholder') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('autocomplete') || '',
      getLabelText(el),
    ];
    return normalizeForMatch(parts.join(' '));
  }

  // ── Dial-code stripper ─────────────────────────────────────────────────────
  /**
   * Returns the phone number without its leading international dial code.
   *
   * Only strips a code it can prove: the profile's own `countryCode`, written
   * as "+91", as "0091", or as bare "91" followed by a separator. Anything
   * else is returned untouched — a number that merely starts with the same
   * digits as the dial code ("915551234" for a +91 profile) keeps them,
   * because guessing wrong here deletes real digits from a real phone number.
   *
   * @param {string} phone
   * @param {string} dialCode The profile's dial code, e.g. "+91".
   * @returns {string}
   */
  function stripDialCode(phone, dialCode) {
    const raw = String(phone || '').trim();
    const digits = String(dialCode || '').replace(/[^0-9]/g, '');
    if (!raw || !digits) return raw;

    // "+91 555...", "0091-555...", or "91 555..." — the bare form needs a
    // separator after it so a local number starting with 91 is left alone.
    const prefix = new RegExp(`^(?:\\+\\s*${digits}|00\\s*${digits}|${digits}(?=[\\s().-]))[\\s().-]*`);
    // Empty only when the stored value was nothing but a dial code, which is
    // not a phone number — buildIntents' emptiness filter drops it.
    return raw.replace(prefix, '').trim();
  }

  // ── Intent list builder ────────────────────────────────────────────────────
  /**
   * Converts the profile object into an ordered array of fill intents.
   * ORDER MATTERS: more-specific intents must come before generic ones so
   * that the first keyword match wins correctly.
   *
   * Each intent: { keywords: string[], value: string }
   *
   * The list is the profile's fixed schema PLUS the user's own
   * `customFields`, which lead it — see the block where they are built for
   * why that position is load-bearing. Adding a field to the profile that
   * autofill should know about means adding an entry here; a value with no
   * entry is stored and never used.
   *
   * @param {object} profile
   * @returns {Array<{keywords: string[], value: string}>}
   */
  function buildIntents(profile) {
    const p = profile || {};
    const addr = p.address || {};
    const currentJob = p.currentJob || {};
    const urls = Array.isArray(p.urls) ? p.urls : [];
    const experience = Array.isArray(p.experience) ? p.experience : [];

    // Helper: find a URL by type.
    //
    // CASE-INSENSITIVE, deliberately. The resume parser is prompted for
    // "linkedin|github|portfolio|other" in lowercase while this lookup and the
    // editor's <select> both spell them "LinkedIn|GitHub|Portfolio|Other", so
    // an exact match meant no parsed link ever autofilled. New uploads are
    // canonicalised in src/resumeToProfile.js; this comparison is what lets
    // profiles ALREADY saved with lowercase types work without a re-upload.
    const urlOf = (type) => {
      const want = String(type).toLowerCase();
      const entry = urls.find((u) => u && String(u.type).toLowerCase() === want);
      return entry ? entry.value || '' : '';
    };

    // Derive some composite values
    const fullName =
      [p.firstName, p.lastName].filter(Boolean).join(' ');
    // ── Phone, WITHOUT the dial code ──────────────────────────────────────
    //
    // The profile stores the dial code (`countryCode`, "+91") beside the
    // number because the editor shows them as two boxes, and this used to
    // glue them back together for anything labelled "Phone Number" — a form
    // asking for a phone number got "+915551234567".
    //
    // A phone box wants a phone number. Forms that want the dial code ask for
    // it in their own field, which is what the `country code` intent below
    // fills, so nothing needs the glued form any more.
    //
    // `stripDialCode` is what makes that true for numbers we did not type
    // ourselves: the resume parser writes whatever the CV printed, dial code
    // and all, into `phone`. Dropping the concatenation alone would still
    // leave those numbers filling as "+91 5551234567".
    const dialCode = String(p.countryCode || '').trim();
    const localPhone = stripDialCode(p.phone, dialCode);
    const companyName =
      currentJob.company || (experience[0] && experience[0].company) || '';
    const jobTitle =
      currentJob.title || (experience[0] && experience[0].title) || '';
    const linkedInUrl = urlOf('LinkedIn');
    const githubUrl   = urlOf('GitHub');
    const portfolioUrl = urlOf('Portfolio');
    const skillsText = Array.isArray(p.skills) ? p.skills.join(', ') : '';

    // ── User-defined fields ───────────────────────────────────────────────
    //
    // FIRST IN THE LIST, and that position is the whole design. Matching stops
    // at the first intent whose keyword appears in the field signature, so a
    // custom "Mother's Name" placed after the built-ins would lose the field
    // to the generic `name` keywords below and fill in the candidate's own
    // name instead. The user named this field; their name for it wins.
    //
    // The label is matched through the same normaliser the signature goes
    // through, so what they typed lines up with what the form is labelled
    // whatever punctuation either side used. Labels shorter than three
    // characters are dropped: a one- or two-letter keyword appears inside
    // almost every signature on the page and would carpet the form.
    const customIntents = (Array.isArray(p.customFields) ? p.customFields : [])
      .map((field) => ({
        keywords: [normalizeForMatch(field && field.label)],
        value: field && typeof field.value === 'string' ? field.value : '',
      }))
      .filter((intent) => intent.keywords[0].length >= 3);

    // Raw intent list — specific entries before generic ones
    const raw = [
      ...customIntents,
      // ── Name fields (specific before generic) ──────────────────────────────
      {
        keywords: ['first name', 'firstname', 'given name', 'givenname'],
        value: p.firstName,
      },
      {
        keywords: ['last name', 'lastname', 'surname', 'family name', 'familyname'],
        value: p.lastName,
      },
      {
        // Full name: only match "full name" or bare "name" after specifics are
        // handled. We deliberately do NOT include plain "name" here to avoid
        // hitting company-name / school-name fields. Those are handled below.
        keywords: ['full name', 'fullname', 'your name', 'legal name'],
        value: fullName,
      },

      // ── Contact ────────────────────────────────────────────────────────────
      {
        // 'e mail', not 'e-mail': keywords are matched against a signature
        // that has already been through normalizeForMatch(), where every
        // hyphen is a space — so the hyphenated spelling could never fire and
        // bare 'mail' was quietly covering for it. Bare 'mail' also claimed
        // "mailing address" and "mailing country" for the email box.
        keywords: ['email', 'e mail'],
        value: p.email,
      },
      {
        // BEFORE the phone intents: "phone country code" contains "phone", so
        // a dial-code box placed after them collects the whole number.
        //
        // A plain "country code" field is genuinely ambiguous — some forms
        // mean "+91", others mean "IN". Trying the dial code here costs
        // nothing when they meant the ISO code: a <select> of country names
        // has no option matching "+91", fillSelect reports the miss, and the
        // `country` intent further down gets its turn at the same field.
        keywords: [
          'country code', 'countrycode', 'dial code', 'dialcode',
          'phone code', 'phonecode', 'isd code', 'calling code',
          'phone country', 'mobile country',
        ],
        value: dialCode,
      },
      {
        keywords: ['phone number', 'phonenumber', 'mobile number', 'contact number', 'telephone number'],
        value: localPhone,
      },
      {
        keywords: ['phone', 'mobile', 'tel', 'telephone', 'cell'],
        value: localPhone,
      },

      // ── Social / URL ───────────────────────────────────────────────────────
      {
        keywords: ['linkedin'],
        value: linkedInUrl,
      },
      {
        keywords: ['github'],
        value: githubUrl,
      },
      {
        keywords: ['portfolio', 'website', 'personal site', 'personal url', 'web site'],
        value: portfolioUrl,
      },

      // ── Address (specific before generic) ─────────────────────────────────
      {
        keywords: ['address line 1', 'address1', 'street address', 'street line 1', 'addressline1'],
        value: addr.addressLine1,
      },
      {
        keywords: ['address line 2', 'address2', 'apt', 'suite', 'unit', 'addressline2'],
        value: addr.addressLine2,
      },
      {
        keywords: ['address line 3', 'address3', 'addressline3'],
        value: addr.addressLine3,
      },
      {
        keywords: ['city', 'town', 'municipality'],
        value: addr.city,
      },
      {
        keywords: ['state', 'province', 'region', 'county'],
        value: addr.state,
      },
      {
        keywords: ['postal code', 'postalcode', 'zip code', 'zipcode', 'zip', 'postcode', 'post code'],
        value: addr.postalCode,
      },
      {
        // ── The two countries ─────────────────────────────────────────────
        //
        // The profile holds a country twice: the one in Basic Info, which
        // also picks the phone dial code, and the one inside the address.
        // They are separate on purpose — a mailing address may sit in a
        // different country from the applicant (resumeToProfile.js refuses to
        // collapse them for the same reason).
        //
        // Which one answers a form's "Country" box was the second half of the
        // country bug. This used to read `addr.country || p.country`, and
        // both fields start life as the DEFAULT_PROFILE value, so a user who
        // set Basic Info to India and never scrolled down to the address
        // still autofilled "United States" — the default they never chose,
        // beating the country they did.
        //
        // So: an address-scoped label gets the address country, and a bare
        // "Country" gets the person's. The specific one is listed first
        // because matching stops at the first hit.
        keywords: [
          'address country', 'mailing country', 'country of residence',
          'residence country', 'permanent country', 'home country',
        ],
        value: addr.country || p.country,
      },
      {
        // Bare "country" — after postal/zip so it can't reach a postal code
        // field, and after the dial-code intent up in the Contact block so
        // "country code" is not read as a request for the country.
        keywords: ['country'],
        value: p.country || addr.country,
      },

      // ── Personal ──────────────────────────────────────────────────────────
      {
        keywords: ['gender', 'sex'],
        value: p.gender,
      },
      {
        keywords: [
          'date of birth', 'dateofbirth', 'dob', 'birth date', 'birthdate',
          'birthday', 'birth day',
        ],
        value: p.birthDate,
      },

      // ── Work / professional ────────────────────────────────────────────────
      {
        // "current company" / "employer" — must come before bare "company"
        keywords: [
          'current company', 'current employer', 'employer name',
          'company name', 'organization name', 'organisation name',
        ],
        value: companyName,
      },
      {
        keywords: [
          'job title', 'jobtitle', 'current title', 'position', 'current position',
          'role', 'current role', 'designation',
        ],
        value: jobTitle,
      },
      {
        keywords: ['skills', 'skill set', 'skillset', 'technologies', 'competencies'],
        value: skillsText,
      },
      {
        keywords: [
          'expected salary', 'salary expectation', 'pay expectation',
          'desired salary', 'salary requirement',
        ],
        value: p.payExpectation != null ? String(p.payExpectation) : '',
      },
      {
        keywords: [
          'current salary', 'current ctc', 'current compensation', 'present salary',
        ],
        value: p.currentSalary != null ? String(p.currentSalary) : '',
      },
      {
        keywords: [
          'notice period', 'noticeperiod', 'notice', 'joining period',
          'available from', 'availability',
        ],
        value: p.noticePeriod != null ? String(p.noticePeriod) : '',
      },
    ];

    // Filter out intents with no usable value
    return raw.filter((intent) => intent.value && String(intent.value).trim() !== '');
  }

  // ── Select-element filler ─────────────────────────────────────────────────
  /**
   * Tries to set a <select> to the option whose text or value best matches
   * the target string (case-insensitive substring). Dispatches a change event.
   * Returns true if an option was selected.
   *
   * @param {HTMLSelectElement} selectEl
   * @param {string} target
   * @returns {boolean}
   */
  function fillSelect(selectEl, target) {
    const needle = String(target || '').toLowerCase().trim();
    if (!needle) return false;

    // ═══ PLACEHOLDERS ARE NOT CANDIDATES ═══
    //
    // This is the country bug. The substring pass asks whether the target
    // CONTAINS the option's text, which is how "United States" reaches an
    // option reading "United States of America" — but every string contains
    // "", so `<option value="">` with empty text matched EVERY target. It is
    // the first row of almost every country <select>, so it won: the select
    // was set back to its placeholder, the field was marked filled, and no
    // later intent could rescue it. Country came out blank, every time.
    //
    // An option with an empty value submits nothing, so it is never an
    // answer. Dropping those also retires "Select...", "-- Choose --", and
    // the rest of the family.
    const options = Array.from(selectEl.options)
      .map((o) => ({ el: o, value: String(o.value || '').trim(), text: String(o.text || '').trim() }))
      .filter((o) => o.value !== '');

    const choose = (o) => {
      if (!o) return false;
      selectEl.value = o.el.value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };

    // Exact match, on the value then the visible text.
    //
    // TRIMMED, both sides. Option text arrives with the newlines and
    // indentation the page's HTML was written with, so the exact pass used to
    // miss "\n      India\n    " and drop through to the substring pass —
    // where the placeholder above was waiting.
    if (choose(options.find((o) => o.value.toLowerCase() === needle))) return true;
    if (choose(options.find((o) => o.text.toLowerCase() === needle))) return true;

    // Substring, both directions, but only on whole words: plain `includes`
    // picked "Female" for a target of "Male", and "Niger" for "Nigeria".
    const holdsPhrase = (haystack, phrase) => {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
    };

    if (choose(options.find((o) => o.text && holdsPhrase(o.text.toLowerCase(), needle)))) return true;

    // The reverse — the option is a shorter form of the target, e.g. target
    // "United States" against an option "United". Two characters or fewer is
    // not evidence of anything ("IN" sits inside a dozen country names), so
    // those are left to the exact passes above.
    if (choose(options.find((o) => o.text.length >= 3 && holdsPhrase(needle, o.text.toLowerCase())))) return true;

    return false;
  }

  // ── Input type guard ───────────────────────────────────────────────────────
  /**
   * Returns true for input types we are allowed to fill.
   *
   * Allowlist, not a blocklist — anything not listed is skipped. That
   * deliberately excludes password, hidden, file, submit, button, image,
   * range, color and reset, and also checkbox and radio, which need a
   * checked-state decision rather than a value.
   *
   * @param {HTMLInputElement} el
   * @returns {boolean}
   */
  function isFillableInput(el) {
    const fillableTypes = new Set([
      '', 'text', 'email', 'tel', 'url', 'search', 'number', 'date',
      'month', 'week', 'time', 'datetime-local',
    ]);
    return fillableTypes.has((el.type || '').toLowerCase());
  }

  // ── Main autofill routine ─────────────────────────────────────────────────
  /**
   * Walks all fillable fields on the page, matches each against the intent
   * list, and fills matching empty visible fields.
   *
   * @param {object} profile
   * @returns {number} Number of fields actually filled.
   */
  function autofill(profile) {
    const intents = buildIntents(profile);
    if (intents.length === 0) return 0;

    // Collect all fillable elements
    const inputs = Array.from(
      document.querySelectorAll('input, textarea, select')
    );

    let filled = 0;
    const filledElements = new WeakSet(); // prevent double-filling

    for (const el of inputs) {
      try {
        // Type guard for <input>
        if (el.tagName === 'INPUT' && !isFillableInput(el)) continue;

        // Visibility / usability
        if (!isVisible(el)) continue;

        // Skip already-filled fields (non-empty)
        const currentValue = el.value ? el.value.trim() : '';
        if (currentValue !== '') continue;

        // Prevent double-filling same element
        if (filledElements.has(el)) continue;

        const sig = fieldSignature(el);

        // Find first matching intent (order in intents list matters)
        let matched = false;
        for (const intent of intents) {
          const hit = intent.keywords.some((kw) => sig.includes(kw));
          if (!hit) continue;

          if (el.tagName === 'SELECT') {
            matched = fillSelect(el, intent.value);
          } else {
            setNativeValue(el, intent.value);
            matched = true;
          }

          if (matched) {
            filledElements.add(el);
            filled++;
            break; // only apply one intent per field
          }
        }
      } catch (fieldErr) {
        // One bad field must never abort the run
        log.warn('error filling field', fieldErr);
      }
    }

    return filled;
  }

  // ── Page context scrape (company + description) ───────────────────────────
  /**
   * Best-effort read of the employer/institution name and the longest body of
   * descriptive text on the page, used as AI context.
   *
   * Company is resolved in priority order: og:site_name → known job-board
   * selectors → the last segment of document.title split on | - — or " at ".
   * Description picks whichever candidate selector yields the most text,
   * falling back to document.body, then collapses whitespace and caps at
   * 8000 chars.
   *
   * NOTE: scrapeJobPage() in extension/background.js does the same job for
   * the service worker, which cannot call into this file — it must be a
   * self-contained function it can serialise into the page. The two selector
   * lists are intentionally not identical: this one also matches school /
   * university / essay markup for the college and scholarship application
   * types. Selector fixes usually need applying in both places.
   *
   * @returns {{ company: string, description: string }}
   */
  function scrapePageContext() {
    let company = '';
    const ogSite = document.querySelector('meta[property="og:site_name"]');
    if (ogSite?.content?.trim()) company = ogSite.content.trim();
    if (!company) {
      const selectors = [
        '[class*="company-name" i]',
        '[class*="companyName" i]',
        '[data-testid*="company" i]',
        '.jobs-unified-top-card__company-name',
        '[class*="employer" i]',
        '[class*="organization" i]',
        '[class*="school" i]',
        '[class*="university" i]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.innerText?.trim()) {
          company = el.innerText.trim();
          break;
        }
      }
    }
    if (!company) {
      const parts = (document.title || '').split(/\s*[\|\-—]\s*|\s+at\s+/i);
      if (parts.length > 1) company = parts[parts.length - 1].trim();
    }

    const descSelectors = [
      '[class*="job-description" i]',
      '[class*="description" i]',
      '[class*="personal-statement" i]',
      '[class*="essay" i]',
      '#job-details',
      'article',
      'main',
    ];
    let description = '';
    let bestLen = 0;
    for (const sel of descSelectors) {
      const el = document.querySelector(sel);
      const text = (el?.innerText || '').trim();
      if (text.length > bestLen) {
        bestLen = text.length;
        description = text;
      }
    }
    description = (description || document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
    return { company, description };
  }

  // ── Detect autofill sections on the current page ──────────────────────────
  /**
   * Guess which parts of an application form this page contains, so the popup
   * can show only the relevant "what to fill" toggles.
   *
   * Cheap heuristic: concatenate every field signature on the page into one
   * string and keyword-match it. Each flag is a keyword hit, not proof a
   * matching field exists — a page mentioning "company" in an unrelated input
   * will set workExperience.
   *
   * @returns {{ personalInfo: boolean, education: boolean, workExperience: boolean,
   *             openEnded: boolean, coverLetter: boolean }}
   */
  function detectFormSections() {
    const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
    const sigs = inputs.map((el) => fieldSignature(el)).join(' ');
    const has = (words) => words.some((w) => sigs.includes(w));
    return {
      personalInfo: has(['first name', 'lastname', 'email', 'phone', 'address', 'city', 'postal']),
      education: has(['school', 'university', 'degree', 'gpa', 'graduation', 'major']),
      workExperience: has(['employer', 'company', 'job title', 'experience', 'work history']),
      openEnded: has(['why do you', 'tell us', 'describe', 'additional', 'question']),
      coverLetter: has(['cover letter', 'coverletter', 'personal statement', 'statement of purpose', 'motivation', 'essay']),
    };
  }

  // ── Fill cover letter / essay textarea ────────────────────────────────────
  /**
   * Drop generated long-form text into the page's cover letter / personal
   * statement / essay field, and focus it.
   *
   * Two passes: first any visible textarea or text input whose signature
   * matches a cover-letter keyword, then — if none matched — the largest
   * empty visible textarea by row count. Unlike autofill(), the keyword pass
   * will overwrite a field that already has content.
   *
   * @param {string} text
   * @returns {boolean} False when the text was blank or no field was found.
   */
  function fillCoverLetter(text) {
    if (!text?.trim()) return false;
    const candidates = Array.from(document.querySelectorAll('textarea, input[type="text"]'));
    const keywords = [
      'cover letter',
      'coverletter',
      'personal statement',
      'statement of purpose',
      'motivation',
      'essay',
      'additional information',
      'supporting document',
    ];
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const sig = fieldSignature(el);
      if (keywords.some((kw) => sig.includes(kw))) {
        setNativeValue(el, text);
        el.focus?.();
        return true;
      }
    }
    // Fallback: largest empty textarea
    let best = null;
    let bestRows = 0;
    for (const el of candidates) {
      if (el.tagName !== 'TEXTAREA' || !isVisible(el)) continue;
      if ((el.value || '').trim()) continue;
      const rows = el.rows || 0;
      if (rows >= bestRows) {
        bestRows = rows;
        best = el;
      }
    }
    if (best) {
      setNativeValue(best, text);
      best.focus?.();
      return true;
    }
    return false;
  }

  // ── Message listener ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(function onextapListener(msg, _sender, sendResponse) {
    if (!msg?.action) return false;

    if (msg.action === 'AUTOFILL_TRIGGERED') {
      try {
        const count = autofill(msg.profile);
        log.debug('autofill complete', { filled: count });
        sendResponse({ success: true, filled: count });
      } catch (err) {
        log.error('autofill failed', err);
        sendResponse({ success: false, error: err.message });
      }
      return false;
    }

    if (msg.action === 'SCRAPE_CONTEXT') {
      try {
        sendResponse({ success: true, context: scrapePageContext() });
      } catch (err) {
        log.error('page context scrape failed', err);
        sendResponse({ success: false, error: err.message });
      }
      return false;
    }

    if (msg.action === 'DETECT_SECTIONS') {
      try {
        sendResponse({ success: true, sections: detectFormSections() });
      } catch (err) {
        log.error('form section detection failed', err);
        sendResponse({ success: false, error: err.message });
      }
      return false;
    }

    if (msg.action === 'FILL_COVER_LETTER') {
      try {
        const ok = fillCoverLetter(msg.text || '');
        sendResponse({ success: ok });
      } catch (err) {
        log.error('cover letter fill failed', err);
        sendResponse({ success: false, error: err.message });
      }
      return false;
    }

    return false;
  });

} // end of duplicate-injection guard
