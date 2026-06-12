import { create } from 'zustand';
import type { RefObject } from 'react';
import type { Group, Quaternion, Vector3 } from 'three';
import type { RapierRigidBody } from '@react-three/rapier';
import type { RigidBodyType } from '@dimforge/rapier3d-compat';

export interface PrecisionHitEvent {
  targetId: string;
  /** World-space contact point (owned copy, safe to keep). */
  point: Vector3;
  /** World-space surface normal (owned copy, safe to keep). */
  normal: Vector3;
}

/**
 * Every interactable rigid body in the scene registers one of these.
 * The interaction system resolves Rapier raycast hits back to registrations
 * through the `itemId` stored in the rigid body's userData.
 */
export interface ItemRegistration {
  id: string;
  label: string;
  /** Live handle to the Rapier body; populated by @react-three/rapier after mount. */
  bodyRef: RefObject<RapierRigidBody | null>;
  /** Tool profile id granted while held (see tools/toolProfiles.ts), or null for inert props. */
  profileId: string | null;
  /** Can be picked up with [E]. */
  grabbable: boolean;
  /** Valid target for the precision tool. */
  targetable: boolean;
  /** Pose of the item origin relative to the hand socket while held. */
  gripPosition: Vector3;
  gripQuaternion: Quaternion;
  /** Fired when the precision tool's ray lands on this item. */
  onPrecisionHit?: (event: PrecisionHitEvent) => void;
}

/**
 * The interaction verbs, registered by <InteractionSystem> on mount. Keyboard
 * and mouse are just one consumer — a VR controller mapping, a touch UI, or a
 * test harness can drive the same sandbox through these.
 */
export interface SandboxActions {
  /** Grab whatever grabbable is under the crosshair, or drop the held item. */
  toggleGrab: () => void;
  /** Grab a specific registered item by id (drops the current one first). */
  grabItem: (id: string) => boolean;
  drop: () => void;
  /** Fire the held item's tool profile from its tip along the camera aim. */
  useHeldTool: () => void;
}

interface SandboxState {
  /** Registry of interactables, keyed by item id. */
  items: Record<string, ItemRegistration>;
  /** Item currently snapped to the hand socket (kinematic), or null. */
  heldItemId: string | null;
  /** Grabbable item under the crosshair, or null. Drives the HUD prompt. */
  aimedItemId: string | null;
  /** Mirrored pointer-lock state for the HUD (DOM events live outside R3F). */
  pointerLocked: boolean;
  playerBodyRef: RefObject<RapierRigidBody | null> | null;
  handSocketRef: RefObject<Group | null> | null;
  /** Interaction verbs; null until <InteractionSystem> mounts. */
  actions: SandboxActions | null;

  registerItem: (item: ItemRegistration) => void;
  unregisterItem: (id: string) => void;
  registerPlayer: (
    body: RefObject<RapierRigidBody | null>,
    handSocket: RefObject<Group | null>,
  ) => void;
  registerActions: (actions: SandboxActions | null) => void;
  setHeldItem: (id: string | null) => void;
  setAimedItem: (id: string | null) => void;
  setPointerLocked: (locked: boolean) => void;
}

export const useSandboxStore = create<SandboxState>()((set, get) => ({
  items: {},
  heldItemId: null,
  aimedItemId: null,
  pointerLocked: false,
  playerBodyRef: null,
  handSocketRef: null,
  actions: null,

  registerItem: (item) => set((state) => ({ items: { ...state.items, [item.id]: item } })),

  unregisterItem: (id) =>
    set((state) => {
      // If the item unmounts mid-hold, restore its physical state so the body
      // is never orphaned as a sensor-ized kinematic.
      if (state.heldItemId === id) {
        const body = state.items[id]?.bodyRef.current;
        if (body) {
          for (let i = 0; i < body.numColliders(); i++) body.collider(i).setSensor(false);
          body.setBodyType(0 as RigidBodyType /* Dynamic */, true);
        }
      }
      const { [id]: _removed, ...rest } = state.items;
      return {
        items: rest,
        heldItemId: state.heldItemId === id ? null : state.heldItemId,
        aimedItemId: state.aimedItemId === id ? null : state.aimedItemId,
      };
    }),

  registerPlayer: (playerBodyRef, handSocketRef) => set({ playerBodyRef, handSocketRef }),

  registerActions: (actions) => set({ actions }),

  setHeldItem: (heldItemId) => set({ heldItemId }),

  // Called every frame by the aim scan — bail out unless the value changed.
  setAimedItem: (id) => {
    if (get().aimedItemId !== id) set({ aimedItemId: id });
  },

  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
}));
