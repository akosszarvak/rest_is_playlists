import { z } from 'zod'
import { AI_PROVIDERS, type ConnectionTestResult } from '#shared/settings'

const paramsSchema = z.object({ provider: z.enum(AI_PROVIDERS) })

/** Tests the saved key and model for one AI provider. */
export default defineEventHandler(async (event): Promise<ConnectionTestResult> => {
  const params = paramsSchema.safeParse(event.context.params)
  if (!params.success) {
    throw createError({ statusCode: 404, message: `Unknown provider. Use one of: ${AI_PROVIDERS.join(', ')}.` })
  }

  const settings = await getSettings()
  const { provider } = params.data
  const { apiKey, model } = settings[provider]
  if (!apiKey) {
    return { ok: false, message: 'No API key saved yet. Add one and save first.' }
  }
  return provider === 'anthropic' ? checkAnthropic(apiKey, model) : checkGemini(apiKey, model)
})
