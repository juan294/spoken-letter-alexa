import { randomToken, sha256Hex } from "@spoken-letter-alexa/shared";

import {
  CODE_TTL_SECONDS,
  type ConsumeCodeResult,
  type OAuthStore,
  type PendingAuth,
  type RefreshRecord,
  type RotateResult,
} from "./types.ts";

type CodeRecord = { authId: string; expiresAt: number; usedAt?: number };
type StoredRefresh = RefreshRecord & { rotatedAt?: number; revokedAt?: number };

/** In-memory store for tests and local development. Mirrors the DynamoDB semantics. */
export class MemoryStore implements OAuthStore {
  private readonly auths = new Map<string, PendingAuth>();
  private readonly links = new Map<string, string>();
  private readonly codes = new Map<string, CodeRecord>();
  private readonly refresh = new Map<string, StoredRefresh>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  putPendingAuth(auth: PendingAuth): Promise<void> {
    this.auths.set(auth.id, { ...auth });
    this.links.set(auth.linkTokenHash, auth.id);
    return Promise.resolve();
  }

  getPendingAuth(id: string): Promise<PendingAuth | null> {
    const auth = this.auths.get(id);
    return Promise.resolve(auth ? { ...auth } : null);
  }

  leaseLinkToken(tokenHash: string): Promise<PendingAuth | null> {
    const authId = this.links.get(tokenHash);
    const auth = authId ? this.auths.get(authId) : undefined;
    if (auth?.status !== "pending" || auth.expiresAt <= this.now()) return Promise.resolve(null);
    auth.status = "linked";
    return Promise.resolve({ ...auth });
  }

  bindSubject(authId: string, subject: string): Promise<void> {
    const auth = this.auths.get(authId);
    if (auth) auth.subject = subject;
    return Promise.resolve();
  }

  issueCode(authId: string): Promise<string | null> {
    const auth = this.auths.get(authId);
    if (auth?.status !== "linked") return Promise.resolve(null);
    const code = randomToken(32);
    const codeExpiresAt = this.now() + CODE_TTL_SECONDS;
    this.codes.set(sha256Hex(code), { authId, expiresAt: codeExpiresAt });
    auth.status = "issued";
    auth.expiresAt = Math.max(auth.expiresAt, codeExpiresAt + 60);
    return Promise.resolve(code);
  }

  consumeCode(codeHash: string): Promise<ConsumeCodeResult> {
    const record = this.codes.get(codeHash);
    if (!record || record.expiresAt <= this.now()) return Promise.resolve({ status: "missing" });
    if (record.usedAt !== undefined) return Promise.resolve({ status: "reused", familyId: record.authId });
    const auth = this.auths.get(record.authId);
    if (!auth) return Promise.resolve({ status: "missing" });
    record.usedAt = this.now();
    return Promise.resolve({ status: "ok", auth: { ...auth } });
  }

  putRefreshToken(record: RefreshRecord): Promise<void> {
    this.refresh.set(record.hash, { ...record });
    return Promise.resolve();
  }

  peekRefreshToken(hash: string): Promise<RefreshRecord | null> {
    const record = this.refresh.get(hash);
    if (!record) return Promise.resolve(null);
    const { rotatedAt: _rotatedAt, revokedAt: _revokedAt, ...plain } = record;
    return Promise.resolve(plain);
  }

  rotateRefreshToken(hash: string): Promise<RotateResult> {
    const record = this.refresh.get(hash);
    if (!record || record.revokedAt !== undefined || record.expiresAt <= this.now()) {
      return Promise.resolve({ status: "missing" });
    }
    if (record.rotatedAt !== undefined) return Promise.resolve({ status: "reused", familyId: record.familyId });
    record.rotatedAt = this.now();
    const { rotatedAt: _rotatedAt, revokedAt: _revokedAt, ...plain } = record;
    return Promise.resolve({ status: "ok", record: plain });
  }

  revokeRefreshToken(hash: string): Promise<void> {
    const record = this.refresh.get(hash);
    if (record) record.revokedAt = this.now();
    return Promise.resolve();
  }

  revokeFamily(familyId: string): Promise<void> {
    for (const record of this.refresh.values()) if (record.familyId === familyId) record.revokedAt = this.now();
    return Promise.resolve();
  }

  revokeSubject(subject: string): Promise<void> {
    for (const record of this.refresh.values()) if (record.subject === subject) record.revokedAt = this.now();
    return Promise.resolve();
  }

  // Test helpers.
  pendingByLinkHash(tokenHash: string): PendingAuth | null {
    const authId = this.links.get(tokenHash);
    return authId ? (this.auths.get(authId) ?? null) : null;
  }

  dump(): unknown {
    return { auths: [...this.auths.values()], links: [...this.links.keys()], codes: [...this.codes.keys()], refresh: [...this.refresh.keys()] };
  }
}
