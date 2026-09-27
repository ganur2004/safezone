# Submission checklist

The checklist from SPEC section 14, with honest status. Deadline: **22 October 2026** (internal;
Devpost closes 23 October, 12:00 PDT).

| #   | Item                                  | Status      | Who / what is needed                                |
| --- | ------------------------------------- | ----------- | --------------------------------------------------- |
| 1   | Public repository, MIT licence        | ⚠️ partly   | `LICENSE` is in place; push to a public GitHub repo |
| 2   | README in English, with a screenshot  | ✅ done     | screenshots in `docs/images/`                       |
| 3   | Video, under 3 minutes, YouTube/Vimeo | ❌ not done | must be recorded — script in `VIDEO-SCRIPT.md`      |
| 4   | Devpost description in English        | ✅ drafted  | `DEVPOST.md`; paste into the form                   |
| 5   | Feedback on the Amazon tools          | ✅ done     | `AMAZON-TOOLS-FEEDBACK.md`                          |
| 6   | Friction log                          | ✅ done     | `FRICTION-LOG.md`, four entries                     |
| 7   | Mini-competitions named               | ✅ drafted  | AWS and Open Source, in `DEVPOST.md`                |
| 8   | Both team members on Devpost          | ❌ not done | add each other on the submission                    |
| 9   | Submitted before 22 October           | ❌ not done | —                                                   |

## What is blocked, and on what

These are the things nobody can finish from inside the repository. Each needs an account, a
recording, or a decision.

### 1. Deploy, and the live demo link

**Blocked on: AWS credentials.** The stack is written and synthesizes; see `DEPLOY.md`. Until it is
deployed, the Devpost "Try it" section has no link, and the README says the project is not deployed.
Expect the first deploy to surface Bedrock model access before anything else.

### 2. The video

**Blocked on: somebody recording it.** `VIDEO-SCRIPT.md` has the shot list, the narration and the
timings, and the demo runs from recorded fixtures so it cannot fail live. Record in Chrome — voice
input needs it.

### 3. Alexa+ registration

**Blocked on: developer preview access**, which we could not obtain. The rules accept the simulator,
so this is not required to submit. If access appears, `McpEndpoint` from the deploy output is the
address to register.

### 4. Real fire data for the headline demo

**A judgement call, not a blocker.** The recorded Sacramento wind is westerly and light, so the fires
to the north-east are _downwind_ and the demo shows **moderate** rather than the high-risk upwind
case that best demonstrates the rule set. Options, in order of honesty:

1. Re-run `npm run record-fixtures` with a `FIRMS_MAP_KEY` on a day when a real fire sits upwind of a
   US city, and use that city in the demo.
2. Keep Sacramento and demonstrate the upwind rule by talking over it rather than showing it.
3. Point the demo at a location where the current recorded data is more dramatic — Hilo already has
   a real hurricane watch, and it shows a **high** level today.

Option 3 costs nothing and uses real recorded data. Option 1 is the best if the timing works out.

## Before submitting

- [ ] `npm install && npm run build && npm test && npm run lint` on a clean clone
- [ ] `npm run demo` works with no `.env` present
- [ ] README's live demo link points at the real CloudFront URL
- [ ] `DEVPOST.md` links filled in: demo, repository, video
- [ ] Screenshots regenerated if the interface changed
- [ ] Repository made public, and the licence visible on the GitHub page
