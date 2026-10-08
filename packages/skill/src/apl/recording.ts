import { CREATE_MESSAGES } from "../create-messages.ts";
import teleprompter from "./teleprompter.json" with { type: "json" };

export const TELEPROMPTER_TOKEN = "teleprompter";

export type AplCommand =
  | { type: "Sequential"; commands: AplCommand[] }
  | { type: "SetValue"; componentId: string; property: string; value: string | number; delay?: number }
  | { type: "Scroll"; componentId: string; distance: number; delay?: number };

export type AplDirective =
  | { type: "Alexa.Presentation.APL.RenderDocument"; token: string; document: typeof teleprompter; datasources: ReturnType<typeof teleprompterDatasource> }
  | { type: "Alexa.Presentation.APL.ExecuteCommands"; token: string; commands: AplCommand[] };

/** Plan D8: the default 70-word script reads aloud in about 25 seconds. */
const MS_PER_WORD = 25_000 / 70;
const COUNTDOWN_STEP_MS = 1000;
const SCROLL_STEP_MS = 1000;
/**
 * Layout estimates for `teleprompter.json` at 960x480 (hub landscape small): 56dp type in an
 * 864dp column holds about 30 characters a line, and the 408dp below the header shows about 5
 * lines. The device check (phase-1.md D1) calibrates them.
 */
const CHARS_PER_LINE = 30;
const LINES_PER_PAGE = 5;

const words = (script: string) => script.split(/\s+/).filter(Boolean);

export function readMs(script: string): number {
  return Math.round(words(script).length * MS_PER_WORD);
}

/** The script's height in screens, by greedy word wrap at the estimated line length. */
export function estimatedPages(script: string): number {
  let lines = 0;
  let line = 0;
  for (const word of words(script)) {
    if (line === 0 || line + 1 + word.length > CHARS_PER_LINE) {
      lines += 1;
      line = word.length;
    } else {
      line += 1 + word.length;
    }
  }
  return lines / LINES_PER_PAGE;
}

export function teleprompterDatasource(script: string) {
  return {
    teleprompter: {
      title: CREATE_MESSAGES.teleprompterTitle,
      script,
      recordingLabel: CREATE_MESSAGES.recordingLabel,
      doneLabel: CREATE_MESSAGES.doneLabel,
    },
  };
}

/**
 * 3, 2, 1 a second apart, then the overlay goes and the indicator shows. The scroll then moves
 * all but the last screen in equal one-second steps over the read time, so the line being
 * read drifts from the top of the screen to the bottom and never leaves it.
 */
export function recordingCommands(script: string): AplCommand[] {
  const countdown: AplCommand[] = ["3", "2", "1"].map((value, index) => ({
    type: "SetValue", componentId: "countdown", property: "text", value, ...(index > 0 && { delay: COUNTDOWN_STEP_MS }),
  }));
  const travel = estimatedPages(script) - 1;
  const steps = travel > 0 ? Math.max(1, Math.round(readMs(script) / SCROLL_STEP_MS)) : 0;
  const scroll: AplCommand[] = Array.from({ length: steps }, () => ({ type: "Scroll", componentId: "scriptScroll", distance: travel / steps, delay: SCROLL_STEP_MS }));
  return [{
    type: "Sequential",
    commands: [
      ...countdown,
      { type: "SetValue", componentId: "countdownOverlay", property: "display", value: "none", delay: COUNTDOWN_STEP_MS },
      { type: "SetValue", componentId: "recordingIndicator", property: "opacity", value: 1 },
      ...scroll,
    ],
  }];
}

export function teleprompterDirectives(script: string): AplDirective[] {
  return [
    { type: "Alexa.Presentation.APL.RenderDocument", token: TELEPROMPTER_TOKEN, document: teleprompter, datasources: teleprompterDatasource(script) },
    { type: "Alexa.Presentation.APL.ExecuteCommands", token: TELEPROMPTER_TOKEN, commands: recordingCommands(script) },
  ];
}
