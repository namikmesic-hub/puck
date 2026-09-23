/**
 * Loopback redirect listener for native-app OAuth (RFC 8252 §7.3).
 *
 * The authorization URL opens in the system browser (where the user's
 * sessions, password manager and SSO live); the authorization server then
 * redirects the browser to http://localhost:<port>/<path> on this listener.
 * One listener serves exactly one login attempt:
 *
 *  - binds 127.0.0.1 only (never a routable interface)
 *  - answers one callback: the first request on `path` settles the attempt
 *    (state is verified before the code is handed out), then the listener
 *    closes so nothing can replay into it
 *  - closes on success, on failure and after `timeoutMs`
 *  - renders a small page telling the user to return to the app
 *  - never logs or echoes the authorization code
 *
 * Token exchange is the caller's job - this module only produces the code.
 */

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

/** How long a login may stay pending before the listener gives up. */
export const LOGIN_TIMEOUT_MS = 10 * 60_000;

/** The attempt was aborted on purpose (Cancel, logout, quit) - not a failure. */
export class LoginCancelledError extends Error {
  constructor() {
    super('Sign-in cancelled.');
    this.name = 'LoginCancelledError';
  }
}

export interface LoopbackOptions {
  /** Callback path the authorization server redirects to, e.g. '/callback'. */
  path: string;
  /** Expected `state` - a callback with any other value is refused. */
  state: string;
  /** Fixed port for clients with a registered port; 0 picks a free one. */
  port?: number;
  /** Abandon the attempt after this long (default LOGIN_TIMEOUT_MS). */
  timeoutMs?: number;
  /** App name shown on the result page. */
  appName?: string;
}

export interface LoopbackListener {
  /** The bound port (the actual one when `port` was 0). */
  port: number;
  /**
   * The authorization code, once the browser lands on the callback. Rejects
   * on state mismatch, on a provider error, on cancel and on timeout. The
   * listener is closed by the time this settles either way.
   */
  code: Promise<string>;
  /** Abort the attempt (user cancel, logout, app quit); `code` rejects with
   *  LoginCancelledError. Idempotent. */
  cancel(): void;
}

/**
 * Binds the listener and resolves once it is accepting connections, so the
 * caller can put the real port into the authorization URL before opening it.
 */
export function startLoopback(opts: LoopbackOptions): Promise<LoopbackListener> {
  const timeoutMs = opts.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const appName = opts.appName ?? 'Puck';

  let settle: { resolve(code: string): void; reject(err: Error): void } | null = null;
  const code = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });
  code.catch(() => undefined); // callers attach their own handler; never an unhandled rejection

  const server = http.createServer();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const finish = (outcome: { code: string } | { error: Error }): void => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    server.close();
    server.closeAllConnections();
    if ('code' in outcome) settle?.resolve(outcome.code);
    else settle?.reject(outcome.error);
  };

  server.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== opts.path) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    if (closed) {
      res.writeHead(409, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page(appName, false, 'This sign-in was already completed.', `Return to ${appName}.`));
      return;
    }
    const providerError = url.searchParams.get('error');
    const state = url.searchParams.get('state');
    const authCode = url.searchParams.get('code');

    let outcome: { code: string } | { error: Error };
    let status: number;
    let heading: string;
    let detail: string;
    if (providerError) {
      const description = url.searchParams.get('error_description');
      outcome = { error: new Error(`${providerError}${description ? `: ${description}` : ''}`) };
      status = 400;
      heading = 'Sign-in failed';
      detail = `${providerError}. Close this tab and try again from ${appName}.`;
    } else if (state !== opts.state) {
      outcome = { error: new Error('State mismatch - restart the sign-in from the app.') };
      status = 400;
      heading = 'Sign-in failed';
      detail = `This callback does not belong to the pending sign-in. Close this tab and try again from ${appName}.`;
    } else if (!authCode) {
      outcome = { error: new Error('The callback carried no authorization code.') };
      status = 400;
      heading = 'Sign-in failed';
      detail = `No authorization code was received. Close this tab and try again from ${appName}.`;
    } else {
      outcome = { code: authCode };
      status = 200;
      heading = `Connected to ${appName}`;
      detail = `You can close this tab and return to ${appName}.`;
    }
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    // Settle only once the response is flushed - closing connections first
    // would cut the page off in the browser.
    res.end(page(appName, status === 200, heading, detail), () => finish(outcome));
  });

  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      closed = true;
      settle?.reject(err);
      reject(err);
    });
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      timer = setTimeout(
        () => finish({ error: new Error('Sign-in timed out - restart it from the app.') }),
        timeoutMs,
      );
      resolve({
        port,
        code,
        cancel: () => finish({ error: new LoginCancelledError() }),
      });
    });
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Minimal, self-contained result page (no external resources). */
function page(appName: string, ok: boolean, heading: string, detail: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(appName)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FFFDF7;color:#1d2a26;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  main{max-width:420px;padding:32px;text-align:center}
  .mark{width:44px;height:44px;border-radius:50%;margin:0 auto 18px;display:grid;place-items:center;color:#fff;font-size:22px;background:${ok ? '#2E5E4E' : '#B3442E'}}
  h1{font-size:19px;margin:0 0 8px}p{margin:0;color:#52625d}
</style></head>
<body><main><div class="mark">${ok ? '&#10003;' : '&#10005;'}</div>
<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(detail)}</p></main></body></html>`;
}
