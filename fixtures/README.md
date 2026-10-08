# Fixture stories

The recordings under `fixtures/audio/` are seven stories recorded for the Owner's family by
three family members: three English stories shown as "Aunt Whitney", three English stories
shown as "Aunt Jordan", and one Spanish story shown as "Tío Manuel". Each was added only
after the Owner delivered it (the `downloaded` status is exactly what the product calls
delivery), with the storyteller's consent to publish: the Aunt Whitney stories by manual
export, the others with `scripts/pull-fixture-story.mjs`. They are included under this
repository's MIT licence for demonstration: the `demo` subject and the judges' simulator
play them. No AI narration, no child voice, no child data: the catalog carries title,
storyteller, duration and delivery time only.

The cards under `fixtures/art/` are the stories' own artwork: the 16×16 icon Spoken Letter
generated for each story, upscaled with hard edges onto the brand's ink and lamplight
ground at 480×480 (the size Alexa asks for on an AudioPlayer card). Several stories carry
the generic "Blue Book" icon in the product (Mauricio, Martina, Andrea, Peach and Walla), so
those cards are deliberately identical — that is the stories' real art, not a placeholder.

`fixtures/stories.json` is the catalog the fixture provider serves:

```json
{
  "stories": [
    {
      "id": "st_example",
      "title": "The owl who forgot how to hoot",
      "storyteller": "Grandpa Juan",
      "durationSeconds": 184,
      "deliveredAt": "2026-08-30T19:12:00.000Z",
      "file": "st_example.mp3",
      "art": "st_example.png"
    }
  ]
}
```

Fields are the ADR 0013 boundary for this repository: id, title, storyteller (a display
name the Owner chooses), duration, delivery time, the audio file name and — optionally —
the artwork file name. Nothing else is accepted; unknown keys are dropped by the parser.
`art` is a picture of the story: no Yoto icon id, card id or icon title comes with it.

## Adding a story

`scripts/pull-fixture-story.mjs` pulls a delivered story straight from production with
read-only calls under the Owner's `gcloud` credentials (project `spoken-letter`):

```bash
# Delivered stories to choose from: id, delivery date, duration and title only
node scripts/pull-fixture-story.mjs --list

# Pull one: final mix to fixtures/audio/<id>.mp3, art to fixtures/art/<id>.png, catalog entry
node scripts/pull-fixture-story.mjs <storyDocId> --storyteller "Grandpa Juan" [--id st_owl]
```

The story read uses a field mask of title, status, mix, icon, delivery time and space only:
never recipient, sender or content fields (ADR 0013). It refuses a story that is not
`downloaded` or whose final mix is not `ready`. The duration comes from `ffprobe` and the
delivery time from `downloadedAt`. The art is rendered from the story's 16×16 icon with
`-filter point`, which keeps the pixel art crisp; Alexa needs the card over HTTPS, which
CloudFront already serves at `/fixtures/art/*`.

Before committing, check the printed title and the audio for a child's name, and confirm
the storyteller agrees to publication. Then regenerate the interaction models
(`pnpm -F @spoken-letter-alexa/skill generate`), add the files to the simulator's mock
(`packages/simulator/src/agent/mock.ts`), run `pnpm test`, and commit the MP3, the artwork,
the catalog and the models together.

`--as-take <script-file> --variant <plain|effects|music|both>[,…] [--name <slug>]` pulls the
same story's current final mix into `fixtures/takes/` as a demo take, through
`scripts/add-demo-take.mjs`.

For a file that is not in production, `scripts/add-fixture-story.mjs <mp3> --title …
--storyteller … --delivered-at …` registers an MP3 already copied to `fixtures/audio/`.

Until `fixtures/stories.json` exists the local server starts with an empty catalog and
logs `fixtures_missing`; every tool then answers "No stories have been delivered yet."
