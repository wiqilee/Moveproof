import { Check } from "lucide-react";

/**
 * The wizard stepper.
 *
 * Progress is carried by a connecting rail that fills as steps complete, so
 * the state is legible at a glance without relying on colour alone. Each step
 * also announces its state to a screen reader.
 */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <nav aria-label="Progress" className="mb-8">
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={step} className={index < steps.length - 1 ? "flex flex-1 items-center" : "flex items-center"}>
              <span className="flex items-center gap-2.5">
                <span
                  className={[
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    "transition-colors duration-200",
                    done
                      ? "bg-ok text-surface"
                      : active
                        ? "bg-navy text-on-navy ring-4 ring-navy/10"
                        : "border border-line bg-surface text-ink-soft",
                  ].join(" ")}
                  aria-hidden
                >
                  {done ? <Check size={13} strokeWidth={3} /> : index + 1}
                </span>
                <span
                  className={[
                    "hidden text-[13px] tracking-tight sm:inline",
                    active ? "font-semibold text-ink" : done ? "text-ink-soft" : "text-ink-soft/70",
                  ].join(" ")}
                >
                  {step}
                </span>
                <span className="sr-only">
                  {step}
                  {done ? ", completed" : active ? ", current step" : ", not started"}
                </span>
              </span>
              {index < steps.length - 1 && (
                <span className="mx-3 h-px flex-1 bg-line" aria-hidden>
                  <span
                    className="block h-px bg-ok transition-all duration-300"
                    style={{ width: done ? "100%" : "0%" }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
