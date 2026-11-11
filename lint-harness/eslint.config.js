// Correctness lint only: no formatting rules. Run from the repository root
// with `npm run lint`; the dependencies live in this harness, like the
// frontend test harness, so application lockfiles are untouched.
import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

const shared = {
  ...js.configs.recommended.rules,
  'no-empty': ['error', { allowEmptyCatch: true }],
  // Input validation rejects control characters on purpose.
  'no-control-regex': 'off',
  'no-useless-escape': 'off',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
}

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/output/**'] },
  {
    files: ['backend/src/**/*.js', 'backend/scripts/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
    rules: shared,
  },
  {
    // Cleanup failures deliberately replace the primary error with an aggregate.
    files: ['backend/src/security/tenantLeaseExecutor.js', 'backend/src/security/tenantPoolManager.js', 'backend/src/security/tenantResolver.js'],
    rules: { 'no-unsafe-finally': 'off', 'no-ex-assign': 'off' },
  },
  { files: ['backend/scripts/benchmark*.js'], rules: { 'no-empty': 'off' } },
  {
    files: ['frontend/src/**/*.{js,jsx}'],
    ignores: ['frontend/src/**/*.test.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest', sourceType: 'module',
      // The rehearsal flag is a Vite `define` in vite.catalog-controlled.config.js.
      globals: { ...globals.browser, __GCNI_CONTROLLED_REHEARSAL__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...shared,
      'react/jsx-uses-vars': 'error',
      'react/jsx-no-undef': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]
