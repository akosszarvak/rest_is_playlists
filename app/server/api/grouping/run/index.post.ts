import { startRunRequestSchema } from '#shared/ai-run'

/** Starts an AI grouping run. The result becomes a proposal; data/grouping.json is never touched. */
export default defineEventHandler(async (event) => {
  const { provider, mode } = await readBodyWith(event, startRunRequestSchema)
  return { status: await startRun(provider, mode) }
})
