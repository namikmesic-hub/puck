/**
 * Codex account OAuth.
 *
 * Reproduces `codex login`: Authorization Code + PKCE against auth.openai.com
 * with a local callback server on 127.0.0.1:1455 — so the login completes
 * automatically, no code pasting. Tokens are stored encrypted and injected
 * into environment containers as ~/.codex/auth.json (schema matches what the
 * Codex CLI writes: auth_mode/OPENAI_API_KEY/tokens/last_refresh).
 */

import * as http from 'node:http';
import { closeAuthWindow, openAuthWindow } from '../authwindow';
import { pkce, randomState, tokenStore } from './oauth';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'; // Codex CLI's public OAuth client
const ISSUER = 'https://auth.openai.com';
const PORT = 1455; // registered callback port of the Codex client
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;
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

const store = tokenStore<CodexTokens>('codex-oauth.bin');

let server: http.Server | null = null;
let onLoginCb: (() => void) | null = null;

export function setOnLogin(cb: () => void): void {
  onLoginCb = cb;
}

export function status(): { connected: boolean; detail: string } {
  const tokens = store.load();
  return tokens
    ? { connected: true, detail: `Connected — last refreshed ${tokens.lastRefresh.slice(0, 16)}` }
    : { connected: false, detail: 'Not connected — sign in with your ChatGPT account' };
}

export function logout(): void {
  closeServer();
  store.clear();
}

function closeServer(): void {
  server?.close();
  server = null;
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
  store.save({
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accountId: accountIdFromIdToken(data.id_token),
    lastRefresh: new Date().toISOString(),
  });
}

/**
 * Starts the callback server and opens the browser. Resolves with the
 * authorize URL; the login itself completes asynchronously when the browser
 * redirects to the local callback.
 */
export function startLogin(): Promise<string> {
  closeServer();
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

  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://localhost:${PORT}`);
      if (reqUrl.pathname !== '/auth/callback') {
        res.writeHead(404).end();
        return;
      }
      if (reqUrl.searchParams.get('state') !== state) {
        res.writeHead(400).end('State mismatch - restart the login from Puck.');
        return;
      }
      const code = reqUrl.searchParams.get('code');
      if (!code) {
        res.writeHead(400).end('Missing authorization code.');
        return;
      }
      try {
        await exchangeCode(code, verifier);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Codex is connected to Puck.</h2>');
        closeAuthWindow();
        onLoginCb?.();
      } catch (err) {
        res.writeHead(500).end(`Login failed: ${err instanceof Error ? err.message : err}`);
      } finally {
        closeServer();
      }
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      closeServer();
      reject(
        err.code === 'EADDRINUSE'
          ? new Error('Port 1455 is busy — is `codex login` running somewhere else?')
          : err,
      );
    });
    server.listen(PORT, '127.0.0.1', () => {
      openAuthWindow(url, 'Sign in to ChatGPT');
      resolve(url);
    });
    setTimeout(closeServer, 10 * 60_000); // abandon after 10 minutes
  });
}

export async function getFreshTokens(): Promise<CodexTokens | null> {
  let tokens = store.load();
  if (!tokens) return null;
  const age = Date.now() - Date.parse(tokens.lastRefresh);
  if (age > REFRESH_AFTER_MS && tokens.refreshToken) {
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
    if (res.ok) {
      const data = (await res.json()) as {
        id_token?: string;
        access_token?: string;
        refresh_token?: string;
      };
      tokens = {
        idToken: data.id_token ?? tokens.idToken,
        accessToken: data.access_token ?? tokens.accessToken,
        refreshToken: data.refresh_token ?? tokens.refreshToken,
        accountId: tokens.accountId,
        lastRefresh: new Date().toISOString(),
      };
      store.save(tokens);
    }
  }
  return tokens;
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

/** Adopt container-side credentials when fresher (the CLI rotates tokens). */
export function adoptIfNewer(authJson: string): void {
  try {
    const parsed = JSON.parse(authJson) as {
      tokens?: {
        id_token?: string;
        access_token?: string;
        refresh_token?: string;
        account_id?: string;
      };
      last_refresh?: string;
    };
    if (!parsed.tokens?.access_token || !parsed.tokens.refresh_token || !parsed.last_refresh) {
      return;
    }
    const current = store.load();
    if (current && Date.parse(current.lastRefresh) >= Date.parse(parsed.last_refresh)) return;
    store.save({
      idToken: parsed.tokens.id_token ?? current?.idToken ?? '',
      accessToken: parsed.tokens.access_token,
      refreshToken: parsed.tokens.refresh_token,
      accountId: parsed.tokens.account_id ?? current?.accountId ?? '',
      lastRefresh: parsed.last_refresh,
    });
  } catch {
    // unparseable — ignore
  }
}
