# Puck

A macOS desktop client for coding agents.
Puck gives Claude Code and Codex Slack-style, long-lived conversations, with each agent a contact in the sidebar.
Every turn executes inside a Docker container you configure.

## How it works

- **Agents** are named provider configurations: provider, model, system instructions, thinking level, a schema-driven options form, and an advanced JSON passthrough.
  The options form covers permission and sandbox modes, per-tool toggles, and limits, declared per provider and rendered generically.
  Each agent has one permanent conversation, persisted as a structured event log and replayed on launch.
  Clickable turn cards, tool calls, and sub-agent chats survive restarts.
- **Environments** are persistent Docker containers with a host directory mounted at `/workspace`.
  Puck installs the provider CLIs and SDKs into the container, deploys a small runner agent, and speaks NDJSON to it over `docker exec` stdio.
  The container is the safety boundary: agents run with full tool access inside it, and nothing from the host is writable.
- **Providers** implement one interface (`src/main/providers/`): descriptor metadata, OAuth, and container integration (packages, credential mirroring, environment).
  Sign-in happens in the system browser with a loopback callback, RFC 8252 style, and tokens are encrypted via the OS keychain.
  Adding a provider is one descriptor module, one registry entry, and one entry in the container runner's `PROVIDERS` table.

Turns stream live.
Text renders as markdown, tool calls collapse into a per-turn card that opens full-screen, and sub-agents get their own nested chats.
Claude's mid-turn questions render as answerable cards.

## Prerequisites

- macOS with [Docker](https://docs.docker.com/) running (Docker Desktop or colima: bind-mount quirks are handled either way)
- Node 22, the major pinned in `.nvmrc` (builds refuse any other)

## Run

```bash
npm install
npm start
```

Then, in the app:

1. **Settings → Providers** - connect Claude and/or ChatGPT.
   The sign-in opens in your default browser, where your existing sessions live, and completes when the browser redirects back to Puck.
2. **Settings → Environments** - create an environment (base image or Dockerfile) and start it.
   First start installs the CLIs and SDKs.
3. Pick an agent in the sidebar and say hello.

## Develop

```bash
npm run typecheck   # strict tsc
npm run lint
npm test            # vitest unit suites
npm run test:e2e    # boots the real app and smoke-checks the UI
```

The container runner lives in `src/main/runner/runner.js`.
It is plain CommonJS, bundled as a raw string and docker-cp'd into environments on start.
Runner changes take effect on the next environment restart.

## License

MIT - see [LICENSE](LICENSE).
