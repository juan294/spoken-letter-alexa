# Phase 5 — Simulated Alexa+ client: agent, Transcribe, Polly, SPA

`packages/agent` (Lambda-shaped HTTP API, runs locally on the same Hono app) and `packages/simulator` (Vite + React SPA). This is the rules-sanctioned demo surface and the AWS Builder centrepiece. It must work with the fixture provider for judges who have no Spoken Letter account, and with a real link for the Owner.

## Design-system note

The SPA is outside the private repository's Tailwind pipeline. `packages/shared/src/brand/tokens.json` is a verbatim copy of `design/tokens.json`; `tokens.test.ts` pins its SHA-256 to the value recorded at copy time and `docs/decisions/0002-vendored-brand-tokens.md` states that a change in the source requires re-copying. `packages/simulator/src/styles/theme.css` projects the `global` and `semantic` colours, the three font families (Newsreader, Mulish, mono stack via Google Fonts), radii (pill 100px default), and shadows (`soft`, `soft-raised`, `panel`) as CSS variables; components use only those variables (an ESLint rule copied from `src/lib/eslint-rules/sl-design.mjs` blocks hex and font literals). Composition matches the "Now Playing" phone in `design/exports/Spoken Letter - Applications.dc.html:143-168`: dark ink panel `--evening-ink` at radius 24, the amber arc `BrandMark` with radial glow (ported from `src/components/ui/wordmark.tsx`), serif cream title with one italic accent, mono amber status chip for the state ("Listening", "Thinking", "Playing"). Page ground is cream, section rhythm cream → white card → ink panel. Every heading has a mono uppercase eyebrow. `MoonPixels` from `src/components/ui/moon-pixels.tsx` is ported for the idle state.

## 1. Agent API (`packages/agent`)

```ts
// src/agent.ts — Strands Agents (TypeScript) + Bedrock
const model = new BedrockModel({ region: "us-east-1", modelId: BEDROCK_MODEL_ID /* anthropic.claude-sonnet or amazon.nova-pro; chosen at deploy by model access */ })
const tools = new McpClient({ transport: streamableHttpTransport(MCP_URL, { bearer: accessToken }) })   // MCP_URL = AgentCore Gateway URL in AWS, /mcp locally
const agent = new Agent({ model, tools: [tools], systemPrompt: ALEXA_PERSONA })
// ALEXA_PERSONA: "You are a warm, brief voice assistant in a family home. Speak in one or two short sentences. When asked for a story, call list_family_stories, pick, then get_family_story and return its audio url in `play`. Never invent stories. Never mention children by name unless the story title does."
export async function turn(session: SessionState, userText: string): Promise<{ say: string; play?: { url, title, storyteller }; toolCalls: ToolTrace[] }>
```

Structured output: the agent returns `{ say, play? }` validated with zod (Strands structured output) so the SPA never parses prose. `ToolTrace` records tool name, latency, and the MCP protocol era used, shown in the SPA's "Under the hood" drawer (judges see the real MCP traffic).

Routes (Hono, mounted under `/agent`):

| Route | Purpose |
|---|---|
| `POST /agent/session` | creates a session (DynamoDB `sla-agent-sessions` in AWS, memory locally); body `{ mode: "demo" \| "linked", accessToken? }`; demo mode uses a client_credentials token minted server-side for subject `demo` |
| `POST /agent/turn` | `{ sessionId, text }` → `{ say, play?, ssmlAudioUrl, toolCalls }`; `say` is synthesized with Polly (neural voice `Joanna`, `en-US`) to a short-lived S3 object URL (locally, a data URL) |
| `POST /agent/transcribe` | receives one utterance (WebM/Opus from MediaRecorder, ≤ 15 s), converts to PCM 16 kHz with `ffmpeg-static`, streams to Amazon Transcribe streaming, returns `{ text }` |

Polly is never used for story audio. The story MP3 URL from `get_family_story` is passed through untouched.

## 2. SPA (`packages/simulator`)

Screens: Idle (moon, "Say 'Alexa, play the story Grandpa sent'"), Listening (mic level ring), Thinking, Reply (Polly audio plays, transcript shown), Playing (family MP3 in an `<audio>` element with the ink "Now Playing" panel, title, storyteller, duration, pause and resume). A keyboard fallback text box exists for judges without a microphone. A "Connect my Spoken Letter" button starts the OAuth flow with the `simulator` client (PKCE in the browser, redirect back to `/demo/callback`), storing the tokens in memory only. "Under the hood" drawer lists MCP tool calls with latency and era.

Wake word: none. A push-to-talk button labelled "Alexa" starts recording; this is stated on screen as a simulation.

## 3. Local run

`pnpm dev` serves `/agent/*` from the Hono app and the SPA through Vite on `:5173` with a proxy. AWS credentials from profile `archy` are needed locally for Bedrock, Polly, and Transcribe; `pnpm dev:offline` swaps them for canned responses so the UI can be developed without AWS.

## 4. Tests

- `packages/agent`: `turn.test.ts` with a mocked Bedrock model (Strands supports custom providers) proving the tool sequence list → get and the structured output; `transcribe.test.ts` with `aws-sdk-client-mock`; `polly.test.ts` same.
- `packages/simulator`: vitest + Testing Library for state transitions; Playwright smoke at 390 and 1280 px widths (memory: jsdom cannot see responsive design) that drives the keyboard fallback against `pnpm dev:offline` and asserts the Now Playing panel renders with the fixture story.
- Brand: `tokens.test.ts` hash pin; ESLint design rule active.

## Success criteria

Automated: all of section 4 green in CI (Playwright uses the offline mode).

Manual (Owner, local with AWS credentials): speak "play a story" into the microphone; Transcribe returns the text; the agent calls the two tools; Polly speaks a one-sentence reply; the fixture story plays in the Now Playing panel. Then "Connect my Spoken Letter" against the Phase 4 local topology plays a real delivered story. Bedrock model access is enabled in the console for the chosen model in `us-east-1` (manual, one time).
