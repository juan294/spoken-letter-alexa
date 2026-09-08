import { createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from "node:crypto";

import { GetPublicKeyCommand, KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, test } from "vitest";

import { KmsSigner } from "./kms.ts";
import { LocalSigner } from "./local.ts";

const kms = mockClient(KMSClient);
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

describe("KmsSigner", () => {
  beforeEach(() => {
    kms.reset();
    kms.on(GetPublicKeyCommand).resolves({ PublicKey: new Uint8Array(publicKey.export({ type: "spki", format: "der" })) });
    kms.on(SignCommand).callsFake((input: { Message: Uint8Array }) => ({
      Signature: new Uint8Array(nodeSign("sha256", Buffer.from(input.Message), privateKey)),
    }));
  });

  test("signs with RSASSA_PKCS1_V1_5_SHA_256 and publishes the KMS public key as a JWK", async () => {
    const signer = new KmsSigner({ client: new KMSClient({ region: "us-east-1" }), keyId: "alias/sla-jwt" });
    const jwk = await signer.publicJwk();
    expect(jwk).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig", kid: expect.any(String) as string });
    const signature = await signer.sign(new TextEncoder().encode("payload"));
    expect(nodeVerify("sha256", Buffer.from("payload"), publicKey, Buffer.from(signature))).toBe(true);
    const signCall = kms.commandCalls(SignCommand)[0]!.args[0].input;
    expect(signCall).toMatchObject({ KeyId: "alias/sla-jwt", SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256", MessageType: "RAW" });
  });

  test("caches the public key across calls", async () => {
    const signer = new KmsSigner({ client: new KMSClient({ region: "us-east-1" }), keyId: "alias/sla-jwt" });
    await signer.publicJwk();
    await signer.publicJwk();
    await signer.sign(new TextEncoder().encode("x"));
    expect(kms.commandCalls(GetPublicKeyCommand)).toHaveLength(1);
  });
});

describe("LocalSigner", () => {
  test("generates a key at construction and its JWK verifies its signatures", async () => {
    const signer = await LocalSigner.create();
    const jwk = await signer.publicJwk();
    expect(jwk.kid).toBe(signer.kid);
    const data = new TextEncoder().encode("hello");
    const signature = await signer.sign(data);
    const key = createPublicKey({ key: jwk, format: "jwk" });
    expect(nodeVerify("sha256", Buffer.from(data), key, Buffer.from(signature))).toBe(true);
  });
});
