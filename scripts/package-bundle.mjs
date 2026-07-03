import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const staging = join(root, '.bundle-package');
const bundleOutDir = join(tmpdir(), 'roam-crew-vsix');
const nodeModules = join(root, 'node_modules');
const vsce = process.platform === 'win32'
  ? join(root, 'node_modules', '.bin', 'vsce.cmd')
  : join(root, 'node_modules', '.bin', 'vsce');

function run(command, args, cwd = root) {
  // Windows .cmd shims must run through cmd.exe. Invoke it explicitly with shell:false so Node
  // escapes argv itself — passing an args array with shell:true triggers DEP0190 (unescaped concat).
  const needsCmd = process.platform === 'win32' && command.endsWith('.cmd');
  const result = needsCmd
    ? spawnSync('cmd.exe', ['/c', command, ...args], { cwd, stdio: 'inherit' })
    : spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

function copyFile(relativePath) {
  const from = join(root, relativePath);
  const to = join(staging, relativePath);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}

function copyDir(from, to) {
  if (existsSync(from)) {
    cpSync(from, to, { recursive: true });
  }
}

if (!existsSync(vsce)) {
  throw new Error('vsce is not installed. Run npm install first.');
}

try {
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(bundleOutDir, { recursive: true });
  mkdirSync(staging, { recursive: true });

  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:bundle']);

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  pkg.scripts = {};
  pkg.dependencies = {
    ajv: pkg.dependencies?.ajv ?? '^8.20.0',
    'ajv-formats': pkg.dependencies?.['ajv-formats'] ?? '^3.0.1',
  };
  writeFileSync(join(staging, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

  for (const file of [
    'README.md',
    'USAGE.md',
    'CHANGELOG.md',
    'LICENSE',
    'out/extension.js',
    'out/extension.js.map',
  ]) {
    copyFile(file);
  }
  // Copy the whole images/ dir (icons referenced by package.json) so a newly-added asset can't be
  // silently dropped from the bundle — which is exactly what hid the Solo toolbar icons.
  copyDir(join(root, 'images'), join(staging, 'images'));
  // Copy the marketplace catalog (read at runtime via extensionUri/marketplace/*.json). Without
  // this the bundled VSIX ships an empty Marketplace — and the smoke test wouldn't catch it.
  copyDir(join(root, 'marketplace'), join(staging, 'marketplace'));

  for (const name of [
  'ajv',
  'ajv-formats',
  'fast-deep-equal',
  'fast-uri',
  'json-schema-traverse',
  'require-from-string',
]) {
    copyDir(join(nodeModules, name), join(staging, 'node_modules', name));
  }

  const bundleOutPath = join(bundleOutDir, `roam-crew-${pkg.version}-bundled.vsix`);
  run(vsce, ['package', '--out', bundleOutPath], staging);
  cpSync(bundleOutPath, join(root, `roam-crew-${pkg.version}-bundled.vsix`));
} finally {
  rmSync(staging, { recursive: true, force: true });
}
