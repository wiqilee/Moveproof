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
 * The rig always sits on its own dark stage, in both themes. The stage is
 * scoped with the `dark` class, so every token inside it (including the SVG
 * fallback underneath the canvas) resolves to the dark palette. The server
 * render and the hydrated page therefore show the same dark card, and the
 * canvas fades in over a fallback drawn in matching colours: no light card
 * ever flashes before the 3D scene arrives.
 *
 * The arm is a dataset illustration, never a controlled device. The pointer
 * changes the viewing angle of the whole scene; no joint ever moves.
 */

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

/** From this stage on, the records in the scene are drawn as verified. */
const VERIFIED_FROM = STAGES.indexOf("Independent verification");

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

    setAnimate(true);
    if (hasWebGL()) setMode("webgl");

    const timer = window.setInterval(
      () => setStage((current) => (current + 1) % STAGES.length),
      1900
    );
    return () => window.clearInterval(timer);
  }, []);

  const verified = animate && stage >= VERIFIED_FROM;

  return (
    <div className={className}>
      <div
        data-rig-root
        className="dark relative overflow-hidden rounded-card border border-white/10 shadow-[0_24px_48px_-30px_rgba(15,23,42,0.55)]"
        style={{
          background:
            "radial-gradient(70% 80% at 62% 42%, rgba(37, 99, 235, 0.22), transparent 70%), radial-gradient(50% 40% at 50% 100%, rgba(56, 189, 248, 0.10), transparent 70%), linear-gradient(180deg, #070c18 0%, #04070f 100%)",
        }}
      >
        {/* The product's measurement grid, faded toward the edges. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(148, 163, 184, 0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, 0.07) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
            maskImage: "radial-gradient(75% 75% at 55% 45%, black 35%, transparent 90%)",
            WebkitMaskImage: "radial-gradient(75% 75% at 55% 45%, black 35%, transparent 90%)",
          }}
        />

        {/* Shorter on a phone, so the scene never crowds the copy above it. */}
        <div className="relative h-[300px] sm:h-[360px] lg:h-[420px]">
          <div
            aria-hidden={sceneReady}
            className={[
              "absolute inset-0 transition-opacity duration-700",
              sceneReady ? "opacity-0" : "opacity-100",
            ].join(" ")}
          >
            <CalibrationRigFallback bare className="h-full" />
          </div>

          {mode === "webgl" && (
            <div
              className={[
                "absolute inset-0 transition-opacity duration-700",
                sceneReady ? "opacity-100" : "opacity-0",
              ].join(" ")}
            >
              <CalibrationRig3D
                animate={animate}
                verified={verified}
                stage={animate ? stage : 0}
                onReady={() => setSceneReady(true)}
              />
            </div>
          )}
        </div>

        {/* The record the scene illustrates. In the 3D scene the same values
            are pinned to the joints they describe; this card is the readable
            summary, and it changes state with the workflow pills below. */}
        <div data-rig-avoid className="pointer-events-none absolute left-4 top-4 z-30 hidden sm:block">
          <div
            className={[
              "rounded-control border bg-[#080d1a]/85 px-3 py-2 font-mono text-[10px] leading-relaxed backdrop-blur transition-colors duration-500",
              verified ? "border-ok/50" : "border-white/15",
            ].join(" ")}
          >
            <div className="mb-1 flex items-center justify-between gap-6">
              <span className="text-[9px] uppercase tracking-[0.18em] text-[#8b9bb8]">
                robot_calibration_v1
              </span>
              <span
                className={[
                  "h-1.5 w-1.5 rounded-full transition-colors duration-500",
                  verified ? "bg-ok" : "bg-brand",
                ].join(" ")}
              />
            </div>
            <dl>
              {[
                ["robot_id", "0017"],
                ["joint_name", "elbow_left"],
                ["firmware", "3.08"],
                ["sensor_frame", "arm_left"],
              ].map(([key, value]) => (
                <div key={key} className="flex justify-between gap-4">
                  <dt className="text-[#8b9bb8]">{key}</dt>
                  <dd className="font-semibold text-[#f1f5f9]">{value}</dd>
                </div>
              ))}
            </dl>
            <p
              className={[
                "mt-1 text-[9px] transition-colors duration-500",
                verified ? "text-ok" : "text-[#8b9bb8]",
              ].join(" ")}
            >
              {verified ? "Verified against the contract" : "Awaiting verification"}
            </p>
          </div>
        </div>

        <p data-rig-avoid className="pointer-events-none absolute bottom-3 right-4 z-30 text-[10px] text-[#8b9bb8]">
          Illustrative calibration records. MoveProof verifies data, not hardware.
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
