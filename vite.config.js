import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    exclude: ['**/.claude/**', '**/node_modules/**', '**/dist/**'],
  },
  resolve: {
    alias: [
      // Stub the agent-toolset (Node.js-only) so browser build succeeds
      {
        find: /.*\/agent-toolset\/fs-util\.mjs$/,
        replacement: path.resolve(__dirname, 'src/stubs/empty.js'),
      },
      {
        find: /.*\/agent-toolset\/node\.mjs$/,
        replacement: path.resolve(__dirname, 'src/stubs/empty.js'),
      },
      {
        find: /.*\/agent-toolset\/skills\.mjs$/,
        replacement: path.resolve(__dirname, 'src/stubs/empty.js'),
      },
    ],
  },
})
