import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { capture, check } from '../engine';
import { formatCheckResult, formatCaptureResult, formatBaselinesList, formatSnapshotInspection, formatStatus, formatCaptureHint, formatCheckHint } from '../output';
import { loadConfig, restoreVersion } from '../config';
import { resolveProjectPath } from '../validation';
import { generateExportHtml } from '../export';
import { Storage, SnapshotEntry } from '../storage/types';
import { getDefaultStorage } from '../storage';
import { BaselineEntry } from '../output';

/**
 * Sanitize error messages for MCP responses.
 * Strips file system paths to prevent information disclosure.
 */
function sanitizeError(err: unknown): string {
  if (!(err instanceof Error)) return 'An unexpected error occurred';
  const msg = err.message;
  // If the message contains a file path, return a generic message
  if (msg.includes('/') || msg.includes('\\')) {
    // Preserve known application errors that happen to contain paths
    if (msg.startsWith('Invalid project path')) return msg;
    return 'Operation failed';
  }
  return msg;
}

/** Convert SnapshotEntry[] to BaselineEntry[] for output formatting */
function toBaselineEntries(entries: SnapshotEntry[]): BaselineEntry[] {
  return entries.map(e => ({
    scenario: e.scenario,
    viewport: e.viewport,
    elementCount: e.elementCount,
    timestamp: e.timestamp,
    url: e.url,
  }));
}

export function createServer(storage?: Storage): McpServer {
  const s = storage || getDefaultStorage();

  const server = new McpServer({
    name: 'eyeless',
    version: '0.4.0',
  });

  server.tool(
    'eyeless_capture',
    `Capture a visual baseline of the current page state. Run this when the page looks correct to establish the reference point for future checks.

MULTI-STATE CAPTURE: Real apps have modals, drawers, tabs, and JS-driven states. Use 'interactions' to reach a specific state before capturing, and 'waitFor' to ensure the page is ready.

INTERACTIONS — executed in order before capture:
  - click: Click an element. { type: "click", selector: "#open-modal" }
  - hover: Hover an element. { type: "hover", selector: ".tooltip-trigger" }
  - type: Type into an input. { type: "type", selector: "#search", value: "query" }
  - scroll: Scroll to an element. { type: "scroll", selector: "#footer" }
  - evaluate: Run arbitrary JS in the page. { type: "evaluate", expression: "document.querySelector('.panel').classList.add('open')" }

WAIT STRATEGIES — executed after interactions, before snapshot:
  - selector: Wait for an element to appear. { type: "selector", selector: ".modal.visible" }
  - timeout: Fixed delay in ms. { type: "timeout", timeout: 1000 }
  - animations: Wait for all CSS animations/transitions to finish. { type: "animations" }
  - cssClass: Wait for a class on an element. { type: "cssClass", selector: "#app", className: "loaded" }

EXAMPLE — capture a modal state:
  label: "settings-modal"
  interactions: [{ type: "click", selector: "#settings-btn" }]
  waitFor: [{ type: "selector", selector: ".modal.settings" }]

Use different labels to capture multiple states of the same URL (e.g. "homepage", "modal-open", "settings-panel").

WORKFLOW:
  - Existing projects: capture key pages before making changes so you have baselines to check against.
  - Building from a prototype: capture the prototype pages first as your visual reference. As you build the real implementation, run eyeless_check to verify it matches the prototype.
  - New projects: capture each page as you finish building it, before moving to the next.
  - After any intentional visual change, re-capture to update the baseline.`,
    {
      url: z.string().optional().describe('URL to capture. Defaults to config url.'),
      label: z.string().optional().describe('Name for this baseline scenario (e.g. "homepage", "modal-open", "settings-panel"). Defaults to "default". Use different labels to capture multiple states of the same URL.'),
      project: z.string().optional().describe('Path to the project directory. Defaults to cwd.'),
      interactions: z.array(z.object({
        type: z.enum(['click', 'hover', 'type', 'scroll', 'evaluate']).describe('Interaction type'),
        selector: z.string().describe('CSS selector for the target element (ignored for evaluate)'),
        value: z.string().optional().describe('Value to type (type) or ignored for other types'),
        expression: z.string().optional().describe('JavaScript expression to execute in page context (evaluate only)'),
      })).optional().describe('Interactions to execute in order before capturing. Use to reach app states like open modals, expanded panels, active tabs.'),
      waitFor: z.array(z.object({
        type: z.enum(['selector', 'timeout', 'animations', 'cssClass']).describe('Wait strategy type'),
        selector: z.string().optional().describe('CSS selector (for selector and cssClass types)'),
        className: z.string().optional().describe('CSS class name to wait for (cssClass type)'),
        timeout: z.number().optional().describe('Delay in milliseconds (timeout type)'),
      })).optional().describe('Wait strategies executed after interactions, before snapshot capture. Ensures the page is in the desired state.'),
    },
    async ({ url, label, project, interactions, waitFor }) => {
      try {
        const projectPath = resolveProjectPath(project);
        const results = await capture({ url, label, project: projectPath, interactions, waitFor, storage: s });
        const parts = results.map(formatCaptureResult);

        const allSnapshots = await s.listSnapshots(projectPath, 'reference');
        const justCaptured = new Set(results.map(r => r.scenario));
        const otherBaselineCount = new Set(
          allSnapshots.filter(snap => !justCaptured.has(snap.scenario)).map(snap => snap.scenario)
        ).size;
        parts.push(formatCaptureHint({ otherBaselineCount }));

        const text = parts.join('\n---\n');
        return { content: [{ type: 'text', text }] };
      } catch (err: unknown) {
        return {
          content: [{ type: 'text', text: `Capture failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'eyeless_check',
    `Check the current page state against baselines. Returns structured diffs with CSS selectors and computed style values — no screenshots needed.

Must use the same label, interactions, and waitFor used during capture to reach the same page state.

REGRESSION WORKFLOW:
  - After editing shared CSS, layout files, or components used across pages → run WITHOUT a label to check ALL baselines.
  - After a change scoped to a single page → run WITH the matching label.
  - When in doubt, omit the label. Checking all baselines is fast; missing a regression is costly.

See eyeless_capture for full documentation on interactions and waitFor options.`,
    {
      url: z.string().optional().describe('URL to check. Defaults to config url.'),
      label: z.string().optional().describe('Scenario label to check against. Must match the label used during capture. Defaults to "default".'),
      project: z.string().optional().describe('Path to the project directory. Defaults to cwd.'),
      interactions: z.array(z.object({
        type: z.enum(['click', 'hover', 'type', 'scroll', 'evaluate']).describe('Interaction type'),
        selector: z.string().describe('CSS selector for the target element (ignored for evaluate)'),
        value: z.string().optional().describe('Value to type (type) or ignored for other types'),
        expression: z.string().optional().describe('JavaScript expression to execute in page context (evaluate only)'),
      })).optional().describe('Same interactions used during capture, to reach the same page state before checking.'),
      waitFor: z.array(z.object({
        type: z.enum(['selector', 'timeout', 'animations', 'cssClass']).describe('Wait strategy type'),
        selector: z.string().optional().describe('CSS selector (for selector and cssClass types)'),
        className: z.string().optional().describe('CSS class name to wait for (cssClass type)'),
        timeout: z.number().optional().describe('Delay in milliseconds (timeout type)'),
      })).optional().describe('Same wait strategies used during capture.'),
    },
    async ({ url, label, project, interactions, waitFor }) => {
      try {
        const projectPath = resolveProjectPath(project);
        const results = await check({ url, label, project: projectPath, interactions, waitFor, storage: s });
        const parts = results.map(formatCheckResult);

        if (label) {
          const allSnapshots = await s.listSnapshots(projectPath, 'reference');
          const allBaselines = toBaselineEntries(allSnapshots);
          const checkedScenarios = results.map(r => r.scenario);
          const hint = formatCheckHint({ checkedScenarios, allBaselines });
          if (hint) parts.push(hint);
        }

        const text = parts.join('\n---\n');
        return { content: [{ type: 'text', text }] };
      } catch (err: unknown) {
        return {
          content: [{ type: 'text', text: `Check failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'eyeless_baselines',
    'List all captured baselines for a project. Shows scenario names, viewports, element counts, and capture timestamps.',
    {
      project: z.string().optional().describe('Path to the project directory. Defaults to cwd.'),
    },
    async ({ project }) => {
      try {
        const projectPath = resolveProjectPath(project);
        const snapshots = await s.listSnapshots(projectPath, 'reference');
        const baselines = toBaselineEntries(snapshots);
        const text = formatBaselinesList(baselines);
        return { content: [{ type: 'text', text }] };
      } catch (err: unknown) {
        return {
          content: [{ type: 'text', text: `Failed to list baselines: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'eyeless_inspect',
    'Inspect a specific baseline\'s style snapshot. Returns the captured elements with their selectors, tag names, and tracked computed styles.',
    {
      project: z.string().optional().describe('Path to the project directory. Defaults to cwd.'),
      label: z.string().optional().describe('Scenario label to inspect. Defaults to "default".'),
      viewport: z.string().optional().describe('Viewport label to inspect. Defaults to the first configured viewport.'),
    },
    async ({ project, label, viewport }) => {
      try {
        const projectPath = resolveProjectPath(project);
        const config = await loadConfig(s, projectPath);
        const scenarioLabel = label || 'default';
        const viewportLabel = viewport || config.viewports[0]?.label || 'desktop';

        const snapshot = await s.getSnapshot(projectPath, 'reference', scenarioLabel, viewportLabel);

        if (!snapshot) {
          return {
            content: [{ type: 'text', text: `No baseline found for scenario "${scenarioLabel}" at viewport "${viewportLabel}".` }],
          };
        }

        const text = formatSnapshotInspection(snapshot);
        return { content: [{ type: 'text', text }] };
      } catch (err: unknown) {
        return {
          content: [{ type: 'text', text: `Inspect failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'eyeless_history',
    'View check history for a project. Returns summary list by default, or full detail for a specific entry by index.',
    {
      project: z.string().optional().describe('Path to the project directory. Defaults to cwd.'),
      index: z.number().optional().describe('History entry index to get full detail. Omit for summary list.'),
      limit: z.number().optional().describe('Max entries to return in summary mode. Default 10.'),
    },
    async ({ project, index, limit }) => {
      try {
        const projectPath = resolveProjectPath(project);
        const history = await s.getHistory(projectPath);

        if (index !== undefined) {
          if (index < 0 || index >= history.length) {
            return { content: [{ type: 'text', text: `History entry #${index} not found. ${history.length} entries available.` }] };
          }
          const entry = history[index];
          return { content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }] };
        }

        if (history.length === 0) {
          return { content: [{ type: 'text', text: 'No check history found.' }] };
        }

        const n = limit || 10;
        const recent = history.slice(-n);
        const startIdx = history.length - recent.length;
        const lines: string[] = [`Check history (${recent.length} of ${history.length} entries):\n`];
        for (let i = 0; i < recent.length; i++) {
          const entry = recent[i];
          for (const r of entry.results) {
            lines.push(`#${startIdx + i}  ${entry.timestamp}  ${r.scenario} @ ${r.viewport}  ${r.status.toUpperCase()}  ${r.matchPercentage.toFixed(1)}%  ${r.drifts.length} drift(s)`);
          }
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err: unknown) {
        return {
          content: [{ type: 'text', text: `History failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'eyeless_versions',
    'List baseline versions for a scenario, or restore a previous version.',
    {
      project: z.string().optional().describe('Path to the project directory. Defaults to cwd.'),
      label: z.string().optional().describe('Scenario label. Defaults to "default".'),
      viewport: z.string().optional().describe('Viewport label. Defaults to "desktop".'),
      restore: z.string().optional().describe('Version timestamp to restore as current baseline. Omit to list versions.'),
    },
    async ({ project, label, viewport, restore }) => {
      try {
        const projectPath = resolveProjectPath(project);
        const scenarioLabel = label || 'default';
        const viewportLabel = viewport || 'desktop';

        if (restore) {
          const success = await restoreVersion(s, projectPath, scenarioLabel, viewportLabel, restore);
          if (!success) {
            return { content: [{ type: 'text', text: `Version "${restore}" not found for ${scenarioLabel} @ ${viewportLabel}.` }] };
          }
          return { content: [{ type: 'text', text: `Restored version ${restore} as current baseline for ${scenarioLabel} @ ${viewportLabel}.` }] };
        }

        const versions = await s.listVersions(projectPath, scenarioLabel, viewportLabel);
        if (versions.length === 0) {
          return { content: [{ type: 'text', text: `No versions found for ${scenarioLabel} @ ${viewportLabel}.` }] };
        }

        const lines: string[] = [`Versions for ${scenarioLabel} @ ${viewportLabel} (${versions.length}):\n`];
        for (let i = 0; i < versions.length; i++) {
          const v = versions[i];
          const hasBitmap = v.bitmapPath ? ' (with screenshot)' : '';
          lines.push(`  ${i}: ${v.timestamp}${hasBitmap}`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err: unknown) {
        return {
          content: [{ type: 'text', text: `Versions failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'eyeless_export',
    'Export a check result as a self-contained HTML report with inline screenshots and drift details.',
    {
      project: z.string().optional().describe('Path to the project directory. Defaults to cwd.'),
      checkIndex: z.number().optional().describe('History entry index to export. Defaults to the latest check.'),
    },
    async ({ project, checkIndex }) => {
      try {
        const projectPath = resolveProjectPath(project);
        const history = await s.getHistory(projectPath);

        if (history.length === 0) {
          return { content: [{ type: 'text', text: 'No check history found. Run eyeless_check first.' }] };
        }

        const idx = checkIndex !== undefined ? checkIndex : history.length - 1;
        if (idx < 0 || idx >= history.length) {
          return { content: [{ type: 'text', text: `History entry #${idx} not found. ${history.length} entries available.` }] };
        }

        const entry = history[idx];
        const html = await generateExportHtml(entry, projectPath, s);
        return { content: [{ type: 'text', text: html }] };
      } catch (err: unknown) {
        return {
          content: [{ type: 'text', text: `Export failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'eyeless_status',
    'Get the visual coverage state of this project — baselines, last check results, stale baselines, and unchecked scenarios. Call this at the start of any task that touches frontend code to understand what pages have visual baselines and what needs checking.',
    {
      project: z.string().optional().describe('Path to the project directory. Defaults to cwd.'),
    },
    async ({ project }) => {
      try {
        const projectPath = resolveProjectPath(project);
        const snapshots = await s.listSnapshots(projectPath, 'reference');
        const baselines = toBaselineEntries(snapshots);
        const history = await s.getHistory(projectPath);
        const lastCheck = history.length > 0 ? history[history.length - 1] : null;

        const text = formatStatus({ baselines, lastCheck, now: new Date() });
        return { content: [{ type: 'text', text }] };
      } catch (err: unknown) {
        return {
          content: [{ type: 'text', text: `Status failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
