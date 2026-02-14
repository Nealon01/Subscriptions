/**
 * Kill any process listening on the configured PORT (default 3000).
 * Works on Windows (netstat + taskkill) and Unix (lsof + kill).
 */

import { execSync } from 'child_process';

const PORT = parseInt(process.env.PORT || '3000', 10);
const isWin = process.platform === 'win32';

function getListeningPids() {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano | findstr :${PORT} | findstr LISTENING`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Each line ends with a PID number
      const pids = new Set();
      for (const line of out.trim().split('\n')) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
      return [...pids];
    } else {
      const out = execSync(`lsof -ti :${PORT}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return out.trim().split('\n').filter(Boolean);
    }
  } catch {
    // No process found — command exits non-zero
    return [];
  }
}

const pids = getListeningPids();

if (pids.length === 0) {
  console.log(`[kill-port] Port ${PORT} is free.`);
} else {
  for (const pid of pids) {
    try {
      if (isWin) {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
      } else {
        execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
      }
      console.log(`[kill-port] Killed PID ${pid} on port ${PORT}.`);
    } catch {
      console.warn(`[kill-port] Could not kill PID ${pid} (may have already exited).`);
    }
  }
}
