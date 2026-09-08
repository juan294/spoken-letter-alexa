import { BrandMark, type BrandMarkSize } from "./BrandMark.tsx";

/** The wordmark is never plain text: mark plus "Spoken" roman and "Letter" italic, both Newsreader 500. */
export function Wordmark({ size = "md", leftDot = "ink" }: { size?: BrandMarkSize; leftDot?: "ink" | "cream" }) {
  return (
    <span className="wordmark" data-testid="wordmark">
      <BrandMark size={size} leftDot={leftDot} />
      <span className="wordmark-text">
        Spoken <em>Letter</em>
      </span>
    </span>
  );
}
