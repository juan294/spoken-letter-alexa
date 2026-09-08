// Port of the private repository's src/components/ui/wordmark.tsx BrandMark: an amber
// half-arc with two dots beneath it (ink or cream left, clay-rose right). Geometry is the
// original's; colours come from theme variables only.
const MARK = {
  sm: { w: 40, h: 25, bw: 4.5, rx: 48, ry: 42, dot: 8 },
  md: { w: 46, h: 28, bw: 5, rx: 54, ry: 48, dot: 9 },
  lg: { w: 78, h: 48, bw: 8, rx: 90, ry: 82, dot: 14 },
  xl: { w: 150, h: 92, bw: 13, rx: 160, ry: 150, dot: 26 },
} as const;

export type BrandMarkSize = keyof typeof MARK;

export function BrandMark({
  size = "md",
  leftDot = "ink",
  glow = false,
}: {
  size?: BrandMarkSize;
  leftDot?: "ink" | "cream";
  /** The radial amber glow behind the Now Playing mark (Applications export, phone 3). */
  glow?: boolean;
}) {
  const m = MARK[size];
  return (
    <span
      aria-hidden="true"
      data-testid="brand-mark"
      style={{ position: "relative", display: "inline-block", width: m.w, height: m.h, flex: "none" }}
    >
      {glow ? (
        <span
          style={{
            position: "absolute",
            inset: -Math.round(m.h * 0.33),
            borderRadius: "50%",
            background: "radial-gradient(closest-side, color-mix(in srgb, var(--lamplight) 30%, transparent), transparent)",
          }}
        />
      ) : null}
      <span
        style={{
          position: "absolute",
          left: m.bw - 2,
          right: m.bw - 2,
          top: 1,
          height: m.h - 1,
          border: `${m.bw}px solid`,
          borderColor: "var(--lamplight) transparent transparent transparent",
          borderTopLeftRadius: `${m.rx}px ${m.ry}px`,
          borderTopRightRadius: `${m.rx}px ${m.ry}px`,
        }}
      />
      <span
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: m.dot,
          height: m.dot,
          borderRadius: "50%",
          background: leftDot === "ink" ? "var(--evening-ink)" : "var(--cream)",
        }}
      />
      <span
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: m.dot,
          height: m.dot,
          borderRadius: "50%",
          background: "var(--clay-rose)",
        }}
      />
    </span>
  );
}
