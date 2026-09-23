/**
 * Pure environment lifecycle state: the reducer that turns start/stop
 * progress into `EnvLifecycle`, the output sanitizer, and the timeout
 * classifier. Labels and messages shared with the renderer live in
 * src/harness/lifecycle.ts. No docker, no fs — tested as a state machine.
 *
 * Invariants the reducer enforces:
 *  - `ready` is reachable only from `starting` at the `probing-runner` stage,
 *    i.e. after every install/inject step AND the runner handshake.
 *  - a failure keeps the stage it happened in (`stage`), so the UI can still
 *    say "failed while installing SDKs" after navigating away and back.
 *  - stage/detail updates outside an operation are ignored — a late output
 *    line from a killed command cannot repaint a settled state.
 */

import type { EnvLifecycle, EnvStage, EnvStatus } from '../harness/bridge';
import { STAGE_LABELS } from '../harness/lifecycle';

export { STAGE_LABELS, describeStatus, notReadyMessage, stageLabel } from '../harness/lifecycle';

export function idleLifecycle(): EnvLifecycle {
  return { status: 'stopped', stage: null, detail: '', startedAt: null, endedAt: null, error: null };
}

export type LifecycleEvent =
  | { type: 'begin-start'; at: number }
  | { type: 'begin-stop'; at: number; stage?: EnvStage }
  | { type: 'stage'; stage: EnvStage; detail?: string }
  | { type: 'detail'; detail: string }
  | { type: 'ready'; at: number }
  | { type: 'stopped'; at: number; detail?: string }
  | { type: 'failed'; at: number; error: string }
  /** The container vanished (stopped outside Puck, daemon restart) while ready. */
  | { type: 'lost'; at: number; detail: string };

const OPERATING: ReadonlySet<EnvStatus> = new Set<EnvStatus>(['starting', 'stopping']);

export function transition(state: EnvLifecycle, ev: LifecycleEvent): EnvLifecycle {
  switch (ev.type) {
    case 'begin-start':
      return { status: 'starting', stage: null, detail: '', startedAt: ev.at, endedAt: null, error: null };
    case 'begin-stop':
      return {
        status: 'stopping',
        stage: ev.stage ?? 'stopping-container',
        detail: '',
        startedAt: ev.at,
        endedAt: null,
        error: null,
      };
    case 'stage':
      if (!OPERATING.has(state.status)) return state;
      return { ...state, stage: ev.stage, detail: ev.detail ?? '' };
    case 'detail':
      if (!OPERATING.has(state.status)) return state;
      return { ...state, detail: ev.detail };
    case 'ready':
      if (state.status !== 'starting' || state.stage !== 'probing-runner') {
        throw new Error(
          `lifecycle: ready requires starting at probing-runner (was ${state.status}/${state.stage})`,
        );
      }
      return { ...state, status: 'ready', stage: null, detail: '', endedAt: ev.at, error: null };
    case 'stopped':
      return { ...state, status: 'stopped', stage: null, detail: ev.detail ?? '', endedAt: ev.at, error: null };
    case 'failed':
      // From an operation (stage preserved) or from `ready` (the runner died
      // underneath a ready environment); a settled stopped/failed state is
      // never re-failed by a late error.
      if (!OPERATING.has(state.status) && state.status !== 'ready') return state;
      return { ...state, status: 'failed', endedAt: ev.at, error: ev.error };
    case 'lost':
      if (state.status !== 'ready') return state;
      return { ...state, status: 'stopped', stage: null, detail: ev.detail, endedAt: ev.at, error: null };
  }
}

/* ---------- Output hygiene ---------- */

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
export const DETAIL_MAX = 160;

/**
 * One bounded, printable line from docker/npm output: ANSI stripped, the
 * last `\r` redraw segment kept, whitespace collapsed, length capped. Callers
 * never route credential material through here — stages that touch secrets
 * report a static label instead of command output.
 */
export function sanitizeOutputLine(raw: string): string {
  const segment = raw.split('\r').pop() ?? '';
  const clean = segment.replace(ANSI_RE, '').replace(/\s+/g, ' ').trim();
  return clean.length > DETAIL_MAX ? `${clean.slice(0, DETAIL_MAX - 1)}…` : clean;
}

/* ---------- Error classification ---------- */

export interface TimeoutProbe {
  /** Is the image present locally (null = could not tell)? */
  imageLocal: boolean | null;
  container: 'running' | 'stopped' | 'missing' | 'unknown';
  /** Did the daemon answer `docker info`? */
  daemon: { ok: boolean; message: string };
}

/**
 * A timeout names the operation and stage, then what the follow-up probes
 * found — so the UI can say whether Docker is still pulling, a container
 * exists, or the daemon is unavailable, instead of guessing "not running".
 */
export function describeTimeout(
  operation: string,
  stage: EnvStage,
  seconds: number,
  probe: TimeoutProbe,
): string {
  const facts: string[] = [];
  if (!probe.daemon.ok) {
    facts.push(probe.daemon.message);
  } else {
    facts.push(`${probe.daemon.message} is responding`);
    if (probe.imageLocal === true) facts.push('the image is local');
    else if (probe.imageLocal === false) facts.push('the image is not local yet (Docker may still be pulling)');
    if (probe.container === 'running') facts.push('a container exists and is running');
    else if (probe.container === 'stopped') facts.push('a container exists but is not running');
    else if (probe.container === 'missing') facts.push('no container was created');
  }
  return `${operation} timed out after ${seconds}s while ${STAGE_LABELS[stage]}. ${facts.join('; ')}.`;
}
