/**
 * Onextap Autofill Content Script
 *
 * Injected on demand via chrome.scripting.executeScript({ files: ['content.js'] }).
 * Plain classic browser script — no import/export, no bundler globals.
 *
 * Message contract:
 *   Receives: { action: "AUTOFILL_TRIGGERED", profile }
 *   Responds: { success: true, filled: <count> }  |  { success: false, error: <msg> }
 */

// ── Duplicate-injection guard ────────────────────────────────────────────────
// The popup may call executeScript more than once. We only register the listener
// the very first time this script lands in the page's isolated world.
if (!window.__onextapAutofillLoaded) {
  window.__onextapAutofillLoaded = true;

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
    return parts.join(' ').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  }

  // ── Intent list builder ────────────────────────────────────────────────────
  /**
   * Converts the profile object into an ordered array of fill intents.
   * ORDER MATTERS: more-specific intents must come before generic ones so
   * that the first keyword match wins correctly.
   *
   * Each intent: { keywords: string[], value: string }
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

    // Helper: find a URL by type
    const urlOf = (type) => {
      const entry = urls.find((u) => u && u.type === type);
      return entry ? entry.value || '' : '';
    };

    // Derive some composite values
    const fullName =
      [p.firstName, p.lastName].filter(Boolean).join(' ');
    const fullPhone =
      p.countryCode && p.phone ? `${p.countryCode}${p.phone}` : p.phone || '';
    const companyName =
      currentJob.company || (experience[0] && experience[0].company) || '';
    const jobTitle =
      currentJob.title || (experience[0] && experience[0].title) || '';
    const linkedInUrl = urlOf('LinkedIn');
    const githubUrl   = urlOf('GitHub');
    const portfolioUrl = urlOf('Portfolio');
    const skillsText = Array.isArray(p.skills) ? p.skills.join(', ') : '';

    // Raw intent list — specific entries before generic ones
    const raw = [
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
        keywords: ['email', 'e-mail', 'mail'],
        value: p.email,
      },
      {
        // Prefer full phone with country code for "phone" fields that include
        // the dialling code in the same box.
        keywords: ['phone number', 'phonenumber', 'mobile number', 'contact number', 'telephone number'],
        value: fullPhone || p.phone,
      },
      {
        keywords: ['phone', 'mobile', 'tel', 'telephone', 'cell'],
        value: p.phone,
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
        // address-level country — after postal/zip so "country code" doesn't
        // accidentally pick up postal code fields.
        keywords: ['country'],
        value: addr.country || p.country,
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
    const needle = target.toLowerCase().trim();
    const options = Array.from(selectEl.options);

    // Try exact value match first, then exact text, then substring matches
    const exactValue = options.find((o) => o.value.toLowerCase() === needle);
    if (exactValue) {
      selectEl.value = exactValue.value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    const exactText = options.find((o) => o.text.toLowerCase() === needle);
    if (exactText) {
      selectEl.value = exactText.value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    const partialText = options.find(
      (o) =>
        o.text.toLowerCase().includes(needle) ||
        needle.includes(o.text.toLowerCase().trim())
    );
    if (partialText) {
      selectEl.value = partialText.value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    return false;
  }

  // ── Input type guard ───────────────────────────────────────────────────────
  /**
   * Returns true for input types we are allowed to fill.
   * Skips password, hidden, file, submit, button, image, range, color, reset.
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
        console.warn('[Onextap] Error filling field:', fieldErr);
      }
    }

    return filled;
  }

  // ── Message listener ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(function onextapListener(msg, _sender, sendResponse) {
    if (msg && msg.action === 'AUTOFILL_TRIGGERED') {
      try {
        const count = autofill(msg.profile);
        sendResponse({ success: true, filled: count });
      } catch (err) {
        console.error('[Onextap] Autofill error:', err);
        sendResponse({ success: false, error: err.message });
      }
      // Synchronous response — return false (or nothing)
      return false;
    }
    // Message not for us; return false to signal we didn't handle it
    return false;
  });

} // end of duplicate-injection guard
