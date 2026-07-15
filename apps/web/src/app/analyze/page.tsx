'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/** 구 URL 호환: 핸드 히스토리 분석은 핸드 리플레이 페이지의 탭으로 통합되었습니다. */
export default function AnalyzeRedirectPage() {
  useEffect(() => {
    window.location.replace('/replay?tab=analyze');
  }, []);

  return (
    <div className="container">
      <h1>핸드 히스토리 분석</h1>
      <p className="subtitle">
        핸드 히스토리 분석은 <strong>리플레이 · 분석</strong> 페이지로 통합되었습니다. 잠시 후 자동으로
        이동합니다…
      </p>
      <p>
        <Link href="/replay?tab=analyze">자동으로 이동하지 않으면 여기를 누르세요 →</Link>
      </p>
    </div>
  );
}
