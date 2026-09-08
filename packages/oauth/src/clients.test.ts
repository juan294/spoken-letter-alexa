import { sha256Hex } from "@spoken-letter-alexa/shared";
import { describe, expect, test } from "vitest";

import { authenticateClient, findClient, parseClients } from "./clients.ts";

const SECRET = "example-client-secret-not-real";
const CLIENTS_JSON = JSON.stringify([
  {
    clientId: "alexa",
    clientSecretHash: sha256Hex(SECRET),
    redirectUris: ["https://layla.amazon.com/api/skill/link/ABC"],
    grants: ["authorization_code", "refresh_token"],
  },
  { clientId: "alexa-m2m", clientSecretHash: sha256Hex(SECRET), redirectUris: [], grants: ["client_credentials"], scope: "mcp:service" },
  { clientId: "simulator", redirectUris: ["http://localhost:5173/demo/callback"], grants: ["authorization_code", "refresh_token"] },
]);

describe("static clients", () => {
  const clients = parseClients(CLIENTS_JSON);

  test("parses the OAUTH_CLIENTS document", () => {
    expect(clients.map((c) => c.clientId)).toEqual(["alexa", "alexa-m2m", "simulator"]);
    expect(findClient(clients, "alexa")?.redirectUris).toEqual(["https://layla.amazon.com/api/skill/link/ABC"]);
    expect(findClient(clients, "nope")).toBeNull();
  });

  test("rejects malformed documents naming the path", () => {
    expect(() => parseClients(JSON.stringify([{ clientId: "" }]))).toThrow(/clientId/);
    expect(() => parseClients("not json")).toThrow(/OAUTH_CLIENTS/);
  });

  test("authenticates a confidential client with its secret and rejects a wrong one", () => {
    expect(authenticateClient(clients, "alexa", SECRET)?.clientId).toBe("alexa");
    expect(authenticateClient(clients, "alexa", "wrong")).toBeNull();
    expect(authenticateClient(clients, "alexa", undefined)).toBeNull();
  });

  test("a public client authenticates without a secret and never with one", () => {
    expect(authenticateClient(clients, "simulator", undefined)?.clientId).toBe("simulator");
    expect(authenticateClient(clients, "simulator", "anything")).toBeNull();
  });
});
