/** The seven fixture-safe story topics: the `DemoTopic` slot values and the agent's draft themes. */
export const DEMO_TOPICS = ["mermaids", "space", "ocean", "forest", "animals", "friendship", "bedtime"] as const;

export type DemoTopic = (typeof DEMO_TOPICS)[number];

export const isDemoTopic = (value: string): value is DemoTopic => (DEMO_TOPICS as readonly string[]).includes(value);

/** How each topic follows "una historia" in a Spanish sentence ("una historia sobre sirenas", "una historia para dormir"). */
export const SPANISH_TOPIC_PHRASES: Record<DemoTopic, string> = {
  mermaids: "sobre sirenas", space: "sobre el espacio", ocean: "sobre el mar", forest: "sobre el bosque",
  animals: "sobre animales", friendship: "sobre la amistad", bedtime: "para dormir",
};
