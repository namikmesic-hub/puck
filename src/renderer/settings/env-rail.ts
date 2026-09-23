/**
 * The one environment op rail (Select / Stop / Restart / Rebuild / Start /
 * Delete) — used by both the envs list cards and the env detail header, so
 * adding an operation is one edit. Which ops appear follows the Puck
 * lifecycle status: a `starting` environment offers Stop (which cancels the
 * start), a `stopping` one offers nothing until it settles. Ops run one at a
 * time per host; whatever `EnvironmentInfo[]` the bridge mutation returns
 * flows to `onSettled`, so callers can render it instead of re-probing.
 */

import type { EnvironmentInfo, HarnessStatus, PuckBridge } from '../../harness/bridge';
import { armDelete } from '../dom';
import { button, errText } from '../util';

export interface EnvRailContext {
  bridge: PuckBridge;
  applyStatus(status: HarnessStatus): void;
  /** Where op errors land (the page's .form-msg slot). */
  message(text: string): void;
  /** Runs after every op; receives the mutation's returned list when it has one. */
  onSettled(latest?: EnvironmentInfo[]): Promise<void>;
  /** List cards live inside a clickable card — rail clicks must not open it. */
  stopPropagation?: boolean;
  /** Site-specific delete (clear local ids, navigate away). */
  onDelete(env: EnvironmentInfo): Promise<EnvironmentInfo[] | void>;
}

export function envOpRail(host: HTMLElement, env: EnvironmentInfo, ctx: EnvRailContext): void {
  const runOp = async (
    btn: HTMLButtonElement,
    fn: () => Promise<EnvironmentInfo[] | void>,
  ): Promise<void> => {
    host.querySelectorAll('button').forEach((b) => (b.disabled = true)); // one op at a time
    btn.textContent = '…';
    ctx.message('');
    let latest: EnvironmentInfo[] | undefined;
    try {
      latest = (await fn()) ?? undefined;
    } catch (err) {
      ctx.message(errText(err));
    }
    await ctx.onSettled(latest);
  };
  const action = (label: string, fn: () => Promise<EnvironmentInfo[] | void>, title?: string): void => {
    const btn = button('btn-ghost', label);
    if (title) btn.title = title;
    btn.addEventListener('click', (e) => {
      if (ctx.stopPropagation) e.stopPropagation();
      void runOp(btn, fn);
    });
    host.appendChild(btn);
  };

  if (!env.active) {
    action('Select', async () => {
      ctx.applyStatus(await ctx.bridge.envSelect(env.id));
    });
  }
  switch (env.status) {
    case 'ready':
      action('Stop', () => ctx.bridge.envStop(env.id));
      action('Restart', () => ctx.bridge.envRestart(env.id));
      action('Rebuild', () => ctx.bridge.envRebuild(env.id));
      break;
    case 'starting':
      action('Stop', () => ctx.bridge.envStop(env.id), 'Cancel the start and stop the container');
      break;
    case 'stopping':
      break; // settles on its own; the chip and progress line say so
    case 'stopped':
    case 'failed': {
      action('Start', () => ctx.bridge.envStart(env.id));
      action('Rebuild', () => ctx.bridge.envRebuild(env.id));
      const del = button('btn-ghost danger', 'Delete');
      // armDelete stops propagation itself, so the clickable list card stays shut.
      armDelete(del, () => runOp(del, () => ctx.onDelete(env)));
      host.appendChild(del);
      break;
    }
  }
}
