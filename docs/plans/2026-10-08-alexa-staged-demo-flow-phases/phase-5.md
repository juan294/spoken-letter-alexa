# Phase 5: record, review, sound and send

**Entry.** Phase 4 is accepted. Revalidate `develop`, the Phase 1 `recording.ts` and APL documents, and the Phase 1 exit decision in the notes. Work in a worktree off `develop`.

**Outcome.** From `recording`, the flow continues with Phase 1's teleprompter and finish (voice or the "Done" button, per the exit decision). The take is matched to the record's script and played back. The adult chooses record again or continue, then picks the sound, hears that version, and sends it. Alexa confirms with D11's wording. The standalone spike path from Phase 1 is removed, and recording is reachable only from the `recording` stage.

## Implementation

1. **Recording stage:** `RecordStoryIntent` uses the record's script. `/create/recorded` sets stage `review`. SS2: a launch with stage `recording` treats the take as finished and resumes at review.
2. **Take lookup:** the agent's `/create/take` matches the normalized record script against `fixtures/takes/manifest.json` and returns the four CloudFront URLs or `take_missing` (SS5). Spike entries never match a creation record.
3. **Review:** play the plain take with SSML `<audio>`, then ask "Want to record it again, or keep it?" "Record again" returns to `recording`; "keep it" or "continue" goes to `sound`.
4. **Sound:**
   - "Would you like to leave it as it is, add sound effects, add music, or both?"
   - `SoundChoiceIntent` uses a `SoundChoice` slot (as is, effects, music, both).
   - Render `apl/sound.json` with four touch options that send `SendEvent`.
   - Play the chosen variant, then ask "Ready to send it to Sam's family?"
5. **Send:**
   - Accepted phrases: `SendStoryIntent` ("send it", "send the story", "yes send it"; covered by the D2 `send` exemption) or Yes.
   - The skill calls `/create/send`, which sets `sentAt` and stage `sent`.
   - Alexa says: "Sent to Sam's family. They'll get a note to listen together." Then `apl/sent.json` shows the title, the listener's first name and the family. The session ends.
6. **Disclosure (D2):**
   - The README gets a "What the video shows" section with the real-versus-staged table from the plan's Goal.
   - The friction log gets an entry on staging and why.
   - `skill.json` `testingInstructions` describe the create flow and state that recording, credit and send are staged.
   - `docs/alexa-device-manual-test-script.md` gets a create-flow section.

```text
@ takeFor(record) -> TakeUrls | take_missing
ctx: takes manifest (bundled), CloudFront base URL
pre: record.script present; stage in {recording, review, sound}
do:
  1. compute normalized script text
  2. lookup manifest entry with equal normalized text, excluding spike entries
  3. emit four HTTPS URLs under /fixtures/takes/
br: none -> take_missing (SS5)
```

## Behavioral oracles

Write failing tests first.

| ID | Journey (en-US) | Required result |
| --- | --- | --- |
| F1 | `recording` → "record story" → "Alexa, the end" | The teleprompter with the record's script; the plain take plays; the review question |
| F2 | Review → "record it again" | Back to the teleprompter; the same take afterwards |
| F3 | Review → "keep it" → "both" | The sound question; then the `both` variant plays; the send question |
| F4 | "send it" | `/create/send` once; D11 line naming the fixture listener and family; `sent` screen; session ends |
| F5 | A record script with no manifest match | SS5 line; stage stays `review` |
| F6 | Launch with stage `recording` | Resume at review (SS2) |
| F7 | Touch "Done" and touch "Add music" (`UserEvent`) | The same results as the spoken forms |
| F8 | Copy rules | No banned words (`handler.test.ts:36-40`); no claim of direct delivery to a child (`/sent to (sam|lucy|theo)\b(?! *'s family)/i` never matches) |
| F9 | Spike path removed | "record story" outside the flow gets "Let's start a story first. Who is it for?" |
| F10 | Disclosure | A doc test asserts the README section exists and names each staged step |

## Batch eligibility

- Unit A `[batch-eligible]`: step 2 and the `/create/recorded` and `/create/send` routes (`packages/agent`).
- Unit B `[batch-eligible]`: steps 1, 3, 4 and 5 (`packages/skill`, APL).
- Unit C `[batch-eligible]`: step 6 (docs and `skill.json` `testingInstructions`).

## Exit

Independent review, repair, simplify and the full local gate. The Owner reviews the copy and the README section.
