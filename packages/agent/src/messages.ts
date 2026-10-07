import { type DemoTopic, type SkillLocale, SPANISH_TOPIC_PHRASES } from "@spoken-letter-alexa/shared";

/**
 * Every line the agent API speaks through the skill, per locale (plan D5). A locale missing a
 * key fails `tsc`. Spanish copy is Spain Spanish in the `tú` register (plan D9). Titles and
 * storyteller names stay exactly as the catalog has them (plan D2). English values are the
 * pre-localization literals, unchanged.
 */

/** Playlist replies (`playlist.ts`). */
export type PlaylistMessages = {
  playbackChanged: string;
  noStoriesYet: string;
  onlyFirst: (limit: number, example: string | undefined) => string;
  titleNotFound: (example: string | undefined) => string;
  whichTitle: (title: string, matches: { title: string; storyteller: string }[]) => string;
  whichStoryteller: (names: string[]) => string;
  noStoryByStoryteller: string;
  recordingUnavailable: string;
  playingBy: (title: string, storyteller: string) => string;
  playing: (title: string) => string;
  noEarlier: string;
  playFirst: string;
  firstInPlaylist: string;
  lastInPlaylist: string;
  storyUnavailable: string;
};

/** Update details (`demo-updates.ts`), rendered from typed state when read. */
export type UpdateMessages = {
  newStory: string;
  occasion: string;
  reactionSaved: string;
  wishSaved: (topic: DemoTopic) => string;
  wishSavedGeneric: string;
  withStory: (detail: string, title: string, storyteller: string) => string;
};

export type DraftPlace = "quiet shore" | "forest path" | "starry sky" | "cozy room" | "sunny meadow";
export type DraftChallenge = "small mystery" | "lost map" | "surprising sound" | "unexpected journey";
export type DraftEnding = "kindness" | "courage" | "teamwork" | "a restful return";

/** The draft outline (`demo-drafts.ts`), rendered once at save time in the request locale (plan D7). */
export type DraftMessages = {
  outline: (theme: DemoTopic, place: DraftPlace, challenge: DraftChallenge, ending: DraftEnding) => string;
};

export type AgentMessages = {
  playlist: PlaylistMessages;
  updates: UpdateMessages;
  drafts: DraftMessages;
  /** The turn reply when the model or MCP call fails (`turn.ts`). */
  fallbackSay: string;
};

const SPANISH_THEMES: Record<DemoTopic, string> = {
  bedtime: "la hora de dormir", space: "el espacio", ocean: "el mar", forest: "el bosque",
  animals: "los animales", friendship: "la amistad", mermaids: "las sirenas",
};
const SPANISH_PLACES: Record<DraftPlace, string> = {
  "quiet shore": "una orilla tranquila", "forest path": "un sendero del bosque", "starry sky": "un cielo estrellado",
  "cozy room": "una habitación acogedora", "sunny meadow": "un prado soleado",
};
const SPANISH_CHALLENGES: Record<DraftChallenge, string> = {
  "small mystery": "un pequeño misterio", "lost map": "un mapa perdido", "surprising sound": "un sonido sorprendente",
  "unexpected journey": "un viaje inesperado",
};
const SPANISH_ENDINGS: Record<DraftEnding, string> = {
  kindness: "la bondad", courage: "el valor", teamwork: "el trabajo en equipo", "a restful return": "un regreso tranquilo",
};

export const AGENT_MESSAGES: Record<SkillLocale, AgentMessages> = {
  "en-US": {
    playlist: {
      playbackChanged: "Playback changed. Ask me to try again.",
      noStoriesYet: "No stories have been delivered yet. Try again after a story is ready.",
      onlyFirst: (limit, example) => `I can check only the first ${limit} delivered stories right now. Try a newer title, such as ${example ?? "one of your stories"}.`,
      titleNotFound: (example) => `I couldn't find that delivered story. You can ask for ${example ?? "your stories"}.`,
      whichTitle: (title, matches) => `Which ${title} story do you mean? I have ${matches.map((story) => `${story.title} by ${story.storyteller}`).join(" and ")}.`,
      whichStoryteller: (names) => `Which storyteller do you mean? I have ${names.join(" and ")}.`,
      noStoryByStoryteller: "I couldn't find a delivered story by that storyteller. Ask for your stories to hear what is available.",
      recordingUnavailable: "That recording is unavailable right now. Try again in a moment.",
      playingBy: (title, storyteller) => `Playing ${title} by ${storyteller}.`,
      playing: (title) => `Playing ${title}.`,
      noEarlier: "There is no earlier story. Ask me to play your stories first.",
      playFirst: "Ask me to play your stories first.",
      firstInPlaylist: "This is the first story in your playlist.",
      lastInPlaylist: "That was the last story in your playlist.",
      storyUnavailable: "That story is unavailable. Ask me to play your stories again.",
    },
    updates: {
      newStory: "A new story is ready.",
      occasion: "A family birthday is coming up. You can create a story for the occasion.",
      reactionSaved: "Your reaction was saved.",
      wishSaved: (topic) => `Your wish for a story about ${topic} was saved.`,
      wishSavedGeneric: "Your story wish was saved.",
      withStory: (detail, title, storyteller) => `${detail} "${title}" by ${storyteller}.`,
    },
    drafts: {
      outline: (theme, place, challenge, ending) => `Theme: ${theme}. Setting: a ${place}. Middle: a ${challenge}. Ending: ${ending} brings everyone home.`,
    },
    fallbackSay: "I can't reach Spoken Letter right now. Try again in a moment, or reconnect it in the Alexa app.",
  },
  "es-ES": {
    playlist: {
      playbackChanged: "La reproducción ha cambiado. Pídemelo otra vez.",
      noStoriesYet: "Todavía no te ha llegado ninguna historia. Vuelve a intentarlo cuando haya una lista.",
      onlyFirst: (limit, example) => `Ahora solo puedo buscar entre las ${limit} primeras historias que te han llegado. Prueba con un título más reciente, como ${example ?? "una de tus historias"}.`,
      titleNotFound: (example) => `No encuentro esa historia. Puedes pedir ${example ?? "tus historias"}.`,
      whichTitle: (title, matches) => `¿Qué historia de ${title} quieres? Tengo ${matches.map((story) => `${story.title}, de ${story.storyteller}`).join(" y ")}.`,
      whichStoryteller: (names) => `¿De quién la quieres? Tengo historias de ${names.join(" y ")}.`,
      noStoryByStoryteller: "No encuentro ninguna historia de esa persona. Pide tus historias para oír lo que tienes.",
      recordingUnavailable: "Esa grabación no está disponible ahora mismo. Inténtalo de nuevo en un momento.",
      playingBy: (title, storyteller) => `Pongo ${title}, de ${storyteller}.`,
      playing: (title) => `Pongo ${title}.`,
      noEarlier: "No hay ninguna historia anterior. Primero pídeme que ponga tus historias.",
      playFirst: "Primero pídeme que ponga tus historias.",
      firstInPlaylist: "Esta es la primera historia de tu lista.",
      lastInPlaylist: "Esa era la última historia de tu lista.",
      storyUnavailable: "Esa historia no está disponible. Pídeme otra vez que ponga tus historias.",
    },
    updates: {
      newStory: "Ya tienes una historia nueva.",
      occasion: "Se acerca un cumpleaños en la familia. Puedes crear una historia para la ocasión.",
      reactionSaved: "Se ha guardado tu reacción.",
      wishSaved: (topic) => `Se ha guardado tu deseo de una historia ${SPANISH_TOPIC_PHRASES[topic]}.`,
      wishSavedGeneric: "Se ha guardado tu deseo de una historia.",
      withStory: (detail, title, storyteller) => `${detail} "${title}", de ${storyteller}.`,
    },
    drafts: {
      outline: (theme, place, challenge, ending) =>
        `Tema: ${SPANISH_THEMES[theme]}. Lugar: ${SPANISH_PLACES[place]}. Nudo: ${SPANISH_CHALLENGES[challenge]}. Final: ${SPANISH_ENDINGS[ending]} trae a todos de vuelta a casa.`,
    },
    fallbackSay: "Ahora mismo no puedo conectar con Spoken Letter. Inténtalo de nuevo en un momento o vuelve a conectarlo en la app de Alexa.",
  },
};
