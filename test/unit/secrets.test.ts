import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { app, safeStorage } from '../mocks/electron';
import {
  deleteSecret,
  loadSecret,
  saveSecret,
  SecureStorageUnavailableError,
} from '../../src/main/secrets';

// The secret store has exactly one backend, the OS keychain via safeStorage.
// These tests pin the refusal: no plaintext write when the keychain is
// unavailable, and no plaintext read back either.

const NAME = 'secrets-test.bin';
const file = path.join(app.getPath('userData'), NAME);

afterEach(() => {
  safeStorage.available = true;
  deleteSecret(NAME);
});

describe('secrets', () => {
  it('stores encrypted bytes, owner-only, and decrypts them back', () => {
    saveSecret(NAME, '{"token":"s3cret-value"}');
    const raw = fs.readFileSync(file);
    expect(raw.toString('utf8')).not.toContain('s3cret-value');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(loadSecret(NAME)).toBe('{"token":"s3cret-value"}');
  });

  it('refuses to save when the OS secure store is unavailable, naming the cause', () => {
    safeStorage.available = false;
    expect(() => saveSecret(NAME, '{"token":"x"}')).toThrow(SecureStorageUnavailableError);
    expect(() => saveSecret(NAME, '{"token":"x"}')).toThrow(/secure store is unavailable/i);
    expect(() => saveSecret(NAME, '{"token":"x"}')).toThrow(/safeStorage/);
    expect(() => saveSecret(NAME, '{"token":"x"}')).toThrow(/never stores secrets in plaintext/);
    expect(fs.existsSync(file)).toBe(false); // nothing written, in any form
  });

  it('reads an existing secret as absent while the store is unavailable', () => {
    saveSecret(NAME, '{"token":"x"}');
    safeStorage.available = false;
    expect(loadSecret(NAME)).toBeNull();
  });

  it('never reads a plaintext file (the removed fallback) back as a secret', () => {
    fs.writeFileSync(file, '{"token":"legacy-plaintext"}');
    expect(loadSecret(NAME)).toBeNull();
  });

  it('returns null for a missing secret and deletes idempotently', () => {
    expect(loadSecret(NAME)).toBeNull();
    deleteSecret(NAME);
    deleteSecret(NAME);
    expect(loadSecret(NAME)).toBeNull();
  });
});
