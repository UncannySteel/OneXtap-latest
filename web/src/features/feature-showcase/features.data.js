/* The content of the feature tabs. Edit copy here.
   Each card: icon (key in icons.js), t (title), b (body), m (meta line),
   notes (two short spec lines), and optional demo ('form' | 'map' | 'draft'
   | 'chips' | 'vault') for the mini window drawn in cards.js. */

/* Six tints, cycled by card index, so no two icons in one feature's set
   share a colour. Values are var() references — the palette itself lives
   in :root (src/shared/styles/tokens.css) with the rest of the colours. */
export var TONES = [
  ['var(--i1)', 'var(--i1bg)'], ['var(--i2)', 'var(--i2bg)'], ['var(--i3)', 'var(--i3bg)'],
  ['var(--i4)', 'var(--i4bg)'], ['var(--i5)', 'var(--i5bg)'], ['var(--i6)', 'var(--i6bg)']
];

export var FEATURES = [
  { key: 'autofill', cards: null,   // the default set is the markup itself (feature-showcase.html)
    desc: 'Your profile, filled into any application form — every field, on every board, in one tap.' },

  { key: 'mapping',
    desc: 'Fields are matched to your profile by their labels. One it does not know waits for you, until you name it once.',
    cards: [
      { icon: 'search', t: 'An odd field appears', m: 'no match: visa_status',
        b: 'A form asks for something your profile does not cover. Onextap leaves it empty rather than make something up.',
        notes: ['Left for you to fill', 'What you typed stays put'] },
      { icon: 'link', t: 'Name it once', m: 'custom field: Visa status', demo: 'map',
        b: 'Add it to your profile as a custom field, named the way the form prints it, with your answer.',
        notes: ['Set up on the dashboard', 'Named as forms label it'] },
      { icon: 'db', t: 'It fills from then on', m: 'matched by label · any board',
        b: 'Any later form whose field carries that label gets your answer, whichever board is asking.',
        notes: ['Stored with your profile', 'Works on boards you have not seen'] },
      { icon: 'check', t: 'No repeat work', m: 'set once',
        b: 'Each custom field you add is one less box to type, so the next application asks less of you.',
        notes: ['One entry per question', 'Edit or remove it any time'] }
    ] },

  { key: 'answers',
    desc: 'Written answers drafted from the posting in front of you and the answers you have already given.',
    cards: [
      { icon: 'scan', t: 'It reads the posting', m: 'job post + your profile',
        b: 'The job description goes in alongside your profile, so the draft is about this role.',
        notes: ['Job text plus your profile', 'Per posting, not a template'] },
      { icon: 'spark', t: 'You get a draft', m: 'unlimited on premium', demo: 'draft',
        b: 'Written from answers you have already given, in the words you already used.',
        notes: ['Built from your own answers', 'Unlimited on Premium'] },
      { icon: 'pen', t: 'You have the last word', m: 'edit · then fill',
        b: 'Every answer stays editable before it is saved or submitted. Nothing goes out unread.',
        notes: ['Editable before it is saved', 'Nothing submits unread'] },
      { icon: 'zap', t: 'Straight into the form', m: 'no copy-paste',
        b: 'The answer you approved fills the field it was written for, without a round trip.',
        notes: ['Fills the field it was written for', 'No copy-paste step'] }
    ] },

  { key: 'profiles',
    desc: 'One profile per direction you are applying in, each with its own details and saved answers.',
    cards: [
      { icon: 'layers', t: 'One per direction', m: 'design · engineering · lead', demo: 'chips',
        b: 'A separate profile for each kind of role, with its own details and its own saved answers.',
        notes: ['Own details and answers', 'As many as you need'] },
      { icon: 'toggle', t: 'Switch per application', m: 'switch · then autofill',
        b: 'Pick the profile before you fill. Nothing else about the flow changes.',
        notes: ['Pick before you fill', 'Rest of the flow unchanged'] },
      { icon: 'shield', t: 'Answers stay separate', m: 'no cross-fill',
        b: 'An answer written for design work never turns up in an engineering application.',
        notes: ['No cross-profile fill', 'Each keeps its own answers'] },
      { icon: 'user', t: 'One career, told twice', m: 'many profiles · one you',
        b: 'The same history, ordered the way each kind of role actually needs to read it.',
        notes: ['Same history, different order', 'One profile per direction'] }
    ] },

  { key: 'storage',
    desc: 'Your profile stays in your browser. What leaves it goes only when you ask, and the line is written down.',
    cards: [
      { icon: 'lock', t: 'It lives in your browser', m: 'chrome.storage.local', demo: 'vault',
        b: 'Your profile, answers and letters are kept in the browser’s own storage, never on our servers.',
        notes: ['Kept on this device', 'Never written to our servers'] },
      { icon: 'db', t: 'Your account is small', m: 'sign-in · plan · credits',
        b: 'The account holds your sign-in, your plan and your credits. Your profile is not in it.',
        notes: ['Sign-in, plan and credits', 'No profile data in it'] },
      { icon: 'spark', t: 'AI calls out when asked', m: 'drafts · resumes · matches',
        b: 'Drafting, reading a resume and ranking job matches send the text they need to our AI providers.',
        notes: ['Only the text each task needs', 'Only when you ask for it'] },
      { icon: 'shield', t: 'You can see the line', m: 'stated, not implied',
        b: 'What stays on the device and what leaves it is written down rather than left to inference.',
        notes: ['Written down, not implied', 'Set out in the privacy policy'] }
    ] },

  { key: 'letters',
    desc: 'Keep the letters you actually use, adapt them to the posting, and drop them into the form.',
    cards: [
      { icon: 'mail', t: 'Store your letters', m: 'saved in the extension',
        b: 'Keep the cover letters you actually send where you can reach them while applying.',
        notes: ['Kept in the extension', 'Reachable while applying'] },
      { icon: 'spark', t: 'Personalise per role', m: 'tailored per posting', demo: 'draft',
        b: 'The AI adapts a stored letter to the posting in front of you rather than starting over.',
        notes: ['Adapts a letter you saved', 'Keeps your own voice'] },
      { icon: 'copy', t: 'Fill it in one click', m: '1 click · no tab switch',
        b: 'Drop the finished letter into the form without leaving the application page.',
        notes: ['No tab switching', 'Lands in the form field'] },
      { icon: 'check', t: 'Keep the good one', m: 'reuse · refine',
        b: 'The letter that worked stays in the library, ready for the next role that looks like it.',
        notes: ['Stays in the library', 'Ready for the next role like it'] }
    ] }
];
