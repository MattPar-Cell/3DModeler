import { useState } from 'react';
import { LampWorkspace } from './LampWorkspace.tsx';
import { BodyWorkspace } from './BodyWorkspace.tsx';

type Mode = 'object' | 'body';

/**
 * App shell. Two reconstruction recipes share one philosophy: store the
 * parameters, generate the geometry.
 */
export function App() {
  const [mode, setMode] = useState<Mode>('object');

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
        </div>
      </header>
      {mode === 'object' ? <LampWorkspace /> : <BodyWorkspace />}
    </div>
  );
}
