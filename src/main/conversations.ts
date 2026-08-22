/**
 * Conversation store (main process).
 *
 * Long-lived per-agent transcripts: one JSON file per agent under
 * userData/puck-convos/, written atomically so a crash can never truncate
 * more than one agent's history — and never leave a partially-written file.
 * Payloads are validated at the IPC boundary (ipcguard.convoDataFrom); this
 * module owns the on-disk format, so legacy shapes are normalized on load.
 */

import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ConversationData } from '../harness/bridge';
import { isPlainObject } from '../harness/options';
import { readJson, writeTextAtomic } from './jsonstore';

const dir = (): string => path.join(app.getPath('userData'), 'puck-convos');
const legacyPath = (): string => path.join(app.getPath('userData'), 'puck-convos.json');

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * Lenient read-side normalization: older HTML-snapshot saves have no `log`
 * and start fresh (memory is preserved separately via provider resume ids);
 * `usage` was renamed `lastTurnTokens`. Entries are not re-validated — the
 * renderer's replay skips unknown kinds.
 */
function normalize(raw: unknown): ConversationData | null {
  if (!isPlainObject(raw) || !Array.isArray(raw.log)) return null;
  return {
    v: typeof raw.v === 'number' ? raw.v : 1,
    log: raw.log as ConversationData['log'],
    lastTurnTokens: num(raw.lastTurnTokens ?? raw.usage),
    lastActiveAt: num(raw.lastActiveAt),
    turns: num(raw.turns),
    ...(typeof raw.draft === 'string' ? { draft: raw.draft } : {}),
  };
}

/** Every agent's transcript, keyed by agent id. */
export function loadAll(): Record<string, ConversationData> {
  const raw: Record<string, unknown> = {};
  // One-time migration from the old single-blob store.
  const legacy = readJson<Record<string, unknown>>(legacyPath());
  if (legacy) Object.assign(raw, legacy);
  try {
    for (const file of fs.readdirSync(dir())) {
      if (!file.endsWith('.json')) continue;
      const data = readJson<unknown>(path.join(dir(), file));
      if (data) raw[file.slice(0, -5)] = data;
    }
  } catch {
    // directory doesn't exist yet
  }
  const all: Record<string, ConversationData> = {};
  for (const [agentId, data] of Object.entries(raw)) {
    const convo = normalize(data);
    if (convo) all[agentId] = convo;
  }
  return all;
}

/** Cap on one serialized conversation file — beyond this, refuse the save. */
const CONVO_MAX_BYTES = 8_000_000;

export function save(agentId: string, data: ConversationData): Promise<void> {
  const json = JSON.stringify(data);
  if (json.length > CONVO_MAX_BYTES) {
    return Promise.reject(new Error('Conversation too large to save.'));
  }
  return writeTextAtomic(path.join(dir(), `${agentId}.json`), json);
}
