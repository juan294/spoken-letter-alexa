import { log } from "@spoken-letter-alexa/shared";

import { type AccountProvider, type ProviderResolver } from "./types.ts";

export type ProviderMode = "fixtures" | "auto";

export const DEMO_SUBJECT = "demo";
export const SERVICE_SUBJECT_PREFIX = "svc:";

/**
 * `fixtures`: every subject sees the Owner's recordings (September deployment).
 * `auto`: `demo` and `svc:*` see the fixtures; real Spoken Letter uids go to the bridge.
 */
export function createProviderResolver(options: {
  mode: ProviderMode;
  fixtures: AccountProvider;
  http: AccountProvider | null;
}): ProviderResolver {
  if (options.mode === "fixtures") return () => options.fixtures;
  if (!options.http) {
    log.warn("provider_auto_without_bridge", { fallback: "fixtures" });
    return () => options.fixtures;
  }
  const http = options.http;
  return (subject) => (subject === DEMO_SUBJECT || subject.startsWith(SERVICE_SUBJECT_PREFIX) ? options.fixtures : http);
}
