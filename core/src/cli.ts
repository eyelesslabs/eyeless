#!/usr/bin/env node

import { startServer } from './mcp/server';
import { startHttpServer } from './http-server';
import { getConfigPath, loadConfig } from './config';
import { capture, check } from './engine';
import { formatCheckResultCompact } from './output';
import { generateExportHtml } from './export';
import { EyelessConfig } from './types';
import { getDefaultStorage } from './storage';
import * as fs from 'fs';

const VERSION = '0.1.0';
const command = process.argv[2];
const args = process.argv.slice(3);

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      flags[key] = next && !next.startsWith('--') ? (i++, next) : 'true';
    }
  }
  return flags;
}

function printHelp() {
  console.log(`eyeless v${VERSION} — visual feedback for AI coding agents`);
  console.log('');
  console.log('Usage: eyeless <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  serve              Start MCP server (stdio transport)');
  console.log('  check              Check current state against baseline');
  console.log('  capture            Capture a visual baseline');
  console.log('  history            Show check history');
  console.log('  versions           Show baseline version history');
  console.log('  export             Export a check report as HTML');
  console.log('  init               Initialize .eyeless/ config in a project');
  console.log('  dashboard          Start HTTP dashboard server (used by the app)');
  console.log('');
  console.log('Options:');
  console.log('  --url <url>        Target URL (default: from config)');
  console.log('  --label <name>     Scenario label (default: "default")');
  console.log('  --project <path>   Project directory (default: cwd)');
  console.log('  --ci               Structured JSON output for CI/CD');
  console.log('  --threshold <n>    Override threshold for this run');
  console.log('  --detail <id>      Show full detail for a history entry');
  console.log('  --output <file>    Output file path (for export)');
  console.log('  --version          Show version');
  console.log('  --help             Show this help');
  console.log('');
  console.log('Examples:');
  console.log('  eyeless serve                          # MCP server for AI agents');
  console.log('  eyeless init --url http://localhost:3000');
  console.log('  eyeless capture --label homepage');
  console.log('  eyeless check --label homepage');
  console.log('  eyeless check --ci --threshold 0.5');
  console.log('  eyeless history --detail 0');
  console.log('  eyeless export --output report.html');
  console.log('');
  console.log('MCP config (paste into your editor):');
  console.log('  { "mcpServers": { "eyeless": { "command": "eyeless", "args": ["serve"] } } }');
}

async function main() {
  const flags = parseFlags(args);
  const projectPath = flags.project || process.cwd();
  const storage = getDefaultStorage();

  if (command === '--version' || command === '-v' || flags.version) {
    console.log(`eyeless v${VERSION}`);
    process.exit(0);
  }

  if (command === '--help' || command === '-h' || command === 'help' || flags.help) {
    printHelp();
    process.exit(0);
  }

  switch (command) {
    case 'serve':
      await startServer();
      break;

    case 'dashboard': {
      const port = parseInt(flags.port || '0', 10);
      const handle = await startHttpServer(port, storage);
      process.stdout.write(`PORT:${handle.port}\n`);
      break;
    }

    case 'init': {
      await storage.ensureDirectories(projectPath);
      const url = flags.url || 'http://localhost:5173';
      const config: EyelessConfig = {
        url,
        viewports: [{ label: 'desktop', width: 1920, height: 1080 }],
        threshold: 0.1,
        scenarios: [],
        ignore: [],
      };
      await storage.putConfig(projectPath, config);
      console.log(`Initialized .eyeless/ in ${projectPath}`);
      console.log(`Config: ${getConfigPath(projectPath)}`);
      break;
    }

    case 'capture': {
      const config = await loadConfig(storage, projectPath);
      const url = flags.url || config.url;
      const label = flags.label || 'default';
      const ciMode = flags.ci !== undefined;

      if (!ciMode) console.log(`Capturing baseline: ${label} @ ${url}`);

      try {
        const results = await capture({ url, label, project: projectPath, storage });

        if (ciMode) {
          const output = {
            status: 'captured',
            results,
          };
          process.stdout.write(JSON.stringify(output, null, 2) + '\n');
        } else {
          for (const r of results) {
            console.log(`  ${r.viewport}: ${r.elementsCaptured} elements tracked`);
          }
        }
      } catch (err: any) {
        if (ciMode) {
          const output = {
            status: 'error',
            error: err.message,
          };
          process.stdout.write(JSON.stringify(output, null, 2) + '\n');
          process.exit(2);
        }
        throw err;
      }
      break;
    }

    case 'check': {
      const config = await loadConfig(storage, projectPath);
      const url = flags.url || config.url;
      const label = flags.label || 'default';
      const ciMode = flags.ci !== undefined;
      const thresholdOverride = flags.threshold ? parseFloat(flags.threshold) : undefined;

      if (!ciMode) console.log(`Checking: ${label} @ ${url}`);

      try {
        const results = await check({ url, label, project: projectPath, storage });

        // Apply threshold override for CI
        if (thresholdOverride !== undefined) {
          const threshold = thresholdOverride;
          for (const r of results) {
            if (r.status === 'drift' || r.status === 'pass') {
              const hasStyleDrifts = r.drifts.length > 0;
              const passesThreshold = r.matchPercentage >= (100 - threshold);
              r.status = !hasStyleDrifts && passesThreshold ? 'pass' : 'drift';
            }
          }
        }

        let hasDrift = false;
        let hasError = false;
        for (const r of results) {
          if (r.status === 'drift') hasDrift = true;
          if (r.status === 'error') hasError = true;
        }

        if (ciMode) {
          const total = results.length;
          const passed = results.filter(r => r.status === 'pass').length;
          const drifted = results.filter(r => r.status === 'drift').length;
          const errors = results.filter(r => r.status === 'error').length;

          const output = {
            status: hasError ? 'error' : hasDrift ? 'drift' : 'pass',
            summary: { total, passed, drifted, errors },
            results,
          };
          process.stdout.write(JSON.stringify(output, null, 2) + '\n');
          process.exit(hasError ? 2 : hasDrift ? 1 : 0);
        } else {
          for (const r of results) {
            if (results.length > 1) {
              console.log(`[${r.viewport}]`);
            }
            console.log(formatCheckResultCompact(r));
          }
          process.exit(hasDrift || hasError ? 1 : 0);
        }
      } catch (err: any) {
        if (ciMode) {
          const output = {
            status: 'error',
            error: err.message,
            summary: { total: 0, passed: 0, drifted: 0, errors: 1 },
            results: [],
          };
          process.stdout.write(JSON.stringify(output, null, 2) + '\n');
          process.exit(2);
        }
        throw err;
      }
      break;
    }

    case 'history': {
      const history = await storage.getHistory(projectPath);
      const detailId = flags.detail;

      if (detailId !== undefined && detailId !== 'true') {
        const idx = parseInt(detailId, 10);
        if (isNaN(idx) || idx < 0 || idx >= history.length) {
          console.error(`Invalid history index: ${detailId} (${history.length} entries available)`);
          process.exit(1);
        }
        const entry = history[idx];
        console.log(`Check #${idx} — ${entry.timestamp}`);
        for (const r of entry.results) {
          console.log(`\n  ${r.scenario} @ ${r.viewport} — ${r.status.toUpperCase()} (${r.matchPercentage.toFixed(1)}%)`);
          if (r.drifts.length > 0) {
            for (const d of r.drifts) {
              console.log(`    ${d.selector} → ${d.property}: ${d.current} (expected ${d.baseline})`);
            }
          }
        }
      } else {
        if (history.length === 0) {
          console.log('No history found.');
          break;
        }
        const limit = flags.limit ? parseInt(flags.limit, 10) : 10;
        const entries = history.slice(-limit);
        const startIdx = history.length - entries.length;

        console.log(`History (last ${entries.length} of ${history.length}):\n`);
        console.log('  #   Timestamp                     Scenario       Viewport   Status   Match');
        console.log('  ' + '-'.repeat(80));
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          for (const r of entry.results) {
            const idx = String(startIdx + i).padEnd(4);
            const ts = entry.timestamp.substring(0, 25).padEnd(30);
            const sc = r.scenario.padEnd(15);
            const vp = r.viewport.padEnd(11);
            const st = r.status.toUpperCase().padEnd(9);
            const mp = r.matchPercentage.toFixed(1) + '%';
            console.log(`  ${idx}${ts}${sc}${vp}${st}${mp}`);
          }
        }
      }
      break;
    }

    case 'versions': {
      const label = flags.label || 'default';
      const viewport = flags.viewport || 'desktop';
      const versions = await storage.listVersions(projectPath, label, viewport);

      if (versions.length === 0) {
        console.log(`No versions found for ${label} @ ${viewport}.`);
        break;
      }

      console.log(`Versions for ${label} @ ${viewport} (${versions.length}):\n`);
      for (let i = 0; i < versions.length; i++) {
        const v = versions[i];
        const hasBitmap = v.bitmapPath ? ' (with screenshot)' : '';
        console.log(`  ${i}: ${v.timestamp}${hasBitmap}`);
      }
      break;
    }

    case 'export': {
      const history = await storage.getHistory(projectPath);
      if (history.length === 0) {
        console.error('No check history found.');
        process.exit(1);
      }

      let checkIndex = history.length - 1;
      if (flags.index !== undefined && flags.index !== 'true') {
        checkIndex = parseInt(flags.index, 10);
        if (isNaN(checkIndex) || checkIndex < 0 || checkIndex >= history.length) {
          console.error(`Invalid check index: ${flags.index} (${history.length} entries available)`);
          process.exit(1);
        }
      }

      const entry = history[checkIndex];
      const html = await generateExportHtml(entry, projectPath, storage);
      const outputPath = flags.output || 'eyeless-report.html';
      fs.writeFileSync(outputPath, html);
      console.log(`Report written to ${outputPath}`);
      break;
    }

    default:
      if (command) {
        console.error(`Unknown command: ${command}`);
        console.error('Run "eyeless --help" for usage.');
        process.exit(1);
      }
      printHelp();
      process.exit(0);
  }
}

main().catch((err) => {
  console.error(`eyeless: ${err.message}`);
  process.exit(1);
});
