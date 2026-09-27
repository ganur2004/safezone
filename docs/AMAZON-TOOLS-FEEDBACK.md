# Feedback on the Amazon developer tools

Requested as part of the submission: what worked, what did not, and how getting started went.

**Scope, stated up front.** We built against the Amazon SDKs and described the whole deployment in
CDK, but we never obtained AWS credentials during the hackathon, so nothing below is a report on
running these services in production. Where we have no first-hand experience we say so rather than
guessing. The detailed incident notes are in `FRICTION-LOG.md`.

## Alexa+ and the MCP toolkit

**What we liked.** Accepting a self-hosted MCP server instead of a bespoke skill format is the right
call and it changed the shape of our project for the better. We wrote one server, and it serves
Alexa+ and our own web client without knowing the difference. The decision to build on an open
protocol rather than a proprietary one is the reason this codebase is reusable at all.

**What did not work for us.** We could not get access. The developer preview's availability is not
stated anywhere we could find — not on the add-on overview page, not in the toolkit documentation —
so we spent time trying before concluding it was not open to us, and asked on the Devpost
discussions without resolution. One line near the top of the overview page saying which accounts and
regions can use the preview would have saved that entirely.

The consequence is that our Alexa+ integration is untested. The MCP endpoint is ready to register and
the tool descriptions are written for a model to choose from, but no Alexa device has ever called it.

## Amazon Bedrock

**What we liked.** The Converse API is a good abstraction. One request shape across models, tool use
as a first-class concept rather than a prompt convention, and a `stopReason` that makes the agent
loop obvious to write. Our tool loop is about sixty lines and reads like the diagram of it.

**Friction.** The TypeScript types for `toolConfig` are awkward: `Tool` is a tagged union whose
members each carry a `$unknown` variant, so the natural object literal does not type-check, and the
error message points at a property nobody would write by hand. The JSON Schema for a tool also has
to be cast to `DocumentType`, which is re-exported from `@smithy/types` rather than from the Bedrock
package. Both are small, and both cost us time that a single "build toolConfig from a list" snippet
in the tool-use documentation would have saved.

**Untested.** We never called the service. Everything we know about its behaviour comes from the
types and the docs; our loop is covered by tests against a fake client. We fully expect model access
to be the first thing that bites on a real deploy.

## Amazon Polly

Straightforward to integrate — one command, an audio stream, done. We designed around the assumption
that it might not be configured, so the agent answers 503 and the browser speaks instead, and that
fallback is the path we have actually heard. Nothing to report for or against the service itself.

## Amazon Location Service

**What we liked.** Per-request API key authentication is genuinely useful: our geocoding and routing
calls need no IAM credentials at all, which made the code simpler than the equivalent AWS pattern
usually is.

**Friction.** Working out _which_ call geocodes took longer than it should have. `@aws-sdk/client-geo-places`
exports `GeocodeCommand`, `SearchTextCommand`, `SuggestCommand`, `AutocompleteCommand` and
`SearchNearbyCommand`, and the developer guide discusses the REST API rather than the SDK commands,
so we ended up reading generated type definitions to choose. The `Key` parameter that makes API-key
auth work is easy to miss in the same way.

## AWS CDK

The best-documented thing we touched, and the reason the whole deployment is one command. Two notes
from building it. `NodejsFunction` emitting ESM plus any dependency that calls `require` at runtime
fails only at invocation, with "Dynamic require of http is not supported" — a banner injecting
`createRequire` fixes it, but nothing warns at build time. And `logRetention` is deprecated in favour
of an explicit `logGroup`, which the deprecation message states clearly; that one was a pleasure by
comparison.

## Getting started, overall

The parts we could use without an account were easy to adopt. The parts that needed one we could not
evaluate, and the one we most wanted to evaluate — Alexa+ — we could not reach at all. If there is a
single change worth making for hackathon participants, it is publishing eligibility for the Alexa+
preview clearly enough that a team can tell in thirty seconds whether to plan around it.
