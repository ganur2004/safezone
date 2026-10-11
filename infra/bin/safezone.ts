#!/usr/bin/env node
/**
 * CDK entry point (SPEC 10). Everything is configured through context, so no
 * secret or account detail is committed:
 *
 *   npx cdk deploy \
 *     -c demoMode=false \
 *     -c firmsSecret=safezone/firms \
 *     -c nwsUserAgent="SafeZone (you@example.com)" \
 *     -c bedrock=true -c polly=true \
 *     -c budgetEmail=you@example.com
 */
import { App } from "aws-cdk-lib";
import { SafeZoneStack } from "../lib/safezone-stack.js";

const app = new App();

const flag = (name: string, fallback: boolean): boolean => {
  const value = app.node.tryGetContext(name);
  return value === undefined ? fallback : String(value) === "true";
};
const text = (name: string, fallback: string): string =>
  String(app.node.tryGetContext(name) ?? fallback);

const firmsSecret = app.node.tryGetContext("firmsSecret") as string | undefined;
const budgetEmail = app.node.tryGetContext("budgetEmail") as string | undefined;

new SafeZoneStack(app, text("stackName", "SafeZone"), {
  // SPEC 10 planned us-east-1, but AWS assigns a new account's project a Region
  // from the owner's contact country and will not move it without irreversibly
  // converting the account into an Organization. Sydney is where this account
  // lives; CloudFront still serves the simulator from an edge near the viewer.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-2",
  },
  description: "SafeZone: MCP server, agent service and map simulator",
  // Recorded data by default, so a first deploy cannot fail for a missing key.
  demoMode: flag("demoMode", true),
  ...(firmsSecret ? { firmsSecretName: firmsSecret } : {}),
  nwsUserAgent: text("nwsUserAgent", "SafeZone (safezone-hackathon@example.com)"),
  bedrockEnabled: flag("bedrock", false),
  // Inference profiles are Region-scoped: "au." is the Sydney family.
  bedrockModelId: text("bedrockModelId", "au.anthropic.claude-sonnet-4-5-20250929-v1:0"),
  pollyEnabled: flag("polly", false),
  pollyVoiceId: text("pollyVoice", "Joanna"),
  ...(budgetEmail ? { budgetEmail } : {}),
  budgetLimitUsd: Number(text("budgetLimit", "20")),
});
