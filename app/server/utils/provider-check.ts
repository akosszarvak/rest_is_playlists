import Anthropic from '@anthropic-ai/sdk'
import type { ConnectionTestResult } from '#shared/settings'

/**
 * Checks an Anthropic key and model with the Models API (free, no tokens used).
 * Retrieving the configured model validates both the key and the model name.
 */
export async function checkAnthropic(apiKey: string, model: string): Promise<ConnectionTestResult> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 })
  try {
    const info = await client.models.retrieve(model)
    return { ok: true, message: `Key works. Model "${info.id}" (${info.display_name}) is available.` }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, message: 'Anthropic rejected the API key.' }
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, message: 'The API key has no permission to use the Models API.' }
    }
    if (error instanceof Anthropic.NotFoundError) {
      return { ok: false, message: `The key works, but model "${model}" was not found. Check the model name.` }
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, message: 'Rate limited by Anthropic. Try again in a minute.' }
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return { ok: false, message: `Could not reach the Anthropic API: ${error.message}` }
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, message: `Anthropic API error ${error.status ?? ''}: ${error.message}`.trim() }
    }
    throw error
  }
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Checks a Gemini key and model by fetching the model's metadata (free, no tokens used).
 * The key goes in the `x-goog-api-key` header, never in the URL.
 */
export async function checkGemini(apiKey: string, model: string): Promise<ConnectionTestResult> {
  let response: Response
  try {
    response = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(15_000)
    })
  } catch (error) {
    return { ok: false, message: `Could not reach the Gemini API: ${(error as Error).message}` }
  }

  const body = await response.json().catch(() => null) as
    | { displayName?: string, error?: { message?: string, details?: { reason?: string }[] } }
    | null

  if (response.ok) {
    return { ok: true, message: `Key works. Model "${model}" (${body?.displayName ?? 'unknown name'}) is available.` }
  }
  const reason = body?.error?.details?.find(d => d.reason)?.reason
  if (reason === 'API_KEY_INVALID' || response.status === 401) {
    return { ok: false, message: 'Google rejected the API key.' }
  }
  if (response.status === 403) {
    return { ok: false, message: `The key is not allowed to use the Gemini API: ${body?.error?.message ?? 'permission denied'}` }
  }
  if (response.status === 404) {
    return { ok: false, message: `The key works, but model "${model}" was not found. Check the model name.` }
  }
  if (response.status === 429) {
    return { ok: false, message: 'Rate limited by Google. Try again in a minute.' }
  }
  return { ok: false, message: `Gemini API error ${response.status}: ${body?.error?.message ?? response.statusText}` }
}
