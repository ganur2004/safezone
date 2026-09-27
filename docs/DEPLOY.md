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

Region is `us-east-1` by default, which is where Bedrock model access is easiest to get.

## Before the first deploy

1. Credentials for an account you are willing to spend a little money in:

   ```bash
   aws configure    # or export AWS_PROFILE=...
   aws sts get-caller-identity
   ```

2. Bootstrap CDK once per account and region:

   ```bash
   npx cdk bootstrap aws://<account-id>/us-east-1
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
SafeZone.AgentUrl     = https://<id>.lambda-url.us-east-1.on.aws/
SafeZone.McpEndpoint  = https://<id>.lambda-url.us-east-1.on.aws/mcp
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

## Known gaps

- **Not deployed yet.** See the note at the top.
- The MCP Function URL is public and unauthenticated, which is what the Alexa+ MCP toolkit expects
  for a demo. For anything beyond a hackathon, put it behind an authorizer.
- `get_route` uses Amazon Location Routes through an API key, the same one as geocoding, so it needs
  no extra IAM permissions. Without a key it falls back to the public OSRM demo server, which is fine
  for a demo but carries no availability guarantee.
- Alexa+ is not connected: the developer preview is not available to us. `McpEndpoint` is the address
  to register once it is.
