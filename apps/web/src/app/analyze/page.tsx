'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  parseHandHistory,
  summarizeHand,
  calcEquity,
  evaluate7,
  parseCards,
  categoryOf,
  CATEGORY_NAMES,
  fullDeck,
  type Combo,
  type ParsedHand,
  type OcrPokerResult,
} from '@gto/engine';
import { PlayingCards } from '@/components/Cards';
import { ocrImage } from '@/lib/ocr';

const SAMPLE = `PokerStars Hand #210000000001: Hold'em No Limit ($0.25/$0.50 USD)
Seat 1: Hero ($50.00 in chips)
Seat 2: Villain ($62.50 in chips)
*** HOLE CARDS ***
Dealt to Hero [As Kh]
Hero: raises 1.5 to 2
Villain: calls 2
*** FLOP *** [Ah 7d 2c]
Hero: bets 3
Villain: calls 3
*** TURN *** [Ah 7d 2c] [Ts]
Hero: bets 8
Villain: calls 8
*** RIVER *** [Ah 7d 2c Ts] [9h]
Hero: checks
Villain: bets 20
Hero: calls 20
*** SHOW DOWN ***`;

/** All 2-card combos not clashing with the given used cards. */
function randomVillainCombos(used: Set<number>): Combo[] {
  const deck = fullDeck().filter((c) => !used.has(c));
  const out: Combo[] = [];
  for (let i = 0; i < deck.length; i++)
    for (let j = i + 1; j < deck.length; j++) out.push([deck[i], deck[j]]);
  return out;
}

/** Join detected card tokens into a card string, keeping only valid cards. */
function validCardString(tokens: string[]): string {
  const out: string[] = [];
  const used = new Set<string>();
  for (const t of tokens) {
    try {
      parseCards(t);
      if (!used.has(t)) {
        used.add(t);
        out.push(t);
      }
    } catch {
      /* skip */
    }
  }
  return out.join('');
}

export default function AnalyzePage() {
  const router = useRouter();
  const [text, setText] = useState(SAMPLE);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedHand | null>(null);
  const [analysis, setAnalysis] = useState<{ category?: string; equity?: number } | null>(null);
  const [ocr, setOcr] = useState<OcrPokerResult | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrError, setOcrError] = useState('');
  const imageUrlRef = useRef<string | null>(null);
  const ocrReqId = useRef(0);

  // Revoke the last object URL when the page unmounts.
  useEffect(() => () => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
  }, []);

  function analyze() {
    const h = parseHandHistory(text);
    setParsed(h);

    const result: { category?: string; equity?: number } = {};
    if (h.heroCards && h.board.length === 10) {
      const hero = parseCards(h.heroCards);
      const board = parseCards(h.board);
      const score = evaluate7([...hero, ...board]);
      result.category = CATEGORY_NAMES[categoryOf(score)];

      // Hero equity vs a random hand on this exact board.
      const used = new Set<number>([...hero, ...board]);
      const eq = calcEquity(
        [{ cards: h.heroCards }, { combos: randomVillainCombos(used) }],
        { board: h.board, iterations: 8000, seed: 99 },
      );
      result.equity = eq.equities[0];
    }
    setAnalysis(result);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Free the previous object URL, then track the new one in a ref.
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    const url = URL.createObjectURL(file);
    imageUrlRef.current = url;
    setImageUrl(url);
    // Monotonic request id so a slow earlier OCR can't overwrite a newer upload.
    const reqId = ++ocrReqId.current;
    setOcr(null);
    setOcrError('');
    setOcrBusy(true);
    setOcrProgress(0);
    try {
      const { text: ocrText, parsed: result } = await ocrImage(file, (p) => {
        if (reqId === ocrReqId.current) setOcrProgress(p);
      });
      if (reqId !== ocrReqId.current) return; // a newer upload superseded this one
      setOcr(result);
      // Drop the raw OCR text into the textarea so the text parser can also run.
      if (ocrText.trim()) setText(ocrText.trim());
    } catch (err) {
      if (reqId === ocrReqId.current) setOcrError((err as Error).message || 'OCR에 실패했습니다.');
    } finally {
      if (reqId === ocrReqId.current) setOcrBusy(false);
    }
  }

  /** Hand the OCR-detected board/pot/title off to the /replay analyzer. */
  function sendToReplay() {
    if (!ocr) return;
    const payload = {
      title: ocr.title ?? '',
      pot: ocr.pot != null ? String(ocr.pot) : '',
      cards: ocr.cards,
    };
    try {
      sessionStorage.setItem('replayPrefill', JSON.stringify(payload));
    } catch {
      /* sessionStorage may be unavailable */
    }
    router.push('/replay?from=ocr');
  }

  return (
    <div className="container">
      <h1>핸드 히스토리 분석</h1>
      <p className="subtitle">
        온라인 핸드 히스토리를 붙여넣거나 스크린샷을 올려 분석합니다. (PokerStars 형식 호환)
      </p>

      <div className="card">
        <label>핸드 히스토리 텍스트</label>
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
        <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={analyze}>분석</button>
          <label
            className="secondary"
            style={{
              display: 'inline-block',
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              cursor: 'pointer',
              color: 'var(--text)',
              margin: 0,
            }}
          >
            이미지 업로드
            <input type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
          </label>
        </div>
        {imageUrl && (
          <div style={{ marginTop: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="업로드한 핸드 히스토리"
              style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }}
            />
            {ocrBusy && (
              <div style={{ marginTop: 10 }}>
                <p className="muted" style={{ margin: '0 0 6px' }}>
                  스크린샷에서 텍스트 인식 중… {Math.round(ocrProgress * 100)}%
                </p>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.round(ocrProgress * 100)}%`,
                      height: '100%',
                      background: 'var(--accent)',
                      transition: 'width 0.2s',
                    }}
                  />
                </div>
              </div>
            )}
            {ocrError && (
              <p className="muted" style={{ color: 'var(--danger)', marginTop: 8 }}>
                {ocrError}
              </p>
            )}
            {!ocrBusy && !ocrError && !ocr && (
              <p className="muted" style={{ marginTop: 8 }}>
                스크린샷은 기록·공유용으로 보관됩니다.
              </p>
            )}
          </div>
        )}
      </div>

      {ocr && (
        <div className="card">
          <h2>OCR 인식 결과 (베타)</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            포커 화면의 무늬(♠♥♦♣)는 이미지라 인식이 불완전할 수 있습니다. 아래 결과를 확인하고 필요하면
            위 텍스트를 직접 수정해 분석하세요.
          </p>
          {ocr.title && (
            <div className="stat">
              <span>제목/토너먼트(추정)</span>
              <span className="val" style={{ fontSize: 15 }}>{ocr.title}</span>
            </div>
          )}
          {ocr.pot != null && (
            <div className="stat">
              <span>팟(추정)</span>
              <span className="val">{ocr.pot.toLocaleString()}</span>
            </div>
          )}
          {ocr.cards.length > 0 && (
            <div style={{ margin: '10px 0' }}>
              <span className="muted" style={{ marginRight: 8 }}>
                감지된 카드 ({ocr.cards.length})
              </span>
              <div style={{ marginTop: 6 }}>
                <PlayingCards cards={validCardString(ocr.cards)} />
              </div>
            </div>
          )}
          {ocr.cards.length === 0 && (
            <p className="muted" style={{ color: 'var(--warn)' }}>
              무늬까지 인식된 카드가 없습니다. 카드 무늬는 텍스트가 아니라 그래픽이라 인식이 어렵습니다.
              위 텍스트 영역에서 카드를 직접 입력하세요(예: AsKh).
            </p>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={analyze}>인식된 텍스트 분석</button>
            <button className="secondary" onClick={sendToReplay} disabled={ocr.cards.length < 2}>
              리플레이 분석으로 보내기
            </button>
          </div>
        </div>
      )}

      {parsed && (
        <div className="card">
          <h2>파싱 결과</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {summarizeHand(parsed)}
          </p>
          {parsed.heroCards && (
            <div style={{ margin: '8px 0' }}>
              <span className="muted" style={{ marginRight: 6 }}>
                핸드
              </span>
              <PlayingCards cards={parsed.heroCards} />
            </div>
          )}
          {parsed.board && (
            <div style={{ margin: '8px 0' }}>
              <span className="muted" style={{ marginRight: 6 }}>
                보드
              </span>
              <PlayingCards cards={parsed.board} />
            </div>
          )}
          {parsed.warnings.length > 0 && (
            <ul className="muted" style={{ color: 'var(--warn)' }}>
              {parsed.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {parsed.actions.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <strong>액션</strong>
              <div style={{ marginTop: 6 }}>
                {parsed.actions.map((a, i) => (
                  <div key={i} className="muted" style={{ fontSize: 13 }}>
                    [{a.street}] {a.player} {a.action}
                    {a.amount != null ? ` ${a.amount}` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {analysis && (analysis.category || analysis.equity != null) && (
        <div className="card">
          <h2>분석</h2>
          {analysis.category && (
            <div className="stat">
              <span>히어로 최종 핸드</span>
              <span className="val">{analysis.category}</span>
            </div>
          )}
          {analysis.equity != null && (
            <div className="stat">
              <span>랜덤 핸드 상대 에쿼티 (최종 보드)</span>
              <span className="val">{(analysis.equity * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
