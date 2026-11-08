import { defineConfig } from 'vitest/config'

// Unit tests for framework-free code (shared/). No Nuxt runtime needed.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts']
  }
})
