import * as path from 'path';
import * as fs from 'fs';

import { EyelessConfig, Viewport, ScenarioConfig, Interaction, WaitStrategy } from '../types';
import { getBaselinesDir, getSnapshotsDir, getEyelessDir } from '../config';

interface BackstopConfig {
  id: string;
  viewports: { label: string; width: number; height: number }[];
  scenarios: BackstopScenario[];
  paths: {
    bitmaps_reference: string;
    bitmaps_test: string;
    engine_scripts: string;
    html_report: string;
    ci_report: string;
  };
  engine: string;
  engineOptions: {
    args: string[];
  };
  report: string[];
  misMatchThreshold: number;
  asyncCaptureLimit: number;
  asyncCompareLimit: number;
  onReadyScript: string;
}

interface BackstopScenario {
  label: string;
  url: string;
  selectors: string[];
  readySelector?: string;
  delay?: number;
  misMatchThreshold?: number;
  clickSelectors?: string[];
  hoverSelectors?: string[];
  scrollToSelector?: string;
  keyPressSelectors?: { selector: string; keyPress: string }[];
  /** Custom: passed to onReadyScript for evaluate interactions and advanced waits */
  eyelessInteractions?: Interaction[];
  eyelessWaitFor?: WaitStrategy[];
}

function buildBackstopConfig(
  config: EyelessConfig,
  projectPath: string,
  scenarios?: ScenarioConfig[],
): BackstopConfig {
  const eyelessDir = getEyelessDir(projectPath);
  const baselinesDir = getBaselinesDir(projectPath);

  const backstopScenarios: BackstopScenario[] = (scenarios || config.scenarios).map((s) => {
    const scenario: BackstopScenario = {
      label: s.label,
      url: s.url || config.url,
      selectors: s.selectors || ['document'],
      readySelector: s.readySelector,
      delay: s.delay || 0,
      misMatchThreshold: config.threshold,
    };

    // All interactions are handled by onReadyScript for proper sequencing
    // with wait strategies. BackstopJS native click/hover/keyPress/scroll
    // run after onReadyScript, which breaks interaction→wait→capture order.
    if (s.interactions && s.interactions.length > 0) {
      scenario.eyelessInteractions = s.interactions;
    }

    // Pass wait strategies to onReadyScript
    if (s.waitFor && s.waitFor.length > 0) {
      scenario.eyelessWaitFor = s.waitFor;
    }

    return scenario;
  });

  if (backstopScenarios.length === 0) {
    backstopScenarios.push({
      label: 'default',
      url: config.url,
      selectors: ['document'],
      misMatchThreshold: config.threshold,
    });
  }

  return {
    id: 'eyeless',
    viewports: config.viewports.map((v) => ({
      label: v.label,
      width: v.width,
      height: v.height,
    })),
    scenarios: backstopScenarios,
    paths: {
      bitmaps_reference: path.join(baselinesDir, 'bitmaps_reference'),
      bitmaps_test: path.join(eyelessDir, 'bitmaps_test'),
      engine_scripts: path.join(__dirname, '..', 'attributor'),
      html_report: path.join(eyelessDir, 'html_report'),
      ci_report: path.join(eyelessDir, 'ci_report'),
    },
    engine: 'playwright',
    engineOptions: {
      args: [],
    },
    report: ['CI'],
    misMatchThreshold: config.threshold,
    asyncCaptureLimit: 5,
    asyncCompareLimit: 30,
    onReadyScript: 'on-ready-script.js',
  };
}

/**
 * Suppress BackstopJS console output in the main process.
 * Note: forked comparison workers may still write to stdout (the `See:` line
 * for failed diffs). This is a known limitation — BackstopJS forks workers
 * that inherit the parent's stdio, and Node.js doesn't support fd-level redirection.
 */
function suppressBackstopOutput(): () => void {
  const orig = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};

  return () => {
    console.log = orig.log;
    console.info = orig.info;
    console.warn = orig.warn;
    console.error = orig.error;
  };
}

export interface BackstopTestResult {
  pair: {
    label: string;
    viewportLabel: string;
    misMatchPercentage: string;
    diff?: {
      isSameDimensions: boolean;
      dimensionDifference: { width: number; height: number };
      rawMisMatchPercentage: number;
    };
  };
  status: 'pass' | 'fail';
}

export interface BackstopRunResult {
  tests: BackstopTestResult[];
}

export async function runReference(
  config: EyelessConfig,
  projectPath: string,
  scenarios?: ScenarioConfig[],
): Promise<void> {
  const backstopConfig = buildBackstopConfig(config, projectPath, scenarios);
  const snapshotsDir = getSnapshotsDir(projectPath);

  process.env.EYELESS_SNAPSHOT_DIR = snapshotsDir;

  const backstop = require('backstopjs');
  const restore = suppressBackstopOutput();
  try {
    await backstop('reference', { config: backstopConfig });
  } finally {
    restore();
  }
}

export async function runTest(
  config: EyelessConfig,
  projectPath: string,
  scenarios?: ScenarioConfig[],
): Promise<BackstopRunResult> {
  const backstopConfig = buildBackstopConfig(config, projectPath, scenarios);
  const snapshotsDir = getSnapshotsDir(projectPath);
  const eyelessDir = getEyelessDir(projectPath);

  process.env.EYELESS_SNAPSHOT_DIR = snapshotsDir;

  const backstop = require('backstopjs');
  const restore = suppressBackstopOutput();

  try {
    await backstop('test', { config: backstopConfig });
  } catch {
    // BackstopJS throws when tests fail — that's expected for drifts
  } finally {
    restore();
  }

  const jsonReportPath = path.join(eyelessDir, 'bitmaps_test', 'eyeless', 'report.json');

  const results: BackstopRunResult = { tests: [] };

  if (fs.existsSync(jsonReportPath)) {
    const report = JSON.parse(fs.readFileSync(jsonReportPath, 'utf-8'));
    if (report.tests) {
      results.tests = report.tests.map((t: any) => ({
        pair: {
          label: t.pair?.label || 'unknown',
          viewportLabel: t.pair?.viewportLabel || 'unknown',
          misMatchPercentage: t.pair?.diff?.rawMisMatchPercentage?.toString() || '0',
          diff: t.pair?.diff,
        },
        status: t.status === 'pass' ? 'pass' : 'fail',
      }));
    }
  }

  return results;
}
