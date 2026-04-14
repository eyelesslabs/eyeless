import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { formatStatus, formatCaptureHint, formatCheckHint, formatCheckResult, formatCheckResultCompact, BaselineEntry, StatusContext } from './index';
import { CheckResult, HistoryEntry } from '../types';

function makeBaseline(overrides: Partial<BaselineEntry> = {}): BaselineEntry {
  return {
    scenario: 'homepage',
    viewport: 'desktop',
    elementCount: 42,
    timestamp: '2026-04-14T12:00:00.000Z',
    url: 'http://localhost:3000',
    ...overrides,
  };
}

function makeCheckResult(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    status: 'pass',
    matchPercentage: 100,
    scenario: 'homepage',
    viewport: 'desktop',
    drifts: [],
    summary: 'No drifts detected',
    ...overrides,
  };
}

function makeHistoryEntry(results: CheckResult[], timestamp = '2026-04-14T13:00:00.000Z'): HistoryEntry {
  return { timestamp, results };
}

// A fixed "now" date used throughout so tests are deterministic
const NOW = new Date('2026-04-14T14:00:00.000Z');

// A timestamp recent enough to never be stale (1 day ago)
const FRESH_TIMESTAMP = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();

// A timestamp old enough to be stale (31 days ago)
const STALE_TIMESTAMP = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();

describe('formatStatus: no baselines', () => {
  it('includes "No baselines captured yet" when baseline list is empty', () => {
    const ctx: StatusContext = { baselines: [], lastCheck: null, now: NOW };
    const output = formatStatus(ctx);
    assert.ok(output.includes('No baselines captured yet'));
  });

  it('includes prototype guidance when baseline list is empty', () => {
    const ctx: StatusContext = { baselines: [], lastCheck: null, now: NOW };
    const output = formatStatus(ctx);
    assert.ok(output.includes('prototype'));
  });
});

describe('formatStatus: baselines with no check history', () => {
  it('lists all baseline scenarios', () => {
    const ctx: StatusContext = {
      baselines: [
        makeBaseline({ scenario: 'homepage' }),
        makeBaseline({ scenario: 'pricing' }),
      ],
      lastCheck: null,
      now: NOW,
    };
    const output = formatStatus(ctx);
    assert.ok(output.includes('homepage'));
    assert.ok(output.includes('pricing'));
  });

  it('includes "No checks run yet"', () => {
    const ctx: StatusContext = {
      baselines: [makeBaseline(), makeBaseline({ scenario: 'about' })],
      lastCheck: null,
      now: NOW,
    };
    const output = formatStatus(ctx);
    assert.ok(output.includes('No checks run yet'));
  });

  it('includes a hint about running a check', () => {
    const ctx: StatusContext = {
      baselines: [makeBaseline()],
      lastCheck: null,
      now: NOW,
    };
    const output = formatStatus(ctx);
    assert.ok(output.includes('eyeless_check'));
  });
});

describe('formatStatus: baselines + last check all passing', () => {
  it('includes "All baselines passing"', () => {
    const ctx: StatusContext = {
      baselines: [makeBaseline({ scenario: 'homepage', timestamp: FRESH_TIMESTAMP })],
      lastCheck: makeHistoryEntry([makeCheckResult({ scenario: 'homepage', status: 'pass' })]),
      now: NOW,
    };
    const output = formatStatus(ctx);
    assert.ok(output.includes('All baselines passing'));
  });
});

describe('formatStatus: baselines + last check has drifts', () => {
  it('includes "Drifts detected"', () => {
    const ctx: StatusContext = {
      baselines: [makeBaseline({ scenario: 'homepage', timestamp: FRESH_TIMESTAMP })],
      lastCheck: makeHistoryEntry([
        makeCheckResult({
          scenario: 'homepage',
          status: 'drift',
          matchPercentage: 87.5,
          drifts: [{ selector: '.btn', tagName: 'button', property: 'color', baseline: '#000', current: '#f00' }],
        }),
      ]),
      now: NOW,
    };
    const output = formatStatus(ctx);
    assert.ok(output.includes('Drifts detected'));
  });
});

describe('formatStatus: stale baseline', () => {
  it('includes "[STALE]" for a baseline older than 30 days', () => {
    const ctx: StatusContext = {
      baselines: [makeBaseline({ timestamp: STALE_TIMESTAMP })],
      lastCheck: null,
      now: NOW,
    };
    const output = formatStatus(ctx);
    assert.ok(output.includes('[STALE]'));
  });
});

describe('formatStatus: fresh baseline', () => {
  it('does not include "[STALE]" for a baseline captured within 30 days', () => {
    const ctx: StatusContext = {
      baselines: [makeBaseline({ timestamp: FRESH_TIMESTAMP })],
      lastCheck: null,
      now: NOW,
    };
    const output = formatStatus(ctx);
    assert.ok(!output.includes('[STALE]'));
  });
});

describe('formatStatus: unchecked baselines', () => {
  it('lists scenario names that were not covered in the last check', () => {
    const ctx: StatusContext = {
      baselines: [
        makeBaseline({ scenario: 'homepage', timestamp: FRESH_TIMESTAMP }),
        makeBaseline({ scenario: 'pricing', timestamp: FRESH_TIMESTAMP }),
      ],
      lastCheck: makeHistoryEntry([makeCheckResult({ scenario: 'homepage', status: 'pass' })]),
      now: NOW,
    };
    const output = formatStatus(ctx);
    assert.ok(output.includes('pricing'));
    assert.ok(output.includes('Unchecked'));
  });
});

describe('formatStatus: all baselines covered in last check', () => {
  it('does not include "Unchecked" when every baseline scenario was checked', () => {
    const ctx: StatusContext = {
      baselines: [
        makeBaseline({ scenario: 'homepage', timestamp: FRESH_TIMESTAMP }),
        makeBaseline({ scenario: 'pricing', timestamp: FRESH_TIMESTAMP }),
      ],
      lastCheck: makeHistoryEntry([
        makeCheckResult({ scenario: 'homepage', status: 'pass' }),
        makeCheckResult({ scenario: 'pricing', status: 'pass' }),
      ]),
      now: NOW,
    };
    const output = formatStatus(ctx);
    assert.ok(!output.includes('Unchecked'));
  });
});

describe('formatCaptureHint', () => {
  it('includes "First baseline captured" when no other baselines exist', () => {
    const output = formatCaptureHint({ otherBaselineCount: 0 });
    assert.ok(output.includes('First baseline captured'));
  });

  it('includes the count when other baselines exist', () => {
    const output = formatCaptureHint({ otherBaselineCount: 3 });
    assert.ok(output.includes('3 other baseline(s) exist'));
  });
});

describe('formatCheckHint', () => {
  it('returns empty string when all baselines were checked', () => {
    const output = formatCheckHint({
      checkedScenarios: ['homepage', 'pricing'],
      allBaselines: [
        makeBaseline({ scenario: 'homepage' }),
        makeBaseline({ scenario: 'pricing' }),
      ],
    });
    assert.equal(output, '');
  });

  it('includes the scenario name and "unchecked" for a single unchecked baseline', () => {
    const output = formatCheckHint({
      checkedScenarios: ['homepage'],
      allBaselines: [
        makeBaseline({ scenario: 'homepage' }),
        makeBaseline({ scenario: 'about' }),
      ],
    });
    assert.ok(output.includes('about'));
    assert.ok(output.includes('unchecked'));
  });

  it('lists all unchecked scenario names when multiple baselines were skipped', () => {
    const output = formatCheckHint({
      checkedScenarios: ['homepage'],
      allBaselines: [
        makeBaseline({ scenario: 'homepage' }),
        makeBaseline({ scenario: 'pricing' }),
        makeBaseline({ scenario: 'docs' }),
      ],
    });
    assert.ok(output.includes('pricing'));
    assert.ok(output.includes('docs'));
  });

  it('returns empty string when baseline list is empty', () => {
    const output = formatCheckHint({
      checkedScenarios: [],
      allBaselines: [],
    });
    assert.equal(output, '');
  });
});

describe('formatCheckResult', () => {
  it('returns JSON with pass status and match percentage', () => {
    const result = makeCheckResult({ status: 'pass', matchPercentage: 99.8 });
    const output = formatCheckResult(result);
    const parsed = JSON.parse(output);
    assert.equal(parsed.status, 'pass');
    assert.equal(parsed.matchPercentage, 99.8);
    assert.equal(parsed.scenario, 'homepage');
  });

  it('returns JSON with error status and summary', () => {
    const result = makeCheckResult({
      status: 'error',
      matchPercentage: 0,
      summary: 'No baseline found for viewport desktop.',
    });
    const output = formatCheckResult(result);
    const parsed = JSON.parse(output);
    assert.equal(parsed.status, 'error');
    assert.equal(parsed.summary, 'No baseline found for viewport desktop.');
    assert.equal(parsed.matchPercentage, undefined);
  });

  it('returns JSON with drift details including selectors and properties', () => {
    const result = makeCheckResult({
      status: 'drift',
      matchPercentage: 87.5,
      drifts: [
        { selector: '.btn', tagName: 'button', property: 'color', baseline: '#000', current: '#f00' },
        { selector: 'h1', tagName: 'h1', property: 'font-size', baseline: '24px', current: '20px' },
      ],
    });
    const output = formatCheckResult(result);
    const parsed = JSON.parse(output);
    assert.equal(parsed.status, 'drift');
    assert.equal(parsed.driftCount, 2);
    assert.equal(parsed.drifts[0].selector, '.btn');
    assert.equal(parsed.drifts[0].property, 'color');
    assert.equal(parsed.drifts[0].expected, '#000');
    assert.equal(parsed.drifts[0].current, '#f00');
    assert.equal(parsed.drifts[1].selector, 'h1');
  });
});

describe('formatCheckResultCompact', () => {
  it('returns error summary for error status instead of drift output', () => {
    const result = makeCheckResult({
      status: 'error',
      matchPercentage: 0,
      summary: 'No baseline found for viewport desktop. Run eyeless_capture first.',
    });
    const output = formatCheckResultCompact(result);
    assert.ok(output.startsWith('error:'), `expected error prefix, got: ${output}`);
    assert.ok(output.includes('No baseline found'), `expected summary in output, got: ${output}`);
    assert.ok(!output.includes('drift'), `should not mention drifts, got: ${output}`);
  });

  it('returns match percentage for pass status', () => {
    const result = makeCheckResult({ status: 'pass', matchPercentage: 99.5 });
    const output = formatCheckResultCompact(result);
    assert.ok(output.includes('99.5%'), `expected percentage, got: ${output}`);
    assert.ok(output.includes('no drifts'), `expected no drifts, got: ${output}`);
  });
});
