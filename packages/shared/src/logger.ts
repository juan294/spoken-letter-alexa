type Level = "info" | "warn" | "error";

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "object" && item !== null) {
      if (seen.has(item)) return "[Circular]";
      seen.add(item);
    }
    if (typeof item === "bigint") return item.toString();
    return item;
  });
}

function emit(level: Level, event: string, fields?: object): void {
  const line = safeStringify({ time: new Date().toISOString(), level, event, ...fields });
  process.stdout.write(`${line}\n`);
}

/** JSON lines to stdout. CloudWatch ingests them unchanged; locally they pipe into `jq`. */
export const log = {
  info(event: string, fields?: object): void {
    emit("info", event, fields);
  },
  warn(event: string, fields?: object): void {
    emit("warn", event, fields);
  },
  error(event: string, fields?: object): void {
    emit("error", event, fields);
  },
};
