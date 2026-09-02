import type { RegionConfidence } from '../body/fit.ts';
import { BODY_PARAM_SPECS } from '../body/spec.ts';

/**
 * Per-region confidence indicator.
 *
 * This is the honesty surface of the body model: it says, region by region,
 * whether the shape you are looking at came from a tape measure, from a
 * calculation, or from a population average. Regions rated `estimated` are the
 * ones drawn translucent in the viewer.
 */
export function RegionConfidenceList({ regions }: { readonly regions: readonly RegionConfidence[] }) {
  return (
    <div className="regions">
      {regions.map((region) => (
        <div className="region-row" key={region.region} data-provenance={region.provenance} title={tooltip(region)}>
          <span className="dot" aria-hidden="true" />
          <span className="region-name">{region.label}</span>
          <span className="region-tag">{region.provenance}</span>
        </div>
      ))}
    </div>
  );
}

function tooltip(region: RegionConfidence): string {
  const lines = region.drivenBy.map(
    (item) => `${BODY_PARAM_SPECS[item.key].label}: ${item.provenance}`,
  );
  return `Shaped by —\n${lines.join('\n')}`;
}
