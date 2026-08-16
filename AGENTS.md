# Working on Puck

Guidance for coding agents (and humans) contributing to this repo.

## Checks that must stay green

```bash
npm run typecheck && npm run lint && npm test
```

CI runs these plus `node --check src/main/runner/runner.js`.

## Things that bite

- **The container runner** (`src/main/runner/runner.js`) is plain CommonJS
  deployed INTO Docker containers — it cannot import host code, and changes
  only take effect after an environment restart/rebuild from Settings. Its
  `PROVIDERS` table must be kept in sync with `src/main/providers/` by hand.
- **Provider ids** (`claude-code`, `codex`) are persisted in user stores —
  never rename them.
- **Persisted stores** live in Electron `userData` (agents, environments,
  per-agent conversation logs, resume ids, encrypted OAuth blobs). Migrate,
  don't break: conversation logs are replayed through the live renderer on
  boot, so schema changes need a fallback path.
- **Driving the running app for verification**: launch with
  `npm start -- -- --remote-debugging-port=9222` and attach playwright-core
  over CDP. Never call `page.setViewportSize` on the live app — the emulation
  override outlives the script and breaks the real window's layout; use
  `Emulation.setDeviceMetricsOverride` inside try/finally with
  `clearDeviceMetricsOverride` instead.
- **colima** does not share `$HOME` with containers — credential files reach
  containers via `docker cp` only; host dirs are deliberately not mounted
  (sandbox escape via CLI hook files).

## Layout

- `src/index.ts` — main process: window hardening, IPC (validated in
  `src/main/ipcguard.ts`), conversation store
- `src/main/providers/` — the Provider interface + registry (see its README
  header comment for what a new provider needs)
- `src/main/environments.ts` — Docker lifecycle, bootstrap, credential and
  secret injection (all registry-driven; no provider names)
- `src/main/runner.ts` — docker-exec stdio bridge (handshake, watchdog,
  stderr diagnostics)
- `src/renderer.ts` — app shell, sessions, turns; pure helpers live in
  `src/renderer/` (markdown, dom, format) and are unit-tested
