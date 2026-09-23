// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnvironmentInfo, PuckBridge } from '../../src/harness/bridge';
import { initEnvEditor, type EnvEditorElements } from '../../src/renderer/settings/env-editor';

const NOW = 1_700_000_000_000;

function envInfo(over: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    id: 'env-1',
    name: 'dev',
    image: 'node:22-bookworm',
    workspacePath: '/tmp/ws',
    autoInstall: true,
    dockerfile: '',
    envVars: { FOO: 'bar' },
    status: 'ready',
    stage: null,
    detail: '',
    startedAt: NOW - 45_000,
    endedAt: NOW - 1_000,
    error: null,
    active: true,
    secretKeys: ['API_KEY'],
    ...over,
  };
}

afterEach(() => vi.useRealTimers());

function mount(bridgeOver: Partial<PuckBridge> = {}) {
  const bridge = {
    envUpdate: vi.fn(async () => [envInfo({ name: 'renamed' })]),
    envSecretSet: vi.fn(async () => [envInfo({ secretKeys: ['API_KEY', 'NEW_KEY'] })]),
    envSecretDelete: vi.fn(async () => [envInfo({ secretKeys: [] })]),
    envDelete: vi.fn(async () => []),
    envList: vi.fn(async () => [envInfo()]),
    envSelect: vi.fn(async () => ({}) as never),
    ...bridgeOver,
  } as unknown as PuckBridge;

  const els = {
    title: document.createElement('div'),
    status: document.createElement('div'),
    progress: document.createElement('div'),
    controls: document.createElement('div'),
    msg: document.createElement('div'),
    back: document.createElement('button'),
    name: document.createElement('input'),
    image: document.createElement('input'),
    workspace: document.createElement('input'),
    autoInstall: document.createElement('input'),
    dockerfile: document.createElement('textarea'),
    envVars: document.createElement('div'),
    envKey: document.createElement('input'),
    envVal: document.createElement('input'),
    envAdd: document.createElement('button'),
    secrets: document.createElement('div'),
    secretKey: document.createElement('input'),
    secretVal: document.createElement('input'),
    secretAdd: document.createElement('button'),
    save: document.createElement('button'),
  } satisfies EnvEditorElements;
  els.autoInstall.type = 'checkbox';

  const ctx = {
    bridge,
    els,
    applyStatus: vi.fn(),
    refreshStatus: vi.fn(() => Promise.resolve()),
    showView: vi.fn(),
    navToEnvs: vi.fn(),
  };
  const editor = initEnvEditor(ctx);
  return { editor, els, bridge, ctx };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('env editor', () => {
  it('open() populates the form, kv lists, and header, then reveals the view', () => {
    const { editor, els, ctx } = mount();
    editor.open(envInfo());
    expect(els.name.value).toBe('dev');
    expect(els.image.value).toBe('node:22-bookworm');
    expect(els.workspace.value).toBe('/tmp/ws');
    expect(els.autoInstall.checked).toBe(true);
    expect(els.envVars.querySelector('.kv-key')?.textContent).toBe('FOO');
    expect(els.secrets.querySelector('.kv-key')?.textContent).toBe('API_KEY');
    expect(els.secrets.querySelector('.kv-val')?.textContent).toBe('••••••••'); // values never shown
    expect(els.title.textContent).toBe('dev');
    expect(els.status.querySelector('.badge-active')).toBeTruthy();
    expect(els.controls.querySelectorAll('button').length).toBeGreaterThan(0); // op rail present
    expect(ctx.showView).toHaveBeenCalled();
  });

  it('adds and removes env vars locally, then saves the edited config', async () => {
    const { editor, els, bridge } = mount();
    editor.open(envInfo());

    els.envKey.value = ' NEW_VAR ';
    els.envVal.value = 'v';
    els.envAdd.click();
    expect([...els.envVars.querySelectorAll('.kv-key')].map((n) => n.textContent)).toEqual([
      'FOO',
      'NEW_VAR',
    ]);
    expect(els.envKey.value).toBe(''); // inputs reset for the next pair

    (els.envVars.querySelector('.kv-remove') as HTMLButtonElement).click(); // drop FOO
    els.save.click();
    await tick();
    expect(bridge.envUpdate).toHaveBeenCalledWith('env-1', {
      name: 'dev',
      image: 'node:22-bookworm',
      workspacePath: '/tmp/ws',
      autoInstall: true,
      dockerfile: '',
      envVars: { NEW_VAR: 'v' },
    });
    expect(els.title.textContent).toBe('renamed'); // header re-rendered from the result
  });

  it('secret add round-trips through the bridge and renders the returned keys', async () => {
    const { editor, els, bridge } = mount();
    editor.open(envInfo());
    els.secretKey.value = 'NEW_KEY';
    els.secretVal.value = 's3cret';
    els.secretAdd.click();
    await tick();
    expect(bridge.envSecretSet).toHaveBeenCalledWith('env-1', 'NEW_KEY', 's3cret');
    expect([...els.secrets.querySelectorAll('.kv-key')].map((n) => n.textContent)).toEqual([
      'API_KEY',
      'NEW_KEY',
    ]);
    expect(els.secretVal.value).toBe(''); // the secret never lingers in the input
  });

  it('surfaces save failures in the msg slot and re-enables the button', async () => {
    const { editor, els } = mount({
      envUpdate: vi.fn(async () => {
        throw new Error('docker is down');
      }),
    });
    editor.open(envInfo());
    els.save.click();
    await tick();
    expect(els.msg.textContent).toBe('docker is down');
    expect(els.save.disabled).toBe(false);
  });

  it('abandon() and forget() block a lingering save', async () => {
    const { editor, els, bridge } = mount();
    editor.open(envInfo());
    editor.abandon();
    els.save.click();
    await tick();
    expect(bridge.envUpdate).not.toHaveBeenCalled();

    editor.open(envInfo());
    editor.forget('other-env'); // not the open one — keeps editing
    els.save.click();
    await tick();
    expect(bridge.envUpdate).toHaveBeenCalledTimes(1);
    editor.forget('env-1'); // the open env died elsewhere
    els.save.click();
    await tick();
    expect(bridge.envUpdate).toHaveBeenCalledTimes(1);
  });

  it('back navigates to the envs section', () => {
    const { els, ctx } = mount();
    els.back.click();
    expect(ctx.navToEnvs).toHaveBeenCalled();
  });
});

const railLabels = (els: EnvEditorElements): string[] =>
  [...els.controls.querySelectorAll('button')].map((b) => b.textContent ?? '');
const lineText = (host: HTMLElement): string | undefined =>
  host.querySelector('.env-progress-line')?.textContent ?? undefined;

describe('env editor header: lifecycle chip, progress, and op rail per status', () => {
  it('ready: green chip, "started in" line, Stop / Restart / Rebuild', () => {
    vi.useFakeTimers({ now: NOW });
    const { editor, els } = mount();
    editor.open(envInfo());
    const chip = els.status.querySelector('.status') as HTMLElement;
    expect(chip.textContent).toBe('ready');
    expect(chip.classList.contains('on')).toBe(true);
    expect(els.progress.querySelector('.env-progress-line')?.textContent).toBe('ready · started in 44s');
    expect(railLabels(els)).toEqual(['Stop', 'Restart', 'Rebuild']);
  });

  it('starting: pulsing chip, stage · elapsed + last output line, only Stop (cancels)', () => {
    vi.useFakeTimers({ now: NOW });
    const { editor, els } = mount();
    editor.open(
      envInfo({
        status: 'starting',
        stage: 'pulling-image',
        detail: 'a1b2c3: Downloading',
        startedAt: NOW - 12_000,
        endedAt: null,
      }),
    );
    const chip = els.status.querySelector('.status') as HTMLElement;
    expect(chip.textContent).toBe('starting');
    expect(chip.classList.contains('busy')).toBe(true);
    expect(els.progress.querySelector('.env-progress-line')?.textContent).toBe('pulling image · 12s');
    expect(els.progress.querySelector('.env-progress-detail')?.textContent).toBe('a1b2c3: Downloading');
    expect(railLabels(els)).toEqual(['Stop']);
    expect((els.controls.querySelector('button') as HTMLButtonElement).title).toMatch(/Cancel the start/);
  });

  it('failed: red chip, the failing stage and elapsed, the error text, Start / Rebuild / Delete', () => {
    vi.useFakeTimers({ now: NOW });
    const { editor, els } = mount();
    editor.open(
      envInfo({
        status: 'failed',
        stage: 'installing-sdks',
        startedAt: NOW - 72_000,
        endedAt: NOW - 2_000,
        error: 'Environment bootstrap failed (installing provider SDKs): npm ERR! ETIMEDOUT',
      }),
    );
    const chip = els.status.querySelector('.status') as HTMLElement;
    expect(chip.classList.contains('bad')).toBe(true);
    expect(els.progress.classList.contains('failed')).toBe(true);
    expect(els.progress.querySelector('.env-progress-line')?.textContent).toBe(
      'failed while installing provider SDKs · after 1m 10s',
    );
    expect(els.progress.querySelector('.env-progress-detail')?.textContent).toMatch(/npm ERR! ETIMEDOUT/);
    expect(railLabels(els)).toEqual(['Start', 'Rebuild', 'Delete']);
  });

  it('stopping offers no ops; stopped shows an external-stop detail when there is one', () => {
    const { editor, els } = mount();
    editor.open(envInfo({ status: 'stopping', stage: 'stopping-container', endedAt: null }));
    expect(railLabels(els)).toEqual([]);
    editor.open(envInfo({ status: 'stopped', detail: 'container stopped outside Puck', active: false }));
    expect(railLabels(els)).toEqual(['Select', 'Start', 'Rebuild', 'Delete']);
    expect(els.progress.querySelector('.env-progress-line')?.textContent).toBe('container stopped outside Puck');
  });

  it('update() re-renders the header for the open environment only and never touches the form', () => {
    vi.useFakeTimers({ now: NOW });
    const { editor, els } = mount();
    editor.open(envInfo({ status: 'starting', stage: 'checking-image', startedAt: NOW, endedAt: null }));
    els.name.value = 'mid-edit';
    editor.update(envInfo({ id: 'other', status: 'failed', error: 'nope' }));
    expect(els.status.textContent).toBe('startingactive'); // untouched by another env's push
    editor.update(envInfo({ status: 'starting', stage: 'deploying-runner', detail: '/opt/puck/runner.js', startedAt: NOW, endedAt: null }));
    expect(lineText(els.progress)).toBe('deploying runner · 0s');
    expect(els.name.value).toBe('mid-edit');
    editor.update(envInfo({ status: 'ready', startedAt: NOW, endedAt: NOW + 30_000 }));
    expect(railLabels(els)).toEqual(['Stop', 'Restart', 'Rebuild']);
  });

  it('tick() advances the elapsed time between pushes', () => {
    vi.useFakeTimers({ now: NOW });
    const { editor, els } = mount();
    editor.open(envInfo({ status: 'starting', stage: 'installing-clis', startedAt: NOW - 5_000, endedAt: null }));
    expect(lineText(els.progress)).toBe('installing provider CLIs · 5s');
    editor.tick(NOW + 60_000);
    expect(lineText(els.progress)).toBe('installing provider CLIs · 1m 05s');
    editor.abandon();
    editor.tick(NOW + 120_000); // nothing shown any more — must not throw or repaint
    expect(lineText(els.progress)).toBe('installing provider CLIs · 1m 05s');
  });
});
