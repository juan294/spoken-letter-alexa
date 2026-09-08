import { spawn } from "node:child_process";

import { StartStreamTranscriptionCommand, type TranscribeStreamingClient } from "@aws-sdk/client-transcribe-streaming";
import { log } from "@spoken-letter-alexa/shared";
import ffmpegStatic from "ffmpeg-static";

/** `ffmpeg-static` exports the binary path as a CommonJS default; under NodeNext it may arrive wrapped. */
function resolveFfmpegPath(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "default" in value && typeof value.default === "string") return value.default;
  return null;
}

export const FFMPEG_PATH: string | null = resolveFfmpegPath(ffmpegStatic);

export type Transcriber = (audio: Uint8Array, contentType: string) => Promise<string>;

const SAMPLE_RATE = 16_000;
/** Amazon Transcribe streaming accepts chunks up to 32 KiB; 100 ms of 16 kHz s16le mono is 3 200 bytes. */
const CHUNK_BYTES = 3_200;

/** WebM/Opus (MediaRecorder) to 16 kHz mono signed 16-bit PCM through `ffmpeg-static`. */
export function convertWebmToPcm(input: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (FFMPEG_PATH === null) {
      reject(new Error("ffmpeg-static binary is not available"));
      return;
    }
    const child = spawn(
      FFMPEG_PATH,
      ["-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "pipe:1"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      if (code === 0) resolve(new Uint8Array(Buffer.concat(chunks)));
      else reject(new Error(`ffmpeg exited with ${code}: ${Buffer.concat(errors).toString("utf8").slice(0, 200)}`));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(Buffer.from(input));
  });
}

async function* pcmChunks(pcm: Uint8Array) {
  await Promise.resolve();
  for (let offset = 0; offset < pcm.byteLength; offset += CHUNK_BYTES) {
    yield { AudioEvent: { AudioChunk: pcm.subarray(offset, Math.min(offset + CHUNK_BYTES, pcm.byteLength)) } };
  }
}

/**
 * Amazon Transcribe streaming for one utterance (at most 15 seconds). Only final results
 * are kept; partial hypotheses are discarded.
 */
export function createTranscriber(options: {
  client: TranscribeStreamingClient;
  convert?: (audio: Uint8Array) => Promise<Uint8Array>;
}): Transcriber {
  const convert = options.convert ?? convertWebmToPcm;
  return async (audio) => {
    const pcm = await convert(audio);
    const response = await options.client.send(
      new StartStreamTranscriptionCommand({
        LanguageCode: "en-US",
        MediaEncoding: "pcm",
        MediaSampleRateHertz: SAMPLE_RATE,
        AudioStream: pcmChunks(pcm),
      }),
    );
    const finals: string[] = [];
    for await (const event of response.TranscriptResultStream ?? []) {
      for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
        if (result.IsPartial) continue;
        const transcript = result.Alternatives?.[0]?.Transcript?.trim();
        if (transcript) finals.push(transcript);
      }
    }
    const text = finals.join(" ");
    log.info("transcribe_done", { bytes: pcm.byteLength, chars: text.length });
    return text;
  };
}
