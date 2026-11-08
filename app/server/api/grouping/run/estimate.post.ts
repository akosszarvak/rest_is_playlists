import { estimateRequestSchema } from '#shared/ai-run'

export default defineEventHandler(async (event) => {
  const { mode } = await readBodyWith(event, estimateRequestSchema)
  return estimateAiRun(mode)
})
