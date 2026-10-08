type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Run = (command: string, args: string[], options?: { cwd?: string }) => unknown;
type Deps = { fetch: Fetch; token: string; run: Run; probe?: (file: string) => number; root?: string };

export const STORY_FIELDS: readonly string[];
export function mediaSource(ref: string): string;
export function listStories(deps: { fetch: Fetch; token: string }): Promise<{ id: string; title: string; downloadedAt: string; durationSeconds: number }[]>;
export function pullStory(deps: Deps, docId: string, options: { storyteller: string; id?: string }): Promise<{ id: string; title: string }>;
export function pullTake(deps: Deps, docId: string, options: { name?: string; scriptFile: string; variant: string }): Promise<void>;
