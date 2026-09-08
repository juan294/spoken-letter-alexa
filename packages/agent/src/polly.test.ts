import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, test } from "vitest";

import { DataUrlSpeechStore, PollySpeech, S3SpeechStore } from "./polly.ts";

const polly = mockClient(PollyClient);
const s3 = mockClient(S3Client);

describe("PollySpeech", () => {
  beforeEach(() => {
    polly.reset();
    s3.reset();
  });

  test("synthesizes the reply with the neural Joanna en-US voice as MP3 and stores it", async () => {
    polly.on(SynthesizeSpeechCommand).resolves({
      ContentType: "audio/mpeg",
      AudioStream: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) } as never,
    });
    const speech = new PollySpeech({ client: new PollyClient({ region: "us-east-1" }), store: new DataUrlSpeechStore() });
    const url = await speech.synthesize("Here is the story Grandpa sent.");
    expect(url).toBe("data:audio/mpeg;base64,AQID");
    expect(polly.commandCalls(SynthesizeSpeechCommand)[0]!.args[0].input).toEqual({
      Text: "Here is the story Grandpa sent.",
      TextType: "text",
      VoiceId: "Joanna",
      Engine: "neural",
      LanguageCode: "en-US",
      OutputFormat: "mp3",
    });
  });

  test("returns null and never throws when Polly fails", async () => {
    polly.on(SynthesizeSpeechCommand).rejects(new Error("throttled"));
    const speech = new PollySpeech({ client: new PollyClient({ region: "us-east-1" }), store: new DataUrlSpeechStore() });
    await expect(speech.synthesize("hello")).resolves.toBeNull();
  });

  test("the S3 store writes under polly/ and returns the public URL", async () => {
    s3.on(PutObjectCommand).resolves({});
    const store = new S3SpeechStore({ client: new S3Client({ region: "us-east-1" }), bucket: "sla-assets", publicBaseUrl: "https://alexa.spokenletter.com" });
    const url = await store.save(new Uint8Array([9]), "audio/mpeg");
    const input = s3.commandCalls(PutObjectCommand)[0]!.args[0].input;
    expect(input).toMatchObject({ Bucket: "sla-assets", ContentType: "audio/mpeg", CacheControl: "private, max-age=3600" });
    expect(String(input.Key)).toMatch(/^polly\/[A-Za-z0-9_-]+\.mp3$/);
    expect(url).toBe(`https://alexa.spokenletter.com/${String(input.Key)}`);
  });
});
