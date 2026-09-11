import Link from "next/link";

export function Logo({ href = "/", size = 22 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-bold tracking-tight text-ink">
      <span
        className="flex items-center justify-center rounded-md bg-navy text-on-navy"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg viewBox="0 0 64 64" width={size * 0.62} height={size * 0.62} fill="none">
          <rect x="12" y="16" width="34" height="6" rx="3" fill="currentColor" />
          <rect x="12" y="28" width="24" height="6" rx="3" fill="currentColor" fillOpacity="0.7" />
          <circle cx="44" cy="44" r="14" className="fill-brand" />
          <path
            d="M37.5 44.2l4.2 4.2 8-8.4"
            stroke="currentColor"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span style={{ fontSize: size * 0.68 }}>
        Move<span className="text-brand">Proof</span>
      </span>
    </Link>
  );
}
