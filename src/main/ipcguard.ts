/**
 * Validation at the IPC boundary. The renderer is inside our app, but treat
 * its payloads as untrusted: ids feed file paths and docker argv, and
 * conversation payloads land on disk forever.
 */

import type { AgentConfig, ConversationData, ConversationEntry, EnvironmentConfig } from '../harness/bridge';
import type { HarnessEvent } from '../harness/types';
import { isPlainObject } from '../harness/options';

/** Store ids we mint (crypto.randomUUID() plus seeded slugs like `claude-default`). */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function requireId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw new Error(`Invalid ${what} id.`);
  }
  return value;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Plain-object-or-empty; per-key schema validation happens in the agent store. */
function settingsFrom(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? { ...value } : {};
}

export function agentConfigFrom(raw: unknown): Omit<AgentConfig, 'id'> {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid agent config.');
  const cfg = raw as Record<string, unknown>;
  return {
    name: str(cfg.name),
    provider: str(cfg.provider),
    model: str(cfg.model, 'auto'),
    systemPrompt: str(cfg.systemPrompt),
    effort: str(cfg.effort, 'auto'),
    options: settingsFrom(cfg.options),
    advanced: str(cfg.advanced),
  };
}

/** Secret keys and env var keys both become env var names inside containers. */
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function requireSecretKey(value: unknown): string {
  if (typeof value !== 'string' || !ENV_NAME_RE.test(value)) {
    throw new Error('Invalid secret key.');
  }
  return value;
}

/**
 * Conversation saves are renderer-authored and land on disk forever; enforce
 * the entry shape (the size ceiling lives in conversations.save, where the
 * payload is serialized anyway). Throws on malformed payloads so a renderer
 * bug surfaces as a failed save instead of a corrupted file.
 */
export function convoDataFrom(raw: unknown): ConversationData {
  if (!isPlainObject(raw)) throw new Error('Invalid conversation payload.');
  if (!Array.isArray(raw.log)) throw new Error('Invalid conversation log.');
  const num = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const log = raw.log.map((entry): ConversationEntry => {
    if (typeof entry !== 'object' || entry === null) throw new Error('Invalid conversation entry.');
    const e = entry as Record<string, unknown>;
    if (e.kind === 'user') {
      return {
        kind: 'user',
        text: str(e.text),
        author: str(e.author, 'user'),
        ts: num(e.ts),
      };
    }
    if (e.kind === 'turn' && Array.isArray(e.events)) {
      return { kind: 'turn', ts: num(e.ts), events: e.events as HarnessEvent[] };
    }
    throw new Error('Invalid conversation entry.');
  });
  return {
    v: typeof raw.v === 'number' ? raw.v : 1,
    log,
    lastTurnTokens: num(raw.lastTurnTokens),
    lastActiveAt: num(raw.lastActiveAt),
    turns: num(raw.turns),
    ...(typeof raw.draft === 'string' ? { draft: raw.draft } : {}),
  };
}

export function envConfigFrom(raw: unknown): EnvironmentConfig {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid environment config.');
  const cfg = raw as Record<string, unknown>;
  const image = str(cfg.image).trim();
  const workspacePath = str(cfg.workspacePath).trim();
  // Leading-dash values would be parsed by docker as flags, not operands.
  if (image.startsWith('-')) throw new Error('Invalid image name.');
  if (workspacePath.startsWith('-')) throw new Error('Invalid workspace path.');
  const envVars: Record<string, string> = {};
  if (typeof cfg.envVars === 'object' && cfg.envVars !== null) {
    for (const [key, value] of Object.entries(cfg.envVars as Record<string, unknown>)) {
      if (ENV_NAME_RE.test(key) && typeof value === 'string') {
        envVars[key] = value;
      }
    }
  }
  return {
    name: str(cfg.name),
    image,
    workspacePath,
    autoInstall: cfg.autoInstall !== false,
    dockerfile: str(cfg.dockerfile),
    envVars,
  };
}
