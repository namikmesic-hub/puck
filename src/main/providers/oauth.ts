/**
 * Shared OAuth plumbing for provider auth modules. Deliberately small —
 * the transports (window redirect intercept vs loopback server), token
 * shapes, and refresh policies diverge per provider and stay in the
 * per-provider modules.
 */

import * as crypto from 'node:crypto';
import { deleteSecret, loadSecret, saveSecret } from '../secrets';

/** PKCE verifier + S256 challenge. Verifier size differs per provider. */
export function pkce(verifierBytes: number): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(verifierBytes).toString('base64url');
  return {
    verifier,
    challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
  };
}

export function randomState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** JSON tokens on the encrypted secret store (safeStorage / OS keychain). */
export function tokenStore<T>(storeName: string): {
  load(): T | null;
  save(tokens: T): void;
  clear(): void;
} {
  return {
    load(): T | null {
      const json = loadSecret(storeName);
      if (!json) return null;
      try {
        return JSON.parse(json) as T;
      } catch {
        return null;
      }
    },
    save(tokens: T): void {
      saveSecret(storeName, JSON.stringify(tokens));
    },
    clear(): void {
      deleteSecret(storeName);
    },
  };
}
