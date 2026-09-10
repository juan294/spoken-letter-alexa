import { log } from "@spoken-letter-alexa/shared";
import { afterEach, describe, expect, test, vi } from "vitest";

import { scheduleProgressiveResponse, sendProgressiveResponse } from "./progressive.ts";

const OPTIONS = { apiEndpoint: "https://api.amazonalexa.com", apiAccessToken: "token123", requestId: "req-1", text: "Looking for that one." };

/** A fetch that hangs until its AbortSignal fires, then rejects like real `fetch` does. */
function hangingFetch(): typeof fetch {
  return vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("sendProgressiveResponse", () => {
  test("posts a VoicePlayer.Speak directive with the request id and bearer token", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await sendProgressiveResponse({ ...OPTIONS, fetch: fetchImpl });
    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe("https://api.amazonalexa.com/v1/directives");
    const init = call?.[1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token123");
    const body = typeof init?.body === "string" ? init.body : "";
    expect(JSON.parse(body)).toEqual({ header: { requestId: "req-1" }, directive: { type: "VoicePlayer.Speak", speech: "Looking for that one." } });
  });

  test("a non-2xx status is logged and swallowed, never thrown", async () => {
    const warn = vi.spyOn(log, "warn");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 }));
    await expect(sendProgressiveResponse({ ...OPTIONS, fetch: fetchImpl })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("progressive_response_failed", expect.objectContaining({ status: 500 }));
  });

  test("a network error is logged and swallowed, never thrown", async () => {
    const warn = vi.spyOn(log, "warn");
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"));
    await expect(sendProgressiveResponse({ ...OPTIONS, fetch: fetchImpl })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("progressive_response_failed", expect.objectContaining({ message: "network down" }));
  });

  test("times out at 1500 ms rather than hanging forever", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(log, "warn");
    const fetchImpl = hangingFetch();
    const promise = sendProgressiveResponse({ ...OPTIONS, fetch: fetchImpl });
    await vi.advanceTimersByTimeAsync(1500);
    await expect(promise).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("progressive_response_failed", expect.objectContaining({ message: expect.stringMatching(/abort/i) as string }));
  });
});

describe("scheduleProgressiveResponse", () => {
  test("fires after the delay, not immediately", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    scheduleProgressiveResponse({ ...OPTIONS, fetch: fetchImpl }, 600);
    await vi.advanceTimersByTimeAsync(599);
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("cancel() before the delay elapses means it never fires", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const scheduled = scheduleProgressiveResponse({ ...OPTIONS, fetch: fetchImpl }, 600);
    scheduled.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
