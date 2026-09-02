import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import type { Object3D } from 'three';

/**
 * Mesh export.
 *
 * The scene graph is authored in centimetres and the exported root carries a
 * 0.01 scale, so both formats come out in metres — the glTF convention, and
 * what every downstream DCC tool expects from an OBJ that claims metric units.
 */

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next frame so Safari has committed the navigation.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

/** Export `root` as a binary glTF (.glb). */
export async function exportGLB(root: Object3D, filename: string): Promise<void> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(root, { binary: true, onlyVisible: false });
  const blob =
    result instanceof ArrayBuffer
      ? new Blob([result], { type: 'model/gltf-binary' })
      : new Blob([JSON.stringify(result)], { type: 'model/gltf+json' });
  download(blob, filename);
}

/** Export `root` as a Wavefront OBJ. */
export function exportOBJ(root: Object3D, filename: string): void {
  const text = new OBJExporter().parse(root);
  download(new Blob([text], { type: 'text/plain' }), filename);
}

/** A filesystem-safe timestamped name, e.g. `lamp-2026-09-02-1431.glb`. */
export function timestampedName(stem: string, extension: string): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${stem}-${stamp}.${extension}`;
}
