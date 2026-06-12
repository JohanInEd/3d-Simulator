import type { KeyboardControlsEntry } from '@react-three/drei';

export type ControlName = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'interact';

export const KEYBOARD_MAP: KeyboardControlsEntry<ControlName>[] = [
  { name: 'forward', keys: ['KeyW', 'ArrowUp'] },
  { name: 'back', keys: ['KeyS', 'ArrowDown'] },
  { name: 'left', keys: ['KeyA', 'ArrowLeft'] },
  { name: 'right', keys: ['KeyD', 'ArrowRight'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'interact', keys: ['KeyE'] },
];

/**
 * useFrame priorities. R3F runs subscribers in ascending order, so the player
 * moves the camera first, then the interaction system reads the hand socket's
 * world pose for kinematic snapping the same frame.
 */
export const PLAYER_UPDATE_PRIORITY = -2;
export const INTERACTION_UPDATE_PRIORITY = -1;
