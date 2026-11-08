import { acceptRequestSchema } from '#shared/proposal'

/** Accepts all or part of the open proposal after the user reviewed the diff. */
export default defineEventHandler(async (event) => {
  const { revision, playlists, exclusions } = await readBodyWith(event, acceptRequestSchema)
  return acceptProposal(revision, { playlists, exclusions })
})
