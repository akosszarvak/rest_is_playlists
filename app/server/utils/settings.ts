import {
  settingsFileSchema,
  type FieldView,
  type SecretView,
  type SettingsFile,
  type SettingsUpdate,
  type SettingsView
} from '#shared/settings'

const settingsPath = () => repoPath('.data', 'settings.json')

/**
 * Optional overrides for power users, read from the environment (or app/.env).
 * Prefixed with RIP_ so a globally exported ANTHROPIC_API_KEY is never picked up by accident.
 */
const ENV = {
  spotifyClientId: 'RIP_SPOTIFY_CLIENT_ID',
  anthropicApiKey: 'RIP_ANTHROPIC_API_KEY',
  anthropicModel: 'RIP_ANTHROPIC_MODEL',
  geminiApiKey: 'RIP_GEMINI_API_KEY',
  geminiModel: 'RIP_GEMINI_MODEL'
} as const

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined
}

/** Settings as stored in `.data/settings.json`, with defaults for missing fields. */
async function readSettingsFile(): Promise<SettingsFile> {
  return (await readJsonFile(settingsPath(), settingsFileSchema)) ?? settingsFileSchema.parse({})
}

/** Effective settings with environment overrides applied. Server-side only: holds full secrets. */
export async function getSettings(): Promise<SettingsFile> {
  const file = await readSettingsFile()
  return {
    ...file,
    spotify: { clientId: env(ENV.spotifyClientId) ?? file.spotify.clientId },
    anthropic: {
      apiKey: env(ENV.anthropicApiKey) ?? file.anthropic.apiKey,
      model: env(ENV.anthropicModel) ?? file.anthropic.model
    },
    gemini: {
      apiKey: env(ENV.geminiApiKey) ?? file.gemini.apiKey,
      model: env(ENV.geminiModel) ?? file.gemini.model
    }
  }
}

function field(fileValue: string, envName: string): FieldView {
  const fromEnv = env(envName)
  return fromEnv ? { value: fromEnv, source: 'env' } : { value: fileValue, source: 'file' }
}

function secret(fileValue: string, envName: string): SecretView {
  const fromEnv = env(envName)
  const value = fromEnv ?? fileValue
  // Only show a hint for real-length keys, so a short value is never mostly revealed.
  const hint = value.length >= 16 ? `…${value.slice(-4)}` : ''
  return { set: Boolean(value), hint, source: fromEnv ? 'env' : 'file' }
}

/** Browser-safe view of the settings. Secrets are reduced to their last 4 characters. */
export async function getSettingsView(): Promise<SettingsView> {
  const file = await readSettingsFile()
  return {
    spotify: { clientId: field(file.spotify.clientId, ENV.spotifyClientId) },
    anthropic: {
      apiKey: secret(file.anthropic.apiKey, ENV.anthropicApiKey),
      model: field(file.anthropic.model, ENV.anthropicModel)
    },
    gemini: {
      apiKey: secret(file.gemini.apiKey, ENV.geminiApiKey),
      model: field(file.gemini.model, ENV.geminiModel)
    },
    playlists: {
      namePrefix: { value: file.playlists.namePrefix, source: 'file' },
      visibility: { value: file.playlists.visibility, source: 'file' }
    }
  }
}

/** Resolves a secret update: `undefined` keeps the old value, `null` clears it. */
function nextSecret(current: string, update: string | null | undefined): string {
  return update === undefined ? current : (update ?? '')
}

/** Applies a validated partial update to `.data/settings.json`. */
export async function updateSettings(update: SettingsUpdate): Promise<void> {
  const file = await readSettingsFile()
  const next: SettingsFile = {
    spotify: { ...file.spotify, ...update.spotify },
    anthropic: {
      model: update.anthropic?.model ?? file.anthropic.model,
      apiKey: nextSecret(file.anthropic.apiKey, update.anthropic?.apiKey)
    },
    gemini: {
      model: update.gemini?.model ?? file.gemini.model,
      apiKey: nextSecret(file.gemini.apiKey, update.gemini?.apiKey)
    },
    playlists: { ...file.playlists, ...update.playlists }
  }
  await writeJsonFile(settingsPath(), settingsFileSchema.parse(next))
}
