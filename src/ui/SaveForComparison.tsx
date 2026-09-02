import { useState } from 'react';
import { useComparisonStore } from '../state/comparisonStore.ts';
import type { LampMeasurements } from '../templates/lamp/spec.ts';
import type { BodyMeasurements } from '../body/spec.ts';

type Props =
  | { readonly kind: 'lamp'; readonly measurements: LampMeasurements; readonly proportion: number }
  | { readonly kind: 'body'; readonly measurements: BodyMeasurements };

/**
 * Saves the current parameter set for comparison.
 *
 * What gets stored is the measurements the user entered — not the solved
 * parameters and certainly not the mesh — so a saved model is re-solved and
 * re-generated whenever it is shown.
 */
export function SaveForComparison(props: Props) {
  const saveLamp = useComparisonStore((s) => s.saveLamp);
  const saveBody = useComparisonStore((s) => s.saveBody);
  const total = useComparisonStore((s) => s.snapshots.length);
  const [justSaved, setJustSaved] = useState(false);

  const entered = Object.values(props.measurements).filter(
    (v) => typeof v === 'number' && Number.isFinite(v),
  ).length;

  const save = (): void => {
    if (props.kind === 'lamp') saveLamp(props.measurements, props.proportion);
    else saveBody(props.measurements);
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 2200);
  };

  return (
    <>
      <div className="buttons">
        <button type="button" className="secondary" onClick={save}>
          Save for comparison
        </button>
      </div>
      <p className="note" style={{ marginTop: 8 }} role="status">
        {justSaved
          ? `Saved. ${total} model${total === 1 ? '' : 's'} available in the Compare tab.`
          : entered === 0
            ? 'Saves the current model. Nothing is entered yet, so this would save the fully inferred default.'
            : `Saves the ${entered} measurement${entered === 1 ? '' : 's'} you entered — not the mesh, so it stays valid if the template changes.`}
      </p>
    </>
  );
}
