/**
 * Simple size-based log rotation.
 *
 * Call rotateIfNeeded(path) before opening a log stream.
 * If the file exceeds maxBytes, it shifts:
 *   server.log   -> server.log.1
 *   server.log.1 -> server.log.2
 *   ...beyond maxFiles -> deleted
 *
 * Then the caller opens a fresh server.log.
 */

import { statSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * Rotate a log file if it exceeds the size limit.
 * @param {string} logPath  - Absolute path to the log file
 * @param {object} [opts]
 * @param {number} [opts.maxBytes=5242880]  - Rotate when file exceeds this (default 5 MB)
 * @param {number} [opts.maxFiles=3]        - Keep this many rotated copies
 */
export function rotateIfNeeded(logPath, { maxBytes = 5 * 1024 * 1024, maxFiles = 3 } = {}) {
  // Ensure the directory exists
  mkdirSync(dirname(logPath), { recursive: true });

  if (!existsSync(logPath)) return;

  let size;
  try {
    size = statSync(logPath).size;
  } catch {
    return; // file disappeared between check and stat
  }

  if (size < maxBytes) return;

  // Delete the oldest rotated file
  const oldest = `${logPath}.${maxFiles}`;
  if (existsSync(oldest)) {
    unlinkSync(oldest);
  }

  // Shift existing rotated files up by one
  for (let i = maxFiles - 1; i >= 1; i--) {
    const from = `${logPath}.${i}`;
    const to = `${logPath}.${i + 1}`;
    if (existsSync(from)) {
      renameSync(from, to);
    }
  }

  // Rotate current -> .1
  renameSync(logPath, `${logPath}.1`);
}
