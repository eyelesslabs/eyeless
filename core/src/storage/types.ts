import { EyelessConfig, StyleSnapshot, HistoryEntry, VersionEntry } from '../types';

/** Summary of a stored snapshot (returned by listSnapshots) */
export interface SnapshotEntry {
  scenario: string;
  viewport: string;
  elementCount: number;
  timestamp: string;
  url: string;
}

/**
 * Storage adapter interface for all Eyeless data I/O.
 *
 * All methods are async to support both synchronous file storage (FileStorage)
 * and async database storage (DrizzleStorage in Phase 3).
 *
 * `projectPath` is always the first argument — the storage adapter doesn't
 * own the project path, it's passed per-call.
 */
export interface Storage {
  // --- Config ---
  getConfig(projectPath: string): Promise<EyelessConfig | null>;
  putConfig(projectPath: string, config: EyelessConfig): Promise<void>;

  // --- Snapshots (style baselines) ---
  getSnapshot(projectPath: string, type: 'reference' | 'test', scenario: string, viewport: string): Promise<StyleSnapshot | null>;
  putSnapshot(projectPath: string, type: 'reference' | 'test', scenario: string, viewport: string, data: StyleSnapshot): Promise<void>;
  listSnapshots(projectPath: string, type: 'reference' | 'test'): Promise<SnapshotEntry[]>;
  deleteSnapshot(projectPath: string, type: 'reference' | 'test', scenario: string, viewport: string): Promise<void>;

  // --- History ---
  getHistory(projectPath: string): Promise<HistoryEntry[]>;
  appendHistory(projectPath: string, entry: HistoryEntry): Promise<void>;
  getHistoryEntry(projectPath: string, id: string): Promise<HistoryEntry | null>;

  // --- Versions (baseline versioning) ---
  listVersions(projectPath: string, scenario: string, viewport: string): Promise<VersionEntry[]>;
  getVersion(projectPath: string, scenario: string, viewport: string, timestamp: string): Promise<StyleSnapshot | null>;
  putVersion(projectPath: string, scenario: string, viewport: string, timestamp: string, data: StyleSnapshot): Promise<void>;
  pruneVersions(projectPath: string, scenario: string, viewport: string, maxVersions: number): Promise<void>;

  // --- Binary files (screenshots/bitmaps) ---
  getBinary(projectPath: string, relativePath: string): Promise<Buffer | null>;
  putBinary(projectPath: string, relativePath: string, data: Buffer): Promise<void>;
  listBinaries(projectPath: string, directory: string): Promise<string[]>;
  deleteBinary(projectPath: string, relativePath: string): Promise<void>;

  // --- Initialization ---
  ensureDirectories(projectPath: string): Promise<void>;
}
