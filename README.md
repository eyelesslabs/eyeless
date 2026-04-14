# Eyeless

Visual feedback for AI coding agents — structured text, zero pixels.

Your AI agent changes CSS and needs to know what broke. Eyeless captures computed styles from every DOM element, compares them against a baseline, and returns exactly what drifted: `".node-ring stroke-width: 4px, expected 2.5px"`. The agent fixes it in one round instead of five.

## Install

```bash
npm install -g eyeless
```

Requires Node.js 18+ and Playwright (`npx playwright install chromium`).

## Quick Start

### MCP Server (Claude Code, Cursor, Zed)

Add to your MCP config:

```json
{
  "mcpServers": {
    "eyeless": {
      "command": "npx",
      "args": ["-y", "eyeless", "serve"]
    }
  }
}
```

Your agent now has tools for capturing baselines, checking for regressions, viewing history, and more. Run `eyeless_status` at the start of any task to see what visual baselines exist.

### CLI

```bash
eyeless init --url http://localhost:3000
eyeless capture --label homepage
eyeless check --label homepage
```

## CI / GitHub Actions

Use `eyeless check --ci` in any CI pipeline to fail a pull request on visual drift. The flag switches output to structured JSON (written to stdout) and sets the exit code: `0` for pass, `1` for drift, `2` for error.

A complete, copy-paste workflow is in [`.github/examples/eyeless-check.yml`](.github/examples/eyeless-check.yml). To use it, copy the file to `.github/workflows/` in your repo.

Minimal example:

```yaml
name: Eyeless visual check

on:
  pull_request:
  workflow_dispatch:

jobs:
  visual-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm
      - run: npm ci
      - run: npm install -g eyeless
      - run: npx playwright install chromium --with-deps
      - run: npm run dev &
      - run: npx wait-on http://localhost:3000 --timeout 30000
      - run: eyeless check --ci --label homepage
```

Pass `--threshold <n>` to allow up to `n`% difference before failing. Pass `--label` to target a specific scenario.

## MCP Tools

| Tool | What it does |
|------|-------------|
| `eyeless_status` | Get visual coverage state — baselines, last check results, stale/unchecked scenarios |
| `eyeless_capture` | Capture a visual baseline — screenshots + computed styles for every element |
| `eyeless_check` | Compare current state against baseline, returns structured drifts |
| `eyeless_baselines` | List all baselines for a project |
| `eyeless_inspect` | Inspect a baseline's captured elements and tracked properties |
| `eyeless_history` | View check history — summary list or full detail for a specific entry |
| `eyeless_versions` | List or restore previous baseline versions |
| `eyeless_export` | Export a check result as a self-contained HTML report |

## Multi-State Capture

Real apps have modals, drawers, tabs, and JS-driven states. Eyeless captures them all.

**Interactions** — executed in order before capture:

```json
{ "type": "click", "selector": "#open-modal" }
{ "type": "hover", "selector": ".tooltip-trigger" }
{ "type": "type", "selector": "#search", "value": "query" }
{ "type": "scroll", "selector": "#footer" }
{ "type": "evaluate", "expression": "openSettingsPanel()" }
```

**Wait strategies** — ensure the page is ready before snapshot:

```json
{ "type": "selector", "selector": ".modal.visible" }
{ "type": "timeout", "timeout": 1000 }
{ "type": "animations" }
{ "type": "cssClass", "selector": "#app", "className": "loaded" }
```

**Example** — capture a modal state:

```
eyeless_capture({
  label: "settings-modal",
  interactions: [{ type: "click", selector: "#settings-btn" }],
  waitFor: [{ type: "selector", selector: ".modal.visible" }]
})
```

Use different labels to capture multiple states of the same URL.

## Configuration

Project config lives in `.eyeless/config.json`:

```json
{
  "url": "http://localhost:3000",
  "viewports": [
    { "label": "desktop", "width": 1440, "height": 900 },
    { "label": "mobile", "width": 375, "height": 812 }
  ],
  "threshold": 0.5,
  "scenarios": [
    {
      "label": "homepage",
      "waitFor": [{ "type": "selector", "selector": "#app.loaded" }]
    },
    {
      "label": "modal-open",
      "interactions": [{ "type": "click", "selector": "#settings-btn" }],
      "waitFor": [{ "type": "selector", "selector": ".modal.visible" }]
    }
  ],
  "ignore": [
    { "selector": ".loading-spinner", "reason": "Dynamic loading state" }
  ]
}
```

## How It Works

1. **Capture a baseline** — Eyeless screenshots your page and records computed styles for every visible element
2. **Your agent makes changes** — Code gets written, styles get modified
3. **Check against baseline** — Eyeless replays the same interactions, captures current state, and diffs against baseline
4. **Agent gets structured feedback** — Exact CSS selectors, property names, and values — not pixels

## What Gets Captured

- Computed CSS styles (60+ tracked properties)
- SVG attributes (fill, stroke, viewBox, etc.)
- Pseudo-elements (`::before`, `::after`)
- Shadow DOM (open roots)
- Bounding boxes for every element
- Selector confidence scoring (ID: 1.0, class: 0.8, path: 0.6)

## Security

- Localhost only — never exposed to the network
- All project paths validated and canonicalized
- Path traversal protection on all endpoints
- Input validation on all configuration and runtime parameters
- Error messages sanitized — no internal paths leaked
- Chromium sandbox enabled

## License

Business Source License 1.1 (BSL-1.1)

**You can:** Use Eyeless for development, CI, MCP server, and production use on your own projects — commercial or not. Modify and redistribute.

**You cannot:** Offer Eyeless to third parties as a hosted or embedded service that competes with Eyeless's paid versions.

**Change date:** On 2030-04-04, the license converts to Apache 2.0.

Full license text is included in the npm package (`LICENSE` file). For alternative licensing, contact andre@eyeless.dev.
