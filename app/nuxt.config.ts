// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],

  // Spotify only accepts an explicit loopback IP as redirect host, not "localhost".
  devServer: { host: '127.0.0.1', port: 3000 },

  app: {
    head: { title: 'Rest Is Playlists' }
  }
})
