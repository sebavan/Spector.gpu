module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true
    }
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  env: {
    browser: true,
    es2022: true,
    node: true
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    // Required for spy pattern: `const self = this` in prototype patching callbacks
    '@typescript-eslint/no-this-alias': 'off',
    // Stored method references are untyped Function — unavoidable for WebGPU interception
    '@typescript-eslint/ban-types': 'off',
    // Some prototype patches need `arguments` for transparent forwarding
    'prefer-rest-params': 'off',
    // Empty catch blocks are intentional (best-effort cleanup)
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/']
};
