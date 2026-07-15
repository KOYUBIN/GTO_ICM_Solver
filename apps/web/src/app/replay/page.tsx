'use client';

import { useEffect, useRef, useState } from 'react';
import {
  streetEquities,
  parseCards,
  parseHandHistory,
  summarizeHand,
  calcEquity,
  evaluate7,
  categoryOf,
  CATEGORY_NAMES,
  fullDeck,
  type Combo,
  type ParsedHand,
  type OcrPokerResult,
  type StreetEquity,
} from '@gto/engine';
import { PlayingCards } from '@/components/Cards';
import { BoardPicker } from '@/components/Pickers';
import { ocrImage } from '@/lib/ocr';

const POSITIONS = ['UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const STREET_KO: Record<string, string> = { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버' };
const SUIT_GLYPH: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };

interface Player {
  name: string;
  pos: string;
  cards: string;
}

// Prefilled with a WPL-style example: KK vs 88 all-in, 88 spikes a set.
const DEFAULT_PLAYERS: Player[] = [
  { name: 'ubin', pos: 'BTN', cards: 'KsKc' },
  { name: 'Forgiven', pos: 'BB', cards: '8h8d' },
];

function isCards(s: string, n: number): boolean {
  const t = s.replace(/\s+/g, '');
  if (t.length !== n * 2) return false;
  try {
    return parseCards(t).length === n;
  } catch {
    return false;
  }
}

function ReplayTab() {
  const [title, setTitle] = useState('클래식 200억 GTD');
  const [pot, setPot] = useState('599114');
  const [board, setBoard] = useState('8s7c2d Qh 3s');
  const [players, setPlayers] = useState<Player[]>(DEFAULT_PLAYERS);
  // Which card picker is open: a player index, the board, or none.
  const [openIdx, setOpenIdx] = useState<number | 'board' | null>(null);
  const [result, setResult] = useState<{ rows: StreetEquity[]; players: Player[]; board: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fromOcr, setFromOcr] = useState(false);

  // Apply an OCR handoff from the 히스토리/OCR 분석 tab (best-effort: hole cards then board).
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem('replayPrefill');
    } catch {
      return;
    }
    if (!raw) return;
    try {
      sessionStorage.removeItem('replayPrefill');
    } catch {
      /* ignore */
    }
    try {
      const p = JSON.parse(raw) as { title?: string; pot?: string; cards?: string[] };
      if (p.title) setTitle(p.title);
      if (p.pot) setPot(p.pot);
      const cards = (p.cards ?? []).filter((c) => typeof c === 'string');
      if (cards.length >= 2) {
        // Guess: first two pairs are the two players' hole cards, rest is board.
        // Handles 2-3 detected cards too (matches the analyze button threshold).
        setPlayers([
          { name: 'P1', pos: 'BTN', cards: cards.slice(0, 2).join('') },
          { name: 'P2', pos: 'BB', cards: cards.length >= 4 ? cards.slice(2, 4).join('') : '' },
        ]);
        const board = cards.slice(4, 9);
        setBoard(board.length >= 3 ? board.join(' ') : '');
      }
      setFromOcr(true);
    } catch {
      /* ignore malformed prefill */
    }
  }, []);

  function setPlayer(i: number, patch: Partial<Player>) {
    setPlayers(players.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addPlayer() {
    if (players.length < 6) setPlayers([...players, { name: `P${players.length + 1}`, pos: 'CO', cards: '' }]);
  }
  function removePlayer(i: number) {
    if (players.length > 2) {
      setPlayers(players.filter((_, idx) => idx !== i));
      setOpenIdx(null); // indices shift; close any open picker
    }
  }

  /** Cards taken by other fields: other players' hole cards (+ board for a player picker). */
  function usedFor(target: number | 'board'): string {
    const others = players
      .filter((_, idx) => idx !== target)
      .map((p) => p.cards)
      .join('');
    return target === 'board' ? others : others + board;
  }

  function analyze() {
    setError('');
    const hands = players.map((p) => p.cards.replace(/\s+/g, ''));
    for (const [i, h] of hands.entries()) {
      if (!isCards(h, 2)) {
        setError(`${players[i].name || `P${i + 1}`}의 홀카드가 올바르지 않습니다 (예: KsKc).`);
        return;
      }
    }
    const b = board.replace(/\s+/g, '');
    if (b.length && (b.length % 2 !== 0 || b.length > 10 || !isCards(b, b.length / 2))) {
      setError('보드가 올바르지 않습니다 (0/3/4/5장, 예: 8s7c2d Qh 3s).');
      return;
    }
    setBusy(true);
    setTimeout(() => {
      try {
        const rows = streetEquities(hands, b, { iterations: 30000 });
        setResult({ rows, players: [...players], board: b });
      } catch (e) {
        setError((e as Error).message);
        setResult(null);
      } finally {
        setBusy(false);
      }
    }, 10);
  }

  return (
    <div className="container" style={{ maxWidth: 980 }}>
      <h1>핸드 리플레이 · 올인 에쿼티 분석</h1>
      <p className="subtitle">
        WPL식으로 올인 핸드를 입력하면 스트리트별 에쿼티(예: 88 vs KK = 19.5%)와 승자·결과를 보여줍니다.
      </p>

      {fromOcr && (
        <div
          className="card"
          style={{ borderColor: 'var(--accent)', background: 'rgba(88,166,255,0.06)', marginBottom: 14 }}
        >
          <strong>스크린샷에서 불러왔습니다 (베타)</strong>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            카드 무늬는 OCR 인식이 불완전할 수 있고, 홀카드/보드 배치는 추정입니다. 아래 값을 확인·수정한 뒤
            분석하세요.
          </p>
        </div>
      )}

      <div className="card">
        <div className="row">
          <div style={{ flex: 2 }}>
            <label>핸드/토너먼트 (선택)</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label>팟 (선택)</label>
            <input type="text" value={pot} onChange={(e) => setPot(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label>보드 (0/3/4/5장 · 예: 8s7c2d Qh 3s)</label>
          <div className="row" style={{ alignItems: 'center' }}>
            <input type="text" value={board} onChange={(e) => setBoard(e.target.value)} />
            <button
              type="button"
              className="secondary"
              onClick={() => setOpenIdx(openIdx === 'board' ? null : 'board')}
              style={{ flex: '0 0 auto', padding: '4px 10px', fontSize: 12 }}
            >
              선택 {openIdx === 'board' ? '▲' : '▼'}
            </button>
          </div>
          {openIdx === 'board' && (
            <div style={{ marginTop: 8 }}>
              <BoardPicker value={board} onChange={setBoard} max={5} used={usedFor('board')} />
            </div>
          )}
          {board.trim() && (
            <div style={{ marginTop: 8 }}>
              <PlayingCards cards={board} />
            </div>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <label>플레이어 (올인 참가자)</label>
          {players.map((p, i) => (
            <div key={i} style={{ marginTop: 8 }}>
              <div className="row" style={{ alignItems: 'center' }}>
                <input
                  type="text"
                  value={p.name}
                  placeholder="이름"
                  onChange={(e) => setPlayer(i, { name: e.target.value })}
                  style={{ flex: '0 0 110px' }}
                />
                <select value={p.pos} onChange={(e) => setPlayer(i, { pos: e.target.value })} style={{ flex: '0 0 90px' }}>
                  {POSITIONS.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={p.cards}
                  placeholder="홀카드 (예: KsKc)"
                  onChange={(e) => setPlayer(i, { cards: e.target.value })}
                />
                {p.cards.replace(/\s+/g, '').length === 4 && isCards(p.cards, 2) && <PlayingCards cards={p.cards} />}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setOpenIdx(openIdx === i ? null : i)}
                  style={{ flex: '0 0 auto', padding: '6px 10px', fontSize: 12 }}
                >
                  선택 {openIdx === i ? '▲' : '▼'}
                </button>
                <button
                  className="secondary"
                  onClick={() => removePlayer(i)}
                  disabled={players.length <= 2}
                  style={{ flex: '0 0 auto', padding: '6px 10px' }}
                >
                  삭제
                </button>
              </div>
              {openIdx === i && (
                <div style={{ marginTop: 8 }}>
                  <BoardPicker
                    value={p.cards}
                    onChange={(v) => setPlayer(i, { cards: v })}
                    max={2}
                    used={usedFor(i)}
                  />
                </div>
              )}
            </div>
          ))}
          <button className="secondary" style={{ marginTop: 8 }} onClick={addPlayer} disabled={players.length >= 6}>
            + 플레이어
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          <button onClick={analyze} disabled={busy}>
            {busy ? '분석 중…' : '분석'}
          </button>
        </div>
        {error && (
          <p className="muted" style={{ color: 'var(--danger)', marginTop: 10 }}>
            {error}
          </p>
        )}
      </div>

      {result && (
        <ReplayStage rows={result.rows} players={result.players} board={result.board} title={title} pot={pot} />
      )}
    </div>
  );
}

// ---------- WPL-broadcast-style replay stage ----------

const AVATAR_PALETTE = ['#7c5cff', '#0ea5e9', '#f97316', '#ec4899', '#14b8a6', '#eab308', '#8b5cf6', '#22c55e', '#ef4444'];

/** Name-hash palette index (same scheme as the play table's avatarColor). */
function avatarHash(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % AVATAR_PALETTE.length;
}

/** One color per player: name-hash first, then walk the palette so lines stay distinguishable. */
function playerColors(names: string[]): string[] {
  const used = new Set<number>();
  return names.map((n) => {
    let idx = avatarHash(n);
    while (used.has(idx) && used.size < AVATAR_PALETTE.length) idx = (idx + 1) % AVATAR_PALETTE.length;
    used.add(idx);
    return AVATAR_PALETTE[idx];
  });
}

/** One answered quiz step: Q1 leader pick + Q2 equity guess for the first player. */
interface QuizAnswer {
  pick: number; // Q1: chosen player index
  guess: number; // Q2: guessed equity % for players[0]
  q1Correct: boolean;
  err: number; // |guess - actual| in %p
}

/** A single card like "Ks" with the 4-color suit classes; `deal` animates it in. */
function CardSpan({ cs, w = 32, deal = false }: { cs: string; w?: number; deal?: boolean }) {
  const suit = (cs[1] ?? '').toLowerCase();
  return (
    <span
      className={`playing-card suit-${suit}${deal ? ' card-deal' : ''}`}
      style={{ width: w, height: Math.round(w * 1.4), fontSize: Math.round(w * 0.48), marginRight: 0 }}
    >
      {(cs[0] ?? '').toUpperCase()}
      {SUIT_GLYPH[suit] ?? suit}
    </span>
  );
}

function ReplayStage({
  rows,
  players,
  board,
  title,
  pot,
}: {
  rows: StreetEquity[];
  players: Player[];
  board: string;
  title: string;
  pot: string;
}) {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(false);
  // Quiz mode (GTO-트레이너 스타일): per-step answers keyed by step index.
  const [quizOn, setQuizOn] = useState(false);
  const [answers, setAnswers] = useState<Record<number, QuizAnswer>>({});
  const [pick, setPick] = useState<number | null>(null); // Q1: chosen player for the pending step
  const [guess, setGuess] = useState(50); // Q2: equity slider (0-100)
  const last = rows.length - 1;

  // New analysis -> rewind to the first street, stop auto-play, clear the quiz.
  useEffect(() => {
    setStep(0);
    setAuto(false);
    setQuizOn(false);
    setAnswers({});
  }, [rows]);

  // Each step gets fresh quiz inputs.
  useEffect(() => {
    setPick(null);
    setGuess(50);
  }, [step]);

  // Auto-play: advance one street every 1.2s; cleared on unmount, stopped at the end.
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, last)), 1200);
    return () => clearInterval(t);
  }, [auto, last]);
  useEffect(() => {
    if (auto && step >= last) setAuto(false);
  }, [auto, step, last]);

  function go(i: number) {
    setAuto(false);
    setStep(Math.max(0, Math.min(last, i)));
  }
  function toggleAuto() {
    if (auto) {
      setAuto(false);
      return;
    }
    if (step >= last) setStep(0);
    setAuto(true);
  }

  const cur = Math.min(step, last);
  const row = rows[cur];
  const atEnd = cur === last;
  const maxEq = Math.max(...row.equities);
  const finalEq = rows[last].equities;
  const winnerIdx = finalEq.indexOf(Math.max(...finalEq));
  const preEq = rows[0].equities;
  const preFavIdx = preEq.indexOf(Math.max(...preEq));
  const badBeat = rows.length > 1 && winnerIdx >= 0 && winnerIdx !== preFavIdx;
  const winnerName = players[winnerIdx]?.name || `P${winnerIdx + 1}`;
  const colors = playerColors(players.map((p, i) => p.name || `P${i + 1}`));
  const boardCards = board.match(/.{2}/g) ?? [];
  const potNum = Number(pot.replace(/[,\s]/g, ''));
  const potLabel = pot.trim() ? (Number.isFinite(potNum) ? potNum.toLocaleString() : pot) : '';

  // ---- quiz mode derived state ----
  const curAns = answers[cur];
  const quizPending = quizOn && !curAns; // current step not answered -> hide equities, ask
  const revealCur = !quizOn || !!curAns;
  const finalRevealed = !quizOn || answers[last] !== undefined;
  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount >= rows.length;
  const q1Count = Object.values(answers).filter((a) => a.q1Correct).length;
  const avgErr = answeredCount ? Object.values(answers).reduce((s, a) => s + a.err, 0) / answeredCount : 0;
  const grade: 'S' | 'A' | 'B' | 'C' =
    allAnswered && q1Count === rows.length && avgErr <= 5 ? 'S' : avgErr <= 10 ? 'A' : avgErr <= 18 ? 'B' : 'C';
  const leaderIdx = row.equities.indexOf(maxEq);
  const scoreVisible = quizOn && answers[last] !== undefined;

  function toggleQuiz() {
    if (quizOn) {
      setQuizOn(false);
      return;
    }
    // Turning on starts a fresh quiz and pauses auto-play.
    setAuto(false);
    setAnswers({});
    setPick(null);
    setGuess(50);
    setQuizOn(true);
  }
  function confirmQuiz() {
    if (pick === null) return;
    const err = Math.abs(guess - (row.equities[0] ?? 0) * 100);
    setAnswers((prev) => ({
      ...prev,
      [cur]: { pick, guess, q1Correct: (row.equities[pick] ?? 0) === maxEq, err },
    }));
  }
  function retryQuiz() {
    setAnswers({});
    setPick(null);
    setGuess(50);
    go(0);
  }

  return (
    <>
      <div className="card">
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}
        >
          <h2 style={{ margin: 0, fontSize: 17 }}>{title || '핸드'}</h2>
          <span className="muted">
            {STREET_KO[row.street]} · {cur + 1}/{rows.length}
          </span>
        </div>

        <div className="replay-stage">
          {/* Players around/above the board */}
          <div className="rp-players">
            {players.map((p, pi) => {
              const name = p.name || `P${pi + 1}`;
              const eq = row.equities[pi] ?? 0;
              const isLead = eq === maxEq && revealCur;
              const isWin = atEnd && pi === winnerIdx && revealCur;
              const hole = p.cards.replace(/\s+/g, '').match(/.{2}/g) ?? [];
              return (
                <div key={pi} className={`rp-pod${isWin ? ' rp-win' : ''}`}>
                  {isWin && <div className="rp-crown">👑</div>}
                  <div className="rp-pod-top">
                    <div className="rp-avatar" style={{ background: colors[pi] }}>
                      {name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="rp-cards">
                      {hole.map((cs, ci) => (
                        <CardSpan key={ci} cs={cs} />
                      ))}
                    </div>
                  </div>
                  <div className="rp-plate">
                    <span className="rp-name">{name}</span>
                    <span className="rp-pos">{p.pos}</span>
                  </div>
                  <div className={`rp-eq${isLead ? ' rp-lead' : ''}`}>
                    {revealCur ? (
                      <span key={cur} className="pot-bump">
                        {(eq * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="rp-eq-hidden" title="퀴즈 모드 — 정답 확정 후 공개">
                        ❓
                      </span>
                    )}
                    {isWin && (
                      <span className="pill push" style={{ marginLeft: 6 }}>
                        승
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Board: revealed progressively per step */}
          <div className="rp-board">
            <div className="pot-label">
              {STREET_KO[row.street]}
              {potLabel && (
                <>
                  {' '}
                  · 팟 <span style={{ fontWeight: 800 }}>{potLabel}</span>
                </>
              )}
            </div>
            <div className="rp-board-cards">
              {boardCards.length === 0 ? (
                <span className="rp-noboard">프리플랍 올인 — 보드 없음</span>
              ) : (
                boardCards.map((cs, i) =>
                  i < row.cards ? (
                    <CardSpan key={`${i}${cs}`} cs={cs} w={38} deal />
                  ) : (
                    <span key={`slot${i}`} className="rp-slot" />
                  ),
                )
              )}
            </div>
            {atEnd && badBeat && revealCur && (
              <div className="rp-badbeat">
                💥 배드빗 — 프리플랍 {((preEq[winnerIdx] ?? 0) * 100).toFixed(1)}% 언더독 {winnerName}의 역전승!
              </div>
            )}
          </div>
        </div>

        {/* Quiz panel: ask on unanswered steps, show stored feedback on answered ones */}
        {quizOn &&
          (quizPending ? (
            <div className="rp-quiz">
              <div className="rp-quiz-title">
                🎯 퀴즈 — {STREET_KO[row.street]} ({cur + 1}/{rows.length})
              </div>
              <div className="rp-quiz-q">Q1. 지금 누가 앞서 있을까요?</div>
              <div className="rp-quiz-opts">
                {players.map((p, pi) => {
                  const hole = p.cards.replace(/\s+/g, '').match(/.{2}/g) ?? [];
                  return (
                    <button
                      key={pi}
                      type="button"
                      className={`secondary rp-quiz-opt${pick === pi ? ' rp-quiz-opt-on' : ''}`}
                      onClick={() => setPick(pi)}
                    >
                      <span>{p.name || `P${pi + 1}`}</span>
                      <span style={{ display: 'inline-flex', gap: 2 }}>
                        {hole.map((cs, ci) => (
                          <CardSpan key={ci} cs={cs} w={22} />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="rp-quiz-q">
                Q2. {players[0]?.name || 'P1'}의 에쿼티는 몇 %일까요? — <strong style={{ color: 'var(--accent)' }}>{guess}%</strong>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={guess}
                onChange={(e) => setGuess(+e.target.value)}
                style={{ width: '100%' }}
              />
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button onClick={confirmQuiz} disabled={pick === null}>
                  확정
                </button>
                {pick === null && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    먼저 Q1에서 플레이어를 선택하세요.
                  </span>
                )}
              </div>
            </div>
          ) : (
            curAns && (
              <div className="rp-quiz">
                <div className="rp-quiz-title">🎯 퀴즈 결과 — {STREET_KO[row.street]}</div>
                <div className="rp-quiz-fb">
                  Q1 {curAns.q1Correct ? '✅ 정답!' : '❌ 오답'} — 리더:{' '}
                  <strong>{players[leaderIdx]?.name || `P${leaderIdx + 1}`}</strong> ({(maxEq * 100).toFixed(1)}%) · 내 선택:{' '}
                  {players[curAns.pick]?.name || `P${curAns.pick + 1}`}
                </div>
                <div className="rp-quiz-fb">
                  Q2 예측 {curAns.guess}% · 실제 {((row.equities[0] ?? 0) * 100).toFixed(1)}% · 오차{' '}
                  <strong>{curAns.err.toFixed(1)}%p</strong> {curAns.err <= 10 ? '✅ 정답 (±10%p 이내)' : '❌ 오답 (±10%p 초과)'}
                </div>
              </div>
            )
          ))}

        {/* Step controls */}
        <div className="rp-controls">
          <button className="secondary" onClick={() => go(0)} disabled={cur === 0}>
            ⏮ 처음
          </button>
          <button className="secondary" onClick={() => go(cur - 1)} disabled={cur === 0}>
            ◀ 이전
          </button>
          <button className="secondary" onClick={toggleAuto} disabled={last === 0 || quizOn} title={quizOn ? '퀴즈 모드 중에는 자동재생을 사용할 수 없습니다' : undefined}>
            {auto ? '⏸ 정지' : '▶️ 자동재생'}
          </button>
          <button type="button" className={`secondary rp-quiz-toggle${quizOn ? ' rp-quiz-toggle-on' : ''}`} onClick={toggleQuiz}>
            🎯 퀴즈 모드{quizOn ? ' ON' : ''}
          </button>
          <button className="secondary" onClick={() => go(cur + 1)} disabled={cur === last}>
            ▶ 다음
          </button>
          <button className="secondary" onClick={() => go(last)} disabled={cur === last}>
            ⏭ 끝
          </button>
        </div>
        <div className="rp-tabs">
          {rows.map((r, i) => (
            <button key={r.street} type="button" className={`rp-tab${i === cur ? ' rp-tab-on' : ''}`} onClick={() => go(i)}>
              {STREET_KO[r.street]}
            </button>
          ))}
        </div>

        {/* Scorecard once the last available step has been answered */}
        {scoreVisible && (
          <div className="rp-score">
            <div className="rp-quiz-title" style={{ marginBottom: 10 }}>
              📋 퀴즈 성적표
            </div>
            <div className="rp-score-row">
              <span>
                Q1 리더 맞히기{' '}
                <strong>
                  {q1Count} / {rows.length}
                </strong>
              </span>
              <span>
                Q2 평균 오차 <strong>{avgErr.toFixed(1)}%p</strong>
              </span>
              <span className={`rp-grade rp-grade-${grade.toLowerCase()}`} title={`등급 ${grade}`}>
                {grade}
              </span>
            </div>
            <button className="secondary" onClick={retryQuiz}>
              🔄 다시 도전
            </button>
          </div>
        )}
      </div>

      {/* Per-street summary: table + equity line graph */}
      <div className="card">
        <h2 style={{ fontSize: 16 }}>스트리트별 에쿼티 요약</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: 'var(--text-dim)', textAlign: 'right' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>플레이어</th>
                {rows.map((r) => (
                  <th key={r.cards} style={{ padding: '6px 8px' }}>
                    {STREET_KO[r.street]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {players.map((p, pi) => {
                const isWinner = pi === winnerIdx && finalRevealed;
                return (
                  <tr
                    key={pi}
                    style={{
                      borderTop: '1px solid var(--border)',
                      background: isWinner ? 'rgba(63,185,80,0.08)' : undefined,
                    }}
                  >
                    <td style={{ padding: '8px', textAlign: 'left' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ minWidth: 70 }}>
                          <strong>{p.name || `P${pi + 1}`}</strong>
                          <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                            {p.pos}
                          </span>
                        </span>
                        <PlayingCards cards={p.cards} />
                        {isWinner && (
                          <span className="pill push" style={{ marginLeft: 4 }}>
                            승
                          </span>
                        )}
                      </div>
                    </td>
                    {rows.map((r, ri) => {
                      const eq = r.equities[pi];
                      const hidden = quizOn && answers[ri] === undefined; // quiz: not answered yet
                      const best = !hidden && eq === Math.max(...r.equities);
                      return (
                        <td
                          key={r.cards}
                          style={{
                            padding: '8px',
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: best ? 700 : 400,
                            color: hidden ? 'var(--text-dim)' : best ? 'var(--accent)' : 'var(--text)',
                          }}
                        >
                          {hidden ? '?' : `${(eq * 100).toFixed(1)}%`}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 16 }}>
          <EquityGraph rows={rows} colors={colors} step={cur} mask={rows.map((_, i) => quizOn && answers[i] === undefined)} />
          <div className="rp-legend">
            {players.map((p, pi) => (
              <span key={pi}>
                <span className="rp-dot" style={{ background: colors[pi] }} />
                {p.name || `P${pi + 1}`}
              </span>
            ))}
            <span style={{ fontSize: 11 }}>세로 점선 = 현재 스트리트</span>
          </div>
        </div>

        {winnerIdx >= 0 && (!quizOn || allAnswered) && (
          <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
            올인 시점(프리플랍) 에쿼티 —{' '}
            {players.map((p, i) => `${p.name || `P${i + 1}`} ${((preEq[i] ?? 0) * 100).toFixed(1)}%`).join(' · ')}.{' '}
            최종 승자: <strong style={{ color: 'var(--accent)' }}>{winnerName}</strong>
            {badBeat ? ' (언더독 역전 — 배드빗)' : ''}.
          </p>
        )}
      </div>
    </>
  );
}

/** Inline SVG line graph: equity % per street, one player-colored polyline with dots.
 *  `mask[i]` hides step i's values (quiz mode: not answered yet). */
function EquityGraph({
  rows,
  colors,
  step,
  mask,
}: {
  rows: StreetEquity[];
  colors: string[];
  step: number;
  mask?: boolean[];
}) {
  const W = 380;
  const H = 150;
  const padL = 36;
  const padR = 14;
  const padT = 12;
  const padB = 24;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const x = (i: number) => (rows.length <= 1 ? padL + iw / 2 : padL + (iw * i) / (rows.length - 1));
  const y = (e: number) => padT + (1 - e) * ih;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', maxWidth: 480, height: 'auto', display: 'block' }}
      role="img"
      aria-label="스트리트별 에쿼티 변화 그래프"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line
            x1={padL}
            x2={W - padR}
            y1={y(g)}
            y2={y(g)}
            stroke="var(--border)"
            strokeWidth={g === 0.5 ? 1 : 0.5}
            strokeDasharray={g === 0.5 ? '4 3' : undefined}
          />
          {(g === 0 || g === 0.5 || g === 1) && (
            <text x={padL - 5} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--text-dim)">
              {Math.round(g * 100)}%
            </text>
          )}
        </g>
      ))}
      {/* Current step marker */}
      <line x1={x(step)} x2={x(step)} y1={padT} y2={padT + ih} stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="2 3" />
      {rows.map((r, i) => (
        <text
          key={r.cards}
          x={x(i)}
          y={H - 6}
          textAnchor="middle"
          fontSize="10"
          fontWeight={i === step ? 700 : 400}
          fill={i === step ? 'var(--text)' : 'var(--text-dim)'}
        >
          {STREET_KO[r.street]}
        </text>
      ))}
      {colors.map((c, pi) => (
        <g key={pi}>
          <polyline
            points={rows
              .map((r, i) => (mask?.[i] ? null : `${x(i)},${y(r.equities[pi] ?? 0)}`))
              .filter((p): p is string => p !== null)
              .join(' ')}
            fill="none"
            stroke={c}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {rows.map((r, i) =>
            mask?.[i] ? null : (
              <circle
                key={r.cards}
                cx={x(i)}
                cy={y(r.equities[pi] ?? 0)}
                r={i === step ? 4 : 2.5}
                fill={c}
                stroke="var(--bg-card)"
                strokeWidth={1}
              />
            ),
          )}
        </g>
      ))}
      {/* Masked steps (quiz mode, unanswered): "?" placeholder */}
      {mask?.some(Boolean) &&
        rows.map((r, i) =>
          mask[i] ? (
            <text key={r.cards} x={x(i)} y={y(0.5) + 3} textAnchor="middle" fontSize="11" fill="var(--text-dim)">
              ?
            </text>
          ) : null,
        )}
    </svg>
  );
}

// ---------- 히스토리/OCR 분석 (구 /analyze 페이지 통합) ----------

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

function AnalyzeTab({ onSendToReplay }: { onSendToReplay: () => void }) {
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

  // Revoke the last object URL when the tab unmounts.
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

  /** Hand the OCR-detected board/pot/title off to the 리플레이 분석 tab. */
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
    // 같은 페이지의 리플레이 탭으로 전환 — 탭이 마운트되면서 prefill을 읽습니다.
    onSendToReplay();
  }

  return (
    <div className="container" style={{ maxWidth: 980 }}>
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

// ---------- 페이지: 상단 탭 (리플레이 분석 / 히스토리·OCR 분석) ----------

type ReplayTopTab = 'replay' | 'analyze';

const REPLAY_TOP_TABS: [ReplayTopTab, string][] = [
  ['replay', '리플레이 분석'],
  ['analyze', '히스토리/OCR 분석'],
];

export default function ReplayPage() {
  // null = 아직 탭 미결정 (mount 후 URL·prefill을 읽고 결정 — SSR 안전).
  // 자식보다 먼저 판정해야 리플레이 탭의 prefill 소비 순서가 안전합니다.
  const [tab, setTab] = useState<ReplayTopTab | null>(null);

  // 구 /analyze 리다이렉트용 딥링크: /replay?tab=analyze (useSearchParams 대신 직접 읽음).
  // replayPrefill 핸드오프가 대기 중이면 어느 탭이든 리플레이 탭으로 자동 전환합니다.
  useEffect(() => {
    let hasPrefill = false;
    try {
      hasPrefill = !!sessionStorage.getItem('replayPrefill');
    } catch {
      /* sessionStorage may be unavailable */
    }
    const want = new URLSearchParams(window.location.search).get('tab');
    setTab(hasPrefill ? 'replay' : want === 'analyze' ? 'analyze' : 'replay');
  }, []);

  function switchTab(t: ReplayTopTab) {
    setTab(t);
    try {
      window.history.replaceState(null, '', t === 'analyze' ? '/replay?tab=analyze' : '/replay');
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <div className="container" style={{ maxWidth: 980, paddingBottom: 0 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {REPLAY_TOP_TABS.map(([t, lbl]) => (
            <button key={t} className={tab === t ? '' : 'secondary'} onClick={() => switchTab(t)}>
              {lbl}
            </button>
          ))}
        </div>
      </div>
      {tab === 'replay' && <ReplayTab />}
      {tab === 'analyze' && <AnalyzeTab onSendToReplay={() => switchTab('replay')} />}
    </>
  );
}
