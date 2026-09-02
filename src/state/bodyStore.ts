import { create } from 'zustand';
import { BODY_PARAM_SPECS, BODY_EXAMPLE_MEASUREMENTS } from '../body/spec.ts';
import type { BodyMeasurementKey, BodyMeasurements } from '../body/spec.ts';
import { clamp } from '../core/math.ts';
import type { MeasurementSource, Sources } from '../core/params.ts';

/**
 * Body state, like the lamp's: the parameters the user pinned, and nothing
 * else. Clearing a field genuinely returns that dimension to the priors.
 */
export interface BodyState {
  readonly entered: BodyMeasurements;
  /**
   * How each entered value arrived. A key typed by hand is absent (and so
   * counts as manual); one written by the scanner is marked, which is what
   * makes the sidebar, the region list and the viewer able to say so.
   */
  readonly sources: Sources<BodyMeasurementKey>;
  readonly drafts: Partial<Record<BodyMeasurementKey, string>>;
  setDraft: (key: BodyMeasurementKey, text: string) => void;
  clearMeasurement: (key: BodyMeasurementKey) => void;
  reset: () => void;
  loadExample: () => void;
  /** Load the "body part only" example from the spec: a forearm and a wrist. */
  loadPartOnlyExample: () => void;
  /**
   * Merge a scanner's output into the current measurements.
   *
   * Merged rather than replaced: weight cannot be read from an outline, so a
   * scan should not wipe a weight the user has already typed.
   */
  applyScan: (measurements: BodyMeasurements) => void;
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

function withoutSource(
  sources: Sources<BodyMeasurementKey>,
  key: BodyMeasurementKey,
): Sources<BodyMeasurementKey> {
  const next: Record<string, MeasurementSource> = {};
  for (const [k, v] of Object.entries(sources)) {
    if (k !== key && v !== undefined) next[k] = v;
  }
  return next as Sources<BodyMeasurementKey>;
}

export const useBodyStore = create<BodyState>((set) => ({
  entered: {},
  sources: {},
  drafts: {},

  setDraft: (key, text) =>
    set((state) => {
      const drafts = { ...state.drafts, [key]: text };
      // Editing a field by hand supersedes whatever the scanner put there.
      const sources = withoutSource(state.sources, key);
      const trimmed = text.trim();
      if (trimmed === '') return { drafts, sources, entered: withoutKey(state.entered, key) };
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed <= 0) return { drafts };
      const spec = BODY_PARAM_SPECS[key];
      return {
        drafts,
        sources,
        entered: { ...state.entered, [key]: clamp(parsed, spec.min, spec.max) },
      };
    }),

  clearMeasurement: (key) =>
    set((state) => ({
      entered: withoutKey(state.entered, key),
      sources: withoutSource(state.sources, key),
      drafts: { ...state.drafts, [key]: '' },
    })),

  reset: () => set({ entered: {}, sources: {}, drafts: {} }),

  loadExample: () =>
    set({
      entered: { ...BODY_EXAMPLE_MEASUREMENTS },
      sources: {},
      drafts: draftsFor(BODY_EXAMPLE_MEASUREMENTS),
    }),

  loadPartOnlyExample: () => {
    const measurements: BodyMeasurements = { forearmLength: 27, wrist: 16.5 };
    set({ entered: measurements, sources: {}, drafts: draftsFor(measurements) });
  },

  applyScan: (measurements) =>
    set((state) => {
      const entered: Record<string, number> = { ...state.entered };
      const sources: Record<string, MeasurementSource> = { ...state.sources };
      const drafts: Record<string, string> = { ...state.drafts };
      for (const [key, value] of Object.entries(measurements)) {
        if (value === undefined || !Number.isFinite(value) || value <= 0) continue;
        const spec = BODY_PARAM_SPECS[key as BodyMeasurementKey];
        const clamped = clamp(value, spec.min, spec.max);
        entered[key] = clamped;
        sources[key] = 'scanned';
        drafts[key] = clamped.toFixed(1);
      }
      return {
        entered: entered as BodyMeasurements,
        sources: sources as Sources<BodyMeasurementKey>,
        drafts: drafts as Partial<Record<BodyMeasurementKey, string>>,
      };
    }),
}));
