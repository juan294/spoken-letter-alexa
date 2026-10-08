/**
 * The en-US creation flow's spoken and on-screen lines (staged demo plan D12). English only
 * by decision D1, so this is one record rather than a `Record<SkillLocale, …>`: `MESSAGES`
 * stays a complete two-locale catalog. The handler copy rules apply here too
 * (`handler.test.ts` `ssml`). Phase 1 holds the recording lines; later phases add the rest.
 */
export type CreateMessages = {
  /** Spoken as the on-screen countdown runs. */
  recordCue: string;
  /** No screen (SS1): spoken before the script. */
  scriptIntro: string;
  /** No screen (SS1): spoken after the script. */
  readAloudCue: string;
  /** Anything unrecognized while the adult reads. */
  recordingHelp: string;
  takeIntro: string;
  takeQuestion: string;
  /** SS5: no take matches the script, or takes cannot be served. */
  takeMissing: string;
  takeContinue: string;
  /** On screen. */
  teleprompterTitle: string;
  recordingLabel: string;
  doneLabel: string;
};

export const CREATE_MESSAGES: CreateMessages = {
  recordCue: "Get ready. Three, two, one.",
  scriptIntro: "Here's your script.",
  readAloudCue: "Read it aloud, then say: Alexa, the end.",
  recordingHelp: "When you finish reading, say: Alexa, the end.",
  takeIntro: "Got it. Here's your recording.",
  takeQuestion: "Record again, or continue?",
  takeMissing: "That recording isn't ready to play yet. Say record again, or continue.",
  takeContinue: "Great.",
  teleprompterTitle: "Read your story aloud",
  recordingLabel: "Recording",
  doneLabel: "Done",
};
