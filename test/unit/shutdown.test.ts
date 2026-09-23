import { afterEach, describe, expect, it, vi } from 'vitest';
import { installQuitDrain, type QuitApp } from '../../src/main/shutdown';

// Electron model: app.quit() emits before-quit; if a listener calls
// preventDefault the quit is cancelled, otherwise the process exits.
function fakeApp() {
  const listeners: Array<(e: { preventDefault(): void }) => void> = [];
  const app = {
    exited: false,
    quits: 0,
    on(_event: 'before-quit', listener: (e: { preventDefault(): void }) => void): void {
      listeners.push(listener);
    },
    quit(): void {
      app.quits += 1;
      let prevented = false;
      for (const l of listeners) l({ preventDefault: () => (prevented = true) });
      if (!prevented) app.exited = true;
    },
  } satisfies QuitApp & { exited: boolean; quits: number };
  return app;
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.useRealTimers());

describe('installQuitDrain', () => {
  it('holds the first quit until the renderer flushed and the stores drained, in that order', async () => {
    const app = fakeApp();
    const flush = deferred();
    const drain = deferred();
    const order: string[] = [];
    installQuitDrain(app, {
      flushRenderers: () => {
        order.push('flush');
        return flush.promise;
      },
      drainStores: () => {
        order.push('drain');
        return drain.promise;
      },
      timeoutMs: 10_000,
    });

    app.quit();
    await tick();
    expect(app.exited).toBe(false);
    expect(order).toEqual(['flush']); // stores drain only after the renderer's saves landed

    flush.resolve();
    await tick();
    expect(app.exited).toBe(false);
    expect(order).toEqual(['flush', 'drain']);

    drain.resolve();
    await tick();
    expect(app.exited).toBe(true);
    expect(app.quits).toBe(2); // the intercepted request plus the re-issued one
  });

  it('runs the drain once even when quit is requested repeatedly', async () => {
    const app = fakeApp();
    const flush = deferred();
    const flushRenderers = vi.fn(() => flush.promise);
    installQuitDrain(app, { flushRenderers, drainStores: async () => undefined, timeoutMs: 10_000 });
    app.quit();
    app.quit();
    await tick();
    expect(flushRenderers).toHaveBeenCalledTimes(1);
    flush.resolve();
    await tick();
    expect(app.exited).toBe(true);
  });

  it('gives up on a stuck drain after the timeout and quits anyway', async () => {
    vi.useFakeTimers();
    const app = fakeApp();
    const log = vi.fn();
    installQuitDrain(app, {
      flushRenderers: async () => undefined,
      drainStores: () => new Promise(() => undefined), // never settles
      timeoutMs: 5_000,
      log,
    });
    app.quit();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(app.exited).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(app.exited).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/still pending after 5000ms/));
  });

  it('a failing flush is logged and does not block the quit', async () => {
    const app = fakeApp();
    const log = vi.fn();
    installQuitDrain(app, {
      flushRenderers: async () => {
        throw new Error('renderer gone');
      },
      drainStores: async () => undefined,
      timeoutMs: 10_000,
      log,
    });
    app.quit();
    await tick();
    expect(app.exited).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/renderer gone/));
  });
});
