import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { build: { rollupOptions: { external: ['electron'] } } },
  preload: { build: { rollupOptions: { output: { format: 'cjs' }, external: ['electron'] } } },
  renderer: { plugins: [react()] }
})
