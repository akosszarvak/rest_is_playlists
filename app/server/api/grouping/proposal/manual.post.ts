import { manualAnswerRequestSchema, parseAnswer } from '#shared/proposal'

/** Turns a pasted chatbot answer into the open proposal (SPEC 5.2). Doesn't touch grouping.json. */
export default defineEventHandler(async (event) => {
  const { mode, text } = await readBodyWith(event, manualAnswerRequestSchema)
  const ctx = await proposalContext()
  let result
  try {
    result = parseAnswer(mode, text, ctx)
  } catch (error) {
    throw createError({ statusCode: 422, message: (error as Error).message })
  }
  return storeProposal(mode, 'manual', result, ctx.revision)
})
