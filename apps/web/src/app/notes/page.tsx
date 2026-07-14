'use client';

import { useEffect, useRef, useState } from 'react';
import { PlayingCards } from '@/components/Cards';
import { BoardPicker } from '@/components/Pickers';

const STORAGE_KEY = 'gto-hand-journal';
const POSITIONS = ['UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const RESULTS = ['승', '패', '무', '폴드'] as const;
type Result = (typeof RESULTS)[number];

interface Entry {
  id: string;
  date: string;
  place: string;
  blinds: string;
  position: string;
  hand: string;
  board: string;
  action: string;
  result: Result;
  amount: number;
  memo: string;
}

interface Note {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
}

/** Local YYYY-MM-DD (date input format). */
function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "AsKh 7c" -> ["As","Kh","7c"] */
function toTokens(s: string): string[] {
  return s.replace(/\s+/g, '').match(/.{2}/g) ?? [];
}

function byNewest(a: Entry, b: Entry): number {
  return b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
}

/** Coerce an unknown imported value into an Entry (merge by id). */
function asEntry(x: unknown): Entry | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  return {
    id: o.id,
    date: String(o.date ?? ''),
    place: String(o.place ?? ''),
    blinds: String(o.blinds ?? ''),
    position: String(o.position ?? 'BTN'),
    hand: String(o.hand ?? ''),
    board: String(o.board ?? ''),
    action: String(o.action ?? ''),
    result: (RESULTS as readonly string[]).includes(String(o.result)) ? (o.result as Result) : '폴드',
    amount: Number(o.amount) || 0,
    memo: String(o.memo ?? ''),
  };
}

function asNote(x: unknown): Note | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  return {
    id: o.id,
    title: String(o.title ?? ''),
    body: String(o.body ?? ''),
    updatedAt: Number(o.updatedAt) || Date.now(),
  };
}

/** Result pill: 승 = green +금액, 패/폴드 = red -금액, 무 = neutral. */
function ResultBadge({ result, amount }: { result: Result; amount: number }) {
  const sign = result === '승' ? 1 : result === '무' ? 0 : -1;
  const cls = sign > 0 ? 'pill push' : sign < 0 ? 'pill fold' : 'pill marginal';
  const amt = amount ? ` ${sign >= 0 ? '+' : '-'}${Math.abs(amount).toLocaleString()}` : '';
  return (
    <span className={cls}>
      {result}
      {amt}
    </span>
  );
}

// Date/file inputs aren't covered by the global input[type='text'] styles.
const dateInputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  padding: '8px 11px',
  fontSize: 14,
  fontFamily: 'inherit',
};

export default function NotesPage() {
  const [tab, setTab] = useState<'hands' | 'notes'>('hands');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');

  // Entry form
  const [date, setDate] = useState('');
  const [place, setPlace] = useState('');
  const [blinds, setBlinds] = useState('');
  const [position, setPosition] = useState('BTN');
  const [hand, setHand] = useState('');
  const [board, setBoard] = useState('');
  const [action, setAction] = useState('');
  const [result, setResult] = useState<Result>('폴드');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [openPicker, setOpenPicker] = useState<'hand' | 'board' | null>(null);

  // List / notes UI
  const [search, setSearch] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');

  // Load from localStorage on mount (SSR-safe: only runs in the browser).
  useEffect(() => {
    setDate(todayStr());
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { entries?: unknown[]; notes?: unknown[] };
        setEntries((Array.isArray(p.entries) ? p.entries : []).map(asEntry).filter((e): e is Entry => e !== null));
        setNotes((Array.isArray(p.notes) ? p.notes : []).map(asNote).filter((n): n is Note => n !== null));
      }
    } catch {
      /* localStorage unavailable or corrupt — start empty */
    }
    setLoaded(true);
  }, []);

  // Persist on every change (after the initial load).
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries, notes }));
    } catch {
      /* ignore (private mode / quota) */
    }
  }, [entries, notes, loaded]);

  function saveEntry() {
    const entry: Entry = {
      id: Date.now().toString(36),
      date: date || todayStr(),
      place: place.trim(),
      blinds: blinds.trim(),
      position,
      hand: hand.trim(),
      board: board.trim(),
      action: action.trim(),
      result,
      amount: Number(amount) || 0,
      memo: memo.trim(),
    };
    setEntries([entry, ...entries]);
    // Keep session context (date/place/blinds/position), clear the hand itself.
    setHand('');
    setBoard('');
    setAction('');
    setAmount('');
    setMemo('');
    setOpenPicker(null);
    setMsg('저장했습니다.');
  }

  function removeEntry(id: string) {
    if (!window.confirm('이 핸드 기록을 삭제할까요?')) return;
    setEntries(entries.filter((e) => e.id !== id));
  }

  /** Same handoff format as the analyze page: replay guesses hole cards/board. */
  function openReplay(e: Entry) {
    const payload = {
      title: e.place,
      pot: String(e.amount || ''),
      cards: [...toTokens(e.hand), ...toTokens(e.board)],
    };
    try {
      sessionStorage.setItem('replayPrefill', JSON.stringify(payload));
    } catch {
      /* ignore */
    }
    window.open('/replay?from=journal', '_blank');
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ entries, notes }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hand-journal-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function importJson(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const rawEntries = Array.isArray(parsed) ? parsed : ((parsed as { entries?: unknown }).entries ?? []);
      const rawNotes = Array.isArray(parsed) ? [] : ((parsed as { notes?: unknown }).notes ?? []);
      const haveE = new Set(entries.map((e) => e.id));
      const haveN = new Set(notes.map((n) => n.id));
      const newEntries = (Array.isArray(rawEntries) ? rawEntries : [])
        .map(asEntry)
        .filter((e): e is Entry => e !== null && !haveE.has(e.id));
      const newNotes = (Array.isArray(rawNotes) ? rawNotes : [])
        .map(asNote)
        .filter((n): n is Note => n !== null && !haveN.has(n.id));
      if (newEntries.length) setEntries([...entries, ...newEntries].sort(byNewest));
      if (newNotes.length) setNotes([...notes, ...newNotes]);
      setMsg(`가져오기 완료 — 핸드 ${newEntries.length}건, 노트 ${newNotes.length}건 추가.`);
    } catch {
      setMsg('가져오기 실패 — 올바른 JSON 파일이 아닙니다.');
    }
  }

  // Notes
  function addNote() {
    const n: Note = { id: Date.now().toString(36), title: '', body: '', updatedAt: Date.now() };
    setNotes([n, ...notes]);
    setEditId(n.id);
    setEditTitle('');
    setEditBody('');
  }
  function startEdit(n: Note) {
    setEditId(n.id);
    setEditTitle(n.title);
    setEditBody(n.body);
  }
  function saveNote() {
    if (!editId) return;
    setNotes(notes.map((n) => (n.id === editId ? { ...n, title: editTitle.trim(), body: editBody, updatedAt: Date.now() } : n)));
    setEditId(null);
  }
  function removeNote(id: string) {
    if (!window.confirm('이 노트를 삭제할까요?')) return;
    setNotes(notes.filter((n) => n.id !== id));
    if (editId === id) setEditId(null);
  }

  const q = search.trim().toLowerCase();
  const shown = q
    ? entries.filter((e) =>
        [e.date, e.place, e.blinds, e.position, e.hand, e.board, e.action, e.result, e.memo, String(e.amount)]
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
    : entries;
  const sortedNotes = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <h1>핸드 기록장 · 개인 노트</h1>
      <p className="subtitle">
        라이브 세션의 핸드와 메모를 이 기기에 저장합니다. 오프라인에서도 동작하며, JSON으로 내보내기/가져오기할 수
        있습니다.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={tab === 'hands' ? undefined : 'secondary'} onClick={() => setTab('hands')}>
          핸드 기록
        </button>
        <button className={tab === 'notes' ? undefined : 'secondary'} onClick={() => setTab('notes')}>
          개인 노트
        </button>
      </div>

      {tab === 'hands' && (
        <>
          <div className="card">
            <h2>새 핸드 기록</h2>
            <div className="row">
              <div>
                <label>날짜</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={dateInputStyle} />
              </div>
              <div>
                <label>장소/토너명</label>
                <input type="text" value={place} placeholder="예: 홀덤펍 클래식" onChange={(e) => setPlace(e.target.value)} />
              </div>
              <div>
                <label>블라인드</label>
                <input type="text" value={blinds} placeholder="예: 1k/2k" onChange={(e) => setBlinds(e.target.value)} />
              </div>
              <div>
                <label>포지션</label>
                <select value={position} onChange={(e) => setPosition(e.target.value)}>
                  {POSITIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label>내 핸드 (2장 · 예: AsKh)</label>
              <div className="row" style={{ alignItems: 'center' }}>
                <input type="text" value={hand} onChange={(e) => setHand(e.target.value)} />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setOpenPicker(openPicker === 'hand' ? null : 'hand')}
                  style={{ flex: '0 0 auto', minWidth: 0, padding: '4px 10px', fontSize: 12 }}
                >
                  선택 {openPicker === 'hand' ? '▲' : '▼'}
                </button>
                {toTokens(hand).length > 0 && <PlayingCards cards={hand} />}
              </div>
              {openPicker === 'hand' && (
                <div style={{ marginTop: 8 }}>
                  <BoardPicker value={hand} onChange={setHand} max={2} used={board} />
                </div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <label>보드 (0~5장 · 예: 8s7c2d Qh 3s)</label>
              <div className="row" style={{ alignItems: 'center' }}>
                <input type="text" value={board} onChange={(e) => setBoard(e.target.value)} />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setOpenPicker(openPicker === 'board' ? null : 'board')}
                  style={{ flex: '0 0 auto', minWidth: 0, padding: '4px 10px', fontSize: 12 }}
                >
                  선택 {openPicker === 'board' ? '▲' : '▼'}
                </button>
                {toTokens(board).length > 0 && <PlayingCards cards={board} />}
              </div>
              {openPicker === 'board' && (
                <div style={{ marginTop: 8 }}>
                  <BoardPicker value={board} onChange={setBoard} max={5} used={hand} />
                </div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <label>액션 요약</label>
              <textarea
                rows={2}
                value={action}
                placeholder="예: UTG 오픈 2.5bb, 내가 BTN 3벳 7.5bb, 콜. 플랍 체크-벳 콜..."
                onChange={(e) => setAction(e.target.value)}
              />
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <div>
                <label>결과</label>
                <select value={result} onChange={(e) => setResult(e.target.value as Result)}>
                  {RESULTS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>금액 (칩/원)</label>
                <input type="number" value={amount} placeholder="예: 120000" onChange={(e) => setAmount(e.target.value)} />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label>메모</label>
              <textarea
                rows={2}
                value={memo}
                placeholder="상대 성향, 내 판단 근거, 복기 포인트..."
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <button onClick={saveEntry}>저장</button>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0, flex: '1 1 auto' }}>기록 ({entries.length})</h2>
              <button className="secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={exportJson}>
                내보내기
              </button>
              <button
                className="secondary"
                style={{ padding: '6px 12px', fontSize: 13 }}
                onClick={() => fileRef.current?.click()}
              >
                가져오기
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                onChange={importJson}
                style={{ display: 'none' }}
              />
            </div>
            <input
              type="text"
              value={search}
              placeholder="검색 (장소, 핸드, 액션, 메모...)"
              onChange={(e) => setSearch(e.target.value)}
            />
            {msg && (
              <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                {msg}
              </p>
            )}

            {shown.length === 0 && (
              <p className="muted" style={{ marginTop: 14 }}>
                {entries.length === 0 ? '아직 기록이 없습니다. 위에서 첫 핸드를 저장해보세요.' : '검색 결과가 없습니다.'}
              </p>
            )}

            {shown.map((e) => (
              <div
                key={e.id}
                style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 14 }}
              >
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong>{e.date}</strong>
                  {e.place && <span>{e.place}</span>}
                  {e.blinds && <span className="muted">{e.blinds}</span>}
                  <span className="pill" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                    {e.position}
                  </span>
                  <ResultBadge result={e.result} amount={e.amount} />
                </div>
                {(e.hand || e.board) && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    {e.hand && (
                      <span>
                        <span className="muted" style={{ marginRight: 6 }}>
                          핸드
                        </span>
                        <PlayingCards cards={e.hand} />
                      </span>
                    )}
                    {e.board && (
                      <span>
                        <span className="muted" style={{ marginRight: 6 }}>
                          보드
                        </span>
                        <PlayingCards cards={e.board} />
                      </span>
                    )}
                  </div>
                )}
                {e.action && (
                  <p style={{ margin: '8px 0 0', fontSize: 14, whiteSpace: 'pre-wrap' }}>{e.action}</p>
                )}
                {e.memo && (
                  <p className="muted" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>
                    {e.memo}
                  </p>
                )}
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {e.hand.replace(/\s+/g, '').length === 4 && (
                    <button
                      className="secondary"
                      style={{ padding: '5px 12px', fontSize: 12 }}
                      onClick={() => openReplay(e)}
                    >
                      리플레이 분석
                    </button>
                  )}
                  <button
                    className="secondary"
                    style={{ padding: '5px 12px', fontSize: 12, color: 'var(--danger)' }}
                    onClick={() => removeEntry(e.id)}
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'notes' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, flex: '1 1 auto' }}>개인 노트 ({notes.length})</h2>
            <button style={{ padding: '6px 14px', fontSize: 13 }} onClick={addNote}>
              + 새 노트
            </button>
          </div>

          {sortedNotes.length === 0 && (
            <p className="muted">
              전략 아이디어, 상대 리드, 세션 회고 등을 자유롭게 적어두세요. 이 기기에만 저장됩니다.
            </p>
          )}

          {sortedNotes.map((n) => (
            <div key={n.id} style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 14 }}>
              {editId === n.id ? (
                <>
                  <input
                    type="text"
                    value={editTitle}
                    placeholder="제목"
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                  <textarea
                    rows={5}
                    value={editBody}
                    placeholder="내용"
                    onChange={(e) => setEditBody(e.target.value)}
                    style={{ marginTop: 8 }}
                  />
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button style={{ padding: '6px 14px', fontSize: 13 }} onClick={saveNote}>
                      저장
                    </button>
                    <button
                      className="secondary"
                      style={{ padding: '6px 14px', fontSize: 13 }}
                      onClick={() => setEditId(null)}
                    >
                      취소
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <strong style={{ flex: '1 1 auto' }}>{n.title || '(제목 없음)'}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {new Date(n.updatedAt).toLocaleString('ko-KR')}
                    </span>
                  </div>
                  {n.body && (
                    <p style={{ margin: '6px 0 0', fontSize: 14, whiteSpace: 'pre-wrap' }}>{n.body}</p>
                  )}
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button className="secondary" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => startEdit(n)}>
                      수정
                    </button>
                    <button
                      className="secondary"
                      style={{ padding: '5px 12px', fontSize: 12, color: 'var(--danger)' }}
                      onClick={() => removeNote(n.id)}
                    >
                      삭제
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
