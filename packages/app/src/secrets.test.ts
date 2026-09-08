import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, test } from "vitest";

import { loadSecretsIntoEnv } from "./secrets.ts";

const sm = mockClient(SecretsManagerClient);
const BRIDGE_ARN = "arn:aws:secretsmanager:us-east-1:106403001709:secret:sla/bridge-abc";
const CLIENTS_ARN = "arn:aws:secretsmanager:us-east-1:106403001709:secret:sla/oauth-clients-def";

describe("loadSecretsIntoEnv", () => {
  beforeEach(() => {
    sm.reset();
  });

  test("copies the bridge secret, the clients JSON and the m2m secret into the environment", async () => {
    sm.on(GetSecretValueCommand, { SecretId: BRIDGE_ARN }).resolves({ SecretString: "bridge-value-not-real-0123456789" });
    sm.on(GetSecretValueCommand, { SecretId: CLIENTS_ARN }).resolves({
      SecretString: JSON.stringify({
        clients: [{ clientId: "simulator", redirectUris: ["https://alexa.spokenletter.com/demo/callback"], grants: ["authorization_code"] }],
        m2mSecret: "m2m-value-not-real-0123456789",
      }),
    });
    const env: Record<string, string | undefined> = { SECRETS_BRIDGE_ARN: BRIDGE_ARN, SECRETS_OAUTH_CLIENTS_ARN: CLIENTS_ARN };
    await loadSecretsIntoEnv(new SecretsManagerClient({ region: "us-east-1" }), env);
    expect(env.ALEXA_BRIDGE_SECRET).toBe("bridge-value-not-real-0123456789");
    expect(env.OAUTH_M2M_SECRET).toBe("m2m-value-not-real-0123456789");
    expect(JSON.parse(env.OAUTH_CLIENTS ?? "[]")).toEqual([
      { clientId: "simulator", redirectUris: ["https://alexa.spokenletter.com/demo/callback"], grants: ["authorization_code"] },
    ]);
  });

  test("fails loudly on a missing ARN or a malformed clients document", async () => {
    await expect(loadSecretsIntoEnv(new SecretsManagerClient({ region: "us-east-1" }), {})).rejects.toThrow(/SECRETS_BRIDGE_ARN/);
    sm.on(GetSecretValueCommand, { SecretId: BRIDGE_ARN }).resolves({ SecretString: "x".repeat(32) });
    sm.on(GetSecretValueCommand, { SecretId: CLIENTS_ARN }).resolves({ SecretString: JSON.stringify({ clients: "nope" }) });
    await expect(
      loadSecretsIntoEnv(new SecretsManagerClient({ region: "us-east-1" }), { SECRETS_BRIDGE_ARN: BRIDGE_ARN, SECRETS_OAUTH_CLIENTS_ARN: CLIENTS_ARN }),
    ).rejects.toThrow(/clients\[\] and m2mSecret/);
  });
});
