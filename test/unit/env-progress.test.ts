// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { EnvLifecycle, EnvLifecycleEvent } from '../../src/harness/bridge';
import {
  composerGate,
  createLifecycleTracker,
  heroLine,
  progressDetail,
  progressLine,
  renderProgress,
  statusChip,
  statusTone,
} from '../../src/renderer/env-progress';

const NOW = 1_700_000_000_000;

function lc(over: Partial<EnvLifecycle> = {}): EnvLifecycle {
  return { status: 'ready', stage: null, detail: '', startedAt: NOW - 30_000, endedAt: NOW - 1_000, error: null, ...over };
}
const named = (over: Partial<EnvLifecycle> = {}) => ({ name: 'dev', ...lc(over) });

describe('status presentation', () => {
  it('maps lifecycle status to a tone and a toned chip', () => {
    expect(statusTone('ready')).toBe('on');
    expect(statusTone('starting')).toBe('busy');
    expect(statusTone('stopping')).toBe('busy');
    expect(statusTone('failed')).toBe('bad');
    expect(statusTone('stopped')).toBe('off');
    const chip = statusChip('starting');
    expect(chip.className).toBe('status busy');
    expect(chip.textContent).toBe('starting');
    expect(statusChip('stopped').className).toBe('status');
  });

  it('progressLine: stage · elapsed while busy, failure with duration, ready with start time', () => {
    expect(progressLine(lc({ status: 'starting', stage: 'pulling-image', startedAt: NOW - 12_000, endedAt: null }), NOW)).toBe(
      'pulling image · 12s',
    );
    expect(progressLine(lc({ status: 'stopping', stage: 'stopping-container', startedAt: NOW - 3_000, endedAt: null }), NOW)).toBe(
      'stopping container · 3s',
    );
    expect(progressLine(lc({ status: 'failed', stage: 'installing-clis', startedAt: NOW - 70_000, endedAt: NOW - 5_000 }), NOW)).toBe(
      'failed while installing provider CLIs · after 1m 05s',
    );
    expect(progressLine(lc(), NOW)).toBe('ready · started in 29s');
    expect(progressLine(lc({ status: 'stopped', startedAt: null, endedAt: null }), NOW)).toBe('');
    expect(progressLine(lc({ status: 'stopped', detail: 'container stopped outside Puck' }), NOW)).toBe('container stopped outside Puck');
  });

  it('progressDetail: the output line while busy, the error once failed, nothing otherwise', () => {
    expect(progressDetail(lc({ status: 'starting', stage: 'pulling-image', detail: 'abc: Downloading' }))).toBe('abc: Downloading');
    expect(progressDetail(lc({ status: 'failed', stage: 'pulling-image', error: 'manifest unknown' }))).toBe('manifest unknown');
    expect(progressDetail(lc({ detail: 'stale' }))).toBe('');
  });

  it('renderProgress fills the host and marks failures; empties when there is nothing to say', () => {
    const host = document.createElement('div');
    renderProgress(host, lc({ status: 'failed', stage: 'pulling-image', error: 'manifest unknown', startedAt: NOW - 9_000, endedAt: NOW }), NOW);
    expect(host.classList.contains('failed')).toBe(true);
    expect(host.querySelector('.env-progress-line')?.textContent).toBe('failed while pulling image · after 9s');
    expect(host.querySelector('.env-progress-detail')?.textContent).toBe('manifest unknown');
    renderProgress(host, lc({ status: 'stopped', startedAt: null, endedAt: null }), NOW);
    expect(host.children.length).toBe(0);
    expect(host.classList.contains('failed')).toBe(false);
  });
});

describe('composer gate + hero line', () => {
  it('blocks without an agent or environment, with setup-oriented text', () => {
    expect(composerGate(named(), null)).toEqual({
      ready: false,
      placeholder: 'Create an agent in Settings to start chatting',
      reason: '',
    });
    const noEnv = composerGate(null, 'Reviewer');
    expect(noEnv.ready).toBe(false);
    expect(noEnv.reason).toMatch(/No environment configured/);
  });

  it('blocks until ready, naming the environment and its stage or failure', () => {
    const starting = composerGate(named({ status: 'starting', stage: 'installing-sdks', endedAt: null }), 'Reviewer');
    expect(starting.ready).toBe(false);
    expect(starting.placeholder).toBe('Environment "dev" is starting (installing provider SDKs) — wait until it is ready.');
    expect(starting.reason).toBe(starting.placeholder);
    const failed = composerGate(named({ status: 'failed', stage: 'pulling-image', error: 'manifest unknown' }), 'Reviewer');
    expect(failed.reason).toMatch(/failed while pulling image: manifest unknown/);
    const stopped = composerGate(named({ status: 'stopped' }), 'Reviewer');
    expect(stopped.reason).toMatch(/is stopped\. Start it from Settings/);
  });

  it('opens when ready with the usual placeholder', () => {
    expect(composerGate(named(), 'Reviewer')).toEqual({ ready: true, placeholder: 'Message Reviewer', reason: '' });
  });

  it('heroLine follows the same state and adds elapsed time while busy', () => {
    expect(heroLine(named(), 'Reviewer', false, NOW)).toMatch(/Create an agent/);
    expect(heroLine(null, 'Reviewer', true, NOW)).toMatch(/Set up an environment/);
    expect(heroLine(named(), 'Reviewer', true, NOW)).toBe('Reviewer in "dev" — real tool calls in a Docker sandbox.');
    expect(heroLine(named({ status: 'starting', stage: 'pulling-image', startedAt: NOW - 8_000, endedAt: null }), 'Reviewer', true, NOW)).toBe(
      'Environment "dev" is starting (pulling image) · 8s',
    );
    expect(heroLine(named({ status: 'failed', stage: 'pulling-image', error: 'manifest unknown' }), 'Reviewer', true, NOW)).toBe(
      'Environment "dev" failed while pulling image: manifest unknown Fix it from Settings.',
    );
  });
});

describe('lifecycle tracker', () => {
  const ev = (envId: string, over: Partial<EnvLifecycle> = {}): EnvLifecycleEvent => ({ envId, ...lc(over) });

  it('reports status changes (not detail-only pushes) and remembers the latest state', () => {
    const tracker = createLifecycleTracker({ onTick: () => undefined, setInterval: vi.fn() as never, clearInterval: vi.fn() as never });
    expect(tracker.apply(ev('a', { status: 'starting', stage: 'pulling-image', endedAt: null }))).toBe(true);
    expect(tracker.apply(ev('a', { status: 'starting', stage: 'pulling-image', detail: 'line 2', endedAt: null }))).toBe(false);
    expect(tracker.apply(ev('a', { status: 'starting', stage: 'starting-container', endedAt: null }))).toBe(false);
    expect(tracker.apply(ev('a'))).toBe(true);
    expect(tracker.get('a')?.status).toBe('ready');
    expect(tracker.get('a')).not.toHaveProperty('envId');
  });

  it('runs the ticker only while some environment is busy', () => {
    const setI = vi.fn(() => 42 as unknown as ReturnType<typeof setInterval>);
    const clearI = vi.fn();
    const onTick = vi.fn();
    const tracker = createLifecycleTracker({ onTick, setInterval: setI as never, clearInterval: clearI as never });
    tracker.seed([{ id: 'a', ...lc() }, { id: 'b', ...lc({ status: 'stopped' }) }]);
    expect(setI).not.toHaveBeenCalled();
    tracker.apply(ev('b', { status: 'starting', stage: 'pulling-image', endedAt: null }));
    expect(setI).toHaveBeenCalledTimes(1);
    expect(tracker.anyBusy()).toBe(true);
    tracker.apply(ev('a', { status: 'stopping', stage: 'stopping-container', endedAt: null }));
    expect(setI).toHaveBeenCalledTimes(1); // one ticker for everything
    tracker.apply(ev('b'));
    expect(clearI).not.toHaveBeenCalled(); // 'a' is still stopping
    tracker.apply(ev('a', { status: 'stopped' }));
    expect(clearI).toHaveBeenCalledWith(42);
    tracker.forget('a');
    tracker.dispose();
  });
});
