/** Every secret value (link token, code, refresh token) is stored only as `sha256(value)`. */

export type PendingAuthStatus = "pending" | "linked" | "issued";

export type PendingAuth = {
  id: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string;
  scope: string;
  status: PendingAuthStatus;
  /** Spoken Letter uid bound by `/bridge/link/complete`. */
  subject?: string | undefined;
  linkTokenHash: string;
  /** Epoch seconds. */
  createdAt: number;
  /** Epoch seconds; DynamoDB TTL attribute. */
  expiresAt: number;
};

export type RefreshRecord = {
  hash: string;
  subject: string;
  scope: string;
  clientId: string;
  /** The pending authorization the family descends from; reuse revokes the family. */
  familyId: string;
  /** Epoch seconds. */
  expiresAt: number;
  rotatedFrom?: string | undefined;
};

export type ConsumeCodeResult =
  | { status: "ok"; auth: PendingAuth }
  | { status: "reused"; familyId: string }
  | { status: "missing" };

export type RotateResult =
  | { status: "ok"; record: RefreshRecord }
  | { status: "reused"; familyId: string }
  | { status: "missing" };

export interface OAuthStore {
  putPendingAuth(auth: PendingAuth): Promise<void>;
  getPendingAuth(id: string): Promise<PendingAuth | null>;
  /** Conditional `pending` to `linked`; null when missing, used or expired. */
  leaseLinkToken(tokenHash: string): Promise<PendingAuth | null>;
  bindSubject(authId: string, subject: string): Promise<void>;
  /** Returns the raw code (5-minute TTL, single use) and marks the authorization `issued`. */
  issueCode(authId: string): Promise<string>;
  consumeCode(codeHash: string): Promise<ConsumeCodeResult>;
  putRefreshToken(record: RefreshRecord): Promise<void>;
  /** Conditional rotation; a second rotation of the same token reports `reused`. */
  rotateRefreshToken(hash: string): Promise<RotateResult>;
  revokeRefreshToken(hash: string): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
  revokeSubject(subject: string): Promise<void>;
}

export const LINK_TOKEN_TTL_SECONDS = 15 * 60;
export const CODE_TTL_SECONDS = 5 * 60;
export const REFRESH_TTL_SECONDS = 90 * 24 * 60 * 60;
