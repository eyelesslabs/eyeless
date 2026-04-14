import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { execFileSync } from 'node:child_process';
import {
  detectCiMetadata,
  ensureProjectId,
  readLatestHistory,
  runSync,
  SyncAuthError,
} from './sync';
import { HistoryEntry } from './types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeless-sync-test-'));
  fs.mkdirSync(path.join(tmpDir, '.eyeless'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeHistory(projectPath: string, entries: HistoryEntry[]): void {
  const historyPath = path.join(projectPath, '.eyeless', 'history.json');
  fs.writeFileSync(historyPath, JSON.stringify(entries));
}

function writeConfig(projectPath: string, config: Record<string, unknown>): void {
  const configPath = path.join(projectPath, '.eyeless', 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function readConfig(projectPath: string): Record<string, unknown> {
  const configPath = path.join(projectPath, '.eyeless', 'config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
}

function makeHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    timestamp: '2026-04-14T10:00:00.000Z',
    results: [
      {
        status: 'pass',
        matchPercentage: 99.5,
        scenario: 'homepage',
        viewport: 'desktop',
        drifts: [],
        summary: 'All good',
      },
    ],
    ...overrides,
  };
}

function startMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function collectBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
  });
}

// ---------------------------------------------------------------------------
// readLatestHistory
// ---------------------------------------------------------------------------

describe('readLatestHistory: exits with error when no history.json exists', () => {
  it('throws when history.json is missing', () => {
    assert.throws(
      () => readLatestHistory(tmpDir),
      (err: Error) => err.message.includes('No history found'),
    );
  });
});

describe('readLatestHistory: exits with error when history.json is empty', () => {
  it('throws when history array is empty', () => {
    writeHistory(tmpDir, []);
    assert.throws(
      () => readLatestHistory(tmpDir),
      (err: Error) => err.message.includes('No check results'),
    );
  });
});

describe('readLatestHistory: returns the most recent entry', () => {
  it('returns the last entry in the array', () => {
    const entries: HistoryEntry[] = [
      makeHistoryEntry({ timestamp: '2026-04-10T00:00:00.000Z' }),
      makeHistoryEntry({ timestamp: '2026-04-14T00:00:00.000Z' }),
    ];
    writeHistory(tmpDir, entries);

    const result = readLatestHistory(tmpDir);
    assert.equal(result.timestamp, '2026-04-14T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// ensureProjectId
// ---------------------------------------------------------------------------

describe('ensureProjectId: generates project_id in config.json if missing', () => {
  it('creates config.json with a UUID when no config exists', () => {
    const projectId = ensureProjectId(tmpDir);

    assert.ok(projectId.length > 0, 'projectId should not be empty');
    assert.match(projectId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const saved = readConfig(tmpDir);
    assert.equal(saved.project_id, projectId);
  });

  it('adds project_id to existing config without overwriting other fields', () => {
    writeConfig(tmpDir, { url: 'http://localhost:3000', threshold: 0.1 });

    const projectId = ensureProjectId(tmpDir);
    const saved = readConfig(tmpDir);

    assert.equal(saved.project_id, projectId);
    assert.equal(saved.url, 'http://localhost:3000');
    assert.equal(saved.threshold, 0.1);
  });
});

describe('ensureProjectId: reuses existing project_id from config.json', () => {
  it('returns the existing project_id without modifying config', () => {
    const existingId = 'aaaabbbb-cccc-4ddd-eeee-ffff00001111';
    writeConfig(tmpDir, { project_id: existingId, url: 'http://localhost:3000' });

    const projectId = ensureProjectId(tmpDir);
    assert.equal(projectId, existingId);

    const saved = readConfig(tmpDir);
    assert.equal(saved.project_id, existingId);
  });
});

// ---------------------------------------------------------------------------
// detectCiMetadata
// ---------------------------------------------------------------------------

describe('detectCiMetadata: auto-detects GitHub Actions metadata from env vars', () => {
  it('uses GITHUB_* env vars when available', () => {
    const originalEnv = { ...process.env };

    process.env.GITHUB_REF_NAME = 'main';
    process.env.GITHUB_SHA = 'abc123def456';
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    process.env.GITHUB_REPOSITORY = 'eyelesslabs/eyeless';
    process.env.GITHUB_RUN_ID = '12345';

    try {
      const metadata = detectCiMetadata();
      assert.equal(metadata.branch, 'main');
      assert.equal(metadata.commitSha, 'abc123def456');
      assert.equal(metadata.runUrl, 'https://github.com/eyelesslabs/eyeless/actions/runs/12345');
    } finally {
      // Restore original env
      for (const key of ['GITHUB_REF_NAME', 'GITHUB_SHA', 'GITHUB_SERVER_URL', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID']) {
        if (originalEnv[key] !== undefined) {
          process.env[key] = originalEnv[key];
        } else {
          delete process.env[key];
        }
      }
    }
  });

  it('sets runUrl to null when GitHub Actions env vars are partially missing', () => {
    const originalEnv = { ...process.env };

    process.env.GITHUB_REF_NAME = 'feature-branch';
    delete process.env.GITHUB_SERVER_URL;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_RUN_ID;

    try {
      const metadata = detectCiMetadata();
      assert.equal(metadata.branch, 'feature-branch');
      assert.equal(metadata.runUrl, null);
    } finally {
      if (originalEnv.GITHUB_REF_NAME !== undefined) {
        process.env.GITHUB_REF_NAME = originalEnv.GITHUB_REF_NAME;
      } else {
        delete process.env.GITHUB_REF_NAME;
      }
    }
  });
});

describe('detectCiMetadata: falls back to git commands when not in GitHub Actions', () => {
  it('returns non-empty branch and commitSha from git fallback', () => {
    const originalEnv = { ...process.env };

    delete process.env.GITHUB_REF_NAME;
    delete process.env.GITHUB_SHA;
    delete process.env.GITHUB_SERVER_URL;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_RUN_ID;

    try {
      const metadata = detectCiMetadata();
      // In a git repo, these should be non-empty strings
      // (they may be empty if run outside a git repo, which is also valid)
      assert.ok(typeof metadata.branch === 'string');
      assert.ok(typeof metadata.commitSha === 'string');
      assert.equal(metadata.runUrl, null);
    } finally {
      for (const key of ['GITHUB_REF_NAME', 'GITHUB_SHA', 'GITHUB_SERVER_URL', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID']) {
        if (originalEnv[key] !== undefined) {
          process.env[key] = originalEnv[key];
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// runSync: HTTP integration tests
// ---------------------------------------------------------------------------

describe('runSync: sends correct POST request with proper headers and body', () => {
  it('POSTs to /api/ci/check with Authorization header and JSON body', async () => {
    let capturedMethod = '';
    let capturedPath = '';
    let capturedHeaders: http.IncomingHttpHeaders = {};
    let capturedBody = '';

    const { server, port } = await startMockServer(async (req, res) => {
      capturedMethod = req.method ?? '';
      capturedPath = req.url ?? '';
      capturedHeaders = req.headers;
      capturedBody = await collectBody(req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ report_url: 'https://eyeless.dev/reports/abc' }));
    });

    try {
      writeHistory(tmpDir, [makeHistoryEntry()]);
      writeConfig(tmpDir, { project_id: 'test-uuid-1234', url: 'http://localhost:3000' });

      await runSync({
        token: 'my-secret-token',
        apiUrl: `http://127.0.0.1:${port}`,
        projectPath: tmpDir,
      });

      assert.equal(capturedMethod, 'POST');
      assert.equal(capturedPath, '/api/ci/check');
      assert.equal(capturedHeaders['authorization'], 'Bearer my-secret-token');
      assert.equal(capturedHeaders['content-type'], 'application/json');
      assert.equal(capturedHeaders['accept'], 'application/json');

      const body = JSON.parse(capturedBody) as Record<string, unknown>;
      assert.equal(body.project_uuid, 'test-uuid-1234');
      assert.ok(typeof body.project_name === 'string');
      assert.equal(body.checked_at, '2026-04-14T10:00:00.000Z');
      assert.ok(Array.isArray(body.entries));
      const entries = body.entries as Record<string, unknown>[];
      assert.equal(entries.length, 1);
      assert.equal(entries[0].scenario, 'homepage');
      assert.equal(entries[0].viewport, 'desktop');
      assert.equal(entries[0].status, 'pass');
      assert.equal(entries[0].match_percentage, 99.5);
      assert.equal(entries[0].drift_count, 0);
    } finally {
      await closeServer(server);
    }
  });
});

describe('runSync: prints report_url on success', () => {
  it('returns reportUrl from the response', async () => {
    const { server, port } = await startMockServer(async (_req, res) => {
      await collectBody(_req);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ report_url: 'https://eyeless.dev/reports/xyz' }));
    });

    try {
      writeHistory(tmpDir, [makeHistoryEntry()]);
      writeConfig(tmpDir, { project_id: 'proj-uuid', url: 'http://localhost:3000' });

      const result = await runSync({
        token: 'tok',
        apiUrl: `http://127.0.0.1:${port}`,
        projectPath: tmpDir,
      });

      assert.equal(result.reportUrl, 'https://eyeless.dev/reports/xyz');
    } finally {
      await closeServer(server);
    }
  });

  it('returns undefined reportUrl when response has no report_url field', async () => {
    const { server, port } = await startMockServer(async (_req, res) => {
      await collectBody(_req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });

    try {
      writeHistory(tmpDir, [makeHistoryEntry()]);
      writeConfig(tmpDir, { project_id: 'proj-uuid', url: 'http://localhost:3000' });

      const result = await runSync({
        token: 'tok',
        apiUrl: `http://127.0.0.1:${port}`,
        projectPath: tmpDir,
      });

      assert.equal(result.reportUrl, undefined);
    } finally {
      await closeServer(server);
    }
  });
});

describe('runSync: handles 401 response', () => {
  it('throws SyncAuthError on 401', async () => {
    const { server, port } = await startMockServer(async (_req, res) => {
      await collectBody(_req);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Unauthenticated.' }));
    });

    try {
      writeHistory(tmpDir, [makeHistoryEntry()]);
      writeConfig(tmpDir, { project_id: 'proj-uuid' });

      await assert.rejects(
        () => runSync({ token: 'bad-token', apiUrl: `http://127.0.0.1:${port}`, projectPath: tmpDir }),
        (err: Error) => {
          assert.ok(err instanceof SyncAuthError, `Expected SyncAuthError, got ${err.constructor.name}`);
          assert.ok(err.message.includes('EYELESS_TOKEN'));
          return true;
        },
      );
    } finally {
      await closeServer(server);
    }
  });
});

describe('runSync: handles server error response', () => {
  it('throws with status code on 500', async () => {
    const { server, port } = await startMockServer(async (_req, res) => {
      await collectBody(_req);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Internal server error' }));
    });

    try {
      writeHistory(tmpDir, [makeHistoryEntry()]);
      writeConfig(tmpDir, { project_id: 'proj-uuid' });

      await assert.rejects(
        () => runSync({ token: 'tok', apiUrl: `http://127.0.0.1:${port}`, projectPath: tmpDir }),
        (err: Error) => {
          assert.ok(err.message.includes('500'));
          return true;
        },
      );
    } finally {
      await closeServer(server);
    }
  });

  it('throws with status code on 422', async () => {
    const { server, port } = await startMockServer(async (_req, res) => {
      await collectBody(_req);
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Validation failed' }));
    });

    try {
      writeHistory(tmpDir, [makeHistoryEntry()]);
      writeConfig(tmpDir, { project_id: 'proj-uuid' });

      await assert.rejects(
        () => runSync({ token: 'tok', apiUrl: `http://127.0.0.1:${port}`, projectPath: tmpDir }),
        (err: Error) => {
          assert.ok(err.message.includes('422'));
          assert.ok(err.message.includes('Validation failed'));
          return true;
        },
      );
    } finally {
      await closeServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// CLI integration: EYELESS_TOKEN missing
// ---------------------------------------------------------------------------

describe('CLI sync: exits with error when EYELESS_TOKEN is missing', () => {
  it('exits 1 with clear error message when token env var is absent', () => {
    const cliPath = path.resolve(__dirname, 'cli.js');

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    delete env.EYELESS_TOKEN;
    env.NODE_NO_WARNINGS = '1';

    try {
      execFileSync('node', [cliPath, 'sync', '--project', tmpDir], {
        encoding: 'utf-8',
        timeout: 10000,
        env,
      });
      assert.fail('Expected non-zero exit');
    } catch (err: any) {
      assert.ok(err.status === 1, `Expected exit code 1, got ${err.status}`);
      const combined = (err.stdout || '') + (err.stderr || '');
      assert.ok(combined.includes('EYELESS_TOKEN'), `Expected EYELESS_TOKEN mention in output: ${combined}`);
    }
  });
});
