import * as THREE from 'three';

/**
 * Collider descriptors produced by mesh analysis, expressed in the rigid
 * body's local space so they can be rendered directly as @react-three/rapier
 * collider components.
 */
export type AutoColliderSpec =
  | {
      kind: 'cuboid';
      halfExtents: [number, number, number];
      center: [number, number, number];
    }
  | {
      kind: 'hull';
      /** Flat xyz vertex buffer. */
      points: Float32Array;
    };

export interface AutoColliderOptions {
  /**
   * Solidity ratio (mesh volume / AABB volume) at or above which a mesh is
   * treated as "boxy" and gets a cheap cuboid instead of a convex hull.
   */
  boxFillThreshold?: number;
  /** Hull vertex budget per mesh; denser geometry is stride-sampled. */
  maxHullPoints?: number;
  /** Bypass the heuristic and force one shape for every mesh. */
  forceShape?: 'cuboid' | 'hull';
  /** Uniform render scale of the model; baked into the collider specs. */
  scale?: number;
}

/** Keeps blades/cards/panels from becoming zero-thickness colliders. */
const MIN_HALF_EXTENT = 0.005;

// Module-scope scratch — analysis runs once per asset, but large meshes mean
// hot inner loops; keep them allocation-free.
const _inverseRoot = new THREE.Matrix4();
const _toRoot = new THREE.Matrix4();
const _vertex = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _cross = new THREE.Vector3();
const _size = new THREE.Vector3();

/**
 * Walks every mesh under `root` and produces one collider spec per mesh:
 * a cuboid for closed boxy geometry, a decimated convex hull for everything
 * else. Child transforms (offsets, rotations, scales inside the GLB) are
 * folded into the specs, so the result is valid for a compound rigid body
 * whose origin is `root`.
 */
export function computeAutoColliders(
  root: THREE.Object3D,
  options: AutoColliderOptions = {},
): AutoColliderSpec[] {
  const { boxFillThreshold = 0.72, maxHullPoints = 256, forceShape, scale = 1 } = options;

  // Clones fresh out of useGLTF have stale matrices until first render.
  root.updateWorldMatrix(true, true);
  _inverseRoot.copy(root.matrixWorld).invert();

  const specs: AutoColliderSpec[] = [];

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!position || position.count < 3) return;

    // Mesh-local -> rigid-body-local (the root's own world transform excluded).
    _toRoot.multiplyMatrices(_inverseRoot, mesh.matrixWorld);

    const shape = forceShape ?? pickShape(mesh.geometry, boxFillThreshold);
    if (shape === 'cuboid') {
      specs.push(cuboidSpec(position, _toRoot, scale));
    } else {
      const points = sampleHullPoints(position, _toRoot, maxHullPoints, scale);
      // A hull needs >= 4 points (12 floats); degenerate meshes get boxed.
      specs.push(points.length >= 12 ? { kind: 'hull', points } : cuboidSpec(position, _toRoot, scale));
    }
  });

  return specs;
}

/**
 * Shape heuristic. Closed boxy meshes (crates, slabs, plinths) fill most of
 * their AABB, so a cuboid is both cheaper and more accurate at the corners.
 * Open meshes produce unreliable signed volumes, which biases the ratio low —
 * that fails safe, because the hull is always a valid bound.
 */
function pickShape(geometry: THREE.BufferGeometry, boxFillThreshold: number): 'cuboid' | 'hull' {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  geometry.boundingBox!.getSize(_size);

  // Effectively flat geometry: hull generation degenerates on coplanar points,
  // and a thin cuboid is the right collider anyway.
  if (Math.min(_size.x, _size.y, _size.z) < MIN_HALF_EXTENT * 2) return 'cuboid';

  const aabbVolume = _size.x * _size.y * _size.z;
  const fill = Math.abs(signedMeshVolume(geometry)) / aabbVolume;
  return fill >= boxFillThreshold ? 'cuboid' : 'hull';
}

/** Divergence-theorem mesh volume: sum of dot(a, b x c) / 6 over all triangles. */
function signedMeshVolume(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : position.count / 3;
  let volume = 0;
  for (let i = 0; i < triCount; i++) {
    const ia = index ? index.getX(i * 3) : i * 3;
    const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;
    _a.fromBufferAttribute(position, ia);
    _b.fromBufferAttribute(position, ib);
    _c.fromBufferAttribute(position, ic);
    _cross.crossVectors(_b, _c);
    volume += _a.dot(_cross) / 6;
  }
  return volume;
}

/** Tight AABB of the transformed vertices, as half extents + center. */
function cuboidSpec(
  position: THREE.BufferAttribute,
  toRoot: THREE.Matrix4,
  scale: number,
): AutoColliderSpec {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < position.count; i++) {
    _vertex.fromBufferAttribute(position, i).applyMatrix4(toRoot);
    if (_vertex.x < minX) minX = _vertex.x;
    if (_vertex.y < minY) minY = _vertex.y;
    if (_vertex.z < minZ) minZ = _vertex.z;
    if (_vertex.x > maxX) maxX = _vertex.x;
    if (_vertex.y > maxY) maxY = _vertex.y;
    if (_vertex.z > maxZ) maxZ = _vertex.z;
  }
  return {
    kind: 'cuboid',
    halfExtents: [
      Math.max(((maxX - minX) / 2) * scale, MIN_HALF_EXTENT),
      Math.max(((maxY - minY) / 2) * scale, MIN_HALF_EXTENT),
      Math.max(((maxZ - minZ) / 2) * scale, MIN_HALF_EXTENT),
    ],
    center: [((minX + maxX) / 2) * scale, ((minY + maxY) / 2) * scale, ((minZ + maxZ) / 2) * scale],
  };
}

/**
 * Vertex cloud for Rapier's convex-hull builder, stride-sampled down to the
 * budget. Sampling can shave extreme vertices off very dense meshes — the
 * hull shrinks slightly, never grows.
 */
function sampleHullPoints(
  position: THREE.BufferAttribute,
  toRoot: THREE.Matrix4,
  maxPoints: number,
  scale: number,
): Float32Array {
  const stride = Math.max(1, Math.ceil(position.count / maxPoints));
  const kept = Math.ceil(position.count / stride);
  const points = new Float32Array(kept * 3);
  let write = 0;
  for (let i = 0; i < position.count; i += stride) {
    _vertex.fromBufferAttribute(position, i).applyMatrix4(toRoot).multiplyScalar(scale);
    points[write++] = _vertex.x;
    points[write++] = _vertex.y;
    points[write++] = _vertex.z;
  }
  return points;
}
