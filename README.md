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
  templates/     Reconstruction recipes
    types.ts       GeneratedPart / GeneratedModel
    lamp/
      spec.ts      every parameter: label, unit, plausible range, description
      defaults.ts  proportion ratios, each with the convention it comes from
      solve.ts     measurements → complete parameter set + constraint reports
      build.ts     parameter set → parts
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
a stack of circles whose radius follows a profile curve. A body segment (see
below) is a stack of super-ellipses carried along a bone. There is no second code
path, and no `CylinderGeometry`/`LatheGeometry` fallback.

Two details in there are load-bearing:

* **Normals are computed analytically** from the ring and stack tangents rather
  than by `computeVertexNormals()`. The seam column is duplicated so UVs can run
  0→1, and face-averaged normals would give the two coincident columns different
  values — a visible crease down the side of every part.
* **Winding is verified by a test**, not by eye: `meshVolume()` applies the
  divergence theorem, and a closed cylinder whose faces are wound outward must
  come out to the analytic volume of an inscribed N-gon prism. That test caught
  an inverted cap fan during development.

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

### Constraints

The solver reports on each of these, and repairs violations by moving *inferred*
values in preference to measured ones:

| Constraint | How it is repaired |
|---|---|
| Shade bottom diameter ≥ base diameter | Widen the inferred shade, or narrow the inferred base |
| Stem diameter ≤ base top diameter | Widen the base neck around a measured stem; narrow an inferred stem |
| Base + stem + socket + shade heights = total height | The stem absorbs the remainder, so total height is exact |
| Stem keeps ≥ 20% of total height | Scale the inferred base and shade down together |

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

## Code quality

* Strict TypeScript with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`; no `any` anywhere in the codebase.
* `erasableSyntaxOnly` is on, so every source file runs unmodified under Node's
  type stripping.
* Every parameter carries a `ParamSpec` — label, unit, plausible range and a
  description — so a parameter cannot be added without documenting it.
* Anthropometric and template constants live in dedicated modules with the
  source of each figure in a comment.

## Non-goals

No photogrammetry, no image-to-3D, no file imports, no backend. Shading is clean
matte studio lighting; photorealism is not attempted.
