/**
 * Validation at the IPC boundary. The renderer is inside our app, but treat
 * its payloads as untrusted: ids feed file paths and docker argv, and configs
 * previously arrived typed as `never` (no checking at all).
 */

import type { AgentConfig, EnvironmentConfig } from '../harness/bridge';

/** Store ids we mint (base36 timestamps, seeded `claude-default`, …). */
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

export function agentConfigFrom(raw: unknown): Omit<AgentConfig, 'id'> {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid agent config.');
  const cfg = raw as Record<string, unknown>;
  return {
    name: str(cfg.name),
    provider: str(cfg.provider),
    model: str(cfg.model, 'auto'),
    systemPrompt: str(cfg.systemPrompt),
    thinking: str(cfg.thinking, 'auto'),
    advanced: str(cfg.advanced),
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
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string') {
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
