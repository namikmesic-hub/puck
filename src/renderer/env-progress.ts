/**
 * Environment lifecycle presentation: the status chip, the "stage · elapsed"
 * progress line, the composer gate text, and a tracker that merges pushed
 * `EnvLifecycleEvent`s and drives a one-second elapsed-time ticker while any
 * environment is busy. House style: pure functions + a small controller, no
 * DOM lookups inside, jsdom-testable.
 */

import type { EnvLifecycle, EnvLifecycleEvent, EnvStatus } from '../harness/bridge';
import {
  describeStatus,
  elapsedMs,
  formatElapsed,
  isBusy,
  notReadyMessage,
  stageLabel,
} from '../harness/lifecycle';
import { el } from './dom';

export type StatusTone = 'on' | 'busy' | 'bad' | 'off';

export function statusTone(status: EnvStatus): StatusTone {
  switch (status) {
    case 'ready':
      return 'on';
    case 'starting':
    case 'stopping':
      return 'busy';
    case 'failed':
      return 'bad';
    case 'stopped':
      return 'off';
  }
}

/** Status chip: dot + the lifecycle word, toned (ready / busy / failed / stopped). */
export function statusChip(status: EnvStatus): HTMLElement {
  const tone = statusTone(status);
  const wrap = el('span', 'status' + (tone === 'off' ? '' : ` ${tone}`));
  wrap.appendChild(el('span', 'dot'));
  wrap.appendChild(document.createTextNode(status));
  return wrap;
}

/** The one-line progress summary: what is happening (or happened) and for how long. */
export function progressLine(lc: EnvLifecycle, now: number): string {
  const elapsed = elapsedMs(lc, now);
  const time = elapsed === null ? '' : formatElapsed(elapsed);
  switch (lc.status) {
    case 'starting':
    case 'stopping':
      return `${stageLabel(lc.stage) || describeStatus(lc).replace(/^is /, '')} · ${time}`;
    case 'failed':
      return time ? `${describeStatus(lc)} · after ${time}` : describeStatus(lc);
    case 'ready':
      return time ? `ready · started in ${time}` : 'ready';
    case 'stopped':
      return lc.detail || '';
  }
}

/** Second line: the last docker/npm output line while busy, the error once failed. */
export function progressDetail(lc: EnvLifecycle): string {
  if (lc.status === 'failed') return lc.error ?? '';
  if (isBusy(lc)) return lc.detail;
  return '';
}

/** Fill `host` with the progress line + detail; empty when there is nothing to say. */
export function renderProgress(host: HTMLElement, lc: EnvLifecycle, now: number): void {
  host.textContent = '';
  const line = progressLine(lc, now);
  const detail = progressDetail(lc);
  host.classList.toggle('failed', lc.status === 'failed');
  if (!line && !detail) return;
  if (line) host.appendChild(el('span', 'env-progress-line', line));
  if (detail) {
    const node = el('span', 'env-progress-detail', detail);
    node.title = detail; // the visible line is clamped; the full text is a hover away
    host.appendChild(node);
  }
}

export interface ComposerGate {
  ready: boolean;
  placeholder: string;
  /** Why sending is blocked — the toast/tooltip text; empty when ready. */
  reason: string;
}

/**
 * What the composer may do given the active environment. A missing
 * environment or agent is a setup problem; anything but `ready` names the
 * environment and its stage so the user knows what they are waiting for.
 */
export function composerGate(
  env: ({ name: string } & EnvLifecycle) | null,
  agentName: string | null,
): ComposerGate {
  if (!agentName) {
    return { ready: false, placeholder: 'Create an agent in Settings to start chatting', reason: '' };
  }
  if (!env) {
    const reason = 'No environment configured. Open Settings and create one.';
    return { ready: false, placeholder: reason, reason };
  }
  const reason = notReadyMessage(env.name, env);
  if (!reason) return { ready: true, placeholder: `Message ${agentName}`, reason: '' };
  return { ready: false, placeholder: reason, reason };
}

/** Hero sentence under the chat title, derived from the same state. */
export function heroLine(
  env: ({ name: string } & EnvLifecycle) | null,
  who: string,
  hasAgents: boolean,
  now: number,
): string {
  if (!hasAgents) return 'Create an agent in Settings — every agent gets its own chat.';
  if (!env) return 'Set up an environment in Settings, then just type.';
  if (env.status === 'ready') return `${who} in "${env.name}" — real tool calls in a Docker sandbox.`;
  if (isBusy(env)) {
    const elapsed = elapsedMs(env, now);
    const time = elapsed === null ? '' : ` · ${formatElapsed(elapsed)}`;
    return `Environment "${env.name}" ${describeStatus(env)}${time}`;
  }
  return notReadyMessage(env.name, env);
}

/** Just the lifecycle fields of an event or info record (drops ids and config). */
export function pickLifecycle(lc: EnvLifecycle): EnvLifecycle {
  return {
    status: lc.status,
    stage: lc.stage,
    detail: lc.detail,
    startedAt: lc.startedAt,
    endedAt: lc.endedAt,
    error: lc.error,
  };
}

export interface LifecycleTracker {
  /** Merge a pushed event; returns whether the STATUS (not just detail) changed. */
  apply(ev: EnvLifecycleEvent): boolean;
  /** Seed/refresh from a full list (envList or an op result). */
  seed(list: ReadonlyArray<{ id: string } & EnvLifecycle>): void;
  get(envId: string): EnvLifecycle | undefined;
  forget(envId: string): void;
  /** True while any tracked environment is starting or stopping. */
  anyBusy(): boolean;
  dispose(): void;
}

/**
 * Keeps the latest lifecycle per environment and runs `onTick` once a second
 * while anything is busy, so elapsed times advance between pushed events.
 */
export function createLifecycleTracker(opts: {
  onTick(now: number): void;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}): LifecycleTracker {
  const states = new Map<string, EnvLifecycle>();
  const setI = opts.setInterval ?? setInterval;
  const clearI = opts.clearInterval ?? clearInterval;
  let timer: ReturnType<typeof setInterval> | null = null;

  const anyBusy = (): boolean => [...states.values()].some(isBusy);
  const syncTicker = (): void => {
    if (anyBusy() && !timer) {
      timer = setI(() => opts.onTick(Date.now()), 1000);
    } else if (!anyBusy() && timer) {
      clearI(timer);
      timer = null;
    }
  };

  return {
    apply(ev) {
      const prev = states.get(ev.envId);
      states.set(ev.envId, pickLifecycle(ev));
      syncTicker();
      return prev?.status !== ev.status;
    },
    seed(list) {
      for (const entry of list) states.set(entry.id, pickLifecycle(entry));
      syncTicker();
    },
    get: (envId) => states.get(envId),
    forget(envId) {
      states.delete(envId);
      syncTicker();
    },
    anyBusy,
    dispose() {
      if (timer) clearI(timer);
      timer = null;
      states.clear();
    },
  };
}
