import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { app } from '../mocks/electron';
import * as conversations from '../../src/main/conversations';

const dir = path.join(app.getPath('userData'), 'puck-convos');
const file = (agentId: string): string => path.join(dir, `${agentId}.json`);
const empty = { v: 1, log: [], lastTurnTokens: 0, lastActiveAt: 0, turns: 0 };

describe('conversations', () => {
  it('writes one JSON file per agent', async () => {
    await conversations.save('agent-a', empty);
    expect(JSON.parse(fs.readFileSync(file('agent-a'), 'utf8'))).toMatchObject({ v: 1, turns: 0 });
  });

  it('enforces the size ceiling', async () => {
    const big = { kind: 'user' as const, text: 'x'.repeat(9_000_000), author: 'u', ts: 1 };
    await expect(conversations.save('agent-big', { ...empty, log: [big] })).rejects.toThrow(
      /too large/,
    );
    expect(fs.existsSync(file('agent-big'))).toBe(false);
  });

  it('normalizes legacy shapes on load and skips log-less snapshots', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file('agent-old'), JSON.stringify({ log: [], usage: 42, lastActiveAt: 7, turns: 3 }));
    fs.writeFileSync(file('agent-html'), JSON.stringify({ html: '<ol></ol>', usage: 1 }));
    const all = conversations.loadAll();
    expect(all['agent-old']).toEqual({ v: 1, log: [], lastTurnTokens: 42, lastActiveAt: 7, turns: 3 });
    expect(all['agent-html']).toBeUndefined();
    expect(all['agent-a']).toMatchObject({ v: 1 });
  });
});
