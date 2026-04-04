import * as fs from 'fs';
import * as path from 'path';

/**
 * Validate that a project path is safe to use:
 * - Must be an absolute path
 * - Must exist on disk as a directory
 * - Canonicalized via realpathSync to resolve symlinks
 *
 * Returns the canonicalized path, or null if invalid.
 */
export function validateProjectPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;

  if (!path.isAbsolute(raw)) return null;

  try {
    const resolved = fs.realpathSync(raw);
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return null;
    return resolved;
  } catch {
    return null;
  }
}

/**
 * Resolve and validate a project path, falling back to cwd.
 * Returns the validated path or throws with a clear message.
 */
export function resolveProjectPath(raw: string | undefined): string {
  const candidate = raw || process.cwd();
  const validated = validateProjectPath(candidate);
  if (!validated) {
    throw new Error(`Invalid project path: "${candidate}" — must be an absolute path to an existing directory`);
  }
  return validated;
}
