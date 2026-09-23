# Working on Puck

Guidance for coding agents (and humans) contributing to this repo.

## Checks that must stay green

```bash
npm run typecheck && npm run lint && npm test
```

Lint is at **zero problems** - keep it there.
CI runs these plus `node --check src/main/runner/runner.js` and `npm run package`.

## Things that bite

- **Builds run on Node 22 only**, the major pinned in `.nvmrc` and mirrored by `engines` in `package.json`.
  CI reads `.nvmrc`.
  `npm run package` and `npm run make` go through `scripts/forge.mjs`.
  The wrapper refuses other Node majors and fails when Forge exits 0 without a fresh app bundle under `out/`.
  Forge has done exactly that on a newer Node.
  CI installs with `npm ci`, so regenerate a drifted lockfile with the pinned Node's npm (`npm install --package-lock-only`).
  `test/unit/build-checks.test.ts` keeps the pin, the CI workflow, and the scripts in agreement.
- **The container runner** (`src/main/runner/runner.js`) is plain CommonJS deployed INTO Docker containers.
  It cannot import host code, and changes only take effect after an environment restart or rebuild from Settings.
  Its `PROVIDERS` table mirrors the host registry.
  `test/unit/runner-source.test.ts` enforces the sync from the live registry, so a new provider without a runner entry fails the suite.
  The wire contract (opcodes and protocol revision) is declared twice: `WIRE` in `src/main/runner.ts` and `OP`/`RV` at the top of runner.js.
  The same test asserts they match.
  Bump the revision whenever the turn-request wire format grows.
- **IPC channels** live in one table: `src/harness/channels.ts` (`CHANNELS`).
  `preload.ts` and `src/index.ts` both import it.
  The `satisfies` clause keeps it total over `PuckBridge`, and `test/unit/channels.test.ts` asserts main registers a handler for every entry.
  Adding a bridge method = bridge type + CHANNELS entry + preload line + handler.
- **Provider ids** (`claude-code`, `codex`) are persisted in user stores - never rename them.
- **Persisted stores** live in Electron `userData`.
  Migrate, don't break: new fields get `??` defaults at load, and legacy keys are dual-read, never rewritten in place.
  Layout: `puck-agents.json`, `puck-environments.json`, `puck-resume.json`, `puck-convos/<agentId>.json` (one file per agent), and encrypted `*.bin` secrets.
  Resume ids are keyed `agentId@envId`, scoped to the environment because a rebuilt container loses its transcripts.
  A legacy single-blob `puck-convos.json` is still read.
  Conversation files carry a format version `v`.
  See `ConversationData` in `src/harness/bridge.ts` for the persisted event dialect and its append-only rule.
- **Per-agent provider options** are schema-driven.
  Adding one is a single `ProviderOption` descriptor in the provider module (`configOptions`).
  The editor UI, validation, persistence, and wire transport all follow the schema (`src/harness/options.ts`).
  Only options needing cross-key coupling get a line in the provider's `compileSettings`.
  A test asserts every overridden option reaches the compiled output.
  Values are sparse (only user overrides are stored and compiled), and the runner base encodes the defaults.
- **Driving the running app for verification**: launch with `npm start -- -- --remote-debugging-port=9222` and attach playwright-core over CDP.
  Never call `page.setViewportSize` on the live app.
  The emulation override outlives the script and breaks the real window's layout.
  Use `Emulation.setDeviceMetricsOverride` inside try/finally with `clearDeviceMetricsOverride` instead.
- **Provider logins** run in the system browser (RFC 8252).
  The authorize URL goes through `shell.openExternal`.
  The redirect lands on the shared loopback listener `src/main/providers/loopback.ts` (127.0.0.1 only, one request, state check, timeout).
  Claude binds an ephemeral port (`http://localhost:<port>/callback`, the shape Claude Code registers).
  Codex uses its registered fixed port 1455.
  There is no embedded sign-in window or cookie partition - logout only clears Puck's own token store.
- **colima** does not share `$HOME` with containers, so credential files reach containers via `docker cp` only.
  Host dirs are deliberately not mounted (sandbox escape via CLI hook files).

## Adding a provider - checklist

1. Descriptor module `src/main/providers/<id>.ts`: models, thinking levels, `configOptions` schema, `compileSettings`, capabilities, auth, and container integration (CLI/SDK packages, credential paths, forwarded env).
2. OAuth module (transport and token mapping).
   Shared PKCE and token-store helpers live in `oauth.ts`.
3. Registry entry in `src/main/providers/index.ts`.
4. Runner side: `PROVIDERS` entry and `run<Name>` function in `src/main/runner/runner.js`.
   It is untyped JS, so keep it thin and translate SDK events into `HarnessEvent`s.
5. Run the suite.
   `runner-source.test.ts` and `provider-settings.test.ts` are registry-derived and will point at anything missed.

## Terminology

- *Agent* = a named provider configuration (`AgentConfig`).
  The Task-tool sub-agents inside a chat are "sub-agents", and the container-side process is "the runner".
- `AgentConfig.options` = sparse schema-option overrides.
  `TurnRequest.settings` = the *compiled* SDK fragment, whose wire field names are frozen until the next protocol-revision bump.
  The app's Settings modal is UI-level and unrelated.
  On disk, pre-rename records carry `settings`/`thinking` keys, dual-read at load and written back with the new names.
- `AgentConfig.effort` compiles to Claude's `effort` / Codex's `model_reasoning_effort`.
  The `thinking` *event kind* is the UI indicator.

## Layout

- `src/index.ts` - main process: window hardening and IPC handler registration.
  Ids, strings, and configs are validated in `src/main/ipcguard.ts`.
  The conversation payload codec lives with its format in `src/main/conversations.ts`: strict `fromIpc` on save, lenient `normalize` on load, one shared field assembly.
- `src/harness/` - the renderer↔main contract.
  Keep this directory free of node/electron imports.
  `bridge.ts` holds the types and `PuckBridge`, `channels.ts` the IPC channel table, `types.ts` the `HarnessEvent` wire protocol.
  `options.ts` holds the provider option schema and `ipc.ts` the `IpcHarness`.
- `src/main/providers/` - the Provider interface and registry.
  See its README header comment for what a new provider needs.
- `src/main/backend.ts` - turn orchestration: active agent × environment, resume-id map, stale-resume retry state machine.
- `src/main/environments.ts` - Docker lifecycle, bootstrap, credential and secret injection (all registry-driven, no provider names).
- `src/main/runner.ts` - docker-exec stdio bridge (handshake, watchdog, stderr diagnostics, `WIRE` contract).
- `src/renderer.ts` - the wiring layer: DOM lookups, nav applier and settings modal, composer/turn loop, settings card grids, shortcuts, boot.
  `nav()` is the single entry point for navigation.
  Element ids follow prefixes: `a-*` agent editor, `d-*` environment editor, `sec-*` settings sections, `aed-*` agent-editor cards, `sm-*` settings modal.
- `src/styles/` - one stylesheet per surface (`shell`, `settings`, `editors`, `chat`, `overlays`).
  The import order in `renderer.ts` preserves the cascade.
- `src/renderer/` - extracted, unit-tested modules.
  The house style (proven by `options.ts`): context/elements in, controller out, no `getElementById` inside, jsdom tests.
  - `session-store.ts` - the Session model: conversations, sub-agent children, spawn/teardown, rename sync, debounced persistence.
  - `chat-view.ts` - message rows, Slack grouping, streaming turns (markdown committer, tool cards, sub-agents behind a `spawnChild` seam), replay (`REPLAY_WINDOW`), full-turn overlay.
  - `ask-card.ts` - the mid-turn question card (live and replay variants, submit hook rejects to re-arm).
  - `roster.ts` - the sidebar list: agent rows, unread/running dots, nested sub-agent chats, rAF-coalesced `render()`.
  - `palette.ts` - the Cmd+K palette: agent switcher and history search.
  - `settings/agent-editor.ts` - segmented pickers, dirty tracking, section rail and scroll-spy, epoch-guarded async population, save.
  - `settings/env-editor.ts` - the environment detail page: config form, env-var/secret kv lists, header with the shared op rail, save.
  - `settings/cards.ts` and `settings/env-rail.ts` - card-grid kit and the ONE environment op ladder (list cards and detail header share it).
  - `nav.ts` - pure nav state machine (`navTransition`, `escapeTarget`).
  - `options.ts`, `util.ts`, `dom.ts`, `format.ts`, `markdown.ts`.

## Roadmap (deliberately deferred)

- Runner as a typed per-provider adapter bundle (retires the hand-synced `PROVIDERS` table structurally).
- Wire envelope `{op, req}` at the next protocol-revision bump.
- Ask-answer encoding (keyed by question text, lossy) redesign.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows.
Point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
