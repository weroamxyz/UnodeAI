// @vscode/test-cli configuration for UnodeAi end-to-end tests (P1#7).
// Runs the compiled E2E suite inside a real VS Code instance.
//
// Usage:
//   npm i            # installs the e2e devDependencies (@vscode/test-cli, mocha, …)
//   npm run test:e2e # compiles test-e2e/ -> out-e2e/ and launches VS Code
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out-e2e/**/*.etest.js',
  version: 'stable',
  mocha: {
    ui: 'bdd',
    timeout: 60000,
  },
});
