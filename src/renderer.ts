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
import { button, errText, SEND_ICON, STOP_ICON } from './renderer/util';
import { createSessionStore, type Session } from './renderer/session-store';
import { applyEvent, initChatView } from './renderer/chat-view';
import { initAgentEditor } from './renderer/settings/agent-editor';
import {
  escapeTarget,
  navTransition,
  type NavState,
  type NavTarget,
  type SettingsSection,
  type View,
} from './renderer/nav';
import { addCard, cardShell, latestToken, loadingInto } from './renderer/settings/cards';
import { envOpRail } from './renderer/settings/env-rail';
import { fmtTokens, relTime } from './renderer/format';
import { IpcHarness } from './harness/ipc';
import type {
  AgentInfo,
  ConversationEntry,
  EnvironmentInfo,
  HarnessStatus,
  ProviderInfo,
  PuckBridge,
} from './harness/bridge';

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
const harness = bridge ? new IpcHarness(bridge) : null;

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
const settingsNav = document.getElementById('settings-nav') as HTMLElement;
const settingsOverlay = document.getElementById('settings-overlay') as HTMLElement;
const settingsClose = document.getElementById('settings-close') as HTMLButtonElement;
const sidebarEl = document.querySelector('.sidebar') as HTMLElement;
const envselBtn = document.getElementById('envsel-btn') as HTMLButtonElement;
const envselDot = document.getElementById('envsel-dot') as HTMLElement;
const envselName = document.getElementById('envsel-name') as HTMLElement;
const agentCards = document.getElementById('agent-cards') as HTMLElement;
const agentMsg = document.getElementById('agent-msg') as HTMLElement;
const agentDetailView = document.getElementById('agent-detail-view') as HTMLElement;
const agentTitle = document.getElementById('agent-title') as HTMLElement;
const agentBack = document.getElementById('agent-back') as HTMLButtonElement;
const agentStatus = document.getElementById('agent-status') as HTMLElement;
const agentControls = document.getElementById('agent-controls') as HTMLElement;
const agentDetailMsg = document.getElementById('agent-detail-msg') as HTMLElement;
const aName = document.getElementById('a-name') as HTMLInputElement;
const aProvider = document.getElementById('a-provider') as HTMLSelectElement;
const aModelSeg = document.getElementById('a-model-seg') as HTMLElement;
const aModel = document.getElementById('a-model') as HTMLInputElement;
const aThinkingSeg = document.getElementById('a-thinking-seg') as HTMLElement;
const aSystem = document.getElementById('a-system') as HTMLTextAreaElement;
const aSystemHint = document.getElementById('a-system-hint') as HTMLElement;
const aOptions = document.getElementById('a-options') as HTMLElement;
const aAdvanced = document.getElementById('a-advanced') as HTMLTextAreaElement;
const aAdvancedWarn = document.getElementById('a-advanced-warn') as HTMLElement;
const aSave = document.getElementById('a-save') as HTMLButtonElement;
const agentNav = document.getElementById('agent-nav') as HTMLElement;
const agentEditorMain = document.getElementById('agent-editor-main') as HTMLElement;
const agentDirty = document.getElementById('agent-dirty') as HTMLElement;
const aedIdentity = document.getElementById('aed-identity') as HTMLElement;
const aIdentityMod = document.getElementById('a-identity-mod') as HTMLElement;
const aedInstructions = document.getElementById('aed-instructions') as HTMLElement;
const aedAdvanced = document.getElementById('aed-advanced') as HTMLElement;
const heroSubtitle = document.getElementById('hero-subtitle') as HTMLElement;
const heroTitle = document.getElementById('hero-title') as HTMLElement;
const heroAvatar = document.getElementById('hero-avatar') as HTMLElement;
const heroCta = document.getElementById('hero-cta') as HTMLButtonElement;

/** Display label for the human author; persisted entries store 'user'. */
const USER_NAME = 'You';
const settingsView = document.getElementById('settings-view') as HTMLElement;
const providerCards = document.getElementById('provider-cards') as HTMLElement;
const envCards = document.getElementById('env-cards') as HTMLElement;
const envMsg = document.getElementById('env-msg') as HTMLElement;
const providerMsg = document.getElementById('provider-msg') as HTMLElement;
const envDetailView = document.getElementById('env-detail-view') as HTMLElement;
const detailTitle = document.getElementById('detail-title') as HTMLElement;
const detailBack = document.getElementById('detail-back') as HTMLButtonElement;
const secAgents = document.getElementById('sec-agents') as HTMLElement;
const secProviders = document.getElementById('sec-providers') as HTMLElement;
const secEnvs = document.getElementById('sec-envs') as HTMLElement;
const secAgentsTitle = document.getElementById('sec-agents-title') as HTMLElement;
const secProvidersTitle = document.getElementById('sec-providers-title') as HTMLElement;
const secEnvsTitle = document.getElementById('sec-envs-title') as HTMLElement;
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

function applyStatus(s: HarnessStatus): void {
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
    const item = button('model-item' + (entry.active ? ' active' : ''), entry.label);
    item.addEventListener('click', () => {
      closeMenu();
      onPick(entry.value);
    });
    menu.appendChild(item);
  }
  composer.appendChild(menu);
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
      return nav({ view: 'settings', section: 'envs' });
    }
    void bridge.envSelect(value).then(applyStatus);
  });
});

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (menu && !target.closest('.model-menu') && !target.closest('.picker')) closeMenu();
});

/* ---------- Navigation: the settings modal over the chat ---------- */

// State rules (last-used section, Escape ladder) are pure and tested in
// src/renderer/nav.ts; this file is the DOM applier.
let navState: NavState = { view: 'chat', lastSection: 'agents' };

/** The single navigation entry point — every view change goes through here. */
function nav(target: NavTarget): void {
  navState = navTransition(navState, target);
  switch (target.view) {
    case 'chat':
    case 'settings':
      showView(target.view);
      break;
    case 'agent-detail':
      void agentEditor.open(target.agent); // reveals the view once populated
      break;
    case 'env-detail':
      openDetail(target.env);
      break;
  }
}

/** Highlights the active section in the sidebar menu (parent section on detail pages). */
function syncSettingsNavActive(): void {
  settingsNav.querySelectorAll<HTMLElement>('.nav-item[data-section]').forEach((btn) => {
    btn.classList.toggle(
      'active',
      navState.view !== 'chat' && btn.dataset.section === navState.lastSection,
    );
  });
}

function showSettingsSection(section: SettingsSection): void {
  navState = { ...navState, lastSection: section };
  secAgents.classList.toggle('hidden', section !== 'agents');
  secProviders.classList.toggle('hidden', section !== 'providers');
  secEnvs.classList.toggle('hidden', section !== 'envs');
  syncSettingsNavActive();
  if (section === 'agents') {
    void renderAgents();
    secAgentsTitle.focus();
  } else if (section === 'providers') {
    void renderProviders();
    secProvidersTitle.focus();
  } else {
    void renderEnvs();
    secEnvsTitle.focus();
  }
}

function showView(view: View): void {
  // Direct callers (the editor's deferred reveal, openDetail) sync the state.
  navState = { ...navState, view };
  const modalOpen = view !== 'chat';
  // Settings live in a modal over the chat; the stage stays mounted beneath.
  settingsOverlay.classList.toggle('hidden', !modalOpen);
  settingsView.classList.toggle('hidden', view !== 'settings');
  envDetailView.classList.toggle('hidden', view !== 'env-detail');
  agentDetailView.classList.toggle('hidden', view !== 'agent-detail');
  // Nothing behind or beside the open modal may hold focus or be AT-reachable.
  stage.inert = modalOpen;
  sidebarEl.inert = modalOpen;
  settingsView.inert = view !== 'settings';
  envDetailView.inert = view !== 'env-detail';
  agentDetailView.inert = view !== 'agent-detail';
  openSettingsBtn.classList.toggle('active', modalOpen);
  // Leaving a detail page abandons it (the env delete flow relies on this).
  if (view !== 'agent-detail') agentEditor.abandon();
  if (view !== 'env-detail') detailEnvId = null;
  syncSettingsNavActive();
  if (view === 'settings') {
    showSettingsSection(navState.lastSection);
  } else if (view === 'env-detail') {
    detailTitle.focus();
  } else if (view === 'agent-detail') {
    agentTitle.focus();
  } else {
    stopAuthPoll(); // leaving settings abandons any pending connect poll
    void refreshStatus();
    prompt.focus();
  }
}

// Escape steps back: detail → its section list → close the modal.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (palette) return closePalette();
  if (menu) return closeMenu();
  const target = escapeTarget(navState);
  if (!target) {
    closeFullTurn(); // in chat: dismiss a full-screen turn if one is open
    return;
  }
  nav(target);
});

openSettingsBtn.addEventListener('click', () => nav({ view: 'settings' }));
settingsClose.addEventListener('click', () => nav({ view: 'chat' }));
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) nav({ view: 'chat' }); // backdrop click closes
});
settingsNav.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.nav-item') as HTMLElement | null;
  const section = btn?.dataset.section as SettingsSection | undefined;
  if (section) nav({ view: 'settings', section });
});
heroCta.addEventListener('click', () => nav({ view: 'settings', section: 'envs' }));

/* ---------- Providers view ---------- */

let waitingAuthProvider: string | null = null;
let authPoll: ReturnType<typeof setInterval> | null = null;
let authPollStarted = 0;

function stopAuthPoll(): void {
  waitingAuthProvider = null;
  if (authPoll) clearInterval(authPoll);
  authPoll = null;
}

/* ---------- Agents (settings section + detail page) ---------- */

// Monotonic request tokens: rapid tab switches must not land stale content.
const agentsGrid = latestToken();
const providersGrid = latestToken();
const envsGrid = latestToken();

async function renderAgents(): Promise<void> {
  if (!bridge) return;
  const token = agentsGrid.next();
  loadingInto(agentCards);
  const infos = await bridge.agentList().catch(() => []);
  if (!agentsGrid.isCurrent(token)) return;
  agentCards.removeAttribute('aria-busy');
  agentInfos = infos; // the sidebar roster follows Settings
  // Renames land everywhere: live conversations retitle, and if the renamed
  // chat is on screen its header/hero refresh without a remount.
  for (const renamed of store.syncAgentNames(infos)) {
    if (renamed === store.getMounted()) syncSessionChrome(renamed);
  }
  renderRecents();
  agentCards.textContent = '';
  for (const agent of infos) {
    const card = cardShell({
      title: agent.name,
      active: agent.active,
      headRight: providerLabel(agent.provider),
      clickable: {
        label: `Configure agent ${agent.name}`,
        onOpen: () => nav({ view: 'agent-detail', agent }),
      },
    });
    card.appendChild(
      el(
        'div',
        'card-sub',
        `${agent.model} · thinking ${agent.effort}` +
          (agent.systemPrompt.trim() ? ' · custom instructions' : ''),
      ),
    );

    const foot = el('div', 'card-foot');
    const use = button('btn-ghost', 'Open chat');
    use.addEventListener('click', (e) => {
      e.stopPropagation();
      void selectAndOpenChat(agent.id);
    });
    foot.appendChild(use);
    const remove = button('btn-ghost danger', 'Delete');
    armDelete(remove, async () => {
      agentMsg.textContent = '';
      try {
        agentInfos = await bridge.agentDelete(agent.id);
        // The conversation dies with its agent — the store interrupts its
        // turn and drops it plus its sub-agent chats; moving the UI off the
        // dead chat is this side's job.
        const conv = store.removeAgent(agent.id);
        if (conv && (current === conv || current.parentSessionId === conv.id)) {
          const next = agentInfos[0];
          if (next) {
            current = conversationFor(next);
            hydrate(current);
          } else {
            current = freshSession();
          }
          mountSession(current);
        }
        renderRecents();
        await refreshStatus();
      } catch (err) {
        agentMsg.textContent = errText(err);
      }
      await renderAgents();
    });
    foot.appendChild(remove);
    card.appendChild(foot);
    agentCards.appendChild(card);
  }

  agentCards.appendChild(
    addCard('+ New agent', async () => {
      agentMsg.textContent = '';
      try {
        const list = await bridge.agentCreate({
          name: 'New agent',
          provider: (await loadProviders())[0]?.id ?? '',
          model: 'auto',
          systemPrompt: '',
          effort: 'auto',
          options: {},
          advanced: '',
        });
        const newest = list[list.length - 1];
        if (newest) nav({ view: 'agent-detail', agent: newest });
      } catch (err) {
        agentMsg.textContent = errText(err);
      }
    }),
  );
}


// The agent editor owns its form, dirty tracking, section rail, and save
// flow (src/renderer/settings/agent-editor.ts); this file hands it the DOM.
const agentEditor = initAgentEditor({
  bridge,
  loadProviders,
  showView: () => showView('agent-detail'),
  navToAgents: () => nav({ view: 'settings', section: 'agents' }),
  refreshStatus,
  openAgentChat: (agentId) => void selectAndOpenChat(agentId),
  els: {
    view: agentDetailView,
    title: agentTitle,
    status: agentStatus,
    controls: agentControls,
    msg: agentDetailMsg,
    back: agentBack,
    name: aName,
    provider: aProvider,
    modelSeg: aModelSeg,
    model: aModel,
    thinkingSeg: aThinkingSeg,
    system: aSystem,
    systemHint: aSystemHint,
    options: aOptions,
    advanced: aAdvanced,
    advancedWarn: aAdvancedWarn,
    save: aSave,
    nav: agentNav,
    editorMain: agentEditorMain,
    dirty: agentDirty,
    identityCard: aedIdentity,
    identityModBadge: aIdentityMod,
    instructionsCard: aedInstructions,
    advancedCard: aedAdvanced,
  },
});

async function renderProviders(): Promise<void> {
  if (!bridge) return;
  const token = providersGrid.next();
  loadingInto(providerCards);
  const infos = await loadProviders();
  if (!providersGrid.isCurrent(token)) return;
  providerCards.removeAttribute('aria-busy');
  providerCards.textContent = '';
  for (const info of infos) {
    const card = cardShell({
      title: info.label,
      headRight: statusEl(info.auth.connected, info.auth.connected ? 'connected' : 'offline'),
    });
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
    const btn = button('btn-ghost', info.auth.connected ? 'Disconnect' : 'Connect');
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
          authPollStarted = Date.now();
          // The login completes in the app's sign-in window — poll until it
          // lands, giving up after 3 minutes if the user abandoned it.
          authPoll = setInterval(async () => {
            if (Date.now() - authPollStarted > 180_000) {
              stopAuthPoll();
              await renderProviders();
              return;
            }
            const latest = await loadProviders();
            if (latest.find((p) => p.id === info.id)?.auth.connected) {
              stopAuthPoll();
              await renderProviders();
            }
          }, 2000);
        }
      } catch (err) {
        providerMsg.textContent = errText(err);
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

async function renderEnvs(): Promise<void> {
  if (!bridge) return;
  const token = envsGrid.next();
  loadingInto(envCards); // envList shells out to docker — visibly slow
  const envs = await bridge.envList().catch(() => [] as EnvironmentInfo[]);
  if (!envsGrid.isCurrent(token)) return;
  renderEnvsFrom(envs);
}

/** Renders a known list — env ops feed their returned list here instead of
 *  paying a second round of per-container docker probes. */
function renderEnvsFrom(envs: EnvironmentInfo[]): void {
  if (!bridge) return;
  envCards.removeAttribute('aria-busy');
  envCards.textContent = '';
  for (const env of envs) {
    const card = cardShell({
      title: env.name,
      active: env.active,
      headRight: statusEl(env.status === 'running', env.status),
      clickable: {
        label: `Configure environment ${env.name}`,
        onOpen: () => nav({ view: 'env-detail', env }),
      },
    });
    card.appendChild(
      el(
        'div',
        'card-sub',
        `${env.dockerfile.trim() ? 'Dockerfile' : env.image} · ${env.workspacePath}`,
      ),
    );

    const foot = el('div', 'card-foot');
    envOpRail(foot, env, {
      bridge,
      applyStatus,
      stopPropagation: true, // rail clicks must not open the detail page
      message: (text) => {
        envMsg.textContent = text;
      },
      onSettled: async (latest) => {
        if (latest) renderEnvsFrom(latest);
        else await renderEnvs();
        await refreshStatus();
      },
      onDelete: (target) => {
        if (detailEnvId === target.id) detailEnvId = null;
        return bridge.envDelete(target.id);
      },
    });
    card.appendChild(foot);
    envCards.appendChild(card);
  }

  // Dashed add-card creates an environment and opens its page for configuring.
  envCards.appendChild(
    addCard('+ New environment', async () => {
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
        if (newest) nav({ view: 'env-detail', env: newest });
      } catch (err) {
        envMsg.textContent = errText(err);
      }
    }),
  );
}

function kvRow(key: string, value: string, onRemove: () => void): HTMLElement {
  const row = el('div', 'kv-row');
  row.appendChild(el('span', 'kv-key', key));
  row.appendChild(el('span', 'kv-val', value));
  const remove = button('kv-remove', '✕');
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
  if (!bridge) return;
  envOpRail(detailControls, env, {
    bridge,
    applyStatus,
    message: (text) => {
      detailMsg.textContent = text;
    },
    onSettled: async (latest) => {
      await refreshStatus();
      if (!detailEnvId) return; // deleted — already navigated back
      const list = latest ?? ((await bridge.envList().catch(() => [])) as EnvironmentInfo[]);
      const shown = list.find((e) => e.id === detailEnvId);
      if (shown) renderDetailHeader(shown);
    },
    onDelete: async (target) => {
      const out = await bridge.envDelete(target.id);
      nav({ view: 'settings', section: 'envs' }); // showView clears detailEnvId
      return out;
    },
  });
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

detailBack.addEventListener('click', () => nav({ view: 'settings', section: 'envs' }));

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
    detailMsg.textContent = errText(err);
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
    detailMsg.textContent = errText(err);
  }
  dSave.disabled = false;
});

/* ---------- Sessions ---------- */

let agentInfos: AgentInfo[] = [];

// The session model lives in the store (src/renderer/session-store.ts);
// the rendering layer lives in chat-view. This file wires them to the DOM,
// the bridge, and each other.
const store = createSessionStore({
  interrupt: (turnId) => {
    if (harness) harness.interrupt(turnId);
  },
  save: (agentId, data) => (bridge ? bridge.convoSave(agentId, data) : Promise.resolve()),
  onSaveError: (session, err) => showToast(`Couldn't save "${session.title}": ${err.message}`),
  currentDraft: () => prompt.value,
});
const { conversations } = store;
const freshSession = store.freshSession;
const conversationFor = store.conversationFor;
const persistConversation = store.persist;
const schedulePersist = store.schedulePersist;

const chatView = initChatView({
  userName: USER_NAME,
  scrollChat,
  answerAsk: (turnId, askId, answers) =>
    harness ? harness.answerAsk(turnId, askId, answers) : Promise.resolve(),
  toast: showToast,
  schedulePersist,
  rosterChanged: renderRecents,
  isCurrent: (session) => session === current,
  openSession,
  spawnChild: store.spawnChild,
  pruneChildren: store.dropChildren,
  overlay: {
    body: turnFullBody,
    crumb: turnFullCrumb,
    title: turnFullTitle,
    stage,
    backButton: turnFullBack,
  },
});
const { addUserMessage, addAssistantTurn, hydrate, closeFullTurn } = chatView;

/** Bring a session on screen in the chat view. */
function showSession(session: Session): void {
  nav({ view: 'chat' });
  if (session === current) return;
  current = session;
  session.unread = null;
  hydrate(session); // no-op for sub-agent chats (nothing pending)
  mountSession(session);
  renderRecents();
  prompt.focus();
}

function openConversation(agentId: string): void {
  const info = agentInfos.find((a) => a.id === agentId);
  if (info) showSession(conversationFor(info));
}

/** Make an agent the active one (main tracks it) and open its chat. */
async function selectAndOpenChat(agentId: string): Promise<void> {
  if (!bridge) return;
  applyStatus(await bridge.agentSelect(agentId));
  openConversation(agentId);
}


let current: Session = freshSession();


/** Swap the chat scroller over to a session's live thread. */
function mountSession(session: Session): void {
  const prev = store.getMounted();
  if (prev && prev !== session) {
    // Draft and scroll state are per conversation — never leak across agents.
    prev.draft = prompt.value;
    prev.scrollPos = chat.scrollTop;
    prev.stick = stickToBottom;
  }
  store.setMounted(session);
  chat.querySelector('.thread')?.remove();
  chat.appendChild(session.thread);
  closeFullTurn(); // full-screen detail belongs to the previous view
  prompt.value = session.draft ?? '';
  autosize();
  stickToBottom = session.stick ?? true;
  chat.scrollTop = stickToBottom ? chat.scrollHeight : session.scrollPos ?? 0;
  stage.classList.toggle('empty', !session.thread.children.length);
  syncSessionChrome(session);
}

/** Chat header, hero, and composer text derived from the session's title. */
function syncSessionChrome(session: Session): void {
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

function sessionSnippet(session: Session): string {
  const parts = session.thread.querySelectorAll('.prose, .error-block');
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
    const btn = button('recent agent-row' + (conv && conv === current ? ' active' : ''), info.name);
    btn.title =
      providerLabel(info.provider) +
      (conv && conv.turns > 0
        ? ` · ctx ${fmtTokens(conv.usage)} · ${relTime(conv.lastActiveAt)}`
        : ' · no messages yet');
    btn.addEventListener('click', () => openConversation(info.id));
    item.appendChild(btn);
    const state = conv?.running ? 'running' : conv?.unread;
    if (state) item.appendChild(statusDot(state));
    if (conv?.running && conv.turnId) {
      // Background turns are stoppable from the roster, not just when open.
      const stopBtn = button('recent-stop');
      stopBtn.title = `Stop ${info.name}'s turn`;
      stopBtn.innerHTML = STOP_ICON;
      stopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (conv.turnId && harness) harness.interrupt(conv.turnId);
      });
      item.appendChild(stopBtn);
    }
    recentsList.appendChild(item);

    // Sub-agent chats, nested under the conversation that spawned them.
    if (!conv) continue;
    for (const child of store.childrenOf(conv)) {
      const childItem = el('li', 'recent-item child');
      const childBtn = button('recent' + (child.id === current.id ? ' active' : ''), child.title);
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
  nav({ view: 'chat' });
  const target = store.findSession(id);
  if (target) showSession(target);
}

/* ---------- Turn loop ---------- */

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
  session.log.push({ kind: 'user', text: trimmed, author: 'user', ts: Date.now() });
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
      applyEvent(turn, event, false);
      switch (event.kind) {
        case 'error':
        case 'ask':
          if (session !== current) {
            session.unread = event.kind;
            renderRecents();
          }
          break;
        case 'turn-end':
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
  nav({ view: 'settings', section: 'agents' });
});

turnFullBack.addEventListener('click', closeFullTurn);

/* ---------- Command palette: Cmd+K switches agents + searches history ---------- */

let palette: HTMLElement | null = null;

function closePalette(): void {
  palette?.remove();
  palette = null;
}

function openPalette(): void {
  closePalette();
  palette = el('div', 'palette-overlay');
  const box = el('div', 'palette');
  const input = document.createElement('input');
  input.className = 'palette-input';
  input.placeholder = 'Jump to an agent or search messages…';
  const list = el('div', 'palette-list');
  box.append(input, list);
  palette.appendChild(box);
  palette.addEventListener('click', (e) => {
    if (e.target === palette) closePalette();
  });
  document.body.appendChild(palette);

  const entryText = (entry: ConversationEntry): string =>
    entry.kind === 'user'
      ? entry.text
      : entry.events
          .filter((e) => e.kind === 'text-delta')
          .map((e) => (e.kind === 'text-delta' ? e.text : ''))
          .join(' ');

  // Flattened, lowercased once per palette open (the first time a query needs
  // it) — not on every keystroke.
  let index: { info: AgentInfo; entries: { text: string; lower: string }[] }[] | null = null;
  const getIndex = () =>
    (index ??= agentInfos.map((info) => {
      const conv = conversations.get(info.id);
      return {
        info,
        entries: (conv?.pendingLog ?? conv?.log ?? []).map((entry) => {
          const text = entryText(entry);
          return { text, lower: text.toLowerCase() };
        }),
      };
    }));

  const refresh = (): void => {
    const q = input.value.trim().toLowerCase();
    list.textContent = '';
    const items: { label: string; sub: string; go: () => void }[] = [];
    for (const info of agentInfos) {
      if (!q || info.name.toLowerCase().includes(q)) {
        items.push({
          label: info.name,
          sub: providerLabel(info.provider),
          go: () => openConversation(info.id),
        });
      }
    }
    if (q.length >= 2) {
      for (const { info, entries } of getIndex()) {
        for (const { text, lower } of entries) {
          const idx = lower.indexOf(q);
          if (idx === -1) continue;
          const snippet = text
            .slice(Math.max(0, idx - 24), idx + q.length + 40)
            .split(/\s+/)
            .join(' ');
          items.push({
            label: `“…${snippet}…”`,
            sub: `in ${info.name}`,
            go: () => openConversation(info.id),
          });
          break; // one hit per conversation keeps the list scannable
        }
      }
    }
    for (const item of items.slice(0, 12)) {
      const row = button('palette-item');
      row.append(el('span', 'palette-label', item.label), el('span', 'palette-sub', item.sub));
      row.addEventListener('click', () => {
        closePalette();
        item.go();
      });
      list.appendChild(row);
    }
  };

  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePalette();
    else if (e.key === 'Enter') (list.firstElementChild as HTMLElement | null)?.click();
    else if (e.key === 'ArrowDown') {
      (list.firstElementChild as HTMLElement | null)?.focus();
      e.preventDefault();
    }
  });
  list.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (e.key === 'ArrowDown') {
      (target.nextElementSibling as HTMLElement | null)?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      ((target.previousElementSibling as HTMLElement | null) ?? input).focus();
      e.preventDefault();
    } else if (e.key === 'Escape') closePalette();
  });
  refresh();
  input.focus();
}

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (palette) closePalette();
    else openPalette();
  } else if (mod && e.key === ',') {
    e.preventDefault();
    nav({ view: 'settings' }); // last-used section, same as the gear
  } else if (mod && /^[1-9]$/.test(e.key)) {
    const info = agentInfos[Number(e.key) - 1];
    if (info) {
      e.preventDefault();
      openConversation(info.id);
    }
  }
});

/** Load the agent roster and restore each agent's permanent conversation. */
async function boot(): Promise<void> {
  if (!bridge) {
    mountSession(current);
    return;
  }
  // Labels must be cached before conversations render; the four fetches are
  // otherwise independent.
  const [, infos, saved, status] = await Promise.all([
    loadProviders(),
    bridge.agentList().catch(() => []),
    bridge.convoLoad().catch(() => ({}) as Record<string, never>),
    bridge.status().catch(() => null),
  ]);
  agentInfos = infos;
  for (const info of agentInfos) {
    const conv = conversationFor(info);
    const data = saved[info.id];
    // Histories are only REPLAYED when their conversation first opens — boot
    // stays fast.
    if (data && conv.turns === 0) {
      conv.pendingLog = data.log;
      conv.usage = data.lastTurnTokens;
      conv.lastActiveAt = data.lastActiveAt;
      conv.turns = data.turns;
      conv.draft = data.draft;
    }
  }
  renderRecents();
  if (status) applyStatus(status);
  const first = agentInfos.find((a) => a.id === status?.agent?.id) ?? agentInfos[0];
  if (first) openConversation(first.id);
  else mountSession(current);
}
void boot();
