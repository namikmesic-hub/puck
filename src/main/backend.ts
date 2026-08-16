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

/** turnId → envId, for routing interrupts to the right runner. */
const activeTurns = new Map<string, string>();

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

  activeTurns.set(turnId, env.id);
  try {
    yield* runner.turn(
      env.id,
      {
        id: turnId,
        provider: agent.provider,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        thinking: agent.thinking,
        advanced: agent.advanced,
        resume: sessionMap.get(agent.id) ?? null,
        prompt,
      },
      (providerSessionId) => {
        sessionMap.set(agent.id, providerSessionId);
        saveSessionMap();
      },
    );
  } finally {
    activeTurns.delete(turnId);
  }
}

export function interrupt(turnId: string): void {
  const envId = activeTurns.get(turnId);
  if (envId) runner.interrupt(envId, turnId);
}

export function answerAsk(
  turnId: string,
  askId: string,
  answers: Record<string, string> | null,
): void {
  const envId = activeTurns.get(turnId);
  if (envId) runner.answerAsk(envId, turnId, askId, answers);
}
