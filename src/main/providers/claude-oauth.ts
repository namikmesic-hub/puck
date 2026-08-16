/**
 * Claude account OAuth.
 *
 * Drives the same Authorization Code + PKCE flow `claude /login` performs,
 * from inside Puck: open the authorize page in the app's sign-in window,
 * intercept the callback redirect, exchange the code for tokens, and keep
 * them encrypted at rest. Tokens authenticate Claude Code inside environment
 * containers (injected as ~/.claude/.credentials.json by environments.ts).
 */

import { closeAuthWindow, openAuthWindow } from '../authwindow';
import { pkce, randomState, tokenStore } from './oauth';

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'; // Claude Code's public OAuth client
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const SCOPE = 'org:create_api_key user:profile user:inference';

export interface ClaudeAuthStatus {
  connected: boolean;
  expiresAt: number | null;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms epoch
  scopes: string[];
}

const store = tokenStore<StoredTokens>('claude-oauth.bin');

let pending: { verifier: string; state: string } | null = null;
let onLoginCb: (() => void) | null = null;

export function setOnLogin(cb: () => void): void {
  onLoginCb = cb;
}

export function status(): ClaudeAuthStatus {
  const tokens = store.load();
  return { connected: !!tokens, expiresAt: tokens?.expiresAt ?? null };
}

export function logout(): void {
  store.clear();
}

/**
 * Opens the authorize page in a dedicated sign-in window and intercepts the
 * OAuth callback URL, so the login completes with no code pasting. Returns
 * the authorize URL.
 */
export function startLogin(): string {
  const { verifier, challenge } = pkce(32);
  const state = randomState();
  pending = { verifier, state };
  const params = new URLSearchParams({
    code: 'true',
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  const url = `${AUTHORIZE_URL}?${params.toString()}`;

  const win = openAuthWindow(url, 'Sign in to Claude');
  const intercept = (target: string) => {
    if (!target.startsWith(REDIRECT_URI)) return;
    try {
      const cb = new URL(target);
      const code = cb.searchParams.get('code');
      const cbState = cb.searchParams.get('state');
      if (code) {
        closeAuthWindow();
        void exchange(code, cbState ?? undefined)
          .then(() => onLoginCb?.())
          .catch((err) => console.error('Claude login failed:', err));
      }
    } catch {
      // not a parseable URL — ignore
    }
  };
  win.webContents.on('will-redirect', (_event, target) => intercept(target));
  win.webContents.on('will-navigate', (_event, target) => intercept(target));
  win.webContents.on('did-navigate', (_event, target) => intercept(target));
  return url;
}

async function exchange(code: string, state?: string): Promise<void> {
  if (!pending) throw new Error('No login in progress.');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: pending.verifier,
      state: state ?? pending.state,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    scope?: string;
  };
  store.save({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scopes: data.scope ? data.scope.split(' ') : ['user:inference', 'user:profile'],
  });
  pending = null;
}

/** Returns valid tokens, refreshing through the token endpoint when stale. */
export async function getFreshTokens(): Promise<StoredTokens | null> {
  let tokens = store.load();
  if (!tokens) return null;
  if (Date.now() > tokens.expiresAt - 5 * 60_000 && tokens.refreshToken) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: CLIENT_ID,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      tokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? tokens.refreshToken,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
        scopes: tokens.scopes,
      };
      store.save(tokens);
    }
  }
  return tokens;
}

/** The ~/.claude/.credentials.json body Claude Code reads on Linux. */
export function credentialsFileContent(tokens: StoredTokens): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      subscriptionType: 'max',
    },
  });
}

/**
 * Adopt credentials found in a container when they're fresher than ours —
 * Claude Code refreshes (and rotates) tokens itself mid-session.
 */
export function adoptIfNewer(credentialsJson: string): void {
  try {
    const parsed = JSON.parse(credentialsJson) as {
      claudeAiOauth?: {
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
        scopes?: string[];
      };
    };
    const oauth = parsed.claudeAiOauth;
    if (!oauth?.accessToken || !oauth.refreshToken || !oauth.expiresAt) return;
    const current = store.load();
    if (current && current.expiresAt >= oauth.expiresAt) return;
    store.save({
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken,
      expiresAt: oauth.expiresAt,
      scopes: oauth.scopes ?? current?.scopes ?? ['user:inference', 'user:profile'],
    });
  } catch {
    // unparseable — ignore
  }
}
