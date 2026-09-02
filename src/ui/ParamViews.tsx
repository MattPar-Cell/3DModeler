import { isObserved } from '../core/params.ts';
import type { ConstraintReport, ParamSpec, Provenance, ResolvedParam } from '../core/params.ts';

/**
 * Shared presentational pieces for showing parameters and their provenance.
 *
 * Provenance is never signalled by colour alone: measured fields get a solid
 * border, derived a dashed one, estimated a dotted italic one, and every value
 * carries a text badge.
 */

const PROVENANCE_LABEL: Record<Provenance, string> = {
  measured: 'measured',
  scanned: 'scanned',
  derived: 'derived',
  estimated: 'estimated',
};

export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  return (
    <span className="badge" data-provenance={provenance}>
      {PROVENANCE_LABEL[provenance]}
    </span>
  );
}

export interface MeasurementFieldProps {
  readonly spec: ParamSpec;
  /** The solved parameter, which may differ from the draft if it was clamped. */
  readonly resolved: ResolvedParam;
  /** Raw input text, so partially typed values are not fought by the store. */
  readonly draft: string;
  readonly onChange: (text: string) => void;
  readonly onClear: () => void;
}

export function MeasurementField({
  spec,
  resolved,
  draft,
  onChange,
  onClear,
}: MeasurementFieldProps) {
  const observed = isObserved(resolved.provenance);
  // When the value is inferred, show the solver's number as a placeholder so
  // the user can see what the template chose without it looking entered.
  const placeholder = resolved.value.toFixed(1);

  return (
    <div className="field" data-provenance={resolved.provenance}>
      <div className="field-head">
        <label htmlFor={`m-${spec.key}`}>{spec.label}</label>
        <ProvenanceBadge provenance={resolved.provenance} />
      </div>
      <div className="field-row">
        <input
          id={`m-${spec.key}`}
          type="number"
          inputMode="decimal"
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 0.1}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          title={spec.description}
          aria-describedby={`d-${spec.key}`}
        />
        <span className="unit">{spec.unit}</span>
        <button
          type="button"
          className="icon-btn"
          onClick={onClear}
          disabled={!observed}
          title={
            observed
              ? 'Clear this measurement and let the template infer it'
              : 'Nothing entered — this value is already inferred'
          }
        >
          ✕
        </button>
      </div>
      <p className="note" id={`d-${spec.key}`}>
        {resolved.provenance === 'scanned'
          ? (resolved.note ?? 'Read off a photograph. Edit to override with a tape measurement.')
          : observed
            ? `Plausible range ${spec.min}–${spec.max} ${spec.unit}.`
            : (resolved.note ?? spec.description)}
      </p>
    </div>
  );
}

export function DerivedTable({
  params,
  hide,
}: {
  readonly params: readonly ResolvedParam[];
  readonly hide?: readonly string[];
}) {
  const rows = params.filter((p) => !(hide ?? []).includes(p.spec.key));
  return (
    <table className="derived-table">
      <thead>
        <tr>
          <th>Parameter</th>
          <th style={{ textAlign: 'right' }}>Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((param) => (
          <tr key={param.spec.key} title={`${param.spec.description}${param.note ? `\n\n${param.note}` : ''}`}>
            <td>{param.spec.label}</td>
            <td className="value" data-provenance={param.provenance}>
              {formatValue(param)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function formatValue(param: ResolvedParam): string {
  const digits = param.spec.unit === 'ratio' ? 2 : 1;
  const unit = param.spec.unit === 'ratio' ? '×' : ` ${param.spec.unit}`;
  return `${param.value.toFixed(digits)}${unit}`;
}

export function Constraints({ reports }: { reports: readonly ConstraintReport[] }) {
  return (
    <div>
      {reports.map((report) => (
        <div className="constraint" key={report.id} data-ok={report.satisfied}>
          <span className="mark" aria-hidden="true">
            {report.satisfied ? '✓' : '!'}
          </span>
          <span>
            {report.description}
            {report.resolution !== undefined && (
              <span className="resolution">{report.resolution}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
