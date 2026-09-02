/**
 * Anthropometric priors — the single source of every population-derived number
 * in the body model.
 *
 * WHAT THESE ARE
 * Ratios to stature (`H`), used when the user has not measured something. They
 * are population *means*, so any individual sits somewhere in a fairly wide
 * band around them. That is precisely why the app labels anything built from
 * them `estimated` and renders it translucent: these numbers describe a
 * population, not the person in front of you.
 *
 * SOURCES
 * [1] Drillis, R. & Contini, R. (1966). "Body Segment Parameters", Report
 *     1166-03, New York University School of Engineering and Science.
 *     Segment lengths as fractions of stature. Widely reproduced as Figure 4.1
 *     of Winter, D.A. (2009), "Biomechanics and Motor Control of Human
 *     Movement", 4th ed., Wiley.
 * [2] Gordon, C.C. et al. (2014). "2012 Anthropometric Survey of U.S. Army
 *     Personnel: Methods and Summary Statistics" (ANSUR II), Technical Report
 *     NATICK/TR-15/007. Circumference means, n = 4,082 male / 1,986 female.
 * [3] Fryar, C.D. et al. (2021). "Anthropometric Reference Data for Children
 *     and Adults: United States, 2015-2018", NCHS Vital and Health Statistics
 *     Series 3, No. 46. General-population figures, notably larger in the waist
 *     than the ANSUR II military sample.
 * [4] Siri, W.E. (1961). "Body composition from fluid spaces and density", in
 *     Techniques for Measuring Body Composition, National Academy of Sciences.
 *
 * A NOTE ON SEX
 * The app does not ask for sex, so the circumference priors below are the
 * midpoint of the ANSUR II male and female means. Male and female means differ
 * by roughly 3-7% of stature at the chest, waist and hip, which is a large
 * error for a single person. Entering the corresponding measurement removes the
 * prior from the fit entirely, which is always the better outcome.
 *
 * UNITS
 * Every ratio here multiplies stature in centimetres and yields centimetres,
 * except where marked otherwise.
 */

// ---------------------------------------------------------------------------
// Stature
// ---------------------------------------------------------------------------

/**
 * Fallback stature when nothing at all has been entered, in cm.
 * Midpoint of the US adult male (175.3) and female (161.7) means [3].
 */
export const DEFAULT_STATURE_CM = 168.5;

/** Plausible adult stature range, cm. Roughly the 0.1st-99.9th percentile [3]. */
export const STATURE_MIN_CM = 130;
export const STATURE_MAX_CM = 215;

// ---------------------------------------------------------------------------
// Landmark heights as fractions of stature [1]
// The skeleton is laid out from these, so they define the whole vertical scale.
// ---------------------------------------------------------------------------

/** Vertex to chin. */
export const HEAD_HEIGHT = 0.13;
/** Floor to the chin, i.e. the top of the neck. */
export const CHIN_HEIGHT = 0.87;
/** Floor to the base of the neck where it meets the shoulders. */
export const NECK_BASE_HEIGHT = 0.82;
/** Floor to the acromion (bony point of the shoulder). */
export const SHOULDER_HEIGHT = 0.818;
/** Floor to nipple height — where a chest circumference is taken. */
export const CHEST_HEIGHT = 0.72;
/** Floor to the lower ribs. */
export const UNDERBUST_HEIGHT = 0.67;
/** Floor to the natural waist, the body's narrowest point. Elbow height [1]. */
export const WAIST_HEIGHT = 0.63;
/** Floor to the greater trochanter — the widest point across the hips. */
export const HIP_HEIGHT = 0.53;
/** Floor to the crotch. This is the inseam. ANSUR II crotch height / stature [2]. */
export const CROTCH_HEIGHT = 0.47;
/** Floor to the knee joint. */
export const KNEE_HEIGHT = 0.285;
/** Floor to the widest point of the calf. */
export const CALF_HEIGHT = 0.19;
/** Floor to the ankle joint. */
export const ANKLE_HEIGHT = 0.039;
/** Floor to the elbow joint, along a hanging arm. */
export const ELBOW_HEIGHT = 0.63;
/** Floor to the wrist, along a hanging arm. */
export const WRIST_HEIGHT = 0.485;
/** Floor to the fingertips, along a hanging arm. */
export const FINGERTIP_HEIGHT = 0.377;

// ---------------------------------------------------------------------------
// Breadths and segment lengths as fractions of stature [1]
// ---------------------------------------------------------------------------

/**
 * Shoulder breadth, shoulder point to shoulder point across the back.
 *
 * Drillis & Contini give 0.259 for "shoulder width" [1]. Be aware that this
 * sits between the two breadths ANSUR II reports separately: biacromial
 * (bone to bone, about 0.227 H) and bideltoid (across the deltoid muscle,
 * about 0.281 H) [2]. 0.259 is used here because it matches what someone
 * actually measures with a tape laid across the back, which is the input the
 * sidebar asks for.
 */
export const SHOULDER_WIDTH = 0.259;
/** Bi-iliac breadth — the skeletal width across the pelvis. */
export const HIP_WIDTH = 0.191;
/** Acromion to elbow. */
export const UPPER_ARM_LENGTH = 0.186;
/** Elbow to wrist. */
export const FOREARM_LENGTH = 0.146;
/** Wrist to fingertip. */
export const HAND_LENGTH = 0.108;
/** Hip joint to knee joint. */
export const THIGH_LENGTH = 0.245;
/** Knee joint to ankle joint. */
export const SHANK_LENGTH = 0.246;
/** Heel to toe. */
export const FOOT_LENGTH = 0.152;
/** Widest point across the foot. */
export const FOOT_BREADTH = 0.055;

// ---------------------------------------------------------------------------
// Circumference priors as fractions of stature
// Midpoints of the ANSUR II male and female means [2]. The `_SPREAD` values are
// roughly one standard deviation, and exist so the UI can say how uncertain an
// estimated circumference is rather than presenting it as a fact.
// ---------------------------------------------------------------------------

/** Head circumference. ~57 cm at 175 cm stature. */
export const HEAD_CIRCUMFERENCE = 0.325;
/** Neck circumference, taken below the larynx. Male 0.224, female 0.203 [2]. */
export const NECK_CIRCUMFERENCE = 0.214;
export const NECK_CIRCUMFERENCE_SPREAD = 0.014;
/** Chest/bust circumference at nipple height. Male 0.600, female 0.568 [2]. */
export const CHEST_CIRCUMFERENCE = 0.584;
export const CHEST_CIRCUMFERENCE_SPREAD = 0.045;
/**
 * Circumference at the lower ribs, as a fraction of stature. Used only when
 * neither a chest nor a waist figure is available; otherwise the underbust is
 * interpolated between them (see {@link UNDERBUST_BLEND}), which tracks an
 * individual far better than an independent population mean does.
 */
export const UNDERBUST_CIRCUMFERENCE = 0.53;

/**
 * Where the underbust sits between the waist and the chest. 0 puts it at the
 * waist, 1 at the chest. Around 0.45 for both sexes in the ANSUR II sample [2].
 * Modelling it as a blend rather than a free prior matters visually: an
 * independent prior can land below the waist measurement and put a step in the
 * ribcage that no body has.
 */
export const UNDERBUST_BLEND = 0.45;
/**
 * Natural waist circumference. Male 0.504, female 0.482 [2].
 * The general US population runs far larger — about 0.58 for men and 0.60 for
 * women [3] — because ANSUR II samples a physically screened population. The
 * ANSUR figure is used here because the mass constraint (see `fit.ts`) pulls
 * the waist toward the user's actual weight whenever weight is entered.
 */
export const WAIST_CIRCUMFERENCE = 0.493;
export const WAIST_CIRCUMFERENCE_SPREAD = 0.055;
/** Buttock circumference — the widest point across the hips. Male 0.587, female 0.629 [2]. */
export const HIP_CIRCUMFERENCE = 0.608;
export const HIP_CIRCUMFERENCE_SPREAD = 0.04;
/** Upper thigh circumference, taken just below the gluteal fold. */
export const THIGH_CIRCUMFERENCE = 0.356;
export const THIGH_CIRCUMFERENCE_SPREAD = 0.032;
/** Knee circumference. */
export const KNEE_CIRCUMFERENCE = 0.22;
/** Maximum calf circumference. */
export const CALF_CIRCUMFERENCE = 0.217;
/** Minimum ankle circumference. */
export const ANKLE_CIRCUMFERENCE = 0.128;
/** Relaxed upper-arm (biceps) circumference. Male 0.193, female 0.174 [2]. */
export const BICEP_CIRCUMFERENCE = 0.184;
export const BICEP_CIRCUMFERENCE_SPREAD = 0.019;
/** Maximum forearm circumference. */
export const FOREARM_CIRCUMFERENCE = 0.157;
/** Minimum wrist circumference. Male 0.099, female 0.093 [2]. */
export const WRIST_CIRCUMFERENCE = 0.096;
export const WRIST_CIRCUMFERENCE_SPREAD = 0.007;

// ---------------------------------------------------------------------------
// Cross-section shape
// Depth-to-width ratios and super-ellipse exponents. A human cross-section is
// neither a circle nor an ellipse: the torso is measurably flatter front-to-back
// than an ellipse of the same perimeter, and limbs are close to round.
// Figures are fitted from published torso-scan cross-section geometry and are
// the least firmly sourced numbers in this file; they affect the silhouette but
// not the circumferences, which are matched exactly by construction.
// ---------------------------------------------------------------------------

/** Depth / width of the chest cross-section. */
export const CHEST_ASPECT = 0.72;
/** Depth / width at the waist. */
export const WAIST_ASPECT = 0.78;
/** Depth / width at the hips. */
export const HIP_ASPECT = 0.74;
/** Depth / width of the neck. */
export const NECK_ASPECT = 0.92;
/** Depth / width of limb cross-sections. */
export const LIMB_ASPECT = 0.94;
/** Depth / width of the head, which is longer front-to-back than it is wide. */
export const HEAD_ASPECT = 1.24;

/** Super-ellipse exponent for torso cross-sections. 2 would be a plain ellipse. */
export const TORSO_SQUARENESS = 2.45;
/** Super-ellipse exponent for limb cross-sections. */
export const LIMB_SQUARENESS = 2.1;

// ---------------------------------------------------------------------------
// Mass
// ---------------------------------------------------------------------------

/**
 * Whole-body density in kg per litre, used to turn the reconstructed mesh
 * volume into a mass estimate.
 *
 * Densitometry gives 1.03-1.07 kg/L for body volume corrected for lung gas [4];
 * the mesh here is the *external* surface, which includes roughly 1.2 L of
 * thoracic gas, lowering the effective figure to about 1.01. Treat this as
 * accurate to a few percent — the fitter searches a girth scale to match the
 * entered weight, so a small density error shows up as a small girth error, not
 * as a failure to converge.
 */
export const BODY_DENSITY_KG_PER_L = 1.01;

/** Plausible adult mass range, kg. */
export const MASS_MIN_KG = 30;
export const MASS_MAX_KG = 250;

/**
 * BMI used to estimate mass when the user gives a height but no weight.
 * Midpoint of the US adult male (29.1) and female (29.6) means [3], pulled down
 * slightly toward the healthy range so an unmeasured body does not default to
 * a distinctly heavy one.
 */
export const DEFAULT_BMI = 25.5;

/** Bounds of the global girth search used to satisfy an entered weight. */
export const GIRTH_SCALE_MIN = 0.55;
export const GIRTH_SCALE_MAX = 2.0;

// ---------------------------------------------------------------------------
// Pose
// ---------------------------------------------------------------------------

/** Arm abduction from vertical, radians. A relaxed A-pose. */
export const ARM_ABDUCTION_RAD = 0.21;
/** Leg abduction from vertical, radians. Feet a little under the hips. */
export const LEG_ABDUCTION_RAD = 0.045;

/** Ring resolution for body segments. */
export const BODY_RADIAL_SEGMENTS = 48;
