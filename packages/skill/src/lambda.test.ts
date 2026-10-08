import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSecret: vi.fn(),
  createAgentClient: vi.fn(() => ({ turn: vi.fn() })),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    send = mocks.getSecret;
  },
  GetSecretValueCommand: class {
    constructor(readonly input: { SecretId: string }) {}
  },
}));
vi.mock("./agent-client.ts", () => ({ createAgentClient: mocks.createAgentClient }));

describe("skill Lambda cold start", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
    mocks.getSecret.mockReset();
    mocks.createAgentClient.mockClear();
  });

  test("loads the command secret and passes it only to the agent client", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://alexa.spokenletter.com");
    vi.stubEnv("SKILL_ID", "amzn1.ask.skill.test");
    vi.stubEnv("SECRETS_SKILL_COMMAND_ARN", "arn:aws:secretsmanager:us-east-1:123:secret:sla/skill-command");
    mocks.getSecret.mockResolvedValue({ SecretString: "example-command-secret-0123456789" });

    await import("./lambda.ts");

    expect(mocks.getSecret).toHaveBeenCalledOnce();
    expect(mocks.getSecret).toHaveBeenCalledWith(expect.objectContaining({ input: { SecretId: process.env.SECRETS_SKILL_COMMAND_ARN } }));
    expect(mocks.createAgentClient).toHaveBeenCalledWith({
      baseUrl: "https://alexa.spokenletter.com",
      timeoutMs: 7_000,
      skillSecret: "example-command-secret-0123456789",
    });
  });

  test("passes the public host to the handler so takes play from CloudFront", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://alexa.spokenletter.com");
    vi.stubEnv("SKILL_ID", "amzn1.ask.skill.test");
    vi.stubEnv("SECRETS_SKILL_COMMAND_ARN", "arn:aws:secretsmanager:us-east-1:123:secret:sla/skill-command");
    mocks.getSecret.mockResolvedValue({ SecretString: "example-command-secret-0123456789" });

    const { handler } = await import("./lambda.ts");
    const response = await handler({
      version: "1.0",
      context: { System: { application: { applicationId: "amzn1.ask.skill.test" }, user: { userId: "amzn1.ask.account.OWNER" } } },
      request: { type: "IntentRequest", requestId: "r1", timestamp: "2026-10-08T18:00:00Z", locale: "en-US", intent: { name: "TheEndIntent" } },
    });
    expect(response.response.outputSpeech?.ssml).toContain('<audio src="https://alexa.spokenletter.com/fixtures/takes/');
  });

  test("fails closed when the command secret has no string value", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://alexa.spokenletter.com");
    vi.stubEnv("SKILL_ID", "amzn1.ask.skill.test");
    vi.stubEnv("SECRETS_SKILL_COMMAND_ARN", "arn:aws:secretsmanager:us-east-1:123:secret:sla/skill-command");
    mocks.getSecret.mockResolvedValue({});

    await expect(import("./lambda.ts")).rejects.toThrow("sla/skill-command has no value");
    expect(mocks.createAgentClient).not.toHaveBeenCalled();
  });

  test("legacy recording switches warn that raw recording is disabled", async () => {
  vi.stubEnv("PUBLIC_BASE_URL", "https://alexa.spokenletter.com");
  vi.stubEnv("SKILL_ID", "amzn1.ask.skill.test");
  vi.stubEnv("SECRETS_SKILL_COMMAND_ARN", "example-arn");
  vi.stubEnv("RECORD_UTTERANCES", "1");
  vi.stubEnv("LOG_SAY", "1");
  mocks.getSecret.mockResolvedValue({ SecretString: "example-command-secret-0123456789" });
  const { log } = await import("@spoken-letter-alexa/shared");
  const warn = vi.spyOn(log, "warn");
  await import("./lambda.ts");
  expect(warn).toHaveBeenCalledWith("raw_recording_disabled", { control: "RECORD_UTTERANCES" });
  expect(warn).toHaveBeenCalledWith("raw_recording_disabled", { control: "LOG_SAY" });
});

});
