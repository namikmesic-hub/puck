/** Claude Code's Provider implementation. */

import * as os from 'node:os';
import * as path from 'node:path';
import { clearAuthSession } from '../authwindow';
import type { Provider } from './types';
import * as oauth from './claude-oauth';

export const claudeProvider: Provider = {
  id: 'claude-code',
  label: 'Claude Code',
  models: ['auto', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  thinkingLevels: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
  systemPromptHint: 'appended to the harness system prompt',
  capabilities: {
    supportsAsk: true,
    subAgents: true,
    streamsTokens: true,
    reportsCost: true,
  },

  auth: {
    status: () => {
      const s = oauth.status();
      return {
        connected: s.connected,
        detail: s.connected
          ? `Connected — token refreshes automatically (expires ${new Date(s.expiresAt ?? 0).toLocaleString()})`
          : 'Not connected — sign in with your Claude account',
      };
    },
    start: async () => oauth.startLogin(),
    logout: () => {
      oauth.logout();
      clearAuthSession();
    },
    setOnLogin: (cb) => oauth.setOnLogin(cb),
  },

  container: {
    cliBin: 'claude',
    cliPackages: ['@anthropic-ai/claude-code'],
    sdkPackages: ['@anthropic-ai/claude-agent-sdk'],
    forwardedEnvKeys: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'],
    // Claude Code refuses --dangerously-skip-permissions as root unless it
    // can tell it's sandboxed; the container is exactly that sandbox.
    containerEnv: { IS_SANDBOX: '1' },
    credential: {
      hostPath: path.join(os.homedir(), '.claude', '.credentials.json'),
      containerPath: '/root/.claude/.credentials.json',
      fresh: async () => {
        const tokens = await oauth.getFreshTokens();
        if (!tokens) return null;
        return {
          content: oauth.credentialsFileContent(tokens),
          supersedes: (containerJson) => {
            try {
              const theirs = JSON.parse(containerJson) as {
                claudeAiOauth?: { expiresAt?: number };
              };
              return (theirs.claudeAiOauth?.expiresAt ?? 0) < tokens.expiresAt;
            } catch {
              return true; // unparseable — overwrite
            }
          },
        };
      },
      adoptIfNewer: (containerJson) => oauth.adoptIfNewer(containerJson),
    },
  },
};
