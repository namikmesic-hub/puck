/**
 * Runner bridge (main process).
 *
 * Maintains one long-lived `docker exec` into each environment's container
 * running the runner agent (/opt/puck/runner.js), and multiplexes turn
 * requests over NDJSON stdio. Stdio avoids published ports entirely, which
 * keeps this working across Docker runtimes (Docker Desktop, colima, …).
 */

import { spawn, ChildProcess } from 'node:child_process';
import type { HarnessEvent } from '../harness/types';
import { containerName } from './environments';

export interface TurnRequest {
  id: string;
  provider: string;
  model: string;
  systemPrompt: string;
  thinking: string;
  /** JSON object string merged into the provider SDK options. */
  advanced: string;
  resume: string | null;
  prompt: string;
}

interface RunnerMsg {
  id?: string;
  event?: HarnessEvent;
  done?: boolean;
  providerSessionId?: string | null;
  /** Eager resume-id report, sent as soon as the SDK announces the session. */
  session?: string;
  ready?: boolean;
}

interface RunnerProc {
  child: ChildProcess;
  routes: Map<string, (msg: RunnerMsg | null) => void>;
}

const runners = new Map<string, RunnerProc>();

function ensure(envId: string): RunnerProc {
  const existing = runners.get(envId);
  if (existing && existing.child.exitCode === null && !existing.child.killed) {
    return existing;
  }
  runners.delete(envId);

  const child = spawn('docker', [
    'exec', '-i', containerName(envId), 'node', '/opt/puck/runner.js',
  ]);
  const routes = new Map<string, (msg: RunnerMsg | null) => void>();
  const proc: RunnerProc = { child, routes };

  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += String(chunk);
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as RunnerMsg;
        if (msg.id) routes.get(msg.id)?.(msg);
      } catch {
        // non-JSON noise
      }
    }
  });
  child.stderr.on('data', () => undefined);
  child.on('close', () => {
    for (const route of routes.values()) route(null);
    routes.clear();
    if (runners.get(envId) === proc) runners.delete(envId);
  });

  runners.set(envId, proc);
  return proc;
}

export async function* turn(
  envId: string,
  req: TurnRequest,
  onSession: (providerSessionId: string) => void,
): AsyncGenerator<HarnessEvent> {
  const proc = ensure(envId);

  const queue: Array<RunnerMsg | null> = [];
  let wake: (() => void) | null = null;
  proc.routes.set(req.id, (msg) => {
    queue.push(msg);
    wake?.();
    wake = null;
  });

  proc.child.stdin.write(JSON.stringify({ op: 'turn', ...req }) + '\n');

  try {
    for (;;) {
      if (!queue.length) await new Promise<void>((resolve) => (wake = resolve));
      while (queue.length) {
        const msg = queue.shift();
        if (msg === null || msg === undefined) {
          yield {
            kind: 'error',
            message: 'Runner disconnected — is the environment container still running?',
          };
          yield { kind: 'turn-end', stats: { inputTokens: 0, outputTokens: 0, durationMs: 0 } };
          return;
        }
        if (msg.session) onSession(msg.session);
        if (msg.event) yield msg.event;
        if (msg.done) {
          if (msg.providerSessionId) onSession(msg.providerSessionId);
          return;
        }
      }
    }
  } finally {
    proc.routes.delete(req.id);
  }
}

export function interrupt(envId: string, turnId: string): void {
  const proc = runners.get(envId);
  if (proc && proc.child.exitCode === null) {
    proc.child.stdin.write(JSON.stringify({ op: 'interrupt', id: turnId }) + '\n');
  }
}

export function answerAsk(
  envId: string,
  turnId: string,
  askId: string,
  answers: Record<string, string> | null,
): void {
  const proc = runners.get(envId);
  if (proc && proc.child.exitCode === null) {
    proc.child.stdin.write(JSON.stringify({ op: 'answer', id: turnId, askId, answers }) + '\n');
  }
}

/** Drop the cached bridge (e.g. after an environment stop). */
export function detach(envId: string): void {
  const proc = runners.get(envId);
  if (proc) {
    proc.child.kill('SIGTERM');
    runners.delete(envId);
  }
}
