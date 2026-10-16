// ESLint flat config. Correctness only: @eslint/js recommended, the hooks
// rules, and no-console. No style rules; there is no formatter either.
//
// Globals follow the runtime each area actually runs in, so `no-undef` catches
// a name that does not exist there (a Node global in the popup, `window` in
// the service worker).

import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

const chrome = { chrome: 'readonly' };

export default [
  {
    ignores: [
      'dist*/**',
      '**/node_modules/**',
      'server/node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'release/**',
      // Agent worktrees live inside the main checkout; each lints itself.
      '.claude/**',
    ],
  },

  js.configs.recommended,

  {
    rules: {
      // CLAUDE.md rule 11: log through the surface's logger, which redacts.
      'no-console': 'error',
      // Two deliberate kinds of unused name: a key pulled out of a
      // destructure only to leave it out of the `...rest`, and an argument
      // that has to be declared, like Express's `next`, which marks an error
      // handler by arity. The second takes a leading underscore.
      'no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }],
    },
  },

  // Popup, website and the injected content script: a page, plus chrome.*
  // where the extension provides it (src/ modules guard for its absence).
  {
    files: ['src/**/*.{js,jsx}', 'web/**/*.js', 'public/**/*.js'],
    ignores: ['web/tests/**', 'web/*.config.js'],
    languageOptions: {
      globals: { ...globals.browser, ...chrome },
    },
  },

  // content.js is injected with executeScript({ files }), a classic script.
  {
    files: ['public/content.js'],
    languageOptions: { sourceType: 'script' },
  },

  // The popup's React.
  {
    files: ['src/**/*.jsx'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      // Every .jsx file imports React (the classic convention), so mark it
      // used by JSX as well as the variables JSX references.
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // The MV3 service worker.
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, ...chrome },
    },
  },

  // Node: the backend, the Vercel function, unit tests, scripts and configs.
  {
    files: [
      'server/**/*.js',
      'api/**/*.js',
      'test/**/*.{js,mjs}',
      'scripts/**/*.{js,mjs}',
      '*.config.js',
      'web/*.config.js',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Playwright: Node, with callbacks that run in the page.
  {
    files: ['web/tests/**/*.{js,mjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // Loggers and command-line tools print by design. public/content.js has an
  // inline logger; its own disable block covers just that.
  {
    files: [
      'server/logger.js',
      'src/logger.js',
      'extension/logger.js',
      'web/tests/probe-*.mjs',
      'web/tests/tour.mjs',
      'scripts/**',
    ],
    rules: { 'no-console': 'off' },
  },
];
