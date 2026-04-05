import * as path from 'path';
import * as fs from 'fs';
import { loadConfig, ensureDirectories, getSnapshotsDir, getBaselinesDir, getEyelessDir } from './config';
import { runReference, runTest } from './backstop';
import { compareSnapshots, loadSnapshot, getSnapshotPath } from './attributor/compare';
import { CheckResult, CaptureResult, EyelessConfig, ScenarioConfig, Viewport, Interaction, WaitStrategy } from './types';

export interface EngineOptions {
  url?: string;
  label?: string;
  project?: string;
  interactions?: Interaction[];
  waitFor?: WaitStrategy[];
}

export type CaptureOptions = EngineOptions;
export type CheckOptions = EngineOptions;

export function findScreenshot(dir: string, label: string, viewport: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  const files = fs.readdirSync(dir);
  // BackstopJS naming: {id}_{label}_{index}_{selector}_{selectorIndex}_{viewport}.png
  const match = files.find(f =>
    f.endsWith('.png') && f.includes(`_${label}_`) && f.includes(`_${viewport}.png`)
  );
  return match ? path.join(dir, match) : undefined;
}

function screenshotRelativePath(eyelessDir: string, absolutePath: string): string {
  return path.relative(eyelessDir, absolutePath);
}

function resolveScenarios(opts: EngineOptions, config: EyelessConfig): ScenarioConfig[] {
  if (opts.label) {
    const url = opts.url || config.url;
    const scenario: ScenarioConfig = { label: opts.label, url };
    if (opts.interactions) scenario.interactions = opts.interactions;
    if (opts.waitFor) scenario.waitFor = opts.waitFor;
    return [scenario];
  }

  if (config.scenarios.length > 0) {
    return config.scenarios;
  }

  return [{ label: 'default', url: opts.url || config.url }];
}

export async function capture(opts: CaptureOptions): Promise<CaptureResult[]> {
  const projectPath = opts.project || process.cwd();
  const config = loadConfig(projectPath);
  ensureDirectories(projectPath);

  const scenarios = resolveScenarios(opts, config);

  await runReference(config, projectPath, scenarios);

  const snapshotsDir = getSnapshotsDir(projectPath);
  const results: CaptureResult[] = [];

  for (const scenario of scenarios) {
    for (const vp of config.viewports) {
      const snapshotPath = getSnapshotPath(snapshotsDir, 'reference', scenario.label, vp.label);
      const snapshot = loadSnapshot(snapshotPath);
      const elementCount = snapshot?.elements.length || 0;

      results.push({
        status: 'captured',
        scenario: scenario.label,
        viewport: vp.label,
        baselinePath: snapshotPath,
        elementsCaptured: elementCount,
        summary: `Baseline captured: ${scenario.label} (${vp.label}), ${elementCount} elements tracked`,
      });
    }
  }

  return results;
}

export async function check(opts: CheckOptions): Promise<CheckResult[]> {
  const projectPath = opts.project || process.cwd();
  const config = loadConfig(projectPath);
  ensureDirectories(projectPath);

  const scenarios = resolveScenarios(opts, config);

  const backstopResult = await runTest(config, projectPath, scenarios);
  const snapshotsDir = getSnapshotsDir(projectPath);
  const eyelessDir = getEyelessDir(projectPath);
  const baselinesDir = getBaselinesDir(projectPath);
  const results: CheckResult[] = [];

  for (const scenario of scenarios) {
    const label = scenario.label;

    for (const vp of config.viewports) {
      const refSnapshot = loadSnapshot(getSnapshotPath(snapshotsDir, 'reference', label, vp.label));
      const testSnapshot = loadSnapshot(getSnapshotPath(snapshotsDir, 'test', label, vp.label));

      // Find screenshot image paths
      const refImagePath = findScreenshot(path.join(baselinesDir, 'bitmaps_reference'), label, vp.label);
      const testImagePath = findScreenshot(path.join(eyelessDir, 'bitmaps_test', 'eyeless'), label, vp.label);

      const referenceImage = refImagePath ? screenshotRelativePath(eyelessDir, refImagePath) : undefined;
      const testImage = testImagePath ? screenshotRelativePath(eyelessDir, testImagePath) : undefined;

      if (!refSnapshot) {
        results.push({
          status: 'error',
          matchPercentage: 0,
          scenario: label,
          viewport: vp.label,
          drifts: [],
          summary: `No baseline found for viewport ${vp.label}. Run eyeless_capture first.`,
          referenceImage,
          testImage,
        });
        continue;
      }

      if (!testSnapshot) {
        results.push({
          status: 'error',
          matchPercentage: 0,
          scenario: label,
          viewport: vp.label,
          drifts: [],
          summary: `Failed to capture current state for viewport ${vp.label}.`,
          referenceImage,
          testImage,
        });
        continue;
      }

      const drifts = compareSnapshots(refSnapshot, testSnapshot, config.ignore);

      const backstopTest = backstopResult.tests.find(
        (t) => t.pair.label === label && t.pair.viewportLabel === vp.label,
      );
      const misMatch = backstopTest?.pair.diff?.rawMisMatchPercentage || 0;
      const matchPercentage = 100 - misMatch;
      const status = drifts.length === 0 && matchPercentage >= (100 - config.threshold) ? 'pass' : 'drift';

      results.push({
        status,
        matchPercentage,
        scenario: label,
        viewport: vp.label,
        drifts,
        summary: status === 'pass'
          ? `match: ${matchPercentage.toFixed(1)}%, no drifts`
          : `match: ${matchPercentage.toFixed(1)}%, ${drifts.length} drift(s) detected`,
        referenceImage,
        testImage,
      });
    }
  }

  return results;
}
