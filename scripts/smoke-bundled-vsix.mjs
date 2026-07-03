import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const vsix = join(tmpdir(), 'unodeai-vsix', `unodeai-${pkgVersion}-bundled.vsix`);
const smokeDir = join(tmpdir(), 'unodeai-smoke');
const launchPath = join(smokeDir, 'launch-smoke.cjs');
const nodeBin = process.execPath;
const testElectronModule = resolve(root, 'node_modules/@vscode/test-electron/out/index.js').replace(/\\/g, '\\\\');
const runnerSource = resolve(root, 'node_modules/@vscode/test-cli/out/runner.cjs');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

function collectIconPaths(pkg) {
  const paths = new Set();

  for (const command of pkg.contributes?.commands ?? []) {
    const icon = command.icon;
    if (typeof icon === 'string' && !icon.startsWith('$(')) {
      paths.add(icon);
    } else if (icon && typeof icon === 'object') {
      if (icon.light) {
        paths.add(icon.light);
      }
      if (icon.dark) {
        paths.add(icon.dark);
      }
    }
  }

  for (const viewGroup of Object.values(pkg.contributes?.views ?? {})) {
    for (const view of viewGroup ?? []) {
      if (typeof view.icon === 'string' && !view.icon.startsWith('$(')) {
        paths.add(view.icon);
      }
    }
  }

  return paths;
}

function assertPackagedIconsExist(extensionPath) {
  const pkg = JSON.parse(readFileSync(join(extensionPath, 'package.json'), 'utf8'));
  const missing = [];
  for (const iconPath of collectIconPaths(pkg)) {
    if (!existsSync(join(extensionPath, iconPath))) {
      missing.push(iconPath);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Bundled VSIX is missing contributed icon files: ${missing.join(', ')}`);
  }
}

/**
 * The Marketplace reads marketplace/{agents,mcp,skills}.json at runtime via extensionUri. If the
 * bundle script forgets to stage them, the panel ships empty — and the icon check wouldn't catch it.
 * Assert all three are present and parse, and that Agents + MCP are non-empty.
 */
function assertMarketplaceCatalogPresent(extensionPath) {
  for (const name of ['agents', 'mcp', 'skills']) {
    const file = join(extensionPath, 'marketplace', `${name}.json`);
    if (!existsSync(file)) {
      throw new Error(`Bundled VSIX is missing marketplace/${name}.json — the Marketplace would be empty.`);
    }
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`Bundled marketplace/${name}.json is not valid JSON: ${String(err)}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`Bundled marketplace/${name}.json must be a JSON array.`);
    }
    if ((name === 'agents' || name === 'mcp') && parsed.length === 0) {
      throw new Error(`Bundled marketplace/${name}.json is empty — expected curated entries.`);
    }
  }
}

try {
  if (!existsSync(vsix)) {
    throw new Error(`Bundled VSIX not found at ${vsix}. Run package:bundle first.`);
  }
  rmSync(smokeDir, { recursive: true, force: true });
  mkdirSync(smokeDir, { recursive: true });
  // A .vsix is a ZIP. Windows/macOS `tar` is bsdtar (auto-detects zip), but GNU `tar` on Linux can't
  // read a zip ("does not look like a tar archive"), so use `unzip` off Windows. (ubuntu/macOS have it.)
  if (process.platform === 'win32') {
    // Call the Windows bundled bsdtar by absolute path: a Git Bash / MSYS shell puts GNU tar first on
    // PATH, and GNU tar reads `C:\...` as a remote `host:path` ("Cannot connect to C: resolve failed").
    const sysTar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    run(existsSync(sysTar) ? sysTar : 'tar', ['-xf', vsix, '-C', smokeDir]);
  } else {
    run('unzip', ['-q', '-o', vsix, '-d', smokeDir]);
  }

  const extensionPath = resolve(smokeDir, 'extension');
  assertPackagedIconsExist(extensionPath);
  assertMarketplaceCatalogPresent(extensionPath);
  const testsFileCopy = join(smokeDir, 'extension.etest.js');
  copyFileSync(resolve(root, 'out-e2e/suite/extension.etest.js'), testsFileCopy);
  // Load the @vscode/test-cli runner from its REAL node_modules location (not a tmpdir copy): the runner
  // `require('mocha')`, and from the OS tmpdir that wouldn't resolve to the repo's node_modules → "Cannot
  // find module 'mocha'" (regression when smokeDir moved to tmpdir). NODE_PATH below covers the test file.
  const runnerPath = runnerSource;
  const testOptions = {
    mochaOpts: {
      ui: 'bdd',
      timeout: 60000,
      grep: 'normal turn entrypoint',
      invert: true,
    },
    colorDefault: true,
    preload: [],
    files: [resolve(testsFileCopy)],
  };
  writeFileSync(launchPath, `const { runTests } = require('${testElectronModule}');
const { downloadAndUnzipVSCode } = require('${testElectronModule}');
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
    '--extensionDevelopmentPath=' + ${JSON.stringify(extensionPath)},
    '--extensions-dir=' + path.join(${JSON.stringify(smokeDir)}, 'extensions'),
    '--user-data-dir=' + path.join(${JSON.stringify(smokeDir)}, 'user-data'),
  ];
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.ELECTRON_NO_ATTACH_CONSOLE;
  childEnv.VSCODE_TEST_OPTIONS = process.env.VSCODE_TEST_OPTIONS;
  // The runner + copied test file run from the OS tmpdir, which has no node_modules — make the repo's
  // node_modules resolvable so require('mocha') (and any test dep) is found.
  childEnv.NODE_PATH = ${JSON.stringify(resolve(root, 'node_modules'))};
  const child = spawn(executable, args, {
    env: childEnv,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });
  child.on('exit', (code, signal) => {
    if (typeof code === 'number') {
      process.exit(code);
    }
    console.error('VS Code exited with signal', signal);
    process.exit(1);
  });
  child.on('error', (err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
`);

  run(nodeBin, [launchPath]);
} finally {
  rmSync(smokeDir, { recursive: true, force: true });
}
