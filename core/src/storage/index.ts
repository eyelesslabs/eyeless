export { Storage, SnapshotEntry } from './types';
export { FileStorage } from './file-storage';

import { Storage } from './types';
import { FileStorage } from './file-storage';

/** Module-level default storage instance used by all consumers. */
let defaultStorage: Storage = new FileStorage();

/** Get the default storage instance. */
export function getDefaultStorage(): Storage {
  return defaultStorage;
}

/**
 * Set the default storage instance.
 * Used by the cloud package to swap in DrizzleStorage.
 */
export function setDefaultStorage(storage: Storage): void {
  defaultStorage = storage;
}

/**
 * Create a storage instance by type.
 * Default is 'file' which returns FileStorage.
 * The cloud package will register additional types.
 */
export function createStorage(type: string = 'file'): Storage {
  switch (type) {
    case 'file':
      return new FileStorage();
    default:
      throw new Error(`Unknown storage type: "${type}"`);
  }
}
