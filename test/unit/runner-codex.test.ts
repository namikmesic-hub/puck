import { createRequire } from 'node:module';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HarnessEvent } from '../../src/harness/types';
import collabTurn from '../fixtures/codex-collab-events.json';

// runner.js is the CommonJS agent deployed into containers. Required as a
// module (not run as the main script) it exports its provider bodies and
// never touches stdio, so the Codex turn body runs here against a scripted
// SDK: the exec event stream in, HarnessEvents out.
const requireCjs = createRequire(path.join(process.cwd(), 'package.json'));
const runner = requireCjs('./src/main/runner/runner.js') as {
  runCodex(req: unknown, sdk: unknown, ctx: unknown): Promise<void>;
};

type Collab = {
  id: string;
  type: 'collab_tool_call';
  tool: string;
  sender_thread_id: string;
  receiver_thread_ids: string[];
  prompt: string | null;
  agents_states: Record<string, { status: string; message: string | null }>;
  status: 'in_progress' | 'completed' | 'failed';
  model?: string;
};

function collab(over: Partial<Collab> & { id: string; tool: string }): Collab {
  return {
    type: 'collab_tool_call',
    sender_thread_id: 'thread-parent',
    receiver_thread_ids: [],
    prompt: null,
    agents_states: {},
    status: 'in_progress',
    ...over,
  };
}
const started = (item: Collab) => ({ type: 'item.started', item });
const completed = (item: Collab) => ({ type: 'item.completed', item });

/** A Codex SDK stand-in whose one thread streams the given exec events. */
function scriptedSdk(events: unknown[]) {
  const thread = {
    id: 'thread-parent',
    runStreamed: async () => ({
      events: (async function* () {
        for (const ev of events) yield ev;
      })(),
    }),
  };
  return {
    Codex: class {
      startThread() {
        return thread;
      }
      resumeThread() {
        return thread;
      }
    },
  };
}

async function drive(events: unknown[]): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  const ctx = {
    emit: (event: HarnessEvent) => out.push(event),
    thinkingOn: () => undefined,
    thinkingOff: () => undefined,
    session: () => undefined,
    setSession: () => undefined,
    sessionId: () => null,
    endTurn: (stats: HarnessEvent extends { kind: 'turn-end'; stats: infer S } ? S : never) =>
      out.push({ kind: 'turn-end', stats }),
    onInterrupt: () => undefined,
    askUser: async () => null,
    cancelAsks: () => undefined,
  };
  const req = {
    id: 't1',
    provider: 'codex',
    model: 'auto',
    systemPrompt: '',
    thinking: 'auto',
    settings: '{}',
    advanced: '',
    resume: null,
    prompt: 'hi',
  };
  await runner.runCodex(req, scriptedSdk(events), ctx);
  return out;
}

const of = <K extends HarnessEvent['kind']>(events: HarnessEvent[], kind: K) =>
  events.filter((e): e is Extract<HarnessEvent, { kind: K }> => e.kind === kind);

describe('Codex sub-agents from collab_tool_call items', () => {
  it('renders the captured spawn/send/wait/close turn as one nested Agent card', async () => {
    const events = await drive(collabTurn);

    // spawn_agent → the same card event the Claude sub-agent path emits.
    const starts = of(events, 'tool-start');
    expect(starts).toEqual([
      {
        kind: 'tool-start',
        toolId: 'item_0',
        tool: 'Agent',
        summary: 'draft a plan',
        input: 'draft a plan',
        agent: true,
      },
    ]); // no raw cards for send_input / wait / close_agent

    // Lifecycle text lands inside the child card (parentId = the spawn item).
    const child = of(events, 'text-delta').filter((e) => e.parentId === 'item_0').map((e) => e.text);
    expect(child[0]).toContain('thread-child');
    expect(child[0]).toContain('running');
    expect(child[1]).toContain('Follow-up input from the parent agent');
    expect(child[1]).toContain('> keep it under one page');
    expect(child[2]).toBe('Status: running.\n\n'); // the first wait timed out
    expect(child[3]).toBe('Finished: completed - Plan drafted in PLAN.md.\n\n');
    expect(child).toHaveLength(4); // close_agent after completion adds nothing

    // Exactly one tool-end, at the terminal wait — not at the later close.
    const ends = of(events, 'tool-end');
    expect(ends).toEqual([
      { kind: 'tool-end', toolId: 'item_0', ok: true, output: 'completed - Plan drafted in PLAN.md' },
    ]);
    const order = events.map((e) => e.kind);
    expect(order.indexOf('tool-end')).toBeGreaterThan(order.indexOf('tool-start'));

    // The parent's own reply and the turn end still flow as before.
    const parentText = of(events, 'text-delta').filter((e) => !e.parentId);
    expect(parentText.map((e) => e.text)).toEqual(['The plan is in PLAN.md.']);
    expect(of(events, 'turn-end')[0]?.stats).toMatchObject({ inputTokens: 1500, outputTokens: 80 });
  });

  it('adds the model to the summary when the item carries one', async () => {
    const events = await drive([
      started(collab({ id: 'item_m', tool: 'spawn_agent', prompt: 'review the diff\nline two', model: 'gpt-5' })),
    ]);
    expect(of(events, 'tool-start')[0]).toMatchObject({
      tool: 'Agent',
      summary: 'review the diff - gpt-5',
      input: 'review the diff\nline two',
      agent: true,
    });
  });

  it('settles a failed spawn as a failed card', async () => {
    const events = await drive([
      started(collab({ id: 'item_f', tool: 'spawn_agent', prompt: 'do it' })),
      completed(collab({ id: 'item_f', tool: 'spawn_agent', prompt: 'do it', status: 'failed' })),
    ]);
    expect(of(events, 'tool-end')).toEqual([
      { kind: 'tool-end', toolId: 'item_f', ok: false, output: 'Codex could not start this sub-agent.' },
    ]);
  });

  it('marks a child that errored as failed, with its message', async () => {
    const spawnDone = collab({
      id: 'item_e',
      tool: 'spawn_agent',
      prompt: 'try',
      receiver_thread_ids: ['thread-err'],
      agents_states: { 'thread-err': { status: 'running', message: null } },
      status: 'completed',
    });
    const events = await drive([
      started(collab({ id: 'item_e', tool: 'spawn_agent', prompt: 'try' })),
      completed(spawnDone),
      completed(
        collab({
          id: 'item_w',
          tool: 'wait',
          receiver_thread_ids: ['thread-err'],
          agents_states: { 'thread-err': { status: 'errored', message: 'tool budget exceeded' } },
          status: 'completed',
        }),
      ),
    ]);
    expect(of(events, 'tool-end')).toEqual([
      { kind: 'tool-end', toolId: 'item_e', ok: false, output: 'errored - tool budget exceeded' },
    ]);
  });

  it('opens the card even when only the completed spawn item arrives', async () => {
    const events = await drive([
      completed(
        collab({
          id: 'item_c',
          tool: 'spawn_agent',
          prompt: 'late start',
          receiver_thread_ids: ['thread-late'],
          agents_states: { 'thread-late': { status: 'running', message: null } },
          status: 'completed',
        }),
      ),
    ]);
    expect(of(events, 'tool-start')).toHaveLength(1);
    expect(of(events, 'text-delta')[0]).toMatchObject({ parentId: 'item_c' });
  });

  it('falls back to the raw card for unknown collab tools and unknown children', async () => {
    const events = await drive([
      started(collab({ id: 'item_u', tool: 'list_agents' })),
      completed(collab({ id: 'item_u', tool: 'list_agents', status: 'completed' })),
      started(collab({ id: 'item_s', tool: 'wait', receiver_thread_ids: ['thread-stranger'] })),
      completed(
        collab({
          id: 'item_s',
          tool: 'wait',
          receiver_thread_ids: ['thread-stranger'],
          agents_states: { 'thread-stranger': { status: 'completed', message: null } },
          status: 'completed',
        }),
      ),
    ]);
    const starts = of(events, 'tool-start');
    expect(starts.map((e) => [e.toolId, e.tool, e.agent])).toEqual([
      ['item_u', 'collab_tool_call', undefined],
      ['item_s', 'collab_tool_call', undefined],
    ]);
    expect(of(events, 'tool-end').map((e) => e.toolId)).toEqual(['item_u', 'item_s']);
    expect(of(events, 'text-delta')).toHaveLength(0); // nothing routed into a card that does not exist
  });
});
