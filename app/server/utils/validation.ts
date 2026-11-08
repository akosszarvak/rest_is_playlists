import type { H3Event } from 'h3'
import type { z } from 'zod'

/** Turns zod issues into one readable line, e.g. "anthropic.model: Model name is required." */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
}

/** Validates the request body and throws a 400 with a readable message on failure. */
export async function readBodyWith<S extends z.ZodType>(event: H3Event, schema: S): Promise<z.output<S>> {
  const result = schema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, message: `Invalid request: ${formatZodIssues(result.error)}` })
  }
  return result.data
}

/** A message for any thrown value (H3 errors, Spotify errors, plain errors). */
export function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return String(error)
}
