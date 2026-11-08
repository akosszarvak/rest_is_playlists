import { settingsUpdateSchema } from '#shared/settings'

export default defineEventHandler(async (event) => {
  const update = await readBodyWith(event, settingsUpdateSchema)
  await updateSettings(update)
  return getSettingsView()
})
