import { CheckResult, CaptureResult, StyleDrift, StyleSnapshot } from '../types';

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
