import { useState } from 'react';
import { LampWorkspace } from './LampWorkspace.tsx';
import { BodyWorkspace } from './BodyWorkspace.tsx';
import { CompareWorkspace } from './CompareWorkspace.tsx';
import { useComparisonStore } from '../state/comparisonStore.ts';

type Mode = 'object' | 'body' | 'compare';

/**
 * App shell. Two reconstruction recipes share one philosophy: store the
 * parameters, generate the geometry.
 */
export function App() {
  const [mode, setMode] = useState<Mode>('object');
  const savedCount = useComparisonStore((s) => s.snapshots.length);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Parametric Shape Reconstructor</h1>
        <span className="sub">measurements in, geometry out — nothing stored but numbers</span>
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={mode === 'object'}
            onClick={() => setMode('object')}
          >
            Lamp template
          </button>
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={mode === 'body'}
            onClick={() => setMode('body')}
          >
            Human body
          </button>
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={mode === 'compare'}
            onClick={() => setMode('compare')}
          >
            Compare{savedCount > 0 ? ` (${savedCount})` : ''}
          </button>
        </div>
      </header>
      {mode === 'object' && <LampWorkspace />}
      {mode === 'body' && <BodyWorkspace />}
      {mode === 'compare' && <CompareWorkspace />}
    </div>
  );
}
