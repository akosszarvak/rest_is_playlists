export default defineEventHandler(async () => {
  await discardProposal()
  return { ok: true }
})
