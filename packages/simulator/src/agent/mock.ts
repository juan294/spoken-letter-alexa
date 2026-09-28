// Offline in-app rehearsal. This follows the delivered fixture catalog; it does not
// call Amazon, save a private recipient, deliver a story, or alter credits.
import catalog from "../../../../fixtures/stories.json" with { type: "json" };
import eventCatalog from "../../../../fixtures/events.json" with { type: "json" };
import ignacioAudio from "../../../../fixtures/audio/st_ignacio_the_snail.mp3?url";
import mauricioAudio from "../../../../fixtures/audio/st_mauricio_the_bull.mp3?url";
import martinaAudio from "../../../../fixtures/audio/st_martina_the_mermaid.mp3?url";
import ignacioArt from "../../../../fixtures/art/st_ignacio_the_snail.png?url";
import mauricioArt from "../../../../fixtures/art/st_mauricio_the_bull.png?url";
import martinaArt from "../../../../fixtures/art/st_martina_the_mermaid.png?url";
import type { AgentTransport, Play, SessionRequest, SessionResponse, TurnResponse } from "./types.ts";

export const FIXTURE_STORIES = catalog.stories;
const firstFixture = FIXTURE_STORIES[0];
if (!firstFixture) throw new Error("The offline demo needs a delivered fixture story.");
const defaultStoryteller = firstFixture.storyteller;
export const FIXTURE_STORY = firstFixture;
export const MOCK_TRANSCRIPT = "Alexa, play my stories";

const ASSETS: Record<string, { audio: string; art: string }> = {
  st_ignacio_the_snail: { audio: ignacioAudio, art: ignacioArt },
  st_mauricio_the_bull: { audio: mauricioAudio, art: mauricioArt },
  st_martina_the_mermaid: { audio: martinaAudio, art: martinaArt },
};

const ERA = "2025-03-26";
const TOOL_CALLS = [
  { name: "spoken-letter___list_family_stories", ms: 118, era: ERA, ok: true },
  { name: "spoken-letter___get_family_story", ms: 74, era: ERA, ok: true },
];
const TOPICS: [string, RegExp][] = [
  ["mermaids", /\bmermaids?\b/i], ["space", /\b(?:space|stars?|planets?)\b/i],
  ["ocean", /\b(?:ocean|sea|beach)\b/i], ["forest", /\b(?:forest|woods?)\b/i],
  ["animals", /\b(?:animals?|cats?|dogs?)\b/i], ["friendship", /\b(?:friends?|friendship)\b/i],
  ["bedtime", /\b(?:bedtime|sleep)\b/i],
];
const DRAFT_OUTLINES: Record<string, string> = {
  mermaids: "A friendly mermaid finds a lost shell, asks a friend for help, and brings it home.",
  space: "A curious explorer spots a new star, follows its light, and finds the way home.",
  ocean: "A small boat follows a bright fish, finds a quiet cove, and returns before sunset.",
  forest: "A gentle fox follows a trail, helps a friend, and finds a safe clearing.",
  animals: "Two animals solve a small problem together and share what they learned.",
  friendship: "Two friends disagree, listen to each other, and make a kind new plan.",
  bedtime: "A sleepy traveler finishes one last task, says goodnight, and rests.",
};

const normalize = (text: string) => text.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
const topicIn = (text: string) => TOPICS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
const noPlay = (say: string): TurnResponse => ({ say, play: null, speechUrl: null, toolCalls: [] });
const RECEIPT_LIMIT = 10;

export function createMockTransport(): AgentTransport {
  const newStoryEvent = eventCatalog.events.find((event) => event.type === "new_story");
  const newStory = FIXTURE_STORIES.find((story) => story.id === newStoryEvent?.storyId);
  const unreadUpdates = newStory
    ? [`A new demo story is ready. "${newStory.title}" by ${newStory.storyteller}. This is a fixture update.`]
    : [];
  let sessionCounter = 0;
  let tokenCounter = 0;
  let playlist: string[] = [];
  let index = -1;
  let currentId: string | null = null;
  let pendingReactionId: string | null = null;
  let reactionPrompted = false;
  let latestDraft: { theme: string; outline: string } | null = null;
  let awaitingTheme = false;
  let pendingWish: { topic: string; storyteller: string | null } | null = null;
  const reactions: { id: string; storyId: string; choice: "like" | "love" }[] = [];
  const wishes: { id: string; topic: string; storyteller: string | null }[] = [];

  function playStory(id: string): TurnResponse {
    const story = FIXTURE_STORIES.find((candidate) => candidate.id === id);
    if (!story) return noPlay("I couldn't find that delivered story. Ask for your stories to hear what is available.");
    const asset = ASSETS[story.id];
    if (!asset) return noPlay("That delivered demo recording is unavailable right now.");
    currentId = id;
    tokenCounter += 1;
    const play: Play = {
      id: story.id,
      token: `mock-${tokenCounter}-${story.id}`,
      offsetInMilliseconds: 0,
      url: asset.audio,
      title: story.title,
      storyteller: story.storyteller,
      durationSeconds: story.durationSeconds,
      artUrl: asset.art,
    };
    return { say: `Playing ${story.title} by ${story.storyteller}. This is a delivered demo fixture.`, play, speechUrl: null, toolCalls: TOOL_CALLS };
  }

  function start(ids: string[]): TurnResponse {
    playlist = ids;
    index = 0;
    const id = playlist[index];
    return id ? playStory(id) : noPlay("No stories have been delivered yet. Try again after a story is ready.");
  }

  function playAt(indexToPlay: number): TurnResponse {
    const id = playlist[indexToPlay];
    return id ? playStory(id) : noPlay("That delivered demo recording is unavailable right now.");
  }

  return {
    createSession(request: SessionRequest): Promise<SessionResponse> {
      sessionCounter += 1;
      return Promise.resolve({ sessionId: `mock-${sessionCounter}`, mode: request.mode,
        subject: request.mode === "linked" ? "linked-subject" : "demo", offline: true });
    },
    turn(_sessionId, text): Promise<TurnResponse> {
      const utterance = normalize(text);
      if (pendingWish && /^(?:yes|confirm|save it)$/.test(utterance)) {
        const { topic, storyteller } = pendingWish;
        pendingWish = null;
        const existing = wishes.find((wish) => wish.topic === topic && wish.storyteller === storyteller);
        if (existing) return Promise.resolve(noPlay(`Receipt ${existing.id} was already saved in this simulation. No creator was contacted.`));
        if (wishes.length >= RECEIPT_LIMIT) return Promise.resolve(noPlay("The simulator's demo wish receipt limit is full. No new wish was saved."));
        const id = `mock-wish-${wishes.length + 1}`;
        wishes.push({ id, topic, storyteller });
        unreadUpdates.push(`Your demo wish about ${topic} was saved.`);
        return Promise.resolve(noPlay(`Your demo wish about ${topic}${storyteller ? ` with ${storyteller}` : ""} was saved in this simulation. Receipt ${id}. It has not been sent to a creator.`));
      }
      if (pendingWish && /^(?:no|cancel)$/.test(utterance)) {
        pendingWish = null;
        return Promise.resolve(noPlay("No demo wish was saved."));
      }
      // Confirmation applies only to the immediately preceding wish request.
      pendingWish = null;
      if (/^(?:alexa )?open spoken letter$/.test(utterance)) {
        if (pendingReactionId && !reactionPrompted) {
          reactionPrompted = true;
          return Promise.resolve(noPlay("Did you like or love that story?"));
        }
        return Promise.resolve(noPlay("Spoken Letter. You can ask for your delivered demo stories or check what is new."));
      }
      if (/\b(?:send|deliver)\b/.test(utterance)) {
        return Promise.resolve(noPlay("I can prepare a name-free demo outline. Please choose the listener in Spoken Letter and finish delivery there."));
      }
      if (/\b(?:create|make) (?:a )?story for\b/.test(utterance)) {
        awaitingTheme = false;
        return Promise.resolve(noPlay("I can prepare a name-free demo outline. Please choose the listener in Spoken Letter and finish delivery there."));
      }
      if (/\b(?:check|show) (?:my )?demo notification\b/.test(utterance)) {
        return Promise.resolve(noPlay(`This offline simulator did not send a device notification. The matching fixture inbox event is ${newStoryEvent?.eventId ?? "unavailable"}. Ask what is new for its in-skill detail.`));
      }
      if (/\bcredits\b/.test(utterance)) {
        return Promise.resolve(noPlay("Open Spoken Letter to add story credits. Alexa cannot charge you or change credits."));
      }
      if (/\b(?:how.*create|how.*make|help.*creat)\b/.test(utterance)) {
        return Promise.resolve(noPlay("Open Spoken Letter, choose a listener, make or record a story, and finish delivery there. Here I can save a name-free demo draft."));
      }
      if (/\b(?:latest|read)\b.*\bdraft\b/.test(utterance)) {
        return Promise.resolve(noPlay(latestDraft
          ? `Your latest saved demo draft is about ${latestDraft.theme}. ${latestDraft.outline} This is an outline, not a delivered story.`
          : "No demo draft has been saved yet."));
      }
      if (/\bread my demo reactions\b/.test(utterance)) {
        const count = reactions.length;
        const entries = reactions.map((reaction) => {
          const story = FIXTURE_STORIES.find((candidate) => candidate.id === reaction.storyId);
          return `${reaction.id}: ${reaction.choice} for ${story?.title ?? "a delivered fixture"}`;
        });
        return Promise.resolve(noPlay(count === 0 ? "No demo reaction receipts in this page session." :
          `${count} demo reaction receipt${count === 1 ? "" : "s"} in this page session: ${entries.join("; ")}.`));
      }
      if (/\bread my demo wishes\b/.test(utterance)) {
        const count = wishes.length;
        const entries = wishes.map((wish) => `${wish.id}: ${wish.topic}${wish.storyteller ? ` with ${wish.storyteller}` : ""}`);
        return Promise.resolve(noPlay(count === 0 ? "No demo wish receipts in this page session." :
          `${count} demo wish receipt${count === 1 ? "" : "s"} in this page session: ${entries.join("; ")}.`));
      }
      if (/\b(?:create|make|draft)\b/.test(utterance) && /\b(?:story|draft)\b/.test(utterance)) {
        awaitingTheme = true;
        return Promise.resolve(noPlay("What general theme should the demo draft have? Say about mermaids or about space."));
      }
      if (awaitingTheme) {
        const themeAnswer = /^(?:about\b|the theme is\b)/.test(utterance) || TOPICS.some(([topic]) => utterance === topic);
        if (themeAnswer) {
          const theme = topicIn(text);
          if (!theme) return Promise.resolve(noPlay("I can save a demo draft about mermaids, space, ocean, forest, animals, friendship, or bedtime. Which theme?"));
          const outline = DRAFT_OUTLINES[theme];
          if (!outline) return Promise.resolve(noPlay("That demo draft theme is unavailable right now."));
          latestDraft = { theme, outline };
          awaitingTheme = false;
          return Promise.resolve(noPlay(`Saved a name-free demo draft about ${theme}. Choose the listener in Spoken Letter and finish delivery there.`));
        }
        awaitingTheme = false;
      }
      if (/\b(?:wish|request)\b|\bi want a story\b|\bask\b.*\bfor another\b.*\bstory\b/.test(utterance)) {
        const topic = topicIn(text);
        if (!topic) return Promise.resolve(noPlay("Choose a general topic for a demo wish, such as mermaids or space."));
        const askedCreator = /\bask (.+?) for another\b/.exec(utterance)?.[1];
        if (askedCreator && !FIXTURE_STORIES.some((story) => normalize(story.storyteller) === askedCreator)) {
          return Promise.resolve(noPlay(`Which adult storyteller do you mean? I can use ${defaultStoryteller} from the delivered fixtures.`));
        }
        const storyteller = FIXTURE_STORIES.find((story) => utterance.includes(normalize(story.storyteller)))?.storyteller ?? null;
        pendingWish = { topic, storyteller };
        return Promise.resolve(noPlay(`Confirm a demo wish about ${topic}${storyteller ? ` with ${storyteller}` : ""}? This will save a simulation receipt only; it will not send anything to a creator.`));
      }
      if (/\b(?:birthday|occasions?)\b/.test(utterance)) {
        return Promise.resolve(noPlay("A family birthday is coming up in this synthetic fixture. You can prepare a demo story draft."));
      }
      if (/\b(?:what.*new|new stories|updates|inbox)\b/.test(utterance)) {
        return Promise.resolve(noPlay(unreadUpdates.shift() ?? "No unread demo updates. Ask for your delivered stories or a demo draft."));
      }
      if (/\b(?:like|love)\b/.test(utterance)) {
        if (!pendingReactionId) return Promise.resolve(noPlay("Finish a delivered demo story before saving a reaction."));
        const choice = /\blove\b/.test(utterance) ? "love" : "like";
        const storyId = pendingReactionId;
        pendingReactionId = null;
        reactionPrompted = false;
        const existing = reactions.find((reaction) => reaction.storyId === storyId && reaction.choice === choice);
        if (existing) return Promise.resolve(noPlay(`Receipt ${existing.id} was already saved in this simulation. No creator was contacted.`));
        if (reactions.length >= RECEIPT_LIMIT) return Promise.resolve(noPlay("The simulator's demo reaction receipt limit is full. No new reaction was saved."));
        const id = `mock-reaction-${reactions.length + 1}`;
        reactions.push({ id, storyId, choice });
        unreadUpdates.push("Your demo reaction was saved.");
        return Promise.resolve(noPlay(`Your ${choice} demo reaction was saved in this simulation. Receipt ${id}. It was not sent to a creator.`));
      }
      if (/\b(?:next|skip)\b/.test(utterance)) {
        if (index < 0 || index + 1 >= playlist.length) return Promise.resolve(noPlay("There is no next delivered story in this demo playlist."));
        index += 1;
        return Promise.resolve(playAt(index));
      }
      if (/\b(?:previous|go back)\b/.test(utterance)) {
        if (index <= 0) return Promise.resolve(noPlay("That was the first one. Ask for another story instead."));
        index -= 1;
        return Promise.resolve(playAt(index));
      }
      if (/\b(?:restart|repeat|start over)\b/.test(utterance)) {
        return Promise.resolve(currentId ? playStory(currentId) : noPlay("There is nothing to restart. Ask for a delivered story first."));
      }
      if (/\bnewest\b/.test(utterance)) {
        const ids = [...FIXTURE_STORIES].sort((a, b) => Date.parse(b.deliveredAt) - Date.parse(a.deliveredAt)).map((story) => story.id);
        return Promise.resolve(start(ids));
      }
      const titled = FIXTURE_STORIES.find((story) => utterance.includes(normalize(story.title)));
      if (titled) return Promise.resolve(start([titled.id]));
      const storyteller = FIXTURE_STORIES.find((story) => utterance.includes(normalize(story.storyteller)));
      if (storyteller) return Promise.resolve(start(FIXTURE_STORIES.filter((story) => story.storyteller === storyteller.storyteller).map((story) => story.id)));
      if (/\bplay\b/.test(utterance)) {
        if (!/^(?:alexa )?play (?:all )?my stories$/.test(utterance) && !/^(?:alexa )?play (?:all )?(?:the )?stories$/.test(utterance)) {
          return Promise.resolve(noPlay("I couldn't find that delivered story. Ask for your stories to hear what is available."));
        }
        return Promise.resolve(start(FIXTURE_STORIES.map((story) => story.id)));
      }
      return Promise.resolve(noPlay("I can play delivered demo fixtures. Try saying play my stories."));
    },
    playbackFinished(_sessionId): Promise<TurnResponse | null> {
      pendingReactionId = currentId;
      reactionPrompted = false;
      if (index < 0 || index + 1 >= playlist.length) return Promise.resolve(null);
      index += 1;
      return Promise.resolve(playAt(index));
    },
    transcribe() { return Promise.resolve({ text: MOCK_TRANSCRIPT }); },
    health() { return Promise.resolve({ ok: true, offline: true, model: null }); },
  };
}
