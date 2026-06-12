import { Component, Suspense, useEffect, useId, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useGLTF } from '@react-three/drei';
import {
  ConvexHullCollider,
  CuboidCollider,
  RigidBody,
  type RapierRigidBody,
} from '@react-three/rapier';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  computeAutoColliders,
  type AutoColliderSpec,
} from '../systems/computeAutoColliders';
import { useSandboxStore, type PrecisionHitEvent } from '../state/useSandboxStore';

export interface InteractableAssetProps {
  /** URL of a .glb/.gltf file (same-origin or CORS-enabled). */
  url: string;
  /** Stable id; auto-generated when omitted. Set it if anything references the item. */
  id?: string;
  label?: string;
  /** Tool profile granted while held: 'precision' | 'kinetic' | any registered id. */
  profile?: string;
  /** Can be picked up with [E]. Default true. */
  grabbable?: boolean;
  /** Valid target for the precision tool. Default false. */
  targetable?: boolean;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Uniform render scale; baked into the generated colliders. */
  scale?: number;
  /** Hand-socket-relative pose while held (fixes GLBs whose origin isn't the grip). */
  gripPosition?: [number, number, number];
  gripRotation?: [number, number, number];
  /** Collider generation: 'auto' (heuristic per mesh), or force one shape. */
  colliders?: 'auto' | 'cuboid' | 'hull';
  /** Collider density in kg/m³-equivalent units; drives the body's mass. */
  density?: number;
  onPrecisionHit?: (event: PrecisionHitEvent) => void;
}

type ResolvedAssetProps = Required<
  Pick<
    InteractableAssetProps,
    'url' | 'label' | 'grabbable' | 'targetable' | 'position' | 'rotation' | 'scale' | 'gripPosition' | 'gripRotation' | 'colliders' | 'density'
  >
> &
  Pick<InteractableAssetProps, 'profile' | 'onPrecisionHit'> & { itemId: string };

/**
 * Zero-code ingestion point: give it a GLB url and a tool profile name, get a
 * fully physical, grabbable, usable object. Pipeline:
 *
 *   useGLTF -> SkeletonUtils.clone -> computeAutoColliders (cuboid/hull per
 *   mesh) -> compound <RigidBody> -> store registration (grab/use/target).
 *
 * If the GLB fails to load, an equivalent primitive stand-in mounts with the
 * same physics and registration, so a missing asset never breaks the sandbox.
 */
export function InteractableAsset(props: InteractableAssetProps) {
  const generatedId = useId();
  const resolved: ResolvedAssetProps = {
    itemId: props.id ?? `item-${generatedId}`,
    url: props.url,
    label: props.label ?? (props.url.split('/').pop() ?? 'Item'),
    profile: props.profile,
    grabbable: props.grabbable ?? true,
    targetable: props.targetable ?? false,
    position: props.position ?? [0, 0, 0],
    rotation: props.rotation ?? [0, 0, 0],
    scale: props.scale ?? 1,
    gripPosition: props.gripPosition ?? [0, 0, 0],
    gripRotation: props.gripRotation ?? [0, 0, 0],
    colliders: props.colliders ?? 'auto',
    density: props.density ?? 50,
    onPrecisionHit: props.onPrecisionHit,
  };

  return (
    <AssetErrorBoundary url={resolved.url} fallback={<FallbackItem {...resolved} />}>
      <Suspense fallback={null}>
        <GLBItem {...resolved} />
      </Suspense>
    </AssetErrorBoundary>
  );
}

/** The real path: dynamic GLB ingestion + mesh analysis. */
function GLBItem(props: ResolvedAssetProps) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const { scene } = useGLTF(props.url);

  // Clone so one GLB can be instantiated many times; SkeletonUtils keeps
  // skinned meshes valid. Materials stay shared between clones by design.
  const model = useMemo(() => {
    const cloned = cloneSkeleton(scene);
    cloned.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    return cloned;
  }, [scene]);

  const specs = useMemo(
    () =>
      computeAutoColliders(model, {
        scale: props.scale,
        forceShape: props.colliders === 'auto' ? undefined : props.colliders,
      }),
    [model, props.scale, props.colliders],
  );

  useItemRegistration(props, bodyRef);

  return (
    <InteractableBody props={props} bodyRef={bodyRef} specs={specs}>
      <group scale={props.scale}>
        <primitive object={model} />
      </group>
    </InteractableBody>
  );
}

/** Stand-in mounted by the error boundary when a GLB url 404s or fails to parse. */
function FallbackItem(props: ResolvedAssetProps) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const specs = useMemo<AutoColliderSpec[]>(
    () => [
      {
        kind: 'cuboid',
        halfExtents: [0.22 * props.scale, 0.07 * props.scale, 0.07 * props.scale],
        center: [0, 0, 0],
      },
    ],
    [props.scale],
  );

  useItemRegistration(props, bodyRef);

  const color =
    props.profile === 'precision' ? '#22d3ee' : props.profile === 'kinetic' ? '#fbbf24' : '#94a3b8';

  return (
    <InteractableBody props={props} bodyRef={bodyRef} specs={specs}>
      <mesh castShadow receiveShadow scale={props.scale}>
        <boxGeometry args={[0.44, 0.14, 0.14]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.4} />
      </mesh>
      <mesh castShadow position={[0, 0, -0.22 * props.scale]} scale={props.scale}>
        <cylinderGeometry args={[0.025, 0.045, 0.16, 12]} />
        <meshStandardMaterial color="#1e293b" roughness={0.5} />
      </mesh>
    </InteractableBody>
  );
}

/**
 * Shared physical shell: a compound RigidBody carrying the analyzed colliders,
 * tagged with the item id so raycast hits resolve back to the registry.
 */
function InteractableBody({
  props,
  bodyRef,
  specs,
  children,
}: {
  props: ResolvedAssetProps;
  bodyRef: RefObject<RapierRigidBody | null>;
  specs: AutoColliderSpec[];
  children: ReactNode;
}) {
  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      position={props.position}
      rotation={props.rotation}
      userData={{ itemId: props.itemId }}
      ccd
    >
      {specs.map((spec, index) =>
        spec.kind === 'cuboid' ? (
          <CuboidCollider
            key={index}
            args={spec.halfExtents}
            position={spec.center}
            density={props.density}
          />
        ) : (
          <ConvexHullCollider key={index} args={[spec.points]} density={props.density} />
        ),
      )}
      {children}
    </RigidBody>
  );
}

/** Registers the item in the sandbox store for grab/use/target resolution. */
function useItemRegistration(props: ResolvedAssetProps, bodyRef: RefObject<RapierRigidBody | null>) {
  const registerItem = useSandboxStore((state) => state.registerItem);
  const unregisterItem = useSandboxStore((state) => state.unregisterItem);
  const { itemId, label, profile, grabbable, targetable, onPrecisionHit } = props;
  const [gripX, gripY, gripZ] = props.gripPosition;
  const [gripRotX, gripRotY, gripRotZ] = props.gripRotation;

  useEffect(() => {
    registerItem({
      id: itemId,
      label,
      bodyRef,
      profileId: profile ?? null,
      grabbable,
      targetable,
      gripPosition: new THREE.Vector3(gripX, gripY, gripZ),
      gripQuaternion: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(gripRotX, gripRotY, gripRotZ),
      ),
      onPrecisionHit,
    });
    return () => unregisterItem(itemId);
  }, [
    itemId,
    label,
    profile,
    grabbable,
    targetable,
    gripX,
    gripY,
    gripZ,
    gripRotX,
    gripRotY,
    gripRotZ,
    onPrecisionHit,
    bodyRef,
    registerItem,
    unregisterItem,
  ]);
}

/**
 * Minimal error boundary so one bad asset degrades to its stand-in instead of
 * blanking the canvas. useGLTF caches the rejection, so no retry loop.
 */
class AssetErrorBoundary extends Component<
  { url: string; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn(
      `[sandbox] Failed to load "${this.props.url}" — mounting primitive stand-in.`,
      error,
    );
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
