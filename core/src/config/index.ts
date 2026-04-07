import * as path from 'path';
import { EyelessConfig, Viewport, StyleSnapshot, VersionEntry } from '../types';
import { Storage } from '../storage/types';
import { sanitizeLabel } from '../attributor/styles';

export const DEFAULT_VIEWPORTS: Viewport[] = [
  { label: 'desktop', width: 1920, height: 1080 },
];

export const DEFAULT_CONFIG: EyelessConfig = {
  url: 'http://localhost:5173',
  viewports: DEFAULT_VIEWPORTS,
  threshold: 0.1,
  scenarios: [],
  ignore: [],
};

export const MAX_HISTORY_ENTRIES = 100;
export const DEFAULT_MAX_VERSIONS = 20;

// --- Path helpers (pure functions, no I/O) ---

export function getProjectRoot(projectPath?: string): string {
  return projectPath || process.cwd();
}

export function getEyelessDir(projectPath?: string): string {
  return path.join(getProjectRoot(projectPath), '.eyeless');
}

export function getConfigPath(projectPath?: string): string {
  return path.join(getEyelessDir(projectPath), 'config.json');
}

export function getBaselinesDir(projectPath?: string): string {
  return path.join(getEyelessDir(projectPath), 'baselines');
}

export function getSnapshotsDir(projectPath?: string): string {
  return path.join(getEyelessDir(projectPath), 'snapshots');
}

export function getHistoryPath(projectPath?: string): string {
  return path.join(getEyelessDir(projectPath), 'history.json');
}

export function getVersionsDir(projectPath?: string): string {
  return path.join(getEyelessDir(projectPath), 'versions');
}

// --- Config loading (merges raw config with defaults) ---

/**
 * Load project config from storage, merging with defaults.
 * Returns a complete EyelessConfig with all fields populated.
 */
export async function loadConfig(storage: Storage, projectPath: string): Promise<EyelessConfig> {
  const userConfig = await storage.getConfig(projectPath);
  if (!userConfig) return { ...DEFAULT_CONFIG };
  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    viewports: userConfig.viewports || DEFAULT_VIEWPORTS,
  };
}

// --- Composition helpers (multi-step operations on Storage) ---

/**
 * Save the current reference snapshot (and optional bitmap) as a version backup.
 * Called before capture overwrites the reference.
 */
export async function saveVersion(
  storage: Storage,
  projectPath: string,
  scenario: string,
  viewport: string,
  maxVersions?: number,
): Promise<void> {
  const cap = maxVersions ?? DEFAULT_MAX_VERSIONS;

  // Read current reference snapshot
  const currentSnapshot = await storage.getSnapshot(projectPath, 'reference', scenario, viewport);
  if (!currentSnapshot) return; // Nothing to version

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Save snapshot as version
  await storage.putVersion(projectPath, scenario, viewport, timestamp, currentSnapshot);

  // Save bitmap if it exists
  const bitmapFiles = await storage.listBinaries(projectPath, 'baselines/bitmaps_reference');
  const bitmapFile = bitmapFiles.find(f =>
    f.endsWith('.png') && f.includes(`_${scenario}_`) && f.includes(`_${viewport}.png`)
  );
  if (bitmapFile) {
    const bitmapData = await storage.getBinary(projectPath, `baselines/bitmaps_reference/${bitmapFile}`);
    if (bitmapData) {
      const key = `${sanitizeLabel(scenario)}_${sanitizeLabel(viewport)}`;
      await storage.putBinary(projectPath, `versions/${key}/${timestamp}.png`, bitmapData);
    }
  }

  // Prune old versions
  await storage.pruneVersions(projectPath, scenario, viewport, cap);
}

/**
 * Restore a previous version as the current reference baseline.
 * Returns true if the version was found and restored, false otherwise.
 */
export async function restoreVersion(
  storage: Storage,
  projectPath: string,
  scenario: string,
  viewport: string,
  versionTimestamp: string,
): Promise<boolean> {
  // Read the version snapshot
  const snapshot = await storage.getVersion(projectPath, scenario, viewport, versionTimestamp);
  if (!snapshot) return false;

  // Restore snapshot as current reference
  await storage.putSnapshot(projectPath, 'reference', scenario, viewport, snapshot);

  // Restore bitmap if the version has one
  const key = `${sanitizeLabel(scenario)}_${sanitizeLabel(viewport)}`;
  const safeTimestamp = versionTimestamp.replace(/[^a-zA-Z0-9\-T.Z]/g, '');
  const versionBitmapData = await storage.getBinary(projectPath, `versions/${key}/${safeTimestamp}.png`);

  if (versionBitmapData) {
    // Remove existing bitmaps for this scenario/viewport
    const existingBitmaps = await storage.listBinaries(projectPath, 'baselines/bitmaps_reference');
    for (const old of existingBitmaps) {
      if (old.endsWith('.png') && old.includes(`_${scenario}_`) && old.includes(`_${viewport}.png`)) {
        await storage.deleteBinary(projectPath, `baselines/bitmaps_reference/${old}`);
      }
    }

    // Copy version bitmap with a standard name
    await storage.putBinary(
      projectPath,
      `baselines/bitmaps_reference/eyeless_${scenario}_0_document_0_${viewport}.png`,
      versionBitmapData,
    );
  }

  return true;
}
