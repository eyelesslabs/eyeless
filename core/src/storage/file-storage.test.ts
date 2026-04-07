import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileStorage } from './file-storage';
import { EyelessConfig, StyleSnapshot, HistoryEntry } from '../types';

let tmpDir: string;
let storage: FileStorage;

const testConfig: EyelessConfig = {
  url: 'http://localhost:3000',
  viewports: [{ label: 'desktop', width: 1920, height: 1080 }],
  threshold: 0.1,
  scenarios: [],
  ignore: [],
};

const testSnapshot: StyleSnapshot = {
  url: 'http://localhost:3000',
  viewport: { label: 'desktop', width: 1920, height: 1080 },
  timestamp: '2026-01-01T00:00:00Z',
  elements: [
    {
      selector: '.box',
      tagName: 'div',
      boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      computedStyles: { color: 'red' },
    },
  ],
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeless-storage-test-'));
  storage = new FileStorage();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- Config ---

describe('FileStorage: config', () => {
  it('getConfig returns null for nonexistent project', async () => {
    const config = await storage.getConfig(tmpDir);
    assert.equal(config, null);
  });

  it('putConfig + getConfig roundtrips correctly', async () => {
    await storage.putConfig(tmpDir, testConfig);
    const loaded = await storage.getConfig(tmpDir);
    assert.deepEqual(loaded, testConfig);
  });

  it('putConfig creates .eyeless directory if missing', async () => {
    await storage.putConfig(tmpDir, testConfig);
    assert.ok(fs.existsSync(path.join(tmpDir, '.eyeless', 'config.json')));
  });
});

// --- Snapshots ---

describe('FileStorage: snapshots', () => {
  it('getSnapshot returns null for nonexistent snapshot', async () => {
    const snapshot = await storage.getSnapshot(tmpDir, 'reference', 'homepage', 'desktop');
    assert.equal(snapshot, null);
  });

  it('putSnapshot + getSnapshot roundtrips correctly', async () => {
    await storage.putSnapshot(tmpDir, 'reference', 'homepage', 'desktop', testSnapshot);
    const loaded = await storage.getSnapshot(tmpDir, 'reference', 'homepage', 'desktop');
    assert.deepEqual(loaded, testSnapshot);
  });

  it('putSnapshot creates snapshot directory if missing', async () => {
    await storage.putSnapshot(tmpDir, 'test', 'page', 'mobile', testSnapshot);
    const refDir = path.join(tmpDir, '.eyeless', 'snapshots', 'test');
    assert.ok(fs.existsSync(refDir));
  });

  it('listSnapshots returns correct entries', async () => {
    await storage.putSnapshot(tmpDir, 'reference', 'homepage', 'desktop', testSnapshot);
    const second: StyleSnapshot = {
      ...testSnapshot,
      url: 'http://localhost:3000/about',
      timestamp: '2026-01-02T00:00:00Z',
    };
    await storage.putSnapshot(tmpDir, 'reference', 'about', 'mobile', second);

    const entries = await storage.listSnapshots(tmpDir, 'reference');
    assert.equal(entries.length, 2);

    const homepageEntry = entries.find(e => e.scenario === 'homepage');
    assert.ok(homepageEntry);
    assert.equal(homepageEntry.viewport, 'desktop');
    assert.equal(homepageEntry.elementCount, 1);
    assert.equal(homepageEntry.url, 'http://localhost:3000');

    const aboutEntry = entries.find(e => e.scenario === 'about');
    assert.ok(aboutEntry);
    assert.equal(aboutEntry.viewport, 'mobile');
  });

  it('listSnapshots returns empty array when no snapshots', async () => {
    const entries = await storage.listSnapshots(tmpDir, 'reference');
    assert.deepEqual(entries, []);
  });

  it('listSnapshots skips malformed JSON', async () => {
    const refDir = path.join(tmpDir, '.eyeless', 'snapshots', 'reference');
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(path.join(refDir, 'valid_desktop.json'), JSON.stringify(testSnapshot));
    fs.writeFileSync(path.join(refDir, 'broken_desktop.json'), 'not valid json{{{');

    const entries = await storage.listSnapshots(tmpDir, 'reference');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].scenario, 'valid');
  });

  it('deleteSnapshot removes the file', async () => {
    await storage.putSnapshot(tmpDir, 'reference', 'homepage', 'desktop', testSnapshot);
    await storage.deleteSnapshot(tmpDir, 'reference', 'homepage', 'desktop');
    const loaded = await storage.getSnapshot(tmpDir, 'reference', 'homepage', 'desktop');
    assert.equal(loaded, null);
  });

  it('deleteSnapshot is a no-op for nonexistent snapshot', async () => {
    // Should not throw
    await storage.deleteSnapshot(tmpDir, 'reference', 'nonexistent', 'desktop');
  });

  it('getSnapshot caps elements at 10000', async () => {
    const bigSnapshot: StyleSnapshot = {
      ...testSnapshot,
      elements: Array.from({ length: 10005 }, (_, i) => ({
        selector: `.el-${i}`,
        tagName: 'div',
        boundingBox: { x: 0, y: 0, width: 1, height: 1 },
        computedStyles: {},
      })),
    };
    await storage.putSnapshot(tmpDir, 'reference', 'big', 'desktop', bigSnapshot);
    const loaded = await storage.getSnapshot(tmpDir, 'reference', 'big', 'desktop');
    assert.ok(loaded);
    assert.equal(loaded.elements.length, 10000);
  });
});

// --- History ---

describe('FileStorage: history', () => {
  it('getHistory returns empty array for new project', async () => {
    const history = await storage.getHistory(tmpDir);
    assert.deepEqual(history, []);
  });

  it('appendHistory + getHistory roundtrips correctly', async () => {
    const entry: HistoryEntry = {
      timestamp: '2026-01-01T00:00:00Z',
      results: [{
        status: 'pass',
        matchPercentage: 100,
        scenario: 'homepage',
        viewport: 'desktop',
        drifts: [],
        summary: 'all good',
      }],
    };
    await storage.appendHistory(tmpDir, entry);
    const history = await storage.getHistory(tmpDir);
    assert.equal(history.length, 1);
    assert.deepEqual(history[0], entry);
  });

  it('appendHistory caps at 100 entries', async () => {
    for (let i = 0; i < 105; i++) {
      await storage.appendHistory(tmpDir, {
        timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
        results: [],
      });
    }
    const history = await storage.getHistory(tmpDir);
    assert.equal(history.length, 100);
    // Oldest entries were pruned — first remaining should be entry #5
    assert.equal(history[0].timestamp, '2026-01-01T00:00:05Z');
  });

  it('getHistoryEntry returns correct entry by ID', async () => {
    const entries: HistoryEntry[] = [
      { timestamp: '2026-01-01T00:00:00Z', results: [] },
      { timestamp: '2026-01-02T00:00:00Z', results: [] },
      { timestamp: '2026-01-03T00:00:00Z', results: [] },
    ];
    for (const e of entries) await storage.appendHistory(tmpDir, e);

    const entry = await storage.getHistoryEntry(tmpDir, '1');
    assert.ok(entry);
    assert.equal(entry.timestamp, '2026-01-02T00:00:00Z');
  });

  it('getHistoryEntry returns null for invalid ID', async () => {
    await storage.appendHistory(tmpDir, { timestamp: '2026-01-01T00:00:00Z', results: [] });
    assert.equal(await storage.getHistoryEntry(tmpDir, '99'), null);
    assert.equal(await storage.getHistoryEntry(tmpDir, '-1'), null);
    assert.equal(await storage.getHistoryEntry(tmpDir, 'abc'), null);
  });
});

// --- Versions ---

describe('FileStorage: versions', () => {
  it('listVersions returns empty array when none exist', async () => {
    const versions = await storage.listVersions(tmpDir, 'homepage', 'desktop');
    assert.deepEqual(versions, []);
  });

  it('putVersion + getVersion roundtrips', async () => {
    const ts = '2026-01-01T00-00-00-000Z';
    await storage.putVersion(tmpDir, 'homepage', 'desktop', ts, testSnapshot);
    const loaded = await storage.getVersion(tmpDir, 'homepage', 'desktop', ts);
    assert.deepEqual(loaded, testSnapshot);
  });

  it('listVersions returns sorted entries', async () => {
    await storage.putVersion(tmpDir, 'homepage', 'desktop', '2026-01-03T00-00-00-000Z', testSnapshot);
    await storage.putVersion(tmpDir, 'homepage', 'desktop', '2026-01-01T00-00-00-000Z', testSnapshot);
    await storage.putVersion(tmpDir, 'homepage', 'desktop', '2026-01-02T00-00-00-000Z', testSnapshot);

    const versions = await storage.listVersions(tmpDir, 'homepage', 'desktop');
    assert.equal(versions.length, 3);
    assert.equal(versions[0].timestamp, '2026-01-01T00-00-00-000Z');
    assert.equal(versions[1].timestamp, '2026-01-02T00-00-00-000Z');
    assert.equal(versions[2].timestamp, '2026-01-03T00-00-00-000Z');
  });

  it('listVersions detects bitmap presence', async () => {
    const ts = '2026-01-01T00-00-00-000Z';
    await storage.putVersion(tmpDir, 'homepage', 'desktop', ts, testSnapshot);
    // Put a bitmap alongside
    const versionDir = path.join(tmpDir, '.eyeless', 'versions', 'homepage_desktop');
    fs.writeFileSync(path.join(versionDir, `${ts}.png`), 'fake-png');

    const versions = await storage.listVersions(tmpDir, 'homepage', 'desktop');
    assert.equal(versions.length, 1);
    assert.ok(versions[0].bitmapPath);
  });

  it('getVersion returns null for nonexistent version', async () => {
    const loaded = await storage.getVersion(tmpDir, 'homepage', 'desktop', '2026-01-01T00-00-00-000Z');
    assert.equal(loaded, null);
  });

  it('pruneVersions removes oldest beyond max', async () => {
    for (let i = 1; i <= 5; i++) {
      const ts = `2026-01-0${i}T00-00-00-000Z`;
      await storage.putVersion(tmpDir, 'homepage', 'desktop', ts, testSnapshot);
    }

    await storage.pruneVersions(tmpDir, 'homepage', 'desktop', 3);
    const versions = await storage.listVersions(tmpDir, 'homepage', 'desktop');
    assert.equal(versions.length, 3);
    // Oldest two (01, 02) should be pruned
    assert.equal(versions[0].timestamp, '2026-01-03T00-00-00-000Z');
  });

  it('pruneVersions also removes associated bitmaps', async () => {
    for (let i = 1; i <= 3; i++) {
      const ts = `2026-01-0${i}T00-00-00-000Z`;
      await storage.putVersion(tmpDir, 'homepage', 'desktop', ts, testSnapshot);
      const versionDir = path.join(tmpDir, '.eyeless', 'versions', 'homepage_desktop');
      fs.writeFileSync(path.join(versionDir, `${ts}.png`), 'fake-png');
    }

    await storage.pruneVersions(tmpDir, 'homepage', 'desktop', 1);
    const versionDir = path.join(tmpDir, '.eyeless', 'versions', 'homepage_desktop');
    const remaining = fs.readdirSync(versionDir);
    // Should have 1 json + 1 png = 2 files
    assert.equal(remaining.length, 2);
    assert.ok(remaining.some(f => f.endsWith('.json')));
    assert.ok(remaining.some(f => f.endsWith('.png')));
  });

  it('pruneVersions is a no-op when under max', async () => {
    await storage.putVersion(tmpDir, 'homepage', 'desktop', '2026-01-01T00-00-00-000Z', testSnapshot);
    await storage.pruneVersions(tmpDir, 'homepage', 'desktop', 5);
    const versions = await storage.listVersions(tmpDir, 'homepage', 'desktop');
    assert.equal(versions.length, 1);
  });
});

// --- Binary files ---

describe('FileStorage: binaries', () => {
  it('getBinary returns null for nonexistent file', async () => {
    const data = await storage.getBinary(tmpDir, 'baselines/bitmaps_reference/test.png');
    assert.equal(data, null);
  });

  it('putBinary + getBinary roundtrips', async () => {
    const buf = Buffer.from('fake-png-data');
    await storage.putBinary(tmpDir, 'baselines/bitmaps_reference/test.png', buf);
    const loaded = await storage.getBinary(tmpDir, 'baselines/bitmaps_reference/test.png');
    assert.ok(loaded);
    assert.ok(Buffer.isBuffer(loaded));
    assert.deepEqual(loaded, buf);
  });

  it('putBinary creates directories if needed', async () => {
    await storage.putBinary(tmpDir, 'deep/nested/dir/file.png', Buffer.from('data'));
    const fullPath = path.join(tmpDir, '.eyeless', 'deep', 'nested', 'dir', 'file.png');
    assert.ok(fs.existsSync(fullPath));
  });

  it('listBinaries returns correct file list', async () => {
    const dir = 'baselines/bitmaps_reference';
    await storage.putBinary(tmpDir, `${dir}/a.png`, Buffer.from('a'));
    await storage.putBinary(tmpDir, `${dir}/b.png`, Buffer.from('b'));
    await storage.putBinary(tmpDir, `${dir}/c.json`, Buffer.from('c'));

    const files = await storage.listBinaries(tmpDir, dir);
    assert.equal(files.length, 3);
    assert.ok(files.includes('a.png'));
    assert.ok(files.includes('b.png'));
    assert.ok(files.includes('c.json'));
  });

  it('listBinaries returns empty array for nonexistent directory', async () => {
    const files = await storage.listBinaries(tmpDir, 'nonexistent/dir');
    assert.deepEqual(files, []);
  });

  it('deleteBinary removes the file', async () => {
    await storage.putBinary(tmpDir, 'test.png', Buffer.from('data'));
    await storage.deleteBinary(tmpDir, 'test.png');
    const loaded = await storage.getBinary(tmpDir, 'test.png');
    assert.equal(loaded, null);
  });

  it('deleteBinary is a no-op for nonexistent file', async () => {
    // Should not throw
    await storage.deleteBinary(tmpDir, 'nonexistent.png');
  });

  it('getBinary rejects path traversal', async () => {
    await assert.rejects(() => storage.getBinary(tmpDir, '../../etc/passwd'), /Path traversal blocked/);
  });

  it('putBinary rejects path traversal', async () => {
    await assert.rejects(() => storage.putBinary(tmpDir, '../../evil.txt', Buffer.from('x')), /Path traversal blocked/);
  });

  it('deleteBinary rejects path traversal', async () => {
    await assert.rejects(() => storage.deleteBinary(tmpDir, '../../evil.txt'), /Path traversal blocked/);
  });

  it('listBinaries rejects path traversal', async () => {
    await assert.rejects(() => storage.listBinaries(tmpDir, '../../etc'), /Path traversal blocked/);
  });
});

// --- ensureDirectories ---

describe('FileStorage: ensureDirectories', () => {
  it('creates the .eyeless directory structure', async () => {
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
