import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 로컬 dev에서 /api/* 호출은 Vercel 배포본으로 프록시 → GROQ/네이버 키 로컬에 둘 필요 없음.
// 결정: Vercel API Routes는 vite dev가 못 돌리므로 배포본을 빌려 쓴다.
const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev'

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(commitSha),
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://clothes-ai-three.vercel.app',
        changeOrigin: true,
        secure: true,
      },
      // 로컬 누끼용 — 네이버 쇼핑 이미지 CORS 우회 (dev 전용, 배포본은 별도 프록시 필요)
      '/np-img': {
        target: 'https://shopping-phinf.pstatic.net',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/np-img/, ''),
      },
    },
  },
})
