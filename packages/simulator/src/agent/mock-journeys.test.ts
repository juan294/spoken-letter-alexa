import { describe, expect, it } from "vitest";
import { createMockTransport } from "./mock.ts";

async function demo() {
  const transport = createMockTransport();
  const session = await transport.createSession({ mode: "demo" });
  const ask = (text: string) => transport.turn(session.sessionId, text);
  return { transport, session, ask };
}

describe("offline demo journeys", () => {
  it("plays delivered fixture IDs in deterministic playlist order with controls and a fresh token", async () => {
    const { ask } = await demo();
    const first = await ask("play all my stories");
    expect(first.play?.id).toBe("st_ignacio_the_snail");
    const second = await ask("next story");
    expect(second.play?.id).toBe("st_mauricio_the_bull");
    expect(second.play?.token).not.toBe(first.play?.token);
    expect((await ask("previous story")).play?.id).toBe("st_ignacio_the_snail");
    expect((await ask("restart this story")).play).toMatchObject({ id: "st_ignacio_the_snail", offsetInMilliseconds: 0 });
    expect((await ask("repeat this story")).play?.id).toBe("st_ignacio_the_snail");
  });

  it("enqueues a second distinct fixture when the first stream ends", async () => {
    const { transport, session, ask } = await demo();
    await ask("play all my stories");
    const queued = await transport.playbackFinished!(session.sessionId);
    expect(queued?.play?.id).toBe("st_mauricio_the_bull");
  });

  it("selects an adult creator, exact title, and newest delivered fixture", async () => {
    const { ask } = await demo();
    expect((await ask("play stories by Aunt Whitney")).play?.storyteller).toBe("Aunt Whitney");
    expect((await ask("play Martina the music loving mermaid")).play?.id).toBe("st_martina_the_mermaid");
    expect((await ask("play my newest story")).play?.id).toBe("st_mauricio_the_bull");
  });

  it("saves a name-free demo draft and gives a truthful named-listener handoff", async () => {
    const { ask } = await demo();
    expect((await ask("let's create a bedtime story")).say).toMatch(/theme/i);
    const saved = await ask("about mermaids for Morgan");
    expect(saved.say).toMatch(/demo draft.*mermaids/i);
    expect(saved.say).not.toMatch(/Morgan/);
    expect((await ask("send it to Morgan")).say).toMatch(/choose the listener in Spoken Letter.*delivery there/i);
    const readback = await ask("read my latest draft");
    expect(readback.say).toMatch(/demo draft.*mermaids/i);
    expect(readback.say).toMatch(/a friendly mermaid.*lost shell.*friend.*home/i);
    expect(readback.say).not.toMatch(/Morgan/);
    const namedCreation = await ask("create a story for Morgan");
    expect(namedCreation.say).toMatch(/choose the listener in Spoken Letter.*delivery there/i);
  });

  it("does not turn a playback interruption into a saved draft theme", async () => {
    const { ask } = await demo();
    await ask("create a bedtime story");
    expect((await ask("play the forest story")).say).toMatch(/couldn't find that delivered story/i);
    expect((await ask("read my latest draft")).say).toMatch(/no demo draft has been saved/i);
  });

  it("asks for a known adult storyteller when a wish names an unknown creator", async () => {
    const { ask } = await demo();
    const response = await ask("ask Mystery Voice for another mermaid story");
    expect(response.say).toMatch(/which adult storyteller/i);
    expect(response.say).not.toMatch(/Mystery Voice/i);
    expect(response.play).toBeNull();
    expect((await ask("yes")).say).not.toMatch(/wish.*saved/i);
  });

  it("prompts for a completed story once on reopen and keeps the reaction retryable", async () => {
    const { transport, session, ask } = await demo();
    await ask("play Martina the music loving mermaid");
    await transport.playbackFinished!(session.sessionId);
    expect((await ask("open spoken letter")).say).toBe("Did you like or love that story?");
    expect((await ask("open spoken letter")).say).not.toMatch(/did you like or love/i);
    expect((await ask("I love that story")).say).toMatch(/demo reaction was saved/i);
  });

  it("drops an unconfirmed wish when the parent switches to playback", async () => {
    const { ask } = await demo();
    expect((await ask("I want a story about mermaids")).say).toMatch(/confirm a demo wish/i);
    expect((await ask("play my stories")).play?.id).toBe("st_ignacio_the_snail");
    expect((await ask("yes")).say).not.toMatch(/wish.*saved/i);
  });

  it("keeps bounded simulated reaction and wish receipts with duplicate readback", async () => {
    const { transport, session, ask } = await demo();
    await ask("play Martina the music loving mermaid");
    await transport.playbackFinished!(session.sessionId);
    expect((await ask("I love that story")).say).toMatch(/mock-reaction-1/);
    await ask("play Martina the music loving mermaid");
    await transport.playbackFinished!(session.sessionId);
    expect((await ask("I love that story")).say).toMatch(/mock-reaction-1.*already saved/i);
    expect((await ask("read my demo reactions")).say).toMatch(/1 demo reaction receipt.*mock-reaction-1.*Martina/i);

    expect((await ask("I want a story about mermaids")).say).toMatch(/confirm a demo wish/i);
    expect((await ask("yes")).say).toMatch(/mock-wish-1/);
    await ask("I want a story about mermaids");
    expect((await ask("yes")).say).toMatch(/mock-wish-1.*already saved/i);
    expect((await ask("read my demo wishes")).say).toMatch(/1 demo wish receipt.*mock-wish-1.*mermaids/i);
  });

  it("stops claiming new wish saves when the page-session receipt limit is full", async () => {
    const { ask } = await demo();
    const topics = ["mermaids", "space", "ocean", "forest", "animals", "friendship", "bedtime"];
    for (const topic of topics) {
      await ask(`wish for a ${topic} story`);
      expect((await ask("yes")).say).toMatch(/was saved in this simulation/i);
    }
    for (const topic of topics.slice(0, 3)) {
      await ask(`wish for a ${topic} story by Aunt Whitney`);
      expect((await ask("yes")).say).toMatch(/was saved in this simulation/i);
    }
    await ask("wish for a forest story by Aunt Whitney");
    expect((await ask("yes")).say).toMatch(/limit is full.*no new wish was saved/i);
    expect((await ask("read my demo wishes")).say).toMatch(/^10 demo wish receipts/);
  });

  it("handles a synthetic update, completion reaction, wish, occasion, help and credits without real delivery claims", async () => {
    const { transport, session, ask } = await demo();
    expect((await ask("what is new?")).say).toMatch(/demo story.*Martina the music loving mermaid/i);
    expect((await ask("show my demo updates")).say).toMatch(/no unread demo updates/i);
    await ask("play Martina the music loving mermaid");
    await transport.playbackFinished!(session.sessionId);
    const liked = await ask("I love that story");
    expect(liked.say).toMatch(/demo reaction.*saved/i);
    expect((await ask("I want a story about mermaids")).say).toMatch(/confirm.*demo wish.*mermaids/i);
    expect((await ask("yes")).say).toMatch(/demo wish.*mermaids.*saved/i);
    expect((await ask("ask Aunt Whitney for another mermaid story")).say).toMatch(/confirm.*demo wish.*Aunt Whitney/i);
    expect((await ask("yes")).say).toMatch(/demo wish.*mermaids.*saved/i);
    const notification = await ask("check demo notification");
    expect(notification.say).toMatch(/offline simulator did not send a device notification/i);
    expect(notification.say).toMatch(/fixture_new_mermaid_story/);
    expect((await ask("what is new?")).say).toMatch(/demo reaction.*saved/i);
    expect((await ask("any family occasions?")).say).toMatch(/family birthday.*demo story draft/i);
    expect((await ask("how do I create a story?")).say).toMatch(/Spoken Letter.*delivery/i);
    expect((await ask("how do I add credits?")).say).toMatch(/Spoken Letter.*credits/i);
    expect((await ask("buy credits")).say).toMatch(/cannot charge/i);
  });

  it("does not claim an unknown title was delivered", async () => {
    const { ask } = await demo();
    const response = await ask("play The unseen dragon");
    expect(response.play).toBeNull();
    expect(response.say).toMatch(/couldn't find that delivered story/i);
  });
});
