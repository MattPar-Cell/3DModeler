import { create } from 'zustand';
import { PROPORTION_MAX, PROPORTION_MIN } from '../templates/lamp/defaults.ts';
import { LAMP_PARAM_SPECS, LAMP_STARTING_MEASUREMENTS } from '../templates/lamp/spec.ts';
import type { LampMeasurementKey, LampMeasurements } from '../templates/lamp/spec.ts';
import { clamp } from '../core/math.ts';

/**
 * The lamp's persisted state is *only* the parameters, never geometry.
 *
 * `entered` holds exactly the measurements the user has typed. A key absent
 * from it is inferred by the solver, which is what makes the measured /
 * derived / estimated distinction real rather than cosmetic: clearing a field
 * genuinely hands the number back to the template ratios.
 *
 * `drafts` holds the raw text of each input so a half-typed value like "1." or
 * a temporarily empty box does not fight the controlled input.
 */
export interface LampState {
  readonly entered: LampMeasurements;
  readonly drafts: Partial<Record<LampMeasurementKey, string>>;
  readonly proportion: number;
  setDraft: (key: LampMeasurementKey, text: string) => void;
  clearMeasurement: (key: LampMeasurementKey) => void;
  setProportion: (value: number) => void;
  reset: () => void;
  /** Fill every field with the starting example, as measured values. */
  loadExample: () => void;
}

function withoutKey(
  measurements: LampMeasurements,
  key: LampMeasurementKey,
): LampMeasurements {
  const next: Record<string, number> = {};
  for (const [k, v] of Object.entries(measurements)) {
    if (k !== key && v !== undefined) next[k] = v;
  }
  return next as LampMeasurements;
}

export const useLampStore = create<LampState>((set) => ({
  entered: {},
  drafts: {},
  proportion: 1,

  setDraft: (key, text) =>
    set((state) => {
      const drafts = { ...state.drafts, [key]: text };
      const trimmed = text.trim();
      if (trimmed === '') return { drafts, entered: withoutKey(state.entered, key) };
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed <= 0) return { drafts };
      const spec = LAMP_PARAM_SPECS[key];
      return {
        drafts,
        entered: { ...state.entered, [key]: clamp(parsed, spec.min, spec.max) },
      };
    }),

  clearMeasurement: (key) =>
    set((state) => ({
      entered: withoutKey(state.entered, key),
      drafts: { ...state.drafts, [key]: '' },
    })),

  setProportion: (value) => set({ proportion: clamp(value, PROPORTION_MIN, PROPORTION_MAX) }),

  reset: () => set({ entered: {}, drafts: {}, proportion: 1 }),

  loadExample: () =>
    set({
      entered: { ...LAMP_STARTING_MEASUREMENTS },
      drafts: Object.fromEntries(
        Object.entries(LAMP_STARTING_MEASUREMENTS).map(([k, v]) => [k, String(v)]),
      ) as Partial<Record<LampMeasurementKey, string>>,
      proportion: 1,
    }),
}));
