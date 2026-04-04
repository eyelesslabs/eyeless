#!/usr/bin/env node

import { startServer } from './mcp/server';
import { startHttpServer } from './http-server';
import { loadConfig, saveConfig, ensureDirectories, getConfigPath } from './config';
import { capture, check } from './engine';
import { formatCheckResultCompact } from './output';
import { EyelessConfig } from './types';

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
  console.log('  init               Initialize .eyeless/ config in a project');
  console.log('  dashboard          Start HTTP dashboard server (used by the app)');
  console.log('');
  console.log('Options:');
  console.log('  --url <url>        Target URL (default: from config)');
  console.log('  --label <name>     Scenario label (default: "default")');
  console.log('  --project <path>   Project directory (default: cwd)');
  console.log('  --version          Show version');
  console.log('  --help             Show this help');
  console.log('');
  console.log('Examples:');
  console.log('  eyeless serve                          # MCP server for AI agents');
  console.log('  eyeless init --url http://localhost:3000');
  console.log('  eyeless capture --label homepage');
  console.log('  eyeless check --label homepage');
  console.log('');
  console.log('MCP config (paste into your editor):');
  console.log('  { "mcpServers": { "eyeless": { "command": "eyeless", "args": ["serve"] } } }');
}

async function main() {
  const flags = parseFlags(args);
  const projectPath = flags.project || process.cwd();

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
      const handle = await startHttpServer(port);
      process.stdout.write(`PORT:${handle.port}\n`);
      break;
    }

    case 'init': {
      ensureDirectories(projectPath);
      const url = flags.url || 'http://localhost:5173';
      const config: EyelessConfig = {
        url,
        viewports: [{ label: 'desktop', width: 1920, height: 1080 }],
        threshold: 0.1,
        scenarios: [],
        ignore: [],
      };
      saveConfig(config, projectPath);
      console.log(`Initialized .eyeless/ in ${projectPath}`);
      console.log(`Config: ${getConfigPath(projectPath)}`);
      break;
    }

    case 'capture': {
      const config = loadConfig(projectPath);
      const url = flags.url || config.url;
      const label = flags.label || 'default';

      console.log(`Capturing baseline: ${label} @ ${url}`);
      const results = await capture({ url, label, project: projectPath });

      for (const r of results) {
        console.log(`  ${r.viewport}: ${r.elementsCaptured} elements tracked`);
      }
      break;
    }

    case 'check': {
      const config = loadConfig(projectPath);
      const url = flags.url || config.url;
      const label = flags.label || 'default';

      console.log(`Checking: ${label} @ ${url}`);
      const results = await check({ url, label, project: projectPath });

      let hasDrift = false;
      for (const r of results) {
        if (results.length > 1) {
          console.log(`[${r.viewport}]`);
        }
        console.log(formatCheckResultCompact(r));
        if (r.status === 'drift' || r.status === 'error') hasDrift = true;
      }
      process.exit(hasDrift ? 1 : 0);
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
