/**
 * Codex account OAuth — the provider-specific half.
 *
 * Reproduces `codex login`: Authorization Code + PKCE against auth.openai.com,
 * authorize page in the system browser, redirect received on the Codex
 * client's registered loopback callback 127.0.0.1:1455 - so the login
 * completes automatically, no code pasting. Everything generic (storage,
 * refresh policy, container-credential adoption and freshness) lives in the
 * shared account (oauth.ts); the listener lives in loopback.ts.
 */

import { shell } from 'electron';
import { LoginCancelledError, startLoopback, type LoopbackListener } from './loopback';
import { createOAuthAccount, pkce, randomState } from './oauth';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'; // Codex CLI's public OAuth client
const ISSUER = 'https://auth.openai.com';
const PORT = 1455; // registered callback port of the Codex client
const CALLBACK_PATH = '/auth/callback';
const REDIRECT_URI = `http://localhost:${PORT}${CALLBACK_PATH}`;
const SCOPE = 'openid profile email offline_access api.connectors.read api.connectors.invoke';

/** Refresh well before OpenAI's refresh-token idle expiry; the in-container
 *  CLI handles short-lived access-token refreshes itself. */
const REFRESH_AFTER_MS = 5 * 24 * 60 * 60 * 1000;

export interface CodexTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  accountId: string;
  lastRefresh: string; // ISO
}

export const account = createOAuthAccount<CodexTokens>({
  storeName: 'codex-oauth.bin',
  freshnessOf: (t) => Date.parse(t.lastRefresh) || 0,
  needsRefresh: (t) => Date.now() - Date.parse(t.lastRefresh) > REFRESH_AFTER_MS && !!t.refreshToken,
  async refresh(tokens) {
    const res = await fetch(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        scope: 'openid profile email',
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      id_token?: string;
      access_token?: string;
      refresh_token?: string;
    };
    return {
      idToken: data.id_token ?? tokens.idToken,
      accessToken: data.access_token ?? tokens.accessToken,
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      accountId: tokens.accountId,
      lastRefresh: new Date().toISOString(),
    };
  },
  parseContainerFile(parsed) {
    const file = parsed as {
      tokens?: {
        id_token?: string;
        access_token?: string;
        refresh_token?: string;
        account_id?: string;
      };
      last_refresh?: string;
    } | null;
    if (!file?.tokens?.access_token || !file.tokens.refresh_token || !file.last_refresh) {
      return null;
    }
    return {
      idToken: file.tokens.id_token ?? '',
      accessToken: file.tokens.access_token,
      refreshToken: file.tokens.refresh_token,
      accountId: file.tokens.account_id ?? '',
      lastRefresh: file.last_refresh,
    };
  },
});

let pending: LoopbackListener | null = null;

/** True while a login waits for the browser to hit the loopback callback. */
export function loginPending(): boolean {
  return pending !== null;
}

/** Abort a login in progress (Cancel button, logout, quit). No-op otherwise. */
export function cancelLogin(): void {
  pending?.cancel();
  pending = null;
}

function accountIdFromIdToken(idToken: string): string {
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const auth = payload['https://api.openai.com/auth'] as
      | { chatgpt_account_id?: string }
      | undefined;
    return auth?.chatgpt_account_id ?? '';
  } catch {
    return '';
  }
}

async function exchangeCode(code: string, verifier: string): Promise<void> {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    id_token: string;
    access_token: string;
    refresh_token: string;
  };
  account.save({
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accountId: accountIdFromIdToken(data.id_token),
    lastRefresh: new Date().toISOString(),
  });
}

/**
 * Starts the loopback listener on the registered port, opens the authorize
 * page in the system browser and resolves with the authorize URL. The login
 * itself completes asynchronously when the browser is redirected back.
 */
export async function startLogin(): Promise<string> {
  cancelLogin(); // a new attempt supersedes any pending one
  const { verifier, challenge } = pkce(64);
  const state = randomState();
  const url =
    `${ISSUER}/oauth/authorize?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      state,
      originator: 'codex_cli_rs',
    }).toString();

  let listener: LoopbackListener;
  try {
    listener = await startLoopback({ path: CALLBACK_PATH, state, port: PORT });
  } catch (err) {
    throw (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
      ? new Error(`Port ${PORT} is busy - is \`codex login\` running somewhere else?`)
      : err;
  }
  pending = listener;

  listener.code
    .then((code) => exchangeCode(code, verifier))
    .then(() => account.notifyLogin())
    .catch((err) => {
      if (!(err instanceof LoginCancelledError)) account.recordError(err);
    })
    .finally(() => {
      if (pending === listener) pending = null;
    });

  await shell.openExternal(url);
  return url;
}

/** The ~/.codex/auth.json body the Codex CLI reads (schema verified). */
export function authJsonContent(tokens: CodexTokens): string {
  return JSON.stringify({
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: tokens.idToken,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      account_id: tokens.accountId,
    },
    last_refresh: tokens.lastRefresh,
  });
}
