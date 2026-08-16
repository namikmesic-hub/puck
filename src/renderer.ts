/**
 * Renderer entry point: chat frontend for the Puck harness.
 *
 * Turns run in the main process — the active provider (Claude Code or Codex)
 * executes inside a Docker environment container — and stream back as
 * `HarnessEvent`s over the preload bridge (see src/harness/bridge.ts).
 */

import './index.css';
import './harness/bridge';
import { armDelete, el, flashSaved, showToast, statusEl } from './renderer/dom';
import { dayLabel, fmtClock, fmtTime, fmtTokens, relTime } from './renderer/format';
import { renderMd } from './renderer/markdown';
import { IpcHarness } from './harness/ipc';
import type {
  AgentInfo,
  ConversationEntry,
  EnvironmentInfo,
  HarnessStatus,
  ProviderInfo,
  PuckBridge,
} from './harness/bridge';
import { AskQuestion, TurnStats } from './harness/types';

/** Provider metadata cache — labels, hints, capabilities come from main. */
let providersById = new Map<string, ProviderInfo>();

async function loadProviders(): Promise<ProviderInfo[]> {
  const infos = (await bridge?.providers().catch(() => [])) ?? [];
  if (infos.length) providersById = new Map(infos.map((p) => [p.id, p]));
  return infos;
}

function providerLabel(id: string): string {
  return providersById.get(id)?.label ?? id;
}

const bridge: PuckBridge | undefined = window.puck;
const harness = bridge ? new IpcHarness(bridge, 'puck') : null;

const stage = document.getElementById('stage') as HTMLElement;
const chat = document.getElementById('chat') as HTMLElement;
const composer = document.getElementById('composer') as HTMLFormElement;
const prompt = document.getElementById('prompt') as HTMLTextAreaElement;
const send = document.getElementById('send') as HTMLButtonElement;
const recentsList = document.getElementById('recents') as HTMLUListElement;
const addAgentBtn = document.getElementById('add-agent') as HTMLButtonElement;
const chatHead = document.getElementById('chat-head') as HTMLElement;
const chatHeadName = document.getElementById('chat-head-name') as HTMLElement;
const chatHeadTag = document.getElementById('chat-head-tag') as HTMLElement;
const turnFullBack = document.getElementById('turn-full-back') as HTMLButtonElement;
const turnFullCrumb = document.getElementById('turn-full-crumb') as HTMLElement;
const turnFullTitle = document.getElementById('turn-full-title') as HTMLElement;
const turnFullBody = document.getElementById('turn-full-body') as HTMLElement;
const openSettingsBtn = document.getElementById('open-settings') as HTMLButtonElement;
const settingsBack = document.getElementById('settings-back') as HTMLButtonElement;
const composerEl = document.getElementById('composer') as HTMLElement;
const envselBtn = document.getElementById('envsel-btn') as HTMLButtonElement;
const envselDot = document.getElementById('envsel-dot') as HTMLElement;
const envselName = document.getElementById('envsel-name') as HTMLElement;
const agentCards = document.getElementById('agent-cards') as HTMLElement;
const agentMsg = document.getElementById('agent-msg') as HTMLElement;
const agentDetailView = document.getElementById('agent-detail-view') as HTMLElement;
const agentBack = document.getElementById('agent-back') as HTMLButtonElement;
const agentTitle = document.getElementById('agent-title') as HTMLElement;
const agentStatus = document.getElementById('agent-status') as HTMLElement;
const agentControls = document.getElementById('agent-controls') as HTMLElement;
const agentDetailMsg = document.getElementById('agent-detail-msg') as HTMLElement;
const aName = document.getElementById('a-name') as HTMLInputElement;
const aProvider = document.getElementById('a-provider') as HTMLSelectElement;
const aModel = document.getElementById('a-model') as HTMLInputElement;
const aModelOptions = document.getElementById('a-model-options') as HTMLDataListElement;
const aThinking = document.getElementById('a-thinking') as HTMLSelectElement;
const aSystem = document.getElementById('a-system') as HTMLTextAreaElement;
const aSystemHint = document.getElementById('a-system-hint') as HTMLElement;
const aAdvanced = document.getElementById('a-advanced') as HTMLTextAreaElement;
const aSave = document.getElementById('a-save') as HTMLButtonElement;
const heroSubtitle = document.getElementById('hero-subtitle') as HTMLElement;
const heroTitle = document.getElementById('hero-title') as HTMLElement;
const heroAvatar = document.getElementById('hero-avatar') as HTMLElement;
const heroCta = document.getElementById('hero-cta') as HTMLButtonElement;

const USER_NAME = 'Feynman';
const settingsView = document.getElementById('settings-view') as HTMLElement;
const providerCards = document.getElementById('provider-cards') as HTMLElement;
const envCards = document.getElementById('env-cards') as HTMLElement;
const envMsg = document.getElementById('env-msg') as HTMLElement;
const providerMsg = document.getElementById('provider-msg') as HTMLElement;
const envDetailView = document.getElementById('env-detail-view') as HTMLElement;
const detailBack = document.getElementById('detail-back') as HTMLButtonElement;
const detailTitle = document.getElementById('detail-title') as HTMLElement;
const detailStatus = document.getElementById('detail-status') as HTMLElement;
const detailControls = document.getElementById('detail-controls') as HTMLElement;
const detailMsg = document.getElementById('detail-msg') as HTMLElement;
const dName = document.getElementById('d-name') as HTMLInputElement;
const dImage = document.getElementById('d-image') as HTMLInputElement;
const dWorkspace = document.getElementById('d-workspace') as HTMLInputElement;
const dAutoInstall = document.getElementById('d-autoinstall') as HTMLInputElement;
const dDockerfile = document.getElementById('d-dockerfile') as HTMLTextAreaElement;
const dEnvVars = document.getElementById('d-envvars') as HTMLElement;
const dEnvKey = document.getElementById('d-env-key') as HTMLInputElement;
const dEnvVal = document.getElementById('d-env-val') as HTMLInputElement;
const dEnvAdd = document.getElementById('d-env-add') as HTMLButtonElement;
const dSecrets = document.getElementById('d-secrets') as HTMLElement;
const dSecretKey = document.getElementById('d-secret-key') as HTMLInputElement;
const dSecretVal = document.getElementById('d-secret-val') as HTMLInputElement;
const dSecretAdd = document.getElementById('d-secret-add') as HTMLButtonElement;
const dSave = document.getElementById('d-save') as HTMLButtonElement;

/** Persist a conversation's structured log; failures surface as a toast. */
function persistConversation(session: Session): void {
  if (!session.agentId || !bridge) return;
  if (session === mountedSession) session.draft = prompt.value;
  void bridge
    .convoSave(session.agentId, {
      log: session.log,
      usage: session.usage,
      lastActiveAt: session.lastActiveAt,
      turns: session.turns,
      draft: session.draft ?? '',
    })
    .catch((err: Error) => showToast(`Couldn't save "${session.title}": ${err.message}`));
}

const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced mid-turn save so a crash loses seconds, not the whole exchange. */
function schedulePersist(session: Session): void {
  if (!session.agentId) return;
  const key = session.agentId;
  if (persistTimers.has(key)) return;
  persistTimers.set(
    key,
    setTimeout(() => {
      persistTimers.delete(key);
      persistConversation(session);
    }, 2000),
  );
}

// Sticky scrolling: follow the stream only while the user is at the bottom.
let stickToBottom = true;
chat.addEventListener('scroll', () => {
  stickToBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 48;
});

function scrollChat(force = false): void {
  if (!force && !stickToBottom) return;
  chat.scrollTo({ top: chat.scrollHeight });
}

/* ---------- Markdown link containment ---------- */

// Chat anchors are sanitized in renderer/markdown.ts; clicks route to the
// system browser here — a link must never navigate the app window.
document.addEventListener('click', (e) => {
  const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
  if (!anchor) return;
  e.preventDefault();
  if (/^https?:\/\//i.test(anchor.href)) void bridge?.openExternal(anchor.href);
});

/* ---------- Harness status ---------- */

let lastProviderLabel = 'agent';

function applyStatus(s: HarnessStatus): void {
  lastProviderLabel = s.agent?.name ?? 'agent';
  envselName.textContent = s.environment?.name ?? 'no environment';
  envselDot.className =
    'dot-mini ' + (s.environment ? (s.environment.status === 'running' ? 'on' : 'off') : '');
  stage.classList.toggle('connected', !!s.environment && s.environment.status === 'running');
  const who = current.agentId ? current.title : 'your agent';
  if (!agentInfos.length) {
    heroSubtitle.textContent = 'Create an agent in Settings — every agent gets its own chat.';
  } else if (!s.environment) {
    heroSubtitle.textContent = 'Set up an environment in Settings, then just type.';
  } else if (s.environment.status !== 'running') {
    heroSubtitle.textContent = `Environment "${s.environment.name}" is stopped — start it from Settings.`;
  } else {
    heroSubtitle.textContent = `${who} in "${s.environment.name}" — real tool calls in a Docker sandbox.`;
  }
}

async function refreshStatus(): Promise<void> {
  if (!bridge) return;
  try {
    applyStatus(await bridge.status());
  } catch (err) {
    console.error('status refresh failed', err);
  }
}
void refreshStatus();

/* ---------- Dropdown menus (provider / model) ---------- */

let menu: HTMLElement | null = null;

function closeMenu(): void {
  menu?.remove();
  menu = null;
}

interface MenuItem {
  value: string;
  label: string;
  active?: boolean;
}

/** Drop-up menu anchored to a composer selector button. */
function openMenuUp(anchor: HTMLElement, items: MenuItem[], onPick: (value: string) => void): void {
  closeMenu();
  if (!items.length) return;
  menu = el('div', 'model-menu menu-up');
  menu.style.left = `${anchor.offsetLeft}px`;
  for (const entry of items) {
    const item = el('button', 'model-item' + (entry.active ? ' active' : ''), entry.label);
    item.type = 'button';
    item.addEventListener('click', () => {
      closeMenu();
      onPick(entry.value);
    });
    menu.appendChild(item);
  }
  composerEl.appendChild(menu);
}

envselBtn.addEventListener('click', async () => {
  if (!bridge || menu) return closeMenu();
  const envs = await bridge.envList().catch(() => []);
  const items: MenuItem[] = envs.map((e) => ({
    value: e.id,
    label: `${e.name}${e.status === 'running' ? '' : ' — stopped'}`,
    active: e.active,
  }));
  items.push({ value: '__manage', label: '⚙ Manage environments…' });
  openMenuUp(envselBtn, items, (value) => {
    if (value === '__manage') {
      settingsTab = 'envs';
      return showView('settings');
    }
    void bridge.envSelect(value).then(applyStatus);
  });
});

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (menu && !target.closest('.model-menu') && !target.closest('.picker')) closeMenu();
});

/* ---------- View switching (chat / environments / providers) ---------- */

type View = 'chat' | 'settings' | 'env-detail' | 'agent-detail';
type SettingsTab = 'agents' | 'providers' | 'envs';

const settingsTabs = document.getElementById('settings-tabs') as HTMLElement;
let settingsTab: SettingsTab = 'agents';

function showSettingsTab(tab: SettingsTab): void {
  settingsTab = tab;
  (document.getElementById('sec-agents') as HTMLElement).classList.toggle('hidden', tab !== 'agents');
  (document.getElementById('sec-providers') as HTMLElement).classList.toggle('hidden', tab !== 'providers');
  (document.getElementById('sec-envs') as HTMLElement).classList.toggle('hidden', tab !== 'envs');
  settingsTabs.querySelectorAll('.tab').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
  });
  if (tab === 'agents') {
    void renderAgents();
  } else if (tab === 'providers') {
    void renderProviders();
  } else {
    void renderEnvs();
  }
}

settingsTabs.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.tab') as HTMLElement | null;
  if (btn?.dataset.tab) showSettingsTab(btn.dataset.tab as SettingsTab);
});

let currentView: View = 'chat';

function showView(view: View): void {
  currentView = view;
  stage.classList.toggle('hidden', view !== 'chat');
  settingsView.classList.toggle('hidden', view !== 'settings');
  envDetailView.classList.toggle('hidden', view !== 'env-detail');
  agentDetailView.classList.toggle('hidden', view !== 'agent-detail');
  openSettingsBtn.classList.toggle('active', view !== 'chat');
  if (view === 'settings') {
    showSettingsTab(settingsTab);
  } else if (view === 'chat') {
    void refreshStatus();
    prompt.focus();
  }
}

// Escape walks back up the view hierarchy: detail → settings → chat.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (menu) return closeMenu();
  if (currentView === 'chat' && fullTurn) return closeFullTurn();
  if (currentView === 'agent-detail') {
    settingsTab = 'agents';
    showView('settings');
  } else if (currentView === 'env-detail') {
    settingsTab = 'envs';
    showView('settings');
  } else if (currentView === 'settings') {
    showView('chat');
  }
});

openSettingsBtn.addEventListener('click', () => showView('settings'));
settingsBack.addEventListener('click', () => showView('chat'));
heroCta.addEventListener('click', () => {
  settingsTab = 'envs';
  showView('settings');
});

/* ---------- Providers view ---------- */

let waitingAuthProvider: string | null = null;
let authPoll: ReturnType<typeof setInterval> | null = null;

function stopAuthPoll(): void {
  waitingAuthProvider = null;
  if (authPoll) clearInterval(authPoll);
  authPoll = null;
}

/* ---------- Agents (settings section + detail page) ---------- */

let detailAgentId: string | null = null;

async function renderAgents(): Promise<void> {
  if (!bridge) return;
  const infos = await bridge.agentList().catch(() => []);
  agentInfos = infos; // the sidebar roster follows Settings
  renderRecents();
  agentCards.textContent = '';
  for (const agent of infos) {
    const card = el('div', 'card clickable');
    const head = el('div', 'card-head');
    const title = el('span', 'card-title', agent.name);
    if (agent.active) title.appendChild(el('span', 'badge-active', 'active'));
    head.appendChild(title);
    head.appendChild(el('span', 'card-tag', providerLabel(agent.provider)));
    card.appendChild(head);
    card.appendChild(
      el(
        'div',
        'card-sub',
        `${agent.model} · thinking ${agent.thinking}` +
          (agent.systemPrompt.trim() ? ' · custom instructions' : ''),
      ),
    );

    const foot = el('div', 'card-foot');
    const use = el('button', 'btn-ghost', 'Open chat');
    use.type = 'button';
    use.addEventListener('click', async (e) => {
      e.stopPropagation();
      applyStatus(await bridge.agentSelect(agent.id));
      openConversation(agent.id);
    });
    foot.appendChild(use);
    const remove = el('button', 'btn-ghost danger', 'Delete');
    remove.type = 'button';
    armDelete(remove, async () => {
      agentMsg.textContent = '';
      try {
        agentInfos = await bridge.agentDelete(agent.id);
        // The conversation dies with its agent: stop its turn, drop it and
        // its sub-agent chats, and move off it if it was on screen.
        const conv = conversations.get(agent.id);
        if (conv) {
          if (conv.turnId && harness) harness.interrupt(conv.turnId);
          conversations.delete(agent.id);
          for (const child of sessions.filter((c) => c.parentSessionId === conv.id)) {
            sessions.splice(sessions.indexOf(child), 1);
          }
          if (current === conv || current.parentSessionId === conv.id) {
            const next = agentInfos[0];
            if (next) {
              current = conversationFor(next);
              hydrate(current);
            } else {
              current = freshSession();
            }
            mountSession(current);
          }
        }
        renderRecents();
        await refreshStatus();
      } catch (err) {
        agentMsg.textContent = err instanceof Error ? err.message : String(err);
      }
      await renderAgents();
    });
    foot.appendChild(remove);
    card.appendChild(foot);
    card.addEventListener('click', () => openAgentDetail(agent));
    agentCards.appendChild(card);
  }

  const add = el('div', 'card add', '+ New agent');
  add.addEventListener('click', async () => {
    agentMsg.textContent = '';
    try {
      const list = await bridge.agentCreate({
        name: 'New agent',
        provider: (await loadProviders())[0]?.id ?? '',
        model: 'auto',
        systemPrompt: '',
        thinking: 'auto',
        advanced: '',
      });
      const newest = list[list.length - 1];
      if (newest) openAgentDetail(newest);
    } catch (err) {
      agentMsg.textContent = err instanceof Error ? err.message : String(err);
    }
  });
  agentCards.appendChild(add);
}

/** Populates provider-dependent controls (models datalist, thinking levels). */
async function syncAgentProviderFields(providerId: string, selectedThinking: string): Promise<void> {
  const infos = await loadProviders();
  const info = infos.find((p) => p.id === providerId);
  aModelOptions.textContent = '';
  for (const m of info?.models ?? ['auto']) {
    const opt = document.createElement('option');
    opt.value = m;
    aModelOptions.appendChild(opt);
  }
  aThinking.textContent = '';
  for (const level of info?.thinkingLevels ?? ['auto']) {
    const opt = document.createElement('option');
    opt.value = level;
    opt.textContent = level;
    if (level === selectedThinking) opt.selected = true;
    aThinking.appendChild(opt);
  }
  aSystemHint.textContent = info?.systemPromptHint ?? '';
}

function renderAgentHeader(agent: { id: string; name: string; active: boolean }): void {
  agentTitle.textContent = agent.name;
  agentStatus.textContent = '';
  if (agent.active) agentStatus.appendChild(el('span', 'badge-active', 'active'));
  agentControls.textContent = '';
  if (bridge) {
    const use = el('button', 'btn-ghost', 'Open chat');
    use.type = 'button';
    use.addEventListener('click', async () => {
      applyStatus(await bridge.agentSelect(agent.id));
      openConversation(agent.id);
    });
    agentControls.appendChild(use);
  }
}

async function openAgentDetail(agent: {
  id: string;
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  thinking: string;
  advanced: string;
  active: boolean;
}): Promise<void> {
  detailAgentId = agent.id;
  agentDetailMsg.textContent = '';
  aName.value = agent.name;
  aProvider.textContent = '';
  for (const info of await loadProviders()) {
    const opt = document.createElement('option');
    opt.value = info.id;
    opt.textContent = info.label;
    if (info.id === agent.provider) opt.selected = true;
    aProvider.appendChild(opt);
  }
  aModel.value = agent.model;
  aSystem.value = agent.systemPrompt;
  aAdvanced.value = agent.advanced;
  await syncAgentProviderFields(agent.provider, agent.thinking);
  renderAgentHeader(agent);
  showView('agent-detail');
}

aProvider.addEventListener('change', () => {
  void syncAgentProviderFields(aProvider.value, 'auto');
  aModel.value = 'auto';
});

aSave.addEventListener('click', async () => {
  if (!bridge || !detailAgentId) return;
  agentDetailMsg.textContent = '';
  aSave.disabled = true;
  try {
    const list = await bridge.agentUpdate(detailAgentId, {
      name: aName.value,
      provider: aProvider.value,
      model: aModel.value,
      systemPrompt: aSystem.value,
      thinking: aThinking.value,
      advanced: aAdvanced.value,
    });
    const currentAgent = list.find((a) => a.id === detailAgentId);
    if (currentAgent) renderAgentHeader(currentAgent);
    await refreshStatus();
    flashSaved(aSave);
  } catch (err) {
    agentDetailMsg.textContent = err instanceof Error ? err.message : String(err);
  }
  aSave.disabled = false;
});

agentBack.addEventListener('click', () => {
  detailAgentId = null;
  settingsTab = 'agents';
  showView('settings');
});

async function renderProviders(): Promise<void> {
  if (!bridge) return;
  const infos = await loadProviders();
  providerCards.textContent = '';
  for (const info of infos) {
    const card = el('div', 'card');
    const head = el('div', 'card-head');
    head.appendChild(el('span', 'card-title', info.label));
    head.appendChild(statusEl(info.auth.connected, info.auth.connected ? 'connected' : 'offline'));
    card.appendChild(head);
    card.appendChild(
      el(
        'div',
        'card-sub',
        waitingAuthProvider === info.id && !info.auth.connected
          ? 'complete the sign-in in the window that just opened…'
          : info.auth.detail,
      ),
    );

    const foot = el('div', 'card-foot');
    const btn = el('button', 'btn-ghost', info.auth.connected ? 'Disconnect' : 'Connect');
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      providerMsg.textContent = '';
      try {
        if (info.auth.connected) {
          stopAuthPoll();
          await bridge.providerAuthLogout(info.id);
        } else {
          stopAuthPoll();
          await bridge.providerAuthStart(info.id);
          waitingAuthProvider = info.id;
          // The login completes in the app's sign-in window — poll until it lands.
          authPoll = setInterval(async () => {
            const latest = await loadProviders();
            if (latest.find((p) => p.id === info.id)?.auth.connected) {
              stopAuthPoll();
              await renderProviders();
            }
          }, 2000);
        }
      } catch (err) {
        providerMsg.textContent = err instanceof Error ? err.message : String(err);
      }
      await renderProviders();
    });
    foot.appendChild(btn);
    card.appendChild(foot);
    providerCards.appendChild(card);
  }
}

/* ---------- Environment list + detail editor ---------- */

let detailEnvId: string | null = null;
let detailEnvVars: Record<string, string> = {};

async function refreshAfterEnvOp(): Promise<void> {
  await renderEnvs();
  await refreshStatus();
}

async function renderEnvs(): Promise<EnvironmentInfo[]> {
  if (!bridge) return [];
  const envs = await bridge.envList().catch(() => [] as EnvironmentInfo[]);
  envCards.textContent = '';
  for (const env of envs) {
    const card = el('div', 'card clickable');

    const head = el('div', 'card-head');
    const title = el('span', 'card-title', env.name);
    if (env.active) title.appendChild(el('span', 'badge-active', 'active'));
    head.appendChild(title);
    head.appendChild(statusEl(env.status === 'running', env.status));
    card.appendChild(head);
    card.appendChild(
      el(
        'div',
        'card-sub',
        `${env.dockerfile.trim() ? 'Dockerfile' : env.image} · ${env.workspacePath}`,
      ),
    );

    const foot = el('div', 'card-foot');
    const runOp = async (btn: HTMLButtonElement, fn: () => Promise<void>) => {
      foot.querySelectorAll('button').forEach((b) => (b.disabled = true)); // one op at a time
      btn.textContent = '…';
      envMsg.textContent = '';
      try {
        await fn();
      } catch (err) {
        envMsg.textContent = err instanceof Error ? err.message : String(err);
      }
      await refreshAfterEnvOp();
    };
    const action = (label: string, fn: () => Promise<void>) => {
      const btn = el('button', 'btn-ghost', label);
      btn.type = 'button';
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // don't open the detail page
        void runOp(btn, fn);
      });
      foot.appendChild(btn);
    };

    if (!env.active) {
      action('Select', async () => {
        applyStatus(await bridge.envSelect(env.id));
      });
    }
    if (env.status === 'running') {
      action('Stop', async () => {
        await bridge.envStop(env.id);
      });
      action('Restart', async () => {
        await bridge.envRestart(env.id);
      });
      action('Rebuild', async () => {
        await bridge.envRebuild(env.id);
      });
    } else {
      action('Start', async () => {
        await bridge.envStart(env.id);
      });
      action('Rebuild', async () => {
        await bridge.envRebuild(env.id);
      });
      const del = el('button', 'btn-ghost danger', 'Delete');
      del.type = 'button';
      armDelete(del, () =>
        runOp(del, async () => {
          if (detailEnvId === env.id) detailEnvId = null;
          await bridge.envDelete(env.id);
        }),
      );
      foot.appendChild(del);
    }

    card.appendChild(foot);
    card.addEventListener('click', () => openDetail(env));
    envCards.appendChild(card);
  }

  // Dashed add-card creates an environment and opens its page for configuring.
  const add = el('div', 'card add', '+ New environment');
  add.addEventListener('click', async () => {
    envMsg.textContent = '';
    try {
      const list = await bridge.envCreate({
        name: `env-${Date.now().toString(36).slice(-4)}`,
        image: 'node:22-bookworm',
        workspacePath: '',
        autoInstall: true,
        dockerfile: '',
        envVars: {},
      });
      const newest = list[list.length - 1];
      if (newest) openDetail(newest);
    } catch (err) {
      envMsg.textContent = err instanceof Error ? err.message : String(err);
    }
  });
  envCards.appendChild(add);
  return envs;
}

function kvRow(key: string, value: string, onRemove: () => void): HTMLElement {
  const row = el('div', 'kv-row');
  row.appendChild(el('span', 'kv-key', key));
  row.appendChild(el('span', 'kv-val', value));
  const remove = el('button', 'kv-remove', '✕');
  remove.type = 'button';
  remove.addEventListener('click', onRemove);
  row.appendChild(remove);
  return row;
}

function renderDetailEnvVars(): void {
  dEnvVars.textContent = '';
  for (const [key, value] of Object.entries(detailEnvVars)) {
    dEnvVars.appendChild(
      kvRow(key, value, () => {
        delete detailEnvVars[key];
        renderDetailEnvVars();
      }),
    );
  }
}

function renderDetailSecrets(keys: string[]): void {
  dSecrets.textContent = '';
  for (const key of keys) {
    dSecrets.appendChild(
      kvRow(key, '••••••••', async () => {
        if (!bridge || !detailEnvId) return;
        const envs = await bridge.envSecretDelete(detailEnvId, key);
        const current = envs.find((e) => e.id === detailEnvId);
        renderDetailSecrets(current?.secretKeys ?? []);
      }),
    );
  }
}

/** Header of the environment page: name, live status, management controls. */
function renderDetailHeader(env: EnvironmentInfo): void {
  detailTitle.textContent = env.name;
  detailStatus.textContent = '';
  detailStatus.appendChild(statusEl(env.status === 'running', env.status));
  if (env.active) detailStatus.appendChild(el('span', 'badge-active', 'active'));

  detailControls.textContent = '';
  const runOp = async (btn: HTMLButtonElement, fn: () => Promise<void>) => {
    detailControls.querySelectorAll('button').forEach((b) => (b.disabled = true));
    btn.textContent = '…';
    detailMsg.textContent = '';
    try {
      await fn();
    } catch (err) {
      detailMsg.textContent = err instanceof Error ? err.message : String(err);
    }
    await refreshStatus();
    if (!detailEnvId) return; // deleted — already navigated back
    const latest = (await bridge?.envList().catch(() => [])) ?? [];
    const current = latest.find((e) => e.id === detailEnvId);
    if (current) renderDetailHeader(current);
  };
  const control = (label: string, fn: () => Promise<void>) => {
    const btn = el('button', 'btn-ghost', label);
    btn.type = 'button';
    btn.addEventListener('click', () => void runOp(btn, fn));
    detailControls.appendChild(btn);
  };

  if (!bridge) return;
  if (!env.active) {
    control('Select', async () => {
      applyStatus(await bridge.envSelect(env.id));
    });
  }
  if (env.status === 'running') {
    control('Stop', async () => {
      await bridge.envStop(env.id);
    });
    control('Restart', async () => {
      await bridge.envRestart(env.id);
    });
    control('Rebuild', async () => {
      await bridge.envRebuild(env.id);
    });
  } else {
    control('Start', async () => {
      await bridge.envStart(env.id);
    });
    control('Rebuild', async () => {
      await bridge.envRebuild(env.id);
    });
    const del = el('button', 'btn-ghost danger', 'Delete');
    del.type = 'button';
    armDelete(del, () =>
      runOp(del, async () => {
        await bridge.envDelete(env.id);
        detailEnvId = null;
        settingsTab = 'envs';
        showView('settings');
      }),
    );
    detailControls.appendChild(del);
  }
}

/** Navigates to the environment's dedicated page. */
function openDetail(env: EnvironmentInfo): void {
  detailEnvId = env.id;
  detailMsg.textContent = '';
  dName.value = env.name;
  dImage.value = env.image;
  dWorkspace.value = env.workspacePath;
  dAutoInstall.checked = env.autoInstall;
  dDockerfile.value = env.dockerfile;
  detailEnvVars = { ...env.envVars };
  renderDetailEnvVars();
  renderDetailSecrets(env.secretKeys);
  renderDetailHeader(env);
  showView('env-detail');
}

detailBack.addEventListener('click', () => {
  detailEnvId = null;
  settingsTab = 'envs';
  showView('settings');
});

dEnvAdd.addEventListener('click', () => {
  const key = dEnvKey.value.trim();
  if (!key) return;
  detailEnvVars[key] = dEnvVal.value;
  dEnvKey.value = '';
  dEnvVal.value = '';
  renderDetailEnvVars();
});

dSecretAdd.addEventListener('click', async () => {
  if (!bridge || !detailEnvId) return;
  const key = dSecretKey.value.trim();
  if (!key) return;
  detailMsg.textContent = '';
  try {
    const envs = await bridge.envSecretSet(detailEnvId, key, dSecretVal.value);
    dSecretKey.value = '';
    dSecretVal.value = '';
    const current = envs.find((e) => e.id === detailEnvId);
    renderDetailSecrets(current?.secretKeys ?? []);
  } catch (err) {
    detailMsg.textContent = err instanceof Error ? err.message : String(err);
  }
});

dSave.addEventListener('click', async () => {
  if (!bridge || !detailEnvId) return;
  detailMsg.textContent = '';
  dSave.disabled = true;
  try {
    const envs = await bridge.envUpdate(detailEnvId, {
      name: dName.value,
      image: dImage.value,
      workspacePath: dWorkspace.value,
      autoInstall: dAutoInstall.checked,
      dockerfile: dDockerfile.value,
      envVars: detailEnvVars,
    });
    const current = envs.find((e) => e.id === detailEnvId);
    if (current) renderDetailHeader(current);
    await refreshStatus();
    flashSaved(dSave);
  } catch (err) {
    detailMsg.textContent = err instanceof Error ? err.message : String(err);
  }
  dSave.disabled = false;
});

/* ---------- Sessions ---------- */

/**
 * Slack-style model: each configured agent has ONE long-lived conversation.
 * Every conversation owns a LIVE detached thread node — turns keep streaming
 * into it while other conversations are on screen. Mounting just swaps which
 * thread is attached to the chat scroller. Sub-agent chats are child sessions
 * nested under the conversation that spawned them.
 */
interface Session {
  /** Set on agent conversations: which configured agent this chat belongs to. */
  agentId?: string;
  /** Structured history — the persisted source of truth for this chat. */
  log: ConversationEntry[];
  id: number;
  title: string;
  thread: HTMLOListElement;
  usage: number;
  provider: string;
  turns: number;
  createdAt: number;
  lastActiveAt: number;
  running: boolean;
  /** In-flight turn id, for routing interrupt / question answers. */
  turnId: string | null;
  /** Something happened while this session was in the background. */
  unread: 'done' | 'error' | 'ask' | null;
  /** Unrendered history — replayed lazily on first open (boot stays fast). */
  pendingLog?: ConversationEntry[];
  /** Composer draft, private to this conversation. */
  draft?: string;
  /** Scroll state, restored when the conversation is remounted. */
  scrollPos?: number;
  stick?: boolean;
  /**
   * Tool cards across ALL turns in this session, so a sub-agent resumed in a
   * later turn (SendMessage) streams into its original card.
   */
  tools: Map<string, HTMLElement>;
  toolStarts: Map<string, number>;
  /** Set on sub-agent chats: the session this agent was spawned from. */
  parentSessionId?: number;
  /** Sub-agent chats spawned from this session, keyed by their Task toolId. */
  agents: Map<string, AgentThread>;
}

interface AgentThread {
  child: Session;
  childTurn: ReturnType<typeof addAssistantTurn>;
  /** True once the sub-agent's own text streamed in (avoids double reports). */
  sawText: boolean;
}

/** Sub-agent chats (children). Agent conversations live in `conversations`. */
const sessions: Session[] = [];
let nextSessionId = 1;
let agentInfos: AgentInfo[] = [];
const conversations = new Map<string, Session>();

function freshSession(): Session {
  const now = Date.now();
  return {
    id: nextSessionId++,
    title: 'Untitled session',
    thread: el('ol', 'thread'),
    usage: 0,
    provider: lastProviderLabel,
    turns: 0,
    createdAt: now,
    lastActiveAt: now,
    running: false,
    turnId: null,
    unread: null,
    tools: new Map(),
    toolStarts: new Map(),
    agents: new Map(),
    log: [],
  };
}

/** Keep a sub-agent chat's liveness fresh as its activity streams in. */
function bumpAgent(child: Session): void {
  child.lastActiveAt = Date.now();
  if (!child.running) {
    child.running = true;
    renderRecents();
  }
}

/** The one permanent conversation for a configured agent. */
function conversationFor(info: AgentInfo): Session {
  let conv = conversations.get(info.id);
  if (!conv) {
    conv = freshSession();
    conv.agentId = info.id;
    conv.provider = providerLabel(info.provider);
    conversations.set(info.id, conv);
  }
  conv.title = info.name; // follows renames in Settings
  return conv;
}

function openConversation(agentId: string): void {
  const info = agentInfos.find((a) => a.id === agentId);
  if (!info) return;
  const conv = conversationFor(info);
  showView('chat');
  if (conv === current) return;
  current = conv;
  conv.unread = null;
  hydrate(conv);
  mountSession(conv);
  renderRecents();
  prompt.focus();
}


let current: Session = freshSession();


/** Full-screen turn detail: the detail node is MOVED into the overlay and
 *  returned home on back, so live streaming keeps rendering either way. */
let fullTurn: { detail: HTMLElement; home: HTMLElement } | null = null;

function openFullTurn(session: Session, detail: HTMLElement, title: string): void {
  closeFullTurn();
  fullTurn = { detail, home: detail.parentElement as HTMLElement };
  turnFullBody.appendChild(detail);
  turnFullCrumb.textContent = session.title;
  turnFullTitle.textContent = title;
  stage.classList.add('turn-full-open');
}

function closeFullTurn(): void {
  if (!fullTurn) return;
  fullTurn.home.appendChild(fullTurn.detail);
  fullTurn = null;
  stage.classList.remove('turn-full-open');
}

/** Follow live output when the growing turn is the one open full screen. */
function detailFollow(node: HTMLElement): void {
  if (fullTurn?.detail.contains(node)) turnFullBody.scrollTop = turnFullBody.scrollHeight;
}

let mountedSession: Session | null = null;

/** Swap the chat scroller over to a session's live thread. */
function mountSession(session: Session): void {
  if (mountedSession && mountedSession !== session) {
    // Draft and scroll state are per conversation — never leak across agents.
    mountedSession.draft = prompt.value;
    mountedSession.scrollPos = chat.scrollTop;
    mountedSession.stick = stickToBottom;
  }
  mountedSession = session;
  chat.querySelector('.thread')?.remove();
  chat.appendChild(session.thread);
  closeFullTurn(); // full-screen detail belongs to the previous view
  prompt.value = session.draft ?? '';
  autosize();
  stickToBottom = session.stick ?? true;
  chat.scrollTop = stickToBottom ? chat.scrollHeight : session.scrollPos ?? 0;
  stage.classList.toggle('empty', !session.thread.children.length);
  const isChild = session.parentSessionId !== undefined;
  const info = session.agentId ? agentInfos.find((a) => a.id === session.agentId) : undefined;
  chatHeadName.textContent = session.title;
  chatHeadTag.textContent = isChild
    ? 'sub-agent'
    : info
      ? providerLabel(info.provider)
      : '';
  chatHead.classList.toggle('hidden', !isChild && !info);
  const named = info || isChild;
  heroAvatar.textContent = named ? (session.title[0] ?? 'P').toUpperCase() : 'P';
  heroTitle.textContent = named ? session.title : 'Welcome to Puck';
  syncComposer();
}

/** Slack-style day separator, inserted when the calendar day changes. The
 *  last label lives in a dataset attribute — no DOM scan per message. */
function maybeDayDivider(container: HTMLElement, ts = Date.now()): void {
  const label = dayLabel(ts);
  if (container.dataset.day === label) return;
  container.dataset.day = label;
  const divider = el('li', 'day-divider');
  divider.appendChild(el('span', 'day-chip', label));
  container.appendChild(divider);
}

/** One Slack-style message row: avatar gutter, author + time, content below. */
function messageRow(
  kind: 'user' | 'agent',
  author: string,
  ts = Date.now(),
): { item: HTMLLIElement; body: HTMLElement } {
  const item = el('li', `msg-row ${kind}`);
  item.dataset.author = author;
  item.dataset.ts = String(ts);
  const main = el('div', 'row-main');
  const head = el('div', 'row-head');
  head.append(el('span', 'row-author', author), el('span', 'row-time', fmtTime(ts)));
  const body = el('div', 'row-body');
  main.append(head, body);
  item.append(el('span', `row-avatar ${kind}`, (author[0] ?? '?').toUpperCase()), main);
  return { item, body };
}

function sessionSnippet(session: Session): string {
  const parts = session.thread.querySelectorAll('.prose, .bubble, .error-block');
  const last = parts.length ? (parts[parts.length - 1].textContent ?? '') : '';
  return last.split(/\s+/).join(' ').trim().slice(0, 120);
}

function statusDot(state: 'running' | 'done' | 'error' | 'ask'): HTMLElement {
  const dot = el('span', `recent-status ${state}`);
  dot.title =
    state === 'running'
      ? 'Agent working…'
      : state === 'ask'
        ? 'Waiting for your answer'
        : state === 'error'
          ? 'Finished with an error'
          : 'Finished';
  return dot;
}

/** Sidebar renders at most once per frame — callers fire on every event. */
let recentsQueued = false;
function renderRecents(): void {
  if (recentsQueued) return;
  recentsQueued = true;
  requestAnimationFrame(() => {
    recentsQueued = false;
    renderRecentsNow();
  });
}

/** Sidebar: the agent roster, each with its permanent chat + sub-agent chats. */
function renderRecentsNow(): void {
  recentsList.textContent = '';
  for (const info of agentInfos) {
    const conv = conversations.get(info.id);
    const item = el('li', 'recent-item');
    const btn = el(
      'button',
      'recent agent-row' + (conv && conv === current ? ' active' : ''),
      info.name,
    );
    btn.type = 'button';
    btn.title =
      providerLabel(info.provider) +
      (conv && conv.turns > 0
        ? ` · ${fmtTokens(conv.usage)} · ${relTime(conv.lastActiveAt)}`
        : ' · no messages yet');
    btn.addEventListener('click', () => openConversation(info.id));
    item.appendChild(btn);
    const state = conv?.running ? 'running' : conv?.unread;
    if (state) item.appendChild(statusDot(state));
    recentsList.appendChild(item);

    // Sub-agent chats, nested under the conversation that spawned them.
    if (!conv) continue;
    for (const child of sessions.filter((c) => c.parentSessionId === conv.id)) {
      const childItem = el('li', 'recent-item child');
      const childBtn = el(
        'button',
        'recent' + (child.id === current.id ? ' active' : ''),
        child.title,
      );
      childBtn.type = 'button';
      childBtn.title = sessionSnippet(child) || child.title;
      childBtn.addEventListener('click', () => openSession(child.id));
      childItem.appendChild(childBtn);
      const childState = child.running ? 'running' : child.unread;
      if (childState) childItem.appendChild(statusDot(childState));
      recentsList.appendChild(childItem);
    }
  }
}

/** Open a sub-agent chat by its session id. */
function openSession(id: number): void {
  showView('chat');
  const target = sessions.find((s) => s.id === id);
  if (!target || target === current) return;
  current = target;
  target.unread = null;
  mountSession(target);
  renderRecents();
  prompt.focus();
}

/* ---------- Message rendering ---------- */

function addUserMessage(session: Session, text: string, author = USER_NAME, ts = Date.now()): void {
  // Sub-agent chats title themselves from their task; agent conversations
  // keep the agent's name.
  if (!session.agentId && !session.thread.children.length) {
    const clean = text.split(/\s+/).join(' ').trim();
    if (clean.length <= 48) {
      session.title = clean;
    } else {
      const cut = clean.lastIndexOf(' ', 48);
      session.title = `${clean.slice(0, cut > 24 ? cut : 48)}…`;
    }
  }
  // Slack-style grouping: rapid consecutive messages share one header.
  const last = session.thread.lastElementChild as HTMLElement | null;
  if (
    last?.classList.contains('msg-row') &&
    last.dataset.author === author &&
    ts - Number(last.dataset.ts) < 300_000
  ) {
    last.dataset.ts = String(ts);
    const grouped = el('div', 'row-body prose');
    grouped.innerHTML = renderMd(text);
    last.querySelector('.row-main')?.appendChild(grouped);
  } else {
    maybeDayDivider(session.thread, ts);
    const { item, body } = messageRow(author === USER_NAME ? 'user' : 'agent', author, ts);
    body.classList.add('prose');
    body.innerHTML = renderMd(text);
    session.thread.appendChild(item);
  }
  if (session.thread.isConnected) scrollChat(true);
}

/** Builds one assistant turn inside a session's thread (which may be off-screen). */
function addAssistantTurn(session: Session, turnId: string, ts = Date.now()) {
  // Only move the visible scroller when this session is the one on screen.
  const scrollToBottom = (force = false): void => {
    if (session.thread.isConnected) scrollChat(force);
  };
  maybeDayDivider(session.thread, ts);
  const { item, body: content } = messageRow('agent', session.title, ts);
  session.thread.appendChild(item);

  // Text-only turns are just messages. The first tool call reveals ONE dynamic
  // card; clicking it opens the turn's full detail with breadcrumbs back.
  const turnWork = el('div', 'turn-detail');
  const detailTitle = `Turn · ${fmtTime(ts)}`;
  let steps = 0;
  const turnCard = el('div', 'turn-card running hidden');
  turnCard.title = 'Open turn detail';
  const cardDot = el('span', 'turn-card-dot');
  const cardLabel = el('span', 'turn-card-label', 'Working…');
  const cardLatest = el('span', 'turn-card-latest', '');
  const cardExpand = el('span', 'turn-card-expand');
  cardExpand.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="m21 3-7 7" /><path d="m3 21 7-7" /></svg>';
  turnCard.append(cardDot, cardLabel, cardLatest, cardExpand);
  turnCard.addEventListener('click', () => openFullTurn(session, turnWork, detailTitle));
  item.querySelector('.row-main')?.append(turnCard, turnWork);

  const workAppend = (node: HTMLElement, stepLabel?: string): void => {
    turnWork.appendChild(node);
    if (stepLabel) {
      steps += 1;
      cardLabel.textContent = `Working · ${steps} step${steps === 1 ? '' : 's'}`;
      cardLatest.textContent = stepLabel;
    }
    if (turnCard.classList.contains('hidden')) {
      turnCard.classList.remove('hidden');
      scrollToBottom();
    }
    detailFollow(node);
  };

  let prose: HTMLElement | null = null;
  let proseRaw = '';
  let proseCommitted: HTMLElement | null = null;
  let proseTail: HTMLElement | null = null;
  let commitAt = 0;
  let flushQueued = false;

  // Re-parsing the whole reply per token is quadratic. Instead: text before
  // the last completed paragraph renders once into a "committed" node (only
  // when a new paragraph lands, and never inside an open code fence), and
  // each animation frame re-renders just the small trailing chunk.
  const fenceClosed = (s: string): boolean => ((s.match(/```/g) ?? []).length & 1) === 0;
  const flushProse = (): void => {
    flushQueued = false;
    if (!prose || !proseCommitted || !proseTail) return;
    const brk = proseRaw.lastIndexOf('\n\n');
    if (brk >= 0 && brk + 2 > commitAt && fenceClosed(proseRaw.slice(0, brk))) {
      commitAt = brk + 2;
      proseCommitted.innerHTML = renderMd(proseRaw.slice(0, commitAt));
    }
    proseTail.innerHTML = renderMd(proseRaw.slice(commitAt));
    scrollToBottom();
  };

  let thinking: HTMLElement | null = null;
  const tools = session.tools; // session-scoped: resumed sub-agents span turns
  const toolStarts = session.toolStarts;
  const turnToolIds: string[] = []; // pruned when the turn settles (DOM refs!)
  const openAsks: HTMLElement[] = [];

  function closeAsks(): void {
    for (const card of openAsks.splice(0)) {
      card.classList.add('answered');
      card.querySelectorAll('button, input').forEach((n) => {
        (n as HTMLButtonElement | HTMLInputElement).disabled = true;
      });
    }
  }

  return {
    setThinking(active: boolean, label = 'Thinking…') {
      if (active && !thinking) {
        thinking = el('div', 'thinking');
        thinking.append(
          el('span', 'thinking-dot'),
          el('span', 'thinking-dot'),
          el('span', 'thinking-dot'),
          el('span', 'thinking-label', label),
        );
        content.appendChild(thinking);
      } else if (!active && thinking) {
        thinking.remove();
        thinking = null;
      }
      scrollToBottom();
    },

    appendText(delta: string, parentId?: string) {
      // A sub-agent's text belongs in its own chat thread.
      if (parentId) {
        const agentThread = session.agents.get(parentId);
        if (agentThread) {
          agentThread.sawText = true;
          agentThread.childTurn.appendText(delta);
          bumpAgent(agentThread.child);
          return;
        }
      }
      this.setThinking(false);
      if (!prose) {
        prose = el('div', 'prose');
        proseCommitted = el('div', 'prose-part');
        proseTail = el('div', 'prose-part');
        prose.append(proseCommitted, proseTail);
        proseRaw = '';
        commitAt = 0;
        content.appendChild(prose);
      }
      proseRaw += delta;
      if (!flushQueued) {
        flushQueued = true;
        requestAnimationFrame(flushProse);
      }
    },

    showError(message: string) {
      this.setThinking(false);
      flushProse();
      closeAsks();
      content.appendChild(el('div', 'error-block', message));
      scrollToBottom();
    },

    /** Renders the agent's mid-turn question(s); answers flow back over the bridge. */
    showAsk(askId: string, questions: AskQuestion[]) {
      this.setThinking(false);
      flushProse();
      prose = null; // text after the question starts a fresh block
      const card = el('div', 'ask');
      const chosen = new Map<string, Set<string>>();
      const typed = new Map<string, string>();
      // A lone single-select question answers on click; anything richer
      // collects selections and submits via the footer button.
      const instant = questions.length === 1 && !questions[0].multiSelect;
      let submitted = false;

      const answered = (q: AskQuestion) =>
        Boolean(typed.get(q.question)?.trim() || chosen.get(q.question)?.size);
      const collect = (): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const q of questions) {
          const text = typed.get(q.question)?.trim();
          const picks = [...(chosen.get(q.question) ?? [])];
          if (text) out[q.question] = text;
          else if (picks.length) out[q.question] = picks.join(', ');
        }
        return out;
      };
      const submit = (answers: Record<string, string> | null) => {
        if (submitted) return;
        submitted = true;
        const idx = openAsks.indexOf(card);
        if (idx !== -1) openAsks.splice(idx, 1);
        card.classList.add('answered');
        card.querySelectorAll('button, input').forEach((n) => {
          (n as HTMLButtonElement | HTMLInputElement).disabled = true;
        });
        harness?.answerAsk(turnId, askId, answers);
        if (answers) this.setThinking(true);
      };

      const sendBtn = el('button', 'btn-primary', 'Send answer');
      sendBtn.type = 'button';
      sendBtn.disabled = true;
      sendBtn.addEventListener('click', () => submit(collect()));
      const refresh = () => {
        sendBtn.disabled = !questions.every(answered);
      };

      for (const q of questions) {
        const sec = el('div', 'ask-q');
        const head = el('div', 'ask-head');
        if (q.header) head.appendChild(el('span', 'ask-chip', q.header));
        head.appendChild(el('span', 'ask-question', q.question));
        sec.appendChild(head);

        const opts = el('div', 'ask-options');
        for (const option of q.options) {
          const btn = el('button', 'ask-option');
          btn.type = 'button';
          btn.appendChild(el('span', 'ask-option-label', option.label));
          if (option.description) btn.appendChild(el('span', 'ask-option-desc', option.description));
          btn.addEventListener('click', () => {
            let set = chosen.get(q.question);
            if (!set) chosen.set(q.question, (set = new Set()));
            if (q.multiSelect) {
              if (set.has(option.label)) set.delete(option.label);
              else set.add(option.label);
              btn.classList.toggle('selected');
            } else {
              set.clear();
              set.add(option.label);
              opts.querySelectorAll('.ask-option').forEach((b) => b.classList.remove('selected'));
              btn.classList.add('selected');
              if (instant) return submit(collect());
            }
            refresh();
          });
          opts.appendChild(btn);
        }
        sec.appendChild(opts);

        const other = document.createElement('input');
        other.className = 'ask-other';
        other.placeholder = 'Something else…';
        other.addEventListener('input', () => {
          typed.set(q.question, other.value);
          refresh();
        });
        other.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && questions.every(answered)) submit(collect());
        });
        sec.appendChild(other);
        card.appendChild(sec);
      }

      const foot = el('div', 'ask-foot');
      const dismiss = el('button', 'btn-ghost', 'Dismiss');
      dismiss.type = 'button';
      dismiss.title = 'Let the agent decide on its own';
      dismiss.addEventListener('click', () => submit(null));
      foot.append(sendBtn, dismiss);
      card.appendChild(foot);

      content.appendChild(card);
      openAsks.push(card);
      scrollToBottom();
    },

    startTool(
      toolId: string,
      tool: string,
      summary: string,
      input: string,
      parentId?: string,
      isAgent?: boolean,
      at = Date.now(),
    ) {
      this.setThinking(false);

      // A sub-agent's own tool call: render it inside the agent's chat thread.
      if (parentId) {
        const agentThread = session.agents.get(parentId);
        if (agentThread) {
          agentThread.childTurn.startTool(toolId, tool, summary, input, undefined, undefined, at);
          bumpAgent(agentThread.child);
          return;
        }
        // Parent thread unknown — fall through and render a normal card.
      }

      flushProse();
      prose = null; // next text delta starts a fresh paragraph block

      if (isAgent) {
        // The sub-agent gets its own chat, rooted under this session; the
        // message here is just a live link to it.
        const child = freshSession();
        child.parentSessionId = session.id;
        child.provider = session.provider;
        child.turns = 1;
        child.running = true;
        child.tools = tools; // shared registry: tool-ends resolve across threads
        child.toolStarts = toolStarts;
        sessions.push(child);
        addUserMessage(child, input || summary, session.title, ts); // the parent agent authored the task
        child.title = summary;
        const childTurn = addAssistantTurn(child, turnId);
        session.agents.set(toolId, { child, childTurn, sawText: false });

        const link = el('button', 'agent-link');
        link.type = 'button';
        link.append(
          el('span', 'tool-status running'),
          el('span', 'agent-chip', 'Sub-agent'),
          el('span', 'agent-link-title', summary),
          el('span', 'tool-stamp', fmtClock(at)),
          el('span', 'agent-link-open', 'Open chat →'),
        );
        link.addEventListener('click', () => openSession(child.id));
        workAppend(link, `Sub-agent · ${summary}`);
        tools.set(toolId, link);
        toolStarts.set(toolId, at);
        renderRecents();
        return;
      }

      const card = el('details', 'tool');
      const head = el('summary', 'tool-head');
      head.append(
        el('span', 'tool-status running'),
        el('span', 'tool-name', tool),
        el('span', 'tool-summary', summary),
        el('span', 'tool-stamp', fmtClock(at)),
        el('span', 'tool-time', ''),
      );
      card.append(head);
      if (input) card.append(el('pre', 'tool-input', input));
      workAppend(card, summary ? `${tool} · ${summary}` : tool);
      tools.set(toolId, card);
      toolStarts.set(toolId, at);
      turnToolIds.push(toolId);
    },

    endTool(toolId: string, ok: boolean, output: string, at = Date.now()) {
      const card = tools.get(toolId);
      if (!card) return;
      const status = card.querySelector('.tool-status') as HTMLElement;
      status.className = `tool-status ${ok ? 'ok' : 'err'}`;
      status.textContent = ok ? '✓' : '✕';
      if (card.classList.contains('agent-link')) {
        // Sub-agent finished: land its report in its chat and settle state.
        const agentThread = session.agents.get(toolId);
        if (agentThread) {
          if (!agentThread.sawText && output) agentThread.childTurn.appendText(output);
          agentThread.child.running = false;
          if (agentThread.child !== current && !agentThread.child.unread) {
            agentThread.child.unread = ok ? 'done' : 'error';
          }
          renderRecents();
        }
        detailFollow(card);
        return;
      }
      const started = toolStarts.get(toolId);
      if (started) {
        // Claude delivers tool_use + result almost together, so sub-0.1s
        // receipt gaps are noise — show duration only when it means something.
        const secs = Math.max(0, at - started) / 1000;
        const parts: string[] = [];
        if (secs >= 0.1) parts.push(`${secs.toFixed(1)}s`);
        if (!ok) parts.push('failed');
        (card.querySelector('.tool-time') as HTMLElement).textContent = parts.join(' · ');
      }
      card.appendChild(el('pre', 'tool-output', output));
      detailFollow(card);
    },

    finish(stats: TurnStats) {
      this.setThinking(false);
      flushProse();
      closeAsks();
      // Plain tool cards can't receive events after turn-end — release the
      // map entries (agent-link ids stay: resumed sub-agents span turns).
      for (const toolId of turnToolIds) {
        tools.delete(toolId);
        toolStarts.delete(toolId);
      }
      // Text-only turns stay plain; tool turns settle their dynamic card.
      if (steps > 0) {
        const seconds = (stats.durationMs / 1000).toFixed(1);
        const cost = stats.costUsd !== undefined ? ` · $${stats.costUsd.toFixed(4)}` : '';
        workAppend(
          el(
            'div',
            'turn-stats',
            `${fmtTokens(stats.inputTokens)} in · ` +
              `${fmtTokens(stats.outputTokens)} out · ${seconds}s${cost}`,
          ),
        );
        turnCard.classList.remove('running');
        turnCard.classList.add('done');
        cardLabel.textContent = `${steps} step${steps === 1 ? '' : 's'} · ${seconds}s${cost}`;
        cardLatest.textContent = '';
      }
      scrollToBottom();
    },
  };
}

/* ---------- Turn loop ---------- */

const SEND_ICON = '<svg viewBox="0 0 24 24"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>';

/** Reflect the CURRENT session's turn state on the send/stop button. */
function syncComposer(): void {
  const isChild = current.parentSessionId !== undefined;
  prompt.disabled = isChild;
  prompt.placeholder = isChild
    ? 'Sub-agent conversation — watch it work, or reply via the main chat'
    : current.agentId
      ? `Message ${current.title}`
      : 'Create an agent in Settings to start chatting';
  send.disabled = isChild;
  const running = current.running;
  send.classList.toggle('stop', running && !isChild);
  send.classList.remove('stopping');
  send.innerHTML = running && !isChild ? STOP_ICON : SEND_ICON;
  send.title = running && !isChild ? 'Stop this turn' : 'Send · Enter';
}

async function submit(text: string): Promise<void> {
  const session = current; // the turn belongs to this conversation, even if the user switches away
  const trimmed = text.trim();
  if (!trimmed || session.running || !harness) return;
  if (session.parentSessionId !== undefined) return; // sub-agent chats are observed, not driven
  if (!session.agentId) return; // no agent configured yet
  hydrate(session); // history must be on screen before the new exchange

  const { turnId, events } = harness.send(session.agentId, trimmed);
  session.running = true;
  session.turnId = turnId;
  session.unread = null;
  session.turns += 1;
  session.lastActiveAt = Date.now();
  stage.classList.remove('empty');
  addUserMessage(session, trimmed);
  syncComposer();
  renderRecents();

  // Record structured history so a restart can replay this turn into live UI.
  session.log.push({ kind: 'user', text: trimmed, author: USER_NAME, ts: Date.now() });
  const record: ConversationEntry = { kind: 'turn', ts: Date.now(), events: [] };
  session.log.push(record);
  persistConversation(session); // the user's message is durable immediately

  const turn = addAssistantTurn(session, turnId);
  turn.setThinking(true, 'Contacting the harness…'); // no dead air before the first event
  try {
    for await (const event of events) {
      if (event.kind !== 'thinking') {
        event.ts = Date.now(); // wall-clock stamp survives into replays
        // Merge consecutive text deltas — token-level entries would bloat the
        // log and make replay quadratic again.
        const prev = record.events[record.events.length - 1];
        if (
          event.kind === 'text-delta' &&
          prev?.kind === 'text-delta' &&
          prev.parentId === event.parentId
        ) {
          prev.text += event.text;
        } else {
          record.events.push(event);
        }
        schedulePersist(session);
      }
      switch (event.kind) {
        case 'thinking':
          turn.setThinking(event.active);
          break;
        case 'error':
          turn.showError(event.message);
          if (session !== current) {
            session.unread = 'error';
            renderRecents();
          }
          break;
        case 'text-delta':
          turn.appendText(event.text, event.parentId);
          break;
        case 'tool-start':
          turn.startTool(
            event.toolId,
            event.tool,
            event.summary,
            event.input,
            event.parentId,
            event.agent,
            event.ts,
          );
          break;
        case 'tool-end':
          turn.endTool(event.toolId, event.ok, event.output, event.ts);
          break;
        case 'ask':
          turn.showAsk(event.askId, event.questions);
          if (session !== current) {
            session.unread = 'ask';
            renderRecents();
          }
          break;
        case 'turn-end':
          turn.finish(event.stats);
          if (event.stats.inputTokens + event.stats.outputTokens > 0) {
            session.usage = event.stats.inputTokens + event.stats.outputTokens;
          }
          break;
      }
    }
  } finally {
    session.running = false;
    session.turnId = null;
    session.lastActiveAt = Date.now();
    // The turn is over, so no sub-agent of it can still be streaming.
    for (const { child } of session.agents.values()) {
      if (child.running) {
        child.running = false;
        if (child !== current && !child.unread) child.unread = 'done';
      }
    }
    if (session === current) {
      prompt.focus();
    } else if (!session.unread) {
      session.unread = 'done';
    }
    syncComposer();
    renderRecents();
    // Conversations are forever — persist the completed turn.
    persistConversation(session);
  }
}

/** Render a stored history lazily: only when its conversation first opens. */
function hydrate(session: Session): void {
  if (!session.pendingLog) return;
  const log = session.pendingLog;
  session.pendingLog = undefined;
  replayLog(session, log);
}

/** Long histories replay only their tail; the rest loads on demand. */
const REPLAY_WINDOW = 150;

/** Rebuild a conversation's UI (and its sub-agent chats) from stored entries. */
function replayLog(session: Session, log: ConversationEntry[], full = false): void {
  session.log = log;
  const entries = full || log.length <= REPLAY_WINDOW ? log : log.slice(-REPLAY_WINDOW);
  if (entries.length < log.length) {
    const item = el('li', 'load-earlier');
    const btn = el('button', 'btn-ghost', `Show ${log.length - entries.length} earlier messages`);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      // Rebuild the whole thread from the full log through the same path.
      session.thread.textContent = '';
      delete session.thread.dataset.day;
      session.tools.clear();
      session.toolStarts.clear();
      session.agents.clear();
      for (const child of sessions.filter((c) => c.parentSessionId === session.id)) {
        sessions.splice(sessions.indexOf(child), 1);
      }
      replayLog(session, log, true);
      renderRecents();
      scrollChat(true);
    });
    item.appendChild(btn);
    session.thread.appendChild(item);
  }
  for (const entry of entries) {
    if (entry.kind === 'user') {
      addUserMessage(session, entry.text, entry.author, entry.ts);
      continue;
    }
    const turn = addAssistantTurn(session, 'replay', entry.ts);
    for (const event of entry.events) {
      switch (event.kind) {
        case 'text-delta':
          turn.appendText(event.text, event.parentId);
          break;
        case 'tool-start':
          turn.startTool(
            event.toolId,
            event.tool,
            event.summary,
            event.input,
            event.parentId,
            event.agent,
            event.ts,
          );
          break;
        case 'tool-end':
          turn.endTool(event.toolId, event.ok, event.output, event.ts);
          break;
        case 'error':
          turn.showError(event.message);
          break;
        case 'turn-end':
          turn.finish(event.stats);
          break;
        // 'ask' is interactive-only; answered questions live in the resumed
        // provider transcript, not the visual history.
      }
    }
    turn.setThinking(false);
  }
}

send.addEventListener('click', (e) => {
  if (current.running) {
    e.preventDefault();
    if (harness && current.turnId) harness.interrupt(current.turnId);
    send.classList.add('stopping');
    send.title = 'Stopping…';
  }
});

composer.addEventListener('submit', (e) => {
  e.preventDefault();
  if (current.running) return; // keep the draft while this session's turn is in flight
  const text = prompt.value;
  if (!text.trim() || !harness) return; // validate before destroying the draft
  prompt.value = '';
  autosize();
  void submit(text);
});

prompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    composer.requestSubmit();
  }
});

function autosize(): void {
  prompt.style.height = 'auto';
  prompt.style.height = `${Math.min(prompt.scrollHeight, 160)}px`;
}
prompt.addEventListener('input', autosize);

addAgentBtn.addEventListener('click', () => {
  settingsTab = 'agents';
  showView('settings');
});

turnFullBack.addEventListener('click', closeFullTurn);

// Composer mode chips (Search / Code) are visual toggles for now.
document.querySelectorAll('.tool-chip.toggle').forEach((btn) => {
  btn.addEventListener('click', () => btn.classList.toggle('active'));
});

/** Load the agent roster and restore each agent's permanent conversation. */
async function boot(): Promise<void> {
  if (!bridge) {
    mountSession(current);
    return;
  }
  await loadProviders(); // labels must be cached before conversations render
  agentInfos = await bridge.agentList().catch(() => []);
  const saved = await bridge.convoLoad().catch(() => ({}) as Record<string, never>);
  for (const info of agentInfos) {
    const conv = conversationFor(info);
    const data = saved[info.id];
    // Older HTML-snapshot saves have no `log`; they start fresh (memory is
    // preserved separately via the provider resume ids). Histories are only
    // REPLAYED when their conversation first opens — boot stays fast.
    if (data && Array.isArray(data.log) && conv.turns === 0) {
      conv.pendingLog = data.log;
      conv.usage = data.usage;
      conv.lastActiveAt = data.lastActiveAt;
      conv.turns = data.turns;
      conv.draft = data.draft;
    }
  }
  renderRecents();
  const status = await bridge.status().catch(() => null);
  const first = agentInfos.find((a) => a.id === status?.agent?.id) ?? agentInfos[0];
  if (first) openConversation(first.id);
  else mountSession(current);
}
void boot();
