export type CountEvidence = { verified: true } | { verified: false; reason: string };

/**
 * Whether a Strands `countTokens` call really reached Bedrock CountTokens, judged from the log
 * lines Strands wrote during the call. A fallback to the character heuristic is not always
 * logged: Strands skips a model that failed once without a word, and warns about AccessDenied
 * once per process. So only its success line with the same total counts as proof.
 */
export function nativeCountEvidence(tokens: number, logLines: readonly string[]): CountEvidence {
  if (logLines.some((line) => line.includes(`total_tokens=<${tokens}> | native token count`))) return { verified: true };
  return { verified: false, reason: logLines.find((line) => /falling back/i.test(line)) ?? "no native token count was logged" };
}
