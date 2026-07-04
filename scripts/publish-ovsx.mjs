/*---------------------------------------------------------------------------------------------
 *  UnodeAi - publish the BUNDLED VSIX to the Open VSX Registry (open-vsx.org)
 *
 *  Open VSX is the vendor-neutral registry that Cursor, Windsurf, VSCodium, and Gitpod install from.
 *  It is independent of the Microsoft Marketplace. This script builds the same esbuild-bundled VSIX
 *  used for the MS Marketplace (via package:bundle), then publishes THAT exact artifact with `ovsx`.
 *
 *  Prerequisites (one-time):
 *    1. Create an Open VSX account: sign in at https://open-vsx.org with GitHub, then complete the
 *       Eclipse Foundation publisher agreement (open-vsx.org → your avatar → "Publisher Agreement").
 *    2. Generate an access token: open-vsx.org → Settings → Access Tokens → "Generate New Token".
 *    3. Claim the `unode` namespace once (this script does it for you, best-effort — or run:
 *         npx ovsx create-namespace unode -p <token>
 *
 *  Usage:
 *    OVSX_PAT=<your-token> npm run publish:ovsx            (POSIX)
 *    $env:OVSX_PAT="<your-token>"; npm run publish:ovsx    (PowerShell)
 *
 *  Extra ovsx flags pass through, e.g.:  npm run publish:ovsx -- --pre-release
 *--------------------------------------------------------------------------------------------*/
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const namespace = pkg.publisher; // must match the Open VSX namespace (e.g. "unode")
const vsix = join(root, `unodeai-${pkg.version}-bundled.vsix`);
const ovsx = process.platform === 'win32'
  ? join(root, 'node_modules', '.bin', 'ovsx.cmd')
  : join(root, 'node_modules', '.bin', 'ovsx');

// Token resolution, most-convenient first:
//   1. OVSX_PAT environment variable, OR
//   2. a gitignored `.ovsx-pat` file at the repo root containing just the token.
// The file avoids all shell-session/`setx` friction: write it once, publishing just works.
const TOKEN_PLACEHOLDER = 'PASTE_YOUR_OPEN_VSX_TOKEN_HERE';
function readToken() {
  if (process.env.OVSX_PAT && process.env.OVSX_PAT.trim()) { return process.env.OVSX_PAT.trim(); }
  const file = join(root, '.ovsx-pat');
  if (existsSync(file)) {
    const fromFile = readFileSync(file, 'utf8').trim();
    if (fromFile && fromFile !== TOKEN_PLACEHOLDER) { return fromFile; }
    if (fromFile === TOKEN_PLACEHOLDER) {
      console.error('The .ovsx-pat file still contains the placeholder. Open it, replace it with your real');
      console.error('Open VSX token (open-vsx.org → Settings → Access Tokens), save, and re-run.');
      process.exit(1);
    }
  }
  return '';
}

const token = readToken();
if (!token) {
  console.error('ERROR: no Open VSX access token found (open-vsx.org → Settings → Access Tokens).');
  console.error('Provide it either way:');
  console.error('  A) A file (easiest — no shell env needed): create `.ovsx-pat` in the repo root with just the token, then re-run.');
  console.error('     PowerShell:  Set-Content -NoNewline .ovsx-pat "ovsxp_your_token"');
  console.error('  B) An env var IN THE SAME shell, on one line:');
  console.error('     PowerShell:  $env:OVSX_PAT="ovsxp_your_token"; npm run publish:ovsx');
  console.error('The `.ovsx-pat` file is gitignored (.ovsx*), so it can never be committed.');
  process.exit(1);
}

function run(command, args, { allowFail = false } = {}) {
  const needsCmd = process.platform === 'win32' && command.endsWith('.cmd');
  const result = needsCmd
    ? spawnSync('cmd.exe', ['/c', command, ...args], { cwd: root, stdio: 'inherit' })
    : spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
  }
  return result.status ?? 0;
}

// 1) Build + package the bundled VSIX (package:bundle leaves it at repo root).
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'package:bundle']);
if (!existsSync(vsix)) {
  throw new Error(`Expected bundled VSIX not found: ${vsix}`);
}

// 2) Ensure the namespace exists (idempotent — a re-run just reports it already exists; don't fail).
console.log(`\nEnsuring Open VSX namespace "${namespace}" exists…`);
run(ovsx, ['create-namespace', namespace, '-p', token], { allowFail: true });

// 3) Publish exactly that artifact (extra CLI args, e.g. --pre-release, pass through).
run(ovsx, ['publish', vsix, '-p', token, ...process.argv.slice(2)]);
console.log(`\nPublished to Open VSX: ${namespace}.${pkg.name} v${pkg.version}`);
console.log(`  → https://open-vsx.org/extension/${namespace}/${pkg.name}`);
