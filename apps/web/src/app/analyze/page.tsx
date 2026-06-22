'use client';

import { useState } from 'react';
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
} from '@gto/engine';
import { PlayingCards } from '@/components/Cards';

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

export default function AnalyzePage() {
  const [text, setText] = useState(SAMPLE);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedHand | null>(null);
  const [analysis, setAnalysis] = useState<{ category?: string; equity?: number } | null>(null);

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

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setImageUrl(URL.createObjectURL(file));
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
            <p className="muted" style={{ marginTop: 8 }}>
              이미지에서 텍스트 자동 추출(OCR)은 곧 지원됩니다. 현재는 위 텍스트 영역에 핸드 히스토리를
              붙여넣어 분석하세요. (스크린샷은 기록·공유용으로 보관됩니다)
            </p>
          </div>
        )}
      </div>

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
