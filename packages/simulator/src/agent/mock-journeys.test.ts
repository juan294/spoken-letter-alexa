import { describe, expect, it } from "vitest";
import { createMockTransport } from "./mock.ts";

async function demo() {
  const transport = createMockTransport();
  const session = await transport.createSession({ mode: "demo" });
  const ask = async (text: string) => {
    const response = await transport.turn(session.sessionId, text);
    expect(response.say).not.toMatch(/\b(?:demo|fixture|simulation|prototype|synthetic|name-free|mock)\b/i);
    expect(response.say).not.toMatch(/not sent|not contact|not been sent/i);
    return response;
  };
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
    expect((await ask("play my newest story")).play?.id).toBe("st_a_kitten_book_club");
    expect((await ask("play stories by Aunt Jordan")).play?.storyteller).toBe("Aunt Jordan");
    expect((await ask("play El Trasgu by Tío Manuel")).play).toMatchObject({ id: "st_el_trasgu", storyteller: "Tío Manuel" });
    expect((await ask("play stories by Tio Manuel")).play?.id).toBe("st_el_trasgu");
  });

  it("saves a name-free story draft and gives a truthful named-listener handoff", async () => {
    const { ask } = await demo();
    expect((await ask("let's create a bedtime story")).say).toMatch(/story.*about/i);
    const saved = await ask("about mermaids for Morgan");
    expect(saved.say).toMatch(/story draft.*mermaids/i);
    expect(saved.say).not.toMatch(/Morgan/);
    expect((await ask("send it to Morgan")).say).toMatch(/Spoken Letter to choose the listener/i);
    const readback = await ask("read my latest draft");
    expect(readback.say).toMatch(/story draft.*mermaids/i);
    expect(readback.say).toMatch(/a friendly mermaid.*lost shell.*friend.*home/i);
    expect(readback.say).not.toMatch(/Morgan/);
    const namedCreation = await ask("create a story for Morgan");
    expect(namedCreation.say).toMatch(/Spoken Letter to choose the listener/i);
  });

  it("does not turn a playback interruption into a saved draft theme", async () => {
    const { ask } = await demo();
    await ask("create a bedtime story");
    expect((await ask("play the forest story")).say).toMatch(/couldn't find that delivered story/i);
    expect((await ask("read my latest draft")).say).toMatch(/no story draft has been saved/i);
  });

  it("asks for a known adult storyteller when a wish names an unknown creator", async () => {
    const { ask } = await demo();
    const response = await ask("ask Mystery Voice for another mermaid story");
    expect(response.say).toMatch(/who would you like a story from/i);
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
    expect((await ask("I love that story")).say).toMatch(/reaction was saved/i);
  });

  it("drops an unconfirmed wish when the parent switches to playback", async () => {
    const { ask } = await demo();
    expect((await ask("I want a story about mermaids")).say).toMatch(/confirm a wish/i);
    expect((await ask("play my stories")).play?.id).toBe("st_ignacio_the_snail");
    expect((await ask("yes")).say).not.toMatch(/wish.*saved/i);
  });

  it("keeps bounded simulated reaction and wish receipts with duplicate readback", async () => {
    const { transport, session, ask } = await demo();
    await ask("play Martina the music loving mermaid");
    await transport.playbackFinished!(session.sessionId);
    expect((await ask("I love that story")).say).toMatch(/reaction was saved/i);
    await ask("play Martina the music loving mermaid");
    await transport.playbackFinished!(session.sessionId);
    expect((await ask("I love that story")).say).toMatch(/reaction was already saved/i);
    expect((await ask("read my reactions")).say).toMatch(/1 saved reaction.*Martina/i);

    expect((await ask("I want a story about mermaids")).say).toMatch(/confirm a wish/i);
    expect((await ask("yes")).say).toMatch(/wish.*was saved/i);
    await ask("I want a story about mermaids");
    expect((await ask("yes")).say).toMatch(/wish was already saved/i);
    expect((await ask("read my wishes")).say).toMatch(/1 saved wish.*mermaids/i);
  });

  it("stops claiming new wish saves when the page-session receipt limit is full", async () => {
    const { ask } = await demo();
    const topics = ["mermaids", "space", "ocean", "forest", "animals", "friendship", "bedtime"];
    for (const topic of topics) {
      await ask(`wish for a ${topic} story`);
      expect((await ask("yes")).say).toMatch(/was saved/i);
    }
    for (const topic of topics.slice(0, 3)) {
      await ask(`wish for a ${topic} story by Aunt Whitney`);
      expect((await ask("yes")).say).toMatch(/was saved/i);
    }
    await ask("wish for a forest story by Aunt Whitney");
    expect((await ask("yes")).say).toMatch(/no new wish was saved.*try again later/i);
    expect((await ask("read my wishes")).say).toMatch(/^10 saved wishes/);
  });

  it("handles a synthetic update, completion reaction, wish, occasion, help and credits without real delivery claims", async () => {
    const { transport, session, ask } = await demo();
    expect((await ask("what is new?")).say).toMatch(/story.*Martina the music loving mermaid/i);
    expect((await ask("show my updates")).say).toMatch(/no unread updates/i);
    await ask("play Martina the music loving mermaid");
    await transport.playbackFinished!(session.sessionId);
    const liked = await ask("I love that story");
    expect(liked.say).toMatch(/reaction.*saved/i);
    expect((await ask("I want a story about mermaids")).say).toMatch(/confirm.*wish.*mermaids/i);
    expect((await ask("yes")).say).toMatch(/wish.*mermaids.*saved/i);
    expect((await ask("ask Aunt Whitney for another mermaid story")).say).toMatch(/confirm.*wish.*Aunt Whitney/i);
    expect((await ask("yes")).say).toMatch(/wish.*mermaids.*saved/i);
    const notification = await ask("check notification");
    expect(notification.say).toMatch(/ask what is new/i);
    expect(notification.say).toMatch(/latest updates/i);
    expect((await ask("what is new?")).say).toMatch(/reaction.*saved/i);
    expect((await ask("any family occasions?")).say).toMatch(/family birthday.*create a story/i);
    expect((await ask("how do I create a story?")).say).toMatch(/choose who to send it to in Spoken Letter/i);
    expect((await ask("how do I add credits?")).say).toMatch(/credits.*Spoken Letter/i);
    expect((await ask("buy credits")).say).toMatch(/credits.*Spoken Letter/i);
  });

  it("does not claim an unknown title was delivered", async () => {
    const { ask } = await demo();
    const response = await ask("play The unseen dragon");
    expect(response.play).toBeNull();
    expect(response.say).toMatch(/couldn't find that delivered story/i);
  });
});
