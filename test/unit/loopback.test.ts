import { afterEach, describe, expect, it } from 'vitest';
import {
  LoginCancelledError,
  startLoopback,
  type LoopbackListener,
} from '../../src/main/providers/loopback';

const STATE = 'expected-state-1234';
const open: LoopbackListener[] = [];

afterEach(() => {
  for (const l of open.splice(0)) l.cancel();
});

async function listen(opts: { timeoutMs?: number; port?: number } = {}): Promise<LoopbackListener> {
  const l = await startLoopback({ path: '/callback', state: STATE, ...opts });
  open.push(l);
  return l;
}

/** A plain HTTP GET against the listener, on a fresh connection every time. */
async function get(port: number, pathAndQuery: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${pathAndQuery}`, {
    headers: { connection: 'close' },
  });
  return { status: res.status, body: await res.text() };
}

/** True once nothing accepts connections on the port any more. */
async function refused(port: number): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/callback`, { headers: { connection: 'close' } });
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

describe('startLoopback', () => {
  it('binds 127.0.0.1 on a free port and hands out the code once state matches', async () => {
    const l = await listen();
    expect(l.port).toBeGreaterThan(0);
    const res = await get(l.port, `/callback?code=abc123&state=${STATE}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('return to Puck');
    expect(res.body).not.toContain('abc123'); // never echo the code
    await expect(l.code).resolves.toBe('abc123');
    expect(await refused(l.port)).toBe(true); // closed on success
  });

  it('rejects a state mismatch and closes without handing out the code', async () => {
    const l = await listen();
    const res = await get(l.port, '/callback?code=abc123&state=someone-elses');
    expect(res.status).toBe(400);
    expect(res.body).not.toContain('abc123');
    await expect(l.code).rejects.toThrow(/state mismatch/i);
    expect(await refused(l.port)).toBe(true); // closed on failure
  });

  it('accepts exactly one request: the second one is refused', async () => {
    const l = await listen();
    await get(l.port, `/callback?code=first&state=${STATE}`);
    await expect(l.code).resolves.toBe('first');
    await expect(get(l.port, `/callback?code=second&state=${STATE}`)).rejects.toThrow();
  });

  it('closes the listener on timeout and rejects with a timeout error', async () => {
    const l = await listen({ timeoutMs: 30 });
    await expect(l.code).rejects.toThrow(/timed out/i);
    expect(await refused(l.port)).toBe(true);
  });

  it('surfaces a provider error without a code as a failure', async () => {
    const l = await listen();
    const res = await get(
      l.port,
      `/callback?error=access_denied&error_description=user%20declined&state=${STATE}`,
    );
    expect(res.status).toBe(400);
    await expect(l.code).rejects.toThrow('access_denied: user declined');
  });

  it('answers other paths with 404 and stays open for the real callback', async () => {
    const l = await listen();
    expect((await get(l.port, '/favicon.ico')).status).toBe(404);
    expect((await get(l.port, `/callback?code=late&state=${STATE}`)).status).toBe(200);
    await expect(l.code).resolves.toBe('late');
  });

  it('cancel() closes the listener and rejects with LoginCancelledError', async () => {
    const l = await listen();
    l.cancel();
    l.cancel(); // idempotent
    await expect(l.code).rejects.toBeInstanceOf(LoginCancelledError);
    expect(await refused(l.port)).toBe(true);
  });

  it('reports a busy fixed port instead of binding elsewhere', async () => {
    const first = await listen();
    await expect(startLoopback({ path: '/callback', state: STATE, port: first.port })).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
  });
});
