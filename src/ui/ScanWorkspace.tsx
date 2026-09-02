import { useMemo, useRef } from 'react';
import { useScanStore } from '../state/scanStore.ts';
import type { ScanView } from '../state/scanStore.ts';
import { useLampStore } from '../state/lampStore.ts';
import { useBodyStore } from '../state/bodyStore.ts';
import { useComparisonStore } from '../state/comparisonStore.ts';
import { extractBody, extractLamp, scaleFromKnownHeight, scaleFromReference } from '../scan/extract.ts';
import type { BodyScan, LampScan, ScanNote } from '../scan/extract.ts';
import { projectParts } from '../scan/project.ts';
import { silhouetteHeightPx } from '../scan/types.ts';
import { buildLamp } from '../templates/lamp/build.ts';
import { buildBody } from '../body/build.ts';
import { LAMP_PARAM_SPECS } from '../templates/lamp/spec.ts';
import type { LampMeasurementKey } from '../templates/lamp/spec.ts';
import { BODY_PARAM_SPECS } from '../body/spec.ts';
import type { BodyMeasurementKey } from '../body/spec.ts';
import { ScanPreview } from './ScanPreview.tsx';
import { disposeModel } from '../templates/types.ts';

/** A completed scan, tagged with what it is a scan of. */
type ScanResult =
  | { readonly kind: 'lamp'; readonly result: LampScan }
  | { readonly kind: 'body'; readonly result: BodyScan };

/**
 * The scanner workspace.
 *
 * The pipeline the operator drives here is: photograph -> silhouette -> a
 * handful of measurements -> the same solver every other workspace uses. The
 * image never becomes geometry, and it never leaves the browser — there is no
 * server in this app to send it to.
 */
export function ScanWorkspace() {
  const subject = useScanStore((s) => s.subject);
  const sensitivity = useScanStore((s) => s.sensitivity);
  const front = useScanStore((s) => s.front);
  const side = useScanStore((s) => s.side);
  const scaleMode = useScanStore((s) => s.scaleMode);
  const knownHeightCm = useScanStore((s) => s.knownHeightCm);
  const referenceCm = useScanStore((s) => s.referenceCm);
  const referencePoints = useScanStore((s) => s.referencePoints);
  const clickMode = useScanStore((s) => s.clickMode);
  const busy = useScanStore((s) => s.busy);
  const error = useScanStore((s) => s.error);
  const setSubject = useScanStore((s) => s.setSubject);
  const setSensitivity = useScanStore((s) => s.setSensitivity);
  const setScaleMode = useScanStore((s) => s.setScaleMode);
  const setKnownHeight = useScanStore((s) => s.setKnownHeight);
  const setReferenceCm = useScanStore((s) => s.setReferenceCm);
  const addReferencePoint = useScanStore((s) => s.addReferencePoint);
  const setClickMode = useScanStore((s) => s.setClickMode);
  const addSeed = useScanStore((s) => s.addSeed);
  const clearSeeds = useScanStore((s) => s.clearSeeds);
  const clearReference = useScanStore((s) => s.clearReference);
  const loadView = useScanStore((s) => s.loadView);
  const clearView = useScanStore((s) => s.clearView);

  const applyLampScan = useLampStore((s) => s.applyScan);
  const applyBodyScan = useBodyStore((s) => s.applyScan);
  const saveLamp = useComparisonStore((s) => s.saveLamp);
  const saveBody = useComparisonStore((s) => s.saveBody);

  /** Centimetres per pixel in the front view, from whichever reference is set. */
  const cmPerPixel = useMemo(() => {
    if (front === null) return 0;
    if (scaleMode === 'known-height') return scaleFromKnownHeight(front.silhouette, knownHeightCm);
    const [a, b] = referencePoints;
    if (a === undefined || b === undefined) return 0;
    return scaleFromReference(Math.hypot(b.x - a.x, b.y - a.y), referenceCm);
  }, [front, scaleMode, knownHeightCm, referencePoints, referenceCm]);

  // A discriminated union rather than a bare measurement set: a lamp's
  // measurements and a body's share no keys, and the compiler should be the one
  // stopping one from being handed to the other's workspace.
  const scan = useMemo((): ScanResult | null => {
    if (front === null || cmPerPixel <= 0) return null;
    if (subject === 'lamp') {
      return { kind: 'lamp', result: extractLamp(front.silhouette, cmPerPixel) };
    }
    return {
      kind: 'body',
      result: extractBody({
        front: front.silhouette,
        cmPerPixel,
        ...(side === null ? {} : { side: side.silhouette }),
        ...(side === null
          ? {}
          : { sideCmPerPixel: scaleFromKnownHeight(side.silhouette, knownHeightCm) }),
      }),
    };
  }, [front, side, subject, cmPerPixel, knownHeightCm]);

  // The reconstruction, built purely so its outline can be drawn over the photo.
  const preview = useMemo(() => {
    if (scan === null) return null;
    return scan.kind === 'lamp'
      ? buildLamp({ measurements: scan.result.measurements })
      : buildBody({ measurements: scan.result.measurements });
  }, [scan]);

  const previousPreview = useRef(preview);
  if (previousPreview.current !== preview) {
    disposeModel(previousPreview.current);
    previousPreview.current = preview;
  }

  const outline = useMemo(
    () => (preview === null ? null : projectParts(preview.parts, 200)),
    [preview],
  );

  /**
   * What a click on a preview does, given the current mode. The reference line
   * and the correction marks share the canvas, so only one can be live.
   */
  const pickerFor = (slot: 'front' | 'side'): ((point: { x: number; y: number }) => void) | undefined => {
    if (clickMode === 'reference') return slot === 'front' ? addReferencePoint : undefined;
    if (clickMode === 'subject') return (point) => addSeed(slot, { ...point, kind: 'subject' });
    if (clickMode === 'background') return (point) => addSeed(slot, { ...point, kind: 'background' });
    return undefined;
  };

  return (
    <>
      <aside className="sidebar">
        <div className="section">
          <h2>Subject</h2>
          <div className="buttons">
            <button
              type="button"
              className={subject === 'lamp' ? 'primary' : 'secondary'}
              aria-pressed={subject === 'lamp'}
              onClick={() => setSubject('lamp')}
            >
              Lamp
            </button>
            <button
              type="button"
              className={subject === 'body' ? 'primary' : 'secondary'}
              aria-pressed={subject === 'body'}
              onClick={() => setSubject('body')}
            >
              Body
            </button>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            {subject === 'lamp'
              ? 'Photograph the lamp square-on against a plain wall, with nothing else in frame.'
              : 'Stand square-on against a plain wall in an A-pose: arms held clear of the body, feet apart. With the arms down the outline at chest and waist height is arm, not torso, and nothing recovers what the arms are covering.'}
          </p>
          <p className="note">
            The image is decoded, measured and discarded in this browser tab. It is never uploaded —
            this app has no server.
          </p>
        </div>

        <div className="section">
          <h2>Photographs</h2>
          <ImageSlot
            label={subject === 'body' ? 'Front view' : 'Photograph'}
            view={front}
            busy={busy}
            onLoad={(file) => void loadView('front', file)}
            onClear={() => clearView('front')}
          />
          {subject === 'body' && (
            <ImageSlot
              label="Side view (optional)"
              view={side}
              busy={busy}
              onLoad={(file) => void loadView('side', file)}
              onClear={() => clearView('side')}
              hint="Without it, every circumference combines a measured width with an assumed depth."
            />
          )}
          {error !== null && <p className="note" style={{ color: 'var(--danger)' }}>{error}</p>}
        </div>

        {front !== null && (
          <>
            <div className="section">
              <h2>Outline</h2>
              <p className="hint">
                Drag until the tinted region covers the subject and nothing else. The threshold is
                chosen automatically; this nudges it.
              </p>
              <div className="slider-row">
                <input
                  type="range"
                  min={0.5}
                  max={1.8}
                  step={0.02}
                  value={sensitivity}
                  onChange={(event) => setSensitivity(Number(event.target.value))}
                  aria-label="Segmentation sensitivity"
                />
                <span className="slider-value">{sensitivity.toFixed(2)}×</span>
              </div>

              <p className="hint" style={{ marginTop: 12 }}>
                Where the slider cannot separate them — tanned legs against pale sand, dark hair
                against wet rock — click the picture instead. A mark on a missed limb keeps it; a
                mark on something that is not the subject drops it.
              </p>
              <div className="buttons">
                <button
                  type="button"
                  className={clickMode === 'subject' ? 'primary' : 'secondary'}
                  aria-pressed={clickMode === 'subject'}
                  onClick={() => setClickMode(clickMode === 'subject' ? 'none' : 'subject')}
                >
                  Mark subject
                </button>
                <button
                  type="button"
                  className={clickMode === 'background' ? 'primary' : 'secondary'}
                  aria-pressed={clickMode === 'background'}
                  onClick={() => setClickMode(clickMode === 'background' ? 'none' : 'background')}
                >
                  Mark background
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    clearSeeds('front');
                    clearSeeds('side');
                  }}
                  disabled={front.seeds.length === 0 && (side?.seeds.length ?? 0) === 0}
                >
                  Clear marks
                </button>
              </div>
              {front.seeds.length > 0 && (
                <p className="note" style={{ marginTop: 8 }}>
                  {front.seeds.filter((s) => s.kind === 'subject').length} subject and{' '}
                  {front.seeds.filter((s) => s.kind === 'background').length} background marks on the
                  front view.
                </p>
              )}
            </div>

            <div className="section">
              <h2>Scale</h2>
              <p className="hint">
                A photograph has no absolute size. One known length turns every pixel into
                centimetres.
              </p>
              <div className="buttons">
                <button
                  type="button"
                  className={scaleMode === 'known-height' ? 'primary' : 'secondary'}
                  aria-pressed={scaleMode === 'known-height'}
                  onClick={() => setScaleMode('known-height')}
                >
                  Known height
                </button>
                <button
                  type="button"
                  className={scaleMode === 'reference' ? 'primary' : 'secondary'}
                  aria-pressed={scaleMode === 'reference'}
                  onClick={() => setScaleMode('reference')}
                >
                  Reference line
                </button>
              </div>

              {scaleMode === 'known-height' ? (
                <div className="field" style={{ marginTop: 12 }}>
                  <div className="field-head">
                    <label htmlFor="scan-height">Overall height of the subject</label>
                  </div>
                  <div className="field-row">
                    <input
                      id="scan-height"
                      type="number"
                      min={1}
                      max={500}
                      step={0.5}
                      value={knownHeightCm}
                      onChange={(event) => setKnownHeight(Number(event.target.value))}
                    />
                    <span className="unit">cm</span>
                  </div>
                  <p className="note">
                    Top to bottom of what is in frame — for a person, barefoot standing height.
                  </p>
                </div>
              ) : (
                <div className="field" style={{ marginTop: 12 }}>
                  <div className="field-head">
                    <label htmlFor="scan-reference">Length of the line you drew</label>
                  </div>
                  <div className="field-row">
                    <input
                      id="scan-reference"
                      type="number"
                      min={0.1}
                      max={500}
                      step={0.5}
                      value={referenceCm}
                      onChange={(event) => setReferenceCm(Number(event.target.value))}
                    />
                    <span className="unit">cm</span>
                    <button type="button" className="icon-btn" onClick={clearReference} title="Clear the line">
                      ✕
                    </button>
                  </div>
                  <p className="note">
                    {referencePoints.length < 2
                      ? `Click ${2 - referencePoints.length} more point${referencePoints.length === 1 ? '' : 's'} on the image to draw a line across something of known length.`
                      : `Line drawn: ${Math.hypot(
                          (referencePoints[1]?.x ?? 0) - (referencePoints[0]?.x ?? 0),
                          (referencePoints[1]?.y ?? 0) - (referencePoints[0]?.y ?? 0),
                        ).toFixed(0)} px. Use this when the subject's own size is what you are trying to find out.`}
                  </p>
                </div>
              )}
              {cmPerPixel > 0 && (
                <div className="summary-line">
                  <span>Scale</span>
                  <strong>{(cmPerPixel * 10).toFixed(2)} mm / pixel</strong>
                </div>
              )}
            </div>
          </>
        )}

        {scan !== null && (
          <>
            <div className="section">
              <h2>Measurements read</h2>
              <ScanTable scan={scan} />
              <div className="buttons" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    if (scan.kind === 'lamp') applyLampScan(scan.result.measurements);
                    else applyBodyScan(scan.result.measurements);
                  }}
                >
                  Send to {subject === 'lamp' ? 'lamp' : 'body'} workspace
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (scan.kind === 'lamp') saveLamp(scan.result.measurements, 1);
                    else saveBody(scan.result.measurements);
                  }}
                >
                  Save for comparison
                </button>
              </div>
              <p className="note" style={{ marginTop: 8 }}>
                Sent as <em>scanned</em>, which the solvers pin exactly like a typed measurement —
                but which the sidebar keeps labelled, so a number read off a lens is never mistaken
                for one read off a tape. Edit any field there to override it.
              </p>
            </div>

            <div className="section">
              <h2>What to trust</h2>
              <Notes notes={scan.result.notes} />
            </div>
          </>
        )}
      </aside>

      <main className="viewer scan-viewer">
        {front === null ? (
          <div className="empty-viewer">
            <p>Load a photograph to begin.</p>
          </div>
        ) : (
          <div className="scan-stage">
            <ScanPreview
              view={front}
              landmarks={scan?.result.landmarks ?? []}
              referencePoints={referencePoints}
              outline={outline}
              onPick={pickerFor('front')}
              seeds={front.seeds}
            />
            {side !== null && subject === 'body' && (
              <ScanPreview
                view={side}
                landmarks={[]}
                referencePoints={[]}
                outline={null}
                onPick={pickerFor('side')}
                seeds={side.seeds}
              />
            )}
          </div>
        )}
        {front !== null && (
          <div className="overlay">
            <div className="legend-row">
              <span className="swatch" data-provenance="scanned" aria-hidden="true" />
              <span>Detected outline</span>
            </div>
            <div className="legend-row">
              <span className="swatch" data-provenance="estimated" aria-hidden="true" />
              <span>Landmark heights</span>
            </div>
            <div className="legend-row">
              <span className="swatch" style={{ color: '#fff', background: '#fff' }} aria-hidden="true" />
              <span>Reconstruction, drawn back over the photo</span>
            </div>
            <div className="legend-row">
              <span>{silhouetteHeightPx(front.silhouette)} px tall in a {front.image.height} px frame</span>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

function ImageSlot({
  label,
  view,
  busy,
  onLoad,
  onClear,
  hint,
}: {
  readonly label: string;
  readonly view: ScanView | null;
  readonly busy: boolean;
  readonly onLoad: (file: File) => void;
  readonly onClear: () => void;
  readonly hint?: string;
}) {
  return (
    <div className="image-slot">
      <div className="field-head">
        <label>{label}</label>
        {view !== null && (
          <button type="button" className="icon-btn" onClick={onClear} title="Remove this image">
            ✕
          </button>
        )}
      </div>
      {view === null ? (
        <>
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) onLoad(file);
              event.target.value = '';
            }}
          />
          {hint !== undefined && <p className="note">{hint}</p>}
        </>
      ) : (
        <div className="slot-loaded">
          <img src={view.thumbnail} alt="" />
          <span>{view.name}</span>
        </div>
      )}
    </div>
  );
}

function Notes({ notes }: { readonly notes: readonly ScanNote[] }) {
  return (
    <div>
      {notes.map((note) => (
        <div className="constraint" key={note.text} data-ok={note.severity === 'info'}>
          <span className="mark" aria-hidden="true">
            {note.severity === 'info' ? 'i' : '!'}
          </span>
          <span>{note.text}</span>
        </div>
      ))}
    </div>
  );
}

function ScanTable({ scan }: { readonly scan: ScanResult }) {
  const entries = Object.entries(scan.result.measurements).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
  );
  return (
    <table className="derived-table">
      <thead>
        <tr>
          <th>Measurement</th>
          <th style={{ textAlign: 'right' }}>Read</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([key, value]) => {
          const spec =
            scan.kind === 'lamp'
              ? LAMP_PARAM_SPECS[key as LampMeasurementKey]
              : BODY_PARAM_SPECS[key as BodyMeasurementKey];
          return (
            <tr key={key} title={spec?.description ?? ''}>
              <td>{spec?.label ?? key}</td>
              <td className="value" data-provenance="scanned">
                {value.toFixed(1)} {spec?.unit ?? 'cm'}
              </td>
            </tr>
          );
        })}
        {entries.length === 0 && (
          <tr>
            <td colSpan={2}>Nothing could be read from this outline.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
