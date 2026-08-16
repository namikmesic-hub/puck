import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, '../../src/main/runner/runner.js'),
  'utf8',
);

describe('container runner source', () => {
  it('is syntactically valid JavaScript', () => {
    expect(() => new Function(source)).not.toThrow();
  });

  it('keeps the PROVIDERS table in sync with the host registry ids', () => {
    expect(source).toContain("'claude-code': {");
    expect(source).toContain('codex: {');
    expect(source).toContain('@anthropic-ai/claude-agent-sdk');
    expect(source).toContain('@openai/codex-sdk');
  });

  it('keeps the stdio protocol markers', () => {
    for (const op of ["'ping'", "'interrupt'", "'answer'", "'turn'"]) {
      expect(source).toContain(op);
    }
    expect(source).toContain('ready: true');
    expect(source).toContain('providerSessionId');
  });
});
