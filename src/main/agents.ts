/**
 * Agent primitive (main process).
 *
 * An agent is a named, persisted provider configuration — provider, model,
 * system instructions, thinking level, and an advanced JSON passthrough for
 * anything else the provider's API exposes. Chat turns run through the
 * active agent inside the active environment.
 */

import { app } from 'electron';
import * as path from 'node:path';
import type { AgentConfig, AgentInfo } from '../harness/bridge';
import { defaultProvider, providerById } from './providers';
import { readJson, writeJsonAtomic } from './jsonstore';

interface Store {
  agents: AgentConfig[];
  activeAgentId: string | null;
}

let store: Store | null = null;

function storePath(): string {
  return path.join(app.getPath('userData'), 'puck-agents.json');
}

function load(): Store {
  if (!store) {
    store = readJson<Store>(storePath()) ?? { agents: [], activeAgentId: null };
    if (!store.agents.length) {
      store.agents = [
        {
          id: 'claude-default',
          name: 'Claude',
          provider: 'claude-code',
          model: 'auto',
          systemPrompt: '',
          thinking: 'auto',
          advanced: '',
        },
        {
          id: 'codex-default',
          name: 'Codex',
          provider: 'codex',
          model: 'auto',
          systemPrompt: '',
          thinking: 'auto',
          advanced: '',
        },
      ];
      store.activeAgentId = 'claude-default';
      save();
    }
  }
  return store;
}

function save(): void {
  if (store) void writeJsonAtomic(storePath(), store);
}

function sanitize(cfg: Omit<AgentConfig, 'id'>): Omit<AgentConfig, 'id'> {
  if (cfg.advanced?.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(cfg.advanced);
    } catch {
      throw new Error('Advanced options must be valid JSON.');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Advanced options must be a JSON object.');
    }
  }
  return {
    name: cfg.name.trim() || 'agent',
    provider: providerById(cfg.provider) ? cfg.provider : defaultProvider().id,
    model: cfg.model.trim() || 'auto',
    systemPrompt: cfg.systemPrompt ?? '',
    thinking: cfg.thinking.trim() || 'auto',
    advanced: cfg.advanced?.trim() ?? '',
  };
}

export function list(): AgentInfo[] {
  const s = load();
  return s.agents.map((a) => ({ ...a, active: a.id === s.activeAgentId }));
}

export function create(cfg: Omit<AgentConfig, 'id'>): AgentInfo[] {
  const s = load();
  s.agents.push({ id: Date.now().toString(36), ...sanitize(cfg) });
  save();
  return list();
}

export function update(id: string, cfg: Omit<AgentConfig, 'id'>): AgentInfo[] {
  const s = load();
  const idx = s.agents.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error('Unknown agent');
  s.agents[idx] = { id, ...sanitize(cfg) };
  save();
  return list();
}

export function remove(id: string): AgentInfo[] {
  const s = load();
  s.agents = s.agents.filter((a) => a.id !== id);
  if (s.activeAgentId === id) s.activeAgentId = s.agents[0]?.id ?? null;
  save();
  return list();
}

export function select(id: string): void {
  const s = load();
  if (s.agents.some((a) => a.id === id)) {
    s.activeAgentId = id;
    save();
  }
}

export function active(): AgentConfig | null {
  const s = load();
  return s.agents.find((a) => a.id === s.activeAgentId) ?? null;
}
