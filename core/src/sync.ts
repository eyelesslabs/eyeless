import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { HistoryEntry } from './types';

export interface SyncConfig {
  token: string;
  apiUrl: string;
  projectPath: string;
}

export interface SyncResult {
  reportUrl?: string;
}

export interface CiMetadata {
  branch: string;
  commitSha: string;
  runUrl: string | null;
}

interface RawConfig {
  project_id?: string;
  [key: string]: unknown;
}

interface ApiResponseBody {
  report_url?: string;
  message?: string;
}

function getConfigPath(projectPath: string): string {
  return path.join(projectPath, '.eyeless', 'config.json');
}

function getHistoryPath(projectPath: string): string {
  return path.join(projectPath, '.eyeless', 'history.json');
}

function gitOutput(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

export function detectCiMetadata(): CiMetadata {
  const branch =
    process.env.GITHUB_REF_NAME || gitOutput(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commitSha = process.env.GITHUB_SHA || gitOutput(['rev-parse', 'HEAD']);

  const serverUrl = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;

  const runUrl =
    serverUrl && repository && runId
      ? `${serverUrl}/${repository}/actions/runs/${runId}`
      : null;

  return { branch, commitSha, runUrl };
}

export function ensureProjectId(projectPath: string): string {
  const configPath = getConfigPath(projectPath);

  let rawConfig: RawConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as RawConfig;
    } catch {
      rawConfig = {};
    }
  }

  if (rawConfig.project_id && typeof rawConfig.project_id === 'string') {
    return rawConfig.project_id;
  }

  const projectId = crypto.randomUUID();
  rawConfig.project_id = projectId;

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

  return projectId;
}

export function readLatestHistory(projectPath: string): HistoryEntry {
  const historyPath = getHistoryPath(projectPath);

  if (!fs.existsSync(historyPath)) {
    throw new Error(`No history found. Run "eyeless check --ci" first.`);
  }

  let entries: HistoryEntry[];
  try {
    entries = JSON.parse(fs.readFileSync(historyPath, 'utf-8')) as HistoryEntry[];
  } catch {
    throw new Error('history.json is malformed.');
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('No check results in history. Run "eyeless check --ci" first.');
  }

  return entries[entries.length - 1];
}

function postJson(
  urlString: string,
  token: string,
  body: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlString);
    } catch {
      reject(new Error(`Invalid API URL: ${urlString}`));
      return;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const port = parsedUrl.port || (isHttps ? '443' : '80');

    const options = {
      hostname: parsedUrl.hostname,
      port: parseInt(port, 10),
      path: parsedUrl.pathname + (parsedUrl.search || ''),
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function runSync(config: SyncConfig): Promise<SyncResult> {
  const { token, apiUrl, projectPath } = config;

  const entry = readLatestHistory(projectPath);
  const projectId = ensureProjectId(projectPath);
  const ci = detectCiMetadata();
  const projectName = path.basename(projectPath);

  const entries = entry.results.map((r) => ({
    scenario: r.scenario,
    viewport: r.viewport,
    status: r.status,
    match_percentage: r.matchPercentage,
    drift_count: r.drifts.length,
    detail: r.drifts.length > 0 ? { drifts: r.drifts } : null,
  }));

  const payload = JSON.stringify({
    project_uuid: projectId,
    project_name: projectName,
    branch: ci.branch,
    commit_sha: ci.commitSha,
    run_url: ci.runUrl,
    checked_at: entry.timestamp,
    entries,
  });

  const apiEndpoint = `${apiUrl.replace(/\/$/, '')}/api/ci/check`;
  const response = await postJson(apiEndpoint, token, payload);

  if (response.statusCode === 401) {
    throw new SyncAuthError('Authentication failed. Check your EYELESS_TOKEN.');
  }

  if (response.statusCode !== 200 && response.statusCode !== 201) {
    let message = `Server returned ${response.statusCode}`;
    try {
      const parsed = JSON.parse(response.body) as ApiResponseBody;
      if (parsed.message) {
        message = `Server returned ${response.statusCode}: ${parsed.message}`;
      }
    } catch {
      // Response body is not JSON — use the status code message
    }
    throw new Error(message);
  }

  let reportUrl: string | undefined;
  try {
    const parsed = JSON.parse(response.body) as ApiResponseBody;
    reportUrl = parsed.report_url;
  } catch {
    // Non-JSON success response — reportUrl stays undefined
  }

  return { reportUrl };
}

export class SyncAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncAuthError';
  }
}
