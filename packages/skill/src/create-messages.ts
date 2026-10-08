import type { TakeVariant } from "@spoken-letter-alexa/shared";

/**
 * The en-US creation flow's spoken and on-screen lines (staged demo plan D12). English only
 * by decision D1, so this is one record rather than a `Record<SkillLocale, …>`: `MESSAGES`
 * stays a complete two-locale catalog. The handler copy rules apply here too
 * (`handler.test.ts` `ssml`). The lines follow Jordan's demo script (plan revision for her
 * script): names, the wish, the story's own replies and its title come from
 * `fixtures/demo-create.json`, everything else is here.
 */
export type CreateMessages = {
  /** Script line 9, with the purchase scene replaced by the credits the account already has (D10). */
  start: (credits: number) => string;
  /** Line 16. */
  whoFor: string;
  /** SS7. The spoken name is never repeated back. */
  unknownListener: (names: string) => string;
  /** Line 18. */
  wishOffer: (name: string, phrase: string, topic: string) => string;
  /** Line 20, after yes. */
  wishYes: (topic: string) => string;
  wishNo: string;
  /** Line 20's question. */
  firstQuestion: string;
  /** Line 26: the third answer hands over to the script on screen. */
  handOver: string;
  /** Line 26 on a device without a screen (SS1). */
  handOverNoScreen: string;
  recordReprompt: string;
  /** Spoken as the on-screen countdown runs. */
  recordCue: string;
  /** No screen (SS1): spoken before the script. */
  scriptIntro: string;
  /** No screen (SS1): spoken after the script. */
  readAloudCue: string;
  /** Anything unrecognized while the adult reads. */
  recordingHelp: string;
  /** Line 31. */
  saved: string;
  /** SS2: a launch soon after the session dropped while reading or in review. */
  resumeReview: string;
  reviewReprompt: string;
  /** After the take plays back (line 33). */
  afterPlayback: string;
  /** SS5: no take matches the script, or takes cannot be served. */
  takeMissing: string;
  /** Line 35. */
  titleQuestion: string;
  titleReprompt: string;
  /** Line 37. */
  soundQuestion: (title: string) => string;
  soundWhich: string;
  /** Line 39's first sentence, per choice. */
  soundAdded: Record<TakeVariant, string>;
  /** Line 39's second sentence. */
  finishPrompt: string;
  /** Line 41. */
  sent: (title: string, listener: string) => string;
  /** Line 41 when the finished story cannot be played. */
  sentNoAudio: (title: string, listener: string) => string;
  canceled: string;
  /** On screen. */
  teleprompterTitle: string;
  scriptTitle: string;
  recordingLabel: string;
  doneLabel: string;
  forListener: (name: string) => string;
  yourStory: string;
  status: {
    saved: string;
    finishing: string;
    sound: string;
    sent: (listener: string) => string;
  };
};

export const CREATE_MESSAGES: CreateMessages = {
  start: (credits) => `Okay, create a story. You have ${credits} story credits, and this story uses one.`,
  whoFor: "Who is the story for?",
  unknownListener: (names) => `I don't see that name on your list. You can choose ${names}.`,
  wishOffer: (name, phrase, topic) => `There's a saved wish for ${name}: ${phrase}. Would you like to create a story about ${topic}?`,
  wishYes: (topic) => `A ${topic} story it is.`,
  wishNo: "Okay, something new.",
  firstQuestion: "Who are the characters, and what happens?",
  handOver: "A lovely ending. Your script is on the screen. Say \"record\" when you're ready, and \"the end\" when you finish.",
  handOverNoScreen: "A lovely ending. Your script is ready. Say \"record\" when you're ready, and \"the end\" when you finish.",
  recordReprompt: "Say \"record\" when you're ready.",
  recordCue: "Get ready. Three, two, one.",
  scriptIntro: "Here's your script.",
  readAloudCue: "Read it aloud, then say: Alexa, the end.",
  recordingHelp: "When you finish reading, say: Alexa, the end.",
  saved: "Your recording is saved. Say \"playback\" to listen, \"re-record\" to try again, or \"next\" to continue.",
  resumeReview: "Welcome back. Your recording is saved. Say \"playback\" to listen, \"re-record\" to try again, or \"next\" to continue.",
  reviewReprompt: "Say \"playback\", \"re-record\", or \"next\".",
  afterPlayback: "Say \"re-record\" to try again, or \"next\" to continue.",
  takeMissing: "That recording isn't ready to play yet. Say \"re-record\" to try again, or \"next\" to continue.",
  titleQuestion: "Time for the finishing touches. What would you like to call your story?",
  titleReprompt: "What would you like to call your story?",
  soundQuestion: (title) => `Would you like to add music or sound effects to ${title}?`,
  soundWhich: "Music, sound effects, or both?",
  soundAdded: {
    both: "Soft background music and gentle sound effects added.",
    music: "Soft background music added.",
    effects: "Gentle sound effects added.",
    plain: "Okay, no music or sound effects.",
  },
  finishPrompt: "Say \"playback\" or \"send story\".",
  sent: (title, listener) => `${title} has been sent to ${listener}'s family. Here it is.`,
  sentNoAudio: (title, listener) => `${title} has been sent to ${listener}'s family.`,
  canceled: "Okay, stopping here.",
  teleprompterTitle: "Read your story aloud",
  scriptTitle: "Your script",
  recordingLabel: "Recording",
  doneLabel: "Done",
  forListener: (name) => `For ${name}`,
  yourStory: "Your story",
  status: {
    saved: "Recording saved",
    finishing: "Finishing touches",
    sound: "Music or sound effects?",
    sent: (listener) => `Sent to ${listener}'s family`,
  },
};
