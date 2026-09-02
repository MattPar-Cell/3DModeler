import { create } from 'zustand';
import { BODY_PARAM_SPECS, BODY_EXAMPLE_MEASUREMENTS } from '../body/spec.ts';
import type { BodyMeasurementKey, BodyMeasurements } from '../body/spec.ts';
import { clamp } from '../core/math.ts';

/**
 * Body state, like the lamp's: the parameters the user pinned, and nothing
 * else. Clearing a field genuinely returns that dimension to the priors.
 */
export interface BodyState {
  readonly entered: BodyMeasurements;
  readonly drafts: Partial<Record<BodyMeasurementKey, string>>;
  setDraft: (key: BodyMeasurementKey, text: string) => void;
  clearMeasurement: (key: BodyMeasurementKey) => void;
  reset: () => void;
  loadExample: () => void;
  /** Load the "body part only" example from the spec: a forearm and a wrist. */
  loadPartOnlyExample: () => void;
}

function withoutKey(measurements: BodyMeasurements, key: BodyMeasurementKey): BodyMeasurements {
  const next: Record<string, number> = {};
  for (const [k, v] of Object.entries(measurements)) {
    if (k !== key && v !== undefined) next[k] = v;
  }
  return next as BodyMeasurements;
}

function draftsFor(measurements: BodyMeasurements): Partial<Record<BodyMeasurementKey, string>> {
  return Object.fromEntries(
    Object.entries(measurements).map(([k, v]) => [k, String(v)]),
  ) as Partial<Record<BodyMeasurementKey, string>>;
}

export const useBodyStore = create<BodyState>((set) => ({
  entered: {},
  drafts: {},

  setDraft: (key, text) =>
    set((state) => {
      const drafts = { ...state.drafts, [key]: text };
      const trimmed = text.trim();
      if (trimmed === '') return { drafts, entered: withoutKey(state.entered, key) };
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed <= 0) return { drafts };
      const spec = BODY_PARAM_SPECS[key];
      return { drafts, entered: { ...state.entered, [key]: clamp(parsed, spec.min, spec.max) } };
    }),

  clearMeasurement: (key) =>
    set((state) => ({
      entered: withoutKey(state.entered, key),
      drafts: { ...state.drafts, [key]: '' },
    })),

  reset: () => set({ entered: {}, drafts: {} }),

  loadExample: () =>
    set({
      entered: { ...BODY_EXAMPLE_MEASUREMENTS },
      drafts: draftsFor(BODY_EXAMPLE_MEASUREMENTS),
    }),

  loadPartOnlyExample: () => {
    const measurements: BodyMeasurements = { forearmLength: 27, wrist: 16.5 };
    set({ entered: measurements, drafts: draftsFor(measurements) });
  },
}));
