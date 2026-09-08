import type { ReactNode } from "react";

/** Mono uppercase eyebrow; every heading has one directly above it (brand signature 1). */
export function Eyebrow({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "amber-on-dark" | "muted" }) {
  return <p className={`eyebrow eyebrow-${tone}`}>{children}</p>;
}
