import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getProjectRoot,
  getEyelessDir,
  getConfigPath,
  getBaselinesDir,
  getSnapshotsDir,
  loadConfig,
} from './index';
import { FileStorage } from '../storage/file-storage';

let tmpDir: string;
let storage: FileStorage;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeless-config-test-'));
  storage = new FileStorage();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('path utilities', () => {
  it('getProjectRoot returns cwd when no arg', () => {
    assert.equal(getProjectRoot(), process.cwd());
  });

  it('getProjectRoot returns provided path', () => {
    assert.equal(getProjectRoot('/custom/path'), '/custom/path');
  });

  it('getEyelessDir appends .eyeless', () => {
    assert.equal(getEyelessDir('/project'), path.join('/project', '.eyeless'));
  });

  it('getConfigPath appends config.json', () => {
    assert.equal(getConfigPath('/project'), path.join('/project', '.eyeless', 'config.json'));
  });

  it('getBaselinesDir appends baselines', () => {
    assert.equal(getBaselinesDir('/project'), path.join('/project', '.eyeless', 'baselines'));
  });

  it('getSnapshotsDir appends snapshots', () => {
    assert.equal(getSnapshotsDir('/project'), path.join('/project', '.eyeless', 'snapshots'));
  });
});

describe('loadConfig', () => {
  it('returns defaults when no config file exists', async () => {
    const config = await loadConfig(storage, tmpDir);
    assert.equal(config.url, 'http://localhost:5173');
    assert.equal(config.threshold, 0.1);
    assert.equal(config.viewports.length, 1);
    assert.equal(config.viewports[0].label, 'desktop');
    assert.deepEqual(config.scenarios, []);
    assert.deepEqual(config.ignore, []);
  });

  it('merges user config with defaults', async () => {
    const eyelessDir = path.join(tmpDir, '.eyeless');
    fs.mkdirSync(eyelessDir, { recursive: true });
    fs.writeFileSync(
      path.join(eyelessDir, 'config.json'),
      JSON.stringify({ url: 'http://example.com', threshold: 0.5 }),
    );

    const config = await loadConfig(storage, tmpDir);
    assert.equal(config.url, 'http://example.com');
    assert.equal(config.threshold, 0.5);
    // Viewports should fall back to defaults when not specified
    assert.equal(config.viewports.length, 1);
    assert.equal(config.viewports[0].label, 'desktop');
  });

  it('uses user-provided viewports when specified', async () => {
    const eyelessDir = path.join(tmpDir, '.eyeless');
    fs.mkdirSync(eyelessDir, { recursive: true });
    fs.writeFileSync(
      path.join(eyelessDir, 'config.json'),
      JSON.stringify({
        url: 'http://example.com',
        viewports: [{ label: 'mobile', width: 375, height: 812 }],
      }),
    );

    const config = await loadConfig(storage, tmpDir);
    assert.equal(config.viewports.length, 1);
    assert.equal(config.viewports[0].label, 'mobile');
  });
});

describe('putConfig (via storage)', () => {
  it('creates .eyeless dir and writes config file', async () => {
    const config = {
      url: 'http://test.com',
      viewports: [{ label: 'tablet', width: 768, height: 1024 }],
      threshold: 0.2,
      scenarios: [],
      ignore: [{ selector: '.ad', reason: 'Dynamic ad content' }],
    };

    await storage.putConfig(tmpDir, config);

    const configPath = path.join(tmpDir, '.eyeless', 'config.json');
    assert.ok(fs.existsSync(configPath));

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(saved.url, 'http://test.com');
    assert.equal(saved.threshold, 0.2);
    assert.equal(saved.viewports[0].label, 'tablet');
    assert.equal(saved.ignore[0].selector, '.ad');
  });
});

describe('ensureDirectories (via storage)', () => {
  it('creates all three directories', async () => {
    await storage.ensureDirectories(tmpDir);

    assert.ok(fs.existsSync(path.join(tmpDir, '.eyeless')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.eyeless', 'baselines')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.eyeless', 'snapshots')));
  });

  it('is idempotent', async () => {
    await storage.ensureDirectories(tmpDir);
    await storage.ensureDirectories(tmpDir);
    assert.ok(fs.existsSync(path.join(tmpDir, '.eyeless')));
  });
});

describe('listSnapshots (via storage)', () => {
  it('returns empty array when no snapshots directory exists', async () => {
    const result = await storage.listSnapshots(tmpDir, 'reference');
    assert.deepEqual(result, []);
  });

  it('returns empty array when reference directory is empty', async () => {
    const refDir = path.join(tmpDir, '.eyeless', 'snapshots', 'reference');
    fs.mkdirSync(refDir, { recursive: true });
    const result = await storage.listSnapshots(tmpDir, 'reference');
    assert.deepEqual(result, []);
  });

  it('parses snapshot files into baseline entries', async () => {
    const refDir = path.join(tmpDir, '.eyeless', 'snapshots', 'reference');
    fs.mkdirSync(refDir, { recursive: true });

    fs.writeFileSync(path.join(refDir, 'homepage_desktop.json'), JSON.stringify({
      url: 'http://example.com',
      timestamp: '2026-01-01T00:00:00Z',
      elements: [{ selector: '.box' }, { selector: '.title' }],
    }));

    const result = await storage.listSnapshots(tmpDir, 'reference');
    assert.equal(result.length, 1);
    assert.equal(result[0].scenario, 'homepage');
    assert.equal(result[0].viewport, 'desktop');
    assert.equal(result[0].elementCount, 2);
    assert.equal(result[0].timestamp, '2026-01-01T00:00:00Z');
    assert.equal(result[0].url, 'http://example.com');
  });

  it('handles multi-segment scenario names (underscores in label)', async () => {
    const refDir = path.join(tmpDir, '.eyeless', 'snapshots', 'reference');
    fs.mkdirSync(refDir, { recursive: true });

    fs.writeFileSync(path.join(refDir, 'panel-open_desktop.json'), JSON.stringify({
      url: 'http://example.com',
      timestamp: '2026-01-02T00:00:00Z',
      elements: [],
    }));

    const result = await storage.listSnapshots(tmpDir, 'reference');
    assert.equal(result.length, 1);
    assert.equal(result[0].scenario, 'panel-open');
    assert.equal(result[0].viewport, 'desktop');
  });

  it('skips malformed JSON files gracefully', async () => {
    const refDir = path.join(tmpDir, '.eyeless', 'snapshots', 'reference');
    fs.mkdirSync(refDir, { recursive: true });

    fs.writeFileSync(path.join(refDir, 'valid_desktop.json'), JSON.stringify({
      url: 'http://example.com',
      timestamp: '2026-01-01T00:00:00Z',
      elements: [{ selector: '.a' }],
    }));
    fs.writeFileSync(path.join(refDir, 'broken_desktop.json'), 'not valid json{{{');

    const result = await storage.listSnapshots(tmpDir, 'reference');
    assert.equal(result.length, 1);
    assert.equal(result[0].scenario, 'valid');
  });

  it('skips non-JSON files', async () => {
    const refDir = path.join(tmpDir, '.eyeless', 'snapshots', 'reference');
    fs.mkdirSync(refDir, { recursive: true });

    fs.writeFileSync(path.join(refDir, 'homepage_desktop.json'), JSON.stringify({
      url: 'http://example.com',
      timestamp: '2026-01-01T00:00:00Z',
      elements: [],
    }));
    fs.writeFileSync(path.join(refDir, 'homepage_desktop.png'), 'binary data');

    const result = await storage.listSnapshots(tmpDir, 'reference');
    assert.equal(result.length, 1);
  });

  it('defaults missing fields to safe values', async () => {
    const refDir = path.join(tmpDir, '.eyeless', 'snapshots', 'reference');
    fs.mkdirSync(refDir, { recursive: true });

    fs.writeFileSync(path.join(refDir, 'minimal_desktop.json'), JSON.stringify({}));

    const result = await storage.listSnapshots(tmpDir, 'reference');
    assert.equal(result.length, 1);
    assert.equal(result[0].elementCount, 0);
    assert.equal(result[0].timestamp, '');
    assert.equal(result[0].url, '');
  });
});
