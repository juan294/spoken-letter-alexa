# Tool design: Alexa demo use cases

Designed 2026-09-28 on `develop` at `9d58fbb6616bbdad252a35eba3e30bf71e90c273`. Input: `docs/research/2026-09-28-alexa-demo-use-cases-current-state.md` and the Owner's use-case list, modified 2026-09-28. This is an `rpi-tool-design` input to the implementation plan, not an implementation contract for private-app writes.

## User goal

**Outcome:** A parent can ask an Alexa device to play delivered family stories by collection, creator, title, or recency, and can reach clear demo paths for the other listed requests.

**Required context:** The delivered-story catalog, current playback position, playlist order, whether a story was played, and any fixture-only demo state. The existing story provider exposes ID, title, storyteller, delivery time, and optional audio (`packages/mcp-server/src/provider/types.ts:5-28`). The current stream token holds one story (`packages/skill/src/audio.ts:35-68`).

**Boundaries:** The current Alexa agent has three read-only MCP tools (`packages/mcp-server/src/tools/index.ts:10-12`). The provider has no listener, wish, feedback, event, credit, or story-draft operations (`packages/mcp-server/src/provider/types.ts:1-28`). Recipient, delivery, recording, and credit operations are excluded from the current agent-facing contract by `CLASS_C_DENYLIST` (`packages/shared/src/contract/agent-tools.ts:18-40`). The parent speaks; no child's voice, account, or stored recipient name crosses this path (`AGENTS.md:31-34`).

## Initial state

**Application state:** A new device invocation has an Alexa application ID and opaque user ID (`packages/skill/src/handler.ts:9-35`). The skill client opens a `device` session, and the agent may cache the fixture catalog for fifteen minutes (`packages/skill/src/agent-client.ts:65-95`, `packages/agent/src/routes.ts:142-159`, `packages/agent/src/sessions.ts:50-55`). The device's service subject resolves to fixture stories (`packages/agent/src/routes.ts:145-148`, `packages/mcp-server/src/provider/registry.ts:10-25`). No playlist state exists in `AgentSession` (`packages/agent/src/sessions.ts:7-25`).

**Agent context:** It receives one line from the skill's named intent or catch-all (`packages/skill/src/handler.ts:135-159`, `packages/skill/src/handler.ts:234-255`), its persona, and possibly the catalog (`packages/agent/src/persona.ts:1-29`). It does not receive the current AudioPlayer token unless the skill sends it; current controls decode that token locally (`packages/skill/src/handler.ts:108-114`, `packages/skill/src/handler.ts:208-226`).

**System constraints:** `list_family_stories` is capped at 20 per call (`packages/mcp-server/src/tools/schemas.ts:22-31`); the fixture provider is newest first (`packages/mcp-server/src/provider/fixtures.ts:58-76`); `suggest_next_story` rotates oldest first with process-local memory (`packages/mcp-server/src/tools/suggest.ts:17-32`, `packages/mcp-server/src/tools/suggest.ts:40-70`). Agent output is only `say` plus optional `play` (`packages/agent/src/schema.ts:19-22`).

## Role-play: clean request

| Turn | Need and next action | Tool and input | Device or state reaction |
| --- | --- | --- | --- |
| Parent: “Play all my Spoken Letter stories.” | Read the delivered catalog, choose an order, fetch the first fresh URL. | `list_family_stories({ limit: 20 })`, then `get_family_story({ storyId: selected.id })`. | Skill speaks the title and starts the recording. Gap: no persisted playlist or enqueue state currently exists (`packages/skill/src/audio.ts:89-102`, `packages/agent/src/sessions.ts:7-25`). |
| Parent: “Skip this story.” | Identify current story and the next item in the chosen order. | No new MCP tool if the playlist state holds IDs; `get_family_story({ storyId: next.id })` supplies a fresh URL. | Skill replaces playback. Gap: current `AMAZON.NextIntent` asks the agent for a new suggestion instead of advancing a playlist (`packages/skill/src/handler.ts:148-152`). |
| Parent: “Start all over.” | Restart the current story at zero. | No tool for a fixture URL; current skill decodes the token (`packages/skill/src/handler.ts:108-114`, `packages/skill/src/handler.ts:215-217`). | The same story restarts. A signed URL's lifetime is a separate bridge concern (`packages/mcp-server/src/provider/http.ts:80-92`). |
| Parent: “Play my stories from Aunt Whitney, newest first.” | Filter the catalog by storyteller, order by delivery time, fetch the first. | `list_family_stories({ limit: 20 })`, `get_family_story({ storyId: selected.id })`. | A filtered playlist starts. The current provider does not offer server-side creator filtering (`packages/mcp-server/src/provider/types.ts:25-28`). |
| Parent: “Play the Ignacio story.” | Resolve the title to one delivered story, then fetch its URL. | `list_family_stories({ limit: 20 })` if the cached catalog does not settle it; `get_family_story({ storyId: selected.id })`. | Exactly the selected recording starts. The agent must never invent an ID (`packages/agent/src/persona.ts:4-10`). |
| Parent: “What is new?” | Read delivery order and answer. | `list_family_stories({ limit: 20 })`. | Alexa names the newest delivered stories without playing, as the current persona specifies (`packages/agent/src/persona.ts:8-9`). |

## Role-play: vague request

| Turn | Need and next action | Tool and input | Device or state reaction |
| --- | --- | --- | --- |
| Parent: “Play her stories.” | The storyteller is absent from this request and may not be recoverable from history. Ask which adult storyteller. | None until the speaker identifies one. | The session stays open; it does not guess a family member. |
| Parent: “Aunt Whitney.” | Resolve that raw spoken name against catalog values. | `list_family_stories({ limit: 20 })`; `get_family_story({ storyId: matched.id })` after a unique match. | Play starts, or Alexa asks which title if several stories match and no playlist intent was expressed. |
| Parent: “Tell them I liked it.” | “Them” and “it” are ambiguous, and the provider has no feedback operation. | None. | Alexa asks for the intended adult creator or explains that this demo cannot send feedback. It must not claim delivery. |
| Parent: “Add credits.” | Which account, how many credits, and payment authority are absent; the current contract forbids credits. | None. | Alexa gives help or a handoff, with no entitlement change. |

## Tool contracts used by these transcripts

These are the current MCP tools with caller-facing recovery requirements for the planned demo flows. No new agent-facing tool is derived by either playback transcript; playlist order and AudioPlayer control are skill/session state, not another MCP operation.

### `list_family_stories`

- **Effect and input:** List delivered stories for the authenticated subject; optional integer `limit` from 1 to 20, default 10 (`packages/mcp-server/src/tools/list.ts:7-21`, `packages/mcp-server/src/tools/schemas.ts:22-31`). The caller supplies no internal account ID.
- **Return:** `stories[]` containing ID, title, storyteller, and delivery time, plus a spoken summary (`packages/mcp-server/src/tools/list.ts:17-35`, `packages/mcp-server/src/tools/schemas.ts:3-33`).
- **Wrong state:** “Reconnect Spoken Letter in the Alexa app,” the existing `unauthenticated` recovery (`packages/mcp-server/src/tools/index.ts:36-39`).
- **Invalid parameter:** Ask for a number of stories from 1 to 20; never silently broaden a malformed limit (`packages/mcp-server/src/tools/schemas.ts:22-31`).
- **Unexpected return:** “No stories have been delivered yet,” the existing empty-catalog response (`packages/mcp-server/src/tools/list.ts:23-25`).
- **Business rule:** Only delivered stories are in the provider contract and tool description (`packages/mcp-server/src/tools/list.ts:7-12`, `packages/mcp-server/src/provider/types.ts:1-12`). A request for an undelivered story gets an explanation and an available-story choice, never an invented result.

### `get_family_story`

- **Effect and input:** Fetch a fresh playable URL using a story ID obtained from the catalog; the tool schema takes `storyId`, because the caller already has the ID after listing (`packages/mcp-server/src/tools/get.ts:7-31`, `packages/mcp-server/src/tools/schemas.ts:35-37`). Spoken names are resolved before this call.
- **Return:** The delivered story with `audio.url`, expiry, and `audio/mpeg` type (`packages/mcp-server/src/tools/get.ts:18-42`, `packages/mcp-server/src/tools/schemas.ts:10-19`).
- **Wrong state:** Ask for account reconnection if the bearer is invalid (`packages/mcp-server/src/tools/index.ts:36-39`).
- **Invalid parameter:** An empty or too-long ID is rejected by the schema; list stories and select a valid ID (`packages/mcp-server/src/tools/schemas.ts:35-37`).
- **Unexpected return:** If the bridge cannot provide audio, ask the speaker to try another story (`packages/mcp-server/src/tools/index.ts:36-40`, `packages/mcp-server/src/provider/http.ts:84-92`).
- **Business rule:** If the ID is absent, say it was not found and offer the delivered list (`packages/mcp-server/src/tools/get.ts:28-31`).

### `suggest_next_story`

- **Effect and input:** Suggest a delivered story that has waited longest and is not yet in this process's suggestion ring; input is `{}` (`packages/mcp-server/src/tools/suggest.ts:7-18`, `packages/mcp-server/src/tools/suggest.ts:40-70`).
- **Return:** One story or null, with a reason (`packages/mcp-server/src/tools/suggest.ts:37-70`). It does not fetch audio or advance a playlist.
- **Wrong state:** Ask for account reconnection if authentication fails (`packages/mcp-server/src/tools/index.ts:36-39`).
- **Invalid parameter:** Reject nonempty or malformed input; the documented schema is empty (`packages/mcp-server/src/tools/schemas.ts:39-41`).
- **Unexpected return:** Explain there are no delivered stories and ask the parent to check the app (`packages/mcp-server/src/tools/suggest.ts:47-50`).
- **Business rule:** A request for “next in my playlist” uses playlist order, not a new suggestion; the current suggestion behavior is oldest-first rotation (`packages/mcp-server/src/tools/suggest.ts:51-70`).

## Seed evaluations

| Transcript turn | Expected selection and extracted input | Expected state |
| --- | --- | --- |
| Play all | list `{limit:20}`, then get the selected catalog ID | Playlist order saved; first story playing. |
| Skip | get the next saved ID | Position increments once; stale nearly-finished event cannot enqueue an old next story. |
| Start over | no MCP call for a valid fixture token | Current story restarts at offset 0; playlist position does not change. |
| Creator, newest first | list `{limit:20}`, filter exact resolved storyteller, get first ID | Only that creator's delivered stories are in the queue. |
| Named title | list if needed, then get one ID | Title resolution is unique or Alexa asks which story. |
| What's new | list `{limit:20}` | No playback. |
| “Play her stories” | no tool until creator is identified | Alexa asks a clarifying question. |
| “Tell them I liked it” | no write tool | No delivery claim or mutation. |
| “Add credits” | no write tool | No entitlement change. |

## Gaps found for the plan

- Playlist order, position, and event idempotency have no persisted home (`packages/agent/src/sessions.ts:7-25`; `packages/skill/src/handler.ts:198-226`).
- The list tool's 20-story cap and the HTTP provider's `getStory` lookup through a 100-story list set catalog-size limits that a playlist plan must state (`packages/mcp-server/src/tools/schemas.ts:22-31`, `packages/mcp-server/src/provider/http.ts:80-83`).
- No current tool or provider operation can create, deliver, wish, react, notify, or add credits (`packages/mcp-server/src/tools/index.ts:10-12`, `packages/mcp-server/src/provider/types.ts:25-28`). These cannot be treated as completed by free-text routing.
- The current skill manifest has no Proactive Events capability or notification permission (`packages/skill/skill-package/skill.json:31-49`). The [Alexa Proactive Events documentation](https://developer.amazon.com/en-US/docs/alexa/smapi/proactive-events-api.html), retrieved 2026-09-28, requires predefined schemas, manifest declaration, and customer opt-in for device notifications. This is a separate Alexa service path, not an MCP tool.
- The current manifest has no dialog model. Amazon's [Dialog interface reference](https://developer.amazon.com/en-US/docs/alexa/custom-skills/dialog-interface-reference.html), retrieved 2026-09-28, requires a dialog model for Alexa-managed slot elicitation or confirmation. The current skill's multi-turn behavior is agent conversation only (`packages/skill/src/model/generate.ts:270-295`, `packages/skill/src/handler.ts:252-259`).

## Handoff

This design records current read tools and the tool gaps without authorizing a change to the private repository or to the child-safety and paid-entitlement boundaries. The follow-on `/rpi-plan` should cover demo behavior across the Owner's list, distinguish simulated from persisted actions, and recheck this baseline at implementation entry. No code or configuration was changed for this artifact.
