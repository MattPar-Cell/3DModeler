import { loftGeometry } from '../core/loft.ts';
import type { GeneratedModel, GeneratedPart } from '../templates/types.ts';
import { fitBody } from './fit.ts';
import type { BodyFit, BodyFitInput } from './fit.ts';
import type { BodyParamKey } from './spec.ts';
import { REGION_PARAMS } from './segments.ts';
import type { BodyRegion } from './segments.ts';
import type { Provenance } from '../core/params.ts';

/**
 * Turn a fitted body into renderable parts.
 *
 * Each anatomical region becomes its own mesh, which is what lets the viewer
 * fade an inferred region without touching the measured ones. The regions meet
 * at shared landmark planes, so the surface stays continuous across the joins.
 */

/** Opacity for a region built from population priors alone. */
export const ESTIMATED_REGION_OPACITY = 0.42;

/** Matte studio clay. Deliberately not skin-toned: this is a measurement aid. */
const SKIN = { color: '#cbb5a4', roughness: 0.88, metalness: 0.0 };

export interface GeneratedBody extends GeneratedModel<BodyParamKey> {
  readonly fit: BodyFit;
  /** Per-region confidence, mirrored from the fit for the viewer's convenience. */
  readonly regionProvenance: Record<BodyRegion, Provenance>;
}

/** Fit, then build. The single entry point the UI calls. */
export function buildBody(input: BodyFitInput): GeneratedBody {
  const fit = fitBody(input);

  const regionProvenance = {} as Record<BodyRegion, Provenance>;
  for (const region of fit.regions) regionProvenance[region.region] = region.provenance;

  const parts: GeneratedPart[] = fit.segments.map((segment) => {
    const provenance = regionProvenance[segment.region] ?? 'estimated';
    return {
      id: segment.id,
      label: segment.label,
      geometry: loftGeometry(segment.rings, {
        capStart: segment.capStart,
        capEnd: segment.capEnd,
      }),
      color: SKIN.color,
      roughness: SKIN.roughness,
      metalness: SKIN.metalness,
      doubleSided: false,
      opacity: provenance === 'estimated' ? ESTIMATED_REGION_OPACITY : 1,
      confidence: provenance,
      drivenBy: REGION_PARAMS[segment.region],
    };
  });

  return {
    parts,
    params: fit.params,
    constraints: fit.constraints,
    height: fit.params.stature.value,
    fit,
    regionProvenance,
  };
}
