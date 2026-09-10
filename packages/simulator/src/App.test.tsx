import { fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { createHttpTransport } from "./agent/http.ts";
import { PENDING_KEY } from "./oauth/connect.ts";
import { demoSession, FIXTURE_TURN, routedFetch, type Route } from "./test/agent-fixtures.ts";

const ORIGIN = "http://localhost:5173";

function renderApp(routes: Record<string, Route>, options: { path?: string; search?: string; strict?: boolean } = {}) {
  const fetchImpl = routedFetch({ "POST /agent/session": demoSession, ...routes });
  const navigate = vi.fn();
  const transport = createHttpTransport({ fetchImpl, origin: ORIGIN });
  const app = (
    <App
      transport={transport}
      origin={ORIGIN}
      path={options.path ?? "/demo/"}
      search={options.search ?? ""}
      navigate={navigate}
      fetchImpl={fetchImpl}
    />
  );
  const utils = render(options.strict ? <StrictMode>{app}</StrictMode> : app);
  return { ...utils, fetchImpl, navigate };
}

/** Number of requests the stub saw for `METHOD /path`. */
function calls(fetchImpl: ReturnType<typeof routedFetch>, method: string, path: string): number {
  return fetchImpl.mock.calls.filter(([input, init]) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const m = input instanceof Request ? input.method : (init?.method ?? "GET");
    return m === method && new URL(url, ORIGIN).pathname === path;
  }).length;
}

async function ask(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: /ask alexa by keyboard/i }), text);
  await user.click(screen.getByRole("button", { name: /^send$/i }));
}

const chip = () => screen.getByTestId("status-chip");

describe("simulated Alexa+ client", () => {
  it("states that it is a simulation with push-to-talk and no wake word", () => {
    renderApp({});
    const notice = screen.getByTestId("simulation-notice");
    expect(notice).toHaveTextContent(/simulation/i);
    expect(notice).toHaveTextContent(/push-to-talk/i);
    expect(notice).toHaveTextContent(/no wake word/i);
    expect(screen.getByRole("button", { name: /^alexa$/i })).toBeInTheDocument();
  });

  it("renders the wordmark with an italic Letter and a mono eyebrow above every heading", () => {
    renderApp({});
    const wordmark = screen.getByTestId("wordmark");
    expect(wordmark).toHaveTextContent("Spoken");
    expect(within(wordmark).getByText("Letter").tagName).toBe("EM");
    expect(within(wordmark).getByTestId("brand-mark")).toBeInTheDocument();
    for (const heading of screen.getAllByRole("heading")) {
      const eyebrow = heading.previousElementSibling;
      expect(eyebrow, heading.textContent).not.toBeNull();
      expect(eyebrow).toHaveClass("eyebrow");
    }
  });

  it("starts idle with the moon and the sample utterance", async () => {
    renderApp({});
    expect(chip()).toHaveTextContent("Idle");
    expect(screen.getByRole("img", { name: /crescent moon/i })).toBeInTheDocument();
    expect(screen.getByText(/Say 'Alexa, play the story Grandpa sent'/)).toBeInTheDocument();
    expect(await screen.findByTestId("mode-chip")).toHaveTextContent("Demo mode");
  });

  it("walks Idle → Thinking → Replying → Playing through the keyboard fallback", async () => {
    let resolveTurn: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveTurn = resolve;
    });
    const { fetchImpl } = renderApp({ "POST /agent/turn": () => pending });

    await ask("Alexa, play the story Grandpa sent");
    expect(chip()).toHaveTextContent("Thinking");
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();

    resolveTurn(Response.json({ ...FIXTURE_TURN, speechUrl: "data:audio/mpeg;base64,AAAA" }));
    expect(await screen.findByText("Here is the story Grandpa sent.")).toBeInTheDocument();
    expect(chip()).toHaveTextContent("Replying");
    expect(screen.getByText("Alexa, play the story Grandpa sent", { selector: "p" })).toBeInTheDocument();

    const reply = screen.getByTestId("reply-audio");
    expect(reply).toHaveAttribute("src", "data:audio/mpeg;base64,AAAA");
    fireEvent(reply, new Event("ended"));

    expect(await screen.findByText("The owl who forgot how to hoot")).toBeInTheDocument();
    expect(chip()).toHaveTextContent("Playing");
    const panel = screen.getByTestId("now-playing");
    expect(panel).toHaveTextContent("Grandpa Juan");
    expect(panel).toHaveTextContent("3:04");
    expect(within(panel).getByTestId("story-audio")).toHaveAttribute("src", "/fixtures/silence.mp3");

    const turnCall = fetchImpl.mock.calls.find(([input]) => String(input instanceof Request ? input.url : input).endsWith("/agent/turn"));
    expect(turnCall).toBeDefined();
  });

  it("goes straight to Playing when the reply has no speech audio, and pauses and resumes", async () => {
    renderApp({ "POST /agent/turn": () => Response.json(FIXTURE_TURN) });
    await ask("play the story");
    expect(await screen.findByText("The owl who forgot how to hoot")).toBeInTheDocument();
    expect(chip()).toHaveTextContent("Playing");
    const art = screen.getByTestId("now-playing-art");
    expect(art).toHaveAttribute("src", "/fixtures/story-art.png");
    expect(art).toHaveAccessibleName("Artwork for The owl who forgot how to hoot");

    const audio = screen.getByTestId("story-audio");
    const pause = vi.spyOn(audio as HTMLAudioElement, "pause");
    Object.defineProperty(audio, "duration", { value: 184, configurable: true });
    Object.defineProperty(audio, "currentTime", { value: 92, configurable: true, writable: true });
    fireEvent(audio, new Event("timeupdate"));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("1:32")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /pause/i }));
    expect(pause).toHaveBeenCalled();
    expect(chip()).toHaveTextContent("Paused");
    await user.click(screen.getByRole("button", { name: /resume/i }));
    expect(chip()).toHaveTextContent("Playing");
  });

  it("lists every tool call across turns in the Under the hood drawer", async () => {
    renderApp({ "POST /agent/turn": () => Response.json(FIXTURE_TURN) });
    const user = userEvent.setup();
    await ask("play the story");
    await screen.findByText("The owl who forgot how to hoot");
    await user.click(screen.getByRole("button", { name: /under the hood/i }));
    const drawer = screen.getByTestId("under-the-hood");
    const rows = within(drawer).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("list_family_stories");
    expect(within(rows[0]!).getByText("list_family_stories")).toHaveAttribute("title", "spoken-letter___list_family_stories");
    expect(rows[0]).toHaveTextContent("120 ms");
    expect(rows[0]).toHaveTextContent("2025-03-26");
    expect(rows[0]).toHaveTextContent("ok");

    await user.clear(screen.getByRole("textbox", { name: /ask alexa by keyboard/i }));
    await ask("play it again");
    expect(await within(drawer).findAllByRole("listitem")).toHaveLength(4);
  });

  it("shows the agent error and returns to Idle", async () => {
    renderApp({
      "POST /agent/turn": () => Response.json({ error: "upstream", message: "Bedrock is unavailable" }, { status: 502 }),
    });
    await ask("play the story");
    expect(await screen.findByRole("alert")).toHaveTextContent("Bedrock is unavailable");
    expect(chip()).toHaveTextContent("Idle");
    expect(screen.queryByTestId("now-playing-title")).not.toBeInTheDocument();
  });

  it("starts the PKCE flow from Connect my Spoken Letter", async () => {
    const { navigate } = renderApp({});
    await userEvent.setup().click(screen.getByRole("button", { name: /connect my spoken letter/i }));
    expect(navigate).toHaveBeenCalledTimes(1);
    const url = new URL(navigate.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/oauth/authorize`);
    expect(url.searchParams.get("client_id")).toBe("simulator");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/demo/callback`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "{}") as { verifier?: string; state?: string };
    expect(pending.state).toBe(url.searchParams.get("state"));
    expect(pending.verifier).toHaveLength(43);
    expect(localStorage.length).toBe(0);
  });

  it("finishes the link on /demo/callback, shows Connected, and forgets the token on disconnect", async () => {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier: "v".repeat(43), state: "st" }));
    const sessions: unknown[] = [];
    const { navigate } = renderApp(
      {
        "POST /oauth/token": () => Response.json({ access_token: "jwt-1", token_type: "Bearer", expires_in: 900, scope: "mcp:tools" }),
        "POST /agent/session": ({ body }) => {
          sessions.push(body);
          const mode = (body as { mode: string }).mode;
          return Response.json({ sessionId: `s-${mode}`, mode, subject: mode === "linked" ? "uid-1" : "demo", offline: true });
        },
      },
      { path: "/demo/callback", search: "?code=c0de&state=st" },
    );
    expect(await screen.findByTestId("mode-chip")).toHaveTextContent("Connected");
    expect(sessions).toContainEqual({ mode: "linked", accessToken: "jwt-1" });
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/demo/", "replace");

    await userEvent.setup().click(screen.getByRole("button", { name: /disconnect/i }));
    expect(await screen.findByRole("button", { name: /connect my spoken letter/i })).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(sessions.at(-1)).toEqual({ mode: "demo" });
    });
    expect(await screen.findByTestId("mode-chip")).toHaveTextContent("Demo mode");
  });

  it("pauses the playing story when a new turn starts", async () => {
    let resolveTurn: (response: Response) => void = () => undefined;
    let turns = 0;
    renderApp({
      "POST /agent/turn": () => {
        turns += 1;
        if (turns === 1) return Response.json(FIXTURE_TURN);
        return new Promise<Response>((resolve) => {
          resolveTurn = resolve;
        });
      },
    });
    await ask("play the story");
    expect(await screen.findByText("The owl who forgot how to hoot")).toBeInTheDocument();
    expect(chip()).toHaveTextContent("Playing");
    const audio = screen.getByTestId<HTMLMediaElement>("story-audio");
    const pause = vi.spyOn(audio, "pause");

    await ask("play another one");
    expect(chip()).toHaveTextContent("Thinking");
    expect(pause).toHaveBeenCalled();

    resolveTurn(Response.json({ say: "Bedtime.", play: null, speechUrl: null, toolCalls: [] }));
    expect(await screen.findByText("Bedtime.")).toBeInTheDocument();
    expect(chip()).toHaveTextContent("Idle");
    expect(screen.queryByTestId("story-audio")).not.toBeInTheDocument();
  });

  it("creates exactly one session per page load under StrictMode", async () => {
    const { fetchImpl } = renderApp({}, { strict: true });
    expect(await screen.findByTestId("mode-chip")).toHaveTextContent("Demo mode");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls(fetchImpl, "POST", "/agent/session")).toBe(1);
  });

  it("exchanges the authorization code exactly once under StrictMode and ends Connected", async () => {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier: "v".repeat(43), state: "st" }));
    const { fetchImpl } = renderApp(
      {
        "POST /oauth/token": () => Response.json({ access_token: "jwt-1", token_type: "Bearer", expires_in: 900, scope: "mcp:tools" }),
        "POST /agent/session": ({ body }) => {
          const mode = (body as { mode: string }).mode;
          return Response.json({ sessionId: `s-${mode}`, mode, subject: mode === "linked" ? "uid-1" : "demo", offline: true });
        },
      },
      { path: "/demo/callback", search: "?code=c0de&state=st", strict: true },
    );
    expect(await screen.findByTestId("mode-chip")).toHaveTextContent("Connected");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls(fetchImpl, "POST", "/oauth/token")).toBe(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
