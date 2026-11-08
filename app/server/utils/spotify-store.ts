import { spotifyFileSchema, type SpotifyFile } from '#shared/spotify'

const spotifyPath = () => repoPath('.data', 'spotify.json')

/** Reads .data/spotify.json (tokens, matches, exported playlist ids). Defaults if missing. */
export async function readSpotify(): Promise<SpotifyFile> {
  return (await readJsonFile(spotifyPath(), spotifyFileSchema)) ?? spotifyFileSchema.parse({})
}

let queue: Promise<unknown> = Promise.resolve()

/** Read-modify-write of .data/spotify.json, one update at a time. */
export function updateSpotify<T>(change: (state: SpotifyFile) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const state = await readSpotify()
    const result = await change(state)
    await writeJsonFile(spotifyPath(), spotifyFileSchema.parse(state))
    return result
  })
  queue = run.catch(() => {})
  return run
}

export function spotifyRedirectUri(): string {
  return useRuntimeConfig().spotifyRedirectUri
}
