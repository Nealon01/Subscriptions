/**
 * Dev launcher that captures ALL output (both Express + Vite) to dev.log
 * while still showing everything in the terminal.
 *
 * Usage: node scripts/dev-logged.js
 */

import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const logPath = join(ROOT, 'dev.log');
const logStream = createWriteStream(logPath, { flags: 'a' });

const ts = () => new Date().toISOString();

logStream.write(`\n${'='.repeat(60)}\n[${ts()}] === Dev session started ===\n${'='.repeat(60)}\n`);

const child = spawn(
  'npx concurrently --kill-others "npm run dev:server" "npm run dev:client"',
  [],
  { stdio: ['inherit', 'pipe', 'pipe'], shell: true, cwd: ROOT },
);

child.stdout.on('data', (data) => {
  const text = data.toString();
  process.stdout.write(data);
  for (const line of text.split('\n').filter(Boolean)) {
    logStream.write(`[${ts()}] ${line}\n`);
  }
});

child.stderr.on('data', (data) => {
  const text = data.toString();
  process.stderr.write(data);
  for (const line of text.split('\n').filter(Boolean)) {
    logStream.write(`[${ts()}] STDERR: ${line}\n`);
  }
});

child.on('close', (code) => {
  logStream.write(`[${ts()}] === Dev session ended (exit ${code}) ===\n`);
  logStream.end();
  process.exit(code ?? 0);
});

// Forward signals so the child shuts down cleanly
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
