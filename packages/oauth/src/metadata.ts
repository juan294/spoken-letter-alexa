export const MCP_SCOPES = ["mcp:tools", "mcp:resources"] as const;
export const SERVICE_SCOPE = "mcp:service";

/** RFC 8414 Authorization Server Metadata. Field set is pinned by `routes.test.ts`. */
export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    scopes_supported: [...MCP_SCOPES, SERVICE_SCOPE],
    response_types_supported: ["code"],
  };
}
