import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateExportHtml } from './export';
import { HistoryEntry, CheckResult, StyleDrift } from './types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeless-export-test-'));
  fs.mkdirSync(path.join(tmpDir, '.eyeless'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeDrift(overrides: Partial<StyleDrift> = {}): StyleDrift {
  return {
    selector: '.btn',
    tagName: 'button',
    property: 'color',
    baseline: 'rgb(0, 0, 0)',
    current: 'rgb(255, 0, 0)',
    ...overrides,
  };
}

function makeEntry(overrides?: Partial<HistoryEntry>): HistoryEntry {
  return {
    timestamp: '2026-04-05T12:00:00.000Z',
    results: [
      {
        status: 'drift',
        matchPercentage: 92.5,
        scenario: 'homepage',
        viewport: 'desktop',
        drifts: [makeDrift()],
        summary: '1 drift(s) detected',
      },
    ],
    ...overrides,
  };
}

describe('export: generateExportHtml', () => {
  it('returns valid HTML string', async () => {
    const entry = makeEntry();
    const html = await generateExportHtml(entry, tmpDir);

    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<html'));
    assert.ok(html.includes('</html>'));
    assert.ok(html.includes('<head>'));
    assert.ok(html.includes('<body>'));
  });

  it('contains the check timestamp', async () => {
    const entry = makeEntry();
    const html = await generateExportHtml(entry, tmpDir);

    assert.ok(html.includes('2026-04-05T12:00:00.000Z'));
  });

  it('contains drift details (property, expected, actual)', async () => {
    const entry = makeEntry({
      results: [{
        status: 'drift',
        matchPercentage: 90.0,
        scenario: 'homepage',
        viewport: 'desktop',
        drifts: [
          makeDrift({ property: 'font-size', baseline: '16px', current: '14px' }),
          makeDrift({ property: 'margin-top', baseline: '10px', current: '20px' }),
        ],
        summary: '2 drift(s)',
      }],
    });
    const html = await generateExportHtml(entry, tmpDir);

    assert.ok(html.includes('font-size'));
    assert.ok(html.includes('16px'));
    assert.ok(html.includes('14px'));
    assert.ok(html.includes('margin-top'));
  });

  it('contains scenario and viewport info', async () => {
    const entry = makeEntry();
    const html = await generateExportHtml(entry, tmpDir);

    assert.ok(html.includes('homepage'));
    assert.ok(html.includes('desktop'));
  });

  it('contains pass/drift/error status', async () => {
    const entry = makeEntry({
      results: [
        { status: 'pass', matchPercentage: 100, scenario: 'a', viewport: 'desktop', drifts: [], summary: 'ok' },
        { status: 'drift', matchPercentage: 90, scenario: 'b', viewport: 'desktop', drifts: [makeDrift()], summary: 'drift' },
        { status: 'error', matchPercentage: 0, scenario: 'c', viewport: 'desktop', drifts: [], summary: 'error' },
      ],
    });
    const html = await generateExportHtml(entry, tmpDir);

    assert.ok(html.includes('PASS'));
    assert.ok(html.includes('DRIFT'));
    assert.ok(html.includes('ERROR'));
  });

  it('is self-contained with no external URLs', async () => {
    const entry = makeEntry();
    const html = await generateExportHtml(entry, tmpDir);

    // Should not reference any http/https URLs (except in the data itself)
    const lines = html.split('\n');
    for (const line of lines) {
      // Skip lines that contain user data (scenario URLs, etc)
      if (line.includes('localhost:3000') || line.includes('example.com')) continue;
      assert.ok(!line.includes('href="http'), `Found external URL in HTML: ${line.trim()}`);
      assert.ok(!line.includes('src="http'), `Found external URL in HTML: ${line.trim()}`);
    }
  });

  it('includes inline CSS', async () => {
    const entry = makeEntry();
    const html = await generateExportHtml(entry, tmpDir);

    assert.ok(html.includes('<style>'));
    assert.ok(html.includes('</style>'));
  });
});

describe('export: base64 screenshots', () => {
  it('embeds reference screenshot as base64 when available', async () => {
    // Create a fake reference image
    const refDir = path.join(tmpDir, '.eyeless', 'baselines', 'bitmaps_reference');
    fs.mkdirSync(refDir, { recursive: true });
    const refImage = path.join(refDir, 'eyeless_homepage_0_document_0_desktop.png');
    fs.writeFileSync(refImage, Buffer.from('fake-png-data'));

    const entry = makeEntry({
      results: [{
        status: 'drift',
        matchPercentage: 90,
        scenario: 'homepage',
        viewport: 'desktop',
        drifts: [makeDrift()],
        summary: 'drift',
        referenceImage: 'baselines/bitmaps_reference/eyeless_homepage_0_document_0_desktop.png',
      }],
    });

    const html = await generateExportHtml(entry, tmpDir);
    assert.ok(html.includes('data:image/png;base64,'));
  });

  it('embeds test screenshot as base64 when available', async () => {
    const testDir = path.join(tmpDir, '.eyeless', 'bitmaps_test', 'eyeless');
    fs.mkdirSync(testDir, { recursive: true });
    const testImage = path.join(testDir, 'eyeless_homepage_0_document_0_desktop.png');
    fs.writeFileSync(testImage, Buffer.from('fake-test-png'));

    const entry = makeEntry({
      results: [{
        status: 'drift',
        matchPercentage: 90,
        scenario: 'homepage',
        viewport: 'desktop',
        drifts: [makeDrift()],
        summary: 'drift',
        testImage: 'bitmaps_test/eyeless/eyeless_homepage_0_document_0_desktop.png',
      }],
    });

    const html = await generateExportHtml(entry, tmpDir);
    assert.ok(html.includes('data:image/png;base64,'));
  });
});
