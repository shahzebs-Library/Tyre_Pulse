import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import react from 'eslint-plugin-react'

/**
 * Minimal, deliberately narrow lint config.
 *
 * Its job is to catch the class of defect that a clean `vite build` and a green
 * test suite both miss: a variable that does not exist at runtime. That is a
 * ReferenceError, which in React unmounts the whole tree and renders a blank
 * page. Rules that are only about style are left off on purpose so this stays
 * fast and so a real error is never buried in noise.
 */
export default [
  {
    ignores: [
      'dist/**',
      'dev-dist/**',
      'coverage/**',
      'node_modules/**',
      'mobile/**',
      'marketing/**',
      'supabase/**',
      'services/**',
      'store-assets/**',
      'scripts/**',
      '**/*.min.js',
    ],
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        process: 'readonly',
        __APP_VERSION__: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { 'react-hooks': reactHooks, react },
    settings: { react: { version: 'detect' } },
    rules: {
      // The one that matters: a name used but never defined. This is the rule
      // that would have caught the ReferenceError that shipped past a clean
      // build and a green suite, rendering its page blank.
      'no-undef': 'error',
      // Core no-undef CANNOT see a JSX element name - <StudioBoundary> is a
      // JSXIdentifier node, which the base rule ignores. That exact gap shipped
      // "StudioBoundary is not defined" to /board-overview (ERR-W4RA0AXE) past
      // a clean build, a clean lint and a green suite. This is the JSX half of
      // the same ReferenceError class.
      'react/jsx-no-undef': 'error',
      // Counts a JSX reference as a use, which is what makes an unused-import
      // check possible at all (see the no-unused-vars note below).
      'react/jsx-uses-vars': 'error',
      // NOTE on `no-unused-vars`, which would catch an orphaned import (the
      // symptom of a half-finished refactor): it is OFF because the base rule
      // does not count a JSX reference as a use. Without eslint-plugin-react's
      // `react/jsx-uses-vars` it reports 6,736 hits here, nearly all false -
      // it flags Routes, Route and Suspense in App.jsx as unused. Turning it on
      // would bury the real errors. Add eslint-plugin-react first, then enable.
      //
      // Deliberately NOT checking variables here. A `const` declared at the
      // bottom of a module and read inside a component body or a click handler
      // is initialised long before anything reads it, and flagging those buries
      // the real errors under ~70 false positives. Function/class hoisting is
      // likewise fine.
      'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
      // These are always bugs, never intent.
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-unsafe-negation': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
      'no-self-assign': 'error',
      'valid-typeof': 'error',
      // A stale closure over missing deps is the second most common source of a
      // screen that renders the wrong thing until you refresh it.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/test/**/*.{js,jsx}', '**/*.test.{js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        vi: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
]
