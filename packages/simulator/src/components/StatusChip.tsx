import { STATUS_LABEL, type Status } from "../state/alexa.ts";

const LIVE: ReadonlySet<Status> = new Set<Status>(["listening", "thinking", "replying", "playing"]);

/** Mono amber status chip from the Now Playing phone header. */
export function StatusChip({ status }: { status: Status }) {
  return (
    <span className="status-chip" data-testid="status-chip" data-live={LIVE.has(status)} role="status" aria-live="polite">
      {STATUS_LABEL[status]}
    </span>
  );
}
