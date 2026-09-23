import { describe, expect, it } from 'vitest';
import {
  defaultProvider,
  providerById,
  providerInfos,
  providers,
  requireProvider,
  toInfo,
} from '../../src/main/providers';

describe('provider registry', () => {
  it('registers claude-code first (registration order is the default)', () => {
    expect(providers.map((p) => p.id)).toEqual(['claude-code', 'codex']);
    expect(defaultProvider().id).toBe('claude-code');
  });

  it('looks up by id and throws on unknown ids', () => {
    expect(providerById('codex')?.label).toBe('Codex');
    expect(providerById('nope')).toBeUndefined();
    expect(() => requireProvider('nope')).toThrow(/Unknown provider/);
  });

  it('exposes complete frontend metadata', () => {
    for (const info of providerInfos()) {
      expect(info.models[0]).toBe('auto');
      expect(info.thinkingLevels[0]).toBe('auto');
      expect(info.systemPromptHint.length).toBeGreaterThan(0);
      expect(info.configOptions.length).toBeGreaterThan(0);
      expect(typeof info.capabilities.supportsAsk).toBe('boolean');
      expect(typeof info.auth.connected).toBe('boolean');
    }
  });

  it('declares sub-agent support and whether the child transcript arrives', () => {
    for (const info of providerInfos()) {
      expect(typeof info.capabilities.subAgents).toBe('boolean');
      expect(typeof info.capabilities.subAgentTranscript).toBe('boolean');
      // A transcript needs sub-agent chats to land in.
      if (info.capabilities.subAgentTranscript) expect(info.capabilities.subAgents).toBe(true);
    }
    expect(providerById('claude-code')?.capabilities).toMatchObject({ subAgents: true, subAgentTranscript: true });
    // codex exec reports collab tool calls (cards), never the child thread.
    expect(providerById('codex')?.capabilities).toMatchObject({ subAgents: true, subAgentTranscript: false });
  });

  it('codex advertises the current reasoning levels', () => {
    expect(providerById('codex')?.thinkingLevels).toContain('xhigh');
  });

  it('toInfo never leaks auth methods or container internals', () => {
    const info = toInfo(providers[0]);
    expect(Object.keys(info).sort()).toEqual(
      ['auth', 'capabilities', 'configOptions', 'id', 'label', 'models', 'systemPromptHint', 'thinkingLevels'].sort(),
    );
  });

  it('derives the container bootstrap contract both providers rely on', () => {
    const clis = providers.flatMap((p) => p.container.cliPackages);
    const sdks = providers.flatMap((p) => p.container.sdkPackages);
    expect(clis.map((p) => p.name)).toEqual(['@anthropic-ai/claude-code', '@openai/codex']);
    expect(sdks.map((p) => p.name)).toEqual(['@anthropic-ai/claude-agent-sdk', '@openai/codex-sdk']);
    // Every container package is pinned to an exact version (no ranges):
    // provisioning verifies the installed version against it after install.
    for (const pkg of [...clis, ...sdks]) expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const p of providers) {
      expect(p.container.credential.containerPath.startsWith('/root/.')).toBe(true);
    }
  });
});
