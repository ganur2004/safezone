/**
 * SafeZone on AWS (SPEC 10).
 *
 *   CloudFront + S3  ->  the simulator (static)
 *   Lambda URL       ->  the agent      (Bedrock, Polly, MCP client)
 *   Lambda URL       ->  the MCP server (the tools)
 *
 * Both services are stateless Express apps, which is why a buffered Function URL
 * is enough: no session affinity, no VPC, nothing to keep warm.
 *
 * Nothing here contains a secret. A FIRMS key is pulled from Secrets Manager at
 * deploy time through a CloudFormation dynamic reference, so the value never
 * appears in the repository or the synthesized template.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct as IConstruct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

/**
 * esbuild emits ESM, but some dependencies in the chain are CommonJS and reach
 * for `require` at runtime (serverless-http resolves its framework adapter that
 * way). Without this shim the function dies on the first invocation with
 * "Dynamic require of http is not supported" — which only shows up once
 * deployed, so it is worth the two lines here.
 */
const ESM_REQUIRE_SHIM = [
  "import { createRequire as topLevelCreateRequire } from 'module';",
  "const require = topLevelCreateRequire(import.meta.url);",
].join("\n");

export interface SafeZoneStackProps extends StackProps {
  /** false makes the tools call the real APIs; true serves the recorded fixtures. */
  demoMode: boolean;
  /** Secrets Manager secret holding the NASA FIRMS map key, if there is one. */
  firmsSecretName?: string;
  /** Contact address the National Weather Service asks for. */
  nwsUserAgent: string;
  /** Let the agent use Bedrock instead of the scripted fallback. */
  bedrockEnabled: boolean;
  bedrockModelId: string;
  /** Let the agent speak with Polly instead of the browser voice. */
  pollyEnabled: boolean;
  pollyVoiceId: string;
  /** Address for the monthly cost alert; no address means no budget. */
  budgetEmail?: string;
  budgetLimitUsd: number;
}

export class SafeZoneStack extends Stack {
  constructor(scope: Construct, id: string, props: SafeZoneStackProps) {
    super(scope, id, props);

    /* ------------------------------------------------------- the simulator */

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // A demo for a hackathon: the whole stack should delete cleanly afterwards.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, "SiteDistribution", {
      comment: "SafeZone simulator",
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      // A single-page app: unknown paths are the app's own routes, not 404s.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    const siteUrl = `https://${distribution.domainName}`;

    /* ----------------------------------------------------- the MCP server */

    const mcpServer = new NodejsFunction(this, "McpServer", {
      entry: join(repoRoot, "server/src/lambda.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      // Overpass alone can take 12s, and assess_risk runs the sources in parallel.
      timeout: Duration.seconds(30),
      logGroup: shortLivedLogGroup(this, "McpServerLogs"),
      environment: {
        DEMO_MODE: String(props.demoMode),
        // The bundle is one file at the task root; afterBundling puts the
        // recorded responses beside it, not at the package layout on disk.
        FIXTURES_DIR: "/var/task/fixtures",
        NWS_USER_AGENT: props.nwsUserAgent,
        ALLOWED_ORIGINS: siteUrl,
        NODE_OPTIONS: "--enable-source-maps",
        ...(props.firmsSecretName
          ? {
              // Resolved by CloudFormation at deploy time; the value is not in this file.
              FIRMS_MAP_KEY: secretsmanager.Secret.fromSecretNameV2(
                this,
                "FirmsSecret",
                props.firmsSecretName,
              ).secretValue.unsafeUnwrap(),
            }
          : {}),
      },
      bundling: {
        format: OutputFormat.ESM,
        target: "node22",
        sourceMap: true,
        banner: ESM_REQUIRE_SHIM,
        // The tools read recorded responses from disk in DEMO_MODE (SPEC 5.5).
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [
            `mkdir -p ${outputDir}/fixtures`,
            `cp -r ${inputDir}/server/fixtures/* ${outputDir}/fixtures/`,
          ],
        },
      },
    });

    const mcpUrl = mcpServer.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      // Alexa+ has to reach this too, so it cannot be locked to our own origin.
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.POST, lambda.HttpMethod.GET],
        allowedHeaders: ["content-type", "mcp-protocol-version", "accept"],
      },
    });

    /* ------------------------------------------------------- the agent */

    const agent = new NodejsFunction(this, "Agent", {
      entry: join(repoRoot, "agent/src/lambda.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      // A Bedrock tool loop can run several turns, each calling the MCP server.
      timeout: Duration.seconds(60),
      logGroup: shortLivedLogGroup(this, "AgentLogs"),
      environment: {
        MCP_SERVER_URL: `${mcpUrl.url}mcp`,
        BEDROCK_ENABLED: String(props.bedrockEnabled),
        BEDROCK_MODEL_ID: props.bedrockModelId,
        POLLY_ENABLED: String(props.pollyEnabled),
        POLLY_VOICE_ID: props.pollyVoiceId,
        ALLOWED_ORIGINS: siteUrl,
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: {
        format: OutputFormat.ESM,
        target: "node22",
        sourceMap: true,
        banner: ESM_REQUIRE_SHIM,
      },
    });

    if (props.bedrockEnabled) {
      agent.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
          // Inference profiles span regions, so the model may be reached in any of them.
          resources: ["*"],
        }),
      );
    }
    if (props.pollyEnabled) {
      agent.addToRolePolicy(
        new iam.PolicyStatement({ actions: ["polly:SynthesizeSpeech"], resources: ["*"] }),
      );
    }

    const agentUrl = agent.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: [siteUrl],
        allowedMethods: [lambda.HttpMethod.POST, lambda.HttpMethod.GET],
        allowedHeaders: ["content-type"],
      },
    });

    /* --------------------------------------------------- deploy the site */

    const siteAssets = join(repoRoot, "web/dist");
    if (!existsSync(siteAssets)) {
      throw new Error(
        `The simulator has not been built: ${siteAssets} is missing. Run "npm run build" first.`,
      );
    }

    new s3deploy.BucketDeployment(this, "SiteDeployment", {
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
      sources: [
        s3deploy.Source.asset(siteAssets),
        // The simulator reads its agent URL at runtime, so one deployment can
        // wire the two together without rebuilding the bundle.
        s3deploy.Source.jsonData("config.json", { agentUrl: agentUrl.url }),
      ],
    });

    /* ----------------------------------------------------------- budget */

    if (props.budgetEmail) {
      new budgets.CfnBudget(this, "MonthlyBudget", {
        budget: {
          budgetName: `${this.stackName}-monthly`,
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount: props.budgetLimitUsd, unit: "USD" },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: "ACTUAL",
              comparisonOperator: "GREATER_THAN",
              threshold: 80,
              thresholdType: "PERCENTAGE",
            },
            subscribers: [{ subscriptionType: "EMAIL", address: props.budgetEmail }],
          },
        ],
      });
    }

    /* ---------------------------------------------------------- outputs */

    new CfnOutput(this, "SimulatorUrl", { value: siteUrl, description: "Open this" });
    new CfnOutput(this, "AgentUrl", { value: agentUrl.url, description: "POST /api/chat" });
    new CfnOutput(this, "McpEndpoint", {
      value: `${mcpUrl.url}mcp`,
      description: "Register this with Alexa+ or open it in MCP Inspector",
    });
  }
}

/** A week of logs is plenty for a demo, and it keeps the stack deletable. */
function shortLivedLogGroup(scope: IConstruct, id: string): logs.LogGroup {
  return new logs.LogGroup(scope, id, {
    retention: logs.RetentionDays.ONE_WEEK,
    removalPolicy: RemovalPolicy.DESTROY,
  });
}
