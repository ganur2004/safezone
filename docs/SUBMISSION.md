# Submission checklist

The checklist from SPEC section 14, with honest status. Deadline: **22 October 2026** (internal;
Devpost closes 23 October, 12:00 PDT).

**Submitted on 22 October 2026: https://devpost.com/software/safezone-7xzlan**

| #   | Item                                  | Status  | Who / what is needed                                                          |
| --- | ------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| 1   | Public repository, MIT licence        | ✅ done | https://github.com/ganur2004/safezone, public; GitHub detects the MIT licence |
| 2   | README in English, with a screenshot  | ✅ done | screenshots in `docs/images/`                                                 |
| 3   | Video, under 3 minutes, YouTube/Vimeo | ✅ done | https://youtu.be/uXzbvXpvTok                                                  |
| 4   | Devpost description in English        | ✅ done | from `DEVPOST.md`                                                             |
| 5   | Feedback on the Amazon tools          | ✅ done | `AMAZON-TOOLS-FEEDBACK.md`                                                    |
| 6   | Friction log                          | ✅ done | `FRICTION-LOG.md`, four entries                                               |
| 7   | Mini-competitions named               | ✅ done | AWS Builder qualifies; Open Source: serverless-http pull request #315 is open |
| 8   | Both team members on Devpost          | ✅ done | both on the submission                                                        |
| 9   | Submitted before 22 October           | ✅ done | https://devpost.com/software/safezone-7xzlan                                  |

## What is blocked, and on what

These are the things nobody can finish from inside the repository. Each needs an account, a
recording, or a decision.

### 0. AWS promotional credits — **done**

$150 granted and redeemed, on top of the $100 AWS gives a new account, so there is $250 of headroom
against a stack that costs cents a day. Redeeming required upgrading off the Free plan, which does
not accept promotional credits. The budget alert in the stack emails at 80% of $20.

### 1. Deploy, and the live demo link — **done**

Live at **https://d227d864bivil2.cloudfront.net**, on real data in `ap-southeast-2`, with Amazon
Polly for speech and a NASA FIRMS key in Secrets Manager. The MCP endpoint is
`https://ayqlrjlocnuxkk44xu3xs32pqe0lcqqd.lambda-url.ap-southeast-2.on.aws/mcp`.

What is still off: **Amazon Bedrock**, because the AWS account is being verified. Until then the
agent runs the scripted fallback. Switching it on is one redeploy:

```bash
npm run build && npx cdk deploy --prefix infra \
  -c demoMode=false -c polly=true -c firmsSecret=safezone/firms -c bedrock=true
```

### 2. The video

**Done: https://youtu.be/uXzbvXpvTok.** `VIDEO-SCRIPT.md` has the shot list, the narration and the
timings, and the demo runs from recorded fixtures so it cannot fail live. Record in Chrome — voice
input needs it.

### 3. The Open Source mini challenge — **done**

**Opened: https://github.com/dougmoscrop/serverless-http/pull/315.** The rules do not count SafeZone's own licence:
the contribution has to be _additional_ to the primary submission, which is why the form asks for a
contribution URL **and** a project repository URL separately.

The contribution is ready as a branch, `populate-raw-headers` against `dougmoscrop/serverless-http`:
a fix plus a test for `rawHeaders` never being populated — the bug that made every call to our own
MCP server return 415 on Lambda. It is linked from `DEVPOST.md`. The rules say a pull request does
not have to be merged.

### 4. Alexa+ registration

**Blocked on: developer preview access**, which we could not obtain. The rules accept the simulator,
so this is not required to submit. If access appears, `McpEndpoint` from the deploy output is the
address to register.

### 5. Real fire data for the headline demo

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

- [x] **Make the repository public.** It was pushed private on purpose; a private repo fails the
      first line of the checklist, and a judge cannot open the link.
- [ ] `npm install && npm run build && npm test && npm run lint` on a clean clone
- [ ] `npm run demo` works with no `.env` present
- [x] README's live demo link points at the real CloudFront URL
- [x] `DEVPOST.md` links filled in: demo, repository, video
- [ ] Screenshots regenerated if the interface changed
- [x] Repository made public, and the licence visible on the GitHub page
