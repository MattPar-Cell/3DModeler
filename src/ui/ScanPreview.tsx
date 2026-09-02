import { useEffect, useRef } from 'react';
import type { ProjectedOutline } from '../scan/project.ts';
import type { ScanView } from '../state/scanStore.ts';
import type { Seed } from '../scan/segment.ts';
import type { ReferencePoint } from '../state/scanStore.ts';

/**
 * The photograph with everything the scanner saw drawn on top of it.
 *
 * This is the scanner's honesty surface. A number in the table beside it is
 * only as good as the outline it came from, and the only way to judge that is
 * to see the outline the app actually found lying over the picture it found it
 * in — including the reconstructed model's own silhouette, so a bad fit is
 * visible rather than merely suspected.
 */

export interface ScanPreviewProps {
  readonly view: ScanView;
  /** Height fractions to mark, 0 at the bottom of the subject. */
  readonly landmarks: readonly { readonly label: string; readonly t: number }[];
  readonly referencePoints: readonly ReferencePoint[];
  /** Outline of the reconstruction, drawn over the photo when available. */
  readonly outline: ProjectedOutline | null;
  readonly onPick: ((point: ReferencePoint) => void) | undefined;
  /** Operator corrections to draw. */
  readonly seeds: readonly Seed[];
}

const MASK_TINT = { r: 79, g: 199, b: 199 };

export function ScanPreview({
  view,
  landmarks,
  referencePoints,
  outline,
  onPick,
  seeds,
}: ScanPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const { image, mask, silhouette } = view;
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (context === null) return;

    // The photo, with everything the segmenter called subject tinted.
    const composited = new Uint8ClampedArray(image.data.length);
    composited.set(image.data);
    for (let p = 0; p < mask.data.length; p += 1) {
      if ((mask.data[p] ?? 0) === 0) continue;
      const i = p * 4;
      composited[i] = ((composited[i] ?? 0) * 3 + MASK_TINT.r) / 4;
      composited[i + 1] = ((composited[i + 1] ?? 0) * 3 + MASK_TINT.g) / 4;
      composited[i + 2] = ((composited[i + 2] ?? 0) * 3 + MASK_TINT.b) / 4;
    }
    context.putImageData(new ImageData(composited, image.width, image.height), 0, 0);

    const heightPx = silhouette.bottom - silhouette.top + 1;
    const rowFor = (t: number): number => silhouette.bottom - t * (heightPx - 1);

    // The subject's bounding box, so the scale reference is unambiguous.
    context.strokeStyle = 'rgba(79, 199, 199, 0.85)';
    context.lineWidth = Math.max(1, image.width / 400);
    context.setLineDash([6, 4]);
    context.strokeRect(0.5, silhouette.top + 0.5, image.width - 1, heightPx - 1);
    context.setLineDash([]);

    // Landmark heights.
    context.font = `${Math.max(10, Math.round(image.width / 34))}px ui-sans-serif, system-ui, sans-serif`;
    context.textBaseline = 'bottom';
    for (const landmark of landmarks) {
      const y = rowFor(landmark.t);
      context.strokeStyle = 'rgba(240, 166, 60, 0.9)';
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(image.width, y);
      context.stroke();
      context.fillStyle = 'rgba(240, 166, 60, 0.95)';
      context.fillText(landmark.label, 4, y - 2);
    }

    // The reconstruction's own outline, aligned to the subject's box.
    if (outline !== null && outline.maxY > outline.minY) {
      const cmPerPixel = 1 / ((heightPx - 1) / (outline.maxY - outline.minY));
      const centre = silhouette.midlineX;
      context.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      context.lineWidth = Math.max(1, image.width / 420);
      for (const side of [1, -1]) {
        context.beginPath();
        for (let i = 0; i < outline.halfWidths.length; i += 1) {
          const t = i / (outline.halfWidths.length - 1);
          const x = centre + (side * (outline.halfWidths[i] ?? 0)) / cmPerPixel;
          const y = rowFor(t);
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }
    }

    // Operator corrections: filled for subject, hollow for background.
    for (const seed of seeds) {
      const radius = Math.max(4, image.width / 110);
      context.lineWidth = Math.max(1.5, image.width / 320);
      context.beginPath();
      context.arc(seed.x, seed.y, radius, 0, Math.PI * 2);
      if (seed.kind === 'subject') {
        context.fillStyle = 'rgba(110, 231, 168, 0.9)';
        context.fill();
        context.strokeStyle = '#0d1116';
        context.stroke();
      } else {
        context.fillStyle = 'rgba(20, 22, 26, 0.75)';
        context.fill();
        context.strokeStyle = '#ff8a7a';
        context.stroke();
      }
    }

    // The reference line, if one is being drawn.
    if (referencePoints.length > 0) {
      context.strokeStyle = '#6ee7a8';
      context.fillStyle = '#6ee7a8';
      context.lineWidth = Math.max(1.5, image.width / 300);
      const radius = Math.max(3, image.width / 140);
      context.beginPath();
      referencePoints.forEach((point, i) => {
        if (i === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      if (referencePoints.length > 1) context.stroke();
      for (const point of referencePoints) {
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
      }
    }
  }, [view, landmarks, referencePoints, outline, seeds]);

  return (
    <canvas
      ref={canvasRef}
      className="scan-canvas"
      data-picking={onPick !== undefined}
      onClick={(event) => {
        if (onPick === undefined) return;
        const canvas = canvasRef.current;
        if (canvas === null) return;
        const box = canvas.getBoundingClientRect();
        onPick({
          x: ((event.clientX - box.left) / box.width) * canvas.width,
          y: ((event.clientY - box.top) / box.height) * canvas.height,
        });
      }}
    />
  );
}
