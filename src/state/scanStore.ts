import { create } from 'zustand';
import { segmentSubject } from '../scan/segment.ts';
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

/** A loaded photograph and everything derived from it. */
export interface ScanView {
  readonly name: string;
  readonly image: RasterImage;
  readonly mask: Mask;
  readonly silhouette: Silhouette;
  readonly thumbnail: string;
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
  setKnownHeight: (cm: number) => void;
  setReferenceCm: (cm: number) => void;
  addReferencePoint: (point: ReferencePoint) => void;
  clearReference: () => void;
  loadView: (slot: 'front' | 'side', file: File) => Promise<void>;
  clearView: (slot: 'front' | 'side') => void;
  reset: () => void;
}

function analyse(name: string, image: RasterImage, sensitivity: number): ScanView {
  const mask = segmentSubject(image, { sensitivity });
  return { name, image, mask, silhouette: silhouetteFrom(mask), thumbnail: thumbnailDataUrl(image) };
}

/** Re-run segmentation on an already-loaded view, e.g. after a slider move. */
function reanalyse(view: ScanView | null, sensitivity: number): ScanView | null {
  if (view === null) return null;
  const mask = segmentSubject(view.image, { sensitivity });
  return { ...view, mask, silhouette: silhouetteFrom(mask) };
}

export const useScanStore = create<ScanState>((set, get) => ({
  subject: 'body',
  sensitivity: 1,
  front: null,
  side: null,
  scaleMode: 'known-height',
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

  setScaleMode: (scaleMode) => set({ scaleMode }),
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
    set({ front: null, side: null, referencePoints: [], error: null, sensitivity: 1 }),
}));
