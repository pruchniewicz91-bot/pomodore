import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serwuje projekt pod /<nazwa-repo>/; serwer deweloperski pod /.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/pomodore/' : '/',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true },
}))
