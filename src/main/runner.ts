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
  /** Last ~8KB of container stderr — the only diagnostics on failure. */
  stderrTail: string;
  /** Resolves on the runner's `{ready:true}` handshake; rejects on death. */
  ready: Promise<void>;
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
  let readyResolve!: () => void;
  let readyReject!: (err: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  ready.catch(() => undefined); // observed via await in turn(); avoid unhandled
  const proc: RunnerProc = { child, routes, stderrTail: '', ready };
  const readyTimer = setTimeout(() => {
    readyReject(new Error('runner did not report ready within 15s'));
  }, 15_000);

  // A dead exec (container gone, daemon stopped) must fail the turn, not the
  // app: without these handlers an EPIPE on stdin is a process-fatal throw.
  const fail = (): void => {
    clearTimeout(readyTimer);
    readyReject(new Error('runner process exited'));
    for (const route of routes.values()) route(null);
    routes.clear();
    if (runners.get(envId) === proc) runners.delete(envId);
  };
  child.on('error', fail);
  child.stdin?.on('error', fail);

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
        if (msg.ready) {
          clearTimeout(readyTimer);
          readyResolve();
        }
        if (msg.id) routes.get(msg.id)?.(msg);
      } catch {
        // non-JSON noise
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    proc.stderrTail = (proc.stderrTail + String(chunk)).slice(-8000);
  });
  child.on('close', fail);

  runners.set(envId, proc);
  return proc;
}

function diagnose(proc: RunnerProc, headline: string): string {
  const tail = proc.stderrTail.trim();
  return tail ? `${headline}\nContainer stderr:\n${tail.slice(-800)}` : headline;
}

const endStats = { inputTokens: 0, outputTokens: 0, durationMs: 0 };

export async function* turn(
  envId: string,
  req: TurnRequest,
  onSession: (providerSessionId: string) => void,
): AsyncGenerator<HarnessEvent> {
  const proc = ensure(envId);
  try {
    await proc.ready;
  } catch (err) {
    yield {
      kind: 'error',
      message: diagnose(proc, `Runner failed to start: ${err instanceof Error ? err.message : err}. Try restarting the environment.`),
    };
    yield { kind: 'turn-end', stats: endStats };
    return;
  }
  if (proc.routes.has(req.id)) {
    yield { kind: 'error', message: `Duplicate turn id ${req.id} — refusing to clobber the running turn.` };
    yield { kind: 'turn-end', stats: endStats };
    return;
  }

  const queue: Array<RunnerMsg | null> = [];
  let wake: (() => void) | null = null;
  proc.routes.set(req.id, (msg) => {
    queue.push(msg);
    wake?.();
    wake = null;
  });

  // Watchdog: a runner that accepts the request but never answers must fail
  // the turn, not hang it forever. Cleared on the first message.
  let sawMessage = false;
  const watchdog = setTimeout(() => {
    if (!sawMessage) proc.routes.get(req.id)?.(null);
  }, 90_000);

  proc.child.stdin?.write(JSON.stringify({ op: 'turn', ...req }) + '\n');

  let done = false;
  try {
    for (;;) {
      if (!queue.length) await new Promise<void>((resolve) => (wake = resolve));
      while (queue.length) {
        const msg = queue.shift();
        if (msg === null || msg === undefined) {
          const headline = sawMessage
            ? 'Runner disconnected — is the environment container still running?'
            : 'Runner did not respond within 90s — is the environment container healthy?';
          yield { kind: 'error', message: diagnose(proc, headline) };
          yield { kind: 'turn-end', stats: endStats };
          return;
        }
        sawMessage = true;
        if (msg.session) onSession(msg.session);
        if (msg.event) yield msg.event;
        if (msg.done) {
          if (msg.providerSessionId) onSession(msg.providerSessionId);
          done = true;
          return;
        }
      }
    }
  } finally {
    clearTimeout(watchdog);
    proc.routes.delete(req.id);
    // The consumer went away mid-turn (window reload, generator abandoned):
    // stop the container-side work instead of letting it run invisibly.
    if (!done && proc.child.exitCode === null && !proc.child.killed) {
      try {
        proc.child.stdin?.write(JSON.stringify({ op: 'interrupt', id: req.id }) + '\n');
      } catch {
        // stdin already gone — nothing left to stop
      }
    }
  }
}

export function interrupt(envId: string, turnId: string): void {
  const proc = runners.get(envId);
  if (proc && proc.child.exitCode === null) {
    proc.child.stdin?.write(JSON.stringify({ op: 'interrupt', id: turnId }) + '\n');
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
    proc.child.stdin?.write(JSON.stringify({ op: 'answer', id: turnId, askId, answers }) + '\n');
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
