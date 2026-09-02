import { useEffect, useMemo, useRef, useState } from 'react';
import { Group } from 'three';
import { useBodyStore } from '../state/bodyStore.ts';
import { buildBody } from '../body/build.ts';
import { disposeModel } from '../templates/types.ts';
import { isObserved } from '../core/params.ts';
import { BODY_MEASUREMENT_GROUPS, BODY_MEASUREMENT_KEYS, BODY_PARAM_SPECS } from '../body/spec.ts';
import type { BodyParamKey } from '../body/spec.ts';
import type { Residual } from '../body/fit.ts';
import { Constraints, DerivedTable, MeasurementField } from './ParamViews.tsx';
import { RegionConfidenceList } from './RegionConfidence.tsx';
import { Viewer } from './Viewer.tsx';
import { ExportBar } from './ExportBar.tsx';
import { ConfidenceLegend, StatStrip } from './Overlays.tsx';
import { SaveForComparison } from './SaveForComparison.tsx';

/** Parameters worth showing in the reconstructed-values table. */
const REPORTED_PARAMS: readonly BodyParamKey[] = [
  'underbust',
  'knee',
  'calf',
  'ankle',
  'forearm',
  'headCircumference',
  'hipWidth',
  'upperArmLength',
  'handLength',
  'footLength',
  'girthScale',
];

export function BodyWorkspace() {
  const entered = useBodyStore((s) => s.entered);
  const drafts = useBodyStore((s) => s.drafts);
  const sources = useBodyStore((s) => s.sources);
  const setDraft = useBodyStore((s) => s.setDraft);
  const clearMeasurement = useBodyStore((s) => s.clearMeasurement);
  const reset = useBodyStore((s) => s.reset);
  const loadExample = useBodyStore((s) => s.loadExample);
  const loadPartOnlyExample = useBodyStore((s) => s.loadPartOnlyExample);

  const [confidenceShading, setConfidenceShading] = useState(false);
  const rootRef = useRef<Group | null>(null);

  const model = useMemo(() => buildBody({ measurements: entered, sources }), [entered, sources]);

  const previous = useRef(model);
  useEffect(() => {
    if (previous.current !== model) {
      disposeModel(previous.current);
      previous.current = model;
    }
  }, [model]);
  useEffect(() => () => disposeModel(previous.current), []);

  const measuredCount = BODY_MEASUREMENT_KEYS.filter(
    (key) => isObserved(model.params[key].provenance),
  ).length;

  return (
    <>
      <aside className="sidebar">
        <div className="section">
          <h2>Measurements</h2>
          <p className="hint">
            Enter any subset — one measurement is enough. Circumferences are reproduced exactly;
            everything else is fitted from them, with population priors filling the gaps.
          </p>
          <div className="buttons" style={{ marginBottom: 14 }}>
            <button type="button" className="secondary" onClick={loadExample}>
              Load example
            </button>
            <button type="button" className="secondary" onClick={loadPartOnlyExample}>
              One body part only
            </button>
            <button type="button" className="secondary" onClick={reset} disabled={measuredCount === 0}>
              Clear all
            </button>
          </div>
          {BODY_MEASUREMENT_GROUPS.map((group) => (
            <div key={group.title}>
              <h2 style={{ marginTop: 4 }}>{group.title}</h2>
              {group.keys.map((key) => (
                <MeasurementField
                  key={key}
                  spec={BODY_PARAM_SPECS[key]}
                  resolved={model.params[key]}
                  draft={drafts[key] ?? ''}
                  onChange={(text) => setDraft(key, text)}
                  onClear={() => clearMeasurement(key)}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="section">
          <h2>Region confidence</h2>
          <p className="hint">
            Regions marked <em>estimated</em> rest on population averages alone, and are drawn
            translucent in the viewer. Hover a row to see what shaped it.
          </p>
          <RegionConfidenceList regions={model.fit.regions} />
        </div>

        <div className="section">
          <h2>Fit quality</h2>
          {model.fit.residuals.length === 0 ? (
            <p className="hint">
              Nothing entered yet, so there is nothing to fit — this is the population average body
              for an adult.
            </p>
          ) : (
            <>
              <ResidualTable residuals={model.fit.residuals} />
              <div className="summary-line">
                <span>Sum of squared relative error</span>
                <strong>{model.fit.objective.toExponential(1)}</strong>
              </div>
            </>
          )}
        </div>

        <div className="section">
          <h2>Reconstructed parameters</h2>
          <DerivedTable params={REPORTED_PARAMS.map((key) => model.params[key])} />
        </div>

        <div className="section">
          <h2>Constraints</h2>
          <Constraints reports={model.constraints} />
        </div>

        <div className="section">
          <h2>Compare</h2>
          <SaveForComparison kind="body" measurements={entered} />
        </div>

        <div className="section">
          <h2>Export</h2>
          <ExportBar rootRef={rootRef} stem="body" />
          <p className="note" style={{ marginTop: 8 }}>
            Exported in metres, regenerated from parameters. No body scan or licensed body model is
            involved at any point.
          </p>
        </div>
      </aside>

      <main className="viewer">
        <Viewer
          instances={[{ id: 'body', parts: model.parts, offsetX: 0, opacity: 1 }]}
          height={model.height}
          confidenceShading={confidenceShading}
          rootRef={rootRef}
        />
        <StatStrip
          items={[
            { label: 'Height', value: `${model.params.stature.value.toFixed(1)} cm` },
            { label: 'Mass', value: `${model.params.mass.value.toFixed(1)} kg` },
            { label: 'Measured', value: `${measuredCount}/${BODY_MEASUREMENT_KEYS.length}` },
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

function ResidualTable({ residuals }: { readonly residuals: readonly Residual[] }) {
  return (
    <table className="residual-table">
      <thead>
        <tr>
          <th>Measurement</th>
          <th>Entered</th>
          <th>Model</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {residuals.map((residual) => {
          const relative = Math.abs(residual.error) / residual.target;
          const grade = relative < 0.005 ? 'err-ok' : relative < 0.02 ? 'err-warn' : 'err-bad';
          return (
            <tr key={residual.key}>
              <td>{residual.label}</td>
              <td>{residual.target.toFixed(1)}</td>
              <td>{residual.reconstructed.toFixed(1)}</td>
              <td className={grade}>
                {residual.error >= 0 ? '+' : ''}
                {residual.error.toFixed(2)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
