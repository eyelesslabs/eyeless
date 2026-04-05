import * as fs from 'fs';
import * as path from 'path';
import { EyelessConfig, Viewport } from '../types';
import { BaselineEntry } from '../output';

const DEFAULT_VIEWPORTS: Viewport[] = [
  { label: 'desktop', width: 1920, height: 1080 },
];

const DEFAULT_CONFIG: EyelessConfig = {
  url: 'http://localhost:5173',
  viewports: DEFAULT_VIEWPORTS,
  threshold: 0.1,
  scenarios: [],
  ignore: [],
};

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

export function loadConfig(projectPath?: string): EyelessConfig {
  const configPath = getConfigPath(projectPath);

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const userConfig = JSON.parse(raw) as Partial<EyelessConfig>;

  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    viewports: userConfig.viewports || DEFAULT_VIEWPORTS,
  };
}

export function saveConfig(config: EyelessConfig, projectPath?: string): void {
  const eyelessDir = getEyelessDir(projectPath);

  if (!fs.existsSync(eyelessDir)) {
    fs.mkdirSync(eyelessDir, { recursive: true });
  }

  fs.writeFileSync(getConfigPath(projectPath), JSON.stringify(config, null, 2));
}

export function ensureDirectories(projectPath?: string): void {
  const dirs = [
    getEyelessDir(projectPath),
    getBaselinesDir(projectPath),
    getSnapshotsDir(projectPath),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function listBaselines(projectPath: string): BaselineEntry[] {
  const snapshotsDir = getSnapshotsDir(projectPath);
  const refDir = path.join(snapshotsDir, 'reference');
  const baselines: BaselineEntry[] = [];

  if (!fs.existsSync(refDir)) return baselines;

  const files = fs.readdirSync(refDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(path.join(refDir, file), 'utf-8'));
      const parts = file.replace('.json', '').split('_');
      const viewport = parts.pop() || 'desktop';
      const scenario = parts.join('_');

      baselines.push({
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

  return baselines;
}
