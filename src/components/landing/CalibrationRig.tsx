"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { CalibrationRigFallback } from "./CalibrationRigFallback";

/**
 * The calibration rig.
 *
 * This wrapper decides what the viewer gets, and guarantees the page never
 * depends on WebGL:
 *
 *   server render        the static SVG rig
 *   WebGL unavailable    the static SVG rig, permanently
 *   reduced motion       the static SVG rig, permanently
 *   otherwise            the WebGL scene, loaded after mount
 *
 * The 3D chunk is imported with ssr: false, so nothing about it runs during
 * server rendering, and the SVG is the loading state rather than a spinner:
 * the story is already complete before the canvas arrives, and if the canvas
 * never arrives nothing is missing.
 */

// No loading element: the fallback below the canvas is the loading state, and
// swapping one illustration for another is exactly the flash being removed.
const CalibrationRig3D = dynamic(() => import("./CalibrationRig3D"), {
  ssr: false,
});

/** Does this browser actually have a WebGL context to give us? */
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

const STAGES = [
  "Calibration uploaded",
  "AI proposal",
  "Human decision",
  "Deterministic execution",
  "Independent verification",
  "Evidence",
  "Committed",
];

export function CalibrationRig({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<"static" | "webgl">("static");
  const [animate, setAnimate] = useState(false);
  const [stage, setStage] = useState(0);
  // Flipped by the canvas once its context exists, which is when there is
  // something real to fade up to.
  const [sceneReady, setSceneReady] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Reduced motion keeps the static rig: a still WebGL canvas costs a
    // download and a GPU context to show what the SVG already shows.
    if (reduced) return;

    if (hasWebGL()) {
      setMode("webgl");
      setAnimate(true);
    }

    const timer = window.setInterval(
      () => setStage((current) => (current + 1) % STAGES.length),
      1900
    );
    return () => window.clearInterval(timer);
  }, []);

  if (mode === "static") return <CalibrationRigFallback className={className} />;

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-card border border-line bg-gradient-to-b from-surface to-canvas">
        {/* Shorter on a phone, so the scene never crowds the copy above it.
            The camera framing keeps the whole arm visible at every height. */}
        {/* The fallback stays mounted underneath and the canvas fades in over
            it. Both occupy the same box, so nothing reflows and the area is
            never blank: one scene becomes interactive rather than two
            illustrations trading places. */}
        <div className="relative h-[280px] sm:h-[340px] lg:h-[400px]">
          <div
            aria-hidden={sceneReady}
            className={[
              "absolute inset-0 transition-opacity duration-500",
              sceneReady ? "opacity-0" : "opacity-100",
            ].join(" ")}
          >
            <CalibrationRigFallback bare className="h-full" />
          </div>

          <div
            className={[
              "absolute inset-0 transition-opacity duration-500",
              sceneReady ? "opacity-100" : "opacity-0",
            ].join(" ")}
          >
            <CalibrationRig3D animate={animate} onReady={() => setSceneReady(true)} />
          </div>
        </div>

        {/* Annotations live in the DOM rather than in the scene: real text,
            real contrast, readable by a screen reader. Hidden on the narrowest
            screens, where they would sit over the arm. */}
        <div className="pointer-events-none absolute left-4 top-4 hidden sm:block">
          <dl className="panel-flat px-3 py-2 font-mono text-[10px] leading-relaxed">
            {[
              ["robot_id", "0017"],
              ["joint", "elbow_left"],
              ["firmware", "3.08"],
              ["sensor_frame", "arm_left"],
            ].map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="text-ink-soft">{key}</dt>
                <dd className="font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="pointer-events-none absolute bottom-3 right-4 text-[10px] text-ink-soft">
          Illustrative calibration rig. MoveProof verifies data, not hardware.
        </p>
      </div>

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
    </div>
  );
}
