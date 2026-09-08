# Fixture stories

The recordings under `fixtures/audio/` are the author's own voice, exported from Spoken
Letter through the normal MP3 download (the `downloaded` status is exactly what the
product calls delivery). They are included under this repository's MIT licence for
demonstration: the `demo` subject and the judges' simulator play them. No AI narration,
no child voice, no child data.

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
      "file": "st_example.mp3"
    }
  ]
}
```

Fields are the ADR 0013 boundary for this repository: id, title, storyteller (a display
name the Owner chooses), duration, delivery time and the audio file name. Nothing else is
accepted; unknown keys are dropped by the parser.

## Adding a story (Owner, manual)

1. Export the delivered story from Spoken Letter as MP3 and copy it to
   `fixtures/audio/<id>.mp3` (`<id>` is lowercase letters, digits, `_` or `-`).
2. Run the helper, which measures the duration with `ffprobe` and appends the entry:

   ```bash
   node scripts/add-fixture-story.mjs fixtures/audio/st_owl.mp3 \
     --title "The owl who forgot how to hoot" \
     --storyteller "Grandpa Juan" \
     --delivered-at 2026-08-30T19:12:00Z
   ```

3. `pnpm test` (the catalog parser runs in `packages/mcp-server`), then commit the MP3
   and the catalog together.

Until `fixtures/stories.json` exists the local server starts with an empty catalog and
logs `fixtures_missing`; every tool then answers "No stories have been delivered yet."
