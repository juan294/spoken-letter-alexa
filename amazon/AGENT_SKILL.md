# Add-on Agent Skill (placeholder)

Amazon publishes an "Add-on Agent Skill" for Alexa+ add-ons: a set of instructions that
"guides your AI coding agent through the entire onboarding process. It works in Claude
Code, Kiro, Cursor, VS Code Copilot" (quoted in
`docs/research/2026-09-03-alexa-plus-hackathon-mcp-add-on.md`, section 1).

This file is a placeholder. The skill content is behind the Alexa+ MCP Toolkit gate:
"At this time, Category SDK and MCP Toolkit are available to select partners only"
(https://developer.amazon.com/docs/alexaplus/add-ons/home.html, research section 2.1).
Nothing from Amazon's page is reproduced here, and nothing here is an approximation of it.

## Where it lives

The Alexa+ add-on documentation root is
https://developer.amazon.com/docs/alexaplus/add-ons/home.html and the toolkit overview
is https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html. The
research session fetched the pages listed under "External sources checked" in the research
document and did not record a separate page URL for the Agent Skill text itself; the
quoted sentence came from those Alexa+ pages. When access exists, the exact page is the
one the toolkit's onboarding points to.

## What happens when access exists

1. Replace this file with the Agent Skill instructions verbatim, unmodified.
2. Record the page URL, the fetch date and the document version (if Amazon states one)
   at the top of the replaced file.
3. Note in `docs/friction-log.md` whether the instructions run unchanged in Claude Code
   against this repository, and what they assumed that did not hold.

Until then, `amazon/runbook.md` is the manual equivalent.
