"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * The calibration rig, in three dimensions.
 *
 * Every piece is procedural geometry: cylinders for the links, spheres for the
 * joints, a torus for each calibration ring. No model is downloaded, so the
 * scene costs geometry the GPU builds in a frame and nothing over the network.
 *
 * The arm is built as a chain of nested groups, which is how a real kinematic
 * chain is described: the forearm is a child of the elbow, the elbow a child
 * of the shoulder. Rotating a parent carries its children, so the pose stays
 * physically coherent without any of it being computed twice.
 *
 * The motion is a data pulse travelling base → shoulder → elbow → wrist →
 * sensor frame. It is not actuation and the arm does not perform: the joints
 * hold a fixed calibration pose, and only the pulse and a very slight camera
 * drift move at all. MoveProof does not control anything.
 */

/** Where the pulse travels, in the order the workflow describes. */
const PATH = [
  new THREE.Vector3(0, 0.18, 0),
  new THREE.Vector3(0, 1.05, 0),
  new THREE.Vector3(1.15, 1.72, 0),
  new THREE.Vector3(2.05, 2.12, 0),
  new THREE.Vector3(2.62, 2.3, 0),
];

/** A local XYZ frame: the three axes a calibration record is expressed in. */
function CoordinateFrame({ size = 0.32 }: { size?: number }) {
  return (
    <group>
      {(
        [
          [new THREE.Vector3(size, 0, 0), "#b91c1c"],
          [new THREE.Vector3(0, size, 0), "#15803d"],
          [new THREE.Vector3(0, 0, size), "#3b82f6"],
        ] as const
      ).map(([end, color], index) => {
        const points = [new THREE.Vector3(0, 0, 0), end];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return (
          // eslint-disable-next-line react/no-unknown-property
          <primitive
            key={index}
            object={new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }))}
          />
        );
      })}
    </group>
  );
}

/** One joint: a sphere, its axis frame, and the arc it is calibrated over. */
function Joint({
  radius,
  ring,
  animate = false,
  phase = 0,
}: {
  radius: number;
  ring?: number;
  animate?: boolean;
  phase?: number;
}) {
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!animate || !ringRef.current) return;
    // A slow sweep of the calibration arc. The joint itself never moves.
    ringRef.current.rotation.z = clock.getElapsedTime() * 0.12 + phase;
  });

  return (
    <group>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[radius, 32, 32]} />
        <meshStandardMaterial color="#1e293b" metalness={0.55} roughness={0.35} />
      </mesh>
      {ring !== undefined && (
        <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[ring, 0.012, 12, 64, Math.PI * 1.35]} />
          <meshBasicMaterial color="#3b82f6" transparent opacity={0.55} />
        </mesh>
      )}
      <CoordinateFrame size={radius * 2.6} />
    </group>
  );
}

/** A box-section link with real depth, drawn between two joints. */
function Link({
  length,
  radius = 0.1,
}: {
  length: number;
  radius?: number;
}) {
  return (
    <mesh position={[length / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[radius, radius * 0.86, length, 24]} />
      <meshStandardMaterial color="#334155" metalness={0.45} roughness={0.42} />
    </mesh>
  );
}

function Pulse() {
  const ref = useRef<THREE.Mesh>(null);
  const curve = useMemo(() => new THREE.CatmullRomCurve3(PATH), []);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.getElapsedTime() % 6) / 6;
    const point = curve.getPoint(t);
    ref.current.position.copy(point);
    // Brightest in the middle of the run, so it reads as travelling rather
    // than blinking in place.
    const material = ref.current.material as THREE.MeshBasicMaterial;
    material.opacity = 0.35 + Math.sin(t * Math.PI) * 0.5;
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.085, 20, 20]} />
      <meshBasicMaterial color="#60a5fa" transparent opacity={0.6} />
    </mesh>
  );
}

/**
 * How far the whole rig may turn, in radians.
 *
 * About 8 degrees of yaw and 3.5 of pitch: enough to reveal that the links and
 * joints are solids rather than a drawing, nowhere near enough to orbit the
 * scene or show its back. Module constants, so nothing is allocated per frame.
 */
const MAX_YAW = 0.14;
const MAX_PITCH = 0.06;
/** Per-frame approach rate. Low enough that the rig trails the pointer. */
const DAMPING = 0.045;

function Rig({ animate }: { animate: boolean }) {
  const group = useRef<THREE.Group>(null);

  useFrame(({ clock, pointer }) => {
    if (!animate || !group.current) return;

    // The idle drift still runs underneath, so a still pointer never freezes
    // the scene into a photograph.
    const idle = Math.sin(clock.getElapsedTime() * 0.18) * 0.09;

    // R3F's own normalised pointer, which is already relative to the canvas:
    // no document listener, and nothing happens while the cursor is elsewhere
    // on the page. It rests at 0,0, so leaving the canvas settles the rig back
    // toward neutral through the same damping rather than snapping.
    const targetYaw = idle + pointer.x * MAX_YAW;
    const targetPitch = -pointer.y * MAX_PITCH;

    // Lerp toward the target instead of assigning it. The rig follows the
    // cursor a beat late, which is what makes it read as inspecting a solid
    // object rather than tracking a mouse.
    group.current.rotation.y = THREE.MathUtils.lerp(
      group.current.rotation.y,
      targetYaw,
      DAMPING
    );
    group.current.rotation.x = THREE.MathUtils.lerp(
      group.current.rotation.x,
      targetPitch,
      DAMPING
    );
  });

  return (
    <group ref={group} position={[-1.1, -1.25, 0]}>
      {/* Pedestal */}
      <mesh position={[0, 0.09, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.52, 0.62, 0.18, 40]} />
        <meshStandardMaterial color="#172554" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.58, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.24, 0.8, 28]} />
        <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.38} />
      </mesh>

      {/* Shoulder → upper arm → elbow → forearm → wrist → sensor frame.
          Nested groups, so the chain stays coherent. */}
      <group position={[0, 1.05, 0]}>
        <Joint radius={0.2} ring={0.34} animate={animate} phase={0} />
        <group rotation={[0, 0, Math.PI / 5.2]}>
          <Link length={1.33} radius={0.12} />
          <group position={[1.33, 0, 0]}>
            <Joint radius={0.16} ring={0.28} animate={animate} phase={1.1} />
            <group rotation={[0, 0, -Math.PI / 7.5]}>
              <Link length={0.99} radius={0.095} />
              <group position={[0.99, 0, 0]}>
                <Joint radius={0.12} ring={0.21} animate={animate} phase={2.2} />
                <group rotation={[0, 0, Math.PI / 12]}>
                  <Link length={0.42} radius={0.06} />
                  {/* End effector: the sensor frame the record names. */}
                  <group position={[0.52, 0, 0]}>
                    <mesh castShadow>
                      <boxGeometry args={[0.26, 0.26, 0.26]} />
                      <meshStandardMaterial
                        color="#3b82f6"
                        metalness={0.3}
                        roughness={0.3}
                        transparent
                        opacity={0.85}
                      />
                    </mesh>
                    <CoordinateFrame size={0.42} />
                  </group>
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>

      {animate && <Pulse />}
    </group>
  );
}

export default function CalibrationRig3D({
  animate,
  onReady,
}: {
  animate: boolean;
  /** Fired once the context exists, so the wrapper can fade this in. */
  onReady?: () => void;
}) {
  return (
    <Canvas
      // Capped device pixel ratio: this is a decorative scene and has no
      // business rendering at 3x on a phone.
      dpr={[1, 1.5]}
      shadows
      camera={{ position: [3.6, 2.4, 5.4], fov: 38 }}
      // Stops the render loop when nothing needs redrawing, which is most of
      // the time when motion is off.
      frameloop={animate ? "always" : "demand"}
      gl={{ antialias: true, powerPreference: "low-power" }}
      onCreated={() => onReady?.()}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#00000000"]} />
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[4, 6, 3]}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-4, 2, -3]} intensity={0.35} />

      {/* Measurement floor. The grid is the same device as the SVG rig. */}
      <gridHelper
        args={[16, 32, "#94a3b8", "#cbd5e1"]}
        position={[0, -1.3, 0]}
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -1.31, 0]}
        receiveShadow
      >
        <planeGeometry args={[16, 16]} />
        <shadowMaterial opacity={0.18} />
      </mesh>

      <Rig animate={animate} />
    </Canvas>
  );
}
