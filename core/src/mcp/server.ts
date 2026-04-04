import * as fs from 'fs';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { capture, check } from '../engine';
import { formatCheckResult, formatCaptureResult, formatBaselinesList, formatSnapshotInspection, BaselineEntry } from '../output';
import { getSnapshotsDir, loadConfig } from '../config';
import { loadSnapshot, getSnapshotPath } from '../attributor/compare';
import { resolveProjectPath } from '../validation';

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

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'eyeless',
    version: '0.2.3',
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

Use different labels to capture multiple states of the same URL (e.g. "homepage", "modal-open", "settings-panel").`,
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
        const results = await capture({ url, label, project: projectPath, interactions, waitFor });
        const text = results.map(formatCaptureResult).join('\n---\n');
        return { content: [{ type: 'text', text }] };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Capture failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'eyeless_check',
    `Check the current page state against the baseline. Returns structured diffs with CSS selectors and computed style values — no screenshots needed.

Must use the same label, interactions, and waitFor that were used during capture so the check reaches the same page state. For example, if you captured "modal-open" with a click interaction, pass the same interaction when checking.

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
        const results = await check({ url, label, project: projectPath, interactions, waitFor });
        const text = results.map(formatCheckResult).join('\n---\n');
        return { content: [{ type: 'text', text }] };
      } catch (err: any) {
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
        const snapshotsDir = getSnapshotsDir(projectPath);
        const refDir = path.join(snapshotsDir, 'reference');
        const baselines: BaselineEntry[] = [];

        if (fs.existsSync(refDir)) {
          const files = fs.readdirSync(refDir).filter(f => f.endsWith('.json'));
          for (const file of files) {
            try {
              const snapshot = JSON.parse(fs.readFileSync(path.join(refDir, file), 'utf-8'));
              const parts = file.replace('.json', '').split('_');
              const viewport = parts.pop() || 'desktop';
              const scenario = parts.join('_');

              baselines.push({
                scenario,
                viewport,
                elementCount: Array.isArray(snapshot.elements) ? snapshot.elements.length : 0,
                timestamp: typeof snapshot.timestamp === 'string' ? snapshot.timestamp : '',
              });
            } catch {
              // Skip malformed snapshot files
            }
          }
        }

        const text = formatBaselinesList(baselines);
        return { content: [{ type: 'text', text }] };
      } catch (err: any) {
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
        const snapshotsDir = getSnapshotsDir(projectPath);
        const config = loadConfig(projectPath);
        const scenarioLabel = label || 'default';
        const viewportLabel = viewport || config.viewports[0]?.label || 'desktop';

        const snapshotPath = getSnapshotPath(snapshotsDir, 'reference', scenarioLabel, viewportLabel);
        const snapshot = loadSnapshot(snapshotPath);

        if (!snapshot) {
          return {
            content: [{ type: 'text', text: `No baseline found for scenario "${scenarioLabel}" at viewport "${viewportLabel}".` }],
          };
        }

        const text = formatSnapshotInspection(snapshot);
        return { content: [{ type: 'text', text }] };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Inspect failed: ${sanitizeError(err)}` }],
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
