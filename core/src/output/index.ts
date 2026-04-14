import { CheckResult, CaptureResult, StyleDrift, StyleSnapshot, HistoryEntry } from '../types';

export function formatCheckResult(result: CheckResult): string {
  if (result.status === 'pass') {
    return JSON.stringify({
      status: 'pass',
      scenario: result.scenario,
      viewport: result.viewport,
      matchPercentage: result.matchPercentage,
      summary: result.summary,
    }, null, 2);
  }

  if (result.status === 'error') {
    return JSON.stringify({
      status: 'error',
      scenario: result.scenario,
      viewport: result.viewport,
      summary: result.summary,
    }, null, 2);
  }

  // Drift detected — this is the core output format
  return JSON.stringify({
    status: 'drift',
    scenario: result.scenario,
    viewport: result.viewport,
    matchPercentage: result.matchPercentage,
    driftCount: result.drifts.length,
    drifts: result.drifts.map(formatDrift),
    summary: result.summary,
  }, null, 2);
}

function formatDrift(drift: StyleDrift): object {
  return {
    selector: drift.selector,
    element: drift.tagName,
    property: drift.property,
    current: drift.current,
    expected: drift.baseline,
  };
}

export function formatCheckResultCompact(result: CheckResult): string {
  if (result.status === 'pass') {
    return `match: ${result.matchPercentage.toFixed(1)}%, no drifts`;
  }

  if (result.status === 'error') {
    return `error: ${result.summary}`;
  }

  const lines: string[] = [];
  lines.push(`match: ${result.matchPercentage.toFixed(1)}%, ${result.drifts.length} drift(s):`);

  // Group drifts by selector
  const grouped = new Map<string, StyleDrift[]>();
  for (const drift of result.drifts) {
    const existing = grouped.get(drift.selector) || [];
    existing.push(drift);
    grouped.set(drift.selector, existing);
  }

  for (const [selector, drifts] of grouped) {
    lines.push(`  ${selector}`);
    for (const d of drifts) {
      lines.push(`    ${d.property}: ${d.current}, expected ${d.baseline}`);
    }
  }

  return lines.join('\n');
}

export function formatCaptureResult(result: CaptureResult): string {
  return JSON.stringify({
    status: result.status,
    scenario: result.scenario,
    viewport: result.viewport,
    baselinePath: result.baselinePath,
    elementsCaptured: result.elementsCaptured,
    summary: result.summary,
  }, null, 2);
}

export interface BaselineEntry {
  scenario: string;
  viewport: string;
  elementCount: number;
  timestamp: string;
  url: string;
}

export function formatBaselinesList(baselines: BaselineEntry[]): string {
  if (baselines.length === 0) {
    return 'No baselines found.';
  }

  const lines: string[] = [`Found ${baselines.length} baseline(s):\n`];
  for (const b of baselines) {
    lines.push(`- ${b.scenario} @ ${b.viewport}: ${b.elementCount} elements (captured ${b.timestamp})`);
  }
  return lines.join('\n');
}

export function formatSnapshotInspection(snapshot: StyleSnapshot): string {
  const lines: string[] = [
    `Snapshot: ${snapshot.url}`,
    `Viewport: ${snapshot.viewport.label} (${snapshot.viewport.width}x${snapshot.viewport.height})`,
    `Captured: ${snapshot.timestamp}`,
    `Elements: ${snapshot.elements.length}\n`,
  ];

  for (const el of snapshot.elements) {
    const styleCount = Object.keys(el.computedStyles).length;
    lines.push(`  ${el.selector} <${el.tagName}> (${styleCount} styles)`);
    for (const [prop, value] of Object.entries(el.computedStyles)) {
      lines.push(`    ${prop}: ${value}`);
    }
  }

  return lines.join('\n');
}

/** Baseline age (in days) after which it is considered stale */
export const STALE_THRESHOLD_DAYS = 30;

export interface StatusContext {
  baselines: BaselineEntry[];
  lastCheck: HistoryEntry | null;
  now: Date;
}

export function formatStatus(ctx: StatusContext): string {
  const sections: string[] = [];
  const staleMs = STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

  // Section 1 — Baselines
  if (ctx.baselines.length > 0) {
    const lines: string[] = [];
    for (const b of ctx.baselines) {
      const age = ctx.now.getTime() - new Date(b.timestamp).getTime();
      const stale = age > staleMs ? ' [STALE]' : '';
      lines.push(`- ${b.scenario} @ ${b.viewport}: ${b.elementCount} elements (captured ${b.timestamp})${stale}`);
    }
    sections.push(lines.join('\n'));
  }

  // Section 2 — Last check
  if (ctx.lastCheck === null) {
    sections.push('No checks run yet.');
  } else {
    const results = ctx.lastCheck.results;
    const passed = results.filter(r => r.status === 'pass').length;
    const drifted = results.filter(r => r.status === 'drift').length;
    const errored = results.filter(r => r.status === 'error').length;
    sections.push(`Last check (${ctx.lastCheck.timestamp}): ${passed} passed, ${drifted} drifted, ${errored} errored`);
  }

  // Section 3 — Unchecked baselines
  let uncheckedScenarios: string[] = [];
  if (ctx.lastCheck !== null && ctx.baselines.length > 0) {
    const baselineScenarios = new Set(ctx.baselines.map(b => b.scenario));
    const checkedScenarios = new Set(ctx.lastCheck.results.map(r => r.scenario));
    uncheckedScenarios = [...baselineScenarios].filter(s => !checkedScenarios.has(s));
    if (uncheckedScenarios.length > 0) {
      sections.push(`Unchecked baselines: ${uncheckedScenarios.join(', ')}. These were not included in the last check.`);
    }
  }

  // Section 4 — Hint
  if (ctx.baselines.length === 0) {
    sections.push(
      'No baselines captured yet. If a prototype or reference exists, capture it first — then check against it as you build the real implementation. Otherwise, capture each page as you finish building it.'
    );
  } else if (ctx.lastCheck !== null && ctx.lastCheck.results.some(r => r.status === 'drift')) {
    sections.push('Drifts detected in last check. Fix them and re-check all baselines with eyeless_check.');
  } else if (uncheckedScenarios.length > 0) {
    sections.push(`Run eyeless_check without a label to verify all ${new Set(ctx.baselines.map(b => b.scenario)).size} baselines.`);
  } else if (ctx.lastCheck !== null) {
    sections.push('All baselines passing. After editing shared CSS or components, run eyeless_check without a label.');
  } else {
    sections.push('Run eyeless_check without a label to verify all baselines before making changes.');
  }

  return sections.join('\n\n');
}

export interface CaptureContext {
  otherBaselineCount: number;
}

export function formatCaptureHint(ctx: CaptureContext): string {
  if (ctx.otherBaselineCount === 0) {
    return 'First baseline captured. If building from a prototype, check against this baseline as you implement. Otherwise, continue capturing each page as you finish it.';
  }
  return `${ctx.otherBaselineCount} other baseline(s) exist. After making changes, run eyeless_check without a label to check for regressions across all pages.`;
}

export interface CheckContext {
  checkedScenarios: string[];
  allBaselines: BaselineEntry[];
}

export function formatCheckHint(ctx: CheckContext): string {
  if (ctx.allBaselines.length === 0) {
    return '';
  }
  const checked = new Set(ctx.checkedScenarios);
  const unchecked = [...new Set(ctx.allBaselines.map(b => b.scenario))].filter(s => !checked.has(s));
  if (unchecked.length === 0) {
    return '';
  }
  return `${unchecked.length} unchecked baseline(s): ${unchecked.join(', ')}. Run eyeless_check without a label to check all baselines.`;
}
