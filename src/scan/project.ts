import type { GeneratedPart } from '../templates/types.ts';

/**
 * The outline a generated model would cast.
 *
 * Two uses, and the second is why this is production code rather than a test
 * helper. The viewer draws it over the source photograph so the operator can
 * see how well the reconstruction matches what they photographed — the only
 * honest way to judge a scan. And it lets the scanner be tested against the app
 * itself: generate a model, project it, rasterise that into a synthetic
 * photograph, scan it, and check the measurements come back. No fixture images
 * in the repository, and the test exercises the whole pipeline.
 */

/** A horizontal slice of the outline: one or more runs of solid material. */
export interface OutlineRow {
  /** Left/right pairs in cm, ascending and non-overlapping. */
  readonly spans: readonly (readonly [number, number])[];
}

export interface ProjectedOutline {
  /** Lowest and highest point of the model, cm. */
  readonly minY: number;
  readonly maxY: number;
  /** Rows from the bottom up. */
  readonly rows: readonly OutlineRow[];
  /**
   * Half the full extent at each height, cm — the outline's envelope, ignoring
   * any gap inside it.
   */
  readonly halfWidths: Float64Array;
  /** Centre of that envelope across X at each height, cm. */
  readonly centres: Float64Array;
}

/**
 * Project a model onto the XY plane.
 *
 * Extents are collected *per part* and then merged, rather than reduced to one
 * min and max per row. That is what preserves the gap between the legs — and
 * the gap is not cosmetic: it is the only feature in a body silhouette that
 * marks a real anatomical landmark, and the scanner finds the inseam by looking
 * for it.
 *
 * Sampled from vertices: at the resolutions the templates generate, rings are
 * dense enough that the extreme vertex and the true extreme of the surface
 * differ by far less than a photograph's own precision.
 */
export function projectParts(parts: readonly GeneratedPart[], rows = 480): ProjectedOutline {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const part of parts) {
    const box = part.geometry.boundingBox;
    if (box === null) continue;
    minY = Math.min(minY, box.min.y);
    maxY = Math.max(maxY, box.max.y);
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY <= minY) {
    return {
      minY: 0,
      maxY: 0,
      rows: Array.from({ length: rows }, () => ({ spans: [] })),
      halfWidths: new Float64Array(rows),
      centres: new Float64Array(rows),
    };
  }

  const span = maxY - minY;
  const perPart = parts.map(() => ({
    left: new Float64Array(rows).fill(Infinity),
    right: new Float64Array(rows).fill(-Infinity),
  }));

  parts.forEach((part, p) => {
    const extent = perPart[p];
    if (extent === undefined) return;
    const position = part.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      const row = Math.min(
        rows - 1,
        Math.max(0, Math.round(((position.getY(i) - minY) / span) * (rows - 1))),
      );
      const x = position.getX(i);
      if (x < (extent.left[row] ?? Infinity)) extent.left[row] = x;
      if (x > (extent.right[row] ?? -Infinity)) extent.right[row] = x;
    }

    // Rows are far finer than the spacing between a part's rings, so most rows
    // catch no vertex of it. Fill those in by interpolating along the part's
    // own height: a part's outline is continuous over the range it occupies,
    // and leaving the gaps empty punches horizontal slots through the outline.
    let first = -1;
    let last = -1;
    for (let row = 0; row < rows; row += 1) {
      if (Number.isFinite(extent.left[row] ?? Infinity)) {
        if (first === -1) first = row;
        last = row;
      }
    }
    if (first === -1) return;
    let previous = first;
    for (let row = first + 1; row <= last; row += 1) {
      if (Number.isFinite(extent.left[row] ?? Infinity)) {
        if (row > previous + 1) {
          const gap = row - previous;
          for (let k = 1; k < gap; k += 1) {
            const t = k / gap;
            extent.left[previous + k] =
              (extent.left[previous] ?? 0) * (1 - t) + (extent.left[row] ?? 0) * t;
            extent.right[previous + k] =
              (extent.right[previous] ?? 0) * (1 - t) + (extent.right[row] ?? 0) * t;
          }
        }
        previous = row;
      }
    }
  });

  const outRows: OutlineRow[] = [];
  const halfWidths = new Float64Array(rows);
  const centres = new Float64Array(rows);

  for (let row = 0; row < rows; row += 1) {
    const intervals: [number, number][] = [];
    for (const extent of perPart) {
      const l = extent.left[row] ?? Infinity;
      const r = extent.right[row] ?? -Infinity;
      if (Number.isFinite(l) && Number.isFinite(r) && r >= l) intervals.push([l, r]);
    }
    intervals.sort((a, b) => a[0] - b[0]);

    const merged: [number, number][] = [];
    for (const interval of intervals) {
      const last = merged[merged.length - 1];
      if (last !== undefined && interval[0] <= last[1]) {
        last[1] = Math.max(last[1], interval[1]);
      } else {
        merged.push([interval[0], interval[1]]);
      }
    }

    outRows.push({ spans: merged });
    const first = merged[0];
    const final = merged[merged.length - 1];
    if (first === undefined || final === undefined) {
      halfWidths[row] = 0;
      centres[row] = 0;
    } else {
      halfWidths[row] = (final[1] - first[0]) / 2;
      centres[row] = (final[1] + first[0]) / 2;
    }
  }

  return { minY, maxY, rows: outRows, halfWidths, centres };
}

/** Half-width in cm at a fraction of the outline's height, 0 at the bottom. */
export function outlineHalfWidthAt(outline: ProjectedOutline, t: number): number {
  const rows = outline.halfWidths.length;
  if (rows === 0) return 0;
  const index = Math.min(rows - 1, Math.max(0, Math.round(t * (rows - 1))));
  return outline.halfWidths[index] ?? 0;
}

/** The solid runs at a fraction of the outline's height, in cm. */
export function outlineSpansAt(
  outline: ProjectedOutline,
  t: number,
): readonly (readonly [number, number])[] {
  const rows = outline.rows.length;
  if (rows === 0) return [];
  const index = Math.min(rows - 1, Math.max(0, Math.round(t * (rows - 1))));
  return outline.rows[index]?.spans ?? [];
}
