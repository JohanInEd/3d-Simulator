# Zero-Code 3D Sandbox — Core Interactive Engine

React Three Fiber + Rapier engine that turns dynamically imported `.glb`/`.gltf`
models into physical, grabbable, usable tools — no per-asset code. Content is
declared as data (`ASSET_MANIFEST` in [src/App.tsx](src/App.tsx)); mechanics are
declared as tool profiles ([src/tools/toolProfiles.ts](src/tools/toolProfiles.ts)).

```
npm install
npm run dev
```

Drop your models into `public/models/` (`precision_tool.glb`,
`kinetic_tool.glb`, `prop_crate.glb` for the default manifest). Until then,
each manifest entry mounts a primitive stand-in with identical physics and
mechanics, so the sandbox always runs.

**Controls:** click to capture the mouse · WASD move · Space jump ·
**E** grab/drop · **LMB** use the held tool.

## Architecture

```
            ASSET_MANIFEST (data, zero-code surface)
                    │
            <InteractableAsset url profile …>
                    │  useGLTF → SkeletonUtils.clone
                    ▼
        computeAutoColliders(model)           ── mesh analysis:
                    │                            cuboid (boxy/closed meshes)
                    ▼                            vs decimated convex hull
        <RigidBody> + collider components
                    │
                    ▼
        useSandboxStore registry  ◄──────────  Player registers body + hand socket
                    │                          (hand socket = group on the camera)
                    ▼
        <InteractionSystem/>  ── E: grab/drop (kinematic + sensor-ized, snapped
                    │                to the hand socket every frame)
                    │         ── LMB: raycast from tool tip → ToolProfile.onUse(ctx)
                    ▼
        TOOL_PROFILES: 'precision' (callback + FX) · 'kinetic' (impulse at hit point)
```

| Module | Responsibility |
| --- | --- |
| [src/state/useSandboxStore.ts](src/state/useSandboxStore.ts) | Zustand registry: items, held/aimed ids, player/hand refs |
| [src/systems/computeAutoColliders.ts](src/systems/computeAutoColliders.ts) | Per-mesh collider analysis (signed-volume boxiness heuristic) |
| [src/components/InteractableAsset.tsx](src/components/InteractableAsset.tsx) | GLB ingestion → physics body → registration (+ 404 fallback) |
| [src/components/Player.tsx](src/components/Player.tsx) | FP capsule controller, camera rig, hand socket, pointer lock |
| [src/systems/InteractionSystem.tsx](src/systems/InteractionSystem.tsx) | Grab/drop/use/aim — all raycasts and body-type transitions |
| [src/tools/toolProfiles.ts](src/tools/toolProfiles.ts) | The modular mechanics (Profile A precision, Profile B kinetic) |
| [src/systems/ImpactParticles.tsx](src/systems/ImpactParticles.tsx) | Pooled InstancedMesh burst FX with an imperative spawn queue |

## Design notes

- **Holding = kinematic + sensor.** A grabbed body switches to
  `KinematicPositionBased` and its colliders become sensors. A solid kinematic
  collider has effectively infinite mass and would bulldoze the scene when
  waved through it; the sensor swap also lets every tool raycast simply pass
  `QueryFilterFlags.EXCLUDE_SENSORS` to ignore the held item. On drop the body
  returns to dynamic, inheriting player velocity plus a forward toss.
- **Collider heuristic.** Mesh volume (divergence theorem) over AABB volume
  ≥ 0.72 → cuboid; otherwise convex hull, stride-sampled to ≤ 256 points. Flat
  geometry short-circuits to a min-thickness cuboid (hulls degenerate on
  coplanar points). Open meshes bias the ratio low, which fails safe to hull.
  Override per asset with `colliders="cuboid" | "hull"`.
- **Mass-aware knockback.** The kinetic profile targets a delta-v
  (6 m/s, capped at 40 kg of driven mass) instead of a fixed impulse, so a
  20 cm prop and a 2 m crate both feel right without per-asset tuning.
- **Frame order.** Player movement runs at priority −2, interaction (aim scan +
  kinematic snap) at −1, so the held item always tracks the *current* frame's
  camera pose.
- **State discipline.** Per-frame systems read the store via
  `useSandboxStore.getState()` (transient, no re-renders); only the HUD
  subscribes reactively, and the aim scan bails out unless the value changed.
- **VR.** The socket is just a `THREE.Group`. Register an XR controller grip
  space instead of the camera-mounted group (and map squeeze/trigger to
  grab/use) — nothing else changes.
- **Input is decoupled.** Keyboard/mouse handlers call the same
  `SandboxActions` verbs (`toggleGrab`, `grabItem(id)`, `drop`, `useHeldTool`)
  that the interaction system publishes into the store — bind a VR controller,
  touch UI, or test harness to them directly. In dev builds the store is
  exposed as `window.__sandbox` for console scripting, e.g.
  `__sandbox.getState().actions.grabItem('driver-01')`.

## Adding a mechanic (new tool profile)

```ts
// src/tools/toolProfiles.ts
export const GravityTool: ToolProfile = {
  id: 'gravity',
  label: 'Gravity Well',
  range: 25,
  cooldownMs: 800,
  tipOffset: [0, 0, -0.45],
  onUse: ({ rapier, hit }) => {
    if (!hit) return;
    const body = hit.collider.parent();
    if (body?.bodyType() === rapier.RigidBodyType.Dynamic) {
      body.applyImpulse({ x: 0, y: 9 * Math.min(body.mass(), 40), z: 0 }, true);
    }
  },
};
// add to TOOL_PROFILES, then in the manifest: { url: '…', profile: 'gravity' }
```
