import * as fs from 'fs';
import * as path from 'path';
import { EyelessConfig, StyleSnapshot, HistoryEntry, VersionEntry } from '../types';
import { Storage, SnapshotEntry } from './types';
import { sanitizeLabel } from '../attributor/styles';

const MAX_HISTORY_ENTRIES = 100;
const MAX_SNAPSHOT_ELEMENTS = 10000;

/**
 * File-system backed Storage implementation.
 *
 * All data is stored as JSON files under `{projectPath}/.eyeless/`.
 * Methods are async (returning Promises) to satisfy the Storage interface,
 * but internally use synchronous fs operations.
 */
export class FileStorage implements Storage {

  // --- Path helpers (private) ---

  private eyelessDir(projectPath: string): string {
    return path.join(projectPath, '.eyeless');
  }

  private configPath(projectPath: string): string {
    return path.join(this.eyelessDir(projectPath), 'config.json');
  }

  private snapshotsDir(projectPath: string): string {
    return path.join(this.eyelessDir(projectPath), 'snapshots');
  }

  private baselinesDir(projectPath: string): string {
    return path.join(this.eyelessDir(projectPath), 'baselines');
  }

  private historyPath(projectPath: string): string {
    return path.join(this.eyelessDir(projectPath), 'history.json');
  }

  private versionsDir(projectPath: string): string {
    return path.join(this.eyelessDir(projectPath), 'versions');
  }

  private snapshotFilePath(projectPath: string, type: 'reference' | 'test', scenario: string, viewport: string): string {
    const scenarioSafe = sanitizeLabel(scenario);
    const viewportSafe = sanitizeLabel(viewport);
    return path.join(this.snapshotsDir(projectPath), type, `${scenarioSafe}_${viewportSafe}.json`);
  }

  private versionDirPath(projectPath: string, scenario: string, viewport: string): string {
    const key = `${sanitizeLabel(scenario)}_${sanitizeLabel(viewport)}`;
    return path.join(this.versionsDir(projectPath), key);
  }

  // --- Config ---

  async getConfig(projectPath: string): Promise<EyelessConfig | null> {
    const configPath = this.configPath(projectPath);
    if (!fs.existsSync(configPath)) return null;
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw) as EyelessConfig;
    } catch {
      return null;
    }
  }

  async putConfig(projectPath: string, config: EyelessConfig): Promise<void> {
    const dir = this.eyelessDir(projectPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath(projectPath), JSON.stringify(config, null, 2));
  }

  // --- Snapshots ---

  async getSnapshot(projectPath: string, type: 'reference' | 'test', scenario: string, viewport: string): Promise<StyleSnapshot | null> {
    const filepath = this.snapshotFilePath(projectPath, type, scenario, viewport);
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

  async putSnapshot(projectPath: string, type: 'reference' | 'test', scenario: string, viewport: string, data: StyleSnapshot): Promise<void> {
    const filepath = this.snapshotFilePath(projectPath, type, scenario, viewport);
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  }

  async listSnapshots(projectPath: string, type: 'reference' | 'test'): Promise<SnapshotEntry[]> {
    const dir = path.join(this.snapshotsDir(projectPath), type);
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const entries: SnapshotEntry[] = [];

    for (const file of files) {
      try {
        const snapshot = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        const parts = file.replace('.json', '').split('_');
        const viewport = parts.pop() || 'desktop';
        const scenario = parts.join('_');

        entries.push({
          scenario,
          viewport,
          elementCount: Array.isArray(snapshot.elements) ? snapshot.elements.length : 0,
          timestamp: typeof snapshot.timestamp === 'string' ? snapshot.timestamp : '',
          url: typeof snapshot.url === 'string' ? snapshot.url : '',
        });
      } catch {
        // Skip malformed snapshot files
      }
    }

    return entries;
  }

  async deleteSnapshot(projectPath: string, type: 'reference' | 'test', scenario: string, viewport: string): Promise<void> {
    const filepath = this.snapshotFilePath(projectPath, type, scenario, viewport);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  }

  // --- History ---

  async getHistory(projectPath: string): Promise<HistoryEntry[]> {
    const historyPath = this.historyPath(projectPath);
    if (!fs.existsSync(historyPath)) return [];
    try {
      const raw = fs.readFileSync(historyPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async appendHistory(projectPath: string, entry: HistoryEntry): Promise<void> {
    const history = await this.getHistory(projectPath);
    history.push(entry);

    while (history.length > MAX_HISTORY_ENTRIES) {
      history.shift();
    }

    const historyPath = this.historyPath(projectPath);
    const dir = path.dirname(historyPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  }

  async getHistoryEntry(projectPath: string, id: string): Promise<HistoryEntry | null> {
    const index = parseInt(id, 10);
    if (isNaN(index) || index < 0) return null;

    const history = await this.getHistory(projectPath);
    if (index >= history.length) return null;
    return history[index];
  }

  // --- Versions ---

  async listVersions(projectPath: string, scenario: string, viewport: string): Promise<VersionEntry[]> {
    const versionDir = this.versionDirPath(projectPath, scenario, viewport);
    if (!fs.existsSync(versionDir)) return [];

    const files = fs.readdirSync(versionDir).filter(f => f.endsWith('.json'));
    files.sort(); // ISO timestamps sort lexicographically

    return files.map(f => {
      const snapshotPath = path.join(versionDir, f);
      const pngFile = f.replace('.json', '.png');
      const bitmapPath = fs.existsSync(path.join(versionDir, pngFile))
        ? path.join(versionDir, pngFile)
        : undefined;

      return {
        timestamp: f.replace('.json', ''),
        scenario,
        viewport,
        snapshotPath,
        bitmapPath,
      };
    });
  }

  async getVersion(projectPath: string, scenario: string, viewport: string, timestamp: string): Promise<StyleSnapshot | null> {
    const versionDir = this.versionDirPath(projectPath, scenario, viewport);
    const safeTimestamp = timestamp.replace(/[^a-zA-Z0-9\-T.Z]/g, '');
    const filepath = path.join(versionDir, `${safeTimestamp}.json`);
    if (!fs.existsSync(filepath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8')) as StyleSnapshot;
    } catch {
      return null;
    }
  }

  async putVersion(projectPath: string, scenario: string, viewport: string, timestamp: string, data: StyleSnapshot): Promise<void> {
    const versionDir = this.versionDirPath(projectPath, scenario, viewport);
    if (!fs.existsSync(versionDir)) {
      fs.mkdirSync(versionDir, { recursive: true });
    }
    const safeTimestamp = timestamp.replace(/[^a-zA-Z0-9\-T.Z]/g, '');
    fs.writeFileSync(path.join(versionDir, `${safeTimestamp}.json`), JSON.stringify(data, null, 2));
  }

  async pruneVersions(projectPath: string, scenario: string, viewport: string, maxVersions: number): Promise<void> {
    const versionDir = this.versionDirPath(projectPath, scenario, viewport);
    if (!fs.existsSync(versionDir)) return;

    const files = fs.readdirSync(versionDir).filter(f => f.endsWith('.json'));
    files.sort();

    while (files.length > maxVersions) {
      const oldest = files.shift()!;
      const jsonPath = path.join(versionDir, oldest);
      const pngPath = jsonPath.replace(/\.json$/, '.png');
      if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
      if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
    }
  }

  // --- Binary files ---

  private assertWithinEyeless(projectPath: string, fullPath: string): void {
    const base = this.eyelessDir(projectPath);
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
      throw new Error('Path traversal blocked');
    }
  }

  async getBinary(projectPath: string, relativePath: string): Promise<Buffer | null> {
    const fullPath = path.join(this.eyelessDir(projectPath), relativePath);
    this.assertWithinEyeless(projectPath, fullPath);
    if (!fs.existsSync(fullPath)) return null;
    try {
      return fs.readFileSync(fullPath);
    } catch {
      return null;
    }
  }

  async putBinary(projectPath: string, relativePath: string, data: Buffer): Promise<void> {
    const fullPath = path.join(this.eyelessDir(projectPath), relativePath);
    this.assertWithinEyeless(projectPath, fullPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, data);
  }

  async listBinaries(projectPath: string, directory: string): Promise<string[]> {
    const dir = path.join(this.eyelessDir(projectPath), directory);
    this.assertWithinEyeless(projectPath, dir);
    if (!fs.existsSync(dir)) return [];
    try {
      return fs.readdirSync(dir).filter(f => {
        const fullPath = path.join(dir, f);
        return fs.statSync(fullPath).isFile();
      });
    } catch {
      return [];
    }
  }

  async deleteBinary(projectPath: string, relativePath: string): Promise<void> {
    const fullPath = path.join(this.eyelessDir(projectPath), relativePath);
    this.assertWithinEyeless(projectPath, fullPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  // --- Initialization ---

  async ensureDirectories(projectPath: string): Promise<void> {
    const dirs = [
      this.eyelessDir(projectPath),
      this.baselinesDir(projectPath),
      this.snapshotsDir(projectPath),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
}
