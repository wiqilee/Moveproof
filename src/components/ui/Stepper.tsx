import { Check } from "lucide-react";

/**
 * The wizard stepper.
 *
 * Three jobs, in order of importance: say where you are, say how far is left,
 * and make the completed part feel earned. Progress is carried by a rail that
 * fills as steps complete, so the state survives without colour, and every
 * step still announces itself to a screen reader.
 *
 * On a narrow viewport the labels collapse to a single "Step 3 of 4" line
 * rather than shrinking to the point of being unreadable.
 */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <nav aria-label="Progress" className="mb-8">
      <ol className="hidden items-center sm:flex">
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li
              key={step}
              className={
                index < steps.length - 1 ? "flex flex-1 items-center" : "flex items-center"
              }
            >
              <span className="flex items-center gap-3">
                <span
                  className={[
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    "text-[12px] font-bold tabular-nums",
                    "transition-[background-color,box-shadow] duration-200",
                    done
                      ? "bg-ok text-surface shadow-sm"
                      : active
                        ? "bg-navy text-on-navy shadow-sm ring-4 ring-navy/10"
                        : "border border-line bg-surface text-ink-soft",
                  ].join(" ")}
                  aria-hidden
                >
                  {done ? <Check size={15} strokeWidth={3} /> : index + 1}
                </span>

                <span className="flex flex-col leading-tight">
                  <span
                    className={[
                      "text-[13px] tracking-tight transition-colors duration-200",
                      active
                        ? "font-semibold text-ink"
                        : done
                          ? "font-medium text-ink-soft"
                          : "text-ink-soft/70",
                    ].join(" ")}
                  >
                    {step}
                  </span>
                  <span
                    className={[
                      "text-[10px] font-semibold uppercase tracking-[0.08em]",
                      done ? "text-ok" : active ? "text-navy" : "text-transparent",
                    ].join(" ")}
                    aria-hidden
                  >
                    {done ? "Done" : "Current"}
                  </span>
                </span>

                <span className="sr-only">
                  {step}
                  {done ? ", completed" : active ? ", current step" : ", not started"}
                </span>
              </span>

              {index < steps.length - 1 && (
                <span
                  className="mx-4 h-0.5 flex-1 overflow-hidden rounded-full bg-line"
                  aria-hidden
                >
                  <span
                    className="block h-full rounded-full bg-ok transition-[width] duration-500 ease-out"
                    style={{ width: done ? "100%" : "0%" }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* Narrow viewport: a progress bar and a count read better than four
          truncated labels competing for 320 pixels. */}
      <div className="sm:hidden">
        <div className="flex items-baseline justify-between">
          <p className="text-[13px] font-semibold">{steps[current]}</p>
          <p className="font-mono text-[11px] text-ink-soft">
            Step {current + 1} of {steps.length}
          </p>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-navy transition-[width] duration-500 ease-out"
            style={{ width: `${((current + 1) / steps.length) * 100}%` }}
            aria-hidden
          />
        </div>
      </div>
    </nav>
  );
}
