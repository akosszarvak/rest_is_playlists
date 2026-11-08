import { createHash, randomBytes } from 'node:crypto'
import { SPOTIFY_SCOPES } from '#shared/spotify'

// RIP_SPOTIFY_ACCOUNTS_URL / RIP_SPOTIFY_API_URL point at a local mock for testing without an account.
const ACCOUNTS = process.env.RIP_SPOTIFY_ACCOUNTS_URL || 'https://accounts.spotify.com'
const API = process.env.RIP_SPOTIFY_API_URL || 'https://api.spotify.com/v1'
const MAX_ATTEMPTS = 5
const PENDING_LOGIN_TTL_MS = 15 * 60_000

interface TokenResponse {
  access_token: string
  token_type: string
  scope: string
  expires_in: number
  refresh_token?: string
}

// --- PKCE login ---------------------------------------------------------------------------------

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/** Starts a PKCE login: stores verifier + state server-side and returns the authorize URL. */
export async function startLogin(): Promise<string> {
  const { spotify } = await getSettings()
  if (!spotify.clientId) throw createError({ statusCode: 400, message: 'Add your Spotify Client ID in Settings first.' })

  const verifier = base64url(randomBytes(64)) // 86 chars, within Spotify's 43–128
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(16))
  await updateSpotify((s) => { s.pending = { verifier, state, createdAt: Date.now() } })

  const params = new URLSearchParams({
    client_id: spotify.clientId,
    response_type: 'code',
    redirect_uri: spotifyRedirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES.join(' '),
    state
  })
  return `${ACCOUNTS}/authorize?${params}`
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
  })
  const json = await response.json().catch(() => ({})) as TokenResponse & { error?: string, error_description?: string }
  if (!response.ok) {
    throw new SpotifyError(`Spotify login failed: ${json.error_description ?? json.error ?? response.statusText}`, response.status)
  }
  return json
}

/** Finishes the login: checks state, exchanges the code, stores tokens and the user. */
export async function finishLogin(code: string, state: string): Promise<void> {
  const { spotify } = await getSettings()
  const stored = await readSpotify()
  const pending = stored.pending
  if (!pending || pending.state !== state || Date.now() - pending.createdAt > PENDING_LOGIN_TTL_MS) {
    throw new SpotifyError('The login expired or did not start here. Please try again.', 400)
  }
  const token = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: spotifyRedirectUri(),
    client_id: spotify.clientId,
    code_verifier: pending.verifier
  })
  if (!token.refresh_token) throw new SpotifyError('Spotify did not return a refresh token.', 502)

  await updateSpotify((s) => {
    s.pending = null
    s.auth = {
      clientId: spotify.clientId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token!,
      expiresAt: Date.now() + token.expires_in * 1000,
      scope: token.scope
    }
  })
  const me = await spotifyFetch<{ id: string, display_name: string | null }>('/me')
  await updateSpotify((s) => { s.user = { id: me.id, displayName: me.display_name } })
}

export async function logout(): Promise<void> {
  await updateSpotify((s) => {
    s.auth = null
    s.user = null
    s.pending = null
  })
}

// --- Tokens -------------------------------------------------------------------------------------

let refreshing: Promise<string> | null = null

/** A valid access token, refreshed when it expires within a minute. One refresh at a time. */
async function accessToken(force = false): Promise<string> {
  const { auth } = await readSpotify()
  if (!auth) throw new SpotifyError('Not connected to Spotify. Connect on the Export page.', 401)
  if (!force && auth.expiresAt - Date.now() > 60_000) return auth.accessToken

  refreshing ??= (async () => {
    try {
      const token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refreshToken, client_id: auth.clientId })
      await updateSpotify((s) => {
        if (!s.auth) return
        s.auth.accessToken = token.access_token
        s.auth.expiresAt = Date.now() + token.expires_in * 1000
        // Spotify may or may not return a new refresh token; keep the old one if not.
        if (token.refresh_token) s.auth.refreshToken = token.refresh_token
      })
      return token.access_token
    } catch (error) {
      if (error instanceof SpotifyError && error.status === 400) {
        // Refresh token revoked or expired (they last six months): the user must log in again.
        await logout()
        throw new SpotifyError('The Spotify session expired. Please connect again.', 401)
      }
      throw error
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

// --- API calls ----------------------------------------------------------------------------------

export class SpotifyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number>
}

/**
 * Calls the Web API with the stored token. Refreshes on 401 once, waits on 429 (Retry-After)
 * and retries 5xx, and turns errors into readable messages.
 */
export async function spotifyFetch<T = unknown>(pathOrUrl: string, options: FetchOptions = {}): Promise<T> {
  const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`)
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value))

  let forceRefresh = false
  for (let attempt = 1; ; attempt++) {
    const token = await accessToken(forceRefresh)
    let response: Response
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          'authorization': `Bearer ${token}`,
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined
      })
    } catch (error) {
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 1000 * attempt))
        continue
      }
      throw new SpotifyError(`Could not reach Spotify: ${(error as Error).message}`, 502)
    }

    if (response.ok) {
      const text = await response.text()
      return (text ? JSON.parse(text) : null) as T
    }

    const json = await response.json().catch(() => ({})) as { error?: { message?: string, reason?: string } | string, error_description?: string }
    const apiError = typeof json.error === 'object' ? json.error : undefined
    const message = apiError?.message ?? (typeof json.error === 'string' ? json.error : response.statusText)

    if (response.status === 401 && !forceRefresh) {
      forceRefresh = true
      continue
    }
    if (response.status === 429) {
      if (apiError?.reason === 'QUOTA_EXCEEDED') {
        throw new SpotifyError('The Spotify API quota for your developer account is used up. Try again later.', 429)
      }
      if (attempt < MAX_ATTEMPTS) {
        const wait = Number(response.headers.get('retry-after') ?? '5')
        if (wait > 120) throw new SpotifyError(`Spotify asks to wait ${Math.round(wait / 60)} minutes before more requests. Try again later.`, 429)
        await new Promise(r => setTimeout(r, (wait + 1) * 1000))
        continue
      }
    }
    if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, 2000 * attempt))
      continue
    }
    if (response.status === 403) {
      throw new SpotifyError(`Spotify refused the request (403: ${message}). In Development Mode the app owner needs Spotify Premium and your account must be on the app's user list.`, 403)
    }
    throw new SpotifyError(`Spotify API error ${response.status}: ${message}`, response.status)
  }
}

/** Fetches every page of a paged endpoint (following `next`). */
export async function fetchAllPages<T>(path: string, query: Record<string, string | number> = {}): Promise<T[]> {
  const items: T[] = []
  let page = await spotifyFetch<{ items: (T | null)[], next: string | null }>(path, { query: { limit: 50, ...query } })
  for (;;) {
    items.push(...page.items.filter((i): i is T => i !== null))
    if (!page.next) return items
    page = await spotifyFetch(page.next)
  }
}

