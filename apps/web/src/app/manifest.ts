import type { MetadataRoute } from 'next';

// Served at /manifest.webmanifest — lets phones "홈 화면에 추가" and open the app
// full-screen like a native poker client.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GTO Solver — 홀덤 GTO/ICM',
    short_name: 'GTO Solver',
    description:
      '노리밋 홀덤 GTO·ICM 솔버 + 멀티플레이 홀덤. 에쿼티, 레인지, 차트, 푸시/폴드, 커뮤니티.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0e1116',
    theme_color: '#0e1116',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
