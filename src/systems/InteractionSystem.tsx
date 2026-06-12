import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import { useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import type * as RAPIER from '@dimforge/rapier3d-compat';
import { useSandboxStore, type ItemRegistration } from '../state/useSandboxStore';
import { TOOL_PROFILES, type ToolUseContext } from '../tools/toolProfiles';
import { INTERACTION_UPDATE_PRIORITY, type ControlName } from '../controls';

const GRAB_RANGE = 3.2;
const THROW_SPEED = 4.5;

// Frame-loop scratch — never allocate in useFrame.
const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _handPosition = new THREE.Vector3();
const _handQuaternion = new THREE.Quaternion();
const _gripPosition = new THREE.Vector3();
const _gripQuaternion = new THREE.Quaternion();
const _tip = new THREE.Vector3();
const _point = new THREE.Vector3();
const _normal = new THREE.Vector3();

/**
 * The brain of the sandbox. Owns the three verbs:
 *
 *  - [E]   grab / drop ("socket" system): the target body turns kinematic and
 *          is snapped to the camera's hand socket every frame; its colliders
 *          become sensors while held so the kinematic body can't impart
 *          infinite-mass shoves on the scene.
 *  - [LMB] use: raycast from the held tool's tip along the camera aim,
 *          dispatched to the item's tool profile.
 *  - hover: per-frame aim scan that drives the HUD prompt.
 *
 * Renders nothing; it is pure systems code mounted inside <Physics>.
 */
export function InteractionSystem() {
  const { world, rapier } = useRapier();
  const getThree = useThree((state) => state.get);
  const [subscribeKeys] = useKeyboardControls<ControlName>();
  const lastUseAtRef = useRef(0);

  // One reusable Rapier ray for every query this system makes.
  const rayRef = useRef<RAPIER.Ray | null>(null);
  if (!rayRef.current) rayRef.current = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });

  const engine = useMemo(() => {
    const ray = rayRef.current!;
    const store = useSandboxStore;

    const setRay = (origin: THREE.Vector3, direction: THREE.Vector3) => {
      ray.origin.x = origin.x;
      ray.origin.y = origin.y;
      ray.origin.z = origin.z;
      ray.dir.x = direction.x;
      ray.dir.y = direction.y;
      ray.dir.z = direction.z;
    };

    const playerBody = () => store.getState().playerBodyRef?.current ?? null;

    /** Resolve a Rapier collider back to a registered sandbox item via userData. */
    const resolveItem = (collider: RAPIER.Collider): ItemRegistration | null => {
      const body = collider.parent();
      const data = body?.userData as { itemId?: string } | undefined;
      return data?.itemId ? (store.getState().items[data.itemId] ?? null) : null;
    };

    /**
     * Crosshair ray. EXCLUDE_SENSORS keeps trigger volumes and the held
     * (sensor-ized) item out of the query; the player body is excluded
     * explicitly so the capsule never occludes the aim.
     */
    const castCameraRay = (range: number) => {
      const camera = getThree().camera;
      camera.getWorldPosition(_origin);
      camera.getWorldDirection(_direction);
      setRay(_origin, _direction);
      return world.castRay(
        ray,
        range,
        true,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        playerBody() ?? undefined,
      );
    };

    const grab = (item: ItemRegistration) => {
      const body = item.bodyRef.current;
      if (!body) return;
      body.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
      // Sensor-ize while held: a kinematic collider would otherwise bulldoze
      // every dynamic body the player waves it through.
      for (let i = 0; i < body.numColliders(); i++) body.collider(i).setSensor(true);
      store.getState().setHeldItem(item.id);
      store.getState().setAimedItem(null);
    };

    const drop = () => {
      const state = store.getState();
      const item = state.heldItemId ? state.items[state.heldItemId] : null;
      const body = item?.bodyRef.current;
      state.setHeldItem(null);
      if (!item || !body) return;
      for (let i = 0; i < body.numColliders(); i++) body.collider(i).setSensor(false);
      body.setBodyType(rapier.RigidBodyType.Dynamic, true);

      // Inherit the player's velocity plus a gentle forward toss.
      getThree().camera.getWorldDirection(_direction);
      const playerVelocity = playerBody()?.linvel() ?? { x: 0, y: 0, z: 0 };
      body.setLinvel(
        {
          x: playerVelocity.x + _direction.x * THROW_SPEED,
          y: playerVelocity.y + _direction.y * THROW_SPEED + 0.8,
          z: playerVelocity.z + _direction.z * THROW_SPEED,
        },
        true,
      );
      body.setAngvel(
        {
          x: (Math.random() - 0.5) * 3,
          y: (Math.random() - 0.5) * 3,
          z: (Math.random() - 0.5) * 3,
        },
        true,
      );
    };

    /** [E]: drop if holding, otherwise grab whatever grabbable is under the crosshair. */
    const toggleGrab = () => {
      if (store.getState().heldItemId) return drop();
      const hit = castCameraRay(GRAB_RANGE);
      if (!hit) return;
      const item = resolveItem(hit.collider);
      if (item?.grabbable) grab(item);
    };

    /** Scripted grab by id (inventory systems, VR bindings, tests). */
    const grabItem = (id: string): boolean => {
      const state = store.getState();
      if (state.heldItemId === id) return true;
      const item = state.items[id];
      if (!item?.grabbable || !item.bodyRef.current) return false;
      if (state.heldItemId) drop();
      grab(item);
      return true;
    };

    /** [LMB]: fire the held tool from its tip along the camera aim. */
    const useHeldTool = () => {
      const state = store.getState();
      const item = state.heldItemId ? state.items[state.heldItemId] : null;
      if (!item?.profileId) return;
      const profile = TOOL_PROFILES[item.profileId];
      const hand = state.handSocketRef?.current;
      if (!profile || !hand) return;

      const now = performance.now();
      if (now - lastUseAtRef.current < profile.cooldownMs) return;
      lastUseAtRef.current = now;

      hand.getWorldPosition(_handPosition);
      hand.getWorldQuaternion(_handQuaternion);
      _tip
        .set(profile.tipOffset[0], profile.tipOffset[1], profile.tipOffset[2])
        .applyQuaternion(_handQuaternion)
        .add(_handPosition);
      getThree().camera.getWorldDirection(_direction);
      setRay(_tip, _direction);

      const hit = world.castRayAndGetNormal(
        ray,
        profile.range,
        true,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS, // also skips the held item itself
        undefined,
        undefined,
        playerBody() ?? undefined,
      );

      let contextHit: ToolUseContext['hit'] = null;
      let hitItem: ItemRegistration | null = null;
      if (hit) {
        const distance = hit.timeOfImpact;
        const point = ray.pointAt(distance);
        _point.set(point.x, point.y, point.z);
        _normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
        contextHit = { collider: hit.collider, point: _point, normal: _normal, distance };
        hitItem = resolveItem(hit.collider);
      }

      profile.onUse({
        rapier,
        world,
        origin: _tip,
        direction: _direction,
        hit: contextHit,
        hitItem,
        heldItem: item,
      });
    };

    /** Per-frame hover scan driving the HUD "press E" prompt. */
    const updateAim = () => {
      const state = store.getState();
      if (state.heldItemId) {
        state.setAimedItem(null);
        return;
      }
      const hit = castCameraRay(GRAB_RANGE);
      const item = hit ? resolveItem(hit.collider) : null;
      state.setAimedItem(item?.grabbable ? item.id : null);
    };

    /** Socket snap: drive the held kinematic body to the hand's world pose. */
    const syncHeldItem = () => {
      const state = store.getState();
      const item = state.heldItemId ? state.items[state.heldItemId] : null;
      const body = item?.bodyRef.current;
      const hand = state.handSocketRef?.current;
      if (!item || !body || !hand) return;
      hand.getWorldPosition(_handPosition);
      hand.getWorldQuaternion(_handQuaternion);
      _gripPosition.copy(item.gripPosition).applyQuaternion(_handQuaternion).add(_handPosition);
      _gripQuaternion.copy(_handQuaternion).multiply(item.gripQuaternion);
      body.setNextKinematicTranslation({
        x: _gripPosition.x,
        y: _gripPosition.y,
        z: _gripPosition.z,
      });
      body.setNextKinematicRotation({
        x: _gripQuaternion.x,
        y: _gripQuaternion.y,
        z: _gripQuaternion.z,
        w: _gripQuaternion.w,
      });
    };

    return { toggleGrab, grabItem, drop, useHeldTool, updateAim, syncHeldItem };
  }, [world, rapier, getThree]);

  // Publish the verbs so other input sources (VR, touch UI, scripts) can
  // drive the sandbox without going through keyboard/mouse.
  useEffect(() => {
    const { toggleGrab, grabItem, drop, useHeldTool } = engine;
    useSandboxStore.getState().registerActions({ toggleGrab, grabItem, drop, useHeldTool });
    return () => useSandboxStore.getState().registerActions(null);
  }, [engine]);

  // [E] — edge-triggered grab/drop, only while the pointer is captured.
  useEffect(
    () =>
      subscribeKeys(
        (keys) => keys.interact,
        (pressed) => {
          if (pressed && document.pointerLockElement) engine.toggleGrab();
        },
      ),
    [subscribeKeys, engine],
  );

  // [LMB] — use the held tool. Gated on pointer lock so UI clicks never fire it.
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 0 && document.pointerLockElement) engine.useHeldTool();
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [engine]);

  // Runs after the player update so the hand socket has this frame's camera pose.
  useFrame(() => {
    engine.updateAim();
    engine.syncHeldItem();
  }, INTERACTION_UPDATE_PRIORITY);

  return null;
}
