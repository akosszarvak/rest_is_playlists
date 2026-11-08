import { promptRequestSchema } from '#shared/proposal'

/** Builds the copy/paste prompt for the manual grouping method (SPEC 5.2). */
export default defineEventHandler(async (event) => {
  const { mode, detail } = await readBodyWith(event, promptRequestSchema)
  return buildGroupingPrompt(mode, detail)
})
