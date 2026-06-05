/* ESLint 8.57 loads this legacy config by default (flat config is opt-in on v8). It makes the
 * advertised `npm run lint` a REAL gate instead of a hard "no config" error. The noisiest stylistic
 * rules are downgraded to warnings so the first pass on ~24k LOC is actionable, not a wall. */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { browser: true, es2022: true, worker: true },
  ignorePatterns: ['dist', 'node_modules', 'public', 'scripts/.verify-campaign.mjs', '*.cjs', '*.js'],
  rules: {
    // TypeScript already resolves identifiers; no-undef false-positives on DOM/WebGL globals.
    'no-undef': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/ban-ts-comment': 'warn',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-constant-condition': ['warn', { checkLoops: false }],
  },
};
