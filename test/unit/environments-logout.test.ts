import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useDockerRunner, type DockerResult } from '../../src/main/docker-client';
import * as environments from '../../src/main/environments';
import { providers, requireProvider } from '../../src/main/providers';
import { account as claudeAccount } from '../../src/main/providers/claude-oauth';

// The container side of the logout fence: the credential file Puck mirrored
// into a container must not outlive the sign-out - whether the container is
// running (purged at logout), stopped (cleaned at its next start), or in the
// middle of receiving a copy (undone right after).

const calls: string[][] = [];
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'puck-ws-'));
const claude = requireProvider('claude-code');
const CRED = claude.container.credential.containerPath;

/** Container names the scripted docker reports as running. */
let running = new Set<string>();
let rmFails = false;
/** Fires when the scripted docker sees a credential copy land. */
let onCredentialCopy: (() => void) | null = null;

const isRm = (a: string[]): boolean => a[0] === 'exec' && a[2] === 'rm' && a[4] === CRED;

beforeAll(() => {
  for (const key of providers.flatMap((p) => p.container.forwardedEnvKeys)) {
    delete process.env[key];
  }
  useDockerRunner(async (args): Promise<DockerResult> => {
    calls.push(args);
    if (args[0] === 'inspect') {
      return running.has(args[args.length - 1])
        ? { code: 0, stdout: 'true\n', stderr: '' }
        : { code: 1, stdout: '', stderr: 'No such object' };
    }
    if (args[0] === 'exec' && args[2] === 'cat') return { code: 1, stdout: '', stderr: 'No such file' };
    if (isRm(args) && rmFails) return { code: 1, stdout: '', stderr: 'permission denied' };
    if (args[0] === 'cp' && args[2].endsWith(CRED)) onCredentialCopy?.();
    return { code: 0, stdout: '', stderr: '' };
  });
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  void claudeAccount.logout();
});

async function createEnv(name: string): Promise<string> {
  const list = await environments.create({
    name,
    image: 'node:22-bookworm',
    workspacePath: workspace,
    autoInstall: false,
    dockerfile: '',
    envVars: {},
  });
  return list[list.length - 1].id;
}

describe('logout fence: container credentials', () => {
  it('purgeCredentials removes the mirror from every running environment, and only those', async () => {
    const up = await createEnv('up');
    const down = await createEnv('down');
    running = new Set([environments.containerName(up)]);
    calls.length = 0;

    await environments.purgeCredentials(claude);

    const rms = calls.filter(isRm);
    expect(rms).toEqual([['exec', environments.containerName(up), 'rm', '-f', CRED]]);
    expect(calls.some((a) => a[1] === environments.containerName(down) && a[0] === 'exec')).toBe(false);
  });

  it('reports the environments it could not clean, by name and cause', async () => {
    rmFails = true;
    try {
      await expect(environments.purgeCredentials(claude)).rejects.toThrow(
        /Signed out, but the Claude Code credential file could not be removed from environment up: permission denied/,
      );
    } finally {
      rmFails = false;
    }
  });

  it('start removes a stale mirror when Puck is signed out and there is no host copy', async () => {
    const id = await createEnv('cold');
    running = new Set(); // "missing": the start creates the container
    calls.length = 0;
    await environments.start(id);
    for (const p of providers) {
      const cred = p.container.credential;
      expect(cred.signedIn(), `${p.id} has no Puck tokens in this test`).toBe(false);
      // The host CLI file is the user's own login and is copied as before;
      // only without one is a leftover mirror removed. Machine-dependent, so
      // assert the branch that applies here.
      const hostCopy = fs.existsSync(cred.hostPath);
      const rm = calls.some((a) => a[0] === 'exec' && a[2] === 'rm' && a[4] === cred.containerPath);
      const cp = calls.some((a) => a[0] === 'cp' && a[1] === cred.hostPath);
      expect(rm, `${p.id}: stale mirror removed`).toBe(!hostCopy);
      expect(cp, `${p.id}: host copy taken`).toBe(hostCopy);
    }
  });

  it('a credential copy that a sign-out raced is undone right after it lands', async () => {
    const id = await createEnv('racy');
    running = new Set([environments.containerName(id)]);
    claudeAccount.save({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 60 * 60_000, // fresh: no refresh call
      scopes: ['user:inference'],
    });
    // The sign-out lands while `docker cp` is in flight.
    onCredentialCopy = () => void claudeAccount.logout();
    calls.length = 0;
    try {
      await environments.injectCredentialsIntoRunning();
    } finally {
      onCredentialCopy = null;
    }
    const cp = calls.findIndex((a) => a[0] === 'cp' && a[2].endsWith(CRED));
    const rm = calls.findIndex(isRm);
    expect(cp).toBeGreaterThan(-1);
    expect(rm).toBeGreaterThan(cp); // the copy is followed by its own removal
    expect(claudeAccount.load()).toBeNull();
  });

  it('a sign-out before the copy skips it entirely', async () => {
    const id = await createEnv('early');
    running = new Set([environments.containerName(id)]);
    claudeAccount.save({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 60 * 60_000,
      scopes: ['user:inference'],
    });
    await claudeAccount.logout();
    calls.length = 0;
    await environments.injectCredentialsIntoRunning();
    expect(calls.some((a) => a[0] === 'cp' && a[2].endsWith(CRED))).toBe(false);
  });
});
