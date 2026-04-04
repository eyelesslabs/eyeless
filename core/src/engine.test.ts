import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findScreenshot } from './engine';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeless-engine-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('findScreenshot', () => {
  it('returns undefined for missing directory', () => {
    const result = findScreenshot('/nonexistent/dir', 'default', 'desktop');
    assert.equal(result, undefined);
  });

  it('returns undefined when no matching file exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'unrelated.png'), '');
    const result = findScreenshot(tmpDir, 'default', 'desktop');
    assert.equal(result, undefined);
  });

  it('matches correct file by label and viewport', () => {
    const filename = 'eyeless_default_0_document_0_desktop.png';
    fs.writeFileSync(path.join(tmpDir, filename), '');
    fs.writeFileSync(path.join(tmpDir, 'eyeless_other_0_document_0_tablet.png'), '');

    const result = findScreenshot(tmpDir, 'default', 'desktop');
    assert.equal(result, path.join(tmpDir, filename));
  });

  it('ignores non-PNG files', () => {
    fs.writeFileSync(path.join(tmpDir, 'eyeless_default_0_document_0_desktop.json'), '');
    const result = findScreenshot(tmpDir, 'default', 'desktop');
    assert.equal(result, undefined);
  });
});
