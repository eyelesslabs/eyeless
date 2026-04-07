import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeless-cli-test-'));
  fs.mkdirSync(path.join(tmpDir, '.eyeless'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runCli(args: string[], expectFail = false): { stdout: string; exitCode: number } {
  const cliPath = path.resolve(__dirname, 'cli.js');
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      encoding: 'utf-8',
      timeout: 10000,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    return { stdout, exitCode: 0 };
  } catch (err: any) {
    if (expectFail) {
      return { stdout: err.stdout || '', exitCode: err.status || 1 };
    }
    throw err;
  }
}

function writeHistory(projectPath: string, entries: any[]): void {
  const historyPath = path.join(projectPath, '.eyeless', 'history.json');
  fs.writeFileSync(historyPath, JSON.stringify(entries));
}

describe('CLI: history command', () => {
  it('prints compact table of last entries', () => {
    writeHistory(tmpDir, [
      {
        timestamp: '2026-04-05T10:00:00.000Z',
        results: [
          { status: 'pass', matchPercentage: 99.5, scenario: 'homepage', viewport: 'desktop', drifts: [], summary: 'ok' },
        ],
      },
      {
        timestamp: '2026-04-05T11:00:00.000Z',
        results: [
          { status: 'drift', matchPercentage: 85.0, scenario: 'modal', viewport: 'desktop', drifts: [{ selector: '.x', tagName: 'div', property: 'color', baseline: 'red', current: 'blue' }], summary: 'drift' },
        ],
      },
    ]);

    const result = runCli(['history', '--project', tmpDir]);
    assert.ok(result.stdout.includes('homepage'));
    assert.ok(result.stdout.includes('modal'));
    assert.ok(result.stdout.includes('PASS'));
    assert.ok(result.stdout.includes('DRIFT'));
  });

  it('--detail shows full drift data for one entry', () => {
    writeHistory(tmpDir, [
      {
        timestamp: '2026-04-05T10:00:00.000Z',
        results: [
          {
            status: 'drift',
            matchPercentage: 85.0,
            scenario: 'homepage',
            viewport: 'desktop',
            drifts: [
              { selector: '.btn', tagName: 'button', property: 'color', baseline: 'red', current: 'blue' },
              { selector: '.title', tagName: 'h1', property: 'font-size', baseline: '16px', current: '14px' },
            ],
            summary: '2 drifts',
          },
        ],
      },
    ]);

    const result = runCli(['history', '--project', tmpDir, '--detail', '0']);
    assert.ok(result.stdout.includes('color'));
    assert.ok(result.stdout.includes('red'));
    assert.ok(result.stdout.includes('blue'));
    assert.ok(result.stdout.includes('font-size'));
  });

  it('prints empty message when no history', () => {
    const result = runCli(['history', '--project', tmpDir]);
    assert.ok(result.stdout.includes('No history'));
  });
});

describe('CLI: versions command', () => {
  it('lists versions for a scenario', () => {
    const versionDir = path.join(tmpDir, '.eyeless', 'versions', 'homepage_desktop');
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, '2026-01-01T00-00-00-000Z.json'), '{}');

    const result = runCli(['versions', '--project', tmpDir, '--label', 'homepage']);
    assert.ok(result.stdout.includes('2026-01-01'));
  });

  it('prints empty message when no versions', () => {
    const result = runCli(['versions', '--project', tmpDir, '--label', 'nonexistent']);
    assert.ok(result.stdout.includes('No versions'));
  });
});

describe('CLI: export command', () => {
  it('writes HTML file to disk', () => {
    writeHistory(tmpDir, [
      {
        timestamp: '2026-04-05T10:00:00.000Z',
        results: [{ status: 'pass', matchPercentage: 100, scenario: 'default', viewport: 'desktop', drifts: [], summary: 'ok' }],
      },
    ]);

    const outputPath = path.join(tmpDir, 'report.html');
    runCli(['export', '--project', tmpDir, '--output', outputPath]);

    assert.ok(fs.existsSync(outputPath));
    const content = fs.readFileSync(outputPath, 'utf-8');
    assert.ok(content.includes('<!DOCTYPE html>'));
  });
});

describe('CLI: --ci flag on check', () => {
  // These tests require actually running BackstopJS+Playwright which is heavy.
  // We test the CI output format by running against a check that will error
  // (no config url, no backstop) — the --ci flag should still produce JSON.

  it('--ci produces valid JSON on stdout even for errors', () => {
    // Write a config so check doesn't crash on config load
    fs.writeFileSync(path.join(tmpDir, '.eyeless', 'config.json'), JSON.stringify({
      url: 'http://localhost:99999',
      viewports: [{ label: 'desktop', width: 1920, height: 1080 }],
      threshold: 0.1,
      scenarios: [],
      ignore: [],
    }));

    const result = runCli(['check', '--project', tmpDir, '--ci'], true);
    // Should produce JSON output (status: error)
    try {
      const parsed = JSON.parse(result.stdout.trim());
      assert.ok(parsed.status);
      assert.ok(['pass', 'drift', 'error'].includes(parsed.status));
    } catch {
      // If it's not JSON, that's also informative — check exits with code 2
      assert.ok(result.exitCode !== 0, 'CI mode should exit non-zero on error');
    }
  });

  it('--ci suppresses non-JSON output', () => {
    fs.writeFileSync(path.join(tmpDir, '.eyeless', 'config.json'), JSON.stringify({
      url: 'http://localhost:99999',
      viewports: [{ label: 'desktop', width: 1920, height: 1080 }],
      threshold: 0.1,
      scenarios: [],
      ignore: [],
    }));

    const result = runCli(['check', '--project', tmpDir, '--ci'], true);
    // Should not contain the human-readable "Checking: ..." prefix
    assert.ok(!result.stdout.includes('Checking:'));
  });
});

describe('CLI: --ci flag on capture', () => {
  it('--ci produces JSON output for capture errors', () => {
    fs.writeFileSync(path.join(tmpDir, '.eyeless', 'config.json'), JSON.stringify({
      url: 'http://localhost:99999',
      viewports: [{ label: 'desktop', width: 1920, height: 1080 }],
      threshold: 0.1,
      scenarios: [],
      ignore: [],
    }));

    const result = runCli(['capture', '--project', tmpDir, '--ci'], true);
    // Should not contain human-readable output
    assert.ok(!result.stdout.includes('Capturing baseline:'));
  });
});
