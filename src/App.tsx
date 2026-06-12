import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { KeyboardControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { KEYBOARD_MAP } from './controls';
import { Player } from './components/Player';
import { Level } from './components/Level';
import { InteractableAsset, type InteractableAssetProps } from './components/InteractableAsset';
import { InteractionSystem } from './systems/InteractionSystem';
import { ImpactParticles } from './systems/ImpactParticles';
import { Hud } from './ui/Hud';

/**
 * The zero-code surface. This array is the entire content definition — it
 * could equally be fetched from JSON or a CMS. Drop matching .glb files into
 * /public/models; until then each entry mounts a primitive stand-in with
 * identical physics and mechanics.
 */
const ASSET_MANIFEST: InteractableAssetProps[] = [
  {
    id: 'scanner-01',
    url: '/models/precision_tool.glb',
    label: 'Precision Scanner',
    profile: 'precision',
    position: [-1.2, 1.5, 2.5],
    scale: 6, // Khronos Avocado sample is ~6 cm tall
  },
  {
    id: 'driver-01',
    url: '/models/kinetic_tool.glb',
    label: 'Kinetic Driver',
    profile: 'kinetic',
    position: [1.2, 1.5, 2.5],
    scale: 0.35, // Khronos Duck sample is ~1.6 m tall
    gripPosition: [0, -0.35, -0.15], // origin is at the feet — hold lower and ahead
    gripRotation: [0, Math.PI / 2, 0], // beak forward (model faces +X)
  },
  {
    id: 'sample-prop-01',
    url: '/models/prop_crate.glb',
    label: 'Sample Prop',
    targetable: true, // precision tool recognizes it; still grabbable & throwable
    position: [0, 1.5, 0.5],
    scale: 0.45,
  },
];

export default function App() {
  return (
    <KeyboardControls map={KEYBOARD_MAP}>
      <div style={{ position: 'fixed', inset: 0 }}>
        <Canvas shadows dpr={[1, 2]}>
          <color attach="background" args={['#11151c']} />
          <fog attach="fog" args={['#11151c', 30, 70]} />
          <Suspense fallback={null}>
            <Physics gravity={[0, -9.81, 0]}>
              <Level />
              <Player position={[0, 1.4, 7]} />
              <InteractionSystem />
              {ASSET_MANIFEST.map((asset) => (
                <InteractableAsset key={asset.id} {...asset} />
              ))}
            </Physics>
            <ImpactParticles />
          </Suspense>
        </Canvas>
        <Hud />
      </div>
    </KeyboardControls>
  );
}
