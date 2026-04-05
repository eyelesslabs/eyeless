# Eyeless

Structured visual feedback for AI coding agents. Node.js core (BackstopJS + Playwright + MCP server).

## Quick Reference

```bash
npm install && npm run build   # Build
cd core && npm test            # Run tests (79 tests)
cd core && npm run dev         # Watch mode

# CLI
./bin/eyeless --help           # Show CLI usage
./bin/eyeless serve            # Start MCP server
```

## Architecture

```
eyeless/
├── bin/eyeless              # CLI wrapper (shebang → core/dist/cli.js)
├── core/                    # Node.js — the engine
│   └── src/
│       ├── http-server.ts       # Localhost HTTP API (port 0, 127.0.0.1 only)
│       ├── engine.ts            # Orchestrates capture/check via BackstopJS
│       ├── validation.ts        # Shared path validation (used by HTTP + MCP)
│       ├── config/index.ts      # .eyeless/config.json read/write
│       ├── attributor/          # Style snapshot capture + comparison
│       │   ├── compare.ts       # compareSnapshots() — the core algorithm
│       │   ├── styles.ts        # Tracked CSS + SVG properties
│       │   └── on-ready-script.ts  # Playwright page script (shadow DOM, pseudo-elements, SVG, confidence scoring)
│       ├── backstop/index.ts    # BackstopJS wrapper (interactions, animation disabling)
│       ├── mcp/server.ts        # MCP tools (capture, check, baselines, inspect)
│       ├── output/index.ts      # Result formatters
│       ├── cli.ts               # CLI (serve, init, capture, check, dashboard)
│       ├── types.ts             # TypeScript interfaces
│       └── index.ts             # Package entry
├── CLAUDE.md                # This file
└── .github/workflows/test.yml  # CI: Node tests on push/PR
```

## How It Works

1. HTTP server starts on a random localhost port, prints `PORT:{n}` to stdout
2. Consumers connect to `http://127.0.0.1:{port}`
3. MCP server (separate process via stdio) exposes 4 tools for AI agents

## Data Flow

```
AI Agent → MCP (stdio) → engine.ts → BackstopJS + Playwright → .eyeless/
HTTP API → engine.ts → BackstopJS + Playwright → .eyeless/
```

Each project stores its data in `{project}/.eyeless/`:
- `config.json` — project settings
- `baselines/bitmaps_reference/` — reference screenshots (BackstopJS)
- `snapshots/reference/` — style snapshots (JSON)
- `snapshots/test/` — current state snapshots
- `bitmaps_test/` — test screenshots
- `history.json` — check result log (max 100 entries)

## MCP Tools

| Tool | Description |
|------|-------------|
| `eyeless_capture` | Capture a visual baseline — supports interactions, JS execution, and wait strategies for multi-state capture |
| `eyeless_check` | Check current state against baseline, returns structured drifts |
| `eyeless_baselines` | List all baselines for a project |
| `eyeless_inspect` | Inspect a baseline's captured elements and computed styles |

### Multi-State Capture

Real apps have modals, drawers, tabs, and JS-driven states. Use `interactions` and `waitFor` on `eyeless_capture`/`eyeless_check` to reach and verify specific states before capturing.

**Interactions** (executed in order before capture):
- `click` — Click an element: `{ type: "click", selector: "#open-modal" }`
- `hover` — Hover an element: `{ type: "hover", selector: ".tooltip-trigger" }`
- `type` — Type into an input: `{ type: "type", selector: "#search", value: "query" }`
- `scroll` — Scroll to an element: `{ type: "scroll", selector: "#footer" }`
- `evaluate` — Run arbitrary JS: `{ type: "evaluate", expression: "openModal()" }`

**Wait strategies** (executed after interactions, before snapshot):
- `selector` — Wait for element to appear: `{ type: "selector", selector: ".modal.visible" }`
- `timeout` — Fixed delay: `{ type: "timeout", timeout: 1000 }`
- `animations` — Wait for CSS animations to finish: `{ type: "animations" }`
- `cssClass` — Wait for class on element: `{ type: "cssClass", selector: "#app", className: "loaded" }`

Use different `label` values to capture multiple states of the same URL (e.g. "homepage", "modal-open", "settings-panel").

## HTTP API Endpoints

All bound to `127.0.0.1` only. All project paths validated (absolute, existing directory, realpathSync).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/config?project={path}` | Load project config |
| POST | `/config` | Save config (validated schema) |
| GET | `/baselines?project={path}` | List baselines |
| POST | `/capture` | Capture baseline via BackstopJS |
| POST | `/check` | Run check against baseline |
| POST | `/approve` | Approve current as new baseline |
| GET | `/screenshot/{path}?project={path}` | Serve screenshot images |
| GET | `/history?project={path}` | Check result history |

## Testing

**Node.js (79 tests):** `node:test` + `node:assert` — zero added dependencies.
- `compare.test.ts` — snapshot comparison algorithm
- `config/index.test.ts` — config loading, saving, path utilities
- `engine.test.ts` — screenshot file finder
- `http-server.test.ts` — route tests + 11 security tests
- `integration.test.ts` — end-to-end engine tests with real HTML + Playwright (multi-state capture, interactions, wait strategies)

**CI:** GitHub Actions runs Node tests on push/PR to main.

## Security Model

The HTTP server is localhost-only (`127.0.0.1`). Key measures:

- **Project path validation** — shared `validation.ts` used by both HTTP and MCP servers. Every project path must be absolute, exist on disk, and resolve via `realpathSync`
- **Path traversal guard** — `startsWith(base + path.sep)` prevents sibling-directory escapes
- **Body size limit** — 1MB max on POST bodies
- **Config schema validation** — type-checked before writing, scenario interactions/waitFor validated with type enums and array caps
- **HTTP interaction restrictions** — `evaluate` interactions rejected on HTTP endpoints (MCP-only), interaction types validated against allowlist
- **MCP error sanitization** — error messages stripped of file system paths before returning to clients
- **Snapshot caps** — element count capped at 10,000, malformed snapshot files skipped gracefully
- **Chromium sandbox** — Playwright runs with sandbox enabled (no `--no-sandbox`)
- **No CORS headers** — only local clients talk to the HTTP server
- **Error sanitization** — 500 responses never leak internal paths

## Conventions

- **Node.js:** TypeScript (strict), CommonJS. Zero added runtime deps beyond BackstopJS, Playwright, MCP SDK. Tests use `node:test`.
- **Git:** No AI attribution in commits or PRs. No Co-Authored-By lines, no "generated by AI" comments.

## Working Standards

These apply to all agents and contributors working on this project.

- **TDD** — Write tests before implementing. If it's worth fixing, it's worth testing. Watch the test fail first, then implement.
- **Research before building** — Check existing patterns before writing code. Don't reinvent what already exists.
- **Verify before presenting** — Build, test, and dry-run before declaring something done. Don't present untested work.
- **Fix what you find** — If you encounter a pre-existing bug or issue while working, fix it. Leave the codebase better than you found it.
- **No system installs without asking** — Never run `brew install`, `npm install -g`, or modify system-level config without explicit approval.
- **Surface errors to users** — Don't swallow errors with empty catch blocks in user-facing code. Show the user what went wrong.

## Common Tasks

**Add a new HTTP endpoint:**
1. Add route in `core/src/http-server.ts` (use `validateProjectPath` from `validation.ts`)
2. Add tests in `core/src/http-server.test.ts`

**Add a new MCP tool:**
1. Add tool in `core/src/mcp/server.ts` (use `resolveProjectPath` from `validation.ts`)
2. Add formatter in `core/src/output/index.ts`

**Modify config shape:**
1. Update `EyelessConfig` in `core/src/types.ts`
2. Update `validateConfig()` in `core/src/http-server.ts`
3. Update config tests
