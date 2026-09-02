import type { BufferGeometry } from 'three';
import type { ConstraintReport, ParamSet, Provenance } from '../core/params.ts';

/**
 * A generated part of an assembled model. Parts are produced fresh on every
 * parameter change; nothing here is persisted.
 */
export interface GeneratedPart {
  /** Stable id, unique within the model. */
  readonly id: string;
  readonly label: string;
  readonly geometry: BufferGeometry;
  /** Base colour, linear-sRGB hex. */
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
  /** Emitted colour, for surfaces lit from within such as a lampshade. */
  readonly emissive: string;
  readonly emissiveIntensity: number;
  /** Render both faces. Set for open shells such as a lamp shade. */
  readonly doubleSided: boolean;
  /** Extra opacity multiplier, used to fade purely inferred body regions. */
  readonly opacity: number;
  /**
   * Worst provenance among the parameters that shaped this part. Drives the
   * "measured vs estimated" shading in the viewer: parts built entirely from
   * priors are rendered translucent.
   */
  readonly confidence: Provenance;
  /** Which parameters shaped this part, for the confidence tooltip. */
  readonly drivenBy: readonly string[];
}

/** Everything a viewer needs for one solved model. */
export interface GeneratedModel<K extends string> {
  readonly parts: readonly GeneratedPart[];
  readonly params: ParamSet<K>;
  readonly constraints: readonly ConstraintReport[];
  /** Overall bounding height in cm, useful for framing the camera. */
  readonly height: number;
}

/** Release the GPU buffers held by a previously generated model. */
export function disposeModel(model: { parts: readonly GeneratedPart[] } | null): void {
  if (model === null) return;
  for (const part of model.parts) part.geometry.dispose();
}
