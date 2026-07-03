/*---------------------------------------------------------------------------------------------
 *  UnodeAi - LIVE S5 keystone smoke launcher
 *  Drives test-e2e/suite/live-s5.etest.ts against the REAL weroam gateway inside a real VS Code
 *  instance, opened on a throwaway fixture workspace. Spends real tokens — run on demand only.
 *
 *  Key: read from <repo>/_roam_live_key.txt (gitignored via /_*.txt). Never printed, never committed.
 *  Run:  npm run compile:e2e && node scripts/live-s5-smoke.mjs   (or: npm run smoke:live-s5)
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();

const keyFile = join(root, '_roam_live_key.txt');
if (!existsSync(keyFile)) {
  throw new Error(`Live key file not found at ${keyFile}. Create it with your weroam ROAM_API_KEY (one line).`);
}
const apiKey = readFileSync(keyFile, 'utf8').trim();
if (!apiKey) {
  throw new Error(`${keyFile} is empty.`);
}

const testFile = resolve(root, 'out-e2e/suite/live-s5.etest.js');
if (!existsSync(testFile)) {
  throw new Error(`Compiled test not found at ${testFile}. Run "npm run compile:e2e" first.`);
}

// ── Throwaway fixture workspace: a minimal route registry whose `npm test` runs with no install. ──
const fixtureDir = join(tmpdir(), 'roam-s5-fixture');
rmSync(fixtureDir, { recursive: true, force: true });
mkdirSync(join(fixtureDir, 'src'), { recursive: true });
mkdirSync(join(fixtureDir, 'test'), { recursive: true });

writeFileSync(
  join(fixtureDir, 'package.json'),
  JSON.stringify({ name: 's5-fixture', version: '1.0.0', private: true, scripts: { test: 'node --test' } }, null, 2) + '\n'
);
writeFileSync(
  join(fixtureDir, 'src', 'app.js'),
  `// Minimal route registry (no live server) so \`npm test\` runs without any install.
const routes = {};
function addRoute(method, path, handler) {
  routes[\`\${method} \${path}\`] = handler;
}
addRoute('GET', '/health', () => ({ ok: true }));
module.exports = { routes, addRoute };
`
);
writeFileSync(
  join(fixtureDir, 'test', 'health.test.js'),
  `const test = require('node:test');
const assert = require('node:assert');
const { routes } = require('../src/app');
test('GET /health returns ok', () => {
  assert.ok(routes['GET /health'], 'health route registered');
  assert.deepStrictEqual(routes['GET /health'](), { ok: true });
});
`
);
// Optimistic mode needs no git, but init one so the run also exercises a realistic repo workspace.
spawnSync('git', ['init', '-q'], { cwd: fixtureDir });
spawnSync('git', ['config', 'user.email', 's5@example.com'], { cwd: fixtureDir });
spawnSync('git', ['config', 'user.name', 'S5 Fixture'], { cwd: fixtureDir });
spawnSync('git', ['add', '-A'], { cwd: fixtureDir });
spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: fixtureDir });

const smokeDir = join(tmpdir(), 'roam-s5-smoke');
rmSync(smokeDir, { recursive: true, force: true });
mkdirSync(smokeDir, { recursive: true });
const launchPath = join(smokeDir, 'launch-live-s5.cjs');
const testElectronModule = resolve(root, 'node_modules/@vscode/test-electron/out/index.js').replace(/\\/g, '\\\\');
const runnerPath = resolve(root, 'node_modules/@vscode/test-cli/out/runner.cjs');

const testOptions = {
  mochaOpts: { ui: 'bdd', timeout: 8 * 60 * 1000 },
  colorDefault: true,
  preload: [],
  files: [testFile],
};

writeFileSync(launchPath, `const { runTests, downloadAndUnzipVSCode } = require('${testElectronModule}');
const { spawn } = require('node:child_process');
const path = require('node:path');

process.env.VSCODE_TEST_OPTIONS = ${JSON.stringify(JSON.stringify(testOptions))};

async function main() {
  const executable = await downloadAndUnzipVSCode({ version: 'stable' });
  const args = [
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    '--extensionTestsPath=' + ${JSON.stringify(runnerPath)},
    '--extensionDevelopmentPath=' + ${JSON.stringify(root)},
    '--extensions-dir=' + path.join(${JSON.stringify(smokeDir)}, 'extensions'),
    '--user-data-dir=' + path.join(${JSON.stringify(smokeDir)}, 'user-data'),
    ${JSON.stringify(fixtureDir)},
  ];
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.ELECTRON_NO_ATTACH_CONSOLE;
  childEnv.VSCODE_TEST_OPTIONS = process.env.VSCODE_TEST_OPTIONS;
  childEnv.NODE_PATH = ${JSON.stringify(resolve(root, 'node_modules'))};
  childEnv.ROAM_LIVE_SMOKE = '1';
  childEnv.ROAM_API_KEY = ${JSON.stringify(apiKey)};
  childEnv.ROAM_S5_FIXTURE = ${JSON.stringify(fixtureDir)};
  const child = spawn(executable, args, { env: childEnv, shell: false, stdio: 'inherit', windowsHide: true });
  child.on('exit', (code, signal) => {
    if (typeof code === 'number') { process.exit(code); }
    console.error('VS Code exited with signal', signal);
    process.exit(1);
  });
  child.on('error', (err) => { console.error(err && err.stack ? err.stack : err); process.exit(1); });
}

main().catch((err) => { console.error(err && err.stack ? err.stack : err); process.exit(1); });
`);

console.log(`[live-s5] fixture: ${fixtureDir}`);
console.log('[live-s5] launching VS Code against the live gateway (this spends real tokens)…');
const result = spawnSync(process.execPath, [launchPath], { cwd: root, stdio: 'inherit' });
console.log(`[live-s5] fixture left at ${fixtureDir} for inspection (src/app.js should now have /status).`);
process.exit(result.status ?? 1);
