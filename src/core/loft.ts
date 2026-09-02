import { BufferGeometry, BufferAttribute } from 'three';

/**
 * The single geometry primitive this app is built on.
 *
 * Both reconstruction recipes reduce to the same operation: a stack of closed
 * cross-sections ("rings") lofted into a surface. A lamp part is a stack of
 * circles around the Y axis; a body segment is a stack of super-ellipses
 * carried along a bone. Nothing is ever loaded from a file — geometry is a
 * pure function of the ring stack, which is itself a pure function of the
 * parameters.
 */

/** A point in model space. Units are centimetres throughout the app. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * One closed cross-section. Every ring in a single loft must contain the same
 * number of points, ordered consistently (counter-clockwise seen from +Y) so
 * that point `j` of ring `i` connects to point `j` of ring `i + 1`.
 */
export type Ring = readonly Vec3[];

export interface LoftOptions {
  /** Close the bottom of the stack with a triangle fan. Default `true`. */
  readonly capStart?: boolean;
  /** Close the top of the stack with a triangle fan. Default `true`. */
  readonly capEnd?: boolean;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalized(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-12) return { x: 0, y: 1, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function centroid(ring: Ring): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = Math.max(ring.length, 1);
  return { x: x / n, y: y / n, z: z / n };
}

/**
 * Build a watertight surface through `rings`.
 *
 * Normals are computed analytically from the ring tangents rather than by
 * `computeVertexNormals()`. That matters because the seam column is duplicated
 * for UV continuity: face-averaged normals would give the two coincident
 * columns different values and leave a visible crease down every part.
 *
 * @param rings Bottom-to-top stack, at least two rings of equal, >= 3 length.
 * @returns A non-indexed-safe indexed geometry with position, normal and uv.
 */
export function loftGeometry(rings: readonly Ring[], options: LoftOptions = {}): BufferGeometry {
  const capStart = options.capStart ?? true;
  const capEnd = options.capEnd ?? true;

  if (rings.length < 2) {
    throw new Error(`loftGeometry needs at least 2 rings, received ${rings.length}`);
  }
  const segments = rings[0]?.length ?? 0;
  if (segments < 3) {
    throw new Error(`loftGeometry needs at least 3 points per ring, received ${segments}`);
  }
  for (const ring of rings) {
    if (ring.length !== segments) {
      throw new Error('loftGeometry requires every ring to have the same point count');
    }
  }

  const rows = rings.length;
  const cols = segments + 1; // duplicated seam column so UVs can run 0..1
  const vertexCount = rows * cols;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  const at = (row: number, col: number): Vec3 => {
    const ring = rings[row];
    if (ring === undefined) throw new Error(`ring ${row} missing`);
    const p = ring[((col % segments) + segments) % segments];
    if (p === undefined) throw new Error(`ring point ${col} missing`);
    return p;
  };

  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const p = at(i, j);
      const vi = i * cols + j;

      // Tangent around the ring, and along the stack (one-sided at the ends).
      const alongRing = sub(at(i, j + 1), at(i, j - 1));
      const alongStack = sub(at(Math.min(i + 1, rows - 1), j), at(Math.max(i - 1, 0), j));
      const n = normalized(cross(alongStack, alongRing));

      positions[vi * 3 + 0] = p.x;
      positions[vi * 3 + 1] = p.y;
      positions[vi * 3 + 2] = p.z;
      normals[vi * 3 + 0] = n.x;
      normals[vi * 3 + 1] = n.y;
      normals[vi * 3 + 2] = n.z;
      uvs[vi * 2 + 0] = j / segments;
      uvs[vi * 2 + 1] = rows === 1 ? 0 : i / (rows - 1);
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < rows - 1; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = i * cols + j;
      const b = i * cols + j + 1;
      const c = (i + 1) * cols + j + 1;
      const d = (i + 1) * cols + j;
      // Wound so the front face matches the outward analytic normal above.
      indices.push(a, d, c, a, c, b);
    }
  }

  // Caps are separate fans so their flat normals do not blend into the wall.
  const extra: number[] = [];
  const pushCap = (ring: Ring, up: boolean): void => {
    const c = centroid(ring);
    const base = vertexCount + extra.length / 8;
    const normal: Vec3 = up ? { x: 0, y: 1, z: 0 } : { x: 0, y: -1, z: 0 };
    extra.push(c.x, c.y, c.z, normal.x, normal.y, normal.z, 0.5, 0.5);
    for (let j = 0; j < segments; j += 1) {
      const p = ring[j];
      if (p === undefined) continue;
      const theta = (j / segments) * Math.PI * 2;
      extra.push(p.x, p.y, p.z, normal.x, normal.y, normal.z, 0.5 + 0.5 * Math.cos(theta), 0.5 + 0.5 * Math.sin(theta));
    }
    for (let j = 0; j < segments; j += 1) {
      const a = base + 1 + j;
      const b = base + 1 + ((j + 1) % segments);
      // A ring runs counter-clockwise seen from +Y, so the fan (centre, j, j+1)
      // has a -Y face normal; the top cap therefore needs the reversed order.
      if (up) indices.push(base, b, a);
      else indices.push(base, a, b);
    }
  };

  const first = rings[0];
  const last = rings[rows - 1];
  if (capStart && first !== undefined) pushCap(first, false);
  if (capEnd && last !== undefined) pushCap(last, true);

  const extraVertices = extra.length / 8;
  const totalVertices = vertexCount + extraVertices;
  const finalPositions = new Float32Array(totalVertices * 3);
  const finalNormals = new Float32Array(totalVertices * 3);
  const finalUvs = new Float32Array(totalVertices * 2);
  finalPositions.set(positions);
  finalNormals.set(normals);
  finalUvs.set(uvs);
  for (let k = 0; k < extraVertices; k += 1) {
    const o = k * 8;
    const vi = vertexCount + k;
    finalPositions[vi * 3 + 0] = extra[o + 0] ?? 0;
    finalPositions[vi * 3 + 1] = extra[o + 1] ?? 0;
    finalPositions[vi * 3 + 2] = extra[o + 2] ?? 0;
    finalNormals[vi * 3 + 0] = extra[o + 3] ?? 0;
    finalNormals[vi * 3 + 1] = extra[o + 4] ?? 0;
    finalNormals[vi * 3 + 2] = extra[o + 5] ?? 0;
    finalUvs[vi * 2 + 0] = extra[o + 6] ?? 0;
    finalUvs[vi * 2 + 1] = extra[o + 7] ?? 0;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(finalPositions, 3));
  geometry.setAttribute('normal', new BufferAttribute(finalNormals, 3));
  geometry.setAttribute('uv', new BufferAttribute(finalUvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * Signed volume enclosed by a triangle soup, via the divergence theorem.
 * Used by the body fitter to turn a candidate mesh into a mass estimate, and
 * by the loft tests to assert that faces are wound outward (volume > 0).
 */
export function meshVolume(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (index === null) return 0;
  let total = 0;
  for (let i = 0; i < index.count; i += 3) {
    const ia = index.getX(i);
    const ib = index.getX(i + 1);
    const ic = index.getX(i + 2);
    const ax = position.getX(ia);
    const ay = position.getY(ia);
    const az = position.getZ(ia);
    const bx = position.getX(ib);
    const by = position.getY(ib);
    const bz = position.getZ(ib);
    const cx = position.getX(ic);
    const cy = position.getY(ic);
    const cz = position.getZ(ic);
    total +=
      (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return total;
}

/**
 * Volume enclosed by a capped ring stack, without building a geometry.
 *
 * Uses the same triangulation and winding as {@link loftGeometry}, so the two
 * agree exactly — a unit test pins that. The body fitter evaluates this inside
 * a search loop, where allocating a BufferGeometry per trial would dominate the
 * cost.
 */
export function ringStackVolume(rings: readonly Ring[]): number {
  if (rings.length < 2) return 0;
  const segments = rings[0]?.length ?? 0;
  if (segments < 3) return 0;

  const tet = (a: Vec3, b: Vec3, c: Vec3): number =>
    (a.x * (b.y * c.z - b.z * c.y) -
      a.y * (b.x * c.z - b.z * c.x) +
      a.z * (b.x * c.y - b.y * c.x)) /
    6;

  let total = 0;
  for (let i = 0; i < rings.length - 1; i += 1) {
    const lower = rings[i];
    const upper = rings[i + 1];
    if (lower === undefined || upper === undefined) continue;
    for (let j = 0; j < segments; j += 1) {
      const k = (j + 1) % segments;
      const a = lower[j];
      const b = lower[k];
      const c = upper[k];
      const d = upper[j];
      if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
      total += tet(a, d, c) + tet(a, c, b);
    }
  }

  // Caps, wound to match loftGeometry's fans.
  const cap = (ring: Ring, up: boolean): void => {
    const centre = centroid(ring);
    for (let j = 0; j < segments; j += 1) {
      const a = ring[j];
      const b = ring[(j + 1) % segments];
      if (a === undefined || b === undefined) continue;
      total += up ? tet(centre, b, a) : tet(centre, a, b);
    }
  };
  const first = rings[0];
  const last = rings[rings.length - 1];
  if (first !== undefined) cap(first, false);
  if (last !== undefined) cap(last, true);

  return total;
}
