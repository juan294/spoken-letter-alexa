import { log } from "@spoken-letter-alexa/shared";

export type ProgressiveResponseOptions = {
  /** `context.System.apiEndpoint` from the request envelope. */
  apiEndpoint: string;
  /** `context.System.apiAccessToken` from the request envelope. */
  apiAccessToken: string;
  requestId: string;
  text: string;
  fetch?: typeof fetch | undefined;
};

const DIRECTIVE_TIMEOUT_MS = 1500;

/**
 * POSTs a `VoicePlayer.Speak` directive to Alexa's Directive Service (phase-2.md section 2).
 * Never throws: a timeout, a non-2xx status or a network error is logged at warn and
 * swallowed — the turn the directive was speaking over is unaffected either way.
 */
export async function sendProgressiveResponse(options: ProgressiveResponseOptions): Promise<void> {
  const fetchImpl = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, DIRECTIVE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${options.apiEndpoint}/v1/directives`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.apiAccessToken}` },
      body: JSON.stringify({ header: { requestId: options.requestId }, directive: { type: "VoicePlayer.Speak", speech: options.text } }),
      signal: controller.signal,
    });
    if (!response.ok) log.warn("progressive_response_failed", { status: response.status });
  } catch (error) {
    log.warn("progressive_response_failed", { message: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(timer);
  }
}

export type ScheduledProgressiveResponse = { cancel: () => void };

const DEFAULT_DELAY_MS = 600;

/**
 * Fires `sendProgressiveResponse` after `delayMs` unless `cancel()` is called first. Never at
 * 0 ms: a turn that finishes in 800 ms should not be preceded by "one moment" (phase-2.md
 * section 2). The caller cancels on the agent promise settling, so only a turn that is
 * actually still running when the timer fires ever speaks the filler line.
 */
export function scheduleProgressiveResponse(options: ProgressiveResponseOptions, delayMs = DEFAULT_DELAY_MS): ScheduledProgressiveResponse {
  const timer = setTimeout(() => {
    // Fire-and-forget: never awaited by the caller, never on the turn's critical path.
    void sendProgressiveResponse(options);
  }, delayMs);
  return { cancel: () => { clearTimeout(timer); } };
}
