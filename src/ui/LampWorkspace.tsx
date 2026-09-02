import { useEffect, useMemo, useRef, useState } from 'react';
import { Group } from 'three';
import { useLampStore } from '../state/lampStore.ts';
import { buildLamp } from '../templates/lamp/build.ts';
import { disposeModel } from '../templates/types.ts';
import { isObserved } from '../core/params.ts';
import {
  LAMP_MEASUREMENT_KEYS,
  LAMP_PARAM_SPECS,
} from '../templates/lamp/spec.ts';
import type { LampParamKey } from '../templates/lamp/spec.ts';
import { PROPORTION_MAX, PROPORTION_MIN } from '../templates/lamp/defaults.ts';
import { Constraints, DerivedTable, MeasurementField } from './ParamViews.tsx';
import { Viewer } from './Viewer.tsx';
import { ExportBar } from './ExportBar.tsx';
import { ConfidenceLegend, StatStrip } from './Overlays.tsx';
import { SaveForComparison } from './SaveForComparison.tsx';

/** The lamp template workspace: sidebar of measurements plus the live viewer. */
export function LampWorkspace() {
  const entered = useLampStore((s) => s.entered);
  const drafts = useLampStore((s) => s.drafts);
  const sources = useLampStore((s) => s.sources);
  const proportion = useLampStore((s) => s.proportion);
  const setDraft = useLampStore((s) => s.setDraft);
  const clearMeasurement = useLampStore((s) => s.clearMeasurement);
  const setProportion = useLampStore((s) => s.setProportion);
  const reset = useLampStore((s) => s.reset);
  const loadExample = useLampStore((s) => s.loadExample);

  const [confidenceShading, setConfidenceShading] = useState(false);
  const rootRef = useRef<Group | null>(null);

  // The model is a pure function of the parameters, rebuilt on every change.
  const model = useMemo(
    () => buildLamp({ measurements: entered, sources, proportion }),
    [entered, sources, proportion],
  );

  // Geometry is the one thing here that owns GPU memory, so release the
  // previous build once React has swapped in the new one.
  const previous = useRef(model);
  useEffect(() => {
    if (previous.current !== model) {
      disposeModel(previous.current);
      previous.current = model;
    }
  }, [model]);
  useEffect(() => () => disposeModel(previous.current), []);

  const measuredCount = LAMP_MEASUREMENT_KEYS.filter(
    (key) => isObserved(model.params[key].provenance),
  ).length;

  const derivedKeys: LampParamKey[] = [
    'baseHeight',
    'baseTopDiameter',
    'stemHeight',
    'stemBelly',
    'socketHeight',
    'socketDiameter',
    'shadeHeight',
    'shadeTopDiameter',
  ];

  return (
    <>
      <aside className="sidebar">
        <div className="section">
          <h2>Measurements</h2>
          <p className="hint">
            Enter whatever you actually measured — any subset works. Everything else is
            reconstructed from the template’s proportion ratios and marked accordingly.
          </p>
          {LAMP_MEASUREMENT_KEYS.map((key) => (
            <MeasurementField
              key={key}
              spec={LAMP_PARAM_SPECS[key]}
              resolved={model.params[key]}
              draft={drafts[key] ?? ''}
              onChange={(text) => setDraft(key, text)}
              onClear={() => clearMeasurement(key)}
            />
          ))}
          <div className="buttons">
            <button type="button" className="secondary" onClick={loadExample}>
              Load example
            </button>
            <button type="button" className="secondary" onClick={reset} disabled={measuredCount === 0}>
              Clear all
            </button>
          </div>
        </div>

        <div className="section">
          <h2>Proportion lock</h2>
          <p className="hint">
            Scales every inferred dimension at once. Measurements you entered stay pinned at
            exactly the value you typed, so this changes the lamp’s proportions without
            contradicting your data.
          </p>
          <div className="slider-row">
            <input
              type="range"
              min={PROPORTION_MIN}
              max={PROPORTION_MAX}
              step={0.01}
              value={proportion}
              onChange={(event) => setProportion(Number(event.target.value))}
              aria-label="Proportion lock"
            />
            <span className="slider-value">{proportion.toFixed(2)}×</span>
          </div>
        </div>

        <div className="section">
          <h2>Reconstructed parameters</h2>
          <DerivedTable params={derivedKeys.map((key) => model.params[key])} />
        </div>

        <div className="section">
          <h2>Constraints</h2>
          <Constraints reports={model.constraints} />
        </div>

        <div className="section">
          <h2>Compare</h2>
          <SaveForComparison kind="lamp" measurements={entered} proportion={proportion} />
        </div>

        <div className="section">
          <h2>Export</h2>
          <ExportBar rootRef={rootRef} stem="lamp" />
          <p className="note" style={{ marginTop: 8 }}>
            Exported in metres. The model is regenerated from parameters, never loaded from a
            file.
          </p>
        </div>
      </aside>

      <main className="viewer">
        <Viewer
          instances={[{ id: 'lamp', parts: model.parts, offsetX: 0, opacity: 1 }]}
          height={model.height}
          confidenceShading={confidenceShading}
          rootRef={rootRef}
        />
        <StatStrip
          items={[
            { label: 'Height', value: `${model.height.toFixed(1)} cm` },
            { label: 'Measured', value: `${measuredCount}/${LAMP_MEASUREMENT_KEYS.length}` },
            { label: 'Parts', value: String(model.parts.length) },
          ]}
        />
        <ConfidenceLegend
          enabled={confidenceShading}
          onToggle={() => setConfidenceShading((v) => !v)}
        />
      </main>
    </>
  );
}
