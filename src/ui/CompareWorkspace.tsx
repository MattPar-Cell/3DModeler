import { useEffect, useMemo, useRef, useState } from 'react';
import { Group } from 'three';
import { useComparisonStore, MAX_COMPARED } from '../state/comparisonStore.ts';
import {
  buildSnapshotModel,
  dimensionRows,
  disposeModels,
  layOutSideBySide,
  parameterRows,
  significantRows,
} from '../compare/snapshots.ts';
import type { ComparisonModel, DiffRow } from '../compare/snapshots.ts';
import { Viewer } from './Viewer.tsx';
import type { ViewerInstance } from './Viewer.tsx';
import { ExportBar } from './ExportBar.tsx';
import { StatStrip } from './Overlays.tsx';

/** Opacity for each model when they are stacked on the same spot. */
const OVERLAY_OPACITY = 0.5;

/**
 * The comparison workspace.
 *
 * Saved models are rebuilt from their parameters here, laid out side by side or
 * stacked on the same origin, and diffed measurement by measurement. Because a
 * snapshot is only its measurements, comparing two models is the same
 * computation as editing one — there is no separate "loaded model" path that
 * could drift from the live editor.
 */
export function CompareWorkspace() {
  const snapshots = useComparisonStore((s) => s.snapshots);
  const selectedIds = useComparisonStore((s) => s.selected);
  const mode = useComparisonStore((s) => s.mode);
  const toggleSelected = useComparisonStore((s) => s.toggleSelected);
  const setMode = useComparisonStore((s) => s.setMode);
  const remove = useComparisonStore((s) => s.remove);
  const rename = useComparisonStore((s) => s.rename);
  const clearAll = useComparisonStore((s) => s.clearAll);

  const rootRef = useRef<Group | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);

  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => snapshots.find((s) => s.id === id))
        .filter((s): s is NonNullable<typeof s> => s !== undefined),
    [selectedIds, snapshots],
  );

  const models = useMemo(() => selected.map(buildSnapshotModel), [selected]);

  // Geometry is the one thing here that owns GPU memory.
  const previous = useRef<readonly ComparisonModel[]>(models);
  useEffect(() => {
    if (previous.current !== models) {
      disposeModels(previous.current);
      previous.current = models;
    }
  }, [models]);
  useEffect(() => () => disposeModels(previous.current), []);

  const placements = useMemo(() => layOutSideBySide(models), [models]);

  const instances: ViewerInstance[] = models.map((model, i) => {
    const overlay = mode === 'overlay';
    return {
      id: model.snapshot.id,
      parts: model.parts,
      offsetX: overlay ? -model.centreX : (placements[i]?.x ?? 0),
      // Several models sharing a scene have to be told apart, so in comparison
      // the tint replaces the material colour. With a single model there is
      // nothing to distinguish, and it keeps its own materials.
      ...(models.length > 1 ? { tint: model.snapshot.color } : {}),
      opacity: overlay && models.length > 1 ? OVERLAY_OPACITY : 1,
    };
  });

  const tallest = models.reduce((max, m) => Math.max(max, m.height), 1);
  const totalWidth =
    mode === 'overlay'
      ? models.reduce((max, m) => Math.max(max, m.width), 1)
      : models.reduce((sum, m) => sum + m.width, 0) * 1.3;

  const dimensions = dimensionRows(models);
  const parameters = significantRows(parameterRows(models));
  const mixedKinds = new Set(models.map((m) => m.snapshot.kind)).size > 1;

  return (
    <>
      <aside className="sidebar">
        <div className="section">
          <h2>Saved models</h2>
          {snapshots.length === 0 ? (
            <p className="hint">
              Nothing saved yet. Build a lamp or a body, then press <em>Save for comparison</em> in
              that workspace. A saved model is only its measurements — a few dozen numbers — so it
              stays valid even when the templates that turn them into meshes change.
            </p>
          ) : (
            <>
              <p className="hint">
                Tick up to {MAX_COMPARED} to compare. Mixing a lamp with a body is allowed: the
                size table still works, and it is the quickest way to check a scale.
              </p>
              <div className="snapshot-list">
                {snapshots.map((snapshot) => {
                  const checked = selectedIds.includes(snapshot.id);
                  const atLimit = !checked && selectedIds.length >= MAX_COMPARED;
                  return (
                    <div className="snapshot-row" key={snapshot.id} data-selected={checked}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={atLimit}
                        onChange={() => toggleSelected(snapshot.id)}
                        aria-label={`Compare ${snapshot.label}`}
                      />
                      <span
                        className="swatch"
                        style={{ color: snapshot.color, background: snapshot.color }}
                        aria-hidden="true"
                      />
                      <input
                        className="snapshot-label"
                        value={snapshot.label}
                        onChange={(event) => rename(snapshot.id, event.target.value)}
                        aria-label="Model name"
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => remove(snapshot.id)}
                        title="Delete this saved model"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="buttons" style={{ marginTop: 10 }}>
                <button type="button" className="secondary" onClick={clearAll}>
                  Delete all
                </button>
              </div>
            </>
          )}
        </div>

        {models.length > 0 && (
          <>
            <div className="section">
              <h2>Arrangement</h2>
              <div className="buttons">
                <button
                  type="button"
                  className={mode === 'side-by-side' ? 'primary' : 'secondary'}
                  aria-pressed={mode === 'side-by-side'}
                  onClick={() => setMode('side-by-side')}
                >
                  Side by side
                </button>
                <button
                  type="button"
                  className={mode === 'overlay' ? 'primary' : 'secondary'}
                  aria-pressed={mode === 'overlay'}
                  onClick={() => setMode('overlay')}
                >
                  Overlay
                </button>
              </div>
              <p className="note" style={{ marginTop: 8 }}>
                {mode === 'side-by-side'
                  ? 'Models stand in a row on a shared floor, so relative height and bulk read directly.'
                  : 'Models share one origin and are drawn translucent, so differences in profile show as the places their silhouettes come apart.'}
              </p>
            </div>

            <div className="section">
              <h2>Export</h2>
              <ExportBar rootRef={rootRef} stem="comparison" />
              <p className="note" style={{ marginTop: 8 }}>
                Exports the whole arrangement as one scene, in metres.
              </p>
            </div>
          </>
        )}
      </aside>

      <main className="viewer compare">
        {models.length === 0 ? (
          <div className="empty-viewer">
            <p>Select saved models to compare them here.</p>
          </div>
        ) : (
          <>
            <div className="viewer-canvas">
            <Viewer
              instances={instances}
              height={tallest}
              width={totalWidth}
              confidenceShading={false}
              rootRef={rootRef}
            />
            <StatStrip
              items={[
                { label: 'Models', value: String(models.length) },
                { label: 'Tallest', value: `${tallest.toFixed(1)} cm` },
                {
                  label: 'Height range',
                  value: `${(tallest - models.reduce((min, m) => Math.min(min, m.height), Infinity)).toFixed(1)} cm`,
                },
              ]}
            />
            </div>
            <section className="compare-drawer" data-open={drawerOpen}>
              <header className="drawer-head">
                <button
                  type="button"
                  className="drawer-toggle"
                  onClick={() => setDrawerOpen((open) => !open)}
                  aria-expanded={drawerOpen}
                >
                  {drawerOpen ? '▾' : '▸'} Comparison
                </button>
                <div className="drawer-legend">
                  {models.map((model) => (
                    <span className="legend-row" key={model.snapshot.id}>
                      <span
                        className="swatch"
                        style={{ color: model.snapshot.color, background: model.snapshot.color }}
                        aria-hidden="true"
                      />
                      {model.snapshot.label}
                    </span>
                  ))}
                </div>
              </header>
              {drawerOpen && (
                <div
                  className="drawer-body"
                  data-single={mixedKinds || parameters.length === 0}
                >
                  <div className="drawer-panel">
                    <h3>Overall size</h3>
                    <DiffTable rows={dimensions} models={models} />
                    <p className="note">
                      Measured off the generated meshes, so this works for any mix of models.
                    </p>
                  </div>
                  <div className="drawer-panel">
                    <h3>Parameters</h3>
                    {mixedKinds ? (
                      <p className="note">
                        The selection mixes lamps and bodies. A lamp’s stem diameter and a person’s
                        neck have nothing to say to each other, so only overall size is compared.
                      </p>
                    ) : parameters.length === 0 ? (
                      <p className="note">
                        {models.length < 2
                          ? 'Select a second model to see a parameter-by-parameter comparison.'
                          : 'These models are identical in every parameter.'}
                      </p>
                    ) : (
                      <>
                        <p className="note">
                          Every parameter that differs, largest difference first, compared against{' '}
                          <strong>{models[0]?.snapshot.label}</strong>.
                        </p>
                        <DiffTable rows={parameters} models={models} />
                      </>
                    )}
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}

function DiffTable({
  rows,
  models,
}: {
  readonly rows: readonly DiffRow[];
  readonly models: readonly ComparisonModel[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="diff-scroll">
      <table className="diff-table">
        <thead>
          <tr>
            <th>Parameter</th>
            {models.map((model) => (
              <th key={model.snapshot.id}>
                <span
                  className="swatch"
                  style={{ color: model.snapshot.color, background: model.snapshot.color }}
                  aria-hidden="true"
                />
                {model.snapshot.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              {row.cells.map((cell, i) => (
                <td
                  key={models[i]?.snapshot.id ?? i}
                  className="value"
                  data-provenance={cell.provenance}
                  title={
                    cell.provenance === undefined
                      ? 'Measured off the generated mesh'
                      : `This value is ${cell.provenance}`
                  }
                >
                  {formatCell(cell.value, row.unit)}
                  {cell.delta !== undefined && Math.abs(cell.delta) > 1e-9 && (
                    <span className={cell.delta > 0 ? 'delta up' : 'delta down'}>
                      {cell.delta > 0 ? '+' : '−'}
                      {Math.abs(cell.delta).toFixed(row.unit === 'ratio' ? 2 : 1)}
                      {cell.relative !== undefined &&
                        ` (${cell.relative > 0 ? '+' : '−'}${Math.abs(cell.relative * 100).toFixed(0)}%)`}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: number, unit: string): string {
  if (unit === 'ratio') return `${value.toFixed(2)}×`;
  return `${value.toFixed(1)} ${unit}`;
}
