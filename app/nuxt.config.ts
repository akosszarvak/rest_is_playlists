// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],

  // Spotify only accepts an explicit loopback IP as redirect host, not "localhost".
  devServer: { host: '127.0.0.1', port: 3000 },

  runtimeConfig: {
    // Repo root that holds data/ and .data/. The Nuxt project itself lives in app/.
    // Override with NUXT_REPO_ROOT.
    repoRoot: fileURLToPath(new URL('..', import.meta.url)),
    // Must exactly match a redirect URI registered in the Spotify app. Override with
    // NUXT_SPOTIFY_REDIRECT_URI (e.g. when running on another port).
    spotifyRedirectUri: 'http://127.0.0.1:3000/api/spotify/callback'
  },

  app: {
    head: { title: 'Rest Is Playlists' }
  }
})
