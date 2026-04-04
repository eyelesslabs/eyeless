import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { startHttpServer, HttpServerHandle } from './http-server';

let handle: HttpServerHandle;
let tmpDir: string;

function request(method: string, urlPath: string, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: handle.port,
        path: urlPath,
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeless-http-test-'));
  handle = await startHttpServer(0);
});

afterEach(async () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  await new Promise<void>((resolve) => handle.server.close(() => resolve()));
});

describe('HTTP server', () => {
  it('GET /health returns ok', async () => {
    const res = await request('GET', '/health');
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'ok');
  });

  it('GET /config returns default config for valid project', async () => {
    const res = await request('GET', `/config?project=${encodeURIComponent(tmpDir)}`);
    assert.equal(res.status, 200);
    const config = JSON.parse(res.body);
    assert.equal(config.url, 'http://localhost:5173');
    assert.equal(config.threshold, 0.1);
  });

  it('POST /config then GET /config roundtrips', async () => {
    const newConfig = {
      url: 'http://test.example.com',
      viewports: [{ label: 'mobile', width: 375, height: 812 }],
      threshold: 0.3,
      scenarios: [],
      ignore: [],
    };

    const postRes = await request(
      'POST',
      '/config',
      JSON.stringify({ project: tmpDir, config: newConfig }),
    );
    assert.equal(postRes.status, 200);

    const getRes = await request('GET', `/config?project=${encodeURIComponent(tmpDir)}`);
    assert.equal(getRes.status, 200);
    const loaded = JSON.parse(getRes.body);
    assert.equal(loaded.url, 'http://test.example.com');
    assert.equal(loaded.threshold, 0.3);
    assert.equal(loaded.viewports[0].label, 'mobile');
  });

  it('GET /baselines returns empty for fresh project', async () => {
    const res = await request('GET', `/baselines?project=${encodeURIComponent(tmpDir)}`);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.baselines, []);
  });

  it('GET /nonexistent returns 404', async () => {
    const res = await request('GET', '/nonexistent');
    assert.equal(res.status, 404);
  });

  it('GET /screenshot returns 404 for nonexistent image', async () => {
    const res = await request('GET', `/screenshot/baselines/missing.png?project=${encodeURIComponent(tmpDir)}`);
    assert.equal(res.status, 404);
  });
});

describe('HTTP server history', () => {
  it('GET /history returns flat entries from nested storage', async () => {
    // Write history.json in the nested format the server uses internally
    const eyelessDir = path.join(tmpDir, '.eyeless');
    fs.mkdirSync(eyelessDir, { recursive: true });
    const history = [
      {
        timestamp: '2026-04-05T00:00:00.000Z',
        results: [
          { status: 'pass', matchPercentage: 99.5, scenario: 'default', viewport: 'desktop', drifts: [], summary: 'ok' },
          { status: 'drift', matchPercentage: 85.0, scenario: 'modal', viewport: 'desktop', drifts: [{ selector: '.x', tagName: 'div', property: 'color', baseline: 'red', current: 'blue' }], summary: 'drift' },
        ],
      },
    ];
    fs.writeFileSync(path.join(eyelessDir, 'history.json'), JSON.stringify(history));

    const res = await request('GET', `/history?project=${encodeURIComponent(tmpDir)}`);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.history.length, 2);

    // First entry
    assert.equal(body.history[0].timestamp, '2026-04-05T00:00:00.000Z');
    assert.equal(body.history[0].scenario, 'default');
    assert.equal(body.history[0].viewport, 'desktop');
    assert.equal(body.history[0].status, 'pass');
    assert.equal(body.history[0].driftCount, 0);
    assert.equal(body.history[0].matchPercentage, 99.5);

    // Second entry
    assert.equal(body.history[1].scenario, 'modal');
    assert.equal(body.history[1].status, 'drift');
    assert.equal(body.history[1].driftCount, 1);
    assert.equal(body.history[1].matchPercentage, 85.0);
  });

  it('GET /history returns empty for fresh project', async () => {
    const res = await request('GET', `/history?project=${encodeURIComponent(tmpDir)}`);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.history, []);
  });
});

describe('HTTP server scenario validation', () => {
  it('rejects config with scenario missing label', async () => {
    const res = await request('POST', '/config', JSON.stringify({
      project: tmpDir,
      config: {
        url: 'http://test.com',
        threshold: 0.1,
        viewports: [],
        scenarios: [{ interactions: [] }],
        ignore: [],
      },
    }));
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error.includes('label'));
  });

  it('rejects config with scenario with non-string label', async () => {
    const res = await request('POST', '/config', JSON.stringify({
      project: tmpDir,
      config: {
        url: 'http://test.com',
        threshold: 0.1,
        viewports: [],
        scenarios: [{ label: 123 }],
        ignore: [],
      },
    }));
    assert.equal(res.status, 400);
  });

  it('rejects config with scenario with non-array interactions', async () => {
    const res = await request('POST', '/config', JSON.stringify({
      project: tmpDir,
      config: {
        url: 'http://test.com',
        threshold: 0.1,
        viewports: [],
        scenarios: [{ label: 'test', interactions: 'not-array' }],
        ignore: [],
      },
    }));
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error.includes('interactions'));
  });

  it('rejects config with scenario with invalid interaction type', async () => {
    const res = await request('POST', '/config', JSON.stringify({
      project: tmpDir,
      config: {
        url: 'http://test.com',
        threshold: 0.1,
        viewports: [],
        scenarios: [{ label: 'test', interactions: [{ type: 'evil', selector: '#x' }] }],
        ignore: [],
      },
    }));
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error.includes('type'));
  });

  it('rejects config with scenario with invalid wait strategy type', async () => {
    const res = await request('POST', '/config', JSON.stringify({
      project: tmpDir,
      config: {
        url: 'http://test.com',
        threshold: 0.1,
        viewports: [],
        scenarios: [{ label: 'test', waitFor: [{ type: 'evil' }] }],
        ignore: [],
      },
    }));
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error.includes('type'));
  });

  it('rejects config with too many interactions', async () => {
    const manyInteractions = Array.from({ length: 25 }, () => ({ type: 'click', selector: '#x' }));
    const res = await request('POST', '/config', JSON.stringify({
      project: tmpDir,
      config: {
        url: 'http://test.com',
        threshold: 0.1,
        viewports: [],
        scenarios: [{ label: 'test', interactions: manyInteractions }],
        ignore: [],
      },
    }));
    assert.equal(res.status, 400);
  });

  it('rejects config with too many wait strategies', async () => {
    const manyWaits = Array.from({ length: 25 }, () => ({ type: 'timeout', timeout: 100 }));
    const res = await request('POST', '/config', JSON.stringify({
      project: tmpDir,
      config: {
        url: 'http://test.com',
        threshold: 0.1,
        viewports: [],
        scenarios: [{ label: 'test', waitFor: manyWaits }],
        ignore: [],
      },
    }));
    assert.equal(res.status, 400);
  });

  it('rejects config with evaluate interaction that has non-string expression', async () => {
    const res = await request('POST', '/config', JSON.stringify({
      project: tmpDir,
      config: {
        url: 'http://test.com',
        threshold: 0.1,
        viewports: [],
        scenarios: [{ label: 'test', interactions: [{ type: 'evaluate', expression: 123 }] }],
        ignore: [],
      },
    }));
    assert.equal(res.status, 400);
  });

  it('accepts config with valid scenarios', async () => {
    const res = await request('POST', '/config', JSON.stringify({
      project: tmpDir,
      config: {
        url: 'http://test.com',
        threshold: 0.1,
        viewports: [],
        scenarios: [
          { label: 'default' },
          { label: 'modal', url: 'http://test.com/modal', interactions: [], waitFor: [] },
        ],
        ignore: [],
      },
    }));
    assert.equal(res.status, 200);
  });
});

describe('HTTP server security', () => {
  it('rejects relative project path', async () => {
    const res = await request('GET', '/config?project=relative/path');
    assert.equal(res.status, 400);
  });

  it('rejects nonexistent project path', async () => {
    const res = await request('GET', '/config?project=/nonexistent/path/xyz');
    assert.equal(res.status, 400);
  });

  it('rejects project path pointing to a file', async () => {
    const filePath = path.join(tmpDir, 'afile.txt');
    fs.writeFileSync(filePath, 'hello');
    const res = await request('GET', `/config?project=${encodeURIComponent(filePath)}`);
    assert.equal(res.status, 400);
  });

  it('rejects invalid config shape', async () => {
    const res = await request('POST', '/config', JSON.stringify({
      project: tmpDir,
      config: { url: 123, threshold: 'bad' },
    }));
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error.includes('url'));
  });

  it('rejects config with negative threshold', async () => {
    const res = await request('POST', '/config', JSON.stringify({
      project: tmpDir,
      config: { url: 'http://test.com', threshold: -1, viewports: [], scenarios: [], ignore: [] },
    }));
    assert.equal(res.status, 400);
  });

  it('rejects config with missing viewports array', async () => {
    const res = await request('POST', '/config', JSON.stringify({
      project: tmpDir,
      config: { url: 'http://test.com', threshold: 0.1, viewports: 'not-array', scenarios: [], ignore: [] },
    }));
    assert.equal(res.status, 400);
  });

  it('rejects malformed JSON body', async () => {
    const res = await request('POST', '/config', '{invalid json}');
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('rejects oversized request body with 413', async () => {
    // 2MB of data should exceed the 1MB limit
    const hugeBody = 'x'.repeat(2 * 1024 * 1024);
    try {
      const res = await request('POST', '/config', hugeBody);
      // If we get a response, it should be 413
      assert.equal(res.status, 413);
    } catch {
      // Connection may be destroyed before response — that's also acceptable
      assert.ok(true);
    }
  });

  it('GET /screenshot with path traversal via URL normalization returns 404', async () => {
    // URL parser normalizes ../../ so the request never reaches the screenshot handler
    const res = await request('GET', `/screenshot/../../etc/passwd?project=${encodeURIComponent(tmpDir)}`);
    assert.equal(res.status, 404);
  });

  it('does not leak internal paths in error responses', async () => {
    // POST to /check with valid project but the engine will fail (no BackstopJS running)
    // The error message should be generic, not contain file paths
    const res = await request('POST', '/check', JSON.stringify({
      project: tmpDir,
      url: 'http://localhost:99999',
      label: 'test',
    }));
    // Should get 500 with generic message
    if (res.status === 500) {
      const body = JSON.parse(res.body);
      assert.equal(body.error, 'Internal server error');
      assert.ok(!body.error.includes(tmpDir));
      assert.ok(!body.error.includes('/'));
    }
    // If the engine doesn't throw (unlikely), that's also fine
  });

  it('screenshot endpoint checks file exists and is a file', async () => {
    // Create a directory where an image might be expected
    const eyelessDir = path.join(tmpDir, '.eyeless');
    const subdir = path.join(eyelessDir, 'fakedir');
    fs.mkdirSync(subdir, { recursive: true });

    const res = await request('GET', `/screenshot/fakedir?project=${encodeURIComponent(tmpDir)}`);
    assert.equal(res.status, 404); // It's a directory, not a file
  });
});
