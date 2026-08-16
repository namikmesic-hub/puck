/** Codex's Provider implementation. */

import * as os from 'node:os';
import * as path from 'node:path';
import { clearAuthSession } from '../authwindow';
import type { Provider } from './types';
import * as oauth from './codex-oauth';

// Codex's model lineup shifts frequently; "auto" defers to the CLI default.
// Extend the picker with PUCK_CODEX_MODELS=a,b,c
export const codexProvider: Provider = {
  id: 'codex',
  label: 'Codex',
  models: [
    'auto',
    ...(process.env.PUCK_CODEX_MODELS?.split(',').map((m) => m.trim()).filter(Boolean) ?? []),
  ],
  thinkingLevels: ['auto', 'minimal', 'low', 'medium', 'high'],
  systemPromptHint: 'sent as instructions when a session thread starts',
  capabilities: {
    supportsAsk: false,
    subAgents: false,
    streamsTokens: false,
    reportsCost: false,
  },

  auth: {
    status: () => oauth.status(),
    start: () => oauth.startLogin(),
    logout: () => {
      oauth.logout();
      clearAuthSession();
    },
    setOnLogin: (cb) => oauth.setOnLogin(cb),
  },

  container: {
    cliBin: 'codex',
    cliPackages: ['@openai/codex'],
    sdkPackages: ['@openai/codex-sdk'],
    forwardedEnvKeys: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
    containerEnv: {},
    credential: {
      hostPath: path.join(os.homedir(), '.codex', 'auth.json'),
      containerPath: '/root/.codex/auth.json',
      fresh: async () => {
        const tokens = await oauth.getFreshTokens();
        if (!tokens) return null;
        return {
          content: oauth.authJsonContent(tokens),
          supersedes: (containerJson) => {
            try {
              const theirs = JSON.parse(containerJson) as { last_refresh?: string };
              // NaN comparisons are false → missing/invalid dates overwrite,
              // matching the previous fall-through behavior.
              return !(Date.parse(theirs.last_refresh ?? '') >= Date.parse(tokens.lastRefresh));
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
