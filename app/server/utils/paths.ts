import { resolve } from 'node:path'

/** Absolute path inside the repo root (where data/ and .data/ live). */
export function repoPath(...parts: string[]): string {
  return resolve(useRuntimeConfig().repoRoot, ...parts)
}
