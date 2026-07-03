/*---------------------------------------------------------------------------------------------
 *  UnodeAi - processTree
 *  Kill a spawned command AND its descendants. We spawn verify/run_checks commands with `shell:true`,
 *  so on Windows the child is `cmd.exe`; `child.kill()` terminates the shell but leaves the actual
 *  runner (npm/node/pytest) alive — a watch-mode or input-waiting command then orphans on a timeout.
 *  `taskkill /T /F` kills the whole tree. On POSIX, SIGKILL of the shell child is sufficient for the
 *  simple commands we run. Best-effort; never throws. (Audit N2/N9.)
 *--------------------------------------------------------------------------------------------*/

import { spawn, ChildProcess } from 'child_process';

export function killProcessTree(proc: ChildProcess): void {
  const pid = proc.pid;
  if (process.platform === 'win32' && pid !== undefined) {
    try {
      // /T = tree (kill children too), /F = force. Detached + ignore so it can't block or throw here.
      spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
      return;
    } catch {
      /* fall through to a plain kill */
    }
  }
  try {
    proc.kill('SIGKILL');
  } catch {
    /* best effort */
  }
}
