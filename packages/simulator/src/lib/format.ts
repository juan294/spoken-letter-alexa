/** Drops a gateway prefix such as `spoken-letter___` for display; the raw name goes in a title attribute. */
export function displayToolName(raw: string): string {
  const index = raw.lastIndexOf("___");
  return index === -1 ? raw : raw.slice(index + 3);
}

/** `m:ss` for a duration in seconds; a dash pair when the duration is unknown. */
export function formatClock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "–:––";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
