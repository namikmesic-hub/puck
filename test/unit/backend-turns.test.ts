import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnvLifecycle } from '../../src/harness/bridge';
import type { HarnessEvent } from '../../src/harness/types';
import type { TurnRequest } from '../../src/main/runner';

// The stale-resume retry state machine in backend.runTurn is the subtlest
// logic in main — and its failure mode (a resume silently becoming a fresh
// conversation, or vice versa) looks like success. Script the runner.

// Only what backend.ts reads from each module.
vi.mock('../../src/main/runner', () => ({
  turn: vi.fn(),
  interrupt: vi.fn(),
  answerAsk: vi.fn(),
}));
// The active environment's Puck lifecycle state — the chat gate reads this,
// never Docker liveness. Tests flip it to exercise the gate.
const envState = vi.hoisted(() => ({
  lifecycle: {
    status: 'ready',
    stage: null,
    detail: '',
    startedAt: 1_000,
    endedAt: 5_000,
    error: null,
  } as EnvLifecycle,
}));
vi.mock('../../src/main/environments', () => ({
  activeEnv: () => ({ id: 'env1', name: 'Test Env' }),
  lifecycle: async () => envState.lifecycle,
}));
const testAgent = {
  id: 'agent1',
  name: 'A',
  provider: 'claude-code',
  model: 'auto',
  systemPrompt: '',
  effort: 'auto',
  options: {},
  advanced: '',
};
vi.mock('../../src/main/agents', () => ({
  byId: (id: string) => (id === 'agent1' ? testAgent : null),
  active: () => null,
}));

import * as backend from '../../src/main/backend';
import * as runner from '../../src/main/runner';
import * as sessions from '../../src/main/session-registry';

type TurnCall = { req: TurnRequest; onSession: (id: string) => void };
let calls: TurnCall[];
/** Per-attempt scripts; each returns the events that attempt streams. */
let scripts: Array<(call: TurnCall) => HarnessEvent[]>;

beforeEach(() => {
  calls = [];
  scripts = [];
  envState.lifecycle = { status: 'ready', stage: null, detail: '', startedAt: 1_000, endedAt: 5_000, error: null };
  vi.mocked(runner.turn).mockImplementation(async function* (_envId, req, onSession) {
    const call = { req, onSession };
    calls.push(call);
    const script = scripts.shift();
    if (!script) throw new Error('no script for runner.turn attempt');
    yield* script(call);
  });
});

const END: HarnessEvent = { kind: 'turn-end', stats: { inputTokens: 0, outputTokens: 0, durationMs: 0 } };

async function run(turnId = 't1', prompt = 'hello'): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const e of backend.runTurn(turnId, 'agent1', prompt)) out.push(e);
  return out;
}

describe('backend stale-resume retry', () => {
  it('fresh conversation: single attempt with resume null; session id persisted', async () => {
    sessions.forget('agent1', 'env1');
    scripts = [
      (call) => {
        call.onSession('sess-new');
        return [{ kind: 'text-delta', text: 'hi' }, END];
      },
    ];
    const events = await run();
    expect(events.map((e) => e.kind)).toEqual(['text-delta', 'turn-end']);
    expect(calls).toHaveLength(1);
    expect(calls[0].req.resume).toBeNull();
    expect(sessions.resumeIdFor('agent1', 'env1')).toBe('sess-new');
  });

  it('stale resume before content: silent fresh retry, old id dropped', async () => {
    sessions.remember('agent1', 'env1', 'dead-id');
    scripts = [
      () => [{ kind: 'error', message: 'No conversation found with session ID dead-id' }, END],
      (call) => {
        call.onSession('replacement');
        return [{ kind: 'text-delta', text: 'recovered' }, END];
      },
    ];
    const events = await run();
    // The stale error is swallowed; the user only sees the fresh attempt.
    expect(events.map((e) => e.kind)).toEqual(['text-delta', 'turn-end']);
    expect(calls.map((c) => c.req.resume)).toEqual(['dead-id', null]);
    // Distinct request ids so the two attempts can never cross-route.
    expect(calls[0].req.id).not.toBe(calls[1].req.id);
    expect(sessions.resumeIdFor('agent1', 'env1')).toBe('replacement');
  });

  it('stale-looking error AFTER content surfaces instead of retrying', async () => {
    sessions.remember('agent1', 'env1', 'live-id');
    scripts = [
      () => [
        { kind: 'text-delta', text: 'partial work' },
        { kind: 'error', message: 'thread live-id not found' },
        END,
      ],
    ];
    const events = await run();
    expect(events.map((e) => e.kind)).toEqual(['text-delta', 'error', 'turn-end']);
    expect(calls).toHaveLength(1); // no retry — this was a mid-work failure
  });

  it('an echoed attempted id is never re-persisted after being dropped', async () => {
    sessions.remember('agent1', 'env1', 'dead-id');
    scripts = [
      (call) => {
        call.onSession('dead-id'); // runner echoes the id we merely attempted
        return [{ kind: 'error', message: 'no rollout found' }, END];
      },
      (call) => {
        call.onSession('fresh-id');
        return [END];
      },
    ];
    await run();
    expect(sessions.resumeIdFor('agent1', 'env1')).toBe('fresh-id');
  });

  it('duplicate turn ids are refused up front', async () => {
    sessions.forget('agent1', 'env1');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(runner.turn).mockImplementation(async function* () {
      await gate;
      yield END;
    });
    const first = run('dup', 'x');
    await new Promise((r) => setTimeout(r, 0)); // let the first turn register
    const second = await run('dup', 'y');
    expect(second[0].kind).toBe('error');
    expect((second[0] as { message: string }).message).toMatch(/duplicate/i);
    release();
    await first;
  });
});

describe('backend chat gate (environment readiness)', () => {
  it('refuses a turn while the environment is starting, naming it and the stage', async () => {
    envState.lifecycle = {
      status: 'starting',
      stage: 'pulling-image',
      detail: 'abc: Downloading',
      startedAt: 1_000,
      endedAt: null,
      error: null,
    };
    const events = await run();
    expect(events.map((e) => e.kind)).toEqual(['error', 'turn-end']);
    const message = (events[0] as { message: string }).message;
    expect(message).toContain('"Test Env"');
    expect(message).toMatch(/starting/);
    expect(message).toMatch(/pulling image/);
    expect(calls).toHaveLength(0); // the runner is never asked
  });

  it('refuses a turn in a failed environment and carries the failure text', async () => {
    envState.lifecycle = {
      status: 'failed',
      stage: 'installing-sdks',
      detail: '',
      startedAt: 1_000,
      endedAt: 9_000,
      error: 'npm ERR! network timeout',
    };
    const events = await run();
    const message = (events[0] as { message: string }).message;
    expect(message).toMatch(/failed while installing provider SDKs/);
    expect(message).toContain('npm ERR! network timeout');
    expect(calls).toHaveLength(0);
  });

  it('a stopped environment is refused with the start hint (Docker liveness is not consulted)', async () => {
    envState.lifecycle = { status: 'stopped', stage: null, detail: '', startedAt: null, endedAt: null, error: null };
    const events = await run();
    expect((events[0] as { message: string }).message).toMatch(/is stopped\. Start it from Settings/);
  });

  it('status() reports the lifecycle and connects only when ready', async () => {
    envState.lifecycle = {
      status: 'starting',
      stage: 'installing-clis',
      detail: 'npm install',
      startedAt: 1_000,
      endedAt: null,
      error: null,
    };
    const s = await backend.status();
    expect(s.connected).toBe(false);
    expect(s.environment).toMatchObject({ id: 'env1', name: 'Test Env', status: 'starting', stage: 'installing-clis' });
  });
});
