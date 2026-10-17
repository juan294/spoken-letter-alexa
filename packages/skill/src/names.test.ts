import { expect, test } from "vitest";

import { soundsLike, withoutInvocation } from "./names.ts";

test.each([["witney", "whitney"], ["whitley", "whitney"], ["britney", "whitney"], ["manual", "manuel"], ["jordyn", "jordan"]])(
  "%s sounds like %s", (heard, name) => { expect(soundsLike(heard, name)).toBe(true); });

// Review 2026-10-17: two edits with the same three-letter ending let common names through.
test.each([["samuel", "manuel"], ["miguel", "manuel"], ["daniel", "manuel"], ["gordon", "jordan"], ["sydney", "whitney"], ["jord", "jordan"]])(
  "%s does not sound like %s", (heard, name) => { expect(soundsLike(heard, name)).toBe(false); });

test("the invocation tail is removed only at the end", () => {
  expect(withoutInvocation("sam on the moon on spoken letter")).toBe("sam on the moon");
  expect(withoutInvocation("el trasgu by tio manuel in Spoken Letters")).toBe("el trasgu by tio manuel");
  expect(withoutInvocation("spoken letter stories")).toBe("spoken letter stories");
});
