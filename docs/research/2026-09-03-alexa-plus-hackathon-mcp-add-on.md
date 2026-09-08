# Research: Alexa+ MCP add-on for the Amazon App Dev 2026 hackathon

**Date:** 2026-09-03
**Repository baseline:** `develop` at `2c11803`
**Scope:** Read-only research. It answers the questions that must be settled before `/plan`: hackathon rules and what Amazon provides, Alexa+ developer access, geography (Spain versus US accounts), language support, MCP specification compatibility, the audio playback contract, the separate public repository approach, and how the Owner's home Alexa devices can be used for testing and demos.
**Relationship to earlier work:** This document extends `docs/research/2026-08-17-alexa-plus-device-playback-integration.md`. That document assumed partner access to the Alexa+ MCP Toolkit. This document replaces that assumption with the verified public state on 2026-09-03. The 2026-08-17 platform analysis (audio format, story model, Owner delivery gate, OAuth role inversion) is still valid and is not repeated here.
**Evidence labels:** VERIFIED means a page was fetched in this research session and the statement quotes or closely paraphrases it. INFERRED means a conclusion drawn from verified facts. Owner-supplied facts are labelled OWNER.

## Executive answer

1. **Spoken Letter is eligible and the timing works.** Pre-existing projects may enter if they are "significantly updated" during the submission window (August 31, 2026 10:15 am PT to October 23, 2026 12:00 pm PT). Spain is not on the exclusion list. VERIFIED, section 1.
2. **The hackathon does not give entrants Alexa+ developer access.** The Alexa+ MCP Toolkit, the `alexa-ai` CLI, the web simulator, and on-device routing are all behind a partner-only gate: an Amazon Solutions Architect must allowlist your AWS account for an Amazon-owned IAM role before the CLI can even be installed. The Devpost resources page offers no access form. The rules anticipate this and explicitly accept "a simulated Alexa+ experience instead". VERIFIED, section 2.
3. **Even with access, third-party add-ons are US-only and English-only today.** Amazon states "The MCP Toolkit is available in the United States." The CLI defaults to `en-US` and `distributionCountries: ["US"]`, and no page lists another locale. The Owner's Spanish Alexa+ subscription cannot see a partner add-on. The correct setup, if access is ever granted, is the US amazon.com account with Alexa+ plus one Echo re-registered to that account in `en-US`. VERIFIED and INFERRED, sections 3 and 4.
4. **The newest MCP spec (2026-07-28) is usable, but only as a dual-era server.** Alexa+ documents support for spec 2025-11-25 and its client opens with a legacy `initialize` at `protocolVersion: "2025-03-26"`. A 2026-07-28-only server rejects such a client with HTTP 400 by design. The TypeScript SDK v2 (`@modelcontextprotocol/server` 2.0.0) answers both the legacy handshake and the new stateless protocol by default, which satisfies the hackathon's "2025-11-25 (or a later version, once confirmed)" wording and Alexa+ at the same time. VERIFIED, section 5.
5. **Long-form audio playback from an MCP tool result is still undocumented.** Nothing published in August or September 2026 changes this. The demo plan must not depend on a real Echo starting an MP3 from an MCP tool. VERIFIED absence, section 6.
6. **The separate public repository is the right shape.** It keeps the Spoken Letter repository private, satisfies the open-source licence rule, makes the "what you built during the window" story unambiguous, and qualifies for the Open Source mini challenge. Its Spoken Letter dependency is a small authenticated read-only story API plus an OAuth 2.1 authorization role that the private repository does not have today. Section 7.
7. **Home devices in Spain are demo props, not a test bench, until access exists.** They can show a classic-skill path or sit beside a laptop running the simulated experience. They cannot run a partner MCP add-on. Section 9.

The recommended posture for `/plan` is in section 10. Open questions for Amazon are in section 11. Owner decisions taken on 2026-09-03 are in section 12. One item is time-critical: Amazon runs a live "Using the MCP open standard to build Alexa+ add-ons" session today, September 3, at 2:00 pm ET (20:00 in Spain). It is the only scheduled contact with the Amazon developer team and the natural place to ask whether hackathon entrants can be granted toolkit access.

## 1. Hackathon facts that bind the plan

All items in this section are VERIFIED from https://amazonappdev2026.devpost.com/ , `/rules`, `/resources`, `/updates`, `/details/dates`, and forum threads 45056 and 45058.

| Item | Rule text or fact |
|---|---|
| Submission window | August 31, 2026 (10:15 am PT) to October 23, 2026 (12:00 pm PT). Judging October 26 to November 20. Winners announced December 3. |
| Pre-existing projects | "Projects must be either newly created by the Entrant or, if the Entrant's Project existed prior to the Hackathon Submission Period, must have been significantly updated after the start of the Hackathon Submission Period." Entrants must "clearly describe and demo the feature updates during the Submission Period." |
| Alexa+ track artifact | "A working Agent Skill or a self-hosted MCP server, implementing MCP spec version 2025-11-25 (or a later version, once confirmed) over Streamable HTTP." Elsewhere: "minimum acceptable version is 2025-11-25". |
| Simulated fallback | "Alternatively, entrants may submit a simulated Alexa+ experience instead — built using any AI or agentic tool of their choice, no specific framework, SDK, or MCP-shaped surface required." The video "must clearly show the simulated experience." |
| Runtime use | "The repository must demonstrate use of your track's required technology at runtime in your code — imported and actually called (a library import, an app/backend entry point, or a loaded agent/flow/MCP config), not just named in the README." The simulated path is exempt. |
| Repository | Public GitHub repository with an open-source licence file detectable at the repository root. |
| Video | Under three minutes, public on YouTube or Vimeo, "should include footage that shows the Project functioning on the device for which it was built". |
| Product feedback | Written feedback on each Amazon tool, API, or SDK used: what worked, what needs improvement, onboarding, future intent. "Participants who submit friction logs score higher in judging (up to 10% bonus)." |
| Language | All materials in English or with an English translation. |
| Judging | Stage one pass/fail on theme fit and required technology. Stage two, equally weighted: Tech Implementation, Design, Potential Impact, Quality of the Idea. |
| Prizes, Alexa+ track | 1st $25,000 + $15,000 AWS credits. 2nd $15,000 + $5,000. 3rd $4,000 + $1,000. |
| Mini challenges | AWS Builder: "Any primary track project that incorporates AWS services (i.e. Amazon Bedrock, AgentCore, Strands SDK, Kiro Crew, SageMaker, etc.) with documented integrations." Open Source: "Create a new open-source project or contribute to an existing public repository during the hackathon window, alongside a primary track submission." $5,000 + $5,000 credits each. One track prize plus one mini challenge prize per project. |
| Eligibility | Excluded residents: Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea, and OFAC-sanctioned countries. Spain is eligible. |
| Hardware clause | The sponsor may "require the Entrant to provide physical access to the Project hardware upon request" for devices that are not widely available. |
| Support | No hackathon Discord or Slack. Channels are the Devpost forum and https://community.amazondeveloper.com/c/fire-apps/17 . |
| AWS credits | A $150 credit request Google Form (https://forms.gle/GaHFxSbBQNG9Kti6A). It no longer requires Google sign-in after a forum report on 2026-09-03. |
| Live session | "Live Build Session", Thursday September 3, 2:00 pm ET / 11:00 am PT, Zoom, with Chris Traganos and Moses Roth, topic "Using the MCP open standard to build Alexa+ add-ons". Registration https://bit.ly/amazonappdev26bs-devpost . No other office-hours schedule is published yet. |

The Devpost "Agent Skills" link points to the MCP Apps documentation at apps.extensions.modelcontextprotocol.io, not to an Alexa runtime surface. In Amazon's Alexa+ docs, "Add-on Agent Skill" is a coding-agent onboarding helper ("guides your AI coding agent through the entire onboarding process. It works in Claude Code, Kiro, Cursor, VS Code Copilot"). VERIFIED. INFERRED: for Spoken Letter the self-hosted MCP server is the only track artifact that is also a runtime integration.

## 2. Alexa+ developer access: what exists and what the hackathon provides

### 2.1 The gate

- VERIFIED (https://developer.amazon.com/docs/alexaplus/add-ons/home.html, Jul 10 2026): "Important: At this time, Category SDK and MCP Toolkit are available to select partners only."
- VERIFIED (https://developer.amazon.com/alexaplus/): "Alexa+ for Builders is currently available to select partners working directly with our team." No waitlist or application link exists on the portal.
- VERIFIED (https://developer.amazon.com/docs/alexaplus/add-ons/set-up-your-development-environment.html): the `alexa-ai` CLI is not on public npm (`registry.npmjs.org/@alexa-ai%2Fcli` returns 404). Installation requires: "Log in to the AWS account that you provided to the Alexa Solutions Architect", then assume `arn:aws:iam::372468808636:role/AddOn3PDeveloperToolsRead`, then "Authenticate npm against the Alexa AI private CodeArtifact registry".
- VERIFIED (https://developer.amazon.com/docs/alexaplus/add-ons/test-with-web-simulator.html): the web simulator and its "Physical Device Config" routing to a real Echo exist only after `alexa-ai deploy`, so they sit behind the same gate. The development stage is "Only accessible to your developer account." No beta-tester program is documented for MCP add-ons.

INFERRED: without a Solutions Architect assigning the Owner's AWS account to that role, no entrant can install the CLI, deploy an add-on, open the simulator, or route a test to a device.

### 2.2 What the hackathon provides

VERIFIED from the Devpost resources page: the Alexa+ resources are the public MCP Streamable HTTP spec link and the MCP Apps "Build with Agent Skills" page. There is no MCP Toolkit access form, no Alexa+ preview enrolment, and no simulator. The "Amazon Devices Builder Tools MCP server" linked from the page (https://github.com/AmazonAppDev/amazon-devices-buildertools, public npm `@amazon-devices/amazon-devices-buildertools-mcp`, Apache 2.0) is a coding-assistant helper for Vega OS and Fire OS. It is unrelated to Alexa+ runtime integration.

VERIFIED from the Devpost gallery and forum: the project gallery is not yet published, and the one forum thread on the simulated path (45058, eight questions) has no replies. No entrant has described obtaining Alexa+ device or simulator access.

### 2.3 Consequence

INFERRED: the realistic default is the path the rules already name. Build a genuine self-hosted Streamable HTTP MCP server that meets Amazon's published add-on checklist, and demonstrate it through a self-built simulated Alexa+ client. If Amazon grants toolkit access to entrants (the question to ask today), the same server deploys unchanged through `alexa-ai`, and the simulated client becomes a secondary demo surface.

## 3. Geography and account setup

### 3.1 Alexa+ consumer availability

VERIFIED (https://www.aboutamazon.com/news/devices/alexa-plus-international-launch, Aug 6 2026): Alexa+ is live in the US, UK, Canada, Mexico, Italy, Spain, Germany, Austria, Brazil, France, and Australia, "with more coming later this year" and "more than 10 additional countries in 2027". Spain: "The Alexa+ Early Access program started in Spain on April 23, 2026." Languages (aboutamazon.eu, Jun 4 2026) include Spanish for Spain and Mexican Spanish. The Spanish launch article names partners (The Fork, Spotify, Apple Music, "pronto llegarán Cabify, CoverManager, Fever y Treatwell"). INFERRED: these are Amazon-managed partner integrations, not self-serve MCP add-ons.

OWNER: the Owner has Alexa+ active on a Spanish Amazon account, several Alexa devices at home in Spain, and a separate US amazon.com account.

### 3.2 Developer surface geography

- VERIFIED (https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html, Aug 3 2026): "Note: The MCP Toolkit is available in the United States."
- VERIFIED (quickstart and https://developer.amazon.com/docs/alexaplus/add-ons/alexa-ai-cli-reference.html, Aug 18 2026): scaffold is `alexa-ai new mcp --name "Hotel Finder" --locale en-US`; `--locale` is documented as "Locale for the add-on. Default: en-US."; the `addon.json` example is `"distributionCountries": ["US"]` with one `en-US` block. No page lists another accepted locale or country.
- VERIFIED (setup page, "Required accounts"): "Set preferred marketplace on Retail Website to Alexa+ supported marketplaces." "Ensure device's language is set to Alexa+ supported locales for that marketplace." Nothing on the page restricts the developer's own country of residence.
- VERIFIED (classic ASK rule, https://developer.amazon.com/en-US/docs/alexa/test/test-your-skill-overview.html): "register the device with the same email address that you used to sign up for your developer account" and "make sure that the locale of your device matches at least one of the locales available for your skill." The page adds that Alexa+ users find development skills under Alexa+ Store, Alexa Skills and Games.

### 3.3 Recommended account topology

INFERRED from 3.2. This is the only combination that is consistent with every published constraint:

| Element | Setting | Why |
|---|---|---|
| Amazon developer account | The US amazon.com identity | The simulator's device drop-down lists devices on the account signed into the developer console, and the add-on is distributed to `US`. |
| AWS account for the toolkit | An AWS account owned by the Owner, quoted to the Solutions Architect if access is granted | Required to assume the Amazon-owned CLI role. |
| Consumer Alexa+ entitlement | On the US amazon.com account | A `US`-distributed add-on never appears on the amazon.es account. |
| Test device | One Echo at home re-registered to the US account, device language `en-US` | Setup page requires device language in a supported locale for the marketplace. |
| Remaining home devices | Stay on the Spanish account | They keep the household's Spanish Alexa+ working and can still appear in demo footage. |

Two things are not documented anywhere found: whether Alexa+ activates on a US-registered device that is physically in Spain, and whether a non-US billing address blocks the US Alexa+ subscription. Both are cheap to test once and cost nothing until toolkit access exists. Until then the topology is a prepared decision, not an action.

## 4. Language

- VERIFIED: no Alexa+ add-on page mentions `es-ES` or `es-US`. The policy page says "All add-on content must be in an Alexa-supported language for the specified locale." The CLI default and the only documented example are `en-US`.
- INFERRED: third-party MCP add-ons are English-only during Preview. A Spanish conversational surface for the add-on is out of scope for this hackathon.
- INFERRED: this constrains the add-on's tool descriptions, prompts, and Alexa's spoken responses, not the story audio. Spoken Letter stories are MP3 files in whatever language the family recorded, and the platform already supports en, es, and fr story creation (`src/i18n/routing.ts`). A US-locale add-on can still list and hand over a Spanish-language story. The English-only limit belongs in the product-feedback write-up as a friction item.

## 5. MCP specification compatibility

### 5.1 Versions in play

| Party | Version | Evidence |
|---|---|---|
| Newest MCP spec | 2026-07-28 | VERIFIED https://modelcontextprotocol.io/specification/versioning: "The current protocol version is 2026-07-28." Changelog: https://modelcontextprotocol.io/specification/2026-07-28/changelog |
| Hackathon minimum | 2025-11-25 "(or a later version, once confirmed)" | VERIFIED rules page |
| Alexa+ documented support | 2025-11-25 | VERIFIED overview page: "Alexa+ for Builders supports the 2025-11-25 version of the MCP specification." |
| Alexa+ live client handshake | `initialize` with `"protocolVersion": "2025-03-26"`, clientInfo "Alexa+ MCP Client" 1.0.0 | VERIFIED https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html (Jul 10 2026). "The session is based on the customer's previous conversations with Alexa+ rather than an explicit identifier." |
| Alexa+ Local Inspector | `initialize` with `"protocolVersion": "2025-06-18"`, requires `Mcp-Session-Id` on later requests | VERIFIED https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-local-inspector.html |
| Spoken Letter private repo | `@modelcontextprotocol/sdk` ^1.30.0 (v1 line, `LATEST_PROTOCOL_VERSION = '2025-11-25'`) | VERIFIED `package.json:88` and `node_modules/@modelcontextprotocol/sdk/dist/esm/types.js` |
| TypeScript SDK v2 | `@modelcontextprotocol/server` 2.0.0, published 2026-07-28, implements 2026-07-28 | VERIFIED `npm view` in this session; README: "v2 is the stable release line, released alongside the 2026-07-28 spec. v1.x continues to receive bug fixes and security updates for at least 6 months." |

### 5.2 What 2026-07-28 changed (VERIFIED, changelog)

- Removes protocol-level sessions and the `Mcp-Session-Id` header.
- Removes the `initialize` / `notifications/initialized` handshake. Every request carries its protocol version and client capabilities in `_meta`; mismatches return `UnsupportedProtocolVersionError`.
- Adds `server/discover`, which servers MUST implement.
- Replaces the HTTP GET stream and `resources/subscribe` with `subscriptions/listen`; removes SSE resumability.
- Removes `ping`, `logging/setLevel`, and roots change notifications. Deprecates Roots, Sampling, Logging, HTTP+SSE.
- Replaces `sampling/createMessage` and `elicitation/create` with the Multi Round-Trip Requests pattern (`resultType: "input_required"`). All results carry a required `resultType`.
- Requires `Mcp-Method` and `Mcp-Name` headers on POSTs and `ttlMs` / `cacheScope` on list results.
- Auth: validates `iss` (RFC 9207), and "Deprecate the OAuth 2.0 Dynamic Client Registration Protocol ... in favor of Client ID Metadata Documents."

### 5.3 Compatibility verdict

VERIFIED (https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning): "Legacy client / Modern server: Fails ... the request is missing the required headers and is rejected ... with 400 Bad Request ... Legacy clients have no fall-forward mechanism." And: "Legacy / Dual-era: Works. The server answers initialize and serves the client according to the negotiated legacy revision." "A server that wishes to support both legacy clients ... and modern clients ... MAY implement both behaviors."

VERIFIED (SDK v2 migration guide `docs/migration/support-2026-07-28.md` and the SDK blog): "A v2 server answers the legacy initialize handshake alongside server/discover, so clients on 2025-11-25 keep connecting." `createMcpHandler(factory)` "serves both 2026-07-28 and 2025-era traffic by default".

INFERRED conclusion: the Owner's requirement to build on the newest spec is compatible with Alexa+ only as a dual-era server. Build the public repository on `@modelcontextprotocol/server` 2.0.0 with `createMcpHandler` in its default dual-era mode, and keep the legacy shim enabled for the life of the hackathon. This is also the strongest possible answer to the rules' "or a later version, once confirmed" clause, because the server passes as 2025-11-25 to a 2025-era judge and as 2026-07-28 to a modern one. Verify with the Alexa Local Inspector flow that the handler accepts `protocolVersion: "2025-03-26"` and issues `Mcp-Session-Id` to a legacy client that expects one.

### 5.4 Amazon's other server requirements (VERIFIED, quickstart and authentication pages)

- "Your MCP server must support Streamable HTTP."
- "Required: Use OAuth 2.1 authorization code flow with PKCE (S256)." Dynamic Client Registration, OIDC, and step-up auth are listed as "Not Supported Yet." Because 2026-07-28 also deprecates DCR, the add-on should register Alexa+ as a statically configured OAuth client.
- Two auth tiers: client_credentials (machine-to-machine, HTTP Basic at the token endpoint, scope `mcp:service`) and authorization_code + PKCE (scopes `mcp:tools`, `mcp:resources`). Authorization-server metadata per RFC 8414 must list `client_credentials`. Unauthenticated requests return 401 with Protected Resource Metadata.
- "Your MCP server must meet a round-trip query response latency of less than 500 ms." Tools must therefore return story metadata and URLs, never audio bytes.
- Certification: "Tool signatures and descriptions are locked after publication."
- Primitives: tools, resources, prompts; "Alexa+ also supports the MCP Apps extension."

## 6. Audio playback contract: still undocumented

VERIFIED absence across the quickstart, overview, supported-capabilities index, authentication, design guide, client lifecycle, local inspector, test, certify, functional-requirements, policy, certification-guidelines, add-on API reference, and home pages: no page describes how an MCP tool result starts long-form audio on a device. The quickstart lists MP3 among supported audio codecs with no sentence saying what consumes them. The functional-requirements page has a "12. Video Playback" section for video add-ons ("Start video playback within a few seconds of invocation ... Support transport controls") and no audio-playback section. The design guide's display modes are inline, fullscreen, and voice-only, and "you shape what Alexa says by designing structured data." Nothing published in August or September 2026 changes this; the newest Alexa+ post is dated 2026-07-23.

INFERRED: the codec list plus the video requirement suggests media renders inside an MCP Apps widget (a sandboxed HTML view on Echo Show class devices), which would give nothing on screenless Echo devices. This is a hypothesis to test only if toolkit access arrives.

Playback options, in order of evidence strength:

1. **Simulated Alexa+ client (rules-sanctioned).** A web client in the public repository that speaks MCP to the real server and plays the returned story URL in the browser. Works without Amazon access, satisfies the track, and is the guaranteed demo path.
2. **MCP Apps widget with an `<audio>` element.** Plausible on screened devices, undocumented, and testable only through the gated simulator.
3. **Classic ASK skill with `AudioPlayer`.** The only documented long-form audio path on real Echo hardware (see the 2026-08-17 document). It is a second Amazon artifact with its own OAuth and certification, and it is not the track's required technology. It could serve as the "real device" footage in the video if the MCP server is still the runtime integration, but that doubles the surface area and is not the recommended first move.
4. **Voice handoff.** The MCP tool returns structured story data and Alexa reads a short summary or the script text. Weak for a product whose value is the relative's real voice; useful only as a graceful degradation.

## 7. The separate public repository

### 7.1 Why

- The Spoken Letter repository stays private for the XPRIZE submission and by Owner decision. The hackathon needs a public repository with a licence file.
- A new repository makes the "significantly updated during the window" narrative self-evident: every commit is inside the window.
- A new public repository created during the window also qualifies for the Open Source mini challenge.

### 7.2 What belongs in it (INFERRED shape, to be fixed in `/plan`)

- The MCP server on `@modelcontextprotocol/server` 2.0.0 (dual-era), Streamable HTTP, read-only story tools (list approved stories for the linked parent, get one story with a time-limited audio URL, suggest the next story). No delivery, purchase, recipient, or audio-mutation tools, consistent with the private repository's agent-tool denylist in `src/lib/agent-tools/contract.ts`.
- The OAuth 2.1 authorization-code + PKCE surface and the client_credentials tier that Amazon requires, with RFC 8414 metadata and RFC 9728 Protected Resource Metadata. The private repository has no authorization-server role today; it is an OAuth client of Yoto only (2026-08-17 document, sections 2 and 6).
- The simulated Alexa+ web client used for the demo and for judges.
- An optional MCP Apps widget for story playback.
- The Amazon `addon.json` package and Add-on Agent Skill scaffolding, ready for `alexa-ai deploy` if access arrives.
- README, licence, friction log, and the product-feedback write-up.

### 7.3 What it needs from the private repository

A small authenticated read-only API that the public MCP server calls on behalf of a linked parent: story catalogue filtered to Owner-delivered stories, and a signed short-lived audio URL for one story. Whether identity is issued by the public repository (it owns the OAuth server and maps Amazon-linked users to Spoken Letter accounts through a one-time link flow) or by the private repository (it becomes the OAuth authorization server and the public server is a resource server) is the main architectural decision for `/plan`. The 2026-08-17 document's finding that Spoken Letter must act as an OAuth authorization server for Alexa account linking still applies to the end state.

### 7.4 Freeze interaction

OWNER constraint recorded in memory: no push, PR, or production deploy for the Spoken Letter repository until 2026-09-30. The public repository is a different remote, but creating it and pushing to it is an outward-facing action and needs the Owner's explicit authorization before the first push. Independently of that, the private-repository API cannot reach production before 2026-09-30. The plan therefore has a natural two-part schedule: September for the public repository against a fixture backend and the simulated client, October 1 to 23 for wiring to the real API, recording, and submission.

## 8. Child-safety and policy fit

- VERIFIED (https://developer.amazon.com/docs/alexaplus/add-ons/policy-requirements.html): "Your add-on must never target children or collect their data." Consent is required when an add-on uses a real person's name, likeness, or voice.
- The product's own invariants already fit this framing: the add-on is the parent's tool. The parent links their Amazon account, the Owner's download or Yoto send remains the approval gate, and the MCP server exposes only Owner-delivered stories. No child account, voice, or data is ever involved. The add-on listing, tool descriptions, and demo script must describe a parent-operated family-audio experience, not a children's product.
- INFERRED: the strongest demo utterance is the parent asking Alexa ("Alexa, play the story Grandma sent"), with the child listening. It shows the value without staging a child speaking to a device, which would undercut the policy position and the product's own rules.
- Sender consent for voice use is already in the Terms (`messages/en/legal.json`, see 2026-08-17 document section 5). The product-feedback write-up should state this plainly.

## 9. Home devices: what they can and cannot do

OWNER: several Alexa devices at home in Spain, Alexa+ active on the Spanish account.

| Use | Possible today | Requires |
|---|---|---|
| Run the partner MCP add-on and hear a story on an Echo | No | Toolkit access, US developer identity, one Echo on the US account in `en-US`, Alexa+ on that account. |
| Route simulator utterances to a physical Echo | No | Same as above; the simulator is behind the gate. |
| Show a classic ASK development skill on an Echo | Yes | Device registered to the same email as the developer account, device locale matching the skill. Not the track artifact. |
| Appear in demo footage while the simulated client plays a story | Yes | Nothing. The video rule for the simulated path is that it "must clearly show the simulated experience." |
| Record the household reaction and the product story | Yes | Nothing. |

INFERRED: the devices are valuable for the video's narrative and, if access arrives in September or October, become the on-device proof within a day of re-registering one Echo. They are not a test bench before that.

## 10. Recommended posture for `/plan`

1. Enter the Alexa+ track with a real self-hosted MCP server plus a simulated Alexa+ client, in a new public repository. Treat real-device playback as an upgrade, not a dependency.
2. Build the server on `@modelcontextprotocol/server` 2.0.0 in dual-era mode. Verify the legacy `initialize` at 2025-03-26 and 2025-06-18 as an automated test.
3. Implement Amazon's published checklist even without access: Streamable HTTP, OAuth 2.1 auth code + PKCE with a static client, client_credentials tier, RFC 8414 and RFC 9728 metadata, 401 with resource metadata, sub-500 ms tools, no DCR.
4. Keep the tool set read-only and parent-scoped. Reuse the private repository's agent-tool contract rules for names, budgets, and the denylist.
5. Prepare the US account topology as a written checklist and execute it only when access is granted.
6. Go all in on the AWS Builder mini challenge: the public repository runs on AWS and uses AWS services wherever a service does real work (section 12.1). Each service needs a documented integration in the README and friction log.
7. Write the friction log from day one. It is worth up to 10 percent in judging and the English-only, US-only, partner-gated findings above are already material for it.
8. Schedule: September, public repository against fixtures and the simulated client, with the Spoken Letter API designed but unshipped; October 1 to 23, ship the private API after the freeze, wire, record, submit.

## 11. Questions to put to Amazon

Ask at the live build session today or in the Devpost forum, in this order:

1. Can hackathon entrants be granted the `AddOn3PDeveloperToolsRead` role and Alexa AI CLI access for the window? If yes, what is the request path?
2. Is there any way for an MCP add-on to start and control long-form audio playback on an Echo, including screenless devices? If it is only via MCP Apps on screened devices, say so.
3. Will Alexa+ accept a 2026-07-28 dual-era server, and does the rules' "or a later version, once confirmed" clause now confirm 2026-07-28?
4. Are any locales other than `en-US`, and any distribution countries other than `US`, accepted for add-ons in Preview?
5. For the simulated path, what must the video show to pass stage-one judging?
6. Does a family-audio add-on operated by a parent fall under "must never target children"?

## 12. Owner decisions recorded on 2026-09-03

1. **Licence: MIT.** The rules only require "an open source license file" detectable at the repository root; MIT and Apache 2.0 both pass GitHub detection. MIT is chosen because it is the shortest, carries no NOTICE-file obligation, and the Owner is the sole author, so nothing about MIT constrains folding the code back into the private repository later. Amazon's own sample repository uses Apache 2.0; that is not a requirement.
2. **Identity boundary: the public repository owns the OAuth 2.1 authorization server and the MCP server. Spoken Letter stays behind a minimal account-provider API.** Reasoning: Amazon requires RFC 8414 authorization-server metadata, the authorization-code + PKCE flow, and the client_credentials tier at the MCP server's own domain, so those live in the public repository regardless. The private repository has no authorization-server role today and cannot ship one before 2026-09-30. The public server therefore talks to Spoken Letter through one small interface (confirm a parent link, list Owner-delivered stories for that parent, sign a short-lived audio URL). The parent link reuses the one-time-token pattern already accepted in ADR 0016 (`/claim/[token]`): the authorize page sends the parent to Spoken Letter, the parent signs in there, and Spoken Letter confirms the link back. Later integration into the private repository is then a move, not a rewrite: the private repository already hosts an MCP server in a Next.js route (`src/app/api/mcp/route.ts`), so the end state is the same server living at a Spoken Letter route with the account-provider interface implemented in-process. The public repository must not depend on Firebase Admin or any private schema; the HTTP account-provider interface is the only coupling.
3. **Toolkit access: pursue it, and plan and implement both paths.** The plan carries two demo surfaces as first-class deliverables: (a) the Amazon packaging path (`addon.json`, Add-on Agent Skill scaffolding, `alexa-ai deploy`, simulator and device verification) ready to run the day access arrives, and (b) the simulated Alexa+ web client that ships regardless. Neither is optional.
4. **US account topology:** the Owner executes the section 3.3 checklist when access is granted. No action now.
5. **AWS Builder mini challenge: full commitment (Owner, 2026-09-03).** The Owner's words: "let's go full on for that mini challenge ... maximize the use of AWS services in this new repo even if we later migrate or remove some." This is a plan mandate, not an option. See section 12.1.

### 12.1 AWS Builder mandate for `/plan`

VERIFIED (rules): "Any primary track project that incorporates AWS services (i.e. Amazon Bedrock, AgentCore, Strands SDK, Kiro Crew, SageMaker, etc.) with documented integrations." Landing page: "Building with Kiro Crew qualifies on its own." Prize $5,000 cash plus $5,000 AWS credits, one mini-challenge prize per project. The Open Source mini challenge is satisfied by the new public repository on its own; a project can only win one mini challenge, so the submission names AWS Builder as the mini challenge and lists the Open Source contribution as supporting evidence.

Starting position (VERIFIED in this session): the private repository already uses AWS SES v2 for email (`@aws-sdk/client-sesv2` in `package.json`, us-east-1). The AWS CLI on the Owner's machine has an `archy` profile bound to IAM user `archy` in account `106403001709`, plus `default`, `paisaxe-project`, and `askcli` profiles. The $150 hackathon credit form (section 1) and, if won, the $5,000 to $15,000 prize credits land in whichever AWS account the Owner names. `/plan` must confirm which account hosts the public repository's resources and that the `archy` user (or a new scoped user) has the permissions needed for the services below.

Rule for the plan: every AWS service listed must perform a real function in the running system, be imported and called in code, and have a README section and a friction-log entry. Decorative usage is a judging liability, not an asset. Services may be removed after the hackathon; that is acceptable and expected.

Candidate service map, grouped by the function each performs. `/plan` picks from this list and states the reason for each inclusion and exclusion:

| Function in the public repository | AWS service | Notes |
|---|---|---|
| MCP server hosting (Streamable HTTP, sub-500 ms) | AWS Lambda with function URL response streaming, or Amazon ECS Fargate / App Runner | Streamable HTTP needs SSE streaming responses; verify Lambda streaming works with the SDK v2 handler before committing, otherwise Fargate. |
| Simulated Alexa+ client: the conversational agent that calls MCP tools | Amazon Bedrock (Claude or Nova models) via the Strands Agents SDK as the MCP client | Both are named in the rules. This makes the simulated experience itself an AWS Builder integration and gives a real MCP client that exercises the server the same way Alexa+ would. |
| Simulated client: voice input | Amazon Transcribe streaming | Turns the simulated experience into a spoken interaction, which is what judges will compare against an Echo. |
| Simulated client: spoken responses | Amazon Polly (neural voice) | Speaks the agent's replies before the story audio plays. Never used to narrate a story; the family recording is the product. |
| MCP gateway, protocol translation, auth fronting | Amazon Bedrock AgentCore Gateway | Fronts MCP servers and translates protocol versions; fits the dual-era story. Evaluate whether it can sit between the simulated client and the server without breaking Alexa's direct-connection requirement (Alexa+ must reach the server itself). |
| Agent hosting for the simulated client | Amazon Bedrock AgentCore Runtime | Optional; use if the Strands agent should run server-side rather than in the browser. |
| OAuth 2.1 authorization server, or its backing store | Amazon Cognito user pool (auth code + PKCE, client_credentials, RFC 8414 metadata) with Lambda triggers, or a custom server on Lambda backed by DynamoDB | `/plan` must check Cognito against Amazon's exact checklist (static client, S256, client_credentials tier, Protected Resource Metadata at the MCP domain). If Cognito cannot satisfy it, the custom server is the fallback and DynamoDB still qualifies. |
| Link tokens, parent-to-account mapping, playback position | Amazon DynamoDB | Small tables, on-demand billing. |
| Secrets (OAuth client secret, account-provider API key) | AWS Secrets Manager or SSM Parameter Store | |
| Short-lived audio URL delivery, optional edge cache | Amazon S3 + CloudFront signed URLs | Only if the account-provider API hands the public server a copy of Owner-delivered MP3s. Otherwise the signed URL comes from Spoken Letter's existing Google Cloud Storage and this row is skipped. Any copy must carry the same Owner-delivery gate and deletion cascade as the source. |
| Latency evidence for the 500 ms requirement | Amazon CloudWatch metrics and logs, X-Ray traces | Produces the proof judges and Amazon certification ask for. |
| Infrastructure as code | AWS CDK or SAM | One command deploys the whole public repository; documented in the README. |
| Build tooling | Kiro Crew for a documented part of the implementation | "Qualifies on its own." Use it for real work and record it in the friction log. |

Constraints that survive the mandate:

- Child-safety invariants are unchanged. No AWS service receives child data, because none exists. Story audio and metadata reaching AWS are Owner-delivered adult recordings only.
- The private Spoken Letter stack (Vercel plus Google Cloud) is not migrated. AWS usage is confined to the public repository and its account-provider integration.
- The simplicity constraint applies to the core MCP path: the server must still work with AWS services removed one by one, so that a later migration back into the private repository is a subtraction, not a rewrite. `/plan` should isolate every AWS dependency behind a small interface.

## External sources checked

Fetched between 2026-09-03 06:30 and 07:15 UTC by three read-only research agents; the four decision-critical statements (US-only, partner-only, spec 2025-11-25, client `protocolVersion` 2025-03-26) were re-fetched and confirmed directly.

Hackathon:
- https://amazonappdev2026.devpost.com/
- https://amazonappdev2026.devpost.com/rules
- https://amazonappdev2026.devpost.com/resources
- https://amazonappdev2026.devpost.com/updates
- https://amazonappdev2026.devpost.com/details/dates
- https://amazonappdev2026.devpost.com/forum_topics/45056 and /45058

Amazon Alexa+:
- https://developer.amazon.com/alexaplus/
- https://developer.amazon.com/alexaplus/blogs/2026/07/alexa-plus-new-ways-to-build-experiences
- https://developer.amazon.com/docs/alexaplus/add-ons/home.html
- https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html
- https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html
- https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-authentication.html
- https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html
- https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-local-inspector.html
- https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-supported-capabilities.html
- https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-test-add-ons.html
- https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-certify.html
- https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-design-guide.html
- https://developer.amazon.com/docs/alexaplus/add-ons/test-with-web-simulator.html
- https://developer.amazon.com/docs/alexaplus/add-ons/set-up-your-development-environment.html
- https://developer.amazon.com/docs/alexaplus/add-ons/alexa-ai-cli-reference.html
- https://developer.amazon.com/docs/alexaplus/add-ons/functional-requirements.html
- https://developer.amazon.com/docs/alexaplus/add-ons/policy-requirements.html
- https://developer.amazon.com/docs/alexaplus/add-ons/certification-guidelines.html
- https://developer.amazon.com/docs/alexaplus/add-ons/alexa-plus-addon-api-reference.html
- https://developer.amazon.com/docs/alexaplus/add-ons/choose-the-proper-alexaplus-integration-approach.html
- https://developer.amazon.com/en-US/docs/alexa/test/test-your-skill-overview.html
- https://developer.amazon.com/docs/vega/0.24/mcp-server and https://github.com/AmazonAppDev/amazon-devices-buildertools

Alexa+ consumer availability:
- https://www.aboutamazon.com/news/devices/alexa-plus-international-launch
- https://www.aboutamazon.eu/news/devices/how-europe-celebrated-the-new-alexa-next-generation-ai-assistant
- https://www.aboutamazon.es/noticias/dispositivos/alexa-disponible-espana-nueva-generacion

MCP:
- https://modelcontextprotocol.io/specification/versioning
- https://modelcontextprotocol.io/specification/2026-07-28/changelog
- https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/extensions/apps/overview
- https://blog.modelcontextprotocol.io/posts/2026-07-28/ and /posts/sdk-betas-2026-07-28
- https://github.com/modelcontextprotocol/typescript-sdk (README, releases, `docs/migration/support-2026-07-28.md`)
- npm registry: `@modelcontextprotocol/sdk` 1.30.0, `@modelcontextprotocol/server` 2.0.0, `@modelcontextprotocol/server-legacy` 2.0.0

Failed or not usable: `registry.npmjs.org/@alexa-ai%2Fcli` (404, private package); `npmjs.com` package pages (403); several guessed `developer.amazon.com` paths (404); the Zoom webinar page (no rendered body).
