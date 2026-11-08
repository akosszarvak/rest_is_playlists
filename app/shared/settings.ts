import { z } from 'zod'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5'
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash'
export const DEFAULT_PLAYLIST_PREFIX = 'RIH · '

export const AI_PROVIDERS = ['anthropic', 'gemini'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

/** Shape of `.data/settings.json`. Missing fields fall back to defaults. */
export const settingsFileSchema = z.object({
  spotify: z.object({
    clientId: z.string().default('')
  }).prefault({}),
  anthropic: z.object({
    apiKey: z.string().default(''),
    model: z.string().min(1).default(DEFAULT_ANTHROPIC_MODEL)
  }).prefault({}),
  gemini: z.object({
    apiKey: z.string().default(''),
    model: z.string().min(1).default(DEFAULT_GEMINI_MODEL)
  }).prefault({}),
  playlists: z.object({
    namePrefix: z.string().max(40).default(DEFAULT_PLAYLIST_PREFIX),
    visibility: z.enum(['private', 'public']).default('private')
  }).prefault({})
})
export type SettingsFile = z.infer<typeof settingsFileSchema>

/** Where an effective value comes from. `env` values can't be edited in the UI. */
export type ValueSource = 'file' | 'env'

export interface SecretView {
  set: boolean
  /** Last 4 characters only, e.g. "…a1b2". Empty when not set. */
  hint: string
  source: ValueSource
}

export interface FieldView<T = string> {
  value: T
  source: ValueSource
}

/** What `GET /api/settings` returns. Never contains a full secret. */
export interface SettingsView {
  spotify: { clientId: FieldView }
  anthropic: { apiKey: SecretView, model: FieldView }
  gemini: { apiKey: SecretView, model: FieldView }
  playlists: { namePrefix: FieldView, visibility: FieldView<'private' | 'public'> }
}

const trimmed = z.string().trim()
/** A secret in an update: omit to keep, `null` to remove, a string to replace. */
const secretUpdate = trimmed.min(1, 'Key must not be empty. Use Remove to clear it.').max(500).nullable()
const modelName = trimmed.min(1, 'Model name is required.').max(100)

/** Body of `PUT /api/settings`. Only the sent fields change. */
export const settingsUpdateSchema = z.strictObject({
  spotify: z.strictObject({
    clientId: trimmed.regex(/^([0-9a-f]{32})?$/i, 'A Spotify Client ID is 32 hexadecimal characters.')
  }).partial().optional(),
  anthropic: z.strictObject({ apiKey: secretUpdate, model: modelName }).partial().optional(),
  gemini: z.strictObject({ apiKey: secretUpdate, model: modelName }).partial().optional(),
  playlists: z.strictObject({
    namePrefix: z.string().max(40, 'Keep the prefix under 40 characters.'),
    visibility: z.enum(['private', 'public'])
  }).partial().optional()
})
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>

export interface ConnectionTestResult {
  ok: boolean
  message: string
}
