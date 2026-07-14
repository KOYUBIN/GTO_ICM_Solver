'use client';

import { useMemo, useState } from 'react';
import { parseRange, rangePercent } from '@gto/engine';
import { RangeGrid } from '@/components/RangeGrid';
import { HandGridPicker } from '@/components/Pickers';

const PRESETS: { name: string; range: string }[] = [
  { name: 'UTG 오픈 (~15%)', range: '55+, ATs+, KQs, QJs, JTs, AQo+, KQo' },
  { name: 'BTN 오픈 (~45%)', range: '22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A7o+, K9o+, Q9o+, J9o+, T9o' },
  { name: 'BB 콜 vs BTN', range: '22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 74s+, 64s+, 53s+, A2o+, K7o+, Q9o+, J9o+, T9o' },
  { name: '3벳 밸류 (~4%)', range: 'QQ+, AKs, AKo' },
];

export default function RangesPage() {
  const [input, setInput] = useState(PRESETS[0].range);
  const [showPicker, setShowPicker] = useState(false);

  const { range, percent, error } = useMemo(() => {
    try {
      const r = parseRange(input);
      return { range: r, percent: rangePercent(r), error: '' };
    } catch (e) {
      return { range: new Map<string, number>(), percent: 0, error: (e as Error).message };
    }
  }, [input]);

  return (
    <div className="container">
      <h1>레인지 뷰어</h1>
      <p className="subtitle">
        솔버 표기법을 지원합니다: <code>22+</code>, <code>ATs+</code>, <code>A5s-A2s</code>,{' '}
        <code>AKo</code>, 가중치 <code>AKs:0.5</code>.
      </p>

      <div className="card">
        <label>레인지</label>
        <textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} />
        <div style={{ marginTop: 8 }}>
          <button className="secondary" onClick={() => setShowPicker((v) => !v)} style={{ padding: '4px 12px', fontSize: 13 }}>
            {showPicker ? '그리드 선택 닫기' : '그리드로 선택'}
          </button>
        </div>
        {showPicker && (
          <div style={{ marginTop: 10 }}>
            <HandGridPicker value={input} onChange={setInput} />
          </div>
        )}
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PRESETS.map((p) => (
            <button key={p.name} className="secondary" onClick={() => setInput(p.range)}>
              {p.name}
            </button>
          ))}
        </div>
        {error && (
          <p className="muted" style={{ color: 'var(--danger)', marginTop: 10 }}>
            {error}
          </p>
        )}
      </div>

      <div className="card">
        <div className="stat">
          <span>핸드 비중</span>
          <span className="val">{percent.toFixed(1)}%</span>
        </div>
        <div className="stat">
          <span>그리드 셀</span>
          <span className="val">{range.size} / 169</span>
        </div>
        <div style={{ marginTop: 16 }}>
          <RangeGrid range={range} />
        </div>
      </div>
    </div>
  );
}
