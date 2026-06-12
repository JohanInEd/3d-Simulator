import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { useSandboxStore } from '../state/useSandboxStore';

const GROUND_SIZE = 50;
const WALL_HEIGHT = 4;

/** Static arena + lighting + physics props to exercise both tool profiles. */
export function Level() {
  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[12, 18, 8]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
      />

      {/* Ground slab + invisible perimeter walls, one fixed compound body. */}
      <RigidBody type="fixed" colliders={false} friction={1}>
        <CuboidCollider args={[GROUND_SIZE / 2, 0.5, GROUND_SIZE / 2]} position={[0, -0.5, 0]} />
        <CuboidCollider args={[GROUND_SIZE / 2, WALL_HEIGHT, 0.5]} position={[0, WALL_HEIGHT, GROUND_SIZE / 2]} />
        <CuboidCollider args={[GROUND_SIZE / 2, WALL_HEIGHT, 0.5]} position={[0, WALL_HEIGHT, -GROUND_SIZE / 2]} />
        <CuboidCollider args={[0.5, WALL_HEIGHT, GROUND_SIZE / 2]} position={[GROUND_SIZE / 2, WALL_HEIGHT, 0]} />
        <CuboidCollider args={[0.5, WALL_HEIGHT, GROUND_SIZE / 2]} position={[-GROUND_SIZE / 2, WALL_HEIGHT, 0]} />
        <mesh receiveShadow position={[0, -0.5, 0]}>
          <boxGeometry args={[GROUND_SIZE, 1, GROUND_SIZE]} />
          <meshStandardMaterial color="#2b3138" roughness={0.95} />
        </mesh>
      </RigidBody>

      <CrateStack origin={[-3, 0, -4]} />
      <CrateStack origin={[3.5, 0, -6]} />
      <TargetDummy id="target-dummy-01" position={[0, 0, -5]} />
    </>
  );
}

/**
 * Plain dynamic bodies — deliberately NOT registered with the sandbox store.
 * The kinetic tool knocks them around anyway, proving Profile B acts on any
 * Rapier body, not just ingested assets.
 */
function CrateStack({ origin }: { origin: [number, number, number] }) {
  const crates = useMemo(() => {
    const positions: [number, number, number][] = [];
    const [x, y, z] = origin;
    for (let level = 0; level < 3; level++) {
      for (let i = 0; i < 3 - level; i++) {
        positions.push([x + i * 0.74 + level * 0.37, y + 0.36 + level * 0.72, z]);
      }
    }
    return positions;
  }, [origin]);

  return (
    <>
      {crates.map((position, index) => (
        <RigidBody key={index} colliders="cuboid" position={position} density={30}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.7, 0.7, 0.7]} />
            <meshStandardMaterial color="#8d6e4a" roughness={0.8} />
          </mesh>
        </RigidBody>
      ))}
    </>
  );
}

/**
 * A static, non-grabbable precision target. Registers directly with the store
 * (same registry the GLB pipeline uses) and flashes its emissive channel when
 * the precision tool's callback lands. The material is local to this mesh, so
 * mutating it is safe.
 */
function TargetDummy({ id, position }: { id: string; position: [number, number, number] }) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const flashRef = useRef(0);
  const registerItem = useSandboxStore((state) => state.registerItem);
  const unregisterItem = useSandboxStore((state) => state.unregisterItem);

  useEffect(() => {
    registerItem({
      id,
      label: 'Calibration Target',
      bodyRef,
      profileId: null,
      grabbable: false,
      targetable: true,
      gripPosition: new THREE.Vector3(),
      gripQuaternion: new THREE.Quaternion(),
      onPrecisionHit: () => {
        flashRef.current = 1;
      },
    });
    return () => unregisterItem(id);
  }, [id, registerItem, unregisterItem]);

  useFrame((_, delta) => {
    if (!materialRef.current) return;
    if (flashRef.current <= 0) return;
    flashRef.current = Math.max(0, flashRef.current - delta * 2.5);
    materialRef.current.emissiveIntensity = flashRef.current * 3;
  });

  return (
    <RigidBody ref={bodyRef} type="fixed" colliders="hull" position={position} userData={{ itemId: id }}>
      <mesh castShadow position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.12, 0.18, 1, 16]} />
        <meshStandardMaterial color="#475569" roughness={0.6} />
      </mesh>
      <mesh castShadow position={[0, 1.25, 0]}>
        <sphereGeometry args={[0.28, 24, 24]} />
        <meshStandardMaterial
          ref={materialRef}
          color="#dc2626"
          emissive="#f87171"
          emissiveIntensity={0}
        />
      </mesh>
    </RigidBody>
  );
}
