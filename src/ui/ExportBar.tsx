import { useState } from 'react';
import type { RefObject } from 'react';
import type { Group } from 'three';
import { exportGLB, exportOBJ, timestampedName } from '../export/exporters.ts';

/** GLB / OBJ export buttons for the currently displayed model root. */
export function ExportBar({
  rootRef,
  stem,
}: {
  readonly rootRef: RefObject<Group | null>;
  readonly stem: string;
}) {
  const [status, setStatus] = useState<string | null>(null);

  const run = async (kind: 'glb' | 'obj'): Promise<void> => {
    const root = rootRef.current;
    if (root === null) {
      setStatus('The viewer is still starting up — try again in a moment.');
      return;
    }
    try {
      setStatus(`Exporting ${kind.toUpperCase()}…`);
      if (kind === 'glb') await exportGLB(root, timestampedName(stem, 'glb'));
      else exportOBJ(root, timestampedName(stem, 'obj'));
      setStatus(`${kind.toUpperCase()} downloaded.`);
    } catch (error) {
      setStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <>
      <div className="buttons">
        <button type="button" className="primary" onClick={() => void run('glb')}>
          Export GLB
        </button>
        <button type="button" className="secondary" onClick={() => void run('obj')}>
          Export OBJ
        </button>
      </div>
      {status !== null && (
        <p className="note" role="status">
          {status}
        </p>
      )}
    </>
  );
}
