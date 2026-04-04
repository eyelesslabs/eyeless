import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compareSnapshots, getSnapshotPath, loadSnapshot } from './compare';
import { StyleSnapshot, ElementStyleSnapshot } from '../types';

function makeElement(
  selector: string,
  styles: Record<string, string>,
  tagName = 'div',
): ElementStyleSnapshot {
  return {
    selector,
    tagName,
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    computedStyles: styles,
  };
}

function makeSnapshot(elements: ElementStyleSnapshot[]): StyleSnapshot {
  return {
    url: 'http://localhost:5173',
    viewport: { label: 'desktop', width: 1920, height: 1080 },
    timestamp: new Date().toISOString(),
    elements,
  };
}

describe('compareSnapshots', () => {
  it('returns empty array for identical snapshots', () => {
    const el = makeElement('.box', { color: 'red', padding: '10px' });
    const baseline = makeSnapshot([el]);
    const current = makeSnapshot([el]);
    const drifts = compareSnapshots(baseline, current);
    assert.equal(drifts.length, 0);
  });

  it('detects a single property drift', () => {
    const baseline = makeSnapshot([makeElement('.box', { color: 'red' })]);
    const current = makeSnapshot([makeElement('.box', { color: 'blue' })]);
    const drifts = compareSnapshots(baseline, current);
    assert.equal(drifts.length, 1);
    assert.equal(drifts[0].selector, '.box');
    assert.equal(drifts[0].property, 'color');
    assert.equal(drifts[0].baseline, 'red');
    assert.equal(drifts[0].current, 'blue');
  });

  it('detects multiple property drifts on the same element', () => {
    const baseline = makeSnapshot([makeElement('.box', { color: 'red', padding: '10px', margin: '5px' })]);
    const current = makeSnapshot([makeElement('.box', { color: 'blue', padding: '20px', margin: '5px' })]);
    const drifts = compareSnapshots(baseline, current);
    assert.equal(drifts.length, 2);
    const props = drifts.map((d) => d.property).sort();
    assert.deepEqual(props, ['color', 'padding']);
  });

  it('filters out elements matching ignore rules', () => {
    const baseline = makeSnapshot([
      makeElement('.box', { color: 'red' }),
      makeElement('.spinner', { opacity: '1' }),
    ]);
    const current = makeSnapshot([
      makeElement('.box', { color: 'blue' }),
      makeElement('.spinner', { opacity: '0' }),
    ]);
    const drifts = compareSnapshots(baseline, current, [{ selector: '.spinner' }]);
    assert.equal(drifts.length, 1);
    assert.equal(drifts[0].selector, '.box');
  });

  it('skips elements only in current (new elements)', () => {
    const baseline = makeSnapshot([makeElement('.old', { color: 'red' })]);
    const current = makeSnapshot([
      makeElement('.old', { color: 'red' }),
      makeElement('.new', { color: 'green' }),
    ]);
    const drifts = compareSnapshots(baseline, current);
    assert.equal(drifts.length, 0);
  });

  it('skips elements only in baseline (removed elements)', () => {
    const baseline = makeSnapshot([
      makeElement('.kept', { color: 'red' }),
      makeElement('.removed', { color: 'blue' }),
    ]);
    const current = makeSnapshot([makeElement('.kept', { color: 'red' })]);
    const drifts = compareSnapshots(baseline, current);
    assert.equal(drifts.length, 0);
  });

  it('handles empty element arrays', () => {
    const baseline = makeSnapshot([]);
    const current = makeSnapshot([]);
    const drifts = compareSnapshots(baseline, current);
    assert.equal(drifts.length, 0);
  });

  it('ignores properties present in only one snapshot', () => {
    const baseline = makeSnapshot([makeElement('.box', { color: 'red' })]);
    const current = makeSnapshot([makeElement('.box', { color: 'red', padding: '10px' })]);
    const drifts = compareSnapshots(baseline, current);
    // padding is only in current (baseline has no value) — should not drift
    assert.equal(drifts.length, 0);
  });
});

describe('getSnapshotPath', () => {
  it('produces correct path for normal labels', () => {
    const result = getSnapshotPath('/tmp/snapshots', 'reference', 'homepage', 'desktop');
    assert.equal(result, path.join('/tmp/snapshots', 'reference', 'homepage_desktop.json'));
  });

  it('sanitizes special characters in labels', () => {
    const result = getSnapshotPath('/tmp/snapshots', 'test', 'my page!', 'tablet 768');
    assert.equal(result, path.join('/tmp/snapshots', 'test', 'my_page__tablet_768.json'));
  });
});

describe('loadSnapshot', () => {
  it('returns null for missing file', () => {
    const result = loadSnapshot('/nonexistent/path/to/snapshot.json');
    assert.equal(result, null);
  });

  it('loads and parses a valid snapshot file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeless-test-'));
    const snapshot = makeSnapshot([makeElement('.box', { color: 'red' })]);
    const filePath = path.join(tmpDir, 'snapshot.json');
    fs.writeFileSync(filePath, JSON.stringify(snapshot));

    const loaded = loadSnapshot(filePath);
    assert.ok(loaded);
    assert.equal(loaded!.elements.length, 1);
    assert.equal(loaded!.elements[0].selector, '.box');

    fs.rmSync(tmpDir, { recursive: true });
  });
});
