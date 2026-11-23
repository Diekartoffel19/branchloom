import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_PROJECT_README_BYTES = 12_000;
const unavailable = 'README.md unavailable or above the 12 KB limit.';

/** The only local project file sent to read-only planning conversations. */
export function readProjectReadmeContext(projectPath: string): string {
  try {
    const root = realpathSync(projectPath);
    const file = join(root, 'README.md');
    const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(descriptor);
      const path = lstatSync(file);
      if (!opened.isFile() || !path.isFile() || path.isSymbolicLink()
        || opened.dev !== path.dev || opened.ino !== path.ino || opened.size > MAX_PROJECT_README_BYTES) {
        return unavailable;
      }
      // Bound the bytes actually read too; the file can grow after fstat.
      const bytes = Buffer.alloc(MAX_PROJECT_README_BYTES + 1);
      let used = 0;
      while (used < bytes.length) {
        const length = readSync(descriptor, bytes, used, bytes.length - used, null);
        if (length === 0) break;
        used += length;
      }
      if (used > MAX_PROJECT_README_BYTES) return unavailable;
      return `README.md (local file supplied by Branchloom, ${used} bytes):\n${bytes.subarray(0, used).toString('utf8')}`;
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return unavailable;
  }
}
