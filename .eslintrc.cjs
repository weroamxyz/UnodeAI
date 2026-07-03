module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  env: {
    es2022: true,
    node: true,
  },
  plugins: ['@typescript-eslint'],
  ignorePatterns: ['out', 'node_modules', '.vscode-test', 'test-e2e', '*.vsix', 'vitest.config.ts'],
  rules: {
    'no-debugger': 'error',
    'no-var': 'error',
    'prefer-const': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
};
