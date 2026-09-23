/**
 * Pure build-time checks behind scripts/forge.mjs, exercised by
 * test/unit/build-checks.test.ts. Plain ES module: it runs under the pinned
 * Node directly, with no compile step in front of it.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Compares the running Node major with the one pinned in .nvmrc.
 * Returns an error message, or null when the majors agree.
 *
 * @param {string} nvmrc   contents of .nvmrc (a Node version such as `22` or `v22.12.0`)
 * @param {string} running `process.version`
 * @returns {string | null}
 */
export function nodeMajorMismatch(nvmrc, running) {
  const pinned = nvmrc.trim().replace(/^v/, '').split('.')[0];
  if (!/^\d+$/.test(pinned)) {
    return `.nvmrc must pin a numeric Node version, found ${JSON.stringify(nvmrc.trim())}`;
  }
  const actual = running.replace(/^v/, '').split('.')[0];
  if (actual === pinned) return null;
  return `Puck builds on Node ${pinned} (see .nvmrc), but this is Node ${running}. Switch Node versions and retry.`;
}

// Electron Packager names its target directory `<name>-<platform>-<arch>`
// and writes the app inside it under a platform-specific name.
const APP_FILE = {
  darwin: (name) => `${name}.app`,
  mas: (name) => `${name}.app`,
  win32: (name) => `${name}.exe`,
  linux: (name) => name,
};

function entries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function mtimeMs(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -Infinity;
  }
}

/**
 * Finds the app bundles Electron Forge wrote under `outDir` no earlier than
 * `since` (ms since the epoch). The freshness bound rejects bundles left by
 * an earlier run, so a Forge process that dies silently cannot pass on
 * stale output.
 *
 * @param {string} outDir Forge output directory (`out/`)
 * @param {string} name   packaged app name (`productName`)
 * @param {number} since  earliest acceptable mtime, ms since the epoch
 * @returns {string[]}    paths of fresh app bundles, empty when there are none
 */
export function findAppArtifacts(outDir, name, since) {
  const found = [];
  for (const target of entries(outDir)) {
    if (!target.isDirectory() || !target.name.startsWith(`${name}-`)) continue;
    const [platform] = target.name.slice(name.length + 1).split('-');
    const appFile = APP_FILE[platform];
    if (!appFile) continue;
    const app = join(outDir, target.name, appFile(name));
    if (mtimeMs(app) >= since) found.push(app);
  }
  return found;
}

/**
 * Finds the distributables the makers wrote under `out/make` no earlier than
 * `since` (ms since the epoch).
 *
 * @param {string} outDir Forge output directory (`out/`)
 * @param {number} since  earliest acceptable mtime, ms since the epoch
 * @returns {string[]}    paths of fresh regular files, empty when there are none
 */
export function findMakeArtifacts(outDir, since) {
  const found = [];
  const walk = (dir) => {
    for (const entry of entries(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && mtimeMs(path) >= since) found.push(path);
    }
  };
  walk(join(outDir, 'make'));
  return found;
}
