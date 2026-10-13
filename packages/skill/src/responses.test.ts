import { expect, test } from "vitest";

import { ssml } from "./responses.ts";

// Alexa+ read the command "record" as the noun (issue 21).
test("the spoken word record is marked as the verb, and re-record gets its verb pronunciation", () => {
  expect(ssml("Say \"record\" when you're ready.").ssml).toBe("<speak>Say &quot;<w role=\"amazon:VB\">record</w>&quot; when you're ready.</speak>");
  expect(ssml("You can record a story.").ssml).toBe("<speak>You can <w role=\"amazon:VB\">record</w> a story.</speak>");
  // Only the command is marked: a catalog title or agent reply keeps Alexa's own reading.
  expect(ssml("Playing The Record Player by Aunt Whitney. A record-breaking day.").ssml).toBe("<speak>Playing The Record Player by Aunt Whitney. A record-breaking day.</speak>");
  expect(ssml("Say \"re-record\".").ssml).toBe("<speak>Say &quot;<phoneme alphabet=\"ipa\" ph=\"ˌɹiɹɪˈkɔɹd\">re-record</phoneme>&quot;.</speak>");
  expect(ssml("Your recording is saved. It was recorded <today>.").ssml).toBe("<speak>Your recording is saved. It was recorded &lt;today&gt;.</speak>");
});
