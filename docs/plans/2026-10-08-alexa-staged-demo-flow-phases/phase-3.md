# Phase 3: creation flow skeleton, listener and credit

**Entry.** Phase 1 is accepted, with its exit decision recorded. Revalidate `develop`, `handler.ts:98-110`, `:340-658`, `agent-client.ts`, `packages/agent/src/routes.ts` and `demo-drafts.ts` (store pattern). Work in a worktree off `develop`.

**Outcome.** en-US "create a story" (and "create a story for <name>") starts a creation record. Alexa then asks who it's for, resolves same-name listeners, applies the staged credit step, and arrives at the conversation stage. Phase 4 fills the conversation stage; until then it says "Tell me what the story should be about" and stays there. es-ES is unchanged (D1).

## Implementation

1. **Fixture `fixtures/demo-family.json`** and its parser `parseDemoFamily` in `packages/shared`:
   - **Fields:** `families[{id, name, listeners[{id, name}]}]`, `credits` (integer ≥ 0), `scriptWords` (default 70).
   - **Default data** (fictional): the Rivera family with Sam and Lucy, and the Okafor family with Sam and Theo. Credits 1, script words 70.
   - **Checks:** the parser rejects unknown keys and duplicate ids, and it rejects listener names that collide with a storyteller name.
2. **Contract** in `packages/shared` (zod):
   - `CreateStage = "listener" | "listener_confirm" | "credit" | "conversation" | "script" | "recording" | "review" | "sound" | "sent"`
   - `CreationRecord { stage, listenerId?, candidateIds?, notes: string[], script?, scriptVersion, takeKey?, sound?, sentAt?, createdAt }`
   - Request and response schemas for the routes in step 3.
3. **Agent routes** in `packages/agent/src/create-flow.ts`. They use the same skill-secret guard and zod parsing as `/agent/demo/draft` (`routes.ts:306-324`).
   - **Routes:** `POST /agent/demo/create/current`, `/start`, `/listener`, `/credit`.
   - **Store:** `DynamoCreationStore` and `MemoryCreationStore` on `sla-demo-state`, key `create_<deviceKey>`, 7-day TTL (D5). They follow `demo-drafts.ts:64-75`, use GetItem and PutItem only, and are wired in `packages/app/src/bootstrap.ts` next to the draft store.
   - **Rate limit:** at most 20 creations per 2 hours per device, mirroring the draft cap (`demo-drafts.ts:8-9`).
   - **Logs:** `/listener` resolves names against the fixture and logs presence only.
4. **Interaction model** (en-US only, D13):
   - **Slot types** `ListenerName` and `FamilyName`, generated from the fixture, with the family name also accepted without "family".
   - **`ChooseListenerIntent`:** "{listener}", "it's for {listener}", "for {listener}", "{listener} from the {family} family", "send it to {listener} from the {family} family". Add a `send` exemption set for this intent only (D2).
   - **`BuyCreditIntent`:** "buy a credit", "buy one". Yes and no use the built-ins.
   - **`AppHandoffIntent`** in en-US now routes into the flow with the listener pre-filled. Its es-ES behavior is unchanged.
5. **Skill** (`packages/skill/src/create-flow.ts`, called from `respond()`):
   - `validatedSession` adds `demoFlow=create` and `createStage` from the closed `CreateStage` set.
   - On `LaunchRequest` with no other pending prompt, call `/create/current`. A record in progress offers to resume: "You have a story for Sam in progress. Want to pick up where you left off?"
   - `StartStoryIntent` in en-US calls `/create/start` and asks "Who is this story for?"
   - The en-US draft paths (`handler.ts:499-504`, `:566-582`) are replaced by the create flow. The es-ES paths stay.
   - All copy lives in `create-messages.ts` (D12).
6. **Listener resolution:**
   - **One match:** go to the credit stage.
   - **Several matches:** ask about the first candidate: "Do you want to send this to Sam from the Rivera family?" "Yes" selects it. "No" asks "Which family is Sam in?" unless the reply already named one, as in "No, send it to Theo from the Okafor family".
   - **No match:** SS7.
7. **Credit:**
   - Credits ≥ 1: "You have one story credit. I'll use it for this story." Then the conversation stage.
   - Credits 0: "You're out of story credits. Want to buy one?" Yes: "Done, you have one story credit." Then the conversation stage. No: SS9.

```text
@ chooseListener(record, spokenName, spokenFamily?) -> CreationRecord
ctx: demo-family fixture, creation store
pre: record.stage in {listener, listener_confirm}
do:
  1. lookup listeners whose name matches spokenName (canonical slot value)
  2. filter by spokenFamily when given
  3. write stage=credit with listenerId when exactly one remains
br: >1 -> stage=listener_confirm, candidateIds; 0 -> keep stage, return the listener list (SS7)
fx: PutItem create_<deviceKey>
```

## Behavioral oracles

Write failing tests first. Replace the en-US assertions of the old draft journey listed by the research assignment: `handler.test.ts:182-197`, `:199-211`, `:213-222`, `:241-245`, `:680-689`, `:698-704`, `:718-734`, `:760`, `:771-790`, and `session-recovery.integration.test.ts:84-187` (the en-US draft parts). Every es-ES file and the draft route tests pass unmodified.

| ID | Journey (en-US) | Required result |
| --- | --- | --- |
| C1 | "create a story" → "Lucy" | Asks who it's for; Lucy resolves; the credit line; stage `conversation`; one `/start` and one `/listener` call |
| C2 | "create a story" → "Sam" → "yes" | The Rivera question; yes selects `sam-rivera` |
| C3 | "Sam" → "no, send it to Sam from the Okafor family" | Selects `sam-okafor` without a further question |
| C4 | "Sam" → "no" → "Okafor" | Asks which family; then selects `sam-okafor` |
| C5 | "create a story for Theo" | Skips the question; goes straight to the credit step |
| C6 | Credits 0 → yes / no | Yes continues to `conversation`; no ends with the SS9 line; relaunch resumes at `credit` |
| C7 | Unknown "Mia" | SS7 line lists the fixture's distinct names; stage unchanged |
| C8 | Launch with a record in `conversation` | Resume offer; yes continues at `conversation`; no starts fresh |
| C9 | `create_*` 404 from an old API | SS10 line, session ends, `create_unavailable` logged |
| C10 | Session attribute `createStage` without a server record | SS6 restart line |
| C11 | es-ES "vamos a crear una historia" | Unchanged theme prompt and draft flow (existing tests) |
| C12 | Store | Memory and DynamoDB stores satisfy the same contract test; TTL is 7 days; only GetItem and PutItem are used |
| C13 | Generator | New intents en-US only; es-ES byte-identical; the `send` exemption covers only `ChooseListenerIntent` samples |

## Batch eligibility

- Unit A: step 1 and step 2 (`packages/shared`). This comes first, because the others import it.
- Unit B `[batch-eligible]` after A: step 3 (`packages/agent`, `packages/app/src/bootstrap.ts`).
- Unit C `[batch-eligible]` after A: steps 4–7 (`packages/skill`). It talks to B only through the shared schemas and a fake client.

## Exit

Independent review, repair, simplify and the full local gate. The Owner reviews `create-messages.ts`. Record the results in the notes.
