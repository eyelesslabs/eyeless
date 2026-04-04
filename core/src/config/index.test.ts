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
  saveConfig,
  ensureDirectories,
} from './index';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeless-config-test-'));
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
  it('returns defaults when no config file exists', () => {
    const config = loadConfig(tmpDir);
    assert.equal(config.url, 'http://localhost:5173');
    assert.equal(config.threshold, 0.1);
    assert.equal(config.viewports.length, 1);
    assert.equal(config.viewports[0].label, 'desktop');
    assert.deepEqual(config.scenarios, []);
    assert.deepEqual(config.ignore, []);
  });

  it('merges user config with defaults', () => {
    const eyelessDir = path.join(tmpDir, '.eyeless');
    fs.mkdirSync(eyelessDir, { recursive: true });
    fs.writeFileSync(
      path.join(eyelessDir, 'config.json'),
      JSON.stringify({ url: 'http://example.com', threshold: 0.5 }),
    );

    const config = loadConfig(tmpDir);
    assert.equal(config.url, 'http://example.com');
    assert.equal(config.threshold, 0.5);
    // Viewports should fall back to defaults when not specified
    assert.equal(config.viewports.length, 1);
    assert.equal(config.viewports[0].label, 'desktop');
  });

  it('uses user-provided viewports when specified', () => {
    const eyelessDir = path.join(tmpDir, '.eyeless');
    fs.mkdirSync(eyelessDir, { recursive: true });
    fs.writeFileSync(
      path.join(eyelessDir, 'config.json'),
      JSON.stringify({
        url: 'http://example.com',
        viewports: [{ label: 'mobile', width: 375, height: 812 }],
      }),
    );

    const config = loadConfig(tmpDir);
    assert.equal(config.viewports.length, 1);
    assert.equal(config.viewports[0].label, 'mobile');
  });
});

describe('saveConfig', () => {
  it('creates .eyeless dir and writes config file', () => {
    const config = {
      url: 'http://test.com',
      viewports: [{ label: 'tablet', width: 768, height: 1024 }],
      threshold: 0.2,
      scenarios: [],
      ignore: [{ selector: '.ad', reason: 'Dynamic ad content' }],
    };

    saveConfig(config, tmpDir);

    const configPath = path.join(tmpDir, '.eyeless', 'config.json');
    assert.ok(fs.existsSync(configPath));

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(saved.url, 'http://test.com');
    assert.equal(saved.threshold, 0.2);
    assert.equal(saved.viewports[0].label, 'tablet');
    assert.equal(saved.ignore[0].selector, '.ad');
  });
});

describe('ensureDirectories', () => {
  it('creates all three directories', () => {
    ensureDirectories(tmpDir);

    assert.ok(fs.existsSync(path.join(tmpDir, '.eyeless')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.eyeless', 'baselines')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.eyeless', 'snapshots')));
  });

  it('is idempotent', () => {
    ensureDirectories(tmpDir);
    ensureDirectories(tmpDir);
    assert.ok(fs.existsSync(path.join(tmpDir, '.eyeless')));
  });
});
