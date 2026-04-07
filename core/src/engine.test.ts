import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findScreenshot, resolveScenarios } from './engine';
import { EyelessConfig } from './types';
import { FileStorage } from './storage/file-storage';

let tmpDir: string;
let storage: FileStorage;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeless-engine-test-'));
  storage = new FileStorage();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('findScreenshot', () => {
  it('returns undefined for missing directory', async () => {
    const result = await findScreenshot(storage, tmpDir, 'nonexistent/dir', 'default', 'desktop');
    assert.equal(result, undefined);
  });

  it('returns undefined when no matching file exists', async () => {
    const dir = 'test_bitmaps';
    await storage.putBinary(tmpDir, `${dir}/unrelated.png`, Buffer.from(''));
    const result = await findScreenshot(storage, tmpDir, dir, 'default', 'desktop');
    assert.equal(result, undefined);
  });

  it('matches correct file by label and viewport', async () => {
    const dir = 'test_bitmaps';
    const filename = 'eyeless_default_0_document_0_desktop.png';
    await storage.putBinary(tmpDir, `${dir}/${filename}`, Buffer.from(''));
    await storage.putBinary(tmpDir, `${dir}/eyeless_other_0_document_0_tablet.png`, Buffer.from(''));

    const result = await findScreenshot(storage, tmpDir, dir, 'default', 'desktop');
    assert.equal(result, filename);
  });

  it('ignores non-PNG files', async () => {
    const dir = 'test_bitmaps';
    await storage.putBinary(tmpDir, `${dir}/eyeless_default_0_document_0_desktop.json`, Buffer.from(''));
    const result = await findScreenshot(storage, tmpDir, dir, 'default', 'desktop');
    assert.equal(result, undefined);
  });
});

const baseConfig: EyelessConfig = {
  url: 'http://localhost:3000',
  viewports: [{ label: 'desktop', width: 1920, height: 1080 }],
  threshold: 0.1,
  scenarios: [],
  ignore: [],
};

describe('resolveScenarios', () => {
  it('returns all config scenarios when no label given', () => {
    const config: EyelessConfig = {
      ...baseConfig,
      scenarios: [
        { label: 'homepage' },
        { label: 'modal-open', interactions: [{ type: 'click', selector: '#btn' }] },
      ],
    };
    const result = resolveScenarios({}, config);
    assert.equal(result.length, 2);
    assert.equal(result[0].label, 'homepage');
    assert.equal(result[1].label, 'modal-open');
  });

  it('falls back to default when no label and no config scenarios', () => {
    const result = resolveScenarios({}, baseConfig);
    assert.equal(result.length, 1);
    assert.equal(result[0].label, 'default');
    assert.equal(result[0].url, 'http://localhost:3000');
  });

  it('merges config scenario fields when label matches', () => {
    const config: EyelessConfig = {
      ...baseConfig,
      scenarios: [
        {
          label: 'homepage',
          readySelector: '#app.loaded',
          delay: 500,
          selectors: ['.hero', '.nav'],
        },
      ],
    };
    const result = resolveScenarios({ label: 'homepage' }, config);
    assert.equal(result.length, 1);
    assert.equal(result[0].label, 'homepage');
    assert.equal(result[0].readySelector, '#app.loaded');
    assert.equal(result[0].delay, 500);
    assert.deepEqual(result[0].selectors, ['.hero', '.nav']);
  });

  it('opts override config scenario fields', () => {
    const config: EyelessConfig = {
      ...baseConfig,
      scenarios: [
        {
          label: 'homepage',
          url: 'http://localhost:3000',
          interactions: [{ type: 'click', selector: '#old' }],
          waitFor: [{ type: 'timeout', timeout: 1000 }],
        },
      ],
    };
    const result = resolveScenarios({
      label: 'homepage',
      url: 'http://localhost:4000',
      interactions: [{ type: 'click', selector: '#new' }],
      waitFor: [{ type: 'selector', selector: '.ready' }],
    }, config);

    assert.equal(result[0].url, 'http://localhost:4000');
    assert.deepEqual(result[0].interactions, [{ type: 'click', selector: '#new' }]);
    assert.deepEqual(result[0].waitFor, [{ type: 'selector', selector: '.ready' }]);
  });

  it('uses config url when opts.url is not provided and label matches', () => {
    const config: EyelessConfig = {
      ...baseConfig,
      scenarios: [
        { label: 'homepage', url: 'http://localhost:5000/home' },
      ],
    };
    const result = resolveScenarios({ label: 'homepage' }, config);
    assert.equal(result[0].url, 'http://localhost:5000/home');
  });

  it('builds bare scenario when label does not match any config scenario', () => {
    const config: EyelessConfig = {
      ...baseConfig,
      scenarios: [
        { label: 'homepage', readySelector: '#app.loaded', delay: 500 },
      ],
    };
    const result = resolveScenarios({ label: 'unknown-page' }, config);
    assert.equal(result.length, 1);
    assert.equal(result[0].label, 'unknown-page');
    assert.equal(result[0].readySelector, undefined);
    assert.equal(result[0].delay, undefined);
  });
});
