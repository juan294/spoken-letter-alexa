import { sha256Hex } from "@spoken-letter-alexa/shared";
import { describe, expect, test } from "vitest";

import { MemoryStore } from "./memory.ts";
import { type PendingAuth, type RefreshRecord } from "./types.ts";

function pending(overrides: Partial<PendingAuth> = {}): PendingAuth {
  return {
    id: "auth_1",
    clientId: "simulator",
    redirectUri: "http://localhost:5173/demo/callback",
    codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    codeChallengeMethod: "S256",
    state: "xyz",
    scope: "mcp:tools mcp:resources",
    status: "pending",
    linkTokenHash: "hash_1",
    createdAt: 1_000,
    expiresAt: 1_000 + 900,
    ...overrides,
  };
}

function refresh(overrides: Partial<RefreshRecord> = {}): RefreshRecord {
  return {
    hash: "rt_hash_1",
    subject: "uid_1",
    scope: "mcp:tools mcp:resources",
    clientId: "simulator",
    familyId: "auth_1",
    expiresAt: 1_000 + 90 * 86_400,
    ...overrides,
  };
}

describe("MemoryStore", () => {
  test("leases a link token exactly once and binds the subject", async () => {
    let now = 1_100;
    const store = new MemoryStore({ now: () => now });
    await store.putPendingAuth(pending());
    const leased = await store.leaseLinkToken("hash_1");
    expect(leased?.id).toBe("auth_1");
    expect(leased?.status).toBe("linked");
    await expect(store.leaseLinkToken("hash_1")).resolves.toBeNull();
    await expect(store.leaseLinkToken("unknown")).resolves.toBeNull();
    await store.bindSubject("auth_1", "uid_1");
    await expect(store.getPendingAuth("auth_1")).resolves.toMatchObject({ subject: "uid_1", status: "linked" });
    now = 1_000 + 901;
    await store.putPendingAuth(pending({ id: "auth_2", linkTokenHash: "hash_2" }));
    await expect(store.leaseLinkToken("hash_2")).resolves.toBeNull();
  });

  test("issues a single-use code and reports reuse with the family id", async () => {
    const store = new MemoryStore({ now: () => 1_100 });
    await store.putPendingAuth(pending({ status: "linked", subject: "uid_1" }));
    const code = (await store.issueCode("auth_1"))!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    await expect(store.getPendingAuth("auth_1")).resolves.toMatchObject({ status: "issued" });
    const first = await store.consumeCode(sha256Hex(code));
    expect(first).toMatchObject({ status: "ok", auth: { id: "auth_1", subject: "uid_1" } });
    const second = await store.consumeCode(sha256Hex(code));
    expect(second).toEqual({ status: "reused", familyId: "auth_1" });
    await expect(store.consumeCode("never-issued")).resolves.toEqual({ status: "missing" });
  });

  test("issueCode is conditional on the linked status and keeps the authorization alive for the code", async () => {
    const store = new MemoryStore({ now: () => 1_890 });
    await store.putPendingAuth(pending({ status: "pending" }));
    await expect(store.issueCode("auth_1")).resolves.toBeNull();
    await store.putPendingAuth(pending({ status: "linked", subject: "uid_1" }));
    const code = await store.issueCode("auth_1");
    expect(code).not.toBeNull();
    await expect(store.issueCode("auth_1")).resolves.toBeNull();
    await expect(store.getPendingAuth("auth_1")).resolves.toMatchObject({ status: "issued", expiresAt: 1_890 + 300 + 60 });
    await expect(store.issueCode("unknown")).resolves.toBeNull();
  });

  test("peekRefreshToken reads rotated and revoked records without changing them", async () => {
    const store = new MemoryStore({ now: () => 1_100 });
    await expect(store.peekRefreshToken("nope")).resolves.toBeNull();
    await store.putRefreshToken(refresh({ hash: "a" }));
    await store.rotateRefreshToken("a");
    await store.revokeRefreshToken("a");
    await expect(store.peekRefreshToken("a")).resolves.toEqual(refresh({ hash: "a" }));
  });

  test("expired codes are missing", async () => {
    let now = 1_100;
    const store = new MemoryStore({ now: () => now });
    await store.putPendingAuth(pending({ status: "linked", subject: "uid_1" }));
    const code = (await store.issueCode("auth_1"))!;
    now += 301;
    await expect(store.consumeCode(sha256Hex(code))).resolves.toEqual({ status: "missing" });
  });

  test("rotates refresh tokens once and revokes the family on reuse", async () => {
    const store = new MemoryStore({ now: () => 1_100 });
    await store.putRefreshToken(refresh());
    const rotated = await store.rotateRefreshToken("rt_hash_1");
    expect(rotated).toMatchObject({ status: "ok", record: { subject: "uid_1", familyId: "auth_1" } });
    await store.putRefreshToken(refresh({ hash: "rt_hash_2", rotatedFrom: "rt_hash_1" }));
    const reuse = await store.rotateRefreshToken("rt_hash_1");
    expect(reuse).toEqual({ status: "reused", familyId: "auth_1" });
    await store.revokeFamily("auth_1");
    await expect(store.rotateRefreshToken("rt_hash_2")).resolves.toEqual({ status: "missing" });
  });

  test("expired and unknown refresh tokens are missing", async () => {
    const store = new MemoryStore({ now: () => 1_100 });
    await store.putRefreshToken(refresh({ hash: "old", expiresAt: 1_000 }));
    await expect(store.rotateRefreshToken("old")).resolves.toEqual({ status: "missing" });
    await expect(store.rotateRefreshToken("nope")).resolves.toEqual({ status: "missing" });
  });

  test("revokeSubject removes every refresh token for the subject", async () => {
    const store = new MemoryStore({ now: () => 1_100 });
    await store.putRefreshToken(refresh({ hash: "a", subject: "uid_1" }));
    await store.putRefreshToken(refresh({ hash: "b", subject: "uid_1", familyId: "auth_9" }));
    await store.putRefreshToken(refresh({ hash: "c", subject: "uid_2" }));
    await store.revokeSubject("uid_1");
    await expect(store.rotateRefreshToken("a")).resolves.toEqual({ status: "missing" });
    await expect(store.rotateRefreshToken("b")).resolves.toEqual({ status: "missing" });
    await expect(store.rotateRefreshToken("c")).resolves.toMatchObject({ status: "ok" });
  });

  test("revokeRefreshToken (RFC 7009) is idempotent", async () => {
    const store = new MemoryStore({ now: () => 1_100 });
    await store.putRefreshToken(refresh({ hash: "a" }));
    await store.revokeRefreshToken("a");
    await store.revokeRefreshToken("a");
    await expect(store.rotateRefreshToken("a")).resolves.toEqual({ status: "missing" });
  });
});
