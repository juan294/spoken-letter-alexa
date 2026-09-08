# Amazon packaging runbook

Numbered steps from Amazon's "Set up your development environment" page
(https://developer.amazon.com/docs/alexaplus/add-ons/set-up-your-development-environment.html),
the quickstart and the CLI reference, as recorded in
`docs/research/2026-09-03-alexa-plus-hackathon-mcp-add-on.md` (sections 2.1, 3.2 and 5.4).
Every step runs only once an Amazon Solutions Architect has allowlisted an AWS account of
the Owner's. Where the research records an exact command it is given verbatim; where it
does not, the step says so and names what must be read from Amazon's page at that point.
No command below has been run.

Prerequisites this repository already meets: the MCP server speaks Streamable HTTP, the
OAuth 2.1 server offers authorization code + PKCE S256 and client_credentials, RFC 8414
and RFC 9728 metadata are served, and unauthenticated `/mcp` requests answer 401 with the
resource metadata challenge (Phases 1 and 2).

## 1. Accounts (research 3.2 and 3.3)

1. Use the US amazon.com identity as the Amazon developer account. Execute
   `amazon/us-account-checklist.md` first.
2. Set the preferred marketplace on the retail website to an Alexa+ supported marketplace
   (Amazon: "Set preferred marketplace on Retail Website to Alexa+ supported
   marketplaces").
3. Set the test device's language to a supported locale for that marketplace (Amazon:
   "Ensure device's language is set to Alexa+ supported locales for that marketplace");
   for this add-on that is `en-US`.
4. Quote one AWS account owned by the Owner to the Solutions Architect. Amazon: "Log in to
   the AWS account that you provided to the Alexa Solutions Architect". This is a
   decision for the Owner; the CDK stacks use `106403001709` (profile `archy`), and using
   the same account keeps one console, but nothing in the research requires it.

## 2. AWS profile `alexa-ai` assuming the Amazon role (research 2.1)

5. The role to assume is `arn:aws:iam::372468808636:role/AddOn3PDeveloperToolsRead`
   (recorded verbatim). Create a named CLI profile `alexa-ai` that assumes it from the
   allowlisted account. The research does not record Amazon's exact profile snippet or
   `aws sts assume-role` invocation, nor whether the role needs an external id or a
   session name; read those from the setup page before writing
   `~/.aws/config`. Do not guess them.
6. Verify the assumption with a read-only call before going further:
   `aws sts get-caller-identity --profile alexa-ai`. The returned `Arn` must contain
   `AddOn3PDeveloperToolsRead`.

## 3. CodeArtifact login (research 2.1)

7. Amazon: "Authenticate npm against the Alexa AI private CodeArtifact registry". The CLI
   package is `@alexa-ai/cli` (it is not on public npm: `registry.npmjs.org/@alexa-ai%2Fcli`
   returns 404). The research does not record the CodeArtifact domain, domain owner,
   repository name or region that the `aws codeartifact login --tool npm ...` command
   needs; take them from the setup page. The login writes a short-lived token into the
   npm config, so repeat this step whenever installs start failing with 401.
8. Install the CLI after the login. The research does not record the install command;
   `npm install -g @alexa-ai/cli` is the conventional form for a global CLI from a private
   registry and must be checked against the page. Confirm with `alexa-ai --version`.

## 4. Scaffold: `alexa-ai new mcp --locale en-US` (research 3.2)

9. Recorded command shape (from the quickstart, with Amazon's example name):
   `alexa-ai new mcp --name "Hotel Finder" --locale en-US`. For this add-on:

   ```bash
   alexa-ai new mcp --name "Spoken Letter" --locale en-US
   ```

   `--locale` is documented as "Locale for the add-on. Default: en-US."
10. Run it in a scratch directory outside this repository, then diff the generated
    `addon.json` against `amazon/addon.json`. Every field name marked "chosen" in
    `amazon/addon-fields.md` is replaced by the generated name; the values stay as the
    plan fixes them. Record each renamed field in `docs/friction-log.md`.
11. Copy the reconciled `addon.json` back into `amazon/`. If the scaffold produces other
    files the CLI needs at deploy time, add them under `amazon/` with a note on what each
    one is. Do not copy Amazon sample code that is not needed to deploy.
12. Add Amazon's OAuth client (client id, secret hash, redirect URIs) to the
    `OAUTH_CLIENTS` environment of the deployed OAuth server (Phase 2 shape). Secrets never
    enter the repository.

## 5. Deploy: `alexa-ai deploy` (research 2.1)

13. Run `alexa-ai deploy` from the directory holding the reconciled manifest. The
    research records the command name only; flags for stage or profile, if any, are on the
    CLI reference page (https://developer.amazon.com/docs/alexaplus/add-ons/alexa-ai-cli-reference.html).
    The deploy targets the development stage, which Amazon describes as "Only accessible
    to your developer account."
14. Record the full command, the deploy output and the stage identifier in
    `docs/friction-log.md`. The output location of any deploy artefacts is not recorded
    in the research; note where the CLI writes them.

## 6. Web simulator (research 2.1, 6)

15. The web simulator exists only after `alexa-ai deploy`. The research does not record
    the URL or CLI subcommand that opens it; take it from
    https://developer.amazon.com/docs/alexaplus/add-ons/test-with-web-simulator.html.
16. Run the three example phrases from `addon.json` in order. For each, record: the
    utterance, which tool Alexa+ called, the spoken response, and whether the
    `resource_link` in `get_family_story` produced playback on a screened device. This is
    the first evidence for the undocumented audio contract (research section 6).
17. Capture the `initialize` request the deployed stage sends (expected
    `protocolVersion: "2025-03-26"` from the live client) from the server logs.

## 7. Physical Device Config (research 2.1, 3.3)

18. In the simulator, use Physical Device Config to route to the Echo re-registered to the
    US account with device language `en-US`. Inferred, not verified (research 3.3 is
    marked INFERRED; the verified basis is only the classic ASK rule in 3.2): the device
    drop-down should list devices on the account signed into the developer console.
    Confirm when access exists.
19. Speak the first example phrase to the device. Record the utterance, the response and
    whether audio plays. This is the only path to real-device footage for the video.
20. Everything learned in steps 13 to 19 goes into `docs/friction-log.md` and
    `docs/product-feedback.md`, with screenshots stored outside the repository until the
    Owner decides what to publish.

## Local checks that need no access

- Amazon's Local Inspector against `pnpm dev`: `amazon/inspector.md`.
- Manifest validation: `pnpm -F amazon test` or
  `node_modules/.bin/vitest run --root amazon` from the repository root.
