"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

/**
 * The calibration rig, in three dimensions.
 *
 * Every piece is procedural geometry, so nothing is downloaded: capsules for
 * the links, hub cylinders for the joints, tori for the calibration rings and
 * additive sprites for the glow. The arm is a chain of nested groups, the way a
 * kinematic chain is described, so the pose stays mechanically coherent.
 *
 * Motion, all of it illustrative:
 *
 *   viewing angle      follows the pointer inside the panel through a damped
 *                      spring, so small movements read immediately and the
 *                      scene settles back to neutral when the pointer leaves
 *   idle articulation  a few degrees of coordinated shoulder, elbow and wrist
 *                      movement, so the rig reads as a solid engineering model
 *                      rather than a still. It is a visualisation of the
 *                      record's subject, not a control signal: MoveProof
 *                      verifies calibration records and drives no hardware.
 *   data pulses        travel base → shoulder → elbow → wrist → sensor frame,
 *                      following the joints as they move
 *   workflow stages    each stage pill has its own restrained response. None
 *                      of them is a result; the scene never reports a check.
 *
 * Every per-frame value lives in refs and is mutated inside useFrame, so the
 * animation causes no React re-renders.
 */

const BLUE = new THREE.Color("#60a5fa");
const GREEN = new THREE.Color("#34d399");

/** Set to false to hold the arm in one fixed calibration pose. */
const IDLE_ARTICULATION = true;

/** Viewing-angle limits: about ±30° of yaw and ±8° of pitch. */
const MAX_YAW = 0.52;
const MAX_PITCH = 0.14;
const REST_YAW = -0.22;
const REST_PITCH = 0.04;
/** Pointer gain: full deflection at ~65% of the way to the panel edge. */
const POINTER_GAIN = 1.55;
/** Spring for the viewing angle: stiffness and damping per second. */
const SPRING_K = 38;
const SPRING_D = 9;

/** Base joint angles, radians, in the order shoulder, elbow, wrist. */
const POSE = [Math.PI / 4.4, -Math.PI / 3.4, -Math.PI / 5] as const;
/** Idle articulation amplitude per joint: roughly 2.6°, 3.4° and 5°. */
const IDLE_AMP = [0.045, 0.06, 0.09] as const;

/**
 * One restrained response per workflow stage, in the pill order. Values are
 * targets the scene eases toward; nothing here is a measurement.
 *
 *   speed     pulse travel, loops per second
 *   platform  calibration platform glow
 *   halo      calibration ring sweep rate multiplier
 *   joints    emphasis for J1, J2, J3 and the sensor frame
 *   scan      a verification sweep rising along the arm
 */
const STAGE_FX = [
  // Calibration uploaded: records enter at the platform.
  { speed: 0.08, platform: 1, halo: 1, joints: [0.15, 0.15, 0.15, 0.1], scan: 0 },
  // AI proposal: the rings sweep faster while a plan is drafted.
  { speed: 0.14, platform: 0.3, halo: 2.2, joints: [0.45, 0.45, 0.45, 0.3], scan: 0 },
  // Human decision: the flow slows and the elbow record is emphasised.
  { speed: 0.035, platform: 0.2, halo: 0.6, joints: [0.1, 1, 0.1, 0.1], scan: 0 },
  // Deterministic execution: a steady, even flow.
  { speed: 0.24, platform: 0.35, halo: 1.2, joints: [0.35, 0.35, 0.35, 0.35], scan: 0 },
  // Independent verification: one sweep rises along the arm.
  { speed: 0.12, platform: 0.4, halo: 1, joints: [0.3, 0.3, 0.3, 0.3], scan: 1 },
  // Evidence: the sensor frame, end of the record, is emphasised.
  { speed: 0.1, platform: 0.4, halo: 0.8, joints: [0.15, 0.15, 0.15, 1], scan: 0 },
  // Committed: everything settles.
  { speed: 0.06, platform: 1, halo: 0.5, joints: [0.1, 0.1, 0.1, 0.1], scan: 0 },
] as const;

/* ------------------------------------------------------------------ */
/* Shared state                                                        */
/* ------------------------------------------------------------------ */

type Live = {
  /** 0 at rest, 1 while the pointer is over the rig. Smoothed. */
  hover: number;
  /** 0 = blue, 1 = verified green. Smoothed. */
  verified: number;
  /** Current workflow stage index. */
  stage: number;
  /** Smoothed stage responses. */
  speed: number;
  platform: number;
  halo: number;
  joints: [number, number, number, number];
};

/** A soft radial glow, drawn once on a canvas and reused by every sprite. */
function useGlowTexture() {
  return useMemo(() => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.25, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
}

/* ------------------------------------------------------------------ */
/* Parts                                                               */
/* ------------------------------------------------------------------ */

function metal(color: string, roughness = 0.32) {
  return (
    <meshPhysicalMaterial
      color={color}
      metalness={0.85}
      roughness={roughness}
      clearcoat={0.6}
      clearcoatRoughness={0.25}
    />
  );
}

/** A local XYZ frame: the three axes a calibration record is expressed in. */
function CoordinateFrame({ size = 0.32 }: { size?: number }) {
  const lines = useMemo(
    () =>
      (
        [
          [new THREE.Vector3(size, 0, 0), "#60a5fa"],
          [new THREE.Vector3(0, size, 0), "#34d399"],
          [new THREE.Vector3(0, 0, size), "#f472b6"],
        ] as const
      ).map(([end, color]) => {
        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), end]);
        return new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })
        );
      }),
    [size]
  );
  return (
    <group>
      {lines.map((line, index) => (
        // eslint-disable-next-line react/no-unknown-property
        <primitive key={index} object={line} />
      ))}
    </group>
  );
}

/** Padding, in pixels, a pin keeps from the record card and the caption. */
const PIN_CLEARANCE = 6;

/** A small DOM pin that names a joint. Hidden on narrow screens. */
function Pin({
  label,
  live,
  index,
}: {
  label: string;
  live: MutableRefObject<Live>;
  index: number;
}) {
  const dot = useRef<HTMLSpanElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const frame = useRef(0);

  useFrame(() => {
    const state = live.current;
    if (dot.current) {
      dot.current.style.backgroundColor = state.verified > 0.5 ? "#34d399" : "#60a5fa";
      const glow = state.joints[index];
      dot.current.style.boxShadow =
        glow > 0.6 ? `0 0 0 3px rgba(96,165,250,${0.25 * glow}), 0 0 10px rgba(96,165,250,${0.8 * glow})` : "none";
    }
    // The scene turns with the pointer, so a pin can drift under the record
    // card or the caption. Every few frames, check for overlap and step the
    // pin aside (fade and shrink) instead of letting text collide.
    frame.current = (frame.current + 1) % 6;
    const el = pill.current;
    if (frame.current !== 0 || !el) return;
    const root = el.closest("[data-rig-root]");
    if (!root) return;
    const a = el.getBoundingClientRect();
    let hit = false;
    root.querySelectorAll("[data-rig-avoid]").forEach((node) => {
      const b = node.getBoundingClientRect();
      if (b.width === 0) return;
      if (
        a.left < b.right + PIN_CLEARANCE &&
        a.right > b.left - PIN_CLEARANCE &&
        a.top < b.bottom + PIN_CLEARANCE &&
        a.bottom > b.top - PIN_CLEARANCE
      ) {
        hit = true;
      }
    });
    el.style.opacity = hit ? "0" : "1";
    el.style.transform = hit ? "scale(0.92)" : "none";
  });

  return (
    <Html center zIndexRange={[20, 0]} wrapperClass="hidden md:block" style={{ pointerEvents: "none" }}>
      <span
        ref={pill}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/15 bg-[#080d1a]/80 px-2 py-0.5 font-mono text-[9.5px] text-[#cbd5e1] backdrop-blur transition-[opacity,transform] duration-300"
      >
        <span ref={dot} className="h-1.5 w-1.5 rounded-full transition-shadow duration-300" />
        {label}
      </span>
    </Html>
  );
}

/** One joint: a hub on its rotation axis, a lit ring, a halo and a frame. */
function Joint({
  index,
  radius,
  depth,
  phase,
  live,
  glow,
  label,
  labelOffset,
}: {
  index: number;
  radius: number;
  depth: number;
  phase: number;
  live: MutableRefObject<Live>;
  glow: THREE.Texture;
  label: string;
  labelOffset: [number, number, number];
}) {
  const halo = useRef<THREE.Group>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const haloMat = useRef<THREE.MeshBasicMaterial>(null);
  const haloMat2 = useRef<THREE.MeshBasicMaterial>(null);
  const sprite = useRef<THREE.SpriteMaterial>(null);
  const spriteObj = useRef<THREE.Sprite>(null);
  const tint = useMemo(() => new THREE.Color(), []);
  const sweep = useRef(phase);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    const { hover, verified, halo: haloRate, joints } = live.current;
    const emphasis = joints[index];
    tint.copy(BLUE).lerp(GREEN, verified);

    // Integrate the sweep so a rate change never makes the ring jump.
    sweep.current += delta * (0.35 + hover * 0.5) * haloRate;
    if (halo.current) halo.current.rotation.z = sweep.current;

    if (ringMat.current) ringMat.current.color.copy(tint).multiplyScalar(1 + emphasis * 0.6);
    if (haloMat.current) {
      haloMat.current.color.copy(tint);
      haloMat.current.opacity = 0.4 + hover * 0.3 + emphasis * 0.3;
    }
    if (haloMat2.current) {
      haloMat2.current.color.copy(tint);
      haloMat2.current.opacity = 0.2 + hover * 0.25 + emphasis * 0.3;
    }
    if (sprite.current && spriteObj.current) {
      sprite.current.color.copy(tint);
      sprite.current.opacity =
        0.3 + hover * 0.3 + emphasis * 0.4 + Math.sin(t * 1.6 + phase) * 0.06;
      const s = radius * (3 + emphasis * 1.4);
      spriteObj.current.scale.set(s, s, 1);
    }
  });

  return (
    <group>
      {/* Hub, its axis along z, facing the camera. */}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[radius, radius, depth, 48]} />
        {metal("#2f3d5c", 0.28)}
      </mesh>
      <mesh position={[0, 0, depth / 2 + 0.002]}>
        <circleGeometry args={[radius * 0.62, 40]} />
        {metal("#1a2438", 0.4)}
      </mesh>
      <mesh position={[0, 0, depth / 2 + 0.006]}>
        <torusGeometry args={[radius * 0.72, radius * 0.045, 12, 64]} />
        <meshBasicMaterial ref={ringMat} color={BLUE} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, depth / 2 + 0.01]}>
        <circleGeometry args={[radius * 0.2, 24]} />
        <meshBasicMaterial color="#dbeafe" toneMapped={false} />
      </mesh>

      {/* Calibration halo: two counter-swept arcs. */}
      <group ref={halo}>
        <mesh>
          <torusGeometry args={[radius * 1.45, 0.008, 8, 96, Math.PI * 1.3]} />
          <meshBasicMaterial ref={haloMat} color={BLUE} transparent toneMapped={false} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI * 1.45]}>
          <torusGeometry args={[radius * 1.62, 0.005, 8, 96, Math.PI * 0.55]} />
          <meshBasicMaterial ref={haloMat2} color={BLUE} transparent toneMapped={false} />
        </mesh>
      </group>

      <sprite ref={spriteObj} scale={[radius * 3, radius * 3, 1]} position={[0, 0, depth / 2 + 0.02]}>
        <spriteMaterial
          ref={sprite}
          map={glow}
          color={BLUE}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      <CoordinateFrame size={radius * 2.4} />

      <group position={labelOffset}>
        <Pin label={label} live={live} index={index} />
      </group>
    </group>
  );
}

/** A rounded industrial link with a lit accent strip along its top. */
function Link({ length, radius }: { length: number; radius: number }) {
  return (
    <group>
      <mesh position={[length / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <capsuleGeometry args={[radius, length, 10, 28]} />
        {metal("#34446a", 0.3)}
      </mesh>
      <mesh position={[length / 2, radius * 0.86, 0]}>
        <boxGeometry args={[length * 0.62, radius * 0.08, radius * 0.5]} />
        <meshBasicMaterial color="#93c5fd" transparent opacity={0.55} toneMapped={false} />
      </mesh>
      <mesh position={[length / 2, 0, radius * 0.93]}>
        <boxGeometry args={[length * 0.48, radius * 0.42, 0.01]} />
        <meshStandardMaterial color="#0b1222" metalness={0.4} roughness={0.6} />
      </mesh>
    </group>
  );
}

/**
 * Data pulses with short comet trails. The route is rebuilt every frame from
 * the joints' live positions, so pulses stay on the arm while it articulates.
 */
function Pulses({
  live,
  glow,
  anchors,
  space,
}: {
  live: MutableRefObject<Live>;
  glow: THREE.Texture;
  anchors: MutableRefObject<(THREE.Object3D | null)[]>;
  space: MutableRefObject<THREE.Group | null>;
}) {
  const COUNT = 4;
  const TRAIL = 6;
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const tint = useMemo(() => new THREE.Color(), []);
  const points = useMemo(() => Array.from({ length: 5 }, () => new THREE.Vector3()), []);
  const lengths = useMemo(() => new Float32Array(5), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const progress = useRef(0);

  useFrame((_, delta) => {
    const state = live.current;
    const frame = space.current;
    if (!frame) return;

    // Current route, in the pulses' own space.
    let total = 0;
    for (let i = 0; i < 5; i++) {
      const anchor = anchors.current[i];
      if (!anchor) return;
      anchor.getWorldPosition(points[i]);
      frame.worldToLocal(points[i]);
      if (i > 0) total += points[i].distanceTo(points[i - 1]);
      lengths[i] = total;
    }

    progress.current += delta * (state.speed + state.hover * 0.06);
    tint.copy(BLUE).lerp(GREEN, state.verified);

    for (let p = 0; p < COUNT; p++) {
      for (let s = 0; s < TRAIL; s++) {
        const sprite = sprites.current[p * TRAIL + s];
        if (!sprite) continue;
        const t = (progress.current + p / COUNT - s * 0.012 + 10) % 1;

        // Walk the polyline by arc length.
        const target = t * total;
        let seg = 1;
        while (seg < 4 && lengths[seg] < target) seg++;
        const span = lengths[seg] - lengths[seg - 1] || 1;
        const u = (target - lengths[seg - 1]) / span;
        scratch.copy(points[seg - 1]).lerp(points[seg], u);
        sprite.position.copy(scratch);

        const material = sprite.material as THREE.SpriteMaterial;
        const fade = Math.sin(t * Math.PI);
        material.opacity = fade * (1 - s / TRAIL) * 0.9;
        material.color.copy(tint);
        const scale = (0.32 - s * 0.035) * (0.8 + fade * 0.4);
        sprite.scale.set(scale, scale, 1);
      }
    }
  });

  return (
    <group>
      {Array.from({ length: COUNT * TRAIL }).map((_, index) => (
        <sprite
          key={index}
          ref={(el) => {
            sprites.current[index] = el;
          }}
        >
          <spriteMaterial
            map={glow}
            color={BLUE}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}

/** The calibration platform: a disc, lit edge and slowly turning rings. */
function Platform({ live }: { live: MutableRefObject<Live> }) {
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const edge = useRef<THREE.MeshBasicMaterial>(null);
  const innerMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const tint = useMemo(() => new THREE.Color(), []);

  useFrame((_, delta) => {
    const { platform, verified } = live.current;
    if (outer.current) outer.current.rotation.y += delta * (0.08 + platform * 0.06);
    if (inner.current) inner.current.rotation.y -= delta * (0.14 + platform * 0.1);
    tint.copy(BLUE).lerp(GREEN, verified);
    if (edge.current) edge.current.color.copy(tint).multiplyScalar(0.8 + platform * 0.8);
    innerMats.current.forEach((m) => {
      if (m) m.opacity = 0.35 + platform * 0.45;
    });
  });

  return (
    <group>
      <mesh position={[0, 0.04, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[0.78, 0.86, 0.08, 64]} />
        {metal("#1b2640", 0.45)}
      </mesh>
      <mesh position={[0, 0.082, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.8, 0.008, 8, 96]} />
        <meshBasicMaterial ref={edge} color={BLUE} toneMapped={false} />
      </mesh>
      <group ref={inner} position={[0, 0.01, 0]}>
        {Array.from({ length: 12 }).map((_, i) => (
          <mesh key={i} rotation={[Math.PI / 2, 0, (i / 12) * Math.PI * 2]}>
            <torusGeometry args={[1.2, 0.006, 6, 48, (Math.PI * 2) / 12 / 1.7]} />
            <meshBasicMaterial
              ref={(m) => {
                innerMats.current[i] = m;
              }}
              color="#60a5fa"
              transparent
              opacity={0.55}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
      <group ref={outer} position={[0, 0.005, 0]}>
        {Array.from({ length: 24 }).map((_, i) => (
          <mesh key={i} rotation={[Math.PI / 2, 0, (i / 24) * Math.PI * 2]}>
            <torusGeometry args={[1.75, 0.004, 6, 48, (Math.PI * 2) / 24 / 1.7]} />
            <meshBasicMaterial color="#60a5fa" transparent opacity={0.3} toneMapped={false} />
          </mesh>
        ))}
      </group>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <torusGeometry args={[2.4, 0.003, 6, 128]} />
        <meshBasicMaterial color="#94a3b8" transparent opacity={0.18} />
      </mesh>
    </group>
  );
}

/**
 * A single sweep that rises along the arm when the verification stage
 * starts. It is a visual cue for "this is where checks happen", never a
 * check result.
 */
function VerificationSweep({ live }: { live: MutableRefObject<Live> }) {
  const ring = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const t = useRef(1);
  const lastStage = useRef(-1);

  useFrame((_, delta) => {
    const { stage } = live.current;
    if (stage !== lastStage.current) {
      if (STAGE_FX[stage]?.scan) t.current = 0;
      lastStage.current = stage;
    }
    t.current = Math.min(1, t.current + delta / 1.7);
    const eased = 1 - Math.pow(1 - t.current, 3);
    if (ring.current) {
      ring.current.position.y = 0.1 + eased * 2.4;
      const s = 1.5 - eased * 0.5;
      ring.current.scale.set(s, s, s);
    }
    if (mat.current) mat.current.opacity = t.current < 1 ? Math.sin(t.current * Math.PI) * 0.7 : 0;
  });

  return (
    <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]} position={[0.9, 0.1, 0]}>
      <torusGeometry args={[1.25, 0.006, 8, 128]} />
      <meshBasicMaterial ref={mat} color="#6ee7b7" transparent opacity={0} toneMapped={false} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* The rig                                                             */
/* ------------------------------------------------------------------ */

function Rig({
  animate,
  verified,
  stage,
}: {
  animate: boolean;
  verified: boolean;
  stage: number;
}) {
  const pivot = useRef<THREE.Group>(null);
  const space = useRef<THREE.Group>(null);
  const joints = useRef<(THREE.Group | null)[]>([null, null, null]);
  const anchors = useRef<(THREE.Object3D | null)[]>([null, null, null, null, null]);
  const rim = useRef<THREE.PointLight>(null);
  const glow = useGlowTexture();
  const live = useRef<Live>({
    hover: 0,
    verified: 0,
    stage: 0,
    speed: STAGE_FX[0].speed,
    platform: STAGE_FX[0].platform,
    halo: 1,
    joints: [0, 0, 0, 0],
  });
  const pointer = useRef({ x: 0, y: 0, inside: false });
  const spring = useRef({ yaw: REST_YAW, pitch: REST_PITCH, vYaw: 0, vPitch: 0 });
  const idle = useRef(1);
  const { gl, camera } = useThree();

  // Props land in the ref; useFrame reads them without re-rendering anything.
  live.current.stage = stage;

  // Pointer relative to the 3D panel itself. Outside the panel, or after a
  // scroll with no new pointer movement, the target returns to neutral, so
  // scrolling the page never rotates the robot.
  useEffect(() => {
    if (!animate) return;
    const element = gl.domElement;
    const reset = () => {
      pointer.current.x = 0;
      pointer.current.y = 0;
      pointer.current.inside = false;
    };
    const onMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      const inside = Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
      if (!inside) {
        reset();
        return;
      }
      pointer.current.x = THREE.MathUtils.clamp(nx * POINTER_GAIN, -1, 1);
      pointer.current.y = THREE.MathUtils.clamp(ny * POINTER_GAIN, -1, 1);
      pointer.current.inside = true;
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerType === "touch") reset();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("scroll", reset, { passive: true });
    document.addEventListener("pointerleave", reset);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("scroll", reset);
      document.removeEventListener("pointerleave", reset);
    };
  }, [animate, gl]);

  useFrame(({ clock }, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20); // no jumps after a hidden tab
    const t = clock.getElapsedTime();
    const k = 1 - Math.exp(-3.2 * delta);
    const state = live.current;
    const fx = STAGE_FX[state.stage] ?? STAGE_FX[0];

    state.hover = THREE.MathUtils.lerp(state.hover, pointer.current.inside ? 1 : 0, k);
    state.verified = THREE.MathUtils.lerp(state.verified, verified ? 1 : 0, k * 0.8);
    state.speed = THREE.MathUtils.lerp(state.speed, fx.speed, k);
    state.platform = THREE.MathUtils.lerp(state.platform, fx.platform, k);
    state.halo = THREE.MathUtils.lerp(state.halo, fx.halo, k);
    for (let i = 0; i < 4; i++) {
      state.joints[i] = THREE.MathUtils.lerp(state.joints[i], fx.joints[i], k);
    }

    if (!animate) return;

    // Viewing angle: a damped spring toward the pointer target, so it
    // responds at once, carries a little inertia, and never snaps.
    const sp = spring.current;
    const drift = Math.sin(t * 0.25) * 0.04 * (1 - state.hover);
    const targetYaw = REST_YAW + drift + pointer.current.x * MAX_YAW;
    const targetPitch = REST_PITCH + pointer.current.y * MAX_PITCH;
    const damp = Math.exp(-SPRING_D * delta);
    sp.vYaw = (sp.vYaw + (targetYaw - sp.yaw) * SPRING_K * delta) * damp;
    sp.vPitch = (sp.vPitch + (targetPitch - sp.pitch) * SPRING_K * delta) * damp;
    sp.yaw = THREE.MathUtils.clamp(sp.yaw + sp.vYaw * delta, REST_YAW - MAX_YAW - 0.05, REST_YAW + MAX_YAW + 0.05);
    sp.pitch = THREE.MathUtils.clamp(sp.pitch + sp.vPitch * delta, REST_PITCH - MAX_PITCH - 0.03, REST_PITCH + MAX_PITCH + 0.03);
    if (pivot.current) {
      pivot.current.rotation.y = sp.yaw;
      pivot.current.rotation.x = sp.pitch;
    }

    // Idle articulation: coordinated, a few degrees, quieter while the
    // pointer is inspecting the rig.
    idle.current = THREE.MathUtils.lerp(idle.current, state.hover > 0.5 ? 0.35 : 1, k);
    if (IDLE_ARTICULATION) {
      const a = idle.current;
      const phase = t * 0.55;
      const j = joints.current;
      if (j[0]) j[0].rotation.z = POSE[0] + Math.sin(phase) * IDLE_AMP[0] * a;
      if (j[1]) j[1].rotation.z = POSE[1] + Math.sin(phase + 0.9) * IDLE_AMP[1] * a;
      if (j[2]) j[2].rotation.z = POSE[2] + Math.sin(phase * 1.3 + 1.8) * IDLE_AMP[2] * a;
    }

    if (rim.current) rim.current.intensity = 26 + state.hover * 10 + Math.sin(t * 0.8) * 2;

    // A slight dolly while the rig is being inspected.
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, 6.8 - state.hover * 0.45, k);
  });

  return (
    <>
      <pointLight ref={rim} position={[-2.5, 2.4, -2.5]} intensity={28} distance={12} color="#3b82f6" />
      <group ref={pivot} rotation={[REST_PITCH, REST_YAW, 0]}>
        <group ref={space} position={[-0.75, -1.45, 0]}>
          <Platform live={live} />
          <VerificationSweep live={live} />

          {/* Base column */}
          <mesh position={[0, 0.3, 0]} castShadow>
            <cylinderGeometry args={[0.42, 0.5, 0.36, 48]} />
            {metal("#26344f", 0.35)}
          </mesh>
          <mesh position={[0, 0.49, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.42, 0.008, 8, 64]} />
            <meshBasicMaterial color="#93c5fd" transparent opacity={0.7} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.78, 0]} castShadow>
            <cylinderGeometry args={[0.24, 0.3, 0.6, 40]} />
            {metal("#2f3d5c", 0.3)}
          </mesh>
          <object3D
            ref={(o: THREE.Object3D | null) => {
              anchors.current[0] = o;
            }}
            position={[0, 0.2, 0]}
          />

          {/* Shoulder → upper arm → elbow → forearm → wrist → sensor frame. */}
          <group position={[0, 1.05, 0]}>
            <object3D
              ref={(o: THREE.Object3D | null) => {
                anchors.current[1] = o;
              }}
            />
            <Joint
              index={0}
              radius={0.24}
              depth={0.36}
              phase={0}
              live={live}
              glow={glow}
              label="J1 · shoulder"
              labelOffset={[-0.55, -0.2, 0.2]}
            />
            <group
              ref={(g) => {
                joints.current[0] = g;
              }}
              rotation={[0, 0, POSE[0]]}
            >
              <Link length={1.4} radius={0.13} />
              <group position={[1.4, 0, 0]}>
                <object3D
                  ref={(o: THREE.Object3D | null) => {
                    anchors.current[2] = o;
                  }}
                />
                <Joint
                  index={1}
                  radius={0.19}
                  depth={0.3}
                  phase={1.2}
                  live={live}
                  glow={glow}
                  label="J2 · elbow_left"
                  labelOffset={[0.55, 0.42, 0.2]}
                />
                <group
                  ref={(g) => {
                    joints.current[1] = g;
                  }}
                  rotation={[0, 0, POSE[1]]}
                >
                  <Link length={0.95} radius={0.1} />
                  <group position={[0.95, 0, 0]}>
                    <object3D
                      ref={(o: THREE.Object3D | null) => {
                        anchors.current[3] = o;
                      }}
                    />
                    <Joint
                      index={2}
                      radius={0.14}
                      depth={0.24}
                      phase={2.3}
                      live={live}
                      glow={glow}
                      label="J3 · wrist"
                      labelOffset={[0.1, 0.4, 0.2]}
                    />
                    <group
                      ref={(g) => {
                        joints.current[2] = g;
                      }}
                      rotation={[0, 0, POSE[2]]}
                    >
                      <Link length={0.36} radius={0.07} />
                      {/* End effector: flange, gripper and the sensor frame. */}
                      <group position={[0.5, 0, 0]}>
                        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                          <cylinderGeometry args={[0.13, 0.13, 0.06, 32]} />
                          {metal("#3a4a6e", 0.3)}
                        </mesh>
                        <mesh position={[0.14, 0.07, 0]} castShadow>
                          <boxGeometry args={[0.2, 0.035, 0.12]} />
                          {metal("#4b5d84", 0.3)}
                        </mesh>
                        <mesh position={[0.14, -0.07, 0]} castShadow>
                          <boxGeometry args={[0.2, 0.035, 0.12]} />
                          {metal("#4b5d84", 0.3)}
                        </mesh>
                        <group position={[0.3, 0, 0]}>
                          <object3D
                            ref={(o: THREE.Object3D | null) => {
                              anchors.current[4] = o;
                            }}
                          />
                          <SensorFrame live={live} glow={glow} />
                          <group position={[0.2, -0.32, 0.2]}>
                            <Pin label="sensor_frame · arm_left" live={live} index={3} />
                          </group>
                        </group>
                      </group>
                    </group>
                  </group>
                </group>
              </group>
            </group>
          </group>

          {animate && <Pulses live={live} glow={glow} anchors={anchors} space={space} />}
        </group>
      </group>
    </>
  );
}

/** The sensor frame axes, with a soft glow when the evidence stage lands. */
function SensorFrame({ live, glow }: { live: MutableRefObject<Live>; glow: THREE.Texture }) {
  const mat = useRef<THREE.SpriteMaterial>(null);
  const tint = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    if (!mat.current) return;
    const { joints, verified } = live.current;
    tint.copy(BLUE).lerp(GREEN, verified);
    mat.current.color.copy(tint);
    mat.current.opacity = joints[3] * 0.7;
  });
  return (
    <group>
      <CoordinateFrame size={0.42} />
      <sprite scale={[0.7, 0.7, 1]}>
        <spriteMaterial
          ref={mat}
          map={glow}
          color={BLUE}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
    </group>
  );
}

export default function CalibrationRig3D({
  animate,
  verified = false,
  stage = 0,
  onReady,
}: {
  animate: boolean;
  /** Drawn in verified green once the workflow reaches verification. */
  verified?: boolean;
  /** Index of the current workflow pill, for the stage-aware cues. */
  stage?: number;
  /** Fired once the context exists, so the wrapper can fade this in. */
  onReady?: () => void;
}) {
  return (
    <Canvas
      // Capped device pixel ratio: a decorative scene has no business
      // rendering at 3x on a phone.
      dpr={[1, 1.75]}
      shadows
      camera={{ position: [0.6, 1.1, 6.8], fov: 34 }}
      frameloop={animate ? "always" : "demand"}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.15;
        scene.fog = new THREE.Fog("#05080f", 8, 16);
        onReady?.();
      }}
      // Vertical swipes keep scrolling the page on touch screens.
      style={{ width: "100%", height: "100%", touchAction: "pan-y" }}
    >
      <hemisphereLight args={["#bcd4ff", "#0a1020", 0.7]} />
      <directionalLight
        position={[3.5, 6, 4.5]}
        intensity={2.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0004}
      />
      {/* Cyan fill from below and a soft top light; the blue rim lives in the rig. */}
      <pointLight position={[2.2, -0.4, 2.6]} intensity={9} distance={9} color="#38bdf8" />
      <pointLight position={[0, 3.5, 1.5]} intensity={6} distance={8} color="#e0e7ff" />

      {/* Measurement floor. */}
      <gridHelper
        args={[18, 36, "#1e3a8a", "#16213a"]}
        position={[0, -1.36, 0]}
        onUpdate={(grid: THREE.GridHelper) => {
          const material = grid.material as THREE.Material;
          material.transparent = true;
          material.opacity = 0.55;
        }}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.355, 0]} receiveShadow>
        <planeGeometry args={[18, 18]} />
        <shadowMaterial opacity={0.45} />
      </mesh>

      <Rig animate={animate} verified={verified} stage={stage} />
    </Canvas>
  );
}
