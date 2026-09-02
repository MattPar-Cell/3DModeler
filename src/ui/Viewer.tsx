import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { DoubleSide, FrontSide, Group, Vector3 } from 'three';
import type { GeneratedPart } from '../templates/types.ts';
import type { Provenance } from '../core/params.ts';

/**
 * Live viewer for a generated model.
 *
 * The scene graph is authored in centimetres inside a group scaled by
 * {@link SCENE_SCALE}, so the world — and therefore every export — is in
 * metres. The same group is handed to the exporters, which is why what you see
 * is exactly what you download.
 */

/** Centimetres to metres. Applied to the model root, not to the geometry. */
export const SCENE_SCALE = 0.01;

/** Colours used when confidence shading is on. Must match the CSS legend. */
export const PROVENANCE_COLORS: Record<Provenance, string> = {
  measured: '#6ee7a8',
  derived: '#7fb2ff',
  estimated: '#d8a34a',
};

/**
 * Opacity applied to parts shaped only by priors, per the confidence UX rule.
 * Drawn double-sided at this value, an estimated region reads as a ghost of
 * itself — present, but visibly less certain than the parts around it.
 */
const ESTIMATED_OPACITY = 0.34;

export interface ViewerProps {
  readonly parts: readonly GeneratedPart[];
  /** Model height in centimetres, used to frame the camera. */
  readonly height: number;
  /** Recolour parts by the provenance of the parameters that shaped them. */
  readonly confidenceShading: boolean;
  /** Receives the model root so the export buttons can serialise it. */
  readonly rootRef: RefObject<Group | null>;
}

function Parts({ parts, confidenceShading }: { parts: readonly GeneratedPart[]; confidenceShading: boolean }) {
  return (
    <>
      {parts.map((part) => {
        const translucent = part.confidence === 'estimated' || part.opacity < 1;
        const opacity = Math.min(
          part.opacity,
          part.confidence === 'estimated' ? ESTIMATED_OPACITY : 1,
        );
        return (
          <mesh
            key={part.id}
            geometry={part.geometry}
            castShadow={!translucent}
            receiveShadow={!translucent}
          >
            <meshStandardMaterial
              color={confidenceShading ? PROVENANCE_COLORS[part.confidence] : part.color}
              roughness={part.roughness}
              metalness={confidenceShading ? 0.05 : part.metalness}
              emissive={confidenceShading ? '#000000' : part.emissive}
              emissiveIntensity={confidenceShading ? 0 : part.emissiveIntensity}
              transparent={translucent}
              opacity={opacity}
              depthWrite={!translucent}
              // A translucent region is drawn double-sided so its far wall shows
              // through: single-sided it reads as a hole cut in the body rather
              // than as a volume the app is less sure about.
              side={part.doubleSided || translucent ? DoubleSide : FrontSide}
            />
          </mesh>
        );
      })}
    </>
  );
}

/**
 * Keeps the model framed as it resizes: the orbit pivot tracks mid-height and
 * the camera's distance scales with the model, so a 15 cm accent lamp and a
 * 2 m floor lamp both fill the same share of the viewport. The view *direction*
 * is left alone, so this never fights an orbit the user is in the middle of.
 */
function FollowHeight({ height }: { height: number }) {
  // Typed structurally rather than against three-stdlib, which is only a
  // transitive dependency of drei.
  const controls = useThree((state) => state.controls) as
    | { target: Vector3; update: () => void }
    | null;
  const camera = useThree((state) => state.camera);
  const previousHeight = useRef(height);

  useEffect(() => {
    if (controls === null) return;
    const ratio = previousHeight.current > 0 ? height / previousHeight.current : 1;
    previousHeight.current = height;

    const offset = camera.position.clone().sub(controls.target);
    controls.target.set(0, (height * SCENE_SCALE) / 2, 0);
    camera.position.copy(controls.target).add(offset.multiplyScalar(ratio));
    controls.update();
  }, [controls, camera, height]);

  return null;
}

export function Viewer({ parts, height, confidenceShading, rootRef }: ViewerProps) {
  const metres = height * SCENE_SCALE;
  // The Canvas `camera` prop only seeds the initial camera; from then on
  // FollowHeight keeps the framing in step with the model.
  const initialMetres = useRef(metres);
  const d = initialMetres.current;

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [d * 1.15, d * 0.95, d * 1.75], fov: 35, near: 0.01, far: 100 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#14161a']} />

      {/* Clean matte studio lighting: key, fill, rim, and a soft ambient. */}
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[metres * 2, metres * 3, metres * 2]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-metres * 2}
        shadow-camera-right={metres * 2}
        shadow-camera-top={metres * 2}
        shadow-camera-bottom={-metres * 2}
        shadow-camera-far={metres * 8}
        shadow-bias={-0.0005}
      />
      <directionalLight position={[-metres * 2.5, metres * 1.2, metres]} intensity={0.55} />
      <directionalLight position={[0, metres * 0.6, -metres * 3]} intensity={0.8} />

      <group ref={rootRef} name="model" scale={SCENE_SCALE}>
        <Parts parts={parts} confidenceShading={confidenceShading} />
      </group>

      <ContactShadows
        position={[0, 0.0005, 0]}
        opacity={0.5}
        scale={Math.max(metres * 3, 0.5)}
        blur={2.4}
        far={metres}
        resolution={1024}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
        <circleGeometry args={[Math.max(metres * 2.5, 0.4), 64]} />
        <meshStandardMaterial color="#1a1d22" roughness={0.95} metalness={0} />
      </mesh>

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={metres * 0.3}
        maxDistance={metres * 10}
        maxPolarAngle={Math.PI / 2 - 0.03}
      />
      <FollowHeight height={height} />
    </Canvas>
  );
}
