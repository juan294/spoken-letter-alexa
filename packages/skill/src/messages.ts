import type { SkillLocale } from "@spoken-letter-alexa/shared";

/**
 * Every line the skill speaks, per locale (plan D5). A locale missing a key fails `tsc`.
 * Spanish copy is Spain Spanish in the `tú` register (plan D9). Story titles and storyteller
 * names are spoken exactly as the catalog has them (plan D2).
 */
export type Messages = {
  reprompt: string;
  launch: string;
  help: string;
  retry: string;
  nothingToResume: string;
  nothingToPlay: string;
  nothingToGoBackTo: string;
  oneAtATime: string;
  noPlay: string;
  themePrompt: string;
  draftUnavailable: string;
  draftUnsupported: string;
  draftLimit: string;
  draftLimitReprompt: string;
  reactionReprompt: string;
  wishReprompt: string;
  wishStart: string;
  namedHandoff: string;
  creditsHelp: string;
  creationHelp: string;
  reactionUnavailable: string;
  wishUnavailable: string;
  draftRecoveryRepeated: string;
  reactionPrompt: string;
  reactionRecoveryRepeated: string;
  wishRecovery: string;
  wishRecoveryRepeated: string;
  generalRecoveryRepeated: string;
  progressivePlay: string;
  progressiveNews: string;
  reactionFor: (title: string) => string;
  updateDetail: (detail: string) => string;
  draftSaved: string;
  reactionDismissed: string;
  reactionSaved: (choice: "like" | "love") => string;
  noPendingReaction: string;
  wishSaved: string;
  draftCanceled: string;
  wishCanceled: string;
  wishTopicQuestion: string;
  wishTopicStart: string;
  whoFrom: string;
  wishConfirm: (topic: DemoTopic, storyteller?: string) => string;
  updatesUnavailable: string;
  noUpdates: string;
  updatesFailed: string;
  draftRead: (outline: string) => string;
  noDraft: string;
  draftReadFailed: string;
  /** The AudioPlayer card subtitle, not speech. */
  readBy: (storyteller: string) => string;
};

const EN_WISH_START = "To start a wish, say I want a story about space.";
const ES_WISH_START = "Para pedir un deseo, di quiero una historia sobre el espacio.";

/** The canonical `DemoTopic` values, shared by both locales (plan D4). */
export const DEMO_TOPICS = ["mermaids", "space", "ocean", "forest", "animals", "friendship", "bedtime"] as const;
export type DemoTopic = (typeof DEMO_TOPICS)[number];

/** How each canonical topic follows "una historia" in a Spanish sentence. */
const SPANISH_TOPICS: Record<DemoTopic, string> = {
  mermaids: "sobre sirenas", space: "sobre el espacio", ocean: "sobre el mar", forest: "sobre el bosque",
  animals: "sobre animales", friendship: "sobre la amistad", bedtime: "para dormir",
};

export const MESSAGES: Record<SkillLocale, Messages> = {
  "en-US": {
    reprompt: "You can say: play my stories, or ask what is new.",
    launch: "Spoken Letter. Which family story would you like?",
    help: "You can say play my stories, ask what is new, or say let's create a story. For delivery and credits, use Spoken Letter. Which would you like?",
    retry: "I'm still looking for that one. Ask again in a moment.",
    nothingToResume: "There is nothing to resume. Ask for a family story first.",
    nothingToPlay: "Which family story would you like? You can say: play my stories.",
    nothingToGoBackTo: "That was the first one. Ask for another story instead.",
    oneAtATime: "I play family stories one at a time.",
    noPlay: "Which delivered story would you like? You can name a title, or say play my stories.",
    themePrompt: "What would you like your story to be about? You can say mermaids or space.",
    draftUnavailable: "No draft was saved. You can try another theme in a moment.",
    draftUnsupported: "No draft was saved. Try a theme such as mermaids or space.",
    draftLimit: "No draft was saved. You can say read my draft, or try creating another later.",
    draftLimitReprompt: "You can say read my draft.",
    reactionReprompt: "You can say I like it, I love it, or no.",
    wishReprompt: "You can say yes or no.",
    wishStart: EN_WISH_START,
    namedHandoff: "I can help you start a story. Open Spoken Letter to choose the listener and send it.",
    creditsHelp: "You can add story credits in Spoken Letter.",
    creationHelp: "To get started here, say let's create a story. You can finish your draft, record a story, and choose who to send it to in Spoken Letter.",
    reactionUnavailable: "No reaction was saved. You can say like or love again.",
    wishUnavailable: "No wish was saved. You can try again.",
    draftRecoveryRepeated: "Say about mermaids to choose a theme, or say cancel.",
    reactionPrompt: "Did you like or love that story?",
    reactionRecoveryRepeated: "Say I love that story, or say cancel.",
    wishRecovery: "Would you like to save your wish? Say yes or no.",
    wishRecoveryRepeated: "Say yes to save your wish, or say cancel.",
    generalRecoveryRepeated: "Say let's create a story, play my stories, or cancel.",
    progressivePlay: "Looking for that one.",
    progressiveNews: "Checking what's new.",
    reactionFor: (title) => `Did you like or love ${title}?`,
    updateDetail: (detail) => `${detail} You can say let's create a story.`,
    draftSaved: "I saved your story draft. Open Spoken Letter to choose the listener and finish it.",
    reactionDismissed: "Okay. Maybe next time.",
    reactionSaved: (choice) => `I saved that you ${choice === "love" ? "loved" : "liked"} the story.`,
    noPendingReaction: "There is no completed story waiting for a reaction.",
    wishSaved: "I saved your wish.",
    draftCanceled: "Okay. No draft was saved.",
    wishCanceled: "Okay. No wish was saved.",
    wishTopicQuestion: "What would you like your story to be about?",
    wishTopicStart: `What would you like your story to be about? ${EN_WISH_START}`,
    whoFrom: "Who would you like a story from?",
    wishConfirm: (topic, storyteller) => `Save a wish for a ${topic} story${storyteller ? ` from ${storyteller}` : ""}? Say yes or no.`,
    updatesUnavailable: "Your updates are unavailable right now.",
    noUpdates: "There are no unread updates.",
    updatesFailed: "I couldn't read your updates right now. Try again in a moment.",
    draftRead: (outline) => `Your story draft says: ${outline}`,
    noDraft: "There is no story draft yet. Say, let's create a story.",
    draftReadFailed: "I couldn't read your story draft right now. Try again in a moment.",
    readBy: (storyteller) => `read by ${storyteller}`,
  },
  "es-ES": {
    reprompt: "Puedes decir: pon mis historias, o preguntar qué hay de nuevo.",
    launch: "Spoken Letter. ¿Qué historia familiar quieres escuchar?",
    help: "Puedes decir pon mis historias, preguntar qué hay de nuevo, o decir vamos a crear una historia. Para enviar historias o añadir créditos, usa Spoken Letter. ¿Qué prefieres?",
    retry: "Sigo buscando esa historia. Vuelve a pedírmela en un momento.",
    nothingToResume: "No hay nada que reanudar. Primero pide una historia familiar.",
    nothingToPlay: "¿Qué historia familiar quieres escuchar? Puedes decir: pon mis historias.",
    nothingToGoBackTo: "Esa era la primera. Pide otra historia.",
    oneAtATime: "Pongo las historias familiares de una en una.",
    noPlay: "¿Qué historia de las que te han llegado quieres escuchar? Puedes decir un título o pon mis historias.",
    themePrompt: "¿De qué quieres que trate tu historia? Puedes decir sirenas o el espacio.",
    draftUnavailable: "No se ha guardado ningún borrador. Puedes probar otro tema en un momento.",
    draftUnsupported: "No se ha guardado ningún borrador. Prueba con un tema como sirenas o el espacio.",
    draftLimit: "No se ha guardado ningún borrador. Puedes decir lee mi borrador, o intentar crear otro más tarde.",
    draftLimitReprompt: "Puedes decir lee mi borrador.",
    reactionReprompt: "Puedes decir me gusta, me encanta, o no.",
    wishReprompt: "Puedes decir sí o no.",
    wishStart: ES_WISH_START,
    namedHandoff: "Puedo ayudarte a empezar una historia. Abre Spoken Letter para elegir quién la escucha y enviarla.",
    creditsHelp: "Puedes añadir créditos para historias en Spoken Letter.",
    creationHelp: "Para empezar aquí, di vamos a crear una historia. En Spoken Letter puedes terminar tu borrador, grabar una historia y elegir a quién enviarla.",
    reactionUnavailable: "No se ha guardado tu reacción. Puedes volver a decir me gusta o me encanta.",
    wishUnavailable: "No se ha guardado el deseo. Puedes intentarlo de nuevo.",
    draftRecoveryRepeated: "Di sobre sirenas para elegir un tema, o di cancelar.",
    reactionPrompt: "¿Te ha gustado o te ha encantado esa historia?",
    reactionRecoveryRepeated: "Di me encanta esa historia, o di cancelar.",
    wishRecovery: "¿Quieres guardar tu deseo? Di sí o no.",
    wishRecoveryRepeated: "Di sí para guardar tu deseo, o di cancelar.",
    generalRecoveryRepeated: "Di vamos a crear una historia, pon mis historias, o cancelar.",
    progressivePlay: "Buscando esa historia.",
    progressiveNews: "Voy a ver qué hay de nuevo.",
    reactionFor: (title) => `¿Te ha gustado o te ha encantado ${title}?`,
    updateDetail: (detail) => `${detail} Puedes decir vamos a crear una historia.`,
    draftSaved: "He guardado el borrador de tu historia. Abre Spoken Letter para elegir quién la escucha y terminarla.",
    reactionDismissed: "Vale. Quizá la próxima vez.",
    reactionSaved: (choice) => `He guardado que te ha ${choice === "love" ? "encantado" : "gustado"} la historia.`,
    noPendingReaction: "No hay ninguna historia terminada esperando tu reacción.",
    wishSaved: "He guardado tu deseo.",
    draftCanceled: "Vale. No se ha guardado ningún borrador.",
    wishCanceled: "Vale. No se ha guardado el deseo.",
    wishTopicQuestion: "¿De qué quieres que trate tu historia?",
    wishTopicStart: `¿De qué quieres que trate tu historia? ${ES_WISH_START}`,
    whoFrom: "¿De quién quieres una historia?",
    wishConfirm: (topic, storyteller) => `¿Guardo tu deseo de una historia${storyteller ? ` de ${storyteller}` : ""} ${SPANISH_TOPICS[topic]}? Di sí o no.`,
    updatesUnavailable: "Tus novedades no están disponibles ahora mismo.",
    noUpdates: "No tienes novedades sin leer.",
    updatesFailed: "No he podido leer tus novedades ahora mismo. Inténtalo de nuevo en un momento.",
    draftRead: (outline) => `Tu borrador dice: ${outline}`,
    noDraft: "Todavía no hay ningún borrador. Di vamos a crear una historia.",
    draftReadFailed: "No he podido leer tu borrador ahora mismo. Inténtalo de nuevo en un momento.",
    readBy: (storyteller) => `leída por ${storyteller}`,
  },
};

/**
 * Per-locale text matchers for speech that arrives as free text (the catch-all slot, an
 * unresolved custom slot). English patterns are the pre-localization literals, unchanged.
 */
export type Matchers = {
  /** Canonical topic and the spoken words that select it; first match wins. */
  topics: readonly (readonly [DemoTopic, RegExp])[];
  /** "ask {storyteller} for a story": group 1 is the storyteller. */
  askStoryteller: RegExp;
  wish: RegExp;
  send: RegExp;
  createFor: RegExp;
  credits: RegExp;
  howToCreate: RegExp;
  /** Group 1 is the theme. */
  explicitTheme: RegExp;
  bareTheme: RegExp;
  createStory: RegExp;
  /** Group 1 is the theme. */
  themeAbout: RegExp;
  play: RegExp;
  notPlay: RegExp;
  /** Applied in order to strip a play request down to a title. */
  titleCarriers: readonly RegExp[];
  /** Group 1 is the title inside a spoken "the X story" wrapper. */
  shortTitle: RegExp;
  like: RegExp;
  love: RegExp;
};

/** A Unicode word boundary: JavaScript's `\b` treats accented letters as non-word characters. */
const WORD_BOUNDARY = String.raw`(?:(?<=[\p{L}\p{N}])(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?=[\p{L}\p{N}]))`;
const es = (source: string): RegExp => new RegExp(source.replaceAll(String.raw`\b`, WORD_BOUNDARY), "iu");

export const MATCHERS: Record<SkillLocale, Matchers> = {
  "en-US": {
    topics: [
      ["mermaids", /\bmermaids?\b/], ["space", /\b(?:space|stars?|planets?)\b/],
      ["ocean", /\b(?:ocean|sea|beach)\b/], ["forest", /\b(?:forest|woods?)\b/],
      ["animals", /\b(?:animals?|cats?|dogs?)\b/], ["friendship", /\b(?:friends?|friendship)\b/],
      ["bedtime", /\b(?:bedtime|sleep)\b/],
    ],
    askStoryteller: /^ask\s+(.+?)\s+for\b.*\bstory\b/i,
    wish: /^i\s+(?:want|wish)\b.*\bstory\b.*\babout\b/i,
    send: /\b(?:send|deliver)\b/i,
    createFor: /\b(?:create|make)\b.*\bfor\b/i,
    credits: /\b(?:credit|credits|charge|purchase|buy)\b/i,
    howToCreate: /\b(?:how|help)\b.*\b(?:create|make|draft)\b/i,
    explicitTheme: /^(?:about|the theme is|make it about)\s+(.+)$/i,
    bareTheme: /^(?:bedtime|space|ocean|forest|animals|friendship|mermaids)(?: story)?$/i,
    createStory: /\b(?:create|make)\b.*\bstory\b/i,
    themeAbout: /\babout\s+(.+)$/i,
    play: /\b(play|hear|listen|put on)\b/i,
    notPlay: /\b(what|which|list|new|available)\b/i,
    titleCarriers: [/^(?:please\s+)?(?:play|put on|listen to|hear)\s+/i, /^(?:(?:the|a)\s+)?(?:story\s+)?(?:called\s+)?/i, /\s+one$/i],
    shortTitle: /^(?:the\s+)?(.+?)\s+story$/i,
    like: /^(?:like|liked)$/,
    love: /^(?:love|loved)$/,
  },
  "es-ES": {
    topics: [
      ["mermaids", es(String.raw`\bsirenas?\b`)], ["space", es(String.raw`\b(?:espacio|estrellas?|planetas?)\b`)],
      ["ocean", es(String.raw`\b(?:océanos?|oceanos?|mar|mares|playas?)\b`)], ["forest", es(String.raw`\bbosques?\b`)],
      ["animals", es(String.raw`\b(?:animal|animales|gat[oa]s?|perr[oa]s?)\b`)], ["friendship", es(String.raw`\b(?:amig[oa]s?|amistad)\b`)],
      ["bedtime", es(String.raw`\bdormir\b`)],
    ],
    askStoryteller: es(String.raw`^p[ií]de(?:le|les)?\s+al?\s+(.+?)\s+(?:una|otra|un|otro)\s+(?:historia|cuento)\b`),
    wish: es(String.raw`^(?:quiero|me\s+gustar[ií]a|deseo)\s+(?:una|otra|un|otro)\s+(?:historia|cuento)\b.*\b(?:sobre|acerca\s+de)\b`),
    // Imperatives and infinitives only: "la historia que mandó" asks to play, not to send, and
    // the present tense after "que" ("la que me envía la abuela") describes a story, not a command.
    send: es(String.raw`(?<!\bque\s+(?:me\s+|nos\s+|te\s+|le\s+)?)\b(?:env[ií]a(?:le|les|la|sela|selo)?|enviar(?:le|les|la)?|m[aá]nda(?:le|les|la|sela|selo)?|mandar(?:le|les|la)?|entr[eé]ga(?:le|les|la)?|entregar(?:le|les|la)?)\b`),
    createFor: es(String.raw`\b(?:cre[ae]|crear|creemos|haz|hacer|hagamos)(?:me|le|les)?\b(?!\s+que\b).*\bpara\b(?!\s+(?:la\s+hora\s+de\s+)?dormir)`),
    credits: es(String.raw`\b(?:cr[eé]ditos?|cobrar|cobro|comprar|pagar|pago)\b`),
    howToCreate: es(String.raw`\b(?:c[oó]mo|ayuda|ay[uú]dame)\b.*\b(?:cre[ao]|crear|hago|hacer|borrador)\b`),
    explicitTheme: es(String.raw`^(?:sobre|de|el\s+tema\s+es|que\s+sea\s+(?:sobre|de)|hazla\s+sobre)\s+(.+)$`),
    bareTheme: es(String.raw`^(?:(?:el|la|los|las)\s+)?(?:sirenas|espacio|océano|oceano|mar|bosque|animales|amistad|hora\s+de\s+dormir)$`),
    createStory: es(String.raw`\b(?:cre[ae]|crear|creemos|haz|hacer|hagamos)\b(?!\s+que\b).*\b(?:historia|cuento)\b`),
    themeAbout: es(String.raw`\b(?:sobre|acerca\s+de)\s+(.+)$`),
    play: es(String.raw`\b(?:pon|ponme|ponla|pónmela|reproduce|escuchar|escucha|oír|oir|léeme|cuéntame)\b`),
    notPlay: es(String.raw`\b(?:qué|cuál|cuáles|lista|nuevas?|nuevos?|disponibles?)\b`),
    titleCarriers: [
      es(String.raw`^(?:por\s+favor\s+)?(?:pon(?:me)?|reproduce|quiero\s+escuchar|escuchar|escucha|oír|oir|léeme|cuéntame)\s+`),
      es(String.raw`^(?:(?:la|una|el|un)\s+)?(?:(?:historia|cuento)\s+)?(?:(?:que\s+se\s+llama|llamad[ao]|del?)\s+)?`),
    ],
    shortTitle: es(String.raw`^(?:la\s+)?historia\s+(?:del?\s+)?(.+)$`),
    like: es(String.raw`^(?:me\s+)?(?:gusta|gustó|ha\s+gustado|gustado)$`),
    love: es(String.raw`^(?:me\s+)?(?:encanta|encantó|ha\s+encantado|encantado)$`),
  },
};
