import { create } from 'zustand';
import { segmentSubject } from '../scan/segment.ts';
import type { Seed } from '../scan/segment.ts';
import { silhouetteFrom } from '../scan/silhouette.ts';
import { loadRasterImage, thumbnailDataUrl } from '../scan/load.ts';
import type { Mask, RasterImage, Silhouette } from '../scan/types.ts';
import { clamp } from '../core/math.ts';

/**
 * Scanner state.
 *
 * Images live here for the length of the session and are never persisted: what
 * gets saved is the measurements they produced, plus a thumbnail small enough
 * to recognise the model by. That is the same rule the rest of the app follows —
 * store the parameters, regenerate everything else.
 */

export type ScanSubject = 'lamp' | 'body';
export type ScaleMode = 'known-height' | 'reference';
/** What a click on the preview does. */
export type ClickMode = 'none' | 'reference' | 'subject' | 'background';
export type ViewSlot = 'front' | 'side';

/** A loaded photograph and everything derived from it. */
export interface ScanView {
  readonly name: string;
  readonly image: RasterImage;
  readonly mask: Mask;
  readonly silhouette: Silhouette;
  readonly thumbnail: string;
  /** Operator corrections applied to this view's segmentation. */
  readonly seeds: readonly Seed[];
}

export interface ReferencePoint {
  readonly x: number;
  readonly y: number;
}

export interface ScanState {
  readonly subject: ScanSubject;
  /** Segmentation threshold multiplier, 0.5-1.8. */
  readonly sensitivity: number;
  readonly front: ScanView | null;
  readonly side: ScanView | null;
  readonly scaleMode: ScaleMode;
  /** What a click on the preview currently does. */
  readonly clickMode: ClickMode;
  /** Known overall height of the subject, cm. */
  readonly knownHeightCm: number;
  /** Known length of the reference the operator drew, cm. */
  readonly referenceCm: number;
  /** The two ends of the reference line, in front-image pixels. */
  readonly referencePoints: readonly ReferencePoint[];
  readonly busy: boolean;
  readonly error: string | null;

  setSubject: (subject: ScanSubject) => void;
  setSensitivity: (value: number) => void;
  setScaleMode: (mode: ScaleMode) => void;
  setClickMode: (mode: ClickMode) => void;
  /** Mark a point as subject or background and re-segment that view. */
  addSeed: (slot: ViewSlot, seed: Seed) => void;
  clearSeeds: (slot: ViewSlot) => void;
  setKnownHeight: (cm: number) => void;
  setReferenceCm: (cm: number) => void;
  addReferencePoint: (point: ReferencePoint) => void;
  clearReference: () => void;
  loadView: (slot: 'front' | 'side', file: File) => Promise<void>;
  clearView: (slot: 'front' | 'side') => void;
  reset: () => void;
}

function analyse(
  name: string,
  image: RasterImage,
  sensitivity: number,
  seeds: readonly Seed[] = [],
): ScanView {
  const mask = segmentSubject(image, { sensitivity, seeds });
  return {
    name,
    image,
    mask,
    silhouette: silhouetteFrom(mask),
    thumbnail: thumbnailDataUrl(image),
    seeds,
  };
}

/** Re-run segmentation on an already-loaded view, after a slider move or a click. */
function reanalyse(
  view: ScanView | null,
  sensitivity: number,
  seeds?: readonly Seed[],
): ScanView | null {
  if (view === null) return null;
  const next = seeds ?? view.seeds;
  const mask = segmentSubject(view.image, { sensitivity, seeds: next });
  return { ...view, mask, silhouette: silhouetteFrom(mask), seeds: next };
}

export const useScanStore = create<ScanState>((set, get) => ({
  subject: 'body',
  sensitivity: 1,
  front: null,
  side: null,
  scaleMode: 'known-height',
  clickMode: 'none',
  knownHeightCm: 175,
  referenceCm: 30,
  referencePoints: [],
  busy: false,
  error: null,

  setSubject: (subject) =>
    set({
      subject,
      knownHeightCm: subject === 'lamp' ? 45 : 175,
      // A photograph of a person reinterpreted as a lamp is nonsense, and
      // keeping it loaded silently invites exactly that.
      front: null,
      side: null,
      referencePoints: [],
      clickMode: 'none',
    }),

  setSensitivity: (value) => {
    const sensitivity = clamp(value, 0.5, 1.8);
    const { front, side } = get();
    set({
      sensitivity,
      front: reanalyse(front, sensitivity),
      side: reanalyse(side, sensitivity),
    });
  },

  setScaleMode: (scaleMode) =>
    set({ scaleMode, clickMode: scaleMode === 'reference' ? 'reference' : 'none' }),
  setClickMode: (clickMode) => set({ clickMode }),

  addSeed: (slot, seed) => {
    const state = get();
    const view = slot === 'front' ? state.front : state.side;
    if (view === null) return;
    const updated = reanalyse(view, state.sensitivity, [...view.seeds, seed]);
    set(slot === 'front' ? { front: updated } : { side: updated });
  },

  clearSeeds: (slot) => {
    const state = get();
    const view = slot === 'front' ? state.front : state.side;
    if (view === null) return;
    const updated = reanalyse(view, state.sensitivity, []);
    set(slot === 'front' ? { front: updated } : { side: updated });
  },
  setKnownHeight: (cm) => set({ knownHeightCm: clamp(cm, 1, 500) }),
  setReferenceCm: (cm) => set({ referenceCm: clamp(cm, 0.1, 500) }),

  addReferencePoint: (point) =>
    set((state) => ({
      // A third click starts a new line rather than extending the old one.
      referencePoints: state.referencePoints.length >= 2 ? [point] : [...state.referencePoints, point],
    })),

  clearReference: () => set({ referencePoints: [] }),

  loadView: async (slot, file) => {
    set({ busy: true, error: null });
    try {
      const image = await loadRasterImage(file);
      const view = analyse(file.name, image, get().sensitivity);
      set(slot === 'front' ? { front: view, busy: false } : { side: view, busy: false });
    } catch (error) {
      set({
        busy: false,
        error: `Could not read that image: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },

  clearView: (slot) =>
    set(slot === 'front' ? { front: null, referencePoints: [] } : { side: null }),

  reset: () =>
    set({
      front: null,
      side: null,
      referencePoints: [],
      error: null,
      sensitivity: 1,
      clickMode: 'none',
    }),
}));
