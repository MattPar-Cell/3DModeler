import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SNAPSHOT_COLORS, describeSnapshot } from '../compare/snapshots.ts';
import type { Snapshot } from '../compare/snapshots.ts';
import type { LampMeasurements } from '../templates/lamp/spec.ts';
import type { BodyMeasurements } from '../body/spec.ts';

/** How multiple models are arranged in the viewer. */
export type CompareMode = 'side-by-side' | 'overlay';

/**
 * Saved models, kept as parameters only.
 *
 * Persisted to localStorage, which is possible precisely *because* nothing here
 * is geometry: a saved comparison is a few dozen numbers, and it stays valid
 * when the templates that turn those numbers into meshes change.
 */
export interface ComparisonState {
  readonly snapshots: readonly Snapshot[];
  /** Ids currently shown in the comparison viewer, in display order. */
  readonly selected: readonly string[];
  readonly mode: CompareMode;
  saveLamp: (measurements: LampMeasurements, proportion: number) => string;
  saveBody: (measurements: BodyMeasurements) => string;
  remove: (id: string) => void;
  rename: (id: string, label: string) => void;
  toggleSelected: (id: string) => void;
  selectOnly: (ids: readonly string[]) => void;
  setMode: (mode: CompareMode) => void;
  clearAll: () => void;
}

/** How many models the comparison viewer will show at once. */
export const MAX_COMPARED = SNAPSHOT_COLORS.length;

function nextColor(snapshots: readonly Snapshot[]): string {
  // Prefer a colour nothing is using; fall back to round-robin once they run out.
  const used = new Set(snapshots.map((s) => s.color));
  return (
    SNAPSHOT_COLORS.find((c) => !used.has(c)) ??
    SNAPSHOT_COLORS[snapshots.length % SNAPSHOT_COLORS.length] ??
    '#6ba8ff'
  );
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `s${Date.now()}${Math.random().toString(36).slice(2)}`;
}

export const useComparisonStore = create<ComparisonState>()(
  persist(
    (set, get) => ({
      snapshots: [],
      selected: [],
      mode: 'side-by-side',

      saveLamp: (measurements, proportion) => {
        const id = newId();
        set((state) => ({
          snapshots: [
            ...state.snapshots,
            {
              id,
              kind: 'lamp',
              label: describeSnapshot('lamp', measurements),
              color: nextColor(state.snapshots),
              createdAt: Date.now(),
              measurements: { ...measurements },
              proportion,
            },
          ],
          // Newly saved models join the comparison, up to the palette's size.
          selected:
            state.selected.length < MAX_COMPARED ? [...state.selected, id] : state.selected,
        }));
        return id;
      },

      saveBody: (measurements) => {
        const id = newId();
        set((state) => ({
          snapshots: [
            ...state.snapshots,
            {
              id,
              kind: 'body',
              label: describeSnapshot('body', measurements),
              color: nextColor(state.snapshots),
              createdAt: Date.now(),
              measurements: { ...measurements },
            },
          ],
          selected:
            state.selected.length < MAX_COMPARED ? [...state.selected, id] : state.selected,
        }));
        return id;
      },

      remove: (id) =>
        set((state) => ({
          snapshots: state.snapshots.filter((s) => s.id !== id),
          selected: state.selected.filter((s) => s !== id),
        })),

      rename: (id, label) =>
        set((state) => ({
          snapshots: state.snapshots.map((s) => (s.id === id ? { ...s, label } : s)),
        })),

      toggleSelected: (id) => {
        const { selected } = get();
        if (selected.includes(id)) {
          set({ selected: selected.filter((s) => s !== id) });
        } else if (selected.length < MAX_COMPARED) {
          set({ selected: [...selected, id] });
        }
      },

      selectOnly: (ids) => set({ selected: ids.slice(0, MAX_COMPARED) }),
      setMode: (mode) => set({ mode }),
      clearAll: () => set({ snapshots: [], selected: [] }),
    }),
    {
      name: 'parametric-reconstructor-comparisons',
      version: 1,
      // Only the data is persisted; the actions come from the code.
      partialize: (state) => ({
        snapshots: state.snapshots,
        selected: state.selected,
        mode: state.mode,
      }),
    },
  ),
);
