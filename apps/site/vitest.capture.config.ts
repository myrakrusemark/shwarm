// The unit run with every page and mail captured (test/capture/setup.ts), for the word-list move (go-live 11.8).
import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { setupFiles: ['test/capture/setup.ts'] } })
