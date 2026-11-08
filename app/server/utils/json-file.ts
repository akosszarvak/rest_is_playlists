import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import type { z } from 'zod'

function displayPath(path: string): string {
  return relative(useRuntimeConfig().repoRoot, path).replaceAll('\\', '/')
}

/**
 * Reads and validates a JSON file. Returns `null` if the file doesn't exist.
 * Throws a 500 with a readable message if the file is not valid JSON or fails the schema.
 */
export async function readJsonFile<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S> | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw createError({ statusCode: 500, message: `Could not read ${displayPath(path)}: ${(error as Error).message}` })
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw createError({ statusCode: 500, message: `${displayPath(path)} is not valid JSON: ${(error as Error).message}` })
  }

  const result = schema.safeParse(json)
  if (!result.success) {
    throw createError({
      statusCode: 500,
      message: `${displayPath(path)} has invalid content: ${formatZodIssues(result.error)}`
    })
  }
  return result.data
}

/** Writes JSON atomically (temp file + rename), so a crash never leaves a half-written file. */
export async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}
