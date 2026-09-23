/**
 * Shared vocabulary for environment lifecycle state — labels and messages
 * both the main process (chat gate, error text) and the renderer (status
 * chips, composer placeholder, hero) derive from one `EnvLifecycle`, so the
 * two sides never disagree about what "starting (pulling image)" reads as.
 * Pure: no node, no electron, no DOM.
 */

import type { EnvLifecycle, EnvStage } from './bridge';

export const STAGE_LABELS: Record<EnvStage, string> = {
  'checking-image': 'checking image and container',
  'pulling-image': 'pulling image',
  'building-image': 'building image',
  'starting-container': 'starting container',
  'installing-clis': 'installing provider CLIs',
  'installing-sdks': 'installing provider SDKs',
  'verifying-packages': 'verifying package versions',
  'deploying-runner': 'deploying runner',
  'injecting-credentials': 'injecting credentials',
  'probing-runner': 'waiting for the runner handshake',
  'stopping-container': 'stopping container',
  'removing-container': 'removing container',
};

export function stageLabel(stage: EnvStage | null): string {
  return stage ? STAGE_LABELS[stage] : '';
}

/** Sentence fragment: "is starting (pulling image)", "failed while installing SDKs". */
export function describeStatus(lc: EnvLifecycle): string {
  switch (lc.status) {
    case 'ready':
      return 'is ready';
    case 'starting':
      return lc.stage ? `is starting (${STAGE_LABELS[lc.stage]})` : 'is starting';
    case 'stopping':
      return lc.stage === 'removing-container' ? 'is being rebuilt' : 'is stopping';
    case 'failed':
      return lc.stage ? `failed while ${STAGE_LABELS[lc.stage]}` : 'failed';
    case 'stopped':
      return 'is stopped';
  }
}

/**
 * Why a turn cannot start right now — the same sentence the composer shows
 * and the backend returns when a turn is attempted anyway. Empty when ready.
 */
export function notReadyMessage(name: string, lc: EnvLifecycle): string {
  switch (lc.status) {
    case 'ready':
      return '';
    case 'starting':
      return `Environment "${name}" ${describeStatus(lc)} — wait until it is ready.`;
    case 'stopping':
      return `Environment "${name}" ${describeStatus(lc)} — start it again from Settings when it has stopped.`;
    case 'failed':
      return `Environment "${name}" ${describeStatus(lc)}: ${lc.error ?? 'unknown error'} Fix it from Settings.`;
    case 'stopped':
      return `Environment "${name}" is stopped. Start it from Settings.`;
  }
}

/** Compact elapsed time: "8s", "1m 05s", "12m 40s", "1h 03m". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Elapsed time of the current or last operation; null when never operated. */
export function elapsedMs(lc: EnvLifecycle, now: number): number | null {
  if (lc.startedAt === null) return null;
  return (lc.endedAt ?? now) - lc.startedAt;
}

/** Whether the UI should keep an elapsed-time ticker running for this state. */
export function isBusy(lc: EnvLifecycle): boolean {
  return lc.status === 'starting' || lc.status === 'stopping';
}
