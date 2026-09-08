import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { StartStreamTranscriptionCommand, TranscribeStreamingClient } from "@aws-sdk/client-transcribe-streaming";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, test } from "vitest";

import { convertWebmToPcm, createTranscriber, FFMPEG_PATH } from "./transcribe.ts";

const transcribe = mockClient(TranscribeStreamingClient);

async function* resultStream() {
  await Promise.resolve();
  yield { TranscriptEvent: { Transcript: { Results: [{ IsPartial: true, Alternatives: [{ Transcript: "play the" }] }] } } };
  yield { TranscriptEvent: { Transcript: { Results: [{ IsPartial: false, Alternatives: [{ Transcript: "Play the story Grandpa sent." }] }] } } };
  yield { TranscriptEvent: { Transcript: { Results: [{ IsPartial: false, Alternatives: [{ Transcript: "Please." }] }] } } };
}

describe("createTranscriber", () => {
  beforeEach(() => {
    transcribe.reset();
  });

  test("streams 16 kHz PCM chunks and joins the final transcripts", async () => {
    const sent: number[] = [];
    transcribe.on(StartStreamTranscriptionCommand).callsFake(async (input: { AudioStream: AsyncIterable<{ AudioEvent?: { AudioChunk?: Uint8Array } }> }) => {
      for await (const event of input.AudioStream) sent.push(event.AudioEvent?.AudioChunk?.byteLength ?? 0);
      return { TranscriptResultStream: resultStream() };
    });
    const pcm = new Uint8Array(70_000);
    const transcriber = createTranscriber({
      client: new TranscribeStreamingClient({ region: "us-east-1" }),
      convert: () => Promise.resolve(pcm),
    });
    const text = await transcriber(new Uint8Array([1, 2, 3]), "audio/webm");
    expect(text).toBe("Play the story Grandpa sent. Please.");
    const input = transcribe.commandCalls(StartStreamTranscriptionCommand)[0]!.args[0].input;
    expect(input).toMatchObject({ LanguageCode: "en-US", MediaEncoding: "pcm", MediaSampleRateHertz: 16_000 });
    expect(sent.reduce((a, b) => a + b, 0)).toBe(70_000);
    expect(Math.max(...sent)).toBeLessThanOrEqual(32_000);
  });

  test("an empty utterance yields an empty string", async () => {
    async function* nothing() {
      await Promise.resolve();
      yield* [];
    }
    transcribe.on(StartStreamTranscriptionCommand).resolves({ TranscriptResultStream: nothing() });
    const transcriber = createTranscriber({
      client: new TranscribeStreamingClient({ region: "us-east-1" }),
      convert: () => Promise.resolve(new Uint8Array(0)),
    });
    await expect(transcriber(new Uint8Array(0), "audio/webm")).resolves.toBe("");
  });
});

describe("convertWebmToPcm", () => {
  test("turns a WebM/Opus utterance into 16 kHz mono s16le with ffmpeg-static", async () => {
    if (FFMPEG_PATH === null) throw new Error("ffmpeg-static binary missing");
    const dir = mkdtempSync(path.join(tmpdir(), "sla-webm-"));
    const file = path.join(dir, "tone.webm");
    execFileSync(FFMPEG_PATH, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", "-c:a", "libopus", file]);
    const pcm = await convertWebmToPcm(readFileSync(file));
    // 0.5 s at 16 kHz, 16-bit mono = 16 000 bytes; Opus priming adds a few frames.
    expect(pcm.byteLength).toBeGreaterThan(14_000);
    expect(pcm.byteLength).toBeLessThan(20_000);
  });
});
