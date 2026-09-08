import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import * as lambda from "aws-cdk-lib/aws-lambda";

/**
 * A Lambda asset built by `infra/scripts/bundle-lambda.mjs` (`pnpm -F infra build`).
 * Tests pass `useBundle: false` and get a marker function; a real synth without the
 * bundle fails instead of deploying the marker. `hash` identifies the bundle content so
 * dependent resources (the gateway target sync) change exactly when the code does.
 */
export function bundledCode(bundleDir: string, useBundle: boolean): { code: lambda.Code; hash: string } {
  if (!useBundle) return { code: lambda.Code.fromInline("export const handler = async () => ({ statusCode: 501 });"), hash: "marker" };
  const entry = path.join(bundleDir, "index.mjs");
  if (!existsSync(entry)) throw new Error(`${entry} is missing: run pnpm build before cdk synth or deploy`);
  return { code: lambda.Code.fromAsset(bundleDir), hash: createHash("sha256").update(readFileSync(entry)).digest("hex").slice(0, 16) };
}
