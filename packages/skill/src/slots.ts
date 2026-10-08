import type { AlexaRequestEnvelope } from "./handler.ts";

export function slotValue(event: AlexaRequestEnvelope, name: string): string | undefined {
  const value = event.request.intent?.slots?.[name]?.value?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/** The canonical value of a custom-type slot when Alexa resolved it, otherwise the raw value (plan D4). */
export function resolvedValue(event: AlexaRequestEnvelope, name: string): string | undefined {
  const authorities = event.request.intent?.slots?.[name]?.resolutions?.resolutionsPerAuthority ?? [];
  for (const authority of authorities) {
    const canonical = authority.status?.code === "ER_SUCCESS_MATCH" ? authority.values?.[0]?.value?.name?.trim() : undefined;
    if (canonical) return canonical;
  }
  return slotValue(event, name);
}
