import type * as RAPIER from '@dimforge/rapier3d-compat';
import type { RapierContext } from '@react-three/rapier';
import type * as THREE from 'three';
import type { ItemRegistration } from '../state/useSandboxStore';
import { spawnImpactBurst } from '../systems/ImpactParticles';

/**
 * Everything a tool needs to act on the world. The interaction system builds
 * this once per trigger pull: it casts the ray from the tool tip along the
 * camera aim (excluding the player body and the held, sensor-ized item) and
 * hands the result to the profile.
 *
 * NOTE: `origin`, `direction`, `hit.point` and `hit.normal` are reused scratch
 * vectors — `.clone()` them if you keep them past the call.
 */
export interface ToolUseContext {
  rapier: RapierContext['rapier'];
  world: RAPIER.World;
  /** World-space ray origin: the tool tip. */
  origin: THREE.Vector3;
  /** Normalized world-space aim direction (camera forward). */
  direction: THREE.Vector3;
  /** First surface inside `range`, or null on a whiff. */
  hit: {
    collider: RAPIER.Collider;
    point: THREE.Vector3;
    normal: THREE.Vector3;
    distance: number;
  } | null;
  /** Registration of the hit item, when the hit body carries an itemId. */
  hitItem: ItemRegistration | null;
  /** The held item driving this use. */
  heldItem: ItemRegistration;
}

export interface ToolProfile {
  id: string;
  label: string;
  /** Raycast reach in meters, measured from the tool tip. */
  range: number;
  cooldownMs: number;
  /** Tool tip in hand-socket local space; rays start here (-Z is forward). */
  tipOffset: [number, number, number];
  onUse: (ctx: ToolUseContext) => void;
}

/**
 * Profile A — surgical/precision tool.
 * Short range, fast cadence, applies no forces. Confirms contact with a
 * feedback burst and notifies registered targets through their callback.
 */
export const PrecisionTool: ToolProfile = {
  id: 'precision',
  label: 'Precision Tool',
  range: 3,
  cooldownMs: 160,
  tipOffset: [0, 0, -0.4],
  onUse: ({ hit, hitItem }) => {
    if (!hit) return;
    spawnImpactBurst({
      position: hit.point,
      normal: hit.normal,
      color: 0x67e8f9,
      count: 12,
      speed: 1.4,
      size: 0.018,
    });
    if (hitItem?.targetable) {
      console.log(`Interacting with target: ${hitItem.label} (${hitItem.id})`);
      hitItem.onPrecisionHit?.({
        targetId: hitItem.id,
        point: hit.point.clone(),
        normal: hit.normal.clone(),
      });
    }
  },
};

/**
 * Knockback tuning for the kinetic tool. The impulse targets a delta-v rather
 * than a fixed magnitude so arbitrary imported assets feel consistent: bodies
 * up to MAX_DRIVEN_MASS get the full KNOCKBACK_DELTA_V; heavier ones budge
 * proportionally less (impulse is capped, physics stays honest).
 */
const KNOCKBACK_DELTA_V = 6; // m/s
const MAX_DRIVEN_MASS = 40; // kg

/**
 * Profile B — kinetic tool/weapon.
 * Long range. Applies an impulse at the exact contact point of whatever
 * dynamic rigid body the ray hits — works on any Rapier body, registered with
 * the sandbox or not. Off-center hits impart spin for free.
 */
export const KineticTool: ToolProfile = {
  id: 'kinetic',
  label: 'Kinetic Driver',
  range: 40,
  cooldownMs: 320,
  tipOffset: [0, 0, -0.45],
  onUse: ({ rapier, hit, direction }) => {
    if (!hit) return;
    spawnImpactBurst({
      position: hit.point,
      normal: hit.normal,
      color: 0xfbbf24,
      count: 18,
      speed: 3,
      size: 0.03,
    });
    const body = hit.collider.parent();
    if (!body || body.bodyType() !== rapier.RigidBodyType.Dynamic) return;
    const magnitude = KNOCKBACK_DELTA_V * Math.min(body.mass(), MAX_DRIVEN_MASS);
    body.applyImpulseAtPoint(
      {
        x: direction.x * magnitude,
        y: direction.y * magnitude,
        z: direction.z * magnitude,
      },
      hit.point,
      true,
    );
  },
};

/**
 * Profile registry. Adding a mechanic to the sandbox = adding an entry here;
 * assets opt in by name via their `profile` prop. No other code changes.
 */
export const TOOL_PROFILES: Record<string, ToolProfile> = {
  [PrecisionTool.id]: PrecisionTool,
  [KineticTool.id]: KineticTool,
};
