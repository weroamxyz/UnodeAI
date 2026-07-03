/*---------------------------------------------------------------------------------------------
 *  UnodeAi - publish the BUNDLED VSIX (GA release path)
 *  Builds the esbuild-bundled VSIX (single extension.js + ajv only — no hono / no heavy node_modules
 *  tree) via package:bundle, then `vsce publish --packagePath` that exact artifact. This is the
 *  commercial release route: ~560 files / ~1.3 MB instead of ~3,900 / ~5 MB, and the shipped manifest
 *  carries no vulnerable transitive deps. Pass extra vsce flags through (e.g. --pre-release).
 *--------------------------------------------------------------------------------------------*/
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const vsix = join(root, `roam-crew-${pkg.version}-bundled.vsix`);
const vsce = process.platform === 'win32'
  ? join(root, 'node_modules', '.bin', 'vsce.cmd')
  : join(root, 'node_modules', '.bin', 'vsce');

function run(command, args) {
  const needsCmd = process.platform === 'win32' && command.endsWith('.cmd');
  const result = needsCmd
    ? spawnSync('cmd.exe', ['/c', command, ...args], { cwd: root, stdio: 'inherit' })
    : spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

// 1) Build + package the bundled VSIX (package:bundle leaves it at repo root, staging cleaned up).
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'package:bundle']);
if (!existsSync(vsix)) {
  throw new Error(`Expected bundled VSIX not found: ${vsix}`);
}

// 2) Publish exactly that artifact (extra CLI args, e.g. --pre-release, pass through).
run(vsce, ['publish', '--packagePath', vsix, ...process.argv.slice(2)]);
console.log(`\nPublished bundled VSIX: ${vsix}`);
