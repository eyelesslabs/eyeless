import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileStorage } from '../storage/file-storage';
import { HistoryEntry, CheckResult, StyleSnapshot } from '../types';
import {
  formatStatus,
  formatCaptureHint,
  formatCheckHint,
  BaselineEntry,
  STALE_THRESHOLD_DAYS,
} from '../output';

let tmpDir: string;
let storage: FileStorage;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeless-server-test-'));
  fs.mkdirSync(path.join(tmpDir, '.eyeless'), { recursive: true });
  storage = new FileStorage();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function writeSnapshot(
  projectPath: string,
  scenario: string,
  viewport: string,
  timestamp?: string,
): void {
  const dir = path.join(projectPath, '.eyeless', 'snapshots', 'reference');
  fs.mkdirSync(dir, { recursive: true });

  const data: StyleSnapshot = {
    url: 'http://localhost:3000',
    viewport: { label: viewport, width: 1280, height: 800 },
    timestamp: timestamp ?? new Date().toISOString(),
    elements: [
      {
        selector: 'body',
        tagName: 'body',
        boundingBox: { x: 0, y: 0, width: 1280, height: 800 },
        computedStyles: { color: 'rgb(0, 0, 0)' },
      },
    ],
  };

  fs.writeFileSync(
    path.join(dir, `${scenario}_${viewport}.json`),
    JSON.stringify(data, null, 2),
  );
}

function writeHistory(projectPath: string, entries: HistoryEntry[]): void {
  const historyPath = path.join(projectPath, '.eyeless', 'history.json');
  fs.writeFileSync(historyPath, JSON.stringify(entries, null, 2));
}

function makeCheckResult(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    status: 'pass',
    matchPercentage: 100,
    scenario: 'default',
    viewport: 'desktop',
    drifts: [],
    summary: 'No drifts detected',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatStatus — empty project
// ---------------------------------------------------------------------------

describe('formatStatus: empty project (no snapshots, no history)', () => {
  it('returns bootstrap guidance when no baselines exist', async () => {
    const baselines = await storage.listSnapshots(tmpDir, 'reference');
    const history = await storage.getHistory(tmpDir);
    const lastCheck = history.length > 0 ? history[history.length - 1] : null;

    const text = formatStatus({ baselines: [], lastCheck, now: new Date() });

    assert.ok(
      text.includes('No baselines captured yet'),
      `expected bootstrap guidance, got: ${text}`,
    );
  });

  it('does not mention "No checks run yet" when there are no baselines', async () => {
    const history = await storage.getHistory(tmpDir);
    const lastCheck = history.length > 0 ? history[history.length - 1] : null;

    const text = formatStatus({ baselines: [], lastCheck, now: new Date() });

    // The bootstrap message is shown instead of the "No checks run yet" section
    assert.ok(!text.includes('Last check'), `unexpected check section: ${text}`);
  });
});

// ---------------------------------------------------------------------------
// formatStatus — baselines present, no history
// ---------------------------------------------------------------------------

describe('formatStatus: baselines present, no history', () => {
  it('lists captured baselines', async () => {
    writeSnapshot(tmpDir, 'default', 'desktop');
    writeSnapshot(tmpDir, 'mobile', 'mobile');

    const snapshots = await storage.listSnapshots(tmpDir, 'reference');
    const text = formatStatus({ baselines: snapshots, lastCheck: null, now: new Date() });

    assert.ok(text.includes('default @ desktop'), `missing baseline: ${text}`);
    assert.ok(text.includes('mobile @ mobile'), `missing baseline: ${text}`);
  });

  it('shows "No checks run yet" when history is empty', async () => {
    writeSnapshot(tmpDir, 'default', 'desktop');

    const snapshots = await storage.listSnapshots(tmpDir, 'reference');
    const text = formatStatus({ baselines: snapshots, lastCheck: null, now: new Date() });

    assert.ok(text.includes('No checks run yet'), `expected no-checks message: ${text}`);
  });

  it('suggests running eyeless_check when there are baselines but no history', async () => {
    writeSnapshot(tmpDir, 'default', 'desktop');

    const snapshots = await storage.listSnapshots(tmpDir, 'reference');
    const text = formatStatus({ baselines: snapshots, lastCheck: null, now: new Date() });

    assert.ok(text.includes('eyeless_check'), `expected check suggestion: ${text}`);
  });
});

// ---------------------------------------------------------------------------
// formatStatus — stale baselines
// ---------------------------------------------------------------------------

describe('formatStatus: stale baselines', () => {
  it('marks baselines older than STALE_THRESHOLD_DAYS as [STALE]', async () => {
    const staleMs = (STALE_THRESHOLD_DAYS + 1) * 24 * 60 * 60 * 1000;
    const staleTimestamp = new Date(Date.now() - staleMs).toISOString();

    writeSnapshot(tmpDir, 'homepage', 'desktop', staleTimestamp);
    writeSnapshot(tmpDir, 'dashboard', 'desktop');

    const snapshots = await storage.listSnapshots(tmpDir, 'reference');
    const text = formatStatus({ baselines: snapshots, lastCheck: null, now: new Date() });

    assert.ok(text.includes('[STALE]'), `expected [STALE] marker: ${text}`);
  });

  it('does not mark recently captured baselines as stale', async () => {
    writeSnapshot(tmpDir, 'homepage', 'desktop'); // captured now

    const snapshots = await storage.listSnapshots(tmpDir, 'reference');
    const text = formatStatus({ baselines: snapshots, lastCheck: null, now: new Date() });

    assert.ok(!text.includes('[STALE]'), `unexpected [STALE] marker: ${text}`);
  });

  it('only marks old baselines stale when mixed with fresh ones', async () => {
    const staleMs = (STALE_THRESHOLD_DAYS + 5) * 24 * 60 * 60 * 1000;
    const staleTimestamp = new Date(Date.now() - staleMs).toISOString();

    writeSnapshot(tmpDir, 'old-page', 'desktop', staleTimestamp);
    writeSnapshot(tmpDir, 'new-page', 'desktop'); // captured now

    const snapshots = await storage.listSnapshots(tmpDir, 'reference');
    const text = formatStatus({ baselines: snapshots, lastCheck: null, now: new Date() });

    assert.ok(text.includes('[STALE]'), `expected [STALE] for old-page: ${text}`);

    // The fresh baseline line should not carry the stale tag
    const lines = text.split('\n');
    const newPageLine = lines.find(l => l.includes('new-page'));
    assert.ok(newPageLine, 'expected new-page line');
    assert.ok(!newPageLine.includes('[STALE]'), `new-page should not be stale: ${newPageLine}`);
  });
});

// ---------------------------------------------------------------------------
// formatStatus — with history
// ---------------------------------------------------------------------------

describe('formatStatus: with check history', () => {
  it('reports pass/drift/error counts from the last check', async () => {
    writeSnapshot(tmpDir, 'default', 'desktop');
    writeSnapshot(tmpDir, 'about', 'desktop');

    const entry: HistoryEntry = {
      timestamp: new Date().toISOString(),
      results: [
        makeCheckResult({ scenario: 'default', status: 'pass' }),
        makeCheckResult({ scenario: 'about', status: 'drift', matchPercentage: 85, drifts: [
          { selector: 'h1', tagName: 'h1', property: 'color', baseline: 'red', current: 'blue' },
        ] }),
      ],
    };
    writeHistory(tmpDir, [entry]);

    const snapshots = await storage.listSnapshots(tmpDir, 'reference');
    const history = await storage.getHistory(tmpDir);
    const lastCheck = history[history.length - 1];

    const text = formatStatus({ baselines: snapshots, lastCheck, now: new Date() });

    assert.ok(text.includes('1 passed'), `expected passed count: ${text}`);
    assert.ok(text.includes('1 drifted'), `expected drifted count: ${text}`);
  });

  it('shows "All baselines passing" hint when last check is clean', async () => {
    writeSnapshot(tmpDir, 'default', 'desktop');

    const entry: HistoryEntry = {
      timestamp: new Date().toISOString(),
      results: [makeCheckResult({ scenario: 'default', status: 'pass' })],
    };
    writeHistory(tmpDir, [entry]);

    const snapshots = await storage.listSnapshots(tmpDir, 'reference');
    const history = await storage.getHistory(tmpDir);
    const lastCheck = history[history.length - 1];

    const text = formatStatus({ baselines: snapshots, lastCheck, now: new Date() });

    assert.ok(text.includes('All baselines passing'), `expected passing hint: ${text}`);
  });

  it('shows unchecked baselines when a scenario was skipped in the last check', async () => {
    writeSnapshot(tmpDir, 'default', 'desktop');
    writeSnapshot(tmpDir, 'settings', 'desktop');

    const entry: HistoryEntry = {
      timestamp: new Date().toISOString(),
      results: [makeCheckResult({ scenario: 'default' })],
    };
    writeHistory(tmpDir, [entry]);

    const snapshots = await storage.listSnapshots(tmpDir, 'reference');
    const history = await storage.getHistory(tmpDir);
    const lastCheck = history[history.length - 1];

    const text = formatStatus({ baselines: snapshots, lastCheck, now: new Date() });

    assert.ok(text.includes('settings'), `expected unchecked scenario: ${text}`);
    assert.ok(text.includes('Unchecked baselines'), `expected unchecked section: ${text}`);
  });
});

// ---------------------------------------------------------------------------
// formatCaptureHint
// ---------------------------------------------------------------------------

describe('formatCaptureHint: first baseline captured', () => {
  it('returns "First baseline" message when no other baselines exist', () => {
    const hint = formatCaptureHint({ otherBaselineCount: 0 });

    assert.ok(
      hint.includes('First baseline'),
      `expected first-baseline message, got: ${hint}`,
    );
  });
});

describe('formatCaptureHint: additional baselines exist', () => {
  it('mentions the count of other baselines', () => {
    const hint = formatCaptureHint({ otherBaselineCount: 2 });

    assert.ok(hint.includes('2'), `expected baseline count, got: ${hint}`);
    assert.ok(hint.includes('eyeless_check'), `expected check suggestion, got: ${hint}`);
  });

  it('returns a non-empty string for any positive count', () => {
    assert.ok(formatCaptureHint({ otherBaselineCount: 1 }).length > 0);
    assert.ok(formatCaptureHint({ otherBaselineCount: 10 }).length > 0);
  });
});

// ---------------------------------------------------------------------------
// formatCheckHint
// ---------------------------------------------------------------------------

describe('formatCheckHint: all baselines covered', () => {
  it('returns empty string when checked scenarios cover all baselines', () => {
    const allBaselines: BaselineEntry[] = [
      { scenario: 'homepage', viewport: 'desktop', elementCount: 10, timestamp: new Date().toISOString(), url: 'http://localhost' },
    ];

    const hint = formatCheckHint({ checkedScenarios: ['homepage'], allBaselines });

    assert.equal(hint, '');
  });

  it('returns empty string when no baselines exist at all', () => {
    const hint = formatCheckHint({ checkedScenarios: ['homepage'], allBaselines: [] });

    assert.equal(hint, '');
  });
});

describe('formatCheckHint: unchecked baselines remain', () => {
  it('warns when checked scenario leaves other baselines unchecked', () => {
    const allBaselines: BaselineEntry[] = [
      { scenario: 'homepage', viewport: 'desktop', elementCount: 5, timestamp: new Date().toISOString(), url: 'http://localhost' },
      { scenario: 'dashboard', viewport: 'desktop', elementCount: 8, timestamp: new Date().toISOString(), url: 'http://localhost' },
      { scenario: 'settings', viewport: 'desktop', elementCount: 3, timestamp: new Date().toISOString(), url: 'http://localhost' },
    ];

    const hint = formatCheckHint({ checkedScenarios: ['homepage'], allBaselines });

    assert.ok(hint.includes('2'), `expected 2 unchecked, got: ${hint}`);
    assert.ok(hint.includes('dashboard'), `expected dashboard in hint, got: ${hint}`);
    assert.ok(hint.includes('settings'), `expected settings in hint, got: ${hint}`);
    assert.ok(hint.includes('eyeless_check'), `expected check suggestion, got: ${hint}`);
  });

  it('does not include the checked scenario in the unchecked list', () => {
    const allBaselines: BaselineEntry[] = [
      { scenario: 'homepage', viewport: 'desktop', elementCount: 5, timestamp: new Date().toISOString(), url: 'http://localhost' },
      { scenario: 'about', viewport: 'desktop', elementCount: 2, timestamp: new Date().toISOString(), url: 'http://localhost' },
    ];

    const hint = formatCheckHint({ checkedScenarios: ['homepage'], allBaselines });

    assert.ok(!hint.includes('homepage'), `checked scenario should not appear in hint: ${hint}`);
    assert.ok(hint.includes('about'), `expected about in hint: ${hint}`);
  });

  it('deduplicates scenarios across multiple viewports', () => {
    // Same scenario captured at two viewports — should count as one unchecked scenario
    const allBaselines: BaselineEntry[] = [
      { scenario: 'homepage', viewport: 'desktop', elementCount: 5, timestamp: new Date().toISOString(), url: 'http://localhost' },
      { scenario: 'homepage', viewport: 'mobile', elementCount: 4, timestamp: new Date().toISOString(), url: 'http://localhost' },
      { scenario: 'about', viewport: 'desktop', elementCount: 2, timestamp: new Date().toISOString(), url: 'http://localhost' },
    ];

    const hint = formatCheckHint({ checkedScenarios: ['about'], allBaselines });

    // "homepage" appears once in the hint despite having two viewport entries
    const homepageMatches = (hint.match(/homepage/g) || []).length;
    assert.equal(homepageMatches, 1, `homepage should appear exactly once: ${hint}`);
  });
});
