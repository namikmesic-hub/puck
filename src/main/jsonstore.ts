/**
 * Crash-safe JSON persistence: atomic writes (tmp + rename) serialized per
 * file, so a quit mid-write can never truncate a store and concurrent saves
 * can't interleave.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const chains = new Map<string, Promise<void>>();

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Queue an atomic write of `value` to `file`; resolves when durable. */
export function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const prev = chains.get(file) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined) // one failed write must not poison the chain
    .then(async () => {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(value), 'utf8');
      await fs.promises.rename(tmp, file);
    });
  chains.set(file, next);
  return next;
}
