/**
 * Default proportion ratios for the lamp template.
 *
 * These are lighting-trade sizing conventions, not measurements of a specific
 * product. They exist so that a user who types three numbers still gets a
 * plausible lamp. Every value here produces a `derived` parameter, and the UI
 * marks derived parameters distinctly from the ones the user entered.
 *
 * Sources are the standard lampshade-fitting rules of thumb used by shade
 * manufacturers and interior-design references:
 *  - Shade height is about one third of the lamp's overall height.
 *  - The shade's bottom diameter is roughly twice the width of the lamp base,
 *    and must never be narrower than the base, or the lamp looks top-light and
 *    the base edge catches the light.
 *  - An "empire" shade tapers so the top diameter is 60-70% of the bottom.
 *  - The base occupies the bottom 8-14% of the overall height on table lamps.
 *
 * Ratios are expressed against the parameter named in the constant, so they
 * stay meaningful when the user pins a different subset of measurements.
 */

/** Shade height as a fraction of total lamp height. Trade rule: about 1/3. */
export const SHADE_HEIGHT_OVER_TOTAL_HEIGHT = 0.32;

/** Base height as a fraction of total lamp height. Typical range 0.08-0.14. */
export const BASE_HEIGHT_OVER_TOTAL_HEIGHT = 0.11;

/**
 * Minimum stem height as a fraction of total height. Below this the lamp
 * reads as a shade sitting on a plinth rather than a table lamp, so the
 * solver borrows height back from the shade to protect it.
 */
export const MIN_STEM_HEIGHT_OVER_TOTAL_HEIGHT = 0.2;

/** Shade bottom diameter as a fraction of base diameter. Trade rule: ~2x. */
export const SHADE_DIAMETER_OVER_BASE_DIAMETER = 1.9;

/** Empire-shade taper: top diameter as a fraction of bottom diameter. */
export const SHADE_TOP_OVER_BOTTOM_DIAMETER = 0.66;

/** Stem diameter as a fraction of base diameter. Slim turned stems sit near 0.2. */
export const STEM_DIAMETER_OVER_BASE_DIAMETER = 0.22;

/** The base tapers inward toward the stem; this is its top/bottom diameter ratio. */
export const BASE_TOP_OVER_BOTTOM_DIAMETER = 0.5;

/**
 * The stem swells slightly at mid height on a turned wooden or ceramic lamp.
 * 1.0 gives a plain cylinder; 1.15 is a gentle classical belly.
 */
export const STEM_BELLY = 1.18;

/** Height at which the stem's belly peaks, as a fraction of stem height. */
export const STEM_BELLY_POSITION = 0.38;

/**
 * Clearance between the top of the stem and the bottom of the shade, as a
 * fraction of shade height. Represents the socket and harp hardware.
 */
export const SOCKET_HEIGHT_OVER_SHADE_HEIGHT = 0.18;

/** Socket diameter as a fraction of stem diameter. */
export const SOCKET_DIAMETER_OVER_STEM_DIAMETER = 1.35;

/** Ring/loft resolution. 96 segments keeps a 50 cm shade rim visually smooth. */
export const RADIAL_SEGMENTS = 96;

/** Rings per part along the vertical axis for the tapered/bellied parts. */
export const PROFILE_ROWS = 40;

/**
 * The shade's side bows outward slightly rather than running dead straight.
 * A drum or empire shade is cut from a flat pattern, so its side is a straight
 * line in elevation; a fabric one relaxes into a shallow convex curve. This is
 * the bulge at mid height as a fraction of the mean radius.
 */
export const SHADE_BOW = 0.022;

/** Rolled rim at the top and bottom of the shade, as a fraction of its height. */
export const SHADE_RIM_HEIGHT = 0.025;
/**
 * How far the rim stands proud of the shade's surface, as a fraction of the
 * shade's mean radius. This is a wire ring wrapped in fabric — a couple of
 * millimetres on a real shade. Push it to a centimetre and the shade stops
 * looking like a shade and starts looking like a bell.
 */
export const SHADE_RIM_PROJECTION = 0.018;

/** Harp: the wire loop carrying the shade. Diameter as a fraction of stem diameter. */
export const HARP_WIRE_OVER_STEM_DIAMETER = 0.16;
/** How far out the harp bows, as a fraction of the shade's bottom radius. */
export const HARP_SPREAD = 0.62;

/** Finial: the knob capping the shade. Diameter as a fraction of shade top diameter. */
export const FINIAL_DIAMETER_OVER_SHADE_TOP = 0.13;
/** Finial height as a fraction of its own diameter. */
export const FINIAL_HEIGHT_OVER_DIAMETER = 1.9;

/**
 * Fallback base diameter when the user has entered neither a base nor a shade
 * diameter, expressed against total height. Table lamps cluster near 0.3.
 */
export const BASE_DIAMETER_OVER_TOTAL_HEIGHT = 0.29;

/** Bounds of the proportion-lock slider. 1.0 leaves the default ratios alone. */
export const PROPORTION_MIN = 0.6;
export const PROPORTION_MAX = 1.4;
