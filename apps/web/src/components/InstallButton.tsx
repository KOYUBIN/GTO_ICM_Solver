'use client';

import { useEffect, useState } from 'react';

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * "앱 설치" button: uses the browser install prompt where available
 * (Android/Chrome), falls back to add-to-home-screen instructions on iOS.
 * Hidden when already running as an installed app (standalone).
 */
export function InstallButton() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [standalone, setStandalone] = useState(true); // assume hidden until mount
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    setStandalone(isStandalone);
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setStandalone(true);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (standalone) return null;

  async function install() {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') setDeferred(null);
    } else {
      setShowHelp((v) => !v);
    }
  }

  return (
    <span style={{ position: 'relative' }}>
      <button onClick={install} style={{ background: 'var(--blue)' }}>
        📲 앱 설치
      </button>
      {showHelp && (
        <span
          className="card"
          style={{
            position: 'absolute',
            top: '110%',
            left: 0,
            zIndex: 20,
            width: 260,
            fontSize: 13,
            padding: 12,
            display: 'block',
          }}
        >
          <strong>홈 화면에 추가하는 법</strong>
          <br />
          iPhone(Safari): 공유 버튼 → <b>홈 화면에 추가</b>
          <br />
          Android(Chrome): 메뉴 ⋮ → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>
        </span>
      )}
    </span>
  );
}
