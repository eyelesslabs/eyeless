import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { capture, check } from './engine';
import { saveConfig } from './config';
import { EyelessConfig } from './types';

const TEST_HTML = path.resolve(__dirname, '..', 'src', 'integration.test.html');

let tmpProject: string;

/**
 * Integration tests that run the engine against a real HTML file with Playwright.
 * These tests exercise the full pipeline: config → BackstopJS → Playwright → snapshot.
 */
describe('integration: multi-state capture', { timeout: 120_000 }, () => {
  before(() => {
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeless-integration-'));
    const config: EyelessConfig = {
      url: `file://${TEST_HTML}`,
      viewports: [{ label: 'desktop', width: 1280, height: 720 }],
      threshold: 0.5,
      scenarios: [],
      ignore: [],
    };
    saveConfig(config, tmpProject);
  });

  after(() => {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  it('captures default state without interactions', async () => {
    const results = await capture({
      project: tmpProject,
      label: 'default',
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'captured');
    assert.equal(results[0].scenario, 'default');
    assert.ok(results[0].elementsCaptured > 0, 'should capture at least one element');
  });

  it('captures state after click interaction (open panel)', async () => {
    const results = await capture({
      project: tmpProject,
      label: 'panel-open',
      interactions: [
        { type: 'click', selector: '#open-panel' },
      ],
      waitFor: [
        { type: 'selector', selector: '#panel.open' },
      ],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'captured');
    assert.equal(results[0].scenario, 'panel-open');
    assert.ok(results[0].elementsCaptured > 0);
  });

  it('captures state after evaluate interaction (open modal via JS)', async () => {
    const results = await capture({
      project: tmpProject,
      label: 'modal-open',
      interactions: [
        { type: 'evaluate', selector: '', expression: "document.getElementById('modal-overlay').classList.add('visible')" },
      ],
      waitFor: [
        { type: 'selector', selector: '.modal-overlay.visible' },
      ],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'captured');
    assert.equal(results[0].scenario, 'modal-open');
    // Modal state should capture more elements (modal content is now visible)
    assert.ok(results[0].elementsCaptured > 0);
  });

  it('captures state after evaluate with multiple args (tab switch)', async () => {
    const results = await capture({
      project: tmpProject,
      label: 'tab-b',
      interactions: [
        { type: 'evaluate', selector: '', expression: "switchTab('b')" },
      ],
      waitFor: [
        { type: 'cssClass', selector: '#tab-b', className: 'active' },
      ],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'captured');
    assert.equal(results[0].scenario, 'tab-b');
  });

  it('check after capture detects no drift on same state', async () => {
    // First capture a baseline
    await capture({
      project: tmpProject,
      label: 'check-test',
    });

    // Then check the same state — should pass
    const results = await check({
      project: tmpProject,
      label: 'check-test',
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'pass');
    assert.equal(results[0].drifts.length, 0);
  });

  it('waitFor timeout strategy works', async () => {
    const start = Date.now();
    const results = await capture({
      project: tmpProject,
      label: 'timeout-test',
      waitFor: [
        { type: 'timeout', timeout: 500 },
      ],
    });
    const elapsed = Date.now() - start;

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'captured');
    // Should have waited at least 500ms (but BackstopJS has its own overhead)
    assert.ok(elapsed >= 400, `expected ≥400ms elapsed, got ${elapsed}ms`);
  });

  it('waitFor animations strategy completes without error', async () => {
    const results = await capture({
      project: tmpProject,
      label: 'animations-test',
      waitFor: [
        { type: 'animations' },
      ],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'captured');
  });

  it('multiple interactions in sequence', async () => {
    const results = await capture({
      project: tmpProject,
      label: 'multi-interact',
      interactions: [
        { type: 'click', selector: '#open-panel' },
        { type: 'evaluate', selector: '', expression: "document.getElementById('modal-overlay').classList.add('visible')" },
      ],
      waitFor: [
        { type: 'selector', selector: '#panel.open' },
        { type: 'selector', selector: '.modal-overlay.visible' },
      ],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'captured');
    assert.equal(results[0].scenario, 'multi-interact');
  });
});
