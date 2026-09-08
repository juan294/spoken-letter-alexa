import { type JWK } from "jose";

export type PublicJwk = JWK & { kid: string; alg: "RS256"; use: "sig" };

/** RS256 signer behind a small interface: local RSA key for tests and dev, KMS in AWS. */
export interface Signer {
  /** Signs `data` with RSASSA-PKCS1-v1_5 SHA-256 and returns the raw signature. */
  sign(data: Uint8Array): Promise<Uint8Array>;
  /** The public key for `/.well-known/jwks.json`; `kid` is the RFC 7638 thumbprint. */
  publicJwk(): Promise<PublicJwk>;
}
