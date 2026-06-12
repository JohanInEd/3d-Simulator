import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { PerspectiveCamera, PointerLockControls, useKeyboardControls } from '@react-three/drei';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import type * as RAPIER from '@dimforge/rapier3d-compat';
import { useSandboxStore } from '../state/useSandboxStore';
import { PLAYER_UPDATE_PRIORITY, type ControlName } from '../controls';

const WALK_SPEED = 5.5;
const JUMP_SPEED = 6;
const CAPSULE_HALF_HEIGHT = 0.6; // cylindrical section; total height ≈ 1.9 m
const CAPSULE_RADIUS = 0.35;
const EYE_OFFSET = 0.7; // camera height above the capsule center
const GROUND_PROBE = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.12;

/**
 * Hand socket pose relative to the camera: right side, slightly low, in front.
 * This is the "socket" grabbed items snap to. For VR, register an XR
 * controller's grip space group here instead — nothing else changes.
 */
const HAND_SOCKET_POSITION: [number, number, number] = [0.32, -0.26, -0.62];

const DEFAULT_SPAWN: [number, number, number] = [0, 1.2, 6];

const _euler = new THREE.Euler();
const _move = new THREE.Vector3();

/**
 * First-person controller: dynamic capsule with locked rotations, yaw-relative
 * WASD via velocity control, pointer-lock mouse look, raycast ground check for
 * jumping. The camera (and its hand socket) is part of this rig and follows
 * the capsule every frame.
 */
export function Player({ position = DEFAULT_SPAWN }: { position?: [number, number, number] }) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const handSocketRef = useRef<THREE.Group>(null);
  const registerPlayer = useSandboxStore((state) => state.registerPlayer);
  const setPointerLocked = useSandboxStore((state) => state.setPointerLocked);
  const [, getKeys] = useKeyboardControls<ControlName>();
  const { world, rapier } = useRapier();

  const groundRayRef = useRef<RAPIER.Ray | null>(null);
  if (!groundRayRef.current) {
    groundRayRef.current = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  useEffect(() => {
    registerPlayer(bodyRef, handSocketRef);
  }, [registerPlayer]);

  useFrame((state) => {
    const body = bodyRef.current;
    if (!body) return;
    const camera = state.camera;
    const translation = body.translation();

    // --- movement: yaw-relative, pitch-independent ---
    const keys = getKeys();
    const locked = !!document.pointerLockElement;
    const inputX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const inputZ = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
    _euler.setFromQuaternion(camera.quaternion, 'YXZ');
    const sin = Math.sin(_euler.y);
    const cos = Math.cos(_euler.y);
    // camera forward = (-sin, 0, -cos), camera right = (cos, 0, -sin)
    _move.set(inputX * cos - inputZ * sin, 0, -inputX * sin - inputZ * cos);
    if (_move.lengthSq() > 0) _move.normalize().multiplyScalar(WALK_SPEED);

    let velocityY = body.linvel().y;
    if (locked && keys.jump && isGrounded(body, translation)) velocityY = JUMP_SPEED;
    body.setLinvel(
      { x: locked ? _move.x : 0, y: velocityY, z: locked ? _move.z : 0 },
      true,
    );

    // --- camera follows the capsule (the hand socket rides along) ---
    camera.position.set(translation.x, translation.y + EYE_OFFSET, translation.z);
  }, PLAYER_UPDATE_PRIORITY);

  const isGrounded = (body: RapierRigidBody, translation: RAPIER.Vector) => {
    const ray = groundRayRef.current!;
    ray.origin.x = translation.x;
    ray.origin.y = translation.y;
    ray.origin.z = translation.z;
    return world.castRay(ray, GROUND_PROBE, true, undefined, undefined, undefined, body) !== null;
  };

  return (
    <>
      <RigidBody
        ref={bodyRef}
        colliders={false}
        position={position}
        lockRotations
        canSleep={false}
        friction={0}
      >
        <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} />
      </RigidBody>

      {/* The camera is part of the player rig; the hand socket is its child. */}
      <PerspectiveCamera
        makeDefault
        fov={75}
        near={0.05}
        position={[position[0], position[1] + EYE_OFFSET, position[2]]}
      >
        <group ref={handSocketRef} position={HAND_SOCKET_POSITION} name="hand-socket" />
      </PerspectiveCamera>

      <PointerLockControls
        onLock={() => setPointerLocked(true)}
        onUnlock={() => setPointerLocked(false)}
      />
    </>
  );
}
