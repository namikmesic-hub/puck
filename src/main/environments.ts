/**
 * Environment primitive (main process).
 *
 * An environment is a named, persistent Docker container the harness runs
 * inside: the provider CLI (claude / codex) executes there via `docker exec`,
 * with a host directory mounted at /workspace. Config persists in userData.
 */

import { app } from 'electron';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { EnvironmentConfig, EnvironmentInfo } from '../harness/bridge';
import { RUNNER_SOURCE } from './runner-source';
import { providers, type Provider } from './providers';
import { deleteSecret, loadSecret, saveSecret } from './secrets';
import { readJson, writeJsonAtomic } from './jsonstore';

interface StoredEnv extends EnvironmentConfig {
  id: string;
}

interface Store {
  environments: StoredEnv[];
  activeEnvId: string | null;
}

/** Host auth material forwarded into containers at creation time. */
const FORWARDED_ENV = providers.flatMap((p) => p.container.forwardedEnvKeys);

// CLIs for interactive use (docker exec -it … codex login), SDKs for the
// runner agent under /opt/puck. Derived from the provider registry.
const CLI_BOOTSTRAP =
  providers.map((p) => `command -v ${p.container.cliBin} >/dev/null 2>&1`).join(' && ') +
  ' || npm install -g ' +
  providers.flatMap((p) => p.container.cliPackages).join(' ');
const SDK_BOOTSTRAP =
  providers
    .flatMap((p) => p.container.sdkPackages)
    .map((pkg) => `[ -d /opt/puck/node_modules/${pkg} ]`)
    .join(' && ') +
  ' || npm install --prefix /opt/puck ' +
  providers.flatMap((p) => p.container.sdkPackages).join(' ');

let store: Store | null = null;

function storePath(): string {
  return path.join(app.getPath('userData'), 'puck-environments.json');
}

function load(): Store {
  if (!store) {
    store = readJson<Store>(storePath()) ?? { environments: [], activeEnvId: null };
  }
  return store;
}

function save(): void {
  if (store) void writeJsonAtomic(storePath(), store);
}

/** Every fs/docker-touching operation must name an environment we manage. */
function requireEnv(id: string): StoredEnv {
  const env = load().environments.find((e) => e.id === id);
  if (!env) throw new Error('Unknown environment');
  return env;
}

export function containerName(id: string): string {
  return `puck-env-${id}`;
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

/** A wedged Docker daemon must produce an error, not a forever-pending UI. */
function docker(
  args: string[],
  timeoutMs = 20_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('docker', args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      stderr = `docker ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s — is Docker running?`;
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr = (stderr + String(d)).slice(-4000)));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err.message) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function containerState(id: string): Promise<'running' | 'stopped' | 'missing'> {
  const r = await docker(['inspect', '-f', '{{.State.Running}}', containerName(id)]);
  if (r.code !== 0) return 'missing';
  return r.stdout.trim() === 'true' ? 'running' : 'stopped';
}

export async function runtimeStatus(id: string): Promise<'running' | 'stopped'> {
  return (await containerState(id)) === 'running' ? 'running' : 'stopped';
}

/* ---------- Per-environment secrets (values encrypted at rest) ---------- */

function secretsStoreName(id: string): string {
  // Ids are validated at the IPC boundary; basename() is defense in depth
  // against path traversal ever reaching the secret store.
  return path.basename(`env-secrets-${id}.bin`);
}

function envSecrets(id: string): Record<string, string> {
  const json = loadSecret(secretsStoreName(id));
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function secretSet(id: string, key: string, value: string): Promise<EnvironmentInfo[]> {
  requireEnv(id);
  const cleaned = key.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleaned)) {
    throw new Error('Secret names must look like environment variable names (A-Z, 0-9, _).');
  }
  const secrets = envSecrets(id);
  secrets[cleaned] = value;
  saveSecret(secretsStoreName(id), JSON.stringify(secrets));
  if ((await runtimeStatus(id)) === 'running') await injectSecretsFile(id);
  return list();
}

export async function secretDelete(id: string, key: string): Promise<EnvironmentInfo[]> {
  requireEnv(id);
  const secrets = envSecrets(id);
  delete secrets[key];
  saveSecret(secretsStoreName(id), JSON.stringify(secrets));
  if ((await runtimeStatus(id)) === 'running') await injectSecretsFile(id);
  return list();
}

async function toInfo(env: StoredEnv): Promise<EnvironmentInfo> {
  return {
    ...env,
    dockerfile: env.dockerfile ?? '',
    envVars: env.envVars ?? {},
    status: await runtimeStatus(env.id),
    active: env.id === load().activeEnvId,
    secretKeys: Object.keys(envSecrets(env.id)).sort(),
  };
}

export async function list(): Promise<EnvironmentInfo[]> {
  return Promise.all(load().environments.map(toInfo));
}

function sanitize(cfg: EnvironmentConfig, id: string): Omit<StoredEnv, 'id'> {
  return {
    name: cfg.name.trim() || 'environment',
    image: cfg.image.trim() || 'node:22-bookworm',
    workspacePath:
      cfg.workspacePath.trim() || path.join(os.homedir(), 'puck-workspaces', id),
    autoInstall: cfg.autoInstall,
    dockerfile: cfg.dockerfile ?? '',
    envVars: cfg.envVars ?? {},
  };
}

export async function create(cfg: EnvironmentConfig): Promise<EnvironmentInfo[]> {
  const s = load();
  const id = crypto.randomUUID();
  s.environments.push({ id, ...sanitize(cfg, id) });
  if (!s.activeEnvId) s.activeEnvId = id;
  save();
  return list();
}

export async function update(id: string, cfg: EnvironmentConfig): Promise<EnvironmentInfo[]> {
  const s = load();
  const idx = s.environments.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error('Unknown environment');
  s.environments[idx] = { id, ...sanitize(cfg, id) };
  save();
  return list();
}

function imageTag(id: string): string {
  return `puck-img-${id}`;
}

/** Notified when an environment's container state is destroyed (rebuild /
 *  remove) — the backend drops that environment's resume ids. */
let onReset: ((envId: string) => void) | null = null;
export function onEnvReset(cb: (envId: string) => void): void {
  onReset = cb;
}

// One mutex per environment across ALL lifecycle ops: a queued start must
// not resurrect a just-deleted container, and rm must not race a doStart.
const envLocks = new Map<string, Promise<unknown>>();
function withEnvLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = envLocks.get(id) ?? Promise.resolve();
  const task = prev.catch(() => undefined).then(fn);
  envLocks.set(id, task);
  void task.catch(() => undefined).finally(() => {
    if (envLocks.get(id) === task) envLocks.delete(id);
  });
  return task;
}

export function start(id: string): Promise<EnvironmentInfo[]> {
  return withEnvLock(id, () => doStart(id));
}

export function stop(id: string): Promise<EnvironmentInfo[]> {
  return withEnvLock(id, async () => {
    requireEnv(id);
    await doStop(id);
    return list();
  });
}

export function restart(id: string): Promise<EnvironmentInfo[]> {
  return withEnvLock(id, async () => {
    requireEnv(id);
    await doStop(id);
    return doStart(id);
  });
}

/** Destroy the container and recreate from current config (incl. build). */
export function rebuild(id: string): Promise<EnvironmentInfo[]> {
  return withEnvLock(id, async () => {
    requireEnv(id);
    await doStop(id); // adopts rotated credentials; ignores not-running
    await docker(['rm', '-f', containerName(id)]);
    onReset?.(id); // container transcripts are gone — resume ids with them
    return doStart(id);
  });
}

export function remove(id: string): Promise<EnvironmentInfo[]> {
  return withEnvLock(id, async () => {
    requireEnv(id);
    await docker(['rm', '-f', containerName(id)]);
    await docker(['rmi', imageTag(id)]);
    deleteSecret(secretsStoreName(id));
    const s = load();
    s.environments = s.environments.filter((e) => e.id !== id);
    if (s.activeEnvId === id) s.activeEnvId = s.environments[0]?.id ?? null;
    save();
    onReset?.(id);
    return list();
  });
}

async function doStart(id: string): Promise<EnvironmentInfo[]> {
  const env = load().environments.find((e) => e.id === id);
  if (!env) throw new Error('Unknown environment');

  const state = await containerState(id);
  if (state === 'missing') {
    // Build the per-environment image when a Dockerfile is configured.
    let image = env.image;
    if (env.dockerfile?.trim()) {
      const ctx = fs.mkdtempSync(path.join(os.tmpdir(), 'puck-build-'));
      fs.writeFileSync(path.join(ctx, 'Dockerfile'), env.dockerfile);
      const build = await docker(['build', '-t', imageTag(id), ctx], 10 * 60_000);
      if (build.code !== 0) {
        throw new Error(`Docker build failed: ${build.stderr.trim().slice(-600)}`);
      }
      image = imageTag(id);
    }

    const workspace = expandHome(env.workspacePath);
    fs.mkdirSync(workspace, { recursive: true });
    const args = [
      'run', '-d',
      '--name', containerName(id),
      '--label', 'puck=environment',
      '-v', `${workspace}:/workspace`,
      '-w', '/workspace',
    ];
    // Provider-declared container env (e.g. Claude Code's IS_SANDBOX=1).
    for (const p of providers) {
      for (const [key, value] of Object.entries(p.container.containerEnv)) {
        args.push('-e', `${key}=${value}`);
      }
    }
    // Host CLI state dirs (~/.claude, ~/.codex) are deliberately NOT mounted:
    // the container runs with full tool access, and a writable mount would let
    // an agent plant host-side hooks/settings that execute outside the sandbox
    // (and colima doesn't share $HOME anyway). Credentials arrive via docker
    // cp below; transcripts/session state stay container-local.
    for (const key of FORWARDED_ENV) {
      if (process.env[key]) args.push('-e', `${key}=${process.env[key]}`);
    }
    // User-configured env vars. Secrets deliberately do NOT go through -e:
    // docker inspect would expose them forever — they travel as a root-only
    // file the runner applies to its own environment (injectSecretsFile).
    for (const [key, value] of Object.entries(env.envVars ?? {})) {
      args.push('-e', `${key}=${value}`);
    }
    // `--` ends option parsing so a hostile image string can't become a flag.
    args.push('--', image, 'sleep', 'infinity');
    const r = await docker(args, 120_000);
    if (r.code !== 0) {
      throw new Error(r.stderr.trim() || 'docker run failed — is Docker running?');
    }
  } else if (state === 'stopped') {
    const r = await docker(['start', containerName(id)]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'docker start failed');
  }

  await docker(['exec', containerName(id), 'mkdir', '-p', '/opt/puck']);
  if (env.autoInstall) {
    for (const script of [CLI_BOOTSTRAP, SDK_BOOTSTRAP]) {
      const r = await docker(['exec', containerName(id), 'sh', '-lc', script], 10 * 60_000);
      if (r.code !== 0) {
        throw new Error(`Environment bootstrap failed: ${r.stderr.trim().slice(-400)}`);
      }
    }
  }

  // Copy file-based CLI credentials from the host. Bind mounts are not
  // reliable for this across Docker runtimes (a colima VM without $HOME
  // sharing silently yields empty dirs), so docker cp on every start.
  for (const p of providers) {
    const cred = p.container.credential;
    if (!fs.existsSync(cred.hostPath)) continue;
    const dest = path.posix.dirname(cred.containerPath) + '/';
    await docker(['exec', containerName(id), 'mkdir', '-p', dest]);
    await docker(['cp', cred.hostPath, `${containerName(id)}:${dest}`]);
  }

  // Deploy (or refresh) the runner agent.
  const runnerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puck-runner-'));
  try {
    const runnerTmp = path.join(runnerDir, 'runner.js');
    fs.writeFileSync(runnerTmp, RUNNER_SOURCE, { mode: 0o600 });
    const cp = await docker(['cp', runnerTmp, `${containerName(id)}:/opt/puck/runner.js`]);
    if (cp.code !== 0) throw new Error(`Runner deploy failed: ${cp.stderr.trim().slice(-400)}`);
  } finally {
    fs.rmSync(runnerDir, { recursive: true, force: true });
  }

  await injectSecretsFile(id);
  // Puck-managed OAuth tokens win over host files when fresher.
  for (const p of providers) await injectCredentials(id, p);
  return list();
}

/** Environment secrets as a root-only container file (never docker argv). */
async function injectSecretsFile(id: string): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puck-secrets-'));
  try {
    const tmp = path.join(tmpDir, 'secrets.json');
    fs.writeFileSync(tmp, JSON.stringify(envSecrets(id)), { mode: 0o600 });
    await docker(['exec', containerName(id), 'mkdir', '-p', '/opt/puck']);
    await docker(['cp', tmp, `${containerName(id)}:/opt/puck/secrets.json`]);
    await docker(['exec', containerName(id), 'chmod', '600', '/opt/puck/secrets.json']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Write Puck-managed OAuth tokens into a container as the provider's CLI
 * credential file — unless the container already holds fresher ones (CLIs
 * rotate tokens themselves mid-session, which we adopt back).
 */
async function injectCredentials(id: string, p: Provider): Promise<void> {
  const cred = p.container.credential;
  const snapshot = await cred.fresh();
  if (!snapshot) return;
  const existing = await docker(['exec', containerName(id), 'cat', cred.containerPath]);
  if (existing.code === 0) {
    cred.adoptIfNewer(existing.stdout);
    if (!snapshot.supersedes(existing.stdout)) return;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puck-cred-'));
  try {
    const tmp = path.join(tmpDir, 'cred.json');
    fs.writeFileSync(tmp, snapshot.content, { mode: 0o600 });
    await docker(['exec', containerName(id), 'mkdir', '-p', path.posix.dirname(cred.containerPath)]);
    await docker(['cp', tmp, `${containerName(id)}:${cred.containerPath}`]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Push freshly obtained credentials into every running environment. */
export async function injectCredentialsIntoRunning(): Promise<void> {
  for (const env of load().environments) {
    if ((await runtimeStatus(env.id)) === 'running') {
      for (const p of providers) await injectCredentials(env.id, p);
    }
  }
}

async function doStop(id: string): Promise<void> {
  // Providers may have rotated tokens inside the container — adopt them
  // before the container goes away so Puck's copies stay valid.
  for (const p of providers) {
    const creds = await docker(['exec', containerName(id), 'cat', p.container.credential.containerPath]);
    if (creds.code === 0) p.container.credential.adoptIfNewer(creds.stdout);
  }
  await docker(['stop', containerName(id)], 60_000);
}

export function select(id: string): void {
  const s = load();
  if (s.environments.some((e) => e.id === id)) {
    s.activeEnvId = id;
    save();
  }
}

export function activeEnv(): StoredEnv | null {
  const s = load();
  return s.environments.find((e) => e.id === s.activeEnvId) ?? null;
}
