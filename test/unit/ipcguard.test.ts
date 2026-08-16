import { describe, expect, it } from 'vitest';
import { agentConfigFrom, envConfigFrom, requireId } from '../../src/main/ipcguard';

describe('requireId', () => {
  it('accepts ids we mint', () => {
    expect(requireId('claude-default', 'agent')).toBe('claude-default');
    expect(requireId('msujajyg', 'environment')).toBe('msujajyg');
  });
  it('rejects traversal and junk', () => {
    expect(() => requireId('../../etc/passwd', 'environment')).toThrow();
    expect(() => requireId('', 'agent')).toThrow();
    expect(() => requireId(42, 'agent')).toThrow();
    expect(() => requireId('UPPER', 'agent')).toThrow();
  });
});

describe('envConfigFrom', () => {
  it('rejects docker-flag injection in image and workspace', () => {
    expect(() => envConfigFrom({ image: '--privileged' })).toThrow();
    expect(() => envConfigFrom({ image: 'node:22', workspacePath: '--pid=host' })).toThrow();
  });
  it('filters invalid env var keys', () => {
    const cfg = envConfigFrom({
      image: 'node:22',
      envVars: { GOOD_KEY: 'v', 'bad key': 'x', 'ALSO-BAD': 'y' },
    });
    expect(cfg.envVars).toEqual({ GOOD_KEY: 'v' });
  });
  it('throws on non-object payloads', () => {
    expect(() => envConfigFrom(null)).toThrow();
    expect(() => envConfigFrom('x')).toThrow();
  });
});

describe('agentConfigFrom', () => {
  it('coerces missing fields to safe defaults', () => {
    const cfg = agentConfigFrom({ name: 'A', provider: 'codex' });
    expect(cfg.model).toBe('auto');
    expect(cfg.systemPrompt).toBe('');
  });
});
