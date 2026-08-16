/**
 * Backend routing (main process).
 *
 * Turns run through the ACTIVE AGENT (a named provider configuration) inside
 * the ACTIVE ENVIRONMENT's Docker container via the runner agent. This module
 * tracks per-session resume ids and in-flight turns for interruption.
 */

import { app } from 'electron';
import * as path from 'node:path';
import type { HarnessEvent } from '../harness/types';
import { readJson, writeJsonAtomic } from './jsonstore';
import type { HarnessStatus } from '../harness/bridge';
import * as agents from './agents';
import * as envs from './environments';
import * as runner from './runner';

export { providerInfos, requireProvider as provider } from './providers';

/**
 * agentId → provider-native session/thread id. Conversations are long-lived,
 * so this survives app restarts on disk.
 */
const resumePath = () => path.join(app.getPath('userData'), 'puck-resume.json');
const sessionMap = new Map<string, string>(
  Object.entries(readJson<Record<string, string>>(resumePath()) ?? {}),
);
function saveSessionMap(): void {
  void writeJsonAtomic(resumePath(), Object.fromEntries(sessionMap));
}

/** Resume ids are per agent AND environment — a rebuilt container has no
 *  transcripts, so its ids must die with it. */
const resumeKeyOf = (agentId: string, envId: string) => `${agentId}@${envId}`;

envs.onEnvReset((envId) => {
  let changed = false;
  for (const key of [...sessionMap.keys()]) {
    // Scoped keys for this env die with its container; legacy un-scoped keys
    // (pre-scoping) can't be attributed to an env, so they die too — safer
    // to lose a resume than to wedge a conversation on a stale id.
    if (key.endsWith(`@${envId}`) || !key.includes('@')) {
      sessionMap.delete(key);
      changed = true;
    }
  }
  if (changed) saveSessionMap();
});

/** Provider errors that mean "this resume id no longer resolves". Claude
 *  reports a dead resume as an opaque `error_during_execution` before any
 *  content, so that counts too (the guard requires a resumed, content-free
 *  attempt — a genuine mid-work failure never matches). */
const STALE_RESUME_RE =
  /no conversation found|no rollout found|resume failed|failed to resume|(session|thread|conversation).{0,40}not found|unknown (session|thread)|does not exist|error_during_execution/i;

/** turnId → routing info. `reqId` differs from `turnId` on a stale-resume
 *  retry so the two attempts can never cross-route runner messages. */
const activeTurns = new Map<string, { envId: string; reqId: string }>();

export async function status(): Promise<HarnessStatus> {
  const agent = agents.active();
  const env = envs.activeEnv();
  const environment = env
    ? { id: env.id, name: env.name, status: await envs.runtimeStatus(env.id) }
    : null;
  return {
    connected: environment?.status === 'running' && !!agent,
    agent: agent
      ? { id: agent.id, name: agent.name, provider: agent.provider, model: agent.model }
      : null,
    environment,
  };
}

export async function* runTurn(
  turnId: string,
  agentId: string,
  prompt: string,
): AsyncGenerator<HarnessEvent> {
  const agent = agents.list().find((a) => a.id === agentId);
  const env = envs.activeEnv();
  const fail = (message: string): HarnessEvent[] => [
    { kind: 'error', message },
    { kind: 'turn-end', stats: { inputTokens: 0, outputTokens: 0, durationMs: 0 } },
  ];

  if (!agent) {
    for (const e of fail('This agent no longer exists. Open Settings and create one.')) yield e;
    return;
  }
  if (!env) {
    for (const e of fail('No environment configured. Open Settings and create one.')) yield e;
    return;
  }
  if ((await envs.runtimeStatus(env.id)) !== 'running') {
    for (const e of fail(`Environment "${env.name}" is not running. Start it from Settings.`))
      yield e;
    return;
  }
  if (activeTurns.has(turnId)) {
    for (const e of fail(`Duplicate turn id ${turnId}.`)) yield e;
    return;
  }

  const key = resumeKeyOf(agent.id, env.id);
  // Legacy fallback: pre-env-scoping maps were keyed by agent id alone.
  const resume = sessionMap.get(key) ?? sessionMap.get(agent.id) ?? null;

  try {
    // Attempt 0 resumes; if the provider reports the id no longer resolves
    // (container rebuilt, transcripts gone) BEFORE producing any content,
    // drop the id and transparently retry once with a fresh session.
    const attempts = resume ? [resume, null] : [null];
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const reqId = i === 0 ? turnId : `${turnId}-r${i}`;
      activeTurns.set(turnId, { envId: env.id, reqId });
      let stale = false;
      let sawContent = false;
      const events = runner.turn(
        env.id,
        {
          id: reqId,
          provider: agent.provider,
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          thinking: agent.thinking,
          advanced: agent.advanced,
          resume: attempt,
          prompt,
        },
        (providerSessionId) => {
          // Never persist a rejected id, and never re-persist the id we
          // merely ATTEMPTED — the runner echoes it on done even when the
          // provider refused to resume it.
          if (stale || providerSessionId === attempt) return;
          sessionMap.set(key, providerSessionId);
          sessionMap.delete(agent.id); // retire the legacy key
          saveSessionMap();
        },
      );
      for await (const event of events) {
        if (event.kind === 'text-delta' || event.kind === 'tool-start') sawContent = true;
        if (
          attempt !== null &&
          !sawContent &&
          event.kind === 'error' &&
          STALE_RESUME_RE.test(event.message)
        ) {
          stale = true;
          sessionMap.delete(key);
          sessionMap.delete(agent.id);
          saveSessionMap();
          break; // abandon this attempt silently; retry fresh
        }
        yield event;
      }
      if (!stale) return;
    }
  } finally {
    activeTurns.delete(turnId);
  }
}

export function interrupt(turnId: string): void {
  const active = activeTurns.get(turnId);
  if (active) runner.interrupt(active.envId, active.reqId);
}

export function answerAsk(
  turnId: string,
  askId: string,
  answers: Record<string, string> | null,
): void {
  const active = activeTurns.get(turnId);
  if (active) runner.answerAsk(active.envId, active.reqId, askId, answers);
}
