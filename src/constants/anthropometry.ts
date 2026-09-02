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
//
// Depth-to-width ratios and super-ellipse exponents. A human cross-section is
// neither a circle nor an ellipse, and it is not front-back symmetric either:
// a hip section is far deeper behind the spine than in front of it, a belly is
// the reverse, and a calf carries almost all its bulk at the back. Each section
// therefore carries a *front* and a *back* depth ratio.
//
// These figures are read off published torso and limb scan cross-sections and
// are the least firmly sourced numbers in this file. They change the silhouette
// and shift volume around, but they cannot change a circumference: the ring
// generator scales every section so its perimeter is exactly the measurement.
// ---------------------------------------------------------------------------

/** Mean depth / width of the chest cross-section. */
export const CHEST_ASPECT = 0.72;
/** Chest depth in front of the spine, as a multiple of the mean. Pectorals. */
export const CHEST_FRONT_BIAS = 1.16;
/** Chest depth behind the spine. Flatter than the front. */
export const CHEST_BACK_BIAS = 0.84;

/** Mean depth / width at the waist. */
export const WAIST_ASPECT = 0.78;
/** Abdomen projects forward more than the lumbar spine does back. */
export const WAIST_FRONT_BIAS = 1.12;
export const WAIST_BACK_BIAS = 0.88;

/** Mean depth / width at the hips. */
export const HIP_ASPECT = 0.74;
/** The buttocks are the strongest front-back asymmetry anywhere on the body. */
export const HIP_FRONT_BIAS = 0.7;
export const HIP_BACK_BIAS = 1.3;

/** Depth / width of the neck, which is close to round. */
export const NECK_ASPECT = 0.92;
/** Depth / width of limb cross-sections. */
export const LIMB_ASPECT = 0.94;

/** The calf carries its bulk behind the tibia. */
export const CALF_FRONT_BIAS = 0.74;
export const CALF_BACK_BIAS = 1.26;
/** The thigh is slightly deeper at the back than the front. */
export const THIGH_FRONT_BIAS = 0.92;
export const THIGH_BACK_BIAS = 1.08;

/** Depth / width of the head, which is longer front-to-back than it is wide. */
export const HEAD_ASPECT = 1.24;
/** The occiput projects further behind the ear canal than the face does ahead. */
export const HEAD_FRONT_BIAS = 0.86;
export const HEAD_BACK_BIAS = 1.14;

/**
 * Super-ellipse exponent for torso cross-sections. 2 is a plain ellipse; higher
 * is flatter-sided.
 *
 * A torso is flatter than an ellipse but not by much. 2.45 was too square and
 * gave the figure slab sides; a real trunk sits closer to 2.2, which reads
 * rounder without losing the flattening that makes a waist a waist.
 */
export const TORSO_SQUARENESS = 2.2;
/** Super-ellipse exponent for limb cross-sections, which are nearly elliptical. */
export const LIMB_SQUARENESS = 2.05;
/** Super-ellipse exponent for the skull, which is rounder still. */
export const HEAD_SQUARENESS = 2.0;

// ---------------------------------------------------------------------------
// Shape that responds to the measurements
//
// The ratios above describe an average body. Two people with the same chest
// circumference can carry it very differently, and the difference is legible in
// the measurements themselves: a large chest-to-underbust difference means a
// bust, and a large hip-to-waist ratio means glutes. Reading the shape off the
// numbers rather than fixing it in a constant is what lets one model be both
// figures — without the app having to ask anyone their sex.
// ---------------------------------------------------------------------------

/**
 * Chest-over-underbust ratio at which forward projection starts.
 *
 * Every chest is larger than the ribcage under it — the pectorals and the
 * ribcage's own taper account for about 10% on a flat chest. Only the excess
 * over that is a bust. Without this onset the *average* body got a 24%
 * projection and the model's chest volume rose by four litres, putting its
 * reconstructed weight 3.5% above the population data it is checked against.
 */
export const BUST_ONSET = 0.1;

/**
 * How much of the excess chest-over-underbust becomes forward projection.
 *
 * A bust adds depth in front of the ribcage, not girth evenly around it. The
 * circumference is still reproduced exactly; this only decides where it sits,
 * so a body with a bust comes out narrower and deeper than one without at the
 * same chest measurement — which is what a tape actually finds.
 */
export const BUST_PROJECTION_GAIN = 1.7;
/**
 * Ceiling on that projection, as a multiple of the chest's mean depth.
 *
 * Held well below what the gain alone would reach. Past about a third, the
 * section becomes deeper than it is wide and the chest reads as a wedge jutting
 * off the front of the ribcage rather than as a bust.
 */
export const BUST_PROJECTION_MAX = 0.34;

/**
 * How much of the hip-over-waist ratio becomes gluteal projection.
 *
 * Measured from a waist-to-hip ratio of 0.86, around the population mean; below
 * that the shape stays at the base bias.
 */
export const GLUTEAL_GAIN = 1.15;
export const GLUTEAL_MAX = 0.5;
/** Waist-to-hip ratio at which gluteal projection starts to grow. */
export const GLUTEAL_ONSET = 1.16;

// ---------------------------------------------------------------------------
// Posture
//
// The spine is not straight. Sagittal offsets of each cross-section's centre,
// as fractions of stature, positive toward the front of the body. Magnitudes
// follow the standing sagittal curvature reported in postural-assessment
// literature: a thoracic kyphosis of roughly 2-3 cm of posterior offset at the
// mid-back and a lumbar lordosis of similar magnitude forward at the waist,
// on a 175 cm frame.
// ---------------------------------------------------------------------------

/** Sagittal offset at the hips. Near the reference line. */
export const SPINE_OFFSET_HIP = -0.002;
/** Lumbar lordosis: the waist sits forward of the line through hip and shoulder. */
export const SPINE_OFFSET_WAIST = 0.006;
/** Thoracic kyphosis: the upper back sits behind it. */
export const SPINE_OFFSET_CHEST = -0.004;
/** The shoulders sit a little further back again. */
export const SPINE_OFFSET_SHOULDER = -0.008;
/** Cervical lordosis carries the head forward over the chest. */
export const SPINE_OFFSET_HEAD = 0.004;

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
/**
 * Elbow flexion in a relaxed stance, radians. A hanging arm is never straight;
 * a few degrees swings the forearm and hand forward of the shoulder.
 */
export const ARM_FLEXION_RAD = 0.11;
/**
 * How far the heel projects behind the ankle joint, as a fraction of foot
 * length. The ankle sits roughly a quarter of the way along the foot.
 */
export const HEEL_BEHIND_ANKLE = 0.26;

/** Ring resolution for body segments. */
export const BODY_RADIAL_SEGMENTS = 72;

/**
 * Ring resolution used inside the girth search. Volume converges much faster
 * than silhouette does, and the search evaluates the whole body ~25 times per
 * fit. The *final* body is always built at {@link BODY_RADIAL_SEGMENTS}; this
 * only sets how finely each trial is measured.
 */
export const FIT_RADIAL_SEGMENTS = 32;

/** Interpolated rings inserted between each pair of control slices. */
export const BODY_SLICE_SMOOTHING = 5;
