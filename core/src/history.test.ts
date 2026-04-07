import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileStorage } from './storage/file-storage';
import { CheckResult, StyleDrift, HistoryEntry } from './types';

let tmpDir: string;
let storage: FileStorage;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeless-history-test-'));
  fs.mkdirSync(path.join(tmpDir, '.eyeless'), { recursive: true });
  storage = new FileStorage();
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

function makeCheckResult(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    status: 'drift',
    matchPercentage: 95.0,
    scenario: 'default',
    viewport: 'desktop',
    drifts: [makeDrift()],
    summary: '1 drift(s) detected',
    ...overrides,
  };
}

describe('history: appendHistory stores full drift data', () => {
  it('stores full StyleDrift[] with property names and values', async () => {
    const drifts: StyleDrift[] = [
      makeDrift({ property: 'color', baseline: 'red', current: 'blue' }),
      makeDrift({ property: 'font-size', baseline: '16px', current: '14px', selector: '.title' }),
    ];
    const results = [makeCheckResult({ drifts })];

    await storage.appendHistory(tmpDir, { timestamp: new Date().toISOString(), results });
    const history = await storage.getHistory(tmpDir);

    assert.equal(history.length, 1);
    assert.equal(history[0].results[0].drifts.length, 2);
    assert.equal(history[0].results[0].drifts[0].property, 'color');
    assert.equal(history[0].results[0].drifts[0].baseline, 'red');
    assert.equal(history[0].results[0].drifts[0].current, 'blue');
    assert.equal(history[0].results[0].drifts[1].property, 'font-size');
    assert.equal(history[0].results[0].drifts[1].selector, '.title');
  });

  it('preserves selector and tagName in drift data', async () => {
    const drifts = [makeDrift({ selector: 'div.hero > h1', tagName: 'h1' })];
    const results = [makeCheckResult({ drifts })];

    await storage.appendHistory(tmpDir, { timestamp: new Date().toISOString(), results });
    const history = await storage.getHistory(tmpDir);

    assert.equal(history[0].results[0].drifts[0].selector, 'div.hero > h1');
    assert.equal(history[0].results[0].drifts[0].tagName, 'h1');
  });
});

describe('history: getHistory returns entries with full drift arrays', () => {
  it('returns all stored drift data across multiple entries', async () => {
    await storage.appendHistory(tmpDir, { timestamp: new Date().toISOString(), results: [makeCheckResult({ scenario: 'first' })] });
    await storage.appendHistory(tmpDir, { timestamp: new Date().toISOString(), results: [makeCheckResult({ scenario: 'second', drifts: [makeDrift(), makeDrift({ property: 'padding' })] })] });

    const history = await storage.getHistory(tmpDir);
    assert.equal(history.length, 2);
    assert.equal(history[0].results[0].scenario, 'first');
    assert.equal(history[0].results[0].drifts.length, 1);
    assert.equal(history[1].results[0].scenario, 'second');
    assert.equal(history[1].results[0].drifts.length, 2);
  });

  it('returns empty array for nonexistent project', async () => {
    const history = await storage.getHistory(path.join(tmpDir, 'nonexistent'));
    assert.deepEqual(history, []);
  });
});

describe('history: cap at 100 entries', () => {
  it('trims oldest entries when exceeding 100', async () => {
    for (let i = 0; i < 105; i++) {
      await storage.appendHistory(tmpDir, { timestamp: new Date().toISOString(), results: [makeCheckResult({ scenario: `run-${i}` })] });
    }

    const history = await storage.getHistory(tmpDir);
    assert.equal(history.length, 100);
    // Oldest 5 should be trimmed
    assert.equal(history[0].results[0].scenario, 'run-5');
    assert.equal(history[99].results[0].scenario, 'run-104');
    // Full drift data still present
    assert.equal(history[0].results[0].drifts.length, 1);
    assert.equal(history[0].results[0].drifts[0].property, 'color');
  });
});
