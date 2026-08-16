/**
 * Wire-level protocol between the UI and a harness backend.
 *
 * The renderer only ever consumes `AsyncIterable<HarnessEvent>`, so backends
 * are interchangeable: `MockHarness` (scripted, local) and `IpcHarness`
 * (LiteLLM via the main process) both implement `Harness`.
 */

export interface TurnStats {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** Reported by backends that meter spend (e.g. Claude Code). */
  costUsd?: number;
}

export interface AskOption {
  label: string;
  description: string;
}

/** One question the agent poses mid-turn (Claude Code's AskUserQuestion tool). */
export interface AskQuestion {
  question: string;
  header: string;
  options: AskOption[];
  multiSelect: boolean;
}

type HarnessEventBody =
  | { kind: 'turn-start'; turnId: string }
  | { kind: 'thinking'; active: boolean }
  | { kind: 'text-delta'; text: string; parentId?: string }
  | {
      kind: 'tool-start';
      toolId: string;
      tool: string;
      summary: string;
      input: string;
      /** Set when this call runs inside a sub-agent: the sub-agent's toolId. */
      parentId?: string;
      /** True when this call IS a sub-agent (rendered as an agent card). */
      agent?: boolean;
    }
  | { kind: 'tool-end'; toolId: string; ok: boolean; output: string }
  | { kind: 'ask'; askId: string; questions: AskQuestion[] }
  | { kind: 'error'; message: string }
  | { kind: 'turn-end'; stats: TurnStats };

/** Wall-clock stamp is added renderer-side when an event is recorded, so
 *  replayed history keeps original tool-call times and durations. */
export type HarnessEvent = HarnessEventBody & { ts?: number };

export interface Harness {
  /** Model / backend identity shown in the top bar. */
  readonly label: string;
  /**
   * Send one user prompt within a session. Returns the turn's id (for
   * interrupt / answerAsk routing) plus its event stream. Turns from
   * different sessions may run concurrently; backends keep per-session
   * conversation history.
   */
  send(sessionId: string, prompt: string): { turnId: string; events: AsyncGenerator<HarnessEvent> };
}
