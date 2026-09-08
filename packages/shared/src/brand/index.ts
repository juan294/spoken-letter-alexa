// Brand tokens vendored verbatim from juan294/spoken-letter `design/tokens.json`
// (ADR 0002). `tokens.test.ts` pins the file's SHA-256; a change in the source requires
// re-copying and updating the pin.
import tokens from "./tokens.json" with { type: "json" };

type TokenLeaf = { value?: string; $value?: string; type?: string; $type?: string; description?: string };
type TokenSet = Record<string, TokenLeaf | Record<string, unknown>>;

export const BRAND_TOKENS = tokens as unknown as {
  global: Record<string, TokenSet>;
  semantic: Record<string, TokenSet>;
  component: Record<string, TokenSet>;
};

function leafValue(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const leaf = node as TokenLeaf;
  const value = leaf.$value ?? leaf.value;
  return typeof value === "string" ? value : null;
}

/** Resolves `{global.color.cream}` style aliases to their literal value. */
export function resolveToken(path: string, depth = 0): string {
  if (depth > 8) throw new Error(`token alias loop at ${path}`);
  const segments = path.split(".");
  let node: unknown = tokens;
  for (const segment of segments) {
    if (!node || typeof node !== "object") throw new Error(`unknown token ${path}`);
    node = (node as Record<string, unknown>)[segment];
  }
  const value = leafValue(node);
  if (value === null) throw new Error(`token ${path} has no value`);
  const alias = /^\{(.+)\}$/.exec(value);
  return alias?.[1] ? resolveToken(alias[1], depth + 1) : value;
}

/** Flat `name -> literal value` map for one set, aliases resolved. */
export function flattenTokens(setPath: string): Record<string, string> {
  const segments = setPath.split(".");
  let node: unknown = tokens;
  for (const segment of segments) node = (node as Record<string, unknown>)[segment];
  const out: Record<string, string> = {};
  const walk = (value: unknown, prefix: string) => {
    if (!value || typeof value !== "object") return;
    if (leafValue(value) !== null) {
      out[prefix] = resolveToken(`${setPath}.${prefix}`);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith("$")) continue;
      walk(child, prefix ? `${prefix}.${key}` : key);
    }
  };
  walk(node, "");
  return out;
}

/** The colours the simulator's ink panel and chips use, resolved from the token file. */
export const brand = {
  cream: resolveToken("global.color.cream"),
  eveningInk: resolveToken("global.color.evening-ink"),
  lamplight: resolveToken("global.color.lamplight"),
  clayRose: resolveToken("global.color.clay-rose"),
  displayAccent: resolveToken("global.color.display-accent"),
  fontDisplay: resolveToken("global.fontFamilies.display"),
  fontBody: resolveToken("global.fontFamilies.body"),
  fontMono: resolveToken("global.fontFamilies.mono"),
  radiusPill: resolveToken("global.borderRadius.pill"),
  radiusLg: resolveToken("global.borderRadius.lg"),
} as const;
