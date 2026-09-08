# Research: Alexa+ and Alexa device story playback integration

**Date:** 2026-08-17
**Repository baseline:** `origin/develop` at `f2e4f30ae6595acbae66282f707c896cb71703cd`
**Scope:** Read-only compatibility research. This document describes the current repository and the public Amazon developer contracts. It does not define an implementation plan. Launch timing is outside scope.
**Update 2026-09-03:** the partner-access assumption below is replaced by the verified public state in `docs/research/2026-09-03-alexa-plus-hackathon-mcp-add-on.md` (Alexa+ MCP Toolkit is partner-only and US-only; hackathon path uses a dual-era MCP server plus a simulated client). The platform analysis in this document remains valid.
**Assumption supplied by the product owner:** Spoken Letter can obtain partner access to the Alexa+ SDK, MCP Toolkit, and Alexa team support. Partner access and launch availability are therefore not feasibility constraints.

## Executive answer

Spoken Letter's current audio pipeline is technically compatible with playback on Alexa devices through the public Alexa Skills Kit `AudioPlayer` interface. The platform already produces a final MP3 at 44.1 kHz, 128 kbps, stereo (`packages/audio-contract/src/yoto.ts:1-4`; `workers/audio/mix.ts:325-348`). Amazon documents `AudioPlayer` for long-form content, including narrative stories, and accepts MP3 streams from 16 to 384 kbps at an internet-accessible HTTPS URL ([Add Audio to a Custom Skill](https://developer.amazon.com/en-US/docs/alexa/custom-skills/add-audio.html); [Stream Long-Form Audio with AudioPlayer](https://developer.amazon.com/en-AU/docs/alexa/custom-skills/use-long-form-audio.html)). The media-format contracts therefore align.

This is not a ready-to-enable integration in the current platform. Spoken Letter has no Alexa request endpoint, skill manifest, interaction model, Alexa account mapping, Alexa playback-state record, or ASK dependency. Its current authenticated media routes depend on the Spoken Letter Firebase session cookie (`src/lib/auth/constants.ts:1`; `src/lib/auth/session.ts:9-23`; `src/app/api/stories/[storyId]/audio/route.ts:42-55`), while Alexa account linking expects Spoken Letter to act as an OAuth authorization server ([Configure an Authorization Code Grant](https://developer.amazon.com/docs/alexaplus/account-linking/configure-authorization-code-grant.html)). The existing Yoto integration has the opposite OAuth role: Spoken Letter is the client of Yoto's authorization and token endpoints (`src/lib/yoto/config.ts:46-56`; `src/lib/yoto/oauth.ts:57-113`).

There are two different Amazon integration targets:

- A classic custom Alexa skill has a public and documented route to authenticated long-form audio on Alexa devices. It is technically feasible with a new integration layer around the current platform.
- A native Alexa+ MCP add-on is a feasible integration candidate under the supplied access assumption. Amazon directs services outside its fixed Category SDK categories to the MCP Toolkit, lists MP3 among the MCP media codecs, and provides OAuth 2.1 account linking ([Choose the Proper Alexa+ Integration Approach](https://developer.amazon.com/docs/alexaplus/add-ons/choose-the-proper-alexaplus-integration-approach.html); [Alexa+ MCP QuickStart Guide](https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html)). The public capability list does not document a long-form playback directive, stream-offset events, or an `AudioPlayer` equivalent ([MCP Toolkit Supported Capabilities](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-supported-capabilities.html)). That specific media-control contract remains to be verified in the partner SDK or with the Alexa team.

Amazon's July 23, 2026 Alexa+ announcement does not change these requirements or conclusions. It confirms that service providers can bring an existing MCP server and its tools to Alexa+ for Builders, which inspects the server, proposes an integration path, and produces a simulator-ready package. It also describes the integration paths as Preview ([Alexa+ launches new ways to build experiences](https://developer.amazon.com/alexaplus/blogs/2026/07/alexa-plus-new-ways-to-build-experiences)). The announcement does not document persistent long-form audio playback, stream URL or lifetime rules, resume offsets, playback lifecycle events, a different account-linking contract, or an exception to the child-directed policy. It therefore clarifies the onboarding workflow and platform maturity, but it does not resolve the remaining media-control or certification questions.

The concise finding is: **Alexa-device playback can work with the current audio and story platform, but it needs a new Alexa integration layer. With partner access assumed, native Alexa+ is a viable target. The remaining Alexa-specific validation is whether the partner contract can start and maintain long-form playback of a supplied MP3 URL.**

The requested journey matches Spoken Letter's current safety flow when the existing per-story Parent review and approval are understood as part of the high-level `Family member creates story` → `Parent connects Alexa` → `Kid asks Alexa` description:

- `Family member creates story` matches the current Sender flow.
- `Parent connects their Alexa account` establishes a one-time account link. The existing per-story Parent delivery decision remains in force.
- `Kid asks Alexa for stories` is technically possible only for stories the Parent has already approved for child delivery. It also conflicts with Amazon's standard account-linking rules if the request comes through an Amazon child-enabled device or profile.

The detailed flow is: **Family member creates and sends a story → Parent reviews and approves it for device delivery → Parent connects Alexa once, in either order relative to story approval → Kid asks Alexa to play approved stories.** This preserves the current product boundary. The account connection selects and authorizes the external device provider; it does not change which Stories are approved.

## 1. Requested journey and Amazon developer surfaces

### 1.1 Journey fit

| Requested step | Current platform match | Finding |
|---|---|---|
| Family member creates a story | A Sender can create and send a Story to a Family Space. The first completed send can establish recurring membership without Owner pre-approval (`docs/decisions/0010-membership-visible-in-search.md:14-29`; `docs/product/spoken-letter-personas-and-journey-foundations.md:47-55`). | Matches. The Story arrives in the Parent's review inbox. |
| Parent connects their Alexa account | The Yoto precedent links one external provider account to one authenticated Spoken Letter user and keeps provider credentials server-side (`src/app/api/yoto/connect/route.ts:20-57`; `src/lib/yoto/connection.ts:20-46`). | Technically matches as a one-time account-link operation. Alexa requires Spoken Letter to expose the opposite OAuth role: an OAuth 2.1 authorization server and protected MCP resource. |
| Kid asks Alexa for stories | The final MP3 and Story catalog exist, but the child has no Spoken Letter account or audio route (`docs/architecture/data-model.md:599-621`). Stories can also have a Parent-authored `recipientId`, while the Story record has no Alexa household-person mapping (`src/lib/schema/stories.ts:313-367`; `src/lib/schema/stories.ts:427-439`). | Playback is technically possible through the linked Parent account. Recipient selection needs an explicit default, a child name in the request, or an Amazon-person-to-Recipient mapping. |
| Kid asks Alexa to play a Parent-approved story | Current policy says the Owner delivery action is the approval gate. Unwanted content can reach the review inbox but never the child (`docs/decisions/0010-membership-visible-in-search.md:38-48`). Download confirmation marks the Story `downloaded`; a verified Yoto send does the same (`src/lib/stories/owner.ts:532-553`; `src/lib/yoto/send.ts:487-517`). | Matches the current safety model. Alexa becomes another approved delivery surface and exposes only Parent-approved Stories. |

The requested voice action also has a recipient-identity detail. Alexa account linking connects the Parent's Amazon account to the Parent's Spoken Letter identity. It does not by itself identify which Family Space Recipient is speaking. For a one-child household, a default Recipient can make the request unambiguous. For multiple children, the request needs the Recipient's name or an Alexa household-person mapping. No such provider mapping exists in the current Story or user schema (`src/lib/schema/stories.ts:313-449`; `src/lib/schema/users.ts:1-64`).

### 1.2 Classic skills and Alexa+ add-ons are separate contracts

Amazon still permits developers to create, update, certify, and publish classic skills for the original Alexa experience. Amazon says those skills are not automatically direct-invocation Alexa+ experiences; an existing skill can be submitted for Amazon evaluation ([Introducing AI-native SDKs for Alexa+](https://developer.amazon.com/en-US/blogs/alexa/alexa-skills-kit/2025/02/new-alexa-announce-blog)).

Amazon's current Alexa+ add-on documentation describes two native paths:

- Category SDK for listed service categories such as restaurant reservations, food ordering, ride booking, home services, local booking, and ticketing.
- MCP Toolkit for services that do not fit a supported category.

Both paths are available only to select partners at this time ([Alexa+ Developer Docs Home](https://developer.amazon.com/docs/alexaplus/add-ons/home.html)). Under the supplied assumption, Spoken Letter can use this partner surface, so availability does not constrain feasibility. The MCP Toolkit is the relevant native path because Amazon defines it for services that do not fit an existing Category SDK category ([Choose the Proper Alexa+ Integration Approach](https://developer.amazon.com/docs/alexaplus/add-ons/choose-the-proper-alexaplus-integration-approach.html)).

Amazon's July 23, 2026 announcement adds an onboarding detail: Alexa+ for Builders can inspect a service provider's existing MCP server, propose an integration path, and deliver a simulator-ready package. The same announcement says the integration paths are in Preview ([Alexa+ launches new ways to build experiences](https://developer.amazon.com/alexaplus/blogs/2026/07/alexa-plus-new-ways-to-build-experiences)). This strengthens the evidence that MCP is Amazon's intended service-integration path and identifies tooling that can reduce adapter setup work. It does not remove the requirement to provide the MCP server, its tools, or the required authentication surface, and it does not define the runtime contract for long-form Story playback.

The public MCP onboarding contract requires Streamable HTTP, OAuth 2.1 authorization code with S256 PKCE, bearer-token authentication, and a response time below 500 ms. It lists MP3 as a supported media codec ([Alexa+ MCP QuickStart Guide](https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html)). The public supported-capabilities page names authentication and account linking but does not define a long-form playback directive or playback lifecycle events ([MCP Toolkit Supported Capabilities](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-supported-capabilities.html)). The published MCP design guide also says Alexa controls voice-response generation while the add-on controls tool logic and returned data ([Alexa+ MCP Design Guide](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-design-guide.html)). The exact contract that turns a returned MP3 resource into persistent device playback is therefore the remaining partner-interface question. The documented public `AudioPlayer` contract remains a confirmed classic-skill route ([Add Audio to a Custom Skill](https://developer.amazon.com/en-US/docs/alexa/custom-skills/add-audio.html)).

## 2. Current Spoken Letter delivery platform

### 2.1 Story and final-audio model

A Story is private data tied to a Space, Sender, and optional Recipient. It stores the narration reference and delivery state (`src/lib/schema/stories.ts:313-367`). The same record holds `finalMixRef`, the final-audio profile, mix state, duration, and the existing Yoto delivery fields (`src/lib/schema/stories.ts:367-439`).

The current branded rendition has a deterministic GCS path ending in `brand-chime-v1.mp3` (`packages/audio-contract/src/audio-profile.ts:1-29`). The worker produces `audio/mpeg` and returns the stored final reference (`workers/audio/pipeline.ts:361-400`). Its delivery encode is MP3, 44.1 kHz, 128 kbps, stereo (`packages/audio-contract/src/yoto.ts:1-4`; `workers/audio/mix.ts:325-348`).

Every delivery surface resolves audio through the same fallback ladder: current branded mix, prior valid mix, then original narration (`src/lib/audio/final-audio.ts:32-65`). ADR 0009 requires future delivery surfaces to inherit this behavior (`docs/decisions/0009-polymorphic-delivery-boundary.md:109-121`). This means an Alexa surface can consume the same resolved delivery artifact; it does not need a different audio production pipeline.

### 2.2 Current web playback contract

Owner playback performs these operations:

1. Verify the Firebase session cookie.
2. Verify that the caller owns the receiving Space and that the Story is delivered.
3. Resolve the best available delivery audio.
4. Return a short-lived signed GCS redirect, or stream the object through the application with byte-range support.

These operations are implemented in `src/app/api/stories/[storyId]/audio/route.ts:42-81`. Owner authorization is a Story lookup plus receiving-Space ownership and delivered-state check (`src/lib/stories/owner.ts:45-91`).

The signed GCS URL lasts five minutes (`src/lib/audio/storage-stream.ts:5-9`). The redirect is marked `Cache-Control: no-store` (`src/lib/audio/storage-stream.ts:78-124`). The proxy fallback supports `Range`, `206 Partial Content`, `Content-Range`, `Content-Length`, and `Accept-Ranges` (`src/lib/audio/storage-stream.ts:126-207`). These HTTP features match ordinary stream playback, but the route that mints them is available only after Spoken Letter cookie authorization.

### 2.3 Current external-device precedent

Yoto is the only implemented external-device provider. The Owner connects a Yoto account through authorization-code OAuth with S256 PKCE and state (`src/app/api/yoto/connect/route.ts:20-57`; `src/lib/yoto/oauth.ts:57-77`). The callback verifies the Spoken Letter session and state, exchanges the provider code, and saves the connection (`src/app/api/yoto/callback/route.ts:20-92`). Provider access and encrypted refresh-token data are stored server-side per Spoken Letter user (`src/lib/yoto/connection.ts:20-46`; `src/lib/yoto/connection.ts:71-98`; `src/lib/yoto/crypto.ts:7-44`).

Yoto delivery does not expose a Spoken Letter playback URL to Yoto. Spoken Letter resolves the final MP3, downloads the private GCS object, uploads its bytes to Yoto, waits for Yoto's transcoded media identity, and adds that provider-owned track to a Recipient playlist (`src/lib/yoto/send.ts:307-335`; `src/lib/yoto/content.ts:199-270`; `src/lib/yoto/content.ts:293-323`). The playlist is stored per Recipient, and later Stories append chapters to it (`src/lib/schema/spaces.ts:127-141`; `src/lib/yoto/send.ts:117-126`).

That flow provides reusable account-linking, encrypted-token, idempotency, and localized-settings patterns. It does not provide an Alexa streaming surface because Alexa and Yoto use different provider contracts.

### 2.4 Adult mediation and language coverage

The current product model makes the Owner the only actor who performs the first child delivery. There is no child account, audio path, or action (`docs/architecture/data-model.md:599-621`). Current delivery is Owner download or direct Owner-triggered Yoto send (`docs/product/spoken-letter-project-status-summary.md:62-69`). ADR 0009 also keeps the first external-device delivery Owner-triggered (`docs/decisions/0009-polymorphic-delivery-boundary.md:67-107`).

The application supports `en`, `es`, and `fr` locales (`src/lib/i18n/app-locale.ts:5-18`). Story generation maps those profile locales to English, Spanish, and French (`src/lib/ai/prompt-language.ts:23-74`). The Story schema does not store a separate Story language field (`src/lib/schema/stories.ts:313-449`). A classic multilingual Alexa skill uses separate interaction models per language while sharing skill configuration ([Develop Skills in Multiple Languages](https://developer.amazon.com/en-US/docs/alexa/custom-skills/develop-skills-in-multiple-languages.html)). The platform languages therefore cover US/UK English, Spain Spanish, and France French at the content and application level; Alexa interaction-model localization is not present in the repository.

## 3. Interface-contract comparison

| Contract area | Amazon contract | Current Spoken Letter contract | Compatibility finding |
|---|---|---|---|
| Long-form playback | A custom skill can use `AudioPlayer` for narrative stories and playback events ([Amazon audio overview](https://developer.amazon.com/en-US/docs/alexa/custom-skills/add-audio.html)). | Final delivery audio is resolved through one shared fallback ladder (`src/lib/audio/final-audio.ts:32-65`). | Compatible at the audio-selection layer. |
| Audio format | Public HTTPS; MP3 accepted; 16–384 kbps ([Amazon stream requirements](https://developer.amazon.com/en-AU/docs/alexa/custom-skills/use-long-form-audio.html)). | MP3, 128 kbps, 44.1 kHz, stereo (`packages/audio-contract/src/yoto.ts:1-4`; `workers/audio/mix.ts:325-348`). | Compatible. No new transcode contract is evident. |
| Stream transport | Alexa receives a direct internet-accessible HTTPS stream URL and can send later playback events ([Amazon long-form audio](https://developer.amazon.com/en-AU/docs/alexa/custom-skills/use-long-form-audio.html)). | The Owner route requires a Firebase cookie before it issues a five-minute signed URL or proxies the object (`src/app/api/stories/[storyId]/audio/route.ts:42-81`; `src/lib/audio/storage-stream.ts:5-9`). | The stored media is usable, but the current authorization and URL lifetime are not an Alexa stream contract. |
| Account linking | Alexa authorization-code linking expects the service to provide authorization and token endpoints, access tokens, refresh tokens, and PKCE support ([Amazon account linking](https://developer.amazon.com/docs/alexaplus/account-linking/configure-authorization-code-grant.html)). | Spoken Letter authenticates its web app with a Firebase ID token exchanged for a five-day session cookie (`src/app/api/auth/session/route.ts:141-179`; `src/lib/auth/session.ts:9-23`). Its Yoto integration consumes another provider's OAuth endpoints (`src/lib/yoto/config.ts:46-56`; `src/lib/yoto/oauth.ts:79-154`). | Current identity data can anchor a link, but Spoken Letter does not expose the required Alexa-facing OAuth role. |
| Alexa request security | A custom-skill web service receives signed Alexa requests over HTTPS and must verify request authenticity and timestamp ([Host a Custom Skill as a Web Service](https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-a-web-service.html)). | Existing API routes use Firebase session verification and same-origin checks (`src/lib/auth/route-wrapper.ts:47-60`; `src/lib/auth/same-origin.ts:8-74`). | A distinct Alexa request-authentication boundary is absent. |
| Story discovery | The skill resolves a customer request and persists stream and user state for playback continuity ([Amazon long-form audio](https://developer.amazon.com/en-AU/docs/alexa/custom-skills/use-long-form-audio.html)). | The authenticated Story library returns Story ID, title, status, and `hasAudio`, not public media URLs (`src/app/api/stories/library/route.ts:47-99`; `src/lib/stories/sender.ts:33-45`; `src/lib/stories/sender.ts:602-624`). | The Story catalog exists, but Alexa-linked identity and voice selection are absent. |
| Playback state | Alexa reports start, stop, near-finish, pause, and resume state; Amazon directs the skill to persist stream and user data ([Amazon long-form audio](https://developer.amazon.com/en-AU/docs/alexa/custom-skills/use-long-form-audio.html)). | The Story record has delivery state and Yoto state, but no Alexa stream token, offset, event, or device field (`src/lib/schema/stories.ts:367-439`). | New provider-specific state would be required. |
| Languages | Alexa supports distinct locale interaction models, including `en-US`, `en-GB`, `es-ES`, and `fr-FR` ([Amazon multilingual skills](https://developer.amazon.com/en-US/docs/alexa/custom-skills/develop-skills-in-multiple-languages.html)). | Spoken Letter supports `en`, `es`, and `fr` (`src/lib/i18n/app-locale.ts:5-18`). | Content-language coverage aligns; Alexa models and utterances do not exist. |
| Child-enabled devices | Child-directed skills cannot use account linking. Account-linked non-child-directed skills are not accessible on child-enabled devices ([Amazon account-linking restrictions](https://developer.amazon.com/en-US/docs/alexa/account-linking/troubleshooting-account-linking.html)). | First delivery is controlled by the adult Owner; the child is not a platform actor (`docs/architecture/data-model.md:609-621`). | An adult account/device flow fits the current actor model. An account-linked flow cannot be used through an Amazon child-enabled device/profile under the current Amazon rule. |
| Native Alexa+ | MCP Toolkit is the path for services outside fixed categories. Its onboarding contract supports OAuth 2.1 and lists MP3 media, but its public capability list does not define long-form playback control ([Alexa+ MCP QuickStart Guide](https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html); [MCP Toolkit Supported Capabilities](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-supported-capabilities.html)). Partner access is assumed. | No Alexa+ MCP integration exists; current provider code is Yoto-specific (`src/lib/yoto/config.ts:1-56`; `src/lib/yoto/content.ts:120-183`). | Feasible native candidate. The partner SDK must confirm the MP3 playback directive, URL-lifetime behavior, and playback-event contract. |

## 4. End-to-end compatibility mapping

The detailed requested flow maps to the current platform as follows:

1. **Adult identity:** Alexa account linking identifies the Parent's Amazon account. Spoken Letter already has a Firebase user identity and server-side session model (`src/lib/auth/session.ts:39-68`). The missing boundary is the Alexa-facing OAuth authorization-server and protected-resource surface.
2. **Per-story approval:** The Parent's explicit delivery action is the current approval gate. Download confirmation and verified Yoto delivery mark the Story `downloaded` and record the approving Owner (`src/lib/stories/owner.ts:532-553`; `src/lib/yoto/send.ts:487-517`). An Alexa surface needs an equivalent approved-delivery record; it must not select an unapproved review-inbox Story.
3. **Recipient resolution:** The approved Story can already point to a Parent-authored Recipient (`src/lib/schema/stories.ts:313-367`). A single-Recipient household can use a default. A multi-Recipient household needs the child name in the request or an Alexa-person mapping; the current schema has no Amazon household identity.
4. **Approved Story catalog:** Owner access already resolves Stories through the receiving Space and delivered state (`src/lib/stories/owner.ts:45-91`). The existing library contract exposes Story identifiers, titles, states, and audio availability (`src/lib/stories/sender.ts:33-45`; `src/lib/stories/sender.ts:602-624`). The Alexa catalog must filter this data to the linked Parent, selected Recipient, and Parent-approved Stories.
5. **Audio choice:** `bestAvailableDeliveryAudio` selects current branded mix, last-good mix, or narration (`src/lib/audio/final-audio.ts:32-65`). Alexa does not need a separate mix pipeline.
6. **Stream:** The selected object is already an Alexa-compatible MP3 when the current branded rendition exists (`packages/audio-contract/src/yoto.ts:1-4`). GCS signing and byte-range proxying already exist (`src/lib/audio/storage-stream.ts:78-207`). The current five-minute URL is minted behind a browser cookie and is not a complete Alexa delivery contract. Alexa needs a provider-authenticated stream URL whose lifetime covers initial playback and later resume.
7. **Playback continuity:** Alexa can send playback lifecycle events and offsets. The current Story schema contains no Alexa stream token, offset, event, or device state (`src/lib/schema/stories.ts:367-439`).

This mapping shows that the reusable core is the private Story catalog, Parent approval model, final-audio resolver, stored MP3, and HTTP streaming support. The absent surface is the Alexa adapter: OAuth 2.1 provider endpoints, Alexa-to-Spoken-Letter identity, Recipient resolution, approved-story filtering, Alexa-safe stream authorization, and playback lifecycle state.

### 4.1 Household account binding is a deliberate configuration choice

The classic-skill account link can be personal-profile-level or shared-account-level. If Personalize Skills is enabled for a recognized voice, the person can link a personal profile. If personalization is disabled, linking occurs at the shared Amazon account registered to the device ([Use Personalization With or Without Account Linking](https://developer.amazon.com/en-US/docs/alexa/custom-skills/personalization-and-account-linking.html)).

Amazon documents the exact mode that fits Spoken Letter: when a skill supports account linking but not recognized-speaker personalization, requests contain `user.accessToken` for the third-party account linked to the shared Amazon account, contain no `person` object, and cannot distinguish speakers ([Use Personalization With or Without Account Linking](https://developer.amazon.com/en-US/docs/alexa/custom-skills/personalization-and-account-linking.html)). This lets the Parent link once and lets any speaker on that shared household account request approved Stories. It also means child identity must come from a default Recipient or from the spoken request, not voice recognition.

The independent investigation's statement that a Parent link is always household-wide was therefore too broad. Shared-account linking is supported and fits the desired flow, but it depends on the skill's personalization configuration and the account-linking mode.

### 4.2 Classic-skill token and AudioPlayer event behavior

For a valid linked account, Amazon says every request includes the linked `accessToken` at `context.System.user.accessToken`. It explicitly notes that AudioPlayer requests occur outside a normal skill session, omit the `session` object, but still include `context` ([Validate and Use Access Tokens in Custom Skill Code](https://developer.amazon.com/en-US/docs/alexa/account-linking/add-account-linking-logic-custom-skill.html)). This is stronger evidence than the abbreviated empty `user` objects in AudioPlayer examples.

Each `AudioPlayer.Play` directive also supplies an opaque stream `token` and an `offsetInMilliseconds`. Alexa echoes that token and current offset in playback lifecycle requests, including stopped, finished, nearly finished, and failed events ([AudioPlayer Interface Reference](https://developer.amazon.com/en-US/docs/alexa/custom-skills/audioplayer-interface-reference.html)). The provider state can therefore correlate an Alexa stream token to Story, linked Parent, Recipient, and resume offset without depending on a live skill session. The current Story schema has no such Alexa state (`src/lib/schema/stories.ts:367-439`).

Amazon's documented stream requirements contain no maximum AudioPlayer duration or file size. That absence is not a guarantee. Physical-device validation remains necessary for the platform's real Story durations and for resume after the current stream URL expires.

### 4.3 Classic-skill invocation remains explicit

The public name-free interaction toolkit for classic custom skills is limited to Alexa Smart Properties hidden skills that are not available in the Skill Store ([Understand Name-free Interactions](https://developer.amazon.com/en-US/docs/alexa/custom-skills/understand-name-free-interaction-for-custom-skills.html)). A public classic skill therefore depends on a child-compatible invocation such as `Alexa, open Spoken Letter` or `Alexa, ask Spoken Letter for Sofia's latest story`.

This limitation does not establish the behavior of a native Alexa+ add-on. Amazon's Alexa+ MCP design guide says certified add-ons can earn name-free invocation at Amazon's quality bar ([Alexa+ MCP Design Guide](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-design-guide.html)).

### 4.4 Alexa is a pull library, not a pushed device copy

Yoto delivery copies an approved Story into the provider account and onto a persistent Recipient playlist (`src/lib/yoto/send.ts:307-335`; `src/lib/yoto/content.ts:293-323`). AudioPlayer instead begins after a customer invokes the skill and the service returns a `Play` directive ([AudioPlayer Interface Reference](https://developer.amazon.com/en-US/docs/alexa/custom-skills/audioplayer-interface-reference.html)). Alexa therefore behaves as an approved Story library the child opens, not as a device that already contains the new Story.

Classic skills can publish customer-specific Proactive Events after the customer enables notifications, but Amazon exposes those events only through Alexa Notifications ([About Proactive Events](https://developer.amazon.com/en-US/docs/alexa/smapi/proactive-events-api.html)). The `AMAZON.MediaContent.Available` schema announces that named content is available from a provider; it does not carry or autoplay the Story stream ([Proactive Events Schemas](https://developer.amazon.com/en-US/docs/alexa/smapi/schemas-for-proactive-events.html)). The Alexa Routines Kit is no longer available as of 2026-05-13 ([Deprecated Features](https://developer.amazon.com/en-US/docs/alexa/ask-overviews/deprecated-features.html)).

This is the main experience difference from Yoto: after Parent approval, Alexa can notify the family that content exists, but the child still initiates playback by voice.

### 4.5 Parent linking can start inside Spoken Letter

Amazon supports app-initiated app-to-app linking from an existing app or website. A signed-in customer can start skill enablement and account linking from that product, complete the Alexa or Login with Amazon consent step, and use authorization code plus S256 PKCE ([App-Initiated App-to-App Account Linking](https://developer.amazon.com/docs/alexaplus/account-linking/app-to-app-account-linking-starting-from-your-app.html)). This fits Spoken Letter's existing localized Settings and provider-connection surface (`src/app/[locale]/(app)/settings/page.tsx:305-312`; `src/components/settings/yoto-connect-card.tsx:204-264`).

### 4.6 Public Alexa+ evidence does not prove audio impossible

The independent investigation treats the Alexa+ MCP capability index's two entries—authentication and account linking—as proof that MCP cannot support audio. The public documentation does not support that categorical conclusion. The MCP QuickStart separately lists MP3 and other audio codecs under media requirements ([Alexa+ MCP QuickStart Guide](https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html)), while the supported-capabilities index only links authentication and account-linking topics ([MCP Toolkit Supported Capabilities](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-supported-capabilities.html)).

There is still no published long-form playback directive or lifecycle contract for MCP. The defensible conclusion remains: native Alexa+ playback is **unverified in the public contract**, not proven impossible. Partner SDK inspection or an Alexa-team confirmation resolves this point.

The July 23, 2026 Alexa+ announcement does not close that evidence gap. It describes MCP server ingestion, integration-path generation, a simulator-ready package, and Preview availability, but it does not describe MP3 playback directives, stream URL lifetime, resume offsets, or playback events ([Alexa+ launches new ways to build experiences](https://developer.amazon.com/alexaplus/blogs/2026/07/alexa-plus-new-ways-to-build-experiences)).

## 5. Safety, consent, and certification facts

Amazon's Alexa+ add-on policy says add-ons must not target children. It also requires documented consent when an add-on uses a real person's name, likeness, or voice, and it requires privacy and terms URLs plus Amazon's standard OAuth consent infrastructure ([Alexa+ Policy Requirements](https://developer.amazon.com/docs/alexaplus/add-ons/policy-requirements.html)).

Because the requested end user is explicitly a child asking Alexa to play stories, this published rule is a direct fit constraint for a native Alexa+ add-on. Partner SDK access does not itself remove a certification policy. The Alexa team would need to confirm that an adult-authorized household listening experience is eligible as a general-audience service, or provide a different approved integration class.

Spoken Letter's current legal copy states that the service is adult-mediated and that a child receives content outside the application through the adult (`messages/en/legal.json:9-10`; `messages/en/legal.json:64-65`). Its terms state that users retain ownership and grant the service a license needed to provide the product, and that the sender confirms the required rights and permissions for submitted content and voice use (`messages/en/legal.json:236-239`). Whether these terms and existing consent records satisfy Alexa certification is a certification and legal determination; the repository does not contain an Amazon certification record.

The classic-skill policy also rejects unmoderated user-generated content ([Policy Requirements for Alexa Skills](https://developer.amazon.com/en-US/docs/alexa/custom-skills/policy-requirements-for-an-alexa-skill.html)). Spoken Letter's existing per-story Parent review and deliberate delivery gate means the recordings are not automatically exposed to the child (`docs/decisions/0010-membership-visible-in-search.md:38-48`; `docs/product/spoken-letter-personas-and-journey-foundations.md:47-55`). That is directly relevant certification evidence, although Amazon's public policy does not define whether Parent review alone satisfies its moderation standard.

The Amazon child-device restriction is also decisive for classic account-linked playback: child-directed skills cannot use account linking, while non-child-directed skills with account linking are not accessible through child-enabled devices or profiles ([Add Account Linking for Alexa](https://developer.amazon.com/docs/alexaplus/account-linking/add-account-linking.html)). Amazon's child-directed guidance says intended audience, subject matter, language, audio content, description, and marketing determine whether a skill targets children ([How to Create a Child-Directed Skill](https://developer.amazon.com/en-US/blogs/alexa/alexa-skills-kit/2021/09/create-a-child-directed-skill)). A child asking on an ordinary shared/adult Alexa profile is technically routable, but the product's explicit child audience still needs Amazon policy approval; moving the same experience off an Amazon Kids profile does not by itself settle classification.

## 6. Repository surface that exists today

The repository dependency list contains the application, Firebase, Google Cloud, audio, and Next.js dependencies, but no ASK SDK (`package.json:74-100`). The implemented Amazon service references are for SES/SNS email processing, not Alexa (`src/lib/email/sns-verify.ts:1-9`; `src/lib/notifications/email.ts:1`). The implemented device integration surface is under the Yoto routes and libraries (`src/app/api/yoto/connect/route.ts:1-61`; `src/app/api/stories/[storyId]/send-to-yoto/route.ts:39-104`; `src/lib/yoto/content.ts:120-183`).

A repository-wide case-insensitive scan found no Alexa, Alexa Skills Kit, ASK SDK, SMAPI, Alexa skill manifest, Alexa account-linking implementation, or Alexa+ implementation. Historical product, architecture, research, plan, decision, and hackathon documents also contain no Alexa or Amazon Echo design. The only earlier smart-speaker copy finding was recorded as an unresolved compatibility-content claim, not an integration design (`docs/plans/2026-07-27-public-surface-truthfulness-notes.md:34-48`).

## 7. Historical alignment

The product evolved from a generic manual MP3 export to a provider-specific Yoto OAuth and content integration. The original plan kept generic MP3 delivery available for screen-free devices (`docs/hackathon/origin-story.md:42-53`). Current product status records both MP3 download/manual card loading and direct send to a connected Yoto account (`docs/product/spoken-letter-project-status-summary.md:62-85`).

The durable cross-provider rules are:

- The Owner controls first delivery to the child (`docs/product/spoken-letter-personas-and-journey-foundations.md:289-301`; `docs/architecture/data-model.md:609-621`).
- A future delivery surface uses the accepted best-available-audio ladder (`docs/decisions/0009-polymorphic-delivery-boundary.md:109-121`).
- Provider account credentials stay server-side; the existing Yoto record stores short-lived access data and an encrypted refresh token (`docs/architecture/data-model.md:543-555`).
- The child has no platform account or audio route (`docs/architecture/data-model.md:599-607`).

An adult-account Alexa integration is consistent with those current rules. A child-enabled Alexa profile is not compatible with Amazon's account-linking restriction.

## 8. Compatibility conclusion

### Requested three-step journey

**Technically feasible and consistent with the current Spoken Letter flow.** The high-level journey includes the existing Parent review and per-story approval gate.

The matching journey is:

1. A family member creates and sends the story.
2. The Parent connects Alexa once.
3. The Parent reviews and approves each story for child delivery.
4. The child asks Alexa to play approved stories.

Step 3 preserves the existing invariant that unwanted content can enter the review inbox but cannot reach the child until the Owner deliberately delivers it (`docs/decisions/0010-membership-visible-in-search.md:38-48`). Alexa account linking is a one-time provider authorization; it does not act as blanket approval for current or future Stories.

The device/profile result is separate:

- **Ordinary shared or adult Alexa profile:** technically feasible, subject to Amazon confirming that the adult-authorized family experience is eligible under its child-directed and Alexa+ add-on policies.
- **Amazon Kids or another child-enabled profile/device:** not compatible with standard account linking under Amazon's published rules.

### Classic Alexa skill on Alexa devices

**Technically feasible with the current platform core, but not implemented.** The final MP3 and streaming primitives align with Amazon's public `AudioPlayer` requirements. The current Story catalog, Owner authorization, locale coverage, and final-audio selection are reusable. The repository does not contain the provider adapter that Alexa requires.

This path does not require a new audio worker format or a Yoto-style provider upload/transcode step. It uses an HTTPS stream URL for the existing resolved final audio. That conclusion is an interface-contract inference from Spoken Letter's MP3 output (`packages/audio-contract/src/yoto.ts:1-4`) and Amazon's published stream requirements ([Stream Long-Form Audio with AudioPlayer](https://developer.amazon.com/en-AU/docs/alexa/custom-skills/use-long-form-audio.html)).

### Native Alexa+ add-on

**Technically feasible candidate when partner access is treated as given.** The MCP Toolkit fits a service outside Amazon's current fixed categories, supports the required account-linking model, and lists MP3 as supported media ([Choose the Proper Alexa+ Integration Approach](https://developer.amazon.com/docs/alexaplus/add-ons/choose-the-proper-alexaplus-integration-approach.html); [Alexa+ MCP QuickStart Guide](https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html)). Spoken Letter already has the compatible MP3, private Story catalog, Owner authorization, and stream primitives.

Two Alexa-side qualifications remain. First, the public MCP documentation does not show how an add-on starts persistent long-form audio, supplies resume offsets, or receives playback lifecycle events. If the partner SDK exposes that contract, the media path works directly with the current platform core. If it does not, the confirmed playback route remains a classic `AudioPlayer` skill plus Amazon's separate direct-invocation evaluation for Alexa+ ([Introducing AI-native SDKs for Alexa+](https://developer.amazon.com/en-US/blogs/alexa/alexa-skills-kit/2025/02/new-alexa-announce-blog)). Second, Amazon's published Alexa+ policy says an add-on must not target children ([Alexa+ Policy Requirements](https://developer.amazon.com/docs/alexaplus/add-ons/policy-requirements.html)). The requested child-invoked experience therefore needs an eligibility decision from the Alexa team even when SDK access is available.

### Child-enabled Alexa devices or profiles

**Not compatible with the required account-linked design under Amazon's current published rule.** Amazon does not allow child-directed skills to use account linking, and it does not expose an account-linked non-child-directed skill on child-enabled devices ([Add Account Linking for Alexa](https://developer.amazon.com/docs/alexaplus/account-linking/add-account-linking.html)).

## External sources checked

All external sources are first-party Amazon pages and were checked on 2026-08-17:

- [Alexa+ Developer Docs Home](https://developer.amazon.com/docs/alexaplus/add-ons/home.html)
- [Alexa+ launches new ways to build experiences](https://developer.amazon.com/alexaplus/blogs/2026/07/alexa-plus-new-ways-to-build-experiences)
- [Choose the Proper Alexa+ Integration Approach](https://developer.amazon.com/docs/alexaplus/add-ons/choose-the-proper-alexaplus-integration-approach.html)
- [Alexa+ MCP QuickStart Guide](https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html)
- [MCP Toolkit Supported Capabilities](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-supported-capabilities.html)
- [Alexa+ MCP Design Guide](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-design-guide.html)
- [Alexa+ Policy Requirements](https://developer.amazon.com/docs/alexaplus/add-ons/policy-requirements.html)
- [Introducing AI-native SDKs for Alexa+](https://developer.amazon.com/en-US/blogs/alexa/alexa-skills-kit/2025/02/new-alexa-announce-blog)
- [Add Audio to a Custom Skill](https://developer.amazon.com/en-US/docs/alexa/custom-skills/add-audio.html)
- [Stream Long-Form Audio with AudioPlayer](https://developer.amazon.com/en-AU/docs/alexa/custom-skills/use-long-form-audio.html)
- [AudioPlayer Interface Reference](https://developer.amazon.com/en-US/docs/alexa/custom-skills/audioplayer-interface-reference.html)
- [Configure an Authorization Code Grant](https://developer.amazon.com/docs/alexaplus/account-linking/configure-authorization-code-grant.html)
- [Validate and Use Access Tokens in Custom Skill Code](https://developer.amazon.com/en-US/docs/alexa/account-linking/add-account-linking-logic-custom-skill.html)
- [Use Personalization With or Without Account Linking](https://developer.amazon.com/en-US/docs/alexa/custom-skills/personalization-and-account-linking.html)
- [App-Initiated App-to-App Account Linking](https://developer.amazon.com/docs/alexaplus/account-linking/app-to-app-account-linking-starting-from-your-app.html)
- [Understand Name-free Interactions](https://developer.amazon.com/en-US/docs/alexa/custom-skills/understand-name-free-interaction-for-custom-skills.html)
- [About Proactive Events](https://developer.amazon.com/en-US/docs/alexa/smapi/proactive-events-api.html)
- [Proactive Events Schemas](https://developer.amazon.com/en-US/docs/alexa/smapi/schemas-for-proactive-events.html)
- [Deprecated Features](https://developer.amazon.com/en-US/docs/alexa/ask-overviews/deprecated-features.html)
- [Policy Requirements for Alexa Skills](https://developer.amazon.com/en-US/docs/alexa/custom-skills/policy-requirements-for-an-alexa-skill.html)
- [Troubleshooting Account Linking](https://developer.amazon.com/en-US/docs/alexa/account-linking/troubleshooting-account-linking.html)
- [Add Account Linking for Alexa](https://developer.amazon.com/docs/alexaplus/account-linking/add-account-linking.html)
- [How to Create a Child-Directed Skill](https://developer.amazon.com/en-US/blogs/alexa/alexa-skills-kit/2021/09/create-a-child-directed-skill)
- [Develop Skills in Multiple Languages](https://developer.amazon.com/en-US/docs/alexa/custom-skills/develop-skills-in-multiple-languages.html)
- [Host a Custom Skill as a Web Service](https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-a-web-service.html)
