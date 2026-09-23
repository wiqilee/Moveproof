"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type Variant = "primary" | "accent" | "secondary" | "ghost";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  iconPosition?: "left" | "right";
  children: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-navy text-on-navy shadow-sm hover:bg-brand-soft hover:text-brand hover:ring-1 hover:ring-brand/40 hover:shadow-md active:bg-brand-soft",
  accent: "bg-brand text-on-brand shadow-sm hover:bg-brand/90 active:bg-brand",
  secondary: "border border-line bg-surface text-ink hover:bg-muted active:bg-muted",
  ghost: "bg-transparent text-ink-soft hover:bg-muted hover:text-ink",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-3 py-1.5 text-[13px]",
  md: "px-4 py-2.5 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  iconPosition = "left",
  children,
  className = "",
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-control font-semibold",
        "transition-[background-color,transform,box-shadow] duration-150",
        "active:translate-y-px",
        "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(" ")}
      {...rest}
    >
      {Icon && iconPosition === "left" && <Icon size={15} aria-hidden />}
      {children}
      {Icon && iconPosition === "right" && <Icon size={15} aria-hidden />}
    </button>
  );
}
