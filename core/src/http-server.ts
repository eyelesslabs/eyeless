import * as http from 'http';
import * as path from 'path';
import { loadConfig, getEyelessDir, restoreVersion } from './config';
import { capture, check, EngineOptions } from './engine';
import { EyelessConfig } from './types';
import { validateProjectPath } from './validation';
import { generateExportHtml } from './export';
import { Storage } from './storage/types';
import { getDefaultStorage } from './storage';

// --- Security constants ---
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB
const MAX_HISTORY_ENTRIES = 100;
const MAX_RUNTIME_INTERACTIONS = 20;
const MAX_RUNTIME_WAIT_STRATEGIES = 20;
const VALID_HTTP_INTERACTION_TYPES = ['click', 'hover', 'type', 'scroll']; // evaluate is MCP-only
const VALID_WAIT_TYPES_RUNTIME = ['selector', 'timeout', 'animations', 'cssClass'];

export interface HttpServerHandle {
  port: number;
  server: http.Server;
}

/**
 * Validate that a config object matches the expected EyelessConfig shape.
 * Returns an error message string if invalid, or null if valid.
 */
function validateConfig(config: unknown): string | null {
  if (config === null || config === undefined || typeof config !== 'object' || Array.isArray(config)) {
    return 'config must be a non-null object';
  }

  const c = config as Record<string, unknown>;

  if (typeof c.url !== 'string' || c.url.length === 0) {
    return 'config.url must be a non-empty string';
  }

  if (typeof c.threshold !== 'number' || c.threshold < 0 || c.threshold > 100 || !Number.isFinite(c.threshold)) {
    return 'config.threshold must be a finite number between 0 and 100';
  }

  if (!Array.isArray(c.viewports)) {
    return 'config.viewports must be an array';
  }
  for (let i = 0; i < c.viewports.length; i++) {
    const vp = c.viewports[i] as Record<string, unknown>;
    if (typeof vp !== 'object' || vp === null) return `config.viewports[${i}] must be an object`;
    if (typeof vp.label !== 'string') return `config.viewports[${i}].label must be a string`;
    if (typeof vp.width !== 'number' || !Number.isInteger(vp.width) || vp.width <= 0) return `config.viewports[${i}].width must be a positive integer`;
    if (typeof vp.height !== 'number' || !Number.isInteger(vp.height) || vp.height <= 0) return `config.viewports[${i}].height must be a positive integer`;
  }

  if (!Array.isArray(c.scenarios)) {
    return 'config.scenarios must be an array';
  }
  const VALID_INTERACTION_TYPES = ['click', 'hover', 'type', 'scroll', 'evaluate'];
  const VALID_WAIT_TYPES = ['selector', 'timeout', 'animations', 'cssClass'];
  const MAX_INTERACTIONS = 20;
  const MAX_WAIT_STRATEGIES = 20;

  for (let i = 0; i < c.scenarios.length; i++) {
    const s = c.scenarios[i] as Record<string, unknown>;
    if (typeof s !== 'object' || s === null) return `config.scenarios[${i}] must be an object`;
    if (typeof s.label !== 'string' || s.label.length === 0) return `config.scenarios[${i}].label must be a non-empty string`;
    if (s.url !== undefined && typeof s.url !== 'string') return `config.scenarios[${i}].url must be a string`;
    if (s.interactions !== undefined && !Array.isArray(s.interactions)) return `config.scenarios[${i}].interactions must be an array`;
    if (s.waitFor !== undefined && !Array.isArray(s.waitFor)) return `config.scenarios[${i}].waitFor must be an array`;

    // Validate interactions
    if (Array.isArray(s.interactions)) {
      if (s.interactions.length > MAX_INTERACTIONS) return `config.scenarios[${i}].interactions exceeds maximum of ${MAX_INTERACTIONS}`;
      for (let j = 0; j < s.interactions.length; j++) {
        const inter = s.interactions[j] as Record<string, unknown>;
        if (typeof inter !== 'object' || inter === null) return `config.scenarios[${i}].interactions[${j}] must be an object`;
        if (!VALID_INTERACTION_TYPES.includes(inter.type as string)) return `config.scenarios[${i}].interactions[${j}].type must be one of: ${VALID_INTERACTION_TYPES.join(', ')}`;
        if (inter.type === 'evaluate') {
          if (inter.expression !== undefined && typeof inter.expression !== 'string') return `config.scenarios[${i}].interactions[${j}].expression must be a string`;
        } else {
          if (inter.selector !== undefined && typeof inter.selector !== 'string') return `config.scenarios[${i}].interactions[${j}].selector must be a string`;
        }
        if (inter.value !== undefined && typeof inter.value !== 'string') return `config.scenarios[${i}].interactions[${j}].value must be a string`;
      }
    }

    // Validate wait strategies
    if (Array.isArray(s.waitFor)) {
      if (s.waitFor.length > MAX_WAIT_STRATEGIES) return `config.scenarios[${i}].waitFor exceeds maximum of ${MAX_WAIT_STRATEGIES}`;
      for (let j = 0; j < s.waitFor.length; j++) {
        const w = s.waitFor[j] as Record<string, unknown>;
        if (typeof w !== 'object' || w === null) return `config.scenarios[${i}].waitFor[${j}] must be an object`;
        if (!VALID_WAIT_TYPES.includes(w.type as string)) return `config.scenarios[${i}].waitFor[${j}].type must be one of: ${VALID_WAIT_TYPES.join(', ')}`;
        if (w.selector !== undefined && typeof w.selector !== 'string') return `config.scenarios[${i}].waitFor[${j}].selector must be a string`;
        if (w.timeout !== undefined && (typeof w.timeout !== 'number' || !Number.isFinite(w.timeout) || w.timeout < 0 || w.timeout > 30000)) return `config.scenarios[${i}].waitFor[${j}].timeout must be a number between 0 and 30000`;
        if (w.className !== undefined && typeof w.className !== 'string') return `config.scenarios[${i}].waitFor[${j}].className must be a string`;
      }
    }
  }

  if (!Array.isArray(c.ignore)) {
    return 'config.ignore must be an array';
  }
  for (let i = 0; i < c.ignore.length; i++) {
    const rule = c.ignore[i] as Record<string, unknown>;
    if (typeof rule !== 'object' || rule === null) return `config.ignore[${i}] must be an object`;
    if (typeof rule.selector !== 'string') return `config.ignore[${i}].selector must be a string`;
  }

  if (c.maxVersions !== undefined) {
    if (typeof c.maxVersions !== 'number' || !Number.isInteger(c.maxVersions) || c.maxVersions < 1 || c.maxVersions > 1000) {
      return 'config.maxVersions must be a positive integer between 1 and 1000';
    }
  }

  return null; // Valid
}

/**
 * Validate runtime interactions and waitFor from HTTP capture/check requests.
 * Rejects 'evaluate' interactions on the HTTP path (evaluate is MCP-only).
 */
function validateRuntimeActions(interactions?: unknown[], waitFor?: unknown[]): string | null {
  if (interactions !== undefined) {
    if (!Array.isArray(interactions)) return 'interactions must be an array';
    if (interactions.length > MAX_RUNTIME_INTERACTIONS) return `interactions exceeds maximum of ${MAX_RUNTIME_INTERACTIONS}`;
    for (let i = 0; i < interactions.length; i++) {
      const inter = interactions[i] as Record<string, unknown>;
      if (typeof inter !== 'object' || inter === null) return `interactions[${i}] must be an object`;
      if (!VALID_HTTP_INTERACTION_TYPES.includes(inter.type as string)) {
        if (inter.type === 'evaluate') return 'evaluate interactions are not allowed via HTTP (use the MCP server instead)';
        return `interactions[${i}].type must be one of: ${VALID_HTTP_INTERACTION_TYPES.join(', ')}`;
      }
    }
  }
  if (waitFor !== undefined) {
    if (!Array.isArray(waitFor)) return 'waitFor must be an array';
    if (waitFor.length > MAX_RUNTIME_WAIT_STRATEGIES) return `waitFor exceeds maximum of ${MAX_RUNTIME_WAIT_STRATEGIES}`;
    for (let i = 0; i < waitFor.length; i++) {
      const w = waitFor[i] as Record<string, unknown>;
      if (typeof w !== 'object' || w === null) return `waitFor[${i}] must be an object`;
      if (!VALID_WAIT_TYPES_RUNTIME.includes(w.type as string)) return `waitFor[${i}].type must be one of: ${VALID_WAIT_TYPES_RUNTIME.join(', ')}`;
    }
  }
  return null;
}

/**
 * Validate a file path stays within a base directory.
 */
function isPathWithinBase(filePath: string, baseDir: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedFile = path.resolve(filePath);
  return resolvedFile === resolvedBase || resolvedFile.startsWith(resolvedBase + path.sep);
}

/**
 * Read request body with a size limit.
 */
function readBody(req: http.IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;

    req.on('data', (chunk: Buffer | string) => {
      const chunkBytes = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      bytes += chunkBytes;

      if (bytes > maxBytes) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }

      body += chunk;
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Parse and validate the shared fields for POST /capture and POST /check.
 */
async function parseEngineRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  storage: Storage,
): Promise<EngineOptions | null> {
  const body = await readBody(req);
  let parsed: { project?: string; url?: string; label?: string; interactions?: any[]; waitFor?: any[] };
  try {
    parsed = JSON.parse(body);
  } catch {
    respondError(res, 400, 'Invalid JSON');
    return null;
  }

  const projectPath = validateProjectPath(parsed.project || process.cwd());
  if (!projectPath) {
    respondError(res, 400, 'Invalid or nonexistent project path');
    return null;
  }

  const actionsError = validateRuntimeActions(parsed.interactions, parsed.waitFor);
  if (actionsError) {
    respondError(res, 400, actionsError);
    return null;
  }

  return {
    project: projectPath,
    url: parsed.url,
    label: parsed.label,
    interactions: parsed.interactions,
    waitFor: parsed.waitFor,
    storage,
  };
}

function respond(res: http.ServerResponse, data: unknown, status: number = 200) {
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

function respondError(res: http.ServerResponse, status: number, message: string) {
  res.writeHead(status);
  res.end(JSON.stringify({ error: message }));
}

export function startHttpServer(port: number = 0, storage?: Storage): Promise<HttpServerHandle> {
  const s = storage || getDefaultStorage();

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost`);
      const pathname = url.pathname;

      res.setHeader('Content-Type', 'application/json');

      try {
        // --- Health check (no project validation needed) ---
        if (req.method === 'GET' && pathname === '/health') {
          respond(res, { status: 'ok' });
        }

        // --- GET /config ---
        else if (req.method === 'GET' && pathname === '/config') {
          const projectPath = validateProjectPath(url.searchParams.get('project') || process.cwd());
          if (!projectPath) { respondError(res, 400, 'Invalid or nonexistent project path'); return; }

          const config = await loadConfig(s, projectPath);
          respond(res, config);
        }

        // --- POST /config ---
        else if (req.method === 'POST' && pathname === '/config') {
          const body = await readBody(req);
          let parsed: { project?: string; config?: unknown };
          try {
            parsed = JSON.parse(body);
          } catch {
            respondError(res, 400, 'Invalid JSON'); return;
          }

          const projectPath = validateProjectPath(parsed.project || process.cwd());
          if (!projectPath) { respondError(res, 400, 'Invalid or nonexistent project path'); return; }

          const configError = validateConfig(parsed.config);
          if (configError) { respondError(res, 400, configError); return; }

          await s.putConfig(projectPath, parsed.config as EyelessConfig);
          respond(res, { status: 'saved' });
        }

        // --- GET /baselines ---
        else if (req.method === 'GET' && pathname === '/baselines') {
          const projectPath = validateProjectPath(url.searchParams.get('project') || process.cwd());
          if (!projectPath) { respondError(res, 400, 'Invalid or nonexistent project path'); return; }

          const baselines = await s.listSnapshots(projectPath, 'reference');
          respond(res, { baselines });
        }

        // --- POST /capture ---
        else if (req.method === 'POST' && pathname === '/capture') {
          const opts = await parseEngineRequest(req, res, s);
          if (!opts) return;

          const results = await capture(opts);
          respond(res, { results });
        }

        // --- POST /check ---
        else if (req.method === 'POST' && pathname === '/check') {
          const opts = await parseEngineRequest(req, res, s);
          if (!opts) return;

          const results = await check(opts);
          await s.appendHistory(opts.project!, { timestamp: new Date().toISOString(), results });
          respond(res, { results });
        }

        // --- GET /history ---
        else if (req.method === 'GET' && pathname === '/history') {
          const projectPath = validateProjectPath(url.searchParams.get('project') || process.cwd());
          if (!projectPath) { respondError(res, 400, 'Invalid or nonexistent project path'); return; }

          const limitParam = url.searchParams.get('limit');
          const limit = limitParam ? Math.max(1, Math.min(MAX_HISTORY_ENTRIES, parseInt(limitParam, 10) || 50)) : 50;

          const history = await s.getHistory(projectPath);
          // Flatten: each check result becomes its own entry with the parent timestamp
          const flat = history.flatMap(entry =>
            entry.results.map(r => ({
              timestamp: entry.timestamp,
              scenario: r.scenario,
              viewport: r.viewport,
              status: r.status,
              driftCount: r.drifts.length,
              matchPercentage: r.matchPercentage,
            }))
          );
          const recent = flat.slice(-limit);
          respond(res, { history: recent });
        }

        // --- GET /history/:id ---
        else if (req.method === 'GET' && /^\/history\/\d+$/.test(pathname)) {
          const projectPath = validateProjectPath(url.searchParams.get('project') || process.cwd());
          if (!projectPath) { respondError(res, 400, 'Invalid or nonexistent project path'); return; }

          const id = pathname.split('/')[2];
          const entry = await s.getHistoryEntry(projectPath, id);

          if (!entry) {
            respondError(res, 404, 'History entry not found');
            return;
          }

          respond(res, entry);
        }

        // --- GET /baselines/:scenario/versions ---
        else if (req.method === 'GET' && /^\/baselines\/[^/]+\/versions$/.test(pathname)) {
          const projectPath = validateProjectPath(url.searchParams.get('project') || process.cwd());
          if (!projectPath) { respondError(res, 400, 'Invalid or nonexistent project path'); return; }

          const scenario = decodeURIComponent(pathname.split('/')[2]);
          const viewport = url.searchParams.get('viewport') || 'desktop';
          const versions = await s.listVersions(projectPath, scenario, viewport);
          respond(res, { versions });
        }

        // --- POST /baselines/:scenario/restore ---
        else if (req.method === 'POST' && /^\/baselines\/[^/]+\/restore$/.test(pathname)) {
          const body = await readBody(req);
          let parsed: { project?: string; viewport?: string; version: string };
          try {
            parsed = JSON.parse(body);
          } catch {
            respondError(res, 400, 'Invalid JSON'); return;
          }

          const projectPath = validateProjectPath(parsed.project || process.cwd());
          if (!projectPath) { respondError(res, 400, 'Invalid or nonexistent project path'); return; }

          if (!parsed.version || typeof parsed.version !== 'string') {
            respondError(res, 400, 'version is required'); return;
          }

          const scenario = decodeURIComponent(pathname.split('/')[2]);
          const viewport = parsed.viewport || 'desktop';
          const restored = await restoreVersion(s, projectPath, scenario, viewport, parsed.version);

          if (!restored) {
            respondError(res, 404, 'Version not found'); return;
          }

          respond(res, { status: 'restored', scenario, viewport, version: parsed.version });
        }

        // --- POST /export ---
        else if (req.method === 'POST' && pathname === '/export') {
          const body = await readBody(req);
          let parsed: { project?: string; checkIndex?: number };
          try {
            parsed = JSON.parse(body);
          } catch {
            respondError(res, 400, 'Invalid JSON'); return;
          }

          const projectPath = validateProjectPath(parsed.project || process.cwd());
          if (!projectPath) { respondError(res, 400, 'Invalid or nonexistent project path'); return; }

          const history = await s.getHistory(projectPath);
          if (history.length === 0) {
            respondError(res, 404, 'No check history found'); return;
          }

          const idx = parsed.checkIndex !== undefined ? parsed.checkIndex : history.length - 1;
          if (idx < 0 || idx >= history.length) {
            respondError(res, 404, 'History entry not found'); return;
          }

          const entry = history[idx];
          const html = await generateExportHtml(entry, projectPath, s);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
        }

        // --- POST /approve ---
        else if (req.method === 'POST' && pathname === '/approve') {
          const body = await readBody(req);
          let parsed: { project?: string; label?: string };
          try {
            parsed = JSON.parse(body);
          } catch {
            respondError(res, 400, 'Invalid JSON'); return;
          }

          const projectPath = validateProjectPath(parsed.project || process.cwd());
          if (!projectPath) { respondError(res, 400, 'Invalid or nonexistent project path'); return; }

          if (!parsed.label || typeof parsed.label !== 'string') {
            respondError(res, 400, 'label is required'); return;
          }

          const config = await loadConfig(s, projectPath);
          const results = await capture({ project: projectPath, url: config.url, label: parsed.label, storage: s });
          respond(res, { status: 'approved', results });
        }

        // --- GET /screenshot/{path} ---
        else if (req.method === 'GET' && pathname.startsWith('/screenshot/')) {
          const imagePath = decodeURIComponent(pathname.replace('/screenshot/', ''));
          const projectPath = validateProjectPath(url.searchParams.get('project') || process.cwd());
          if (!projectPath) { respondError(res, 400, 'Invalid or nonexistent project path'); return; }

          const eyelessDir = getEyelessDir(projectPath);
          const fullPath = path.resolve(eyelessDir, imagePath);

          // Guard: resolved path must be within the eyeless directory
          if (!isPathWithinBase(fullPath, eyelessDir)) {
            respondError(res, 403, 'Forbidden');
            return;
          }

          const data = await s.getBinary(projectPath, imagePath);
          if (data) {
            res.setHeader('Content-Type', 'image/png');
            res.writeHead(200);
            res.end(data);
          } else {
            respondError(res, 404, 'Not found');
          }
          return;
        }

        // --- POST /import ---
        else if (req.method === 'POST' && pathname === '/import') {
          const body = await readBody(req);
          let parsed: { project?: string; scenario?: string; viewport?: string };
          try {
            parsed = JSON.parse(body);
          } catch {
            respondError(res, 400, 'Invalid JSON'); return;
          }

          const projectPath = validateProjectPath(parsed.project || process.cwd());
          if (!projectPath) { respondError(res, 400, 'Invalid or nonexistent project path'); return; }

          if (!parsed.scenario || typeof parsed.scenario !== 'string') {
            respondError(res, 400, 'scenario is required'); return;
          }

          const viewport = parsed.viewport || 'desktop';
          const snapshot = {
            url: 'imported',
            viewport: { label: viewport, width: 1440, height: 900 },
            timestamp: new Date().toISOString(),
            elements: [],
          };
          await s.putSnapshot(projectPath, 'reference', parsed.scenario, viewport, snapshot as any);
          respond(res, { status: 'imported', scenario: parsed.scenario, viewport });
        }

        else {
          respondError(res, 404, 'Not found');
        }
      } catch (err: unknown) {
        let errMessage: string;
        if (err instanceof Error) {
          errMessage = err.message;
        } else if (typeof err === 'string') {
          errMessage = err;
        } else if (typeof err === 'object' && err !== null) {
          // BackstopJS throws result objects with engineErrorMsg
          const obj = err as Record<string, unknown>;
          if (typeof obj.engineErrorMsg === 'string') {
            errMessage = obj.engineErrorMsg.split('\n')[0];
          } else {
            try { errMessage = JSON.stringify(err); } catch { errMessage = 'Internal server error'; }
          }
        } else {
          errMessage = 'Internal server error';
        }
        console.error('[eyeless] Request error:', errMessage);
        const status = errMessage === 'Request body too large' ? 413 : 500;
        respondError(res, status, errMessage);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const assignedPort = typeof addr === 'object' && addr ? addr.port : port;
      console.log(`[eyeless] HTTP server listening on port ${assignedPort}`);
      resolve({ port: assignedPort, server });
    });

    server.on('error', reject);
  });
}
