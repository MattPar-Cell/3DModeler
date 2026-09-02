# Parametric Shape Reconstructor

Reconstruct 3D models of real-world objects and human bodies from a handful of
measurements plus a small amount of math.

**The app never stores geometry. It stores parameters.** Every mesh you see is
regenerated from scratch, deterministically, from a short record of named
numbers. There are no model files anywhere in this repository — not as assets,
not as fixtures, not as fallbacks.

```
measurements  ──▶  solver  ──▶  parameter set  ──▶  ring stack  ──▶  BufferGeometry
(a subset,        (ratios,      (every value       (cross-        (loft + analytic
 all optional)     priors,       tagged with        sections)      normals)
                   constraints)  its provenance)
```

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle
npm test           # unit tests (node --test, no test framework dependency)
npm run typecheck  # strict TypeScript only
```

Node 22.18+ is required: the test suite runs `.ts` files directly through
Node's native type stripping, which is why there is no test runner in
`devDependencies`.

## The architecture, in one idea

A **parameter** is not just a number. It is a number plus its *provenance*:

| Provenance  | Meaning                                                       |
|-------------|---------------------------------------------------------------|
| `measured`  | The user typed it. No solver is ever allowed to overwrite it. |
| `derived`   | Computed from something that traces back to a measurement.    |
| `estimated` | Filled in from a template ratio or a population prior.        |

Provenance is the backbone of the whole UI. It decides how a sidebar field is
drawn (solid / dashed / dotted border, plus a text badge — never colour alone),
which numbers the constraint solver is permitted to move when two requirements
collide, and which parts of the model render translucent in the viewer.

Clearing a field is therefore a real operation, not a UI reset: the number goes
back to being inferred, and the model changes to match.

### Layers

```
src/
  core/          Pure math and geometry. No React, no DOM, no three.js scene
    math.ts        clamping, interpolation, ellipse perimeter + its inverse
    loft.ts        the single geometry primitive: a stack of rings → a surface
    profile.ts     ring generators (circle, super-ellipse) and radius profiles
    params.ts      ParamSpec / ResolvedParam / Provenance — the parameter model
    optimize.ts    golden-section search, the fit's only solver
  constants/
    anthropometry.ts  every population-derived number, with its citation
  templates/     Reconstruction recipes
    types.ts       GeneratedPart / GeneratedModel
    lamp/
      spec.ts      every parameter: label, unit, plausible range, description
      defaults.ts  proportion ratios, each with the convention it comes from
      solve.ts     measurements → complete parameter set + constraint reports
      build.ts     parameter set → parts
  compare/
    snapshots.ts   saved models, layout and measurement diffing
  body/
    spec.ts        every body parameter, documented and range-checked
    segments.ts    skeleton layout and per-segment cross-section stacks
    fit.ts         measurements → fitted parameters, residuals, confidence
    measure.ts     reads measurements back off the generated mesh
    build.ts       fitted parameters → parts
  state/         Zustand stores. These hold parameters only, never geometry
  export/        GLB and OBJ writers
  ui/            React components
```

`core/` is deliberately free of every framework in the stack, which is what lets
the entire fitting and geometry layer be unit tested under `node --test` with no
DOM and no WebGL context.

### One geometry primitive

Everything is a **loft**: an ordered stack of closed cross-sections, triangulated
between consecutive rings and capped at the ends (`core/loft.ts`). A lamp part is
a stack of circles whose radius follows a profile curve. A body segment is a
stack of super-ellipses carried along a bone. A lamp harp is a tube swept along
a path. There is no second code path, and no `CylinderGeometry`/`LatheGeometry`
fallback.

The cross-section is an **asymmetric super-ellipse**:

```
|x / a|ⁿ + |z / b(z)|ⁿ = 1,    b(z) = front for z > 0, back for z < 0
```

`n = 2` with `front = back` is a plain ellipse. Both extra degrees of freedom
earn their place on a body: `n ≈ 2.45` because a waist is measurably flatter
than an ellipse, and independent front/back depth because a hip is far deeper
behind the spine than in front of it, a belly is the reverse, and a calf carries
almost all its bulk at the back. None of it can change a measurement — the ring
is always scaled so its perimeter *is* the circumference.

Several details in there are load-bearing:

* **Normals are computed analytically** from the ring and stack tangents rather
  than by `computeVertexNormals()`. The seam column is duplicated so UVs can run
  0→1, and face-averaged normals would give the two coincident columns different
  values — a visible crease down the side of every part.
* **Winding is verified by a test**, not by eye: `meshVolume()` applies the
  divergence theorem, and a closed cylinder whose faces are wound outward must
  come out to the analytic volume of an inscribed N-gon prism. That test caught
  an inverted cap fan during development, and later a whole set of limbs written
  joint-downward and lofted inside out.
* **Profiles run through monotone cubic interpolation** (`monotoneCubicAt`).
  Smoothstep forces the slope to zero at *every* control point, so a profile
  through eight control sections came out as eight plateaus joined by ramps —
  clearly visible as bands across the head. Plain cubic splines fix the banding
  but overshoot, which on a body means a bulge just above a measured chest that
  is wider than the chest. Fritsch–Carlson gives the smoothness with neither.
* **Swept tubes use parallel-transport frames**, not Frenet frames, whose normal
  flips wherever a curve straightens out — a twist a thin wire shows off
  perfectly.
* **Ring generation is table-driven.** The powers in a super-ellipse depend only
  on the exponent and the segment count, so they are computed once per pair and
  every ring afterwards is two multiplications per point. That is what makes 72
  segments and a 25-evaluation girth search affordable at keystroke rate.

### Units

Model space is **centimetres** — the units the user types. The viewer's model
root carries a `0.01` scale, so the world, and therefore every export, is in
metres. The exporters serialise that same root, which is why the download always
matches what is on screen.

## Feature 1 — parametric object templates (lamps)

A template is a typed recipe: named parts, each a revolved primitive with typed
parameters, plus cross-part constraints.

**You enter** any subset of: total height, base diameter, shade diameter, stem
diameter. **The solver fills in** base height, base top diameter, stem height,
stem belly, socket height, socket diameter, shade height and shade top diameter
from the ratios in `templates/lamp/defaults.ts` — each documented with the
lighting-trade convention it comes from.

The generated lamp is a turned form rather than a stack of cones: a plinth,
fillet and cove on the base, a collared and bellied stem, a shade that bows
outward from the straight cone and is wrapped over a wire rim at each end, a
harp springing from the socket, and a finial capping it. Materials distinguish
glazed ceramic, brushed brass, and fabric lit from within — that last one, an
emissive term standing in for the bulb behind the cloth, is most of what makes a
truncated cone read as a lampshade.

### Constraints

The solver reports on each of these, and repairs violations by moving *inferred*
values in preference to measured ones:

| Constraint | How it is repaired |
|---|---|
| Shade bottom diameter ≥ base diameter | Widen the inferred shade, or narrow the inferred base |
| Stem diameter ≤ base top diameter | Widen the base neck around a measured stem; narrow an inferred stem |
| Base + stem + socket + shade + finial protrusion = total height | The stem absorbs the remainder, so total height is exact |
| Stem keeps ≥ 20% of total height | Scale the inferred base and shade down together |

The finial is in that height sum for a reason. It screws onto the harp just
below the shade's top rim, so most of it stands *above* the rim — leave it out
and the generated lamp comes out taller than the number the user typed. Making
room for it is also not a simple rescale: the finial is fixed in size and only
partly hidden inside the shade, so shrinking the shade *increases* how much of
the finial sticks out. The solver works the shrink factor out in closed form
rather than iterating.

When a constraint is violated by two values the user *actually measured*, the
solver refuses to silently rewrite either. It keeps both numbers and reports the
conflict in the sidebar, because at that point the disagreement is information —
one of the two measurements is probably wrong, and the app has no basis for
guessing which.

### Proportion lock

The slider scales every inferred dimension at once while measured values stay
pinned at exactly the value typed. It changes the lamp's proportions without
ever contradicting the user's data — with total height measured, moving the
slider redistributes height between the base, shade and stem, and the total
stays put.

### Export

GLB (binary glTF) and OBJ, both in metres, both serialised from the live scene
root.

## Feature 2 — human body from partial measurements

A statistical body model built from published population ratios rather than a
learned basis. **Nothing here derives from SMPL or any other licensed or
patented body model** — the shape space is the anthropometric literature cited
in `src/constants/anthropometry.ts`, and the geometry is the same loft the
lamp uses.

### How the body is built

1. **Skeleton.** Landmark heights (crotch, hip, waist, chest, shoulder, chin)
   come from Drillis & Contini's segment-length fractions of stature. Joint
   positions follow from those plus the shoulder and hip breadths.
2. **Radial profiles.** Each segment carries a stack of cross-sections, and each
   cross-section is a *super-ellipse* — `|x/a|ⁿ + |z/b|ⁿ = 1` — whose perimeter
   is set to the corresponding circumference. `n ≈ 2.45` at the torso and `2.1`
   at the limbs, because a human cross-section is measurably flatter than an
   ellipse. Depth-to-width ratios come from the same constants file.
3. **Lofted surface.** The stacks go through `core/loft.ts`, exactly as the lamp
   parts do.

Because a ring's perimeter is set directly from the measurement, **an entered
circumference is reproduced exactly** rather than approximated — the tests
assert it to within 0.25 cm off the generated mesh.

### The fit

Given any subset of height, weight, chest, waist, hip, inseam, shoulder width,
neck, thigh, upper arm, forearm length and wrist:

1. **Pin.** Measured values are used verbatim and are never rewritten.
2. **Propagate.** Un-measured circumferences start at their prior and are then
   scaled by how far the measured circumferences *in the same group* (torso or
   limb) sit from theirs. Someone whose chest is 12% above the prior almost
   certainly has an above-prior underbust, and this is what carries that across.
3. **Solve.** One free variable is left — a global scale on the un-measured
   circumferences — and a golden-section search minimises

   ```
   J(g) = ((mass(g) − target) / target)²  +  λ · ln(g)²
   ```

   where `mass(g)` is read off the reconstructed mesh's enclosed volume at
   1.01 kg/L. The regulariser has a readable meaning: at `λ = 0.004`, pulling the
   girths 30% from the priors costs the same as a 2% error in weight.

Measured circumferences sit *outside* the search, so an entered weight can never
silently overwrite a tape measurement. When the two genuinely disagree — 175 cm,
120 kg and a 78 cm waist — the waist holds and the sidebar reports the weight it
could not reach.

### Reading the numbers back

The fit-quality table does not echo the parameters. It **re-measures the
generated mesh**: perimeters come off the actual rings (corrected back to the
plane perpendicular to the limb), stature off the bounding box, weight off the
enclosed volume. If the builder ever stops honouring a measurement, the table
and the test suite both say so.

The whole pipeline is checked against outside data too: a body built from the
priors alone at ANSUR II male mean stature reconstructs to within a few percent
of the ANSUR II mean weight.

### Confidence, per region

Eleven regions — head, neck, chest, waist, pelvis, upper arms, forearms, hands,
thighs, lower legs, feet — each rated:

* **measured** — you gave a direct measurement of this region.
* **derived** — its parameters were computed from measurements elsewhere, in the
  same measurement family.
* **estimated** — population priors alone.

A borrowed inference is deliberately *not* promoted to `derived`: a chest
measurement standing in for a calf stays `estimated`, so someone who measured
only their torso still sees uncertain legs. Estimated regions render translucent
and double-sided, so they read as a volume the app is unsure about rather than
as a hole cut in the body. Hovering a region lists the provenance of every
parameter behind it.

### Body-part-only mode

Give it a forearm length and a wrist circumference and nothing else. Long bones
track stature far more tightly than girths do, so the fitter back-solves height
from the forearm, fits that segment exactly, and infers the rest — with the
forearm and hand rated `measured`, the limb girths `derived` from the wrist, and
the torso honestly `estimated`. The "One body part only" button loads exactly
this case.

### The generated body

Beyond the fitting, what makes the figure read as a person rather than a stack
of tubes: a spine with real sagittal curvature that every torso section is
centred on, cross-sections that are deeper behind than in front at the hips and
the reverse at the belly, a skull with a jaw and an occiput, a foot lofted heel
to toe rather than stacked up its height, a few degrees of elbow flexion, and
biceps/triceps depth on the upper arm.

Segments *meet* at shared landmark planes rather than interpenetrating.
Overlapping them would look marginally smoother, but the overlap volume gets
counted twice and the weight fit is a volume calculation — two thighs pushed up
inside the pelvis added around six litres of phantom body, which the girth
search then tried to remove by shrinking the user's real measurements. For the
same reason, interior end caps are not rendered: two segments meeting at a
landmark would otherwise put coincident discs in the same plane, and the
z-fighting draws a bright ring around the body at every join.

### What this model is not

The app does not ask for sex, so the circumference priors are the midpoint of
the ANSUR II male and female means. Male and female means differ by 3–7% of
stature at the chest, waist and hip, which is a large error for one person — so
an unmeasured torso on this model is a genuinely rough guess, and the UI says
so. Entering the measurement removes the prior from the fit entirely.

## Feature 3 — comparison

Save any model for comparison, then put several of them in one scene.

A saved model is **the measurement set and nothing else** — not the solved
parameters, and certainly not a mesh. Comparing two lamps means solving and
regenerating both, exactly as the live editor does. That falls straight out of
the premise: if geometry is a pure function of parameters, then storing a model
*is* storing its parameters. Saved comparisons live in `localStorage` (a few
dozen numbers each) and stay valid across changes to the templates themselves,
because the templates are not what was saved.

Two arrangements:

* **Side by side** — models stand in a row on a shared floor, gaps scaled to the
  models so a row of lamps is not separated by body-sized gaps. Relative height
  and bulk read directly.
* **Overlay** — models share one origin and are drawn translucent, so a
  difference in profile shows up as the places their silhouettes come apart.

And two tables:

* **Overall size** — height, width and depth read off the *generated meshes*, so
  it works for any mix of models. This is what lets you stand a lamp next to a
  person to check a scale.
* **Parameters** — every parameter that differs, largest difference first, with
  absolute and percentage deltas against the first model, and each value still
  carrying its measured/derived/estimated colour. Only offered when the
  selection shares a kind: a lamp's stem diameter and a person's neck have
  nothing to say to each other, and inventing a row that pairs them would be
  worse than showing none.

## Code quality

* Strict TypeScript with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`; no `any` anywhere in the codebase.
* `erasableSyntaxOnly` is on, so every source file runs unmodified under Node's
  type stripping.
* Every parameter carries a `ParamSpec` — label, unit, plausible range and a
  description — so a parameter cannot be added without documenting it.
* Anthropometric and template constants live in dedicated modules with the
  source of each figure in a comment, including where a figure is uncertain or
  where two published definitions disagree.
* 98 unit tests covering the geometry core, the lamp solver, the body fit and
  the comparison logic — reconstruction errors, constraint repair, provenance
  propagation, winding, interpolation overshoot, degenerate inputs, and
  agreement with outside population data.

## Tests

```bash
npm test
```

Beyond the obvious round-trip checks, a few tests are worth knowing about
because each one caught a real bug:

| Test | What it caught |
|---|---|
| Cylinder volume vs. the analytic N-gon prism | Inverted cap winding — every lofted solid was open at the top |
| Every segment encloses a positive volume | Limb slices written joint-downward, lofted inside-out |
| Weight round-trip | Thighs pushed up inside the pelvis, adding ~6 litres of phantom body that the girth search then removed from the real measurements |
| Provenance through chained derivations | A value two ratios away from a measurement being reported as a bare guess |
| Measurements read back off the mesh, not the parameters | A landmark height the builder and the readback disagreed about |
| Monotone cubic never overshoots its data | A local maximum whose tangent was not zeroed, letting a profile sail past a measured value |
| The generated mesh is exactly as tall as the entered height | A finial that pushed the lamp past the height the user typed |
| The spine curve does not corrupt torso circumferences | A limb-style tilt correction applied to a torso, putting 0.6 cm into every chest reading |
| Side-by-side layout never overlaps | — |

## Non-goals

No photogrammetry, no image-to-3D, no file imports, no backend. Shading is clean
matte studio lighting; photorealism is not attempted, and the figure is a
measurement aid rather than a portrait — it has no face, and the skin tone is
deliberately a neutral clay.
