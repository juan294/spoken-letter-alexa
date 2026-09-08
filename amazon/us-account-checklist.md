# US account topology checklist

Research section 3.3 (`docs/research/2026-09-03-alexa-plus-hackathon-mcp-add-on.md`) as a
checklist. The Owner decided on 2026-09-03 to execute it only when toolkit access is
granted (research 12, decision 4). Until then it is a prepared decision, not an action.
Nothing here has been done.

Why this shape: "The MCP Toolkit is available in the United States"; the CLI defaults to
`en-US` and the example manifest distributes to `US` only; the simulator's device list
comes from the account signed into the developer console (research 3.2 and 3.3). The
Owner's Spanish Alexa+ subscription cannot see a partner add-on.

## Test the two unknowns first

Neither is documented anywhere the research found. Both are cheap to test once, before
re-registering any device, and their answers decide whether the rest of the checklist is
worth doing.

- [ ] **Alexa+ on a US-registered device located in Spain.** Register one Echo to the US
      amazon.com account while it stays at home in Spain and check whether Alexa+ activates
      on it. Record the outcome (activated, not offered, region error) in
      `docs/friction-log.md`.
- [ ] **Non-US billing address on the US Alexa+ subscription.** Check whether the US
      account can hold an Alexa+ subscription with the Owner's Spanish billing address.
      Record the outcome the same way.

If either fails, stop and put the result to Amazon (research 11, question 4 covers the
locale side; the account side is a new question).

## Checklist

- [ ] **Amazon developer account: the US amazon.com identity.** Sign in to the developer
      console with the US account. The simulator lists devices on this account and the
      add-on distributes to `US`.
- [ ] **AWS account for the toolkit.** Decide which AWS account owned by the Owner is
      quoted to the Solutions Architect. It must be able to assume
      `arn:aws:iam::372468808636:role/AddOn3PDeveloperToolsRead`. See
      `amazon/runbook.md` step 4.
- [ ] **Consumer Alexa+ entitlement on the US account.** A `US`-distributed add-on never
      appears on the amazon.es account. Depends on the two unknowns above.
- [ ] **Preferred marketplace.** On the US retail account, set the preferred marketplace to
      an Alexa+ supported marketplace (Amazon's setup page wording).
- [ ] **One test device re-registered to the US account, language `en-US`.** Pick one Echo
      at home, deregister it from the Spanish account, register it to the US account, set
      device language to `en-US`. Amazon's setup page requires the device language to be a
      supported locale for the marketplace. Note the device name as it appears in the Alexa
      app for the simulator's device drop-down.
- [ ] **Remaining home devices stay on the Spanish account.** They keep the household's
      Spanish Alexa+ working and can still appear in demo footage.
- [ ] **Alexa app preferred marketplace.** The Alexa app used to manage the re-registered
      Echo signs in with the US account; check that its marketplace matches.
- [ ] **Record every step and its result** in `docs/friction-log.md`, including timings:
      how long re-registration took and anything the apps refused.

## Reversal

Re-registering the Echo to the Spanish account is the same procedure in reverse. Nothing in
this checklist is irreversible; nothing touches the private Spoken Letter repository or its
users.
