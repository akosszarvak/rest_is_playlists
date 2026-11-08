import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

/** An error whose message is safe and useful to show in the UI. */
export class AiError extends Error {}

export interface JsonRequest<S extends z.ZodType> {
  system: string
  prompt: string
  schema: S
  maxOutputTokens: number
  signal: AbortSignal
}

export interface JsonResult<T> {
  data: T
  usage: { input: number, output: number }
}

/** One structured-output call to an AI provider, with retries on rate limits. */
export type JsonGenerator = <S extends z.ZodType>(request: JsonRequest<S>) => Promise<JsonResult<z.output<S>>>

// --- Anthropic (Messages API with structured outputs) ---------------------------------------

/**
 * Uses the official SDK's messages.parse + zodOutputFormat, which sends the schema as
 * output_config.format and validates the reply. The SDK retries 429 and 5xx responses
 * with backoff (honouring retry-after).
 */
export function anthropicGenerator(apiKey: string, model: string): JsonGenerator {
  const client = new Anthropic({ apiKey, maxRetries: 5, timeout: 10 * 60_000 })
  return async ({ system, prompt, schema, maxOutputTokens, signal }) => {
    try {
      const response = await client.messages.parse({
        model,
        max_tokens: maxOutputTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: zodOutputFormat(schema) }
      }, { signal })

      if (response.stop_reason === 'refusal') throw new AiError('Claude declined this request.')
      if (response.stop_reason === 'max_tokens') throw new AiError('The answer was cut off because it hit the output token limit.')
      if (response.parsed_output == null) throw new AiError('Claude returned an answer that did not match the expected format.')
      return {
        data: response.parsed_output as z.output<typeof schema>,
        usage: { input: response.usage.input_tokens, output: response.usage.output_tokens }
      }
    } catch (error) {
      throw toAnthropicError(error, model)
    }
  }
}

function toAnthropicError(error: unknown, model: string): Error {
  if (error instanceof AiError || isAbort(error)) return error as Error
  if (error instanceof Anthropic.AuthenticationError) return new AiError('Anthropic rejected the API key. Check it in Settings.')
  if (error instanceof Anthropic.PermissionDeniedError) return new AiError(`The API key may not use model "${model}".`)
  if (error instanceof Anthropic.NotFoundError) return new AiError(`Model "${model}" was not found. Check the model name in Settings.`)
  if (error instanceof Anthropic.RateLimitError) return new AiError('Rate limited by Anthropic, even after several retries. Try again in a few minutes.')
  if (error instanceof Anthropic.BadRequestError) return new AiError(`Anthropic rejected the request: ${error.message}`)
  if (error instanceof Anthropic.APIConnectionError) return new AiError(`Could not reach the Anthropic API: ${error.message}`)
  if (error instanceof Anthropic.APIError) return new AiError(`Anthropic API error ${error.status ?? ''}: ${error.message}`)
  if (error instanceof Anthropic.AnthropicError) return new AiError(`Anthropic SDK error: ${error.message}`)
  return error instanceof Error ? error : new Error(String(error))
}

// --- Google Gemini (generateContent with JSON response mode) --------------------------------

// RIP_GEMINI_BASE_URL points the adapter at a local mock server for testing without a key.
const GEMINI_BASE = process.env.RIP_GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_MAX_ATTEMPTS = 6

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string, thought?: boolean }[] }, finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
  usageMetadata?: { promptTokenCount?: number, candidatesTokenCount?: number, thoughtsTokenCount?: number }
  error?: { code?: number, message?: string, status?: string, details?: { '@type'?: string, retryDelay?: string, reason?: string, violations?: { quotaId?: string }[] }[] }
}

/**
 * Calls models/{model}:generateContent with responseMimeType application/json and the schema
 * as responseJsonSchema. The key goes in the x-goog-api-key header. Retries 429/5xx with
 * backoff (using the server's retryDelay when given), but not when a daily quota is used up.
 */
export function geminiGenerator(apiKey: string, model: string): JsonGenerator {
  return async ({ system, prompt, schema, maxOutputTokens, signal }) => {
    const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: jsonSchema, maxOutputTokens }
    })

    for (let attempt = 1; ; attempt++) {
      let response: Response
      try {
        response = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body,
          signal
        })
      } catch (error) {
        if (isAbort(error)) throw error
        if (attempt < GEMINI_MAX_ATTEMPTS) {
          await sleep(backoff(attempt), signal)
          continue
        }
        throw new AiError(`Could not reach the Gemini API: ${(error as Error).message}`)
      }

      const json = await response.json().catch(() => ({})) as GeminiResponse
      if (response.status === 429 || response.status >= 500) {
        const details = json.error?.details ?? []
        const daily = details.some(d => d.violations?.some(v => /PerDay/i.test(v.quotaId ?? '')))
        if (daily) throw new AiError('The daily Gemini quota for this key is used up. Try again tomorrow, or use a paid key.')
        if (attempt < GEMINI_MAX_ATTEMPTS) {
          const retryDelay = details.find(d => d.retryDelay)?.retryDelay
          const serverDelay = retryDelay ? Number.parseFloat(retryDelay) * 1000 : 0
          await sleep(Math.max(serverDelay, backoff(attempt)), signal)
          continue
        }
        throw new AiError(response.status === 429
          ? 'Rate limited by Gemini, even after several retries. Free keys allow only a few requests per minute; try again later.'
          : `Gemini is unavailable (${response.status}). Try again later.`)
      }
      if (!response.ok) {
        const reason = json.error?.details?.find(d => d.reason)?.reason
        if (reason === 'API_KEY_INVALID') throw new AiError('Google rejected the API key. Check it in Settings.')
        if (response.status === 404) throw new AiError(`Model "${model}" was not found. Check the model name in Settings.`)
        throw new AiError(`Gemini API error ${response.status}: ${json.error?.message ?? response.statusText}`)
      }

      const candidate = json.candidates?.[0]
      if (!candidate) throw new AiError(`Gemini returned no answer${json.promptFeedback?.blockReason ? ` (blocked: ${json.promptFeedback.blockReason})` : ''}.`)
      if (candidate.finishReason === 'MAX_TOKENS') throw new AiError('The answer was cut off because it hit the output token limit.')
      if (candidate.finishReason && candidate.finishReason !== 'STOP') throw new AiError(`Gemini stopped early (${candidate.finishReason}).`)

      const text = (candidate.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('')
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new AiError('Gemini returned invalid JSON.')
      }
      const result = schema.safeParse(parsed)
      if (!result.success) throw new AiError(`Gemini's answer did not match the expected format: ${formatZodIssues(result.error)}`)

      const usage = json.usageMetadata ?? {}
      return {
        data: result.data,
        usage: { input: usage.promptTokenCount ?? 0, output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) }
      }
    }
  }
}

// --- Helpers ----------------------------------------------------------------------------------

export function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error instanceof Anthropic.APIUserAbortError)
}

/** 4s, 8s, 16s, 32s, … capped at 60s, with jitter. */
function backoff(attempt: number): number {
  return Math.min(60_000, 2000 * 2 ** attempt) * (0.8 + Math.random() * 0.4)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}
