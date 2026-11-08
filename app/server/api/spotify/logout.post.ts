export default defineEventHandler(async () => {
  await logout()
  return { ok: true }
})
