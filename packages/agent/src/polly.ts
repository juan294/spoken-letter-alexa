import { type PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { log, randomToken } from "@spoken-letter-alexa/shared";

/** Turns synthesized bytes into a URL the simulator can play. */
export interface SpeechStore {
  save(bytes: Uint8Array, contentType: string): Promise<string>;
}

/** Local development: a data URL, nothing written anywhere. */
export class DataUrlSpeechStore implements SpeechStore {
  save(bytes: Uint8Array, contentType: string): Promise<string> {
    return Promise.resolve(`data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`);
  }
}

/** AWS: `polly/<random>.mp3` in the assets bucket (1-hour lifecycle, Phase 6), served by CloudFront. */
export class S3SpeechStore implements SpeechStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(options: { client: S3Client; bucket: string; publicBaseUrl: string }) {
    this.client = options.client;
    this.bucket = options.bucket;
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/$/, "");
  }

  async save(bytes: Uint8Array, contentType: string): Promise<string> {
    const key = `polly/${randomToken(16)}.mp3`;
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType, CacheControl: "private, max-age=3600" }),
    );
    return `${this.publicBaseUrl}/${key}`;
  }
}

export interface SpeechSynthesizer {
  /** URL of the spoken reply, or null when speech is unavailable (the text is still shown). */
  synthesize(text: string): Promise<string | null>;
}

/**
 * Amazon Polly, neural `Joanna`, `en-US`, MP3. Used for Alexa's short replies only; the
 * family recording is played from its own URL and is never synthesized.
 */
export class PollySpeech implements SpeechSynthesizer {
  private readonly client: PollyClient;
  private readonly store: SpeechStore;
  private readonly voiceId: string;

  constructor(options: { client: PollyClient; store: SpeechStore; voiceId?: string }) {
    this.client = options.client;
    this.store = options.store;
    this.voiceId = options.voiceId ?? "Joanna";
  }

  async synthesize(text: string): Promise<string | null> {
    try {
      const result = await this.client.send(
        new SynthesizeSpeechCommand({
          Text: text,
          TextType: "text",
          VoiceId: this.voiceId as "Joanna",
          Engine: "neural",
          LanguageCode: "en-US",
          OutputFormat: "mp3",
        }),
      );
      if (!result.AudioStream) return null;
      const bytes = await result.AudioStream.transformToByteArray();
      return await this.store.save(bytes, result.ContentType ?? "audio/mpeg");
    } catch (error) {
      log.warn("polly_failed", { message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }
}
