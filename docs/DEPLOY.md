# Deploying SafeZone to AWS

Everything is described as code with AWS CDK in `infra/`, so a deployment is one
command and the whole stack deletes cleanly afterwards.

> **Status: not yet run against a real account.** The stack synthesizes, both Lambda bundles have
> been invoked locally with Function URL payloads, and the templates below are what CDK produces —
> but nobody has run `cdk deploy` yet. Expect the first deploy to surface account-specific things:
> Bedrock model access, the bootstrap stack, and service quotas.

## What gets created

```
CloudFront + S3 (private, OAC)   the simulator, a static bundle
Lambda Function URL              the agent: Bedrock tool loop, Polly, MCP client
Lambda Function URL              the MCP server: the eight tools
CloudWatch log groups            one week of retention
AWS Budgets                      optional monthly cost alert
```

Both services are stateless Express apps behind buffered Function URLs: no API Gateway, no VPC,
nothing to keep warm. The MCP server's URL allows any origin because Alexa+ has to reach it too; the
agent's allows only the CloudFront domain.

Region is `ap-southeast-2` (Sydney). SPEC 10 planned `us-east-1`, but AWS assigns a new account's
project a Region from the owner's contact country and will not move it without irreversibly turning
the account into an Organization and editing the service control policy that pins the Region. The
simulator is unaffected — CloudFront serves it from an edge near the viewer — and only the API calls
cross the Pacific, a couple of hundred milliseconds on an answer that already takes a second or two.

Inference profiles are Region-scoped, so the model id carries the `au.` prefix in Sydney where it
would be `us.` in the United States. To see what a Region offers:

```bash
aws bedrock list-inference-profiles --region ap-southeast-2 --type-equals SYSTEM_DEFINED \
  --query "inferenceProfileSummaries[?status=='ACTIVE'].[inferenceProfileId]" --output text
```

## Before the first deploy

1. Credentials for an account you are willing to spend a little money in:

   ```bash
   aws configure    # or export AWS_PROFILE=...
   aws sts get-caller-identity
   ```

2. Bootstrap CDK once per account and region:

   ```bash
   npx cdk bootstrap aws://<account-id>/ap-southeast-2
   ```

3. Optional, for live fire data — store the NASA FIRMS key in Secrets Manager. It is pulled in at
   deploy time through a CloudFormation dynamic reference, so the value never reaches this
   repository or the synthesized template:

   ```bash
   aws secretsmanager create-secret --name safezone/firms --secret-string "<your-map-key>"
   ```

4. Optional, for the Bedrock agent — enable the model in the Bedrock console under **Model access**
   in the same region. Without this the first call fails with `AccessDeniedException`.

## Deploy

```bash
npm install
npm run deploy
```

That builds every workspace (the simulator bundle has to exist before the stack is synthesized) and
runs `cdk deploy`. To pass options, call the workspace directly:

```bash
npm run build
npx cdk deploy --prefix infra \
  -c demoMode=false \
  -c firmsSecret=safezone/firms \
  -c nwsUserAgent="SafeZone (you@example.com)" \
  -c bedrock=true \
  -c polly=true \
  -c budgetEmail=you@example.com
```

| Context          | Default                                        | What it does                                        |
| ---------------- | ---------------------------------------------- | --------------------------------------------------- |
| `demoMode`       | `true`                                         | `false` makes the tools call the real APIs          |
| `firmsSecret`    | —                                              | Secrets Manager secret holding the NASA FIRMS key   |
| `nwsUserAgent`   | a placeholder address                          | the contact the National Weather Service asks for   |
| `bedrock`        | `false`                                        | the agent uses Bedrock instead of the scripted path |
| `bedrockModelId` | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | any tool-capable model you have access to           |
| `polly`          | `false`                                        | replies are spoken by Polly instead of the browser  |
| `budgetEmail`    | —                                              | address for the monthly cost alert                  |
| `budgetLimit`    | `20`                                           | the alert fires at 80% of this, in USD              |
| `stackName`      | `SafeZone`                                     | deploy a second copy alongside the first            |

The first deploy prints three outputs:

```
SafeZone.SimulatorUrl = https://d111111abcdef8.cloudfront.net
SafeZone.AgentUrl     = https://<id>.lambda-url.ap-southeast-2.on.aws/
SafeZone.McpEndpoint  = https://<id>.lambda-url.ap-southeast-2.on.aws/mcp
```

The simulator reads the agent URL at runtime from `/config.json`, which the same deployment writes
next to the bundle, so the two are wired together without rebuilding anything.

## Check it worked

```bash
curl "$(aws cloudformation describe-stacks --stack-name SafeZone \
  --query 'Stacks[0].Outputs[?OutputKey==`McpEndpoint`].OutputValue' --output text | sed 's|/mcp$|/health|')"

npm run smoke -- "<McpEndpoint>"
npx @modelcontextprotocol/inspector --cli "<McpEndpoint>" --transport http --method tools/list
```

Then open the `SimulatorUrl` and ask one of the three suggested questions.

## Cost

Everything here is request-priced and idles at nearly nothing: Lambda and CloudFront have generous
free tiers, S3 holds a few megabytes, and the only recurring cost of note is Bedrock, per call.
`-c budgetEmail=...` sets a monthly budget (default $20) that emails at 80%.

## Tear it down

```bash
npx cdk destroy --prefix infra
```

The bucket empties itself and the log groups go with the stack, so nothing is left behind except a
Secrets Manager secret you created by hand.

## Bedrock on a new account

Three gates, in this order, and each gives a different error:

1. **Account verification** — "Your account is currently being verified." Clears by itself, in under
   two hours in our case.
2. **The Anthropic use case form** — "Model use case details have not been submitted for this
   account." Submit it from the model's card in the Bedrock **Model catalog**; the Model access page
   is retired and does not have it. Takes a few minutes to apply.
3. **Inference quota** — `ThrottlingException`, and it is the one with no quick fix. A new account
   can have every model inference quota set to **0** while the AWS default for the same quota is
   10,000 requests a minute, so a quota-increase request is refused: "You must provide a quota value
   greater than the default quota value of 10000." Check what the account actually has:

   ```bash
   aws service-quotas get-service-quota --service-code bedrock \
     --quota-code L-4A6BFAB1 --region ap-southeast-2 --query 'Quota.Value'
   ```

   Zero there means the account is not activated for model inference yet, not that a limit is too
   low. It tends to resolve as the account matures; otherwise open an AWS Support case under Service
   Limit Increase. Calling another Region does not help — the zero is account-wide.

Which models an account may use is separate again: the Opus and Sonnet 5 families answered "is not
available for this account" here, while Sonnet 4.5 and Haiku 4.5 were allowed. List what a Region
offers with `aws bedrock list-inference-profiles`, then try one — the error tells you which gate you
are at.

## Known gaps

- **Not deployed yet.** See the note at the top.
- The MCP Function URL is public and unauthenticated, which is what the Alexa+ MCP toolkit expects
  for a demo. For anything beyond a hackathon, put it behind an authorizer.
- `get_route` uses Amazon Location Routes through an API key, the same one as geocoding, so it needs
  no extra IAM permissions. Without a key it falls back to the public OSRM demo server, which is fine
  for a demo but carries no availability guarantee.
- Alexa+ is not connected: the developer preview is not available to us. `McpEndpoint` is the address
  to register once it is.
