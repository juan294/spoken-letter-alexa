import type { CSSProperties } from "react";

/* Port of the private repository's src/components/ui/moon-pixels.tsx: the 16x16 pixel-art
   crescent moon that fills a player screen. The idle screen of the simulator shows it.

   The palette colours are illustration values, like the colours inside an SVG, not
   reusable theme tokens. This constant is the one sanctioned literal-colour exception in
   the simulator (design/CLAUDE.md carve-out); every other colour is a theme variable. */

export const MOON_ROWS = [
  "...*........*...",
  "................",
  ".*............*.",
  ".......kOyk.....",
  "......kOyyk.....",
  ".....kOyyk......",
  "....kOyyk.......",
  "....kOyyk.......",
  "....kOyyk.......",
  "....kOyyk.......",
  ".....kOyyk......",
  "......kOyyk.....",
  ".......kOyk.....",
  ".*............*.",
  "................",
  "...*........*...",
] as const;

export const MOON_PALETTE: Record<string, string> = {
  ".": "#221C3E", // night-sky background
  k: "#100C1F", // dark outline
  y: "#F0E2A6", // moon body (soft yellow)
  O: "#FBF5DC", // moon highlight (cream)
  "*": "#F2D06A", // star (gold)
};

// Fallback for any glyph missing from MOON_PALETTE (never hit by the rows above).
const FALLBACK_PIXEL_COLOR = "#2A2336";

export function pixelColor(ch: string): string {
  return MOON_PALETTE[ch] ?? FALLBACK_PIXEL_COLOR;
}

export const MOON_PIXELS: string[] = MOON_ROWS.join("").split("").map(pixelColor);

export function MoonPixels({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      role="img"
      aria-label="Crescent moon"
      className={className}
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        gridTemplateColumns: "repeat(16,1fr)",
        gridTemplateRows: "repeat(16,1fr)",
        borderRadius: "3%",
        overflow: "hidden",
        ...style,
      }}
    >
      {MOON_PIXELS.map((color, i) => (
        <div key={i} style={{ background: color }} />
      ))}
    </div>
  );
}
