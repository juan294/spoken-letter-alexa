import { generateKeyPairSync, type KeyObject, sign as nodeSign } from "node:crypto";

import { calculateJwkThumbprint, exportJWK } from "jose";

import { type PublicJwk, type Signer } from "./types.ts";

/** Generates an RSA-2048 key at startup. Tests and `pnpm dev` only; never persisted. */
export class LocalSigner implements Signer {
  private constructor(
    private readonly privateKey: KeyObject,
    private readonly jwk: PublicJwk,
  ) {}

  static async create(): Promise<LocalSigner> {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = await exportJWK(publicKey);
    const kid = await calculateJwkThumbprint(jwk);
    return new LocalSigner(privateKey, { ...jwk, kid, alg: "RS256", use: "sig" });
  }

  get kid(): string {
    return this.jwk.kid;
  }

  sign(data: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(nodeSign("sha256", Buffer.from(data), this.privateKey)));
  }

  publicJwk(): Promise<PublicJwk> {
    return Promise.resolve({ ...this.jwk });
  }
}
