'use client';

import { allGridLabels } from '@gto/engine';

/**
 * 13x13 starting-hand grid. Cells present in `range` (label -> weight) are
 * highlighted with opacity proportional to their weight.
 */
export function RangeGrid({ range }: { range: Map<string, number> }) {
  const labels = allGridLabels();
  return (
    <div className="range-grid">
      {labels.map((label) => {
        const weight = range.get(label) ?? 0;
        const isPair = label[0] === label[1];
        return (
          <div
            key={label}
            className={`range-cell${weight > 0 ? ' on' : ''}${isPair ? ' pair' : ''}`}
            style={weight > 0 && weight < 1 ? { opacity: 0.35 + weight * 0.65 } : undefined}
            title={`${label}${weight < 1 && weight > 0 ? ` (${Math.round(weight * 100)}%)` : ''}`}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}
