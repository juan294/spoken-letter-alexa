import { createPublicKey } from "node:crypto";

import { GetPublicKeyCommand, type KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { calculateJwkThumbprint, exportJWK } from "jose";

import { type PublicJwk, type Signer } from "./types.ts";

/**
 * Signs with an asymmetric KMS key (`RSA_2048`, `SIGN_VERIFY`) using
 * `RSASSA_PKCS1_V1_5_SHA_256`; the private key never leaves KMS. The public key is
 * fetched once per process and cached for the JWKS document.
 */
export class KmsSigner implements Signer {
  private readonly client: KMSClient;
  private readonly keyId: string;
  private jwk: Promise<PublicJwk> | undefined;

  constructor(options: { client: KMSClient; keyId: string }) {
    this.client = options.client;
    this.keyId = options.keyId;
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    const result = await this.client.send(
      new SignCommand({
        KeyId: this.keyId,
        Message: data,
        MessageType: "RAW",
        SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
      }),
    );
    if (!result.Signature) throw new Error("KMS Sign returned no signature");
    return result.Signature;
  }

  publicJwk(): Promise<PublicJwk> {
    this.jwk ??= this.fetchPublicJwk();
    return this.jwk.then((jwk) => ({ ...jwk }));
  }

  private async fetchPublicJwk(): Promise<PublicJwk> {
    const result = await this.client.send(new GetPublicKeyCommand({ KeyId: this.keyId }));
    if (!result.PublicKey) throw new Error("KMS GetPublicKey returned no key");
    const key = createPublicKey({ key: Buffer.from(result.PublicKey), format: "der", type: "spki" });
    const jwk = await exportJWK(key);
    const kid = await calculateJwkThumbprint(jwk);
    return { ...jwk, kid, alg: "RS256", use: "sig" };
  }
}
