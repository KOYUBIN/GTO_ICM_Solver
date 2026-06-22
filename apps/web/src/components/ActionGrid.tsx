'use client';

import { allGridLabels } from '@gto/engine';

export interface ActionGridProps {
  /** label -> action frequencies (each cell's freqs should sum to ~1). */
  data: Map<string, Record<string, number>>;
  /** action -> color, in stacking order (first = bottom of the cell). */
  colors: { action: string; color: string; label: string }[];
  /** Currently selected hand label (highlighted). */
  selected?: string | null;
  /** Click handler — enables hand selection. */
  onSelect?: (label: string) => void;
}

/**
 * 13x13 grid where each cell is split vertically into colored bands sized by
 * each action's frequency — the GTO-Wizard style strategy view. Optionally
 * clickable to select a hand.
 */
export function ActionGrid({ data, colors, selected, onSelect }: ActionGridProps) {
  const labels = allGridLabels();
  return (
    <div>
      <div className="range-grid">
        {labels.map((label) => {
          const freqs = data.get(label);
          const isSel = selected === label;
          return (
            <div
              key={label}
              className="range-cell"
              onClick={onSelect ? () => onSelect(label) : undefined}
              style={{
                position: 'relative',
                padding: 0,
                cursor: onSelect ? 'pointer' : 'default',
                outline: isSel ? '2px solid #fff' : undefined,
                outlineOffset: isSel ? '-2px' : undefined,
                zIndex: isSel ? 2 : undefined,
              }}
            >
              {freqs && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
                  {colors.map(({ action, color }) => {
                    const f = freqs[action] ?? 0;
                    if (f <= 0) return null;
                    return <div key={action} style={{ height: `${f * 100}%`, background: color }} />;
                  })}
                </div>
              )}
              <span
                style={{
                  position: 'relative',
                  zIndex: 1,
                  color: freqs ? '#0a0e13' : 'var(--text-dim)',
                  fontWeight: 700,
                }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
        {colors.map(({ action, color, label }) => (
          <span key={action} className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: color, display: 'inline-block' }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
