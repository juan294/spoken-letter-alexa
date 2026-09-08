# `addon.json` field provenance

JSON carries no comments, so this note records where each field name in `addon.json`
comes from. "Recorded" means the research document
(`docs/research/2026-09-03-alexa-plus-hackathon-mcp-add-on.md`) captured the name from
Amazon's quickstart or CLI reference on 2026-09-03. "Chosen" means the research did not
record a name and the most conventional one was used; every chosen field is a question
for Amazon and belongs in the friction log until the toolkit's own example is available.

The values are fixed by the plan (`docs/plans/2026-09-03-alexa-plus-mcp-add-on-phases/phase-7.md`,
section 1) and verified by `addon.test.ts`. Only the field names are uncertain.

## Recorded by the research

| Field | Evidence |
| --- | --- |
| `distributionCountries: ["US"]` | Research 3.2: "the `addon.json` example is `"distributionCountries": ["US"]` with one `en-US` block." |
| one `en-US` locale block | Same sentence. The key that holds the block (`locales` here) is not recorded. |
| name `Spoken Letter` | The CLI scaffold takes `--name` (`alexa-ai new mcp --name "Hotel Finder" --locale en-US`). Whether the manifest stores it as `name` is not recorded. |

## Chosen (uncertain field names)

| Field | Why this name | What Amazon must confirm |
| --- | --- | --- |
| `type: "mcp"` | Mirrors the scaffold subcommand `alexa-ai new mcp`. | Whether the manifest carries an add-on type at all, and its key. |
| `locales` | Conventional map keyed by BCP 47 tag, matching the `--locale en-US` flag. | The key name and whether locale-scoped strings live at the top level instead. |
| `locales.en-US.name` | Repeats the add-on name inside the locale so a localized display name has a home. | Whether a per-locale name exists or the top-level one is the only name. |
| `locales.en-US.summary` | Short store line; the classic Alexa skill manifest calls this `summary`. | The key name and length limit. |
| `locales.en-US.description` | Long store text; classic manifest name. | The key name and length limit. |
| `locales.en-US.examplePhrases` | Classic manifest name for the three sample utterances. | The key name, count and phrasing rules for Alexa+ add-ons (the three phrases are fixed by the plan). |
| `locales.en-US.keywords` | Classic manifest name for search keywords. | The key name and limits. |
| `locales.en-US.privacyPolicyUrl`, `termsOfUseUrl` | Amazon's policy page requires privacy and terms URLs (research 8; 2026-08-17 research, policy section). Classic manifest names. | The key names and whether they sit per locale or top level. |
| `mcp.endpoint` | The quickstart requires a Streamable HTTP MCP server; the endpoint has to be declared somewhere. | The block and key names. |
| `mcp.transport: "streamable-http"` | "Your MCP server must support Streamable HTTP" (research 5.4). | Whether the transport is declared or assumed. |
| `mcp.protocolVersion: "2025-11-25"` | "Alexa+ for Builders supports the 2025-11-25 version of the MCP specification" (research 5.1). The server also serves 2026-07-28; it negotiates whatever the client sends. | Whether a version is declared and whether 2026-07-28 is accepted (research 11, question 3). |
| `auth.type: "oauth2"` | "Required: Use OAuth 2.1 authorization code flow with PKCE (S256)" (research 5.4). | The block and key names. |
| `auth.authorizationEndpoint`, `auth.tokenEndpoint` | RFC 8414 names in camelCase; these are also published at `/.well-known/oauth-authorization-server`. | Whether Amazon reads them from the manifest, from RFC 8414 metadata, or both. |
| `auth.scopes: "mcp:tools mcp:resources"` | The two authorization-code scopes Amazon documents (research 5.4). Space-separated per RFC 6749. | The key name and whether an array is expected. |
| `auth.pkce.required`, `auth.pkce.codeChallengeMethod: "S256"` | The documented requirement. | Whether PKCE is declared or assumed. |
| `auth.clientCredentials.*` | The documented machine-to-machine tier: HTTP Basic at the token endpoint, scope `mcp:service` (research 5.4). `tokenEndpointAuthMethod` uses the RFC 8414 value `client_secret_basic`. | Whether the tier is declared in the manifest at all. |

## Not in the manifest on purpose

- No client id or client secret. Amazon's static client credentials are issued when access
  exists and go into the `OAUTH_CLIENTS` environment (Phase 2), never into a tracked file.
- No redirect URIs. Amazon supplies them with access; Phase 2's plan says they are added
  then.
- No icon or artwork references. Sizes wait for Amazon's asset validator (Phase 7
  design-system note).
