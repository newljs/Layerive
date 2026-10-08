import { rename } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

// Windows scanners may briefly hold a newly written directory open. Retry
// only transient sharing errors, never overwrite/copy around a failed move.
export async function renameWithRetry(source, target, { move = rename, wait = setTimeout, platform = process.platform } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { await move(source, target); return; }
    catch (error) {
      if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
      await wait(50 * 2 ** attempt);
    }
  }
}
