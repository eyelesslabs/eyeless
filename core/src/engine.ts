import { getSnapshotsDir, loadConfig, saveVersion } from './config';
import { runReference, runTest } from './backstop';
import { compareSnapshots, getSnapshotPath } from './attributor/compare';
import { CheckResult, CaptureResult, EyelessConfig, ScenarioConfig, Interaction, WaitStrategy } from './types';
import { Storage } from './storage/types';
import { getDefaultStorage } from './storage';

export interface EngineOptions {
  url?: string;
  label?: string;
  project?: string;
  interactions?: Interaction[];
  waitFor?: WaitStrategy[];
  storage?: Storage;
}

export type CaptureOptions = EngineOptions;
export type CheckOptions = EngineOptions;

export async function findScreenshot(storage: Storage, projectPath: string, directory: string, label: string, viewport: string): Promise<string | undefined> {
  const files = await storage.listBinaries(projectPath, directory);
  const match = files.find(f =>
    f.endsWith('.png') && f.includes(`_${label}_`) && f.includes(`_${viewport}.png`)
  );
  return match || undefined;
}

export function resolveScenarios(opts: EngineOptions, config: EyelessConfig): ScenarioConfig[] {
  if (opts.label) {
    const configScenario = config.scenarios.find(s => s.label === opts.label);
    const base: ScenarioConfig = configScenario
      ? { ...configScenario }
      : { label: opts.label, url: opts.url || config.url };

    if (opts.url) base.url = opts.url;
    if (opts.interactions) base.interactions = opts.interactions;
    if (opts.waitFor) base.waitFor = opts.waitFor;

    return [base];
  }

  if (config.scenarios.length > 0) {
    return config.scenarios;
  }

  return [{ label: 'default', url: opts.url || config.url }];
}

export async function capture(opts: CaptureOptions): Promise<CaptureResult[]> {
  const projectPath = opts.project || process.cwd();
  const storage = opts.storage || getDefaultStorage();

  const config = await loadConfig(storage, projectPath);

  await storage.ensureDirectories(projectPath);

  const scenarios = resolveScenarios(opts, config);

  // Save current baselines as versions before overwriting
  for (const scenario of scenarios) {
    for (const vp of config.viewports) {
      await saveVersion(storage, projectPath, scenario.label, vp.label, config.maxVersions);
    }
  }

  const isSingleLabel = scenarios.length === 1 && (config.scenarios.length > 1 || scenarios[0].label !== 'default');

  // BackstopJS wipes bitmaps_reference on every reference run.
  // When capturing a single label, back up other scenarios' bitmaps
  // so they survive the wipe.
  let backedUpFiles: { name: string; data: Buffer }[] = [];
  if (isSingleLabel) {
    const label = scenarios[0].label;
    const existing = await storage.listBinaries(projectPath, 'baselines/bitmaps_reference');
    for (const file of existing) {
      if (file.endsWith('.png') && !file.includes(`_${label}_`)) {
        const data = await storage.getBinary(projectPath, `baselines/bitmaps_reference/${file}`);
        if (data) {
          backedUpFiles.push({ name: file, data });
        }
      }
    }
  }

  try {
    await runReference(config, projectPath, scenarios);
  } finally {
    // Restore backed-up bitmaps even if runReference throws
    if (backedUpFiles.length > 0) {
      for (const { name, data } of backedUpFiles) {
        await storage.putBinary(projectPath, `baselines/bitmaps_reference/${name}`, data);
      }
    }
  }

  const snapshotsDir = getSnapshotsDir(projectPath);
  const results: CaptureResult[] = [];

  for (const scenario of scenarios) {
    for (const vp of config.viewports) {
      const snapshotPath = getSnapshotPath(snapshotsDir, 'reference', scenario.label, vp.label);
      const snapshot = await storage.getSnapshot(projectPath, 'reference', scenario.label, vp.label);
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
  const storage = opts.storage || getDefaultStorage();

  const config = await loadConfig(storage, projectPath);

  await storage.ensureDirectories(projectPath);

  const scenarios = resolveScenarios(opts, config);

  const backstopResult = await runTest(config, projectPath, scenarios);
  const results: CheckResult[] = [];

  for (const scenario of scenarios) {
    const label = scenario.label;

    for (const vp of config.viewports) {
      const refSnapshot = await storage.getSnapshot(projectPath, 'reference', label, vp.label);
      const testSnapshot = await storage.getSnapshot(projectPath, 'test', label, vp.label);

      // Find screenshot image paths (relative to .eyeless/)
      const refImageFile = await findScreenshot(storage, projectPath, 'baselines/bitmaps_reference', label, vp.label);
      const testImageFile = await findScreenshot(storage, projectPath, 'bitmaps_test/eyeless', label, vp.label);

      const referenceImage = refImageFile ? `baselines/bitmaps_reference/${refImageFile}` : undefined;
      const testImage = testImageFile ? `bitmaps_test/eyeless/${testImageFile}` : undefined;

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
