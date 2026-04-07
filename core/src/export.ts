import * as path from 'path';
import { HistoryEntry } from './types';
import { getEyelessDir } from './config';
import { Storage } from './storage/types';
import { getDefaultStorage } from './storage';

function isPathWithinBase(filePath: string, baseDir: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedFile = path.resolve(filePath);
  return resolvedFile === resolvedBase || resolvedFile.startsWith(resolvedBase + path.sep);
}

async function imageToBase64(relativePath: string, projectPath: string, storage: Storage): Promise<string | null> {
  // Validate the path stays within .eyeless/
  const eyelessDir = getEyelessDir(projectPath);
  const fullPath = path.resolve(eyelessDir, relativePath);
  if (!isPathWithinBase(fullPath, eyelessDir)) return null;

  const data = await storage.getBinary(projectPath, relativePath);
  if (!data) return null;
  return `data:image/png;base64,${data.toString('base64')}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function generateExportHtml(entry: HistoryEntry, projectPath: string, storage?: Storage): Promise<string> {
  const s = storage || getDefaultStorage();
  const timestamp = entry.timestamp;

  let resultsHtml = '';
  for (const r of entry.results) {
    const statusClass = r.status === 'pass' ? 'pass' : r.status === 'drift' ? 'drift' : 'error';
    const statusLabel = r.status.toUpperCase();

    // Build screenshots section
    let screenshotsHtml = '';
    if (r.referenceImage || r.testImage) {
      screenshotsHtml = '<div class="screenshots">';
      if (r.referenceImage) {
        const refB64 = await imageToBase64(r.referenceImage, projectPath, s);
        if (refB64) {
          screenshotsHtml += `<div class="screenshot"><h4>Reference</h4><img src="${refB64}" alt="Reference"></div>`;
        }
      }
      if (r.testImage) {
        const testB64 = await imageToBase64(r.testImage, projectPath, s);
        if (testB64) {
          screenshotsHtml += `<div class="screenshot"><h4>Current</h4><img src="${testB64}" alt="Current"></div>`;
        }
      }
      screenshotsHtml += '</div>';
    }

    // Build drifts section
    let driftsHtml = '';
    if (r.drifts.length > 0) {
      driftsHtml = '<table class="drifts"><thead><tr><th>Selector</th><th>Property</th><th>Expected</th><th>Actual</th></tr></thead><tbody>';
      for (const d of r.drifts) {
        driftsHtml += `<tr><td>${escapeHtml(d.selector)}</td><td>${escapeHtml(d.property)}</td><td>${escapeHtml(d.baseline)}</td><td>${escapeHtml(d.current)}</td></tr>`;
      }
      driftsHtml += '</tbody></table>';
    }

    resultsHtml += `
      <div class="result ${statusClass}">
        <div class="result-header">
          <span class="status-badge ${statusClass}">${statusLabel}</span>
          <strong>${escapeHtml(r.scenario)}</strong> @ ${escapeHtml(r.viewport)}
          <span class="match">${r.matchPercentage.toFixed(1)}% match</span>
        </div>
        <p>${escapeHtml(r.summary)}</p>
        ${screenshotsHtml}
        ${driftsHtml}
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Eyeless Check Report — ${escapeHtml(timestamp)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 1200px; margin: 0 auto; padding: 2rem; background: #f8f9fa; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .timestamp { color: #666; margin-bottom: 2rem; display: block; }
  .result { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; }
  .result-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; flex-wrap: wrap; }
  .status-badge { padding: 0.15rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; }
  .status-badge.pass { background: #d4edda; color: #155724; }
  .status-badge.drift { background: #fff3cd; color: #856404; }
  .status-badge.error { background: #f8d7da; color: #721c24; }
  .match { color: #666; font-size: 0.875rem; }
  .screenshots { display: flex; gap: 1rem; margin-top: 1rem; flex-wrap: wrap; }
  .screenshot { flex: 1; min-width: 300px; }
  .screenshot h4 { font-size: 0.875rem; color: #666; margin-bottom: 0.5rem; }
  .screenshot img { max-width: 100%; border: 1px solid #e0e0e0; border-radius: 4px; }
  .drifts { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.875rem; }
  .drifts th { background: #f1f3f5; text-align: left; padding: 0.5rem; border-bottom: 2px solid #dee2e6; }
  .drifts td { padding: 0.5rem; border-bottom: 1px solid #e9ecef; font-family: monospace; font-size: 0.8rem; }
  p { color: #444; margin-bottom: 0.5rem; }
</style>
</head>
<body>
<h1>Eyeless Check Report</h1>
<span class="timestamp">${escapeHtml(timestamp)}</span>
${resultsHtml}
</body>
</html>`;
}
