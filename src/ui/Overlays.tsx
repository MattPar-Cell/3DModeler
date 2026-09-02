import type { Provenance } from '../core/params.ts';

/** Read-only figures pinned to the top-right of the viewport. */
export function StatStrip({
  items,
}: {
  readonly items: readonly { label: string; value: string }[];
}) {
  return (
    <div className="stat-strip">
      {items.map((item) => (
        <div className="stat" key={item.label}>
          <div className="stat-label">{item.label}</div>
          <div className="stat-value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

const LEGEND: readonly { provenance: Provenance; text: string }[] = [
  { provenance: 'measured', text: 'Measured — you entered this' },
  { provenance: 'scanned', text: 'Scanned — read off a photograph' },
  { provenance: 'derived', text: 'Derived — computed from a measurement' },
  { provenance: 'estimated', text: 'Estimated — from population priors' },
];

/**
 * Confidence legend and the shading toggle. Estimated regions are always drawn
 * translucent; the toggle additionally recolours every part by provenance.
 */
export function ConfidenceLegend({
  enabled,
  onToggle,
}: {
  readonly enabled: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <>
      <div className="overlay">
        {LEGEND.map((row) => (
          <div className="legend-row" key={row.provenance}>
            <span className="swatch" data-provenance={row.provenance} />
            <span>{row.text}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="secondary"
        onClick={onToggle}
        style={{ position: 'absolute', bottom: 14, right: 14 }}
        aria-pressed={enabled}
      >
        {enabled ? 'Material colours' : 'Confidence colours'}
      </button>
    </>
  );
}
