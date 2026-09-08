# Phase 9 — Classic-skill front end for real-device footage

Added 2026-09-08 (plan amendment, Owner decision) after reading Kay Lerch's post "Talk to
an MCP server from an Alexa+ device today, through an Alexa Skill" and the README of
`github.com/KayLerch/alexa-skill-mcp-bridge` (Apache-2.0). Both confirm the research: the
add-on toolkit is invite-only, and a classic Alexa Skill is the only path to a real Alexa+
device without it. This phase puts a thin classic skill in front of the server this
repository already runs, so the demo video can show a real Echo playing a delivered story,
and so the same MCP server is exercised by a second, independent client.

Two ideas are carried over from the bridge. The first, the skill front end itself, is
adopted with one difference: the bridge runs its own Nova agent on AgentCore Runtime,
whereas this repository already has `packages/agent` (Strands on Bedrock, structured
`{ say, play }` output, tool traces) behind `/agent/turn`, so the skill's Lambda calls that
endpoint and adds nothing model-related. The second idea, the interaction-model tactics
(sample utterances generated from the tool schemas, a catch-all intent that forwards
unmatched speech as plain text, a recording mode that logs real phrasings), is adopted
as written. Elicitation is not adopted: the three tools are read-only and never elicit;
the bridge's requirements are recorded in section 6 for the day a tool needs it.

## Design-system note

Non-visual except the skill icons (108 px and 512 px) and the store listing text, which
use the amber arc mark on cream from the vendored tokens (`packages/shared/src/brand`).
The demo shows the parent speaking to the device; never a child; the Recipient's name never
appears in any utterance, response or listing text.

## 1. Where it lives (`packages/skill`, `skill-package/`)

```
packages/skill/
  src/handler.ts          Lambda: Alexa request envelope in, SSML + AudioPlayer directives out
  src/agent-client.ts     POST ${PUBLIC_BASE_URL}/agent/session and /agent/turn
  src/audio.ts            AudioPlayer.Play / Stop / ClearQueue directive builders
  src/model/generate.ts   interaction-model generator (section 3)
  src/*.test.ts
skill-package/
  skill.json              manifest: custom API, AudioPlayer interface, en-US, endpoint ARN written by the deploy script
  interactionModels/custom/en-US.json   generated, committed
  training/               recorded utterances (section 3), committed when useful
infra/lib/skill-stack.ts  SkillStack: the skill Lambda, its log group, the Alexa Skills Kit trigger permission
```

The Lambda is thin by design (the bridge's Lambda is the same shape): it checks the
skill id in `context.System.application.applicationId` (a Lambda endpoint receives no
request signature; the Alexa Skills Kit trigger permission plus this check is Amazon's
documented verification for Lambda-hosted skills), maps the intent or catch-all text to
one line of text, calls the agent, and renders the reply. It never talks to `/mcp` itself; the agent
does, over the same JWT-gated endpoint Alexa+ will use. `packages/agent` grows one thing:
`/agent/session` accepts `{ mode: "device", deviceUserId }` so the session table keys a
device conversation by Alexa's `userId` (an opaque, per-skill id; no name, no child data),
with the same 2-hour TTL.

## 2. The turn (`src/handler.ts`)

| Alexa request | Text sent to `/agent/turn` | Reply |
| --- | --- | --- |
| `LaunchRequest` | none | SSML: "Spoken Letter. Which family story would you like?" plus a reprompt |
| `PlayStoryIntent` (slots `storyteller?`, `title?`) | "play the story {title} by {storyteller}" | SSML `say`, then `AudioPlayer.Play` with `play.url` when present |
| `WhatIsNewIntent` | "what family stories are new?" | SSML `say` |
| `NextStoryIntent` | "play the next family story" | SSML `say` plus `AudioPlayer.Play` |
| `CatchAllIntent` (slot `text`, `AMAZON.SearchQuery`) | the slot value verbatim | as above |
| `AMAZON.PauseIntent`, `AMAZON.ResumeIntent`, `AMAZON.StopIntent`, `AMAZON.CancelIntent` | none | `AudioPlayer.Stop` / resume from the stored offset / stop |
| `AudioPlayer.PlaybackStarted` and friends | none | empty response; offset stored for resume |
| `AMAZON.HelpIntent`, `AMAZON.FallbackIntent` | none | one sentence and the reprompt |

`AudioPlayer.Play` streams the family MP3 from `play.url` (the fixture URL on
`alexa.spokenletter.com/fixtures/audio/` or the signed Spoken Letter URL) to a real Echo:
this is the real-device playback the toolkit path could not demonstrate without access.
Polly is not used on the device path; Alexa's own voice speaks `say` from SSML. The
`speechUrl` field is ignored there.

Timing: Alexa allows about 8 seconds for the skill's response. The agent's turn (list
plus get) measured under 100 ms locally against the fixtures; Bedrock adds one model call.
The Lambda sets a 6-second budget on `/agent/turn` and answers "I'm still looking; ask
again in a moment" on timeout rather than letting the skill error.

## 3. Interaction model (`src/model/generate.ts`, `pnpm -F skill generate`)

Inputs: `TOOL_METADATA` from `packages/mcp-server` (names, descriptions, input schemas) and
`skill-package/training/*.jsonl` (recorded phrasings). Output:
`skill-package/interactionModels/custom/en-US.json` with:

- one intent per tool (`PlayStoryIntent` for `get_family_story`, `WhatIsNewIntent` for
  `list_family_stories`, `NextStoryIntent` for `suggest_next_story`) and sample
  utterances derived from the tool descriptions plus a fixed list the Owner reviews,
- `CatchAllIntent` with one `AMAZON.SearchQuery` slot and the sample utterances that make
  Alexa route free text to it ("{text}", "ask spoken letter {text}", "tell spoken letter
  {text}"),
- the built-in intents in the table above, and the invocation name `spoken letter`.

Deterministic (no model call): the utterance list is code, tested, and reviewed in the
diff. Recording mode: `RECORD_UTTERANCES=1` on the Lambda logs every `CatchAllIntent`
text to CloudWatch; `pnpm -F skill record:pull` appends them to `training/en-US.jsonl`
for the next `generate` (the bridge's "recording mode", done with logs instead of a local
chat). No transcript is ever shown to a child, and the Owner reviews the file before it
is committed.

## 4. Deploy and skill registration

- `SkillStack` (added to `infra/bin/app.ts`): the skill Lambda (Node 24, arm64, 256 MB,
  bundled by `infra/scripts/bundle-lambda.mjs` with a second entry), environment
  `PUBLIC_BASE_URL`, `SKILL_ID`, `RECORD_UTTERANCES`; `lambda:InvokeFunction` permission
  for principal `alexa-appkit.amazon.com` restricted to the skill id (`EventSourceToken`).
- `pnpm -F skill deploy`: writes the Lambda ARN into `skill-package/skill.json`
  (`apis.custom.endpoint.uri`), runs `ask deploy`, records the skill id into
  `infra/cdk.context.json` as `sla:skillId`, and tells the Owner to run `pnpm deploy`
  once more so the permission is locked to that id. ASK CLI is installed and configured
  by the Owner (`ask configure`, Owner gate; the developer console account is the one
  from `amazon/us-account-checklist.md`).
- Test stage only: the skill is never submitted for certification; "Development" testing
  on the Owner's devices is the goal. Devices must be on the same Amazon account and
  set to `en-US`; whether an Alexa+ device in Spain routes to a development-stage custom
  skill is the first thing to record (unknown, as in `amazon/us-account-checklist.md`).

## 5. Tests

- `handler.test.ts`: skill-id verification (reject a wrong or missing application id),
  every row of the table in section 2 with a mocked `/agent/turn`, the 6-second budget
  path, offset storage for pause and resume.
- `model/generate.test.ts`: the generated model has one intent per tool, the catch-all
  with `AMAZON.SearchQuery`, no utterance containing a denylisted fragment or a name, and
  is byte-identical to the committed `en-US.json` (drift check).
- `agent-client.test.ts`: session reuse by `deviceUserId`, timeout, error mapping.
- `infra/test/stacks.test.ts`: `SkillStack` synthesizes; the invoke permission carries
  the `EventSourceToken`; the Lambda role has no permissions beyond logs.
- `packages/agent`: the new `device` mode in `routes.test.ts`.

## 6. Elicitation (recorded, not implemented)

The bridge parks an open `tools/call` inside its AgentCore microVM between Alexa turns
and resumes it with the user's answer; it requires the server to set `relatedRequestId`
on the elicitation, an `elicitInput` timeout above the SDK's 60-second default, and a
`ping` every 15 seconds; it supports form mode only (flat primitives), not URL mode, and
not the 2026-07-28 stateless elicitation. None of the three tools here elicits. If a
future tool needs a follow-up question, add it through the agent's conversation (a
second turn), not through MCP elicitation, unless Alexa+ itself documents elicitation
support for add-ons.

## Success criteria

Automated: `pnpm -F skill test` green; `generate` is deterministic and the drift check
passes; `SkillStack` template assertions pass; the root gate stays green.

Manual (Owner): `ask deploy` to the development stage; in the developer console
simulator, "open spoken letter" then "play the story Grandpa sent" returns the fixture
story and an `AudioPlayer.Play` directive; on the Owner's Echo the recording plays; the
utterance, the response and whether audio played are recorded in the friction log with
the device model and language. If the Alexa+ device does not route to the skill, record
that too: it is the answer to the unknown in `amazon/us-account-checklist.md`.

## Risks

| Risk | Signal | Fallback |
| --- | --- | --- |
| Alexa+ devices do not surface development-stage custom skills | "I don't know that one" on the device while the simulator works | A classic Echo (non-Plus) on the same account plays the story; the video says so |
| Custom-skill response deadline | timeouts on cold Bedrock calls | `MemorySessionStore` warm path plus the 6-second budget reply; provisioned concurrency is out of scope |
| Interaction model misses phrasings | `AMAZON.FallbackIntent` in the logs | Recording mode plus `generate` before the video |
