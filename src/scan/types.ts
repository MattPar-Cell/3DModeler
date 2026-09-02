/**
 * Image types for the scanner.
 *
 * Deliberately DOM-free: the whole analysis pipeline works on plain typed
 * arrays, so it can be unit tested against synthetic images under `node --test`
 * with no canvas, no browser and no fixture photographs in the repository.
 * Only `load.ts` touches the DOM.
 */

/** An RGBA image, four bytes per pixel, row major. */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  /** `width * height * 4` bytes, RGBA. */
  readonly data: Uint8ClampedArray;
}

/** A binary mask, one byte per pixel: 1 inside the subject, 0 outside. */
export interface Mask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/**
 * The subject's outline, as a horizontal span per row.
 *
 * This is all the analysis needs: a silhouette is a function from height to a
 * left and right edge, and every measurement below is a question about that
 * function.
 */
export interface Silhouette {
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** First and last row containing any subject pixel. */
  readonly top: number;
  readonly bottom: number;
  /** Leftmost subject pixel per row, `-1` where the row is empty. */
  readonly left: Int32Array;
  /** Rightmost subject pixel per row, `-1` where the row is empty. */
  readonly right: Int32Array;
  /**
   * Number of separate runs of subject pixels in each row. Two runs low down
   * means the legs have separated, which is how the crotch is found.
   */
  readonly runs: Int32Array;
  /** Subject pixels per row, which is width minus any gap between runs. */
  readonly filled: Int32Array;
  /**
   * 1 where the subject's own midline is *not* covered in that row.
   *
   * This is how the crotch is found. Counting runs per row does not work: with
   * the arms held clear of the body a row through the thighs has four runs, and
   * the two extra keep the count above two well above the point where the legs
   * actually meet. A gap straddling the midline is unambiguous.
   */
  readonly midlineGap: Uint8Array;
  /** Column the midline test is taken at. */
  readonly midlineX: number;
  /**
   * Left and right edge of the run straddling the midline, or -1 where the
   * midline is uncovered.
   *
   * This, not the row's full extent, is the torso. With the arms held clear of
   * the body a row through the waist has three runs — arm, torso, arm — and
   * measuring edge to edge returns the span of the arms, which for a real
   * subject came out at twice the true waist.
   */
  readonly midRunLeft: Int32Array;
  readonly midRunRight: Int32Array;
}

/** Height of the subject in pixels. */
export function silhouetteHeightPx(silhouette: Silhouette): number {
  return silhouette.bottom - silhouette.top + 1;
}
