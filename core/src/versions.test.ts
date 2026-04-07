import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { saveVersion, restoreVersion, getVersionsDir } from './config';
import { FileStorage } from './storage/file-storage';

let tmpDir: string;
let storage: FileStorage;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeless-versions-test-'));
  storage = new FileStorage();
  // Create required directories
  const refDir = path.join(tmpDir, '.eyeless', 'snapshots', 'reference');
  fs.mkdirSync(refDir, { recursive: true });
  const bitmapsDir = path.join(tmpDir, '.eyeless', 'baselines', 'bitmaps_reference');
  fs.mkdirSync(bitmapsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeSnapshot(projectPath: string, label: string, viewport: string, content?: object): string {
  const refDir = path.join(projectPath, '.eyeless', 'snapshots', 'reference');
  const filePath = path.join(refDir, `${label}_${viewport}.json`);
  const data = content || {
    url: 'http://localhost:3000',
    viewport: { label: viewport, width: 1920, height: 1080 },
    timestamp: new Date().toISOString(),
    elements: [{ selector: '.box', tagName: 'div', computedStyles: { color: 'red' }, boundingBox: { x: 0, y: 0, width: 100, height: 100 } }],
  };
  fs.writeFileSync(filePath, JSON.stringify(data));
  return filePath;
}

function writeBitmap(projectPath: string, label: string, viewport: string): string {
  const bitmapsDir = path.join(projectPath, '.eyeless', 'baselines', 'bitmaps_reference');
  const filePath = path.join(bitmapsDir, `eyeless_${label}_0_document_0_${viewport}.png`);
  fs.writeFileSync(filePath, 'fake-png-data');
  return filePath;
}

describe('versions: saveVersion creates version entries', () => {
  it('creates a version file from the current snapshot', async () => {
    writeSnapshot(tmpDir, 'homepage', 'desktop');
    await saveVersion(storage, tmpDir, 'homepage', 'desktop');

    const versionDir = path.join(getVersionsDir(tmpDir), 'homepage_desktop');
    assert.ok(fs.existsSync(versionDir));

    const files = fs.readdirSync(versionDir).filter(f => f.endsWith('.json'));
    assert.equal(files.length, 1);

    // Verify the version content matches the original
    const versionContent = JSON.parse(fs.readFileSync(path.join(versionDir, files[0]), 'utf-8'));
    assert.equal(versionContent.url, 'http://localhost:3000');
  });

  it('copies bitmap alongside snapshot when available', async () => {
    writeSnapshot(tmpDir, 'homepage', 'desktop');
    writeBitmap(tmpDir, 'homepage', 'desktop');
    await saveVersion(storage, tmpDir, 'homepage', 'desktop');

    const versionDir = path.join(getVersionsDir(tmpDir), 'homepage_desktop');
    const pngFiles = fs.readdirSync(versionDir).filter(f => f.endsWith('.png'));
    assert.equal(pngFiles.length, 1);
  });

  it('does nothing when snapshot does not exist', async () => {
    await saveVersion(storage, tmpDir, 'homepage', 'desktop');
    const versionDir = path.join(getVersionsDir(tmpDir), 'homepage_desktop');
    // Directory may or may not exist, but should have no versioned files
    if (fs.existsSync(versionDir)) {
      const files = fs.readdirSync(versionDir);
      assert.equal(files.length, 0);
    }
  });
});

describe('versions: directory structure', () => {
  it('stores versions in .eyeless/versions/{label}_{viewport}/', async () => {
    writeSnapshot(tmpDir, 'modal-open', 'tablet');
    await saveVersion(storage, tmpDir, 'modal-open', 'tablet');

    const expected = path.join(tmpDir, '.eyeless', 'versions', 'modal-open_tablet');
    assert.ok(fs.existsSync(expected));
  });

  it('version files have timestamp-based names', async () => {
    writeSnapshot(tmpDir, 'homepage', 'desktop');
    await saveVersion(storage, tmpDir, 'homepage', 'desktop');

    const versionDir = path.join(getVersionsDir(tmpDir), 'homepage_desktop');
    const files = fs.readdirSync(versionDir).filter(f => f.endsWith('.json'));
    assert.equal(files.length, 1);
    // Filename should look like an ISO timestamp with dashes
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.test(files[0]));
  });
});

describe('versions: listVersions', () => {
  it('lists versions sorted by timestamp', async () => {
    writeSnapshot(tmpDir, 'homepage', 'desktop');

    // Save two versions with a gap
    await saveVersion(storage, tmpDir, 'homepage', 'desktop');
    // Modify snapshot to create a different version
    writeSnapshot(tmpDir, 'homepage', 'desktop', {
      url: 'http://localhost:3000',
      viewport: { label: 'desktop', width: 1920, height: 1080 },
      timestamp: new Date().toISOString(),
      elements: [{ selector: '.updated', tagName: 'div', computedStyles: { color: 'blue' }, boundingBox: { x: 0, y: 0, width: 100, height: 100 } }],
    });
    // Small delay to ensure different timestamp
    await new Promise(r => setTimeout(r, 10));
    await saveVersion(storage, tmpDir, 'homepage', 'desktop');

    const versions = await storage.listVersions(tmpDir, 'homepage', 'desktop');
    assert.equal(versions.length, 2);
    assert.equal(versions[0].scenario, 'homepage');
    assert.equal(versions[0].viewport, 'desktop');
    // First should be older than second
    assert.ok(versions[0].timestamp <= versions[1].timestamp);
  });

  it('returns empty array for nonexistent scenario', async () => {
    const versions = await storage.listVersions(tmpDir, 'nonexistent', 'desktop');
    assert.deepEqual(versions, []);
  });
});

describe('versions: restoreVersion', () => {
  it('restores a specific version as the current baseline', async () => {
    // Create initial snapshot
    const originalContent = {
      url: 'http://localhost:3000',
      viewport: { label: 'desktop', width: 1920, height: 1080 },
      timestamp: '2026-01-01T00:00:00Z',
      elements: [{ selector: '.original', tagName: 'div', computedStyles: { color: 'red' }, boundingBox: { x: 0, y: 0, width: 100, height: 100 } }],
    };
    const snapshotPath = writeSnapshot(tmpDir, 'homepage', 'desktop', originalContent);

    // Save version of the original
    await saveVersion(storage, tmpDir, 'homepage', 'desktop');
    const versions = await storage.listVersions(tmpDir, 'homepage', 'desktop');
    const versionTimestamp = versions[0].timestamp;

    // Overwrite with new content
    writeSnapshot(tmpDir, 'homepage', 'desktop', {
      url: 'http://localhost:3000',
      viewport: { label: 'desktop', width: 1920, height: 1080 },
      timestamp: '2026-02-01T00:00:00Z',
      elements: [{ selector: '.changed', tagName: 'div', computedStyles: { color: 'blue' }, boundingBox: { x: 0, y: 0, width: 100, height: 100 } }],
    });

    // Restore the original version
    const result = await restoreVersion(storage, tmpDir, 'homepage', 'desktop', versionTimestamp);
    assert.ok(result);

    // Verify the restored snapshot
    const restored = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    assert.equal(restored.elements[0].selector, '.original');
    assert.equal(restored.timestamp, '2026-01-01T00:00:00Z');
  });

  it('restores bitmap when version has one', async () => {
    writeSnapshot(tmpDir, 'homepage', 'desktop');
    const bitmapPath = writeBitmap(tmpDir, 'homepage', 'desktop');

    await saveVersion(storage, tmpDir, 'homepage', 'desktop');
    const versions = await storage.listVersions(tmpDir, 'homepage', 'desktop');

    // Delete the current bitmap
    fs.unlinkSync(bitmapPath);
    assert.ok(!fs.existsSync(bitmapPath));

    // Restore
    const result = await restoreVersion(storage, tmpDir, 'homepage', 'desktop', versions[0].timestamp);
    assert.ok(result);

    // Bitmap should be back
    const bitmapsDir = path.join(tmpDir, '.eyeless', 'baselines', 'bitmaps_reference');
    const bitmapFiles = fs.readdirSync(bitmapsDir).filter(f => f.endsWith('.png'));
    assert.ok(bitmapFiles.length > 0);
  });

  it('returns false for nonexistent version', async () => {
    const result = await restoreVersion(storage, tmpDir, 'homepage', 'desktop', 'nonexistent-timestamp');
    assert.equal(result, false);
  });
});

describe('versions: cap at configured max', () => {
  it('prunes oldest versions when exceeding maxVersions', async () => {
    writeSnapshot(tmpDir, 'homepage', 'desktop');

    // Save 5 versions with maxVersions=3
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 10)); // Ensure unique timestamps
      await saveVersion(storage, tmpDir, 'homepage', 'desktop', 3);
    }

    const versions = await storage.listVersions(tmpDir, 'homepage', 'desktop');
    assert.equal(versions.length, 3);
  });

  it('uses default cap of 20 when not specified', async () => {
    writeSnapshot(tmpDir, 'homepage', 'desktop');

    for (let i = 0; i < 22; i++) {
      await new Promise(r => setTimeout(r, 5));
      await saveVersion(storage, tmpDir, 'homepage', 'desktop');
    }

    const versions = await storage.listVersions(tmpDir, 'homepage', 'desktop');
    assert.equal(versions.length, 20);
  });
});
