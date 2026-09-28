# Phase 2: guided story draft and help

Entry: Phase 1 accepted on `develop`, its playlist state and device control contract revalidated. This phase gives the parent a voice path to prepare a **demo draft** and learn how the private app finishes delivery or adds credits. It does not select a child, send a story, record voice, or change a paid entitlement (`AGENTS.md:31-34`; `packages/shared/src/contract/agent-tools.ts:18-40`).

## Behavioral oracles

- “Let's create a bedtime story” asks for a theme. After the parent gives a theme, the agent produces a short adult-owned draft outline and the demo store saves it once. The response says “I saved a demo draft. Open Spoken Letter to choose the listener and finish it.” It does not claim delivery. The present agent output is limited to short `say` and optional `play`, so a separate structured draft response is required (`packages/agent/src/schema.ts:19-22`).
- “Create a story for [name]” and “send [name] a Spoken Letter” route to the same safe handoff: Alexa does not repeat, persist, or log the supplied name. It can offer to create a name-free demo outline. The raw request may arrive through catch-all; the current recorder logs catch-all text when enabled, so redaction must happen before recording or telemetry (`packages/skill/src/handler.ts:153-155`, `packages/skill/src/handler.ts:234-238`; `packages/skill/src/lambda.ts:26-36`).
- “How do I create a story?” gives actionable steps for the private app without asserting a voice draft was sent. “How do I add credits?” explains the app path and says Alexa cannot charge or change credits. “Add story credits” makes no write and gives the same handoff. The current help line only describes playback (`packages/skill/src/handler.ts:63-68`, `packages/skill/src/handler.ts:227-229`).
- A missing theme gets one question and can complete on the next turn; a canceled draft leaves no saved item. The saved demo draft is addressable by the parent for this rehearsal, but no private-app account or recipient identifier enters it.

## Implementation specification

- Introduce a typed `demo` interaction store with hashed device key, draft ID, theme, bounded outline text, timestamps, TTL, and status. Keep it separate from private-app bridge records and add a bounded cleanup path; extend CDK only for this demo store and its least-privilege access. No draft payload goes into ordinary telemetry.
- Add a dedicated draft route and schema in the agent package, reusing the existing Bedrock model dependency for text generation while keeping the three MCP tools read-only (`packages/agent/src/routes.ts:11-29`, `packages/agent/src/turn.ts:96-107`). Authenticate the skill-to-agent action, validate theme length and output, and save with an idempotency key derived from the Alexa request ID. Retry with that key returns the prior draft.
- Add generated `StartStoryIntent` and `HelpTopicIntent` phrases that avoid child names and paid-action promises. Use a slot or explicit state to ask for a theme; if adopting Alexa `Dialog.ElicitSlot`, first add a matching dialog model and verify it with ASK, as required by Amazon's [Dialog interface](https://developer.amazon.com/en-US/docs/alexa/custom-skills/dialog-interface-reference.html), retrieved 2026-09-28. Catch-all remains a safe fallback, never a direct delivery command (`packages/skill/src/model/generate.ts:128-148`, `packages/skill/src/model/generate.ts:270-295`).

```
@ saveDemoDraft(deviceKey, requestId, theme) -> draftReceipt
ctx: authenticatedSkillCall, model, demoStore, clock
pre: theme comes from parent speech; no listener identifier is accepted
do:
  1. validate theme and request identity
  2. lookup prior receipt for requestId
  3. compute bounded outline from model
  4. write draft and receipt once with TTL
  5. emit truthful demo receipt
br: if duplicate -> emit prior receipt; if theme absent -> ask for theme
fail: model or store unavailable -> say nothing was saved and offer retry
risk: free speech can contain a child's name, so redact before persistence
```

## Work units and tests

Unit A owns the demo draft store, typed route, and tests in agent/infra. Unit B owns skill routing, model generator, and help copy after A's response contract is set. No overlapping file ownership or parallel publication. Test with paraphrased creation and help utterances, missing/canceled theme, duplicate request, model failure, store failure and recovery, named-listener redaction, credit-action refusal, and no outbound delivery/charge. An assertion must fail if the spoken response says “sent,” “charged,” or “saved” on an unsuccessful write. Check both generated model drift and the manifest examples.

Run the full sequential `python3 .rpi/scripts/rpi-verify.py` gate (`.rpi/policy.json:7-42`). After separately authorized metadata/deploy actions, the Owner speaks the creation, missing-theme, name-bearing, help, and credits examples on a device; read back the demo draft and verify that no recipient field or credit mutation exists. Stop for Phase 2 acceptance.

## Handoff

Phase 3 may use the demo store's idempotency and parent-device key pattern, but it must not treat drafts as delivered stories or notification sources. The final demo script labels this as a draft prepared in the fixture environment.
