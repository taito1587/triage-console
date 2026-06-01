import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 本番は FastAPI が dist を配信。開発時は /api を :8000 にプロキシ。
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  build: { outDir: 'dist' },
})
