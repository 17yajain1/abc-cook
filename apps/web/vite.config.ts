/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Generated TS types from the Pydantic JSON Schema (`make types`).
      '@abc-cook/schema': fileURLToPath(
        new URL('../../packages/schema/index.ts', import.meta.url),
      ),
      // Own source. Keep this in step with `paths` in tsconfig.app.json — Vite resolves
      // the bundle, tsc resolves the types, and they are configured separately.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
