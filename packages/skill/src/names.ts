/** Levenshtein distance between two folded words. */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

/**
 * A heard word close enough to a known name ("witney", "britney" and "whitley" for "whitney";
 * "manual" for "manuel"). Alexa+ misspells names it does not know; short names must match exactly,
 * and two edits need the same ending, so "samuel" never passes for "manuel".
 */
export function soundsLike(heard: string, name: string): boolean {
  if (heard === name) return true;
  if (name.length < 5 || heard.length < 4) return false;
  const distance = editDistance(heard, name);
  return distance <= 1 || (distance === 2 && heard.slice(-3) === name.slice(-3));
}
