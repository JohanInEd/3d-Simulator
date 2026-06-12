import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface ImpactBurst {
  position: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  color?: number;
  count?: number;
  /** Mean ejection speed in m/s. */
  speed?: number;
  /** Particle radius in meters. */
  size?: number;
}

/**
 * Imperative FX queue. Tool profiles run inside raycast handlers, not React —
 * they push bursts here and the <ImpactParticles> system drains the queue on
 * the next frame. Values are copied on push because callers pass scratch
 * vectors that get reused immediately.
 */
const queue: ImpactBurst[] = [];

export function spawnImpactBurst(burst: ImpactBurst): void {
  queue.push({
    position: { x: burst.position.x, y: burst.position.y, z: burst.position.z },
    normal: { x: burst.normal.x, y: burst.normal.y, z: burst.normal.z },
    color: burst.color,
    count: burst.count,
    speed: burst.speed,
    size: burst.size,
  });
}

const POOL_SIZE = 512;
const GRAVITY = -6;
const LIFETIME = 0.55;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _color = new THREE.Color();
const _normal = new THREE.Vector3();
const _direction = new THREE.Vector3();

/**
 * Single InstancedMesh particle pool (fixed allocations, ring-buffer reuse).
 * Dead instances are parked at scale 0; the whole system is one draw call.
 */
export function ImpactParticles() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const state = useRef({
    positions: new Float32Array(POOL_SIZE * 3),
    velocities: new Float32Array(POOL_SIZE * 3),
    life: new Float32Array(POOL_SIZE), // seconds remaining; <= 0 means dead
    size: new Float32Array(POOL_SIZE),
    cursor: 0,
    alive: 0,
  }).current;

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _matrix.makeScale(0, 0, 0);
    for (let i = 0; i < POOL_SIZE; i++) {
      mesh.setMatrixAt(i, _matrix);
      mesh.setColorAt(i, _color.setHex(0xffffff)); // allocates the instanceColor buffer
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  useFrame((_, rawDelta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (state.alive === 0 && queue.length === 0) return;
    const delta = Math.min(rawDelta, 1 / 20); // clamp tab-switch spikes

    // Drain pending bursts into pool slots; the ring cursor recycles the
    // oldest particles under sustained fire.
    while (queue.length > 0) {
      const burst = queue.pop()!;
      const count = burst.count ?? 12;
      _normal.set(burst.normal.x, burst.normal.y, burst.normal.z);
      for (let n = 0; n < count; n++) {
        const i = state.cursor;
        state.cursor = (state.cursor + 1) % POOL_SIZE;
        if (state.life[i] <= 0) state.alive++;

        // Random direction folded into the surface hemisphere, biased along the normal.
        _direction.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
        if (_direction.lengthSq() < 1e-6) _direction.copy(_normal);
        else _direction.normalize();
        if (_direction.dot(_normal) < 0) _direction.reflect(_normal);
        _direction.addScaledVector(_normal, 0.8).normalize();

        const speed = (burst.speed ?? 2) * (0.4 + Math.random() * 0.9);
        const i3 = i * 3;
        state.positions[i3] = burst.position.x;
        state.positions[i3 + 1] = burst.position.y;
        state.positions[i3 + 2] = burst.position.z;
        state.velocities[i3] = _direction.x * speed;
        state.velocities[i3 + 1] = _direction.y * speed;
        state.velocities[i3 + 2] = _direction.z * speed;
        state.life[i] = LIFETIME * (0.6 + Math.random() * 0.4);
        state.size[i] = (burst.size ?? 0.025) * (0.7 + Math.random() * 0.6);
        mesh.setColorAt(i, _color.setHex(burst.color ?? 0xffffff));
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // Integrate the live particles.
    for (let i = 0; i < POOL_SIZE; i++) {
      if (state.life[i] <= 0) continue;
      state.life[i] -= delta;
      if (state.life[i] <= 0) {
        state.alive--;
        _matrix.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, _matrix);
        continue;
      }
      const i3 = i * 3;
      state.velocities[i3 + 1] += GRAVITY * delta;
      state.positions[i3] += state.velocities[i3] * delta;
      state.positions[i3 + 1] += state.velocities[i3 + 1] * delta;
      state.positions[i3 + 2] += state.velocities[i3 + 2] * delta;

      const t = state.life[i] / LIFETIME;
      _position.set(state.positions[i3], state.positions[i3 + 1], state.positions[i3 + 2]);
      _scale.setScalar(state.size[i] * Math.min(t * 3, 1)); // quick pop-in, shrink out
      _matrix.compose(_position, _quaternion, _scale);
      mesh.setMatrixAt(i, _matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, POOL_SIZE]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
