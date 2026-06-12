# CONTEXT.md — Session Handoff

Everything needed to continue work on this project in a fresh session (human or
AI). Last updated: 2026-06-12.

## 1. Project snapshot

- **What:** "Zero-Code 3D Sandbox" — a React Three Fiber + Rapier engine that
  turns dynamically imported `.glb`/`.gltf` models into physical, grabbable,
  usable tools with no per-asset code. Content is data (`ASSET_MANIFEST`),
  mechanics are data-driven tool profiles.
- **Where:** local working copy `D:\3DPlatform` (Windows 11).
- **Repo:** https://github.com/JohanInEd/3d-Simulator.git — working branch
  **`developer`** (first commit `e3b78cd`). `main` exists on the remote from
  repo creation and is untouched by this project; no PR opened yet.
- **Status:** core engine complete, typechecked (`strict`), production build
  green, all mechanics verified end-to-end in a live browser (see §8).

## 2. Quick start

```powershell
npm install          # node 24 / npm 11 used originally; lockfile committed
npm run dev          # → http://localhost:5180  (NOT 5173, see §3)
npm run build        # tsc --noEmit && vite build
npm run typecheck    # tsc --noEmit only
```

Controls: click canvas to capture mouse · WASD move · Space jump ·
**E** grab/drop · **LMB** use held tool. Optional: restore the Khronos sample
models with the commands in [public/models/README.md](public/models/README.md)
(GLBs are gitignored for license reasons; the app runs without them via
primitive stand-ins).

## 3. Machine-specific gotchas (discovered the hard way)

1. **Port 5173 is permanently taken** on this machine by a *different*
   project's Vite server (SysG frontend, `D:\Consultas\SysG\frontend`,
   launched with `--port 5173`). This sandbox therefore defaults to **5180**
   (`vite.config.ts`); `process.env.PORT` overrides it.
   `.claude/launch.json` (preview harness config) uses `autoPort: true`.
2. **`@dimforge/rapier3d-compat` must be pinned EXACTLY `0.19.2`** — the exact
   version `@react-three/rapier@2.2.0` pins. A caret range resolves to a newer
   patch, npm keeps two copies, and TypeScript then rejects passing
   `useRapier()` objects into code typed against the direct import ("separate
   declarations of a private property"). When upgrading @react-three/rapier,
   read its pinned version via `npm ls @dimforge/rapier3d-compat` and mirror
   it exactly in package.json.
3. **Git identity is repo-local only** (`JohanInEd` /
   `workingprecol@gmail.com`); there is no global git config on this machine.
   No `gh` CLI installed. Pushes authenticate via Windows Credential Manager
   (stored `JohanInEd` GitHub credentials).
4. The rapier WASM warning `using deprecated parameters for the initialization
   function` in the console is library-internal (@react-three/rapier), not
   project code.

## 4. Stack (installed & verified)

react 19.1 · three 0.180 · @react-three/fiber 9.3 · @react-three/drei 10.7 ·
@react-three/rapier 2.2.0 · @dimforge/rapier3d-compat **0.19.2 (exact)** ·
zustand 5 · vite 7.3 · typescript 5.9 strict. Build emits one ~3.4 MB chunk
(three + inlined Rapier WASM) — normal; code-split later if it matters.

## 5. Architecture

```
ASSET_MANIFEST (src/App.tsx — the zero-code surface, plain data)
  └─ <InteractableAsset>  useGLTF → SkeletonUtils.clone
       └─ computeAutoColliders(model)   per-mesh cuboid-vs-hull analysis
            └─ <RigidBody userData={{itemId}}> + collider components
                 └─ registers into useSandboxStore (zustand registry)
<Player>  FP capsule + camera rig + hand-socket group (child of camera)
<InteractionSystem>  E=grab/drop · LMB=use · per-frame aim scan + kinematic snap
TOOL_PROFILES  'precision' | 'kinetic' — onUse(ctx) modules, registry-keyed
<ImpactParticles>  pooled InstancedMesh FX, imperative spawn queue
<Hud>  DOM overlay outside Canvas, reads the same zustand store
```

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Canvas/Physics composition + `ASSET_MANIFEST` |
| `src/controls.ts` | Keyboard map + useFrame priorities (player −2, interaction −1) |
| `src/state/useSandboxStore.ts` | Registry: items, held/aimed ids, player/hand refs, published `SandboxActions` |
| `src/systems/computeAutoColliders.ts` | Mesh analysis → collider specs (see §6) |
| `src/components/InteractableAsset.tsx` | GLB ingestion, fallback stand-in on 404, registration hook |
| `src/components/Player.tsx` | Capsule controller, pointer lock, hand socket `[0.32,−0.26,−0.62]` rel. camera |
| `src/systems/InteractionSystem.tsx` | All raycasts & body-type transitions; owns the verbs |
| `src/tools/toolProfiles.ts` | Profile A (precision) + B (kinetic) + registry |
| `src/systems/ImpactParticles.tsx` | 512-slot ring-buffer particle pool, one draw call |
| `src/components/Level.tsx` | Demo arena: ground/walls, crate stacks (unregistered bodies), `TargetDummy` |
| `src/ui/Hud.tsx` | Crosshair + prompts |

## 6. Core design decisions & tuning constants

- **Holding = kinematic + sensor.** Grab flips the body to
  `KinematicPositionBased` AND sets all its colliders to sensors (a solid
  kinematic collider has infinite mass and bulldozes the scene). Every tool
  raycast passes `QueryFilterFlags.EXCLUDE_SENSORS`, which automatically
  excludes the held item. Drop restores both, inherits player velocity,
  adds a `THROW_SPEED = 4.5` m/s toss. The store's `unregisterItem` also
  restores body state defensively if an item unmounts mid-hold.
- **Collider heuristic** (`computeAutoColliders`): mesh volume via divergence
  theorem ÷ AABB volume ≥ `0.72` → cuboid, else convex hull stride-sampled to
  ≤ `256` points; flat meshes (< 1 cm) short-circuit to min-thickness cuboids
  (`MIN_HALF_EXTENT = 0.005`); open meshes bias low → fail safe to hull.
  Per-asset override: `colliders="cuboid" | "hull"`. Verified on real assets:
  Rapier `shapeType()` 1 = cuboid (Khronos Box), 9 = ConvexPolyhedron (Duck,
  Avocado).
- **Kinetic knockback is Δv-targeted:** impulse = `6 m/s × min(mass, 40 kg)`
  so arbitrary imported assets feel consistent (`KNOCKBACK_DELTA_V`,
  `MAX_DRIVEN_MASS` in toolProfiles.ts). Works on ANY dynamic Rapier body,
  registered or not (demo crates are deliberately unregistered).
- **Raycast hit → item resolution:** `collider.parent().userData.itemId` →
  `store.items[itemId]`. Anything can opt in by setting that userData and
  registering (see `TargetDummy` in Level.tsx for a non-GLB example).
- **Frame order:** player useFrame at priority −2 (moves camera), interaction
  at −1 (aim scan + snaps held body via `setNextKinematicTranslation/Rotation`)
  — held items always track the current frame's camera pose.
- **State discipline:** frame loops read `useSandboxStore.getState()`
  (transient, zero re-renders); only the HUD subscribes reactively;
  `setAimedItem` bails when unchanged.
- Player: capsule halfHeight 0.6 / radius 0.35, walk 5.5 m/s, jump 6 m/s,
  eye offset +0.7, grounded via downward ray (self-excluded), `GRAB_RANGE`
  3.2 m. Tool tips/cooldowns/ranges live per-profile.
- Default item `density` 50 (manifest-overridable, demo crates 30).

## 7. Extension contracts

**New mechanic** = add a `ToolProfile` to `TOOL_PROFILES`
(`{ id, label, range, cooldownMs, tipOffset, onUse(ctx) }`). `ctx` carries
`{ rapier, world, origin, direction, hit{collider, point, normal, distance}|null,
hitItem, heldItem }`. ⚠ ctx vectors are reused scratch — `.clone()` anything
you keep. README has a worked GravityTool example.

**New asset** = add a manifest entry:
`{ id, url, label?, profile?, grabbable?, targetable?, position?, rotation?,
scale?, gripPosition?, gripRotation?, colliders?, density?, onPrecisionHit? }`.
Tool GLBs should point −Z with grip at origin, else use the grip props (the
Duck needed `gripPosition [0,−0.35,−0.15]`, `gripRotation [0, π/2, 0]`).

**Other input sources (VR/touch/tests):** call the published verbs —
`useSandboxStore.getState().actions.{toggleGrab, grabItem(id), drop,
useHeldTool}`. For VR, register an XR controller grip group instead of the
camera child via `registerPlayer` and everything else just works.

## 8. How to verify changes headlessly (no pointer lock in embedded previews)

Dev builds expose the store as **`window.__sandbox`**. Proven recipe (used for
the original verification):

1. Start the dev server (`.claude/launch.json` config name: `sandbox`).
2. `__sandbox.getState()` → check `items`, `actions`, refs.
3. Teleport: `s.playerBodyRef.current.setTranslation({x,y,z}, true)` (camera
   follows next frame).
4. Grab: `s.actions.grabItem('driver-01')` → assert `bodyType() === 2`,
   `collider(0).isSensor() === true`, body translation ≈ hand world position
   (hand = `s.handSocketRef.current`, world pos = `matrixWorld.elements[12..14]`).
5. Aim: iterate ×4 → compute tool tip from hand matrixWorld
   (`tip = hand − e[8..10] × tipLen`), then
   `cam.lookAt(target − tip + cam.position)`, `cam.updateMatrixWorld(true)`.
6. Fire: `s.actions.useHeldTool()` → precision logs
   `Interacting with target: …` (console), kinetic scatters crates
   (screenshot). Drop → `bodyType() === 0`, toss ≈ 4.5 m/s.

Note: the embedded preview's console capture duplicates each entry ~6×
(harness artifact, not app behavior). `PointerLockControls: Unable to use
Pointer Lock API` errors are expected headlessly.

**Verified working (2026-06-12):** real-GLB ingestion (Khronos Avocado/Duck/
Box) incl. textures, both heuristic branches, grab/snap (error 0.0000),
Profile A callback + emissive flash, Profile B knockback, drop/throw,
404-fallback stand-ins, registry rejection of non-grabbables, HUD states.

## 9. Candidate next steps (not started)

- Load `ASSET_MANIFEST` from JSON/CMS at runtime (the type is already
  data-shaped); persistence/save-load of item transforms.
- Code-split three/rapier (single 3.4 MB chunk today); `useGLTF.preload`.
- Aim highlight on hover (needs per-instance material clone — materials are
  currently shared between GLB clones by design, don't mutate them).
- Hold-to-fire / automatic mode per profile; camera kick; sound hooks in
  `onUse`.
- WebXR: drei `<XR>` + controller grip registration (socket abstraction ready).
- More profiles: welder (joint creation), gravity gun (hold-at-distance via
  spring), spawner.
- CI: `npm run typecheck` + `npm run build` on push (no tests/workflows yet).
