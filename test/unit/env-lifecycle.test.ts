import { describe, expect, it } from 'vitest';
import type { EnvLifecycle } from '../../src/harness/bridge';
import {
  describeStatus,
  formatElapsed,
  notReadyMessage,
  stageLabel,
} from '../../src/harness/lifecycle';
import {
  describeTimeout,
  idleLifecycle,
  sanitizeOutputLine,
  transition,
  type LifecycleEvent,
} from '../../src/main/env-lifecycle';

function reduce(events: LifecycleEvent[], from: EnvLifecycle = idleLifecycle()): EnvLifecycle {
  return events.reduce(transition, from);
}

describe('lifecycle reducer', () => {
  it('a full start walks starting → stages → ready, clearing stage and error', () => {
    const lc = reduce([
      { type: 'begin-start', at: 100 },
      { type: 'stage', stage: 'pulling-image', detail: 'docker pull node' },
      { type: 'detail', detail: 'abc: Downloading' },
      { type: 'stage', stage: 'starting-container' },
      { type: 'stage', stage: 'probing-runner' },
      { type: 'ready', at: 900 },
    ]);
    expect(lc).toEqual({ status: 'ready', stage: null, detail: '', startedAt: 100, endedAt: 900, error: null });
  });

  it('ready is only reachable through the runner handshake stage', () => {
    const mid = reduce([{ type: 'begin-start', at: 1 }, { type: 'stage', stage: 'deploying-runner' }]);
    expect(() => transition(mid, { type: 'ready', at: 2 })).toThrow(/probing-runner/);
    expect(() => transition(idleLifecycle(), { type: 'ready', at: 2 })).toThrow();
  });

  it('a failure keeps the stage it happened in and records the error', () => {
    const lc = reduce([
      { type: 'begin-start', at: 1 },
      { type: 'stage', stage: 'installing-sdks', detail: 'npm install' },
      { type: 'failed', at: 50, error: 'npm ERR! ETIMEDOUT' },
    ]);
    expect(lc.status).toBe('failed');
    expect(lc.stage).toBe('installing-sdks');
    expect(lc.error).toBe('npm ERR! ETIMEDOUT');
    expect(lc.endedAt).toBe(50);
    expect(describeStatus(lc)).toBe('failed while installing provider SDKs');
  });

  it('late stage/detail/failed events cannot repaint a settled state', () => {
    const failed = reduce([{ type: 'begin-start', at: 1 }, { type: 'failed', at: 2, error: 'x' }]);
    expect(transition(failed, { type: 'stage', stage: 'pulling-image' })).toBe(failed);
    expect(transition(failed, { type: 'detail', detail: 'late line' })).toBe(failed);
    expect(transition(failed, { type: 'failed', at: 3, error: 'again' })).toBe(failed);
    const stopped = reduce([{ type: 'begin-stop', at: 1 }, { type: 'stopped', at: 2 }]);
    expect(transition(stopped, { type: 'detail', detail: 'late' })).toBe(stopped);
  });

  it('stop: stopping (with its stage) → stopped; rebuild uses removing-container', () => {
    const stopping = transition(idleLifecycle(), { type: 'begin-stop', at: 10 });
    expect(stopping).toMatchObject({ status: 'stopping', stage: 'stopping-container', startedAt: 10 });
    expect(describeStatus(stopping)).toBe('is stopping');
    const removing = transition(stopping, { type: 'begin-stop', at: 11, stage: 'removing-container' });
    expect(describeStatus(removing)).toBe('is being rebuilt');
    const stopped = transition(removing, { type: 'stopped', at: 20, detail: 'bye' });
    expect(stopped).toMatchObject({ status: 'stopped', stage: null, detail: 'bye', endedAt: 20, error: null });
  });

  it('a start after a failure clears the previous error and stage', () => {
    const failed = reduce([{ type: 'begin-start', at: 1 }, { type: 'stage', stage: 'pulling-image' }, { type: 'failed', at: 2, error: 'x' }]);
    const again = transition(failed, { type: 'begin-start', at: 3 });
    expect(again).toEqual({ status: 'starting', stage: null, detail: '', startedAt: 3, endedAt: null, error: null });
  });

  it('lost demotes a ready environment to stopped and is ignored elsewhere', () => {
    const ready = reduce([{ type: 'begin-start', at: 1 }, { type: 'stage', stage: 'probing-runner' }, { type: 'ready', at: 2 }]);
    const lost = transition(ready, { type: 'lost', at: 3, detail: 'container stopped outside Puck' });
    expect(lost).toMatchObject({ status: 'stopped', detail: 'container stopped outside Puck', endedAt: 3 });
    const starting = transition(idleLifecycle(), { type: 'begin-start', at: 1 });
    expect(transition(starting, { type: 'lost', at: 2, detail: 'x' })).toBe(starting);
  });

  it('a ready environment whose runner dies can fail (no stage) with the runner error', () => {
    const ready = reduce([{ type: 'begin-start', at: 1 }, { type: 'stage', stage: 'probing-runner' }, { type: 'ready', at: 2 }]);
    const dead = transition(ready, { type: 'failed', at: 3, error: 'Runner exited unexpectedly (code 1).' });
    expect(dead).toMatchObject({ status: 'failed', stage: null, error: 'Runner exited unexpectedly (code 1).' });
    expect(describeStatus(dead)).toBe('failed');
  });
});

describe('lifecycle text', () => {
  it('notReadyMessage names the environment and the stage or error; empty when ready', () => {
    const starting = reduce([{ type: 'begin-start', at: 1 }, { type: 'stage', stage: 'installing-clis' }]);
    expect(notReadyMessage('dev', starting)).toBe(
      'Environment "dev" is starting (installing provider CLIs) — wait until it is ready.',
    );
    const failed = transition(starting, { type: 'failed', at: 2, error: 'npm ERR! 403' });
    expect(notReadyMessage('dev', failed)).toBe(
      'Environment "dev" failed while installing provider CLIs: npm ERR! 403 Fix it from Settings.',
    );
    expect(notReadyMessage('dev', idleLifecycle())).toBe('Environment "dev" is stopped. Start it from Settings.');
    const ready = reduce([{ type: 'stage', stage: 'probing-runner' }, { type: 'ready', at: 3 }], starting);
    expect(notReadyMessage('dev', ready)).toBe('');
  });

  it('stageLabel and formatElapsed', () => {
    expect(stageLabel('pulling-image')).toBe('pulling image');
    expect(stageLabel(null)).toBe('');
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(8_400)).toBe('8s');
    expect(formatElapsed(65_000)).toBe('1m 05s');
    expect(formatElapsed(12 * 60_000 + 40_000)).toBe('12m 40s');
    expect(formatElapsed(63 * 60_000)).toBe('1h 03m');
  });
});

describe('output hygiene', () => {
  it('sanitizeOutputLine strips ANSI, keeps the last \\r redraw, collapses whitespace, caps length', () => {
    expect(sanitizeOutputLine('\u001b[2K\u001b[1Gabc:   Downloading  [=>   ]  1MB/9MB')).toBe(
      'abc: Downloading [=> ] 1MB/9MB',
    );
    expect(sanitizeOutputLine('first draw\rsecond draw\rfinal draw')).toBe('final draw');
    const long = sanitizeOutputLine('x'.repeat(500));
    expect(long.length).toBe(160);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('describeTimeout', () => {
  const daemonUp = { ok: true, message: 'Docker 27.1.0' };

  it('names the operation, stage, and what the follow-up probes found', () => {
    expect(
      describeTimeout('docker run', 'starting-container', 60, {
        imageLocal: true,
        container: 'missing',
        daemon: daemonUp,
      }),
    ).toBe(
      'docker run timed out after 60s while starting container. Docker 27.1.0 is responding; the image is local; no container was created.',
    );
  });

  it('says when the image is still being pulled or a container exists', () => {
    expect(
      describeTimeout('docker pull', 'pulling-image', 600, { imageLocal: false, container: 'missing', daemon: daemonUp }),
    ).toMatch(/the image is not local yet \(Docker may still be pulling\)/);
    expect(
      describeTimeout('docker run', 'starting-container', 60, { imageLocal: true, container: 'stopped', daemon: daemonUp }),
    ).toMatch(/a container exists but is not running/);
  });

  it('reserves "is Docker running?" for a failed daemon health check', () => {
    const msg = describeTimeout('docker run', 'starting-container', 60, {
      imageLocal: null,
      container: 'unknown',
      daemon: { ok: false, message: 'Docker is not responding (connection refused) — is Docker running?' },
    });
    expect(msg).toMatch(/is Docker running\?/);
    const healthy = describeTimeout('docker run', 'starting-container', 60, {
      imageLocal: true,
      container: 'missing',
      daemon: daemonUp,
    });
    expect(healthy).not.toMatch(/is Docker running/);
  });
});
