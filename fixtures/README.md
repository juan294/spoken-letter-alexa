# Fixture stories

The recordings under `fixtures/audio/` are three English stories recorded by a family
member (shown as "Aunt Whitney") for the Owner's family and exported by the Owner through
the normal MP3 download (the `downloaded` status is exactly what the product calls
delivery). They are included under this repository's MIT licence for demonstration: the
`demo` subject and the judges' simulator play them. No AI narration, no child voice, no
child data: the catalog carries title, storyteller, duration and delivery time only.

The cards under `fixtures/art/` are the same three stories' own artwork: the 16×16 icon
Spoken Letter generated for each story, upscaled with hard edges onto the brand's ink and
lamplight ground at 480×480 (the size Alexa asks for on an AudioPlayer card). Mauricio's
and Martina's stories carry the generic "Blue Book" icon in the product, so those two
cards are deliberately identical — that is the story's real art, not a placeholder.

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

3. Optionally add the story's artwork. Its 16×16 icon is the object `iconRef` names in
   Firestore; pull it and render the card at `fixtures/art/<id>.png` before step 2, so the
   helper picks it up:

   ```bash
   gcloud storage cp "gs://spoken-letter-media/<iconRef>" /tmp/icon.png
   magick -size 480x480 radial-gradient:'#3A3247'-'#2E2738' \
     \( -size 480x480 xc:none -fill 'rgba(228,164,92,0.30)' -draw 'circle 240,240 240,110' -blur 0x40 \) \
     -compose over -composite \
     \( /tmp/icon.png -filter point -resize 320x320 \) -gravity center -compose over -composite \
     -depth 8 -strip PNG24:fixtures/art/st_owl.png
   ```

   `-filter point` is what keeps the pixel art crisp; anything smoother blurs it. Alexa
   needs the card over HTTPS, which CloudFront already serves at `/fixtures/art/*`.

4. `pnpm test` (the catalog parser runs in `packages/mcp-server`), then commit the MP3,
   the artwork and the catalog together.

Until `fixtures/stories.json` exists the local server starts with an empty catalog and
logs `fixtures_missing`; every tool then answers "No stories have been delivered yet."
