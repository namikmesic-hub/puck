import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findAppArtifacts, findMakeArtifacts, nodeMajorMismatch } from '../../scripts/build-checks.mjs';

const root = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('nodeMajorMismatch', () => {
  it('accepts the pinned major regardless of minor and patch', () => {
    expect(nodeMajorMismatch('22\n', 'v22.23.2')).toBeNull();
    expect(nodeMajorMismatch('v22.12.0', 'v22.1.0')).toBeNull();
  });

  it('names both versions when the major differs', () => {
    const message = nodeMajorMismatch('22\n', 'v26.7.0');
    expect(message).toContain('Node 22');
    expect(message).toContain('v26.7.0');
  });

  it('rejects a .nvmrc that does not pin a numeric version', () => {
    expect(nodeMajorMismatch('lts/jod\n', 'v22.23.2')).toMatch(/numeric/);
  });
});

describe('artifact checks', () => {
  const dirs: string[] = [];
  const outDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'puck-out-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('finds nothing in a missing or empty out directory', () => {
    const out = outDir();
    expect(findAppArtifacts(join(out, 'absent'), 'Puck', 0)).toEqual([]);
    expect(findAppArtifacts(out, 'Puck', 0)).toEqual([]);
    expect(findMakeArtifacts(out, 0)).toEqual([]);
  });

  it('finds a fresh macOS app bundle and rejects a stale one', () => {
    const out = outDir();
    const app = join(out, 'Puck-darwin-arm64', 'Puck.app');
    mkdirSync(join(app, 'Contents'), { recursive: true });
    const written = statSync(app).mtimeMs;
    expect(findAppArtifacts(out, 'Puck', written)).toEqual([app]);
    expect(findAppArtifacts(out, 'Puck', written + 1)).toEqual([]);
  });

  it('ignores a target directory without the app inside it', () => {
    const out = outDir();
    mkdirSync(join(out, 'Puck-darwin-arm64'), { recursive: true });
    writeFileSync(join(out, 'Puck-darwin-arm64', 'LICENSE'), 'x');
    expect(findAppArtifacts(out, 'Puck', 0)).toEqual([]);
  });

  it('ignores directories that belong to another app name or platform', () => {
    const out = outDir();
    mkdirSync(join(out, 'Other-darwin-arm64', 'Other.app'), { recursive: true });
    mkdirSync(join(out, 'Puck-plan9-arm64', 'Puck.app'), { recursive: true });
    expect(findAppArtifacts(out, 'Puck', 0)).toEqual([]);
  });

  it('knows the Windows and Linux artifact names', () => {
    const out = outDir();
    mkdirSync(join(out, 'Puck-win32-x64'), { recursive: true });
    writeFileSync(join(out, 'Puck-win32-x64', 'Puck.exe'), 'x');
    mkdirSync(join(out, 'Puck-linux-x64'), { recursive: true });
    writeFileSync(join(out, 'Puck-linux-x64', 'Puck'), 'x');
    expect(findAppArtifacts(out, 'Puck', 0).sort()).toEqual([
      join(out, 'Puck-linux-x64', 'Puck'),
      join(out, 'Puck-win32-x64', 'Puck.exe'),
    ]);
  });

  it('finds fresh distributables under out/make and rejects stale ones', () => {
    const out = outDir();
    const zip = join(out, 'make', 'zip', 'darwin', 'arm64', 'Puck-darwin-arm64-0.0.1.zip');
    mkdirSync(join(zip, '..'), { recursive: true });
    writeFileSync(zip, 'x');
    const written = statSync(zip).mtimeMs;
    expect(findMakeArtifacts(out, written)).toEqual([zip]);
    expect(findMakeArtifacts(out, written + 1)).toEqual([]);
  });
});

describe('toolchain pin', () => {
  const pkg = JSON.parse(read('package.json')) as {
    engines: { node: string };
    scripts: Record<string, string>;
  };
  const major = (v: string) => v.trim().replace(/^[^\d]*/, '').split('.')[0];

  it('pins one Node major in .nvmrc and package.json engines', () => {
    expect(major(read('.nvmrc'))).toBe('22');
    expect(major(pkg.engines.node)).toBe('22');
  });

  it('installs from the lockfile on that Node in CI', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('node-version-file: .nvmrc');
    expect(ci).not.toMatch(/node-version:/);
    expect(ci).toMatch(/run: npm ci\b/);
    expect(ci).not.toMatch(/npm install\b/);
  });

  it('routes package and make through the artifact-checking wrapper', () => {
    expect(pkg.scripts.package).toBe('node scripts/forge.mjs package');
    expect(pkg.scripts.make).toBe('node scripts/forge.mjs make');
  });
});
