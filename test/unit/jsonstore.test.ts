import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { flushWrites, readJson, writeJsonAtomic } from '../../src/main/jsonstore';

describe('jsonstore', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puck-jsonstore-'));

  it('round-trips values and creates parent dirs', async () => {
    const file = path.join(dir, 'nested', 'a.json');
    await writeJsonAtomic(file, { x: 1 });
    expect(readJson(file)).toEqual({ x: 1 });
  });

  it('returns null on garbage or missing files', () => {
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, '{truncated');
    expect(readJson(file)).toBeNull();
    expect(readJson(path.join(dir, 'missing.json'))).toBeNull();
  });

  it('serializes concurrent writes — last queued wins, no interleaving', async () => {
    const file = path.join(dir, 'chain.json');
    await Promise.all([
      writeJsonAtomic(file, { seq: 1 }),
      writeJsonAtomic(file, { seq: 2 }),
      writeJsonAtomic(file, { seq: 3 }),
    ]);
    expect(readJson(file)).toEqual({ seq: 3 });
  });

  it('leaves no temp files behind', async () => {
    const file = path.join(dir, 'clean.json');
    await writeJsonAtomic(file, [1, 2, 3]);
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  // The quit drain: fire-and-forget writes still pending at quit must land.
  describe('flushWrites', () => {
    it('resolves once every queued write landed, including ones queued meanwhile', async () => {
      const first = path.join(dir, 'flush-a.json');
      const late = path.join(dir, 'flush-b.json');
      void writeJsonAtomic(first, { seq: 1 });
      void writeJsonAtomic(first, { seq: 2 });
      const flushing = flushWrites();
      void writeJsonAtomic(late, { late: true }); // queued after the flush started
      await flushing;
      expect(readJson(first)).toEqual({ seq: 2 });
      expect(readJson(late)).toEqual({ late: true });
    });

    it('is a no-op with nothing pending', async () => {
      await expect(flushWrites()).resolves.toBeUndefined();
    });

    it('is not wedged by a failed write', async () => {
      const blocker = path.join(dir, 'not-a-dir.json');
      fs.writeFileSync(blocker, '{}');
      void writeJsonAtomic(path.join(blocker, 'child.json'), { x: 1 }); // mkdir under a file fails
      await expect(flushWrites()).resolves.toBeUndefined();
    });
  });
});
