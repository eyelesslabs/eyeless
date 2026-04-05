import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findScreenshot, resolveScenarios } from './engine';
import { EyelessConfig } from './types';

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
