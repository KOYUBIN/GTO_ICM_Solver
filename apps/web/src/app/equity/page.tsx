'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/** 구 URL 호환: 에쿼티 계산기는 레인지 매치업 페이지의 탭으로 통합되었습니다. */
export default function EquityRedirectPage() {
  useEffect(() => {
    window.location.replace('/matchup?tab=equity');
  }, []);

  return (
    <div className="container">
      <h1>에쿼티 계산기</h1>
      <p className="subtitle">
        에쿼티 계산기는 <strong>매치업 · 에쿼티</strong> 페이지로 통합되었습니다. 잠시 후 자동으로
        이동합니다…
      </p>
      <p>
        <Link href="/matchup?tab=equity">자동으로 이동하지 않으면 여기를 누르세요 →</Link>
      </p>
    </div>
  );
}
