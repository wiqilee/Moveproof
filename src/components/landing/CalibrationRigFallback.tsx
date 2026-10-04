"use client";

import { useEffect, useState } from "react";

/**
 * The calibration rig, static fallback.
 *
 * Rendered while the WebGL chunk loads, and permanently when WebGL is
 * unavailable or the viewer prefers reduced motion. The story stays complete
 * here: same joints, same frames, same annotations, no canvas required.
 *
 * MoveProof's signature visual is an articulated arm on a measurement floor,
 * annotated the way a calibration record is: joint identity, coordinate
 * frames, sensor frame, structured values. A robot mascot would say nothing
 * about any of that.
 *
 * Depth is real rather than drawn. The scene sits in a CSS 3D context with a
 * perspective origin, and each layer, the floor, the arm and the annotations,
 * is placed at its own translateZ. The floor is a plane rotated back in space,
 * so its grid converges the way a real surface does instead of being a
 * trapezoid someone drew. The arm then stands on it, with a contact shadow.
 *
 * Why not WebGL: the information here is the labelling, not the geometry, and
 * a library plus a loading path plus a GPU budget buys nothing that composited
 * layers do not already give. The scene costs one component and no dependency.
 *
 * Motion is decorative timing, never a progress reading, and
 * prefers-reduced-motion renders the scene complete and still.
 *
 * Nothing here is a physical claim. It illustrates data moving through a
 * contract.
 */

const STAGES = [
  "Calibration uploaded",
  "AI proposal",
  "Human decision",
  "Deterministic execution",
  "Independent verification",
  "Evidence",
  "Committed",
];

const JOINTS = [
  { name: "shoulder", x: 108, y: 214, r: 14 },
  { name: "elbow", x: 206, y: 134, r: 12 },
  { name: "wrist", x: 296, y: 92, r: 10 },
];

export function CalibrationRigFallback({
  className = "",
  /**
   * `bare` drops the card chrome and the stage pills and renders only the
   * scene. The wrapper uses it as the layer beneath the WebGL canvas, which
   * already supplies both, so neither is drawn twice during the crossfade.
   */
  bare = false,
}: {
  className?: string;
  bare?: boolean;
}) {
  const [stage, setStage] = useState(0);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (query.matches) return;
    setAnimate(true);
    const timer = window.setInterval(
      () => setStage((current) => (current + 1) % STAGES.length),
      1900
    );
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={className}>
      <div
        className={[
          "relative w-full overflow-hidden",
          bare
            ? "h-full"
            : "rounded-card border border-line bg-gradient-to-b from-surface to-canvas",
        ].join(" ")}
        style={{ perspective: "1100px", perspectiveOrigin: "50% 38%" }}
      >
        {/* The measurement floor: a real plane laid back in space, so its grid
            converges rather than being a drawn trapezoid. */}
        <div
          aria-hidden
          className="grid-surface pointer-events-none absolute inset-x-0 bottom-0 h-[62%] opacity-70"
          style={{
            transform: "rotateX(72deg) translateZ(-40px) scale(1.9)",
            transformOrigin: "50% 100%",
            maskImage: "linear-gradient(to top, black 10%, transparent 92%)",
            WebkitMaskImage: "linear-gradient(to top, black 10%, transparent 92%)",
          }}
        />

        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[34%] h-24 bg-gradient-to-b from-brand/[0.07] to-transparent"
        />

        <div className="relative" style={{ transformStyle: "preserve-3d" }}>
          <svg
            viewBox="0 0 400 280"
            role="img"
            aria-label="An articulated robotic calibration rig on a measurement floor, with coordinate frames, joint markers, calibration arcs and a sensor frame, illustrating data moving through verification."
            className="relative h-auto w-full"
            style={{ transform: "translateZ(40px)" }}
          >
            <defs>
              <linearGradient id="rig-link" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgb(var(--color-ink))" stopOpacity="0.92" />
                <stop offset="100%" stopColor="rgb(var(--color-ink))" stopOpacity="0.62" />
              </linearGradient>
              <radialGradient id="rig-pulse">
                <stop offset="0%" stopColor="rgb(var(--color-brand) / 0.6)" />
                <stop offset="100%" stopColor="rgb(var(--color-brand) / 0)" />
              </radialGradient>
              <filter id="rig-shadow" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow
                  dx="0"
                  dy="6"
                  stdDeviation="7"
                  floodColor="rgb(var(--shadow-rgb))"
                  floodOpacity="0.22"
                />
              </filter>
            </defs>

            <ellipse
              cx="112"
              cy="250"
              rx="62"
              ry="11"
              fill="rgb(var(--shadow-rgb))"
              opacity="0.16"
            />

            {/* Plinth, drawn as a solid with a lit top and shaded sides. */}
            <g filter="url(#rig-shadow)">
              <polygon
                points="66,240 112,226 158,240 112,254"
                fill="rgb(var(--color-navy))"
                opacity="0.95"
              />
              <polygon
                points="66,240 112,254 112,244 66,230"
                fill="rgb(var(--color-navy))"
                opacity="0.55"
              />
              <polygon
                points="158,240 112,254 112,244 158,230"
                fill="rgb(var(--color-navy))"
                opacity="0.75"
              />
              <rect x="102" y="212" width="20" height="26" rx="2" fill="rgb(var(--color-navy))" />
              <rect x="102" y="212" width="7" height="26" fill="rgb(255 255 255)" opacity="0.14" />
            </g>

            {JOINTS.map((joint, index) => (
              <path
                key={`arc-${joint.name}`}
                d={`M ${joint.x - 38} ${joint.y} A 38 38 0 0 1 ${joint.x} ${joint.y - 38}`}
                fill="none"
                stroke="rgb(var(--color-brand))"
                strokeWidth="1.25"
                strokeDasharray="3 5"
                opacity={0.22 + index * 0.1}
              />
            ))}

            <g strokeLinecap="round" filter="url(#rig-shadow)">
              <g stroke="url(#rig-link)" strokeWidth="11">
                <line x1="108" y1="214" x2="206" y2="134" />
                <line x1="206" y1="134" x2="296" y2="92" />
                <line x1="296" y1="92" x2="344" y2="106" />
              </g>
              <g stroke="rgb(255 255 255)" strokeWidth="2" opacity="0.2">
                <line x1="108" y1="210" x2="206" y2="130" />
                <line x1="206" y1="130" x2="296" y2="88" />
              </g>
            </g>

            {JOINTS.map((joint) => (
              <g key={joint.name}>
                <circle
                  cx={joint.x}
                  cy={joint.y}
                  r={joint.r}
                  fill="rgb(var(--color-surface))"
                  stroke="rgb(var(--color-navy))"
                  strokeWidth="2.5"
                />
                <circle cx={joint.x} cy={joint.y} r="2.5" fill="rgb(var(--color-navy))" />
                <g strokeWidth="1.5" opacity="0.85">
                  <line
                    x1={joint.x}
                    y1={joint.y}
                    x2={joint.x + 20}
                    y2={joint.y}
                    stroke="rgb(var(--color-bad))"
                  />
                  <line
                    x1={joint.x}
                    y1={joint.y}
                    x2={joint.x}
                    y2={joint.y - 20}
                    stroke="rgb(var(--color-ok))"
                  />
                  <line
                    x1={joint.x}
                    y1={joint.y}
                    x2={joint.x - 13}
                    y2={joint.y + 10}
                    stroke="rgb(var(--color-brand))"
                  />
                </g>
                <text
                  x={joint.x - 6}
                  y={joint.y + joint.r + 15}
                  className="font-mono"
                  fontSize="8.5"
                  fill="rgb(var(--color-ink-soft))"
                >
                  {joint.name}
                </text>
              </g>
            ))}

            <g filter="url(#rig-shadow)">
              <rect
                x="336"
                y="94"
                width="24"
                height="24"
                rx="3"
                fill="rgb(var(--color-surface))"
                stroke="rgb(var(--color-brand))"
                strokeWidth="2"
              />
              <line
                x1="348"
                y1="94"
                x2="348"
                y2="118"
                stroke="rgb(var(--color-brand))"
                strokeWidth="0.75"
                opacity="0.6"
              />
              <line
                x1="336"
                y1="106"
                x2="360"
                y2="106"
                stroke="rgb(var(--color-brand))"
                strokeWidth="0.75"
                opacity="0.6"
              />
            </g>
            <text
              x="322"
              y="136"
              className="font-mono"
              fontSize="8.5"
              fill="rgb(var(--color-ink-soft))"
            >
              sensor_frame
            </text>

            {animate && (
              <circle r="28" fill="url(#rig-pulse)">
                <animateMotion
                  dur="9s"
                  repeatCount="indefinite"
                  path="M 108 214 L 206 134 L 296 92 L 344 106"
                />
              </circle>
            )}
          </svg>

          {/* Structured annotations, floated above the scene. Hidden on the
              narrowest screens, where they would sit on top of the arm. */}
          <div
            className="pointer-events-none absolute left-4 top-4 hidden sm:block"
            style={{ transform: "translateZ(80px)" }}
          >
            <dl className="panel-flat px-3 py-2 font-mono text-[10px] leading-relaxed">
              {[
                ["robot_id", "0017"],
                ["joint", "elbow_left"],
                ["firmware", "3.08"],
              ].map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <dt className="text-ink-soft">{key}</dt>
                  <dd className="font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      {!bare && (
      <ol className="mt-4 flex flex-wrap gap-1.5">
        {STAGES.map((label, index) => (
          <li
            key={label}
            className={[
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors duration-500",
              animate && index === stage
                ? "border-brand bg-brand-soft text-brand"
                : "border-line text-ink-soft",
            ].join(" ")}
          >
            {label}
          </li>
        ))}
      </ol>
      )}
    </div>
  );
}
