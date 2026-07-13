'use client';

import { useCallback, useEffect, useState } from 'react';

interface Health {
  ok: boolean;
  backend?: string;
  roomBackend?: string;
  error?: string;
}

/**
 * DB 연결 마법사: 멀티플레이가 동작하려면 모든 서버 인스턴스가 공유하는
 * Postgres가 필요합니다. 이 페이지는 현재 상태를 실시간으로 확인하고, Vercel
 * 대시보드에서 해야 하는 단계를 그대로 안내합니다.
 */
export default function SetupPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      setHealth(await r.json());
    } catch (e) {
      setHealth({ ok: false, error: (e as Error).message });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const connected = health?.roomBackend === 'postgres';

  return (
    <div className="container" style={{ maxWidth: 760 }}>
      <h1>멀티플레이 DB 연결 설정</h1>
      <p className="subtitle">
        친구들과 같은 방에서 플레이하려면 서버 인스턴스들이 공유하는 Postgres 데이터베이스가 필요합니다.
        아래 순서대로 하면 약 2~3분 걸립니다. (무료)
      </p>

      <div
        className="card"
        style={{
          border: `2px solid ${connected ? 'var(--accent)' : 'var(--warn)'}`,
          background: connected ? 'rgba(63,185,80,0.08)' : 'rgba(210,153,34,0.08)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <strong style={{ color: connected ? 'var(--accent)' : 'var(--warn)', fontSize: 16 }}>
              {health == null
                ? '상태 확인 중…'
                : connected
                  ? '✅ 데이터베이스 연결됨 — 멀티플레이 사용 가능!'
                  : '⚠️ 아직 연결 안 됨 (임시 저장소 모드)'}
            </strong>
            {health && (
              <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                room store: <code>{health.roomBackend ?? '?'}</code>
                {health.error ? ` · 오류: ${health.error}` : ''}
              </div>
            )}
          </div>
          <button className="secondary" onClick={check} disabled={checking}>
            {checking ? '확인 중…' : '다시 확인'}
          </button>
        </div>
        {connected && (
          <p className="muted" style={{ marginTop: 10 }}>
            이제 <a href="/play" style={{ color: 'var(--accent)', fontWeight: 700 }}>홀덤</a>에서 방을 만들고
            코드를 공유하면 친구들이 어디서든 참가할 수 있습니다.
          </p>
        )}
      </div>

      {!connected && (
        <>
          <div className="card">
            <h2>방법 A — Vercel 대시보드에서 (권장)</h2>
            <ol style={{ margin: 0, paddingLeft: 22, lineHeight: 2, fontSize: 14 }}>
              <li>
                <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>
                  vercel.com/dashboard
                </a>
                에 로그인 → <strong>gto-icm-solver</strong> 프로젝트 클릭
              </li>
              <li>
                상단 탭에서 <strong>Storage</strong> 클릭 → <strong>Create Database</strong>
              </li>
              <li>
                <strong>Neon</strong> (Serverless Postgres) 선택 → 리전은 기본값(또는 Singapore) →{' '}
                <strong>Create</strong>
              </li>
              <li>
                “Connect Project”에서 <strong>gto-icm-solver</strong>를 선택해 연결 (환경변수{' '}
                <code>POSTGRES_URL</code>이 자동 주입됩니다)
              </li>
              <li>
                <strong>Deployments</strong> 탭 → 최신 배포 오른쪽 <strong>⋯</strong> → <strong>Redeploy</strong>
              </li>
              <li>배포가 끝나면 이 페이지로 돌아와 <strong>다시 확인</strong>을 누르세요</li>
            </ol>
          </div>

          <div className="card">
            <h2>방법 B — Neon에서 직접 (대안)</h2>
            <ol style={{ margin: 0, paddingLeft: 22, lineHeight: 2, fontSize: 14 }}>
              <li>
                <a href="https://neon.tech" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>
                  neon.tech
                </a>
                에서 무료 가입(GitHub 로그인) → 프로젝트 생성
              </li>
              <li>
                대시보드의 <strong>Connection string</strong> (<code>postgres://…</code>) 복사
              </li>
              <li>
                Vercel 프로젝트 → <strong>Settings → Environment Variables</strong> →{' '}
                <code>DATABASE_URL</code> 이름으로 붙여넣고 저장 (모든 환경 체크)
              </li>
              <li>
                <strong>Deployments → ⋯ → Redeploy</strong> 후 여기서 <strong>다시 확인</strong>
              </li>
            </ol>
            <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              이 앱은 <code>POSTGRES_URL</code>과 <code>DATABASE_URL</code> 둘 다 인식합니다. 테이블은 첫
              접속 때 자동 생성되므로 SQL을 만질 필요가 없습니다.
            </p>
          </div>

          <div className="card">
            <h2>자주 묻는 질문</h2>
            <p style={{ fontSize: 14, margin: '0 0 10px' }}>
              <strong>왜 DB가 필요한가요?</strong>
              <br />
              <span className="muted">
                Vercel 서버리스는 요청마다 다른 인스턴스가 처리할 수 있어, 메모리에만 저장된 방은 다른
                사람에게 보이지 않습니다. 공유 Postgres가 있으면 모든 인스턴스가 같은 방 데이터를 읽습니다.
              </span>
            </p>
            <p style={{ fontSize: 14, margin: 0 }}>
              <strong>비용이 드나요?</strong>
              <br />
              <span className="muted">Neon 무료 티어로 충분합니다 (홈게임 규모 기준).</span>
            </p>
          </div>
        </>
      )}
    </div>
  );
}
