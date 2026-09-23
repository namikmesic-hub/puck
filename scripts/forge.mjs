#!/usr/bin/env node
/**
 * Runs an Electron Forge build command and refuses to exit zero without a
 * fresh app artifact under out/.
 *
 * Forge itself has exited 0 with nothing packaged: on an unsupported Node
 * major it dies while "Finalizing package" and never reaches its own hooks.
 * So the check runs here, after the Forge process has ended, and the Node
 * major is verified up front against .nvmrc.
 *
 *   node scripts/forge.mjs package [forge args]
 *   node scripts/forge.mjs make [forge args]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findAppArtifacts, findMakeArtifacts, nodeMajorMismatch } from './build-checks.mjs';

const COMMANDS = ['package', 'make'];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...forgeArgs] = process.argv.slice(2);

function fail(message) {
  console.error(`\n[puck build] ${message}`);
  process.exit(1);
}

if (!COMMANDS.includes(command)) {
  fail(`usage: node scripts/forge.mjs <${COMMANDS.join('|')}> [forge args]`);
}

const mismatch = nodeMajorMismatch(readFileSync(join(root, '.nvmrc'), 'utf8'), process.version);
if (mismatch) fail(mismatch);

const { productName } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const outDir = join(root, 'out');
// Whole seconds: some filesystems store mtimes at one-second resolution.
const since = Math.floor(Date.now() / 1000) * 1000;

const forge = spawnSync(
  join(root, 'node_modules', '.bin', 'electron-forge'),
  [command, ...forgeArgs],
  { cwd: root, stdio: 'inherit' },
);
if (forge.error) fail(`could not start electron-forge: ${forge.error.message}`);
if (forge.status !== 0) process.exit(forge.status ?? 1);

const apps = findAppArtifacts(outDir, productName, since);
if (apps.length === 0) {
  fail(`electron-forge ${command} exited 0 but wrote no fresh ${productName} app bundle under ${outDir}`);
}
if (command === 'make' && findMakeArtifacts(outDir, since).length === 0) {
  fail(`electron-forge make exited 0 but wrote no fresh distributable under ${join(outDir, 'make')}`);
}
for (const app of apps) console.log(`[puck build] app artifact: ${app}`);
