// In-app mock transport, enabled with `VITE_AGENT_MOCK=1`. Playwright runs against it in CI
// where no agent server exists. It answers the same contract as packages/agent with one
// fixture story recorded by the Owner (never a child, never a Recipient name).
import type { AgentTransport, SessionRequest, SessionResponse, TurnResponse } from "./types.ts";

export const FIXTURE_STORY = {
  url: `${import.meta.env.BASE_URL}fixtures/silence.mp3`,
  title: "The owl who forgot how to hoot",
  storyteller: "Grandpa Juan",
  durationSeconds: 184,
} as const;

export const MOCK_TRANSCRIPT = "Alexa, play the story Grandpa sent";

const ERA = "2025-03-26";

export function createMockTransport(): AgentTransport {
  let counter = 0;
  return {
    createSession(request: SessionRequest): Promise<SessionResponse> {
      counter += 1;
      return Promise.resolve({
        sessionId: `mock-${counter}`,
        mode: request.mode,
        subject: request.mode === "linked" ? "linked-subject" : "demo",
        offline: true,
      });
    },
    turn(_sessionId, text): Promise<TurnResponse> {
      const wantsStory = /story|play|grandpa|listen/i.test(text);
      if (!wantsStory) {
        return Promise.resolve({
          say: "I can play the stories your family sent. Try asking for the story Grandpa sent.",
          play: null,
          speechUrl: null,
          toolCalls: [],
        });
      }
      return Promise.resolve({
        say: `Here is "${FIXTURE_STORY.title}", read by ${FIXTURE_STORY.storyteller}.`,
        play: { ...FIXTURE_STORY },
        speechUrl: null,
        toolCalls: [
          { name: "spoken-letter___list_family_stories", ms: 118, era: ERA, ok: true },
          { name: "spoken-letter___get_family_story", ms: 74, era: ERA, ok: true },
        ],
      });
    },
    transcribe() {
      return Promise.resolve({ text: MOCK_TRANSCRIPT });
    },
    health() {
      return Promise.resolve({ ok: true, offline: true, model: null });
    },
  };
}
