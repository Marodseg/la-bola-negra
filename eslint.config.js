import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', '.wrangler/', 'worker/.wrangler/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  { files: ['web/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['worker/**/*.js'], languageOptions: { globals: globals.serviceworker } },
  { files: ['test/**/*.js', 'scripts/**/*.mjs', '*.config.js'], languageOptions: { globals: globals.node } },
];
