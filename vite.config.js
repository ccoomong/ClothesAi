import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 로컬 dev에서 /api/* 호출은 Vercel 배포본으로 프록시 → GROQ/네이버 키 로컬에 둘 필요 없음.
// 결정: Vercel API Routes는 vite dev가 못 돌리므로 배포본을 빌려 쓴다.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://clothes-ai-seven.vercel.app',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
