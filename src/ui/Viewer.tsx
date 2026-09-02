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

/** One model placed in the scene. The viewer can show several at once. */
export interface ViewerInstance {
  readonly id: string;
  readonly parts: readonly GeneratedPart[];
  /** Offset in centimetres, applied before the scene scale. */
  readonly offsetX: number;
  /**
   * Replaces every part's own colour. Set when several models share the scene
   * and have to be told apart; left undefined for a single model, which keeps
   * its material colours.
   */
  readonly tint?: string;
  /** Multiplies each part's opacity. Below 1 in overlay mode. */
  readonly opacity: number;
}

export interface ViewerProps {
  readonly instances: readonly ViewerInstance[];
  /** Tallest model in centimetres, used to frame the camera. */
  readonly height: number;
  /** Total width of the arrangement in centimetres, also used for framing. */
  readonly width?: number;
  /** Recolour parts by the provenance of the parameters that shaped them. */
  readonly confidenceShading: boolean;
  /** Receives the scene root so the export buttons can serialise it. */
  readonly rootRef: RefObject<Group | null>;
}

function Parts({
  parts,
  confidenceShading,
  tint,
  opacityScale,
}: {
  parts: readonly GeneratedPart[];
  confidenceShading: boolean;
  tint: string | undefined;
  opacityScale: number;
}) {
  return (
    <>
      {parts.map((part) => {
        const opacity =
          Math.min(part.opacity, part.confidence === 'estimated' ? ESTIMATED_OPACITY : 1) *
          opacityScale;
        const translucent = opacity < 0.999;
        const color = confidenceShading
          ? PROVENANCE_COLORS[part.confidence]
          : (tint ?? part.color);
        return (
          <mesh
            key={part.id}
            geometry={part.geometry}
            castShadow={!translucent}
            receiveShadow={!translucent}
          >
            <meshStandardMaterial
              color={color}
              roughness={part.roughness}
              metalness={confidenceShading || tint !== undefined ? 0.05 : part.metalness}
              emissive={confidenceShading || tint !== undefined ? '#000000' : part.emissive}
              emissiveIntensity={
                confidenceShading || tint !== undefined ? 0 : part.emissiveIntensity
              }
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
 * Keeps the arrangement framed as it resizes: the orbit pivot tracks the
 * models' mid-height and the camera's distance scales with them, so a 15 cm
 * accent lamp and a row of three people both fill the same share of the
 * viewport. The view *direction* is left alone, so this never fights an orbit
 * the user is in the middle of.
 */
function FollowSize({ span, height }: { span: number; height: number }) {
  // Typed structurally rather than against three-stdlib, which is only a
  // transitive dependency of drei.
  const controls = useThree((state) => state.controls) as
    | { target: Vector3; update: () => void }
    | null;
  const camera = useThree((state) => state.camera);
  const previousSpan = useRef(span);

  useEffect(() => {
    if (controls === null) return;
    const ratio = previousSpan.current > 0 ? span / previousSpan.current : 1;
    previousSpan.current = span;

    const offset = camera.position.clone().sub(controls.target);
    controls.target.set(0, (height * SCENE_SCALE) / 2, 0);
    camera.position.copy(controls.target).add(offset.multiplyScalar(ratio));
    controls.update();
  }, [controls, camera, span, height]);

  return null;
}

export function Viewer({
  instances,
  height,
  width,
  confidenceShading,
  rootRef,
}: ViewerProps) {
  const metres = Math.max(height, 1) * SCENE_SCALE;
  // Frame on whichever of height or width needs more room, so a row of models
  // fits the viewport as readily as a single tall one.
  const spanMetres = Math.max(metres, ((width ?? 0) * SCENE_SCALE) / 1.6);
  // The Canvas `camera` prop only seeds the initial camera; from then on
  // FollowSize keeps the framing in step with the model.
  const initial = useRef(spanMetres);
  const d = initial.current;

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
        position={[spanMetres * 2, spanMetres * 3, spanMetres * 2]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-spanMetres * 2}
        shadow-camera-right={spanMetres * 2}
        shadow-camera-top={spanMetres * 2}
        shadow-camera-bottom={-spanMetres * 2}
        shadow-camera-far={spanMetres * 8}
        shadow-bias={-0.0005}
      />
      <directionalLight
        position={[-spanMetres * 2.5, spanMetres * 1.2, spanMetres]}
        intensity={0.55}
      />
      <directionalLight position={[0, spanMetres * 0.6, -spanMetres * 3]} intensity={0.8} />

      <group ref={rootRef} name="model" scale={SCENE_SCALE}>
        {instances.map((instance) => (
          <group key={instance.id} name={instance.id} position={[instance.offsetX, 0, 0]}>
            <Parts
              parts={instance.parts}
              confidenceShading={confidenceShading}
              tint={instance.tint}
              opacityScale={instance.opacity}
            />
          </group>
        ))}
      </group>

      <ContactShadows
        position={[0, 0.0005, 0]}
        opacity={0.5}
        scale={Math.max(spanMetres * 3, 0.5)}
        blur={2.4}
        far={spanMetres}
        resolution={1024}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
        <circleGeometry args={[Math.max(spanMetres * 2.5, 0.4), 96]} />
        <meshStandardMaterial color="#1a1d22" roughness={0.95} metalness={0} />
      </mesh>

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={spanMetres * 0.3}
        maxDistance={spanMetres * 10}
        maxPolarAngle={Math.PI / 2 - 0.03}
      />
      <FollowSize span={spanMetres} height={height} />
    </Canvas>
  );
}
