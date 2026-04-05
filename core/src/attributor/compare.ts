import * as fs from 'fs';
import * as path from 'path';
import { StyleSnapshot, ElementStyleSnapshot, StyleDrift, IgnoreRule } from '../types';
import { sanitizeLabel } from './styles';

/**
 * Resolve confidence from two snapshots — use the minimum (most conservative).
 * Returns undefined if neither snapshot has confidence set (legacy data).
 */
function resolveConfidence(a?: number, b?: number): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

const MAX_SNAPSHOT_ELEMENTS = 10000;

export function loadSnapshot(filepath: string): StyleSnapshot | null {
  if (!fs.existsSync(filepath)) return null;
  try {
    const snapshot = JSON.parse(fs.readFileSync(filepath, 'utf-8')) as StyleSnapshot;
    if (snapshot.elements && snapshot.elements.length > MAX_SNAPSHOT_ELEMENTS) {
      snapshot.elements = snapshot.elements.slice(0, MAX_SNAPSHOT_ELEMENTS);
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function compareSnapshots(
  baseline: StyleSnapshot,
  current: StyleSnapshot,
  ignoreRules: IgnoreRule[] = [],
): StyleDrift[] {
  const drifts: StyleDrift[] = [];
  const ignoreSelectors = new Set(ignoreRules.map((r) => r.selector));

  // Build a lookup of baseline elements by selector
  const baselineMap = new Map<string, ElementStyleSnapshot>();
  for (const el of baseline.elements) {
    baselineMap.set(el.selector, el);
  }

  for (const currentEl of current.elements) {
    if (ignoreSelectors.has(currentEl.selector)) continue;

    const baselineEl = baselineMap.get(currentEl.selector);
    if (!baselineEl) continue; // New element — not a drift from baseline

    // Compare computed styles
    const allProps = new Set([
      ...Object.keys(baselineEl.computedStyles),
      ...Object.keys(currentEl.computedStyles),
    ]);

    // Use the lower confidence of baseline vs current (conservative)
    const confidence = resolveConfidence(baselineEl.selectorConfidence, currentEl.selectorConfidence);

    for (const prop of allProps) {
      const baselineVal = baselineEl.computedStyles[prop];
      const currentVal = currentEl.computedStyles[prop];

      if (baselineVal !== currentVal && baselineVal && currentVal) {
        const drift: StyleDrift = {
          selector: currentEl.selector,
          tagName: currentEl.tagName,
          property: prop,
          baseline: baselineVal,
          current: currentVal,
        };
        if (confidence !== undefined) {
          drift.confidence = confidence;
        }
        drifts.push(drift);
      }
    }

    // Compare SVG attributes if present
    if (baselineEl.svgAttributes || currentEl.svgAttributes) {
      const baseAttrs = baselineEl.svgAttributes || {};
      const currAttrs = currentEl.svgAttributes || {};
      const allAttrs = new Set([...Object.keys(baseAttrs), ...Object.keys(currAttrs)]);

      for (const attr of allAttrs) {
        const baseVal = baseAttrs[attr];
        const currVal = currAttrs[attr];

        if (baseVal !== currVal && baseVal && currVal) {
          const drift: StyleDrift = {
            selector: currentEl.selector,
            tagName: currentEl.tagName,
            property: `svg:${attr}`,
            baseline: baseVal,
            current: currVal,
          };
          if (confidence !== undefined) {
            drift.confidence = confidence;
          }
          drifts.push(drift);
        }
      }
    }
  }

  return drifts;
}

export function getSnapshotPath(
  snapshotsDir: string,
  type: 'reference' | 'test',
  scenarioLabel: string,
  viewportLabel: string,
): string {
  const scenarioSafe = sanitizeLabel(scenarioLabel);
  const viewportSafe = sanitizeLabel(viewportLabel);
  return path.join(snapshotsDir, type, `${scenarioSafe}_${viewportSafe}.json`);
}
