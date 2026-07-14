'use client';

import { allGridLabels } from '@gto/engine';

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const SUITS: { s: string; glyph: string }[] = [
  { s: 's', glyph: '♠' },
  { s: 'h', glyph: '♥' },
  { s: 'd', glyph: '♦' },
  { s: 'c', glyph: '♣' },
];

/** Cards currently in a card-string like "Ks7h2c" (case-normalized tokens). */
function tokensOf(value: string): string[] {
  return (value.replace(/\s+/g, '').match(/.{2}/g) ?? []).map(
    (t) => t[0].toUpperCase() + t[1].toLowerCase(),
  );
}

/**
 * Tap-to-pick board/hole cards: 4 suit rows × 13 ranks. Tapping toggles the
 * card in the bound string value; full (max reached) disables the rest.
 */
export function BoardPicker({
  value,
  onChange,
  max = 5,
  used = '',
}: {
  value: string;
  onChange: (v: string) => void;
  max?: number;
  /** Cards unavailable because another field uses them (e.g. hole cards). */
  used?: string;
}) {
  const picked = tokensOf(value);
  const taken = new Set(tokensOf(used));
  function toggle(tok: string) {
    if (picked.includes(tok)) {
      onChange(picked.filter((t) => t !== tok).join(''));
    } else if (picked.length < max) {
      onChange([...picked, tok].join(''));
    }
  }
  return (
    <div>
      {SUITS.map(({ s, glyph }) => (
        <div key={s} className="picker-suit-row">
          {RANKS.map((r) => {
            const tok = `${r}${s}`;
            const isPicked = picked.includes(tok);
            const disabled = taken.has(tok) || (!isPicked && picked.length >= max);
            return (
              <button
                key={tok}
                type="button"
                className={`pick-card suit-${s}${isPicked ? ' picked' : ''}`}
                disabled={disabled}
                onClick={() => toggle(tok)}
              >
                <span>{r}</span>
                <span>{glyph}</span>
              </button>
            );
          })}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {picked.length}/{max}장 선택
        </span>
        {picked.length > 0 && (
          <button type="button" className="secondary" onClick={() => onChange('')} style={{ padding: '3px 10px', fontSize: 12 }}>
            지우기
          </button>
        )}
      </div>
    </div>
  );
}

/** Common range presets for one-tap setup (grid labels, parseRange-ready). */
export const RANGE_PRESETS: { label: string; value: string }[] = [
  { label: '타이트 (~10%)', value: '77+, ATs+, KQs, AJo+, KQo' },
  { label: '스탠다드 (~20%)', value: '55+, A8s+, KTs+, QTs+, JTs, T9s, 98s, ATo+, KJo+, QJo' },
  {
    label: '와이드 (~35%)',
    value: '22+, A2s+, K7s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A7o+, K9o+, Q9o+, J9o+, T9o',
  },
  { label: '폴라라이즈드', value: 'JJ+, AKs, AKo, A5s-A2s, 76s, 65s, 54s' },
];

/**
 * 13x13 tap-to-toggle range editor. Emits a comma-joined grid-label string
 * compatible with parseRange ("AA, AKs, 77, ...").
 */
export function HandGridPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const labels = allGridLabels();
  const selected = new Set(
    value
      .split(',')
      .map((t) => t.trim())
      .filter((t) => /^[2-9TJQKA]{2}[so]?$/.test(t)),
  );
  function toggle(label: string) {
    const next = new Set(selected);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    // Keep grid order so the output string is stable and readable.
    onChange(labels.filter((l) => next.has(l)).join(', '));
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="secondary"
            onClick={() => onChange(p.value)}
            style={{ padding: '4px 10px', fontSize: 12 }}
          >
            {p.label}
          </button>
        ))}
        <button type="button" className="secondary" onClick={() => onChange('')} style={{ padding: '4px 10px', fontSize: 12 }}>
          비우기
        </button>
      </div>
      <div className="range-grid">
        {labels.map((label) => (
          <div
            key={label}
            className={`range-cell editable${selected.has(label) ? ' on' : ''}${label.length === 2 ? ' pair' : ''}`}
            onClick={() => toggle(label)}
          >
            {label}
          </div>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
        셀을 탭해 레인지에 넣거나 빼세요. 텍스트로 직접 수정해도 됩니다 (선택 {selected.size}개 라벨).
      </p>
    </div>
  );
}
