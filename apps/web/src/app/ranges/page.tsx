'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/** 구 URL 호환: 레인지 뷰어는 프리플랍 차트 페이지의 탭으로 통합되었습니다. */
export default function RangesRedirectPage() {
  useEffect(() => {
    window.location.replace('/charts?tab=ranges');
  }, []);

  return (
    <div className="container">
      <h1>레인지 뷰어</h1>
      <p className="subtitle">
        레인지 뷰어는 <strong>프리플랍 차트</strong> 페이지의 탭으로 통합되었습니다. 잠시 후 자동으로
        이동합니다…
      </p>
      <p>
        <Link href="/charts?tab=ranges">자동으로 이동하지 않으면 여기를 누르세요 →</Link>
      </p>
    </div>
  );
}
