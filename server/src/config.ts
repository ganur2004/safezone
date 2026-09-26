/** Environment configuration. See SPEC.md section 11. Secrets never leave this module. */

const asNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asBoolean = (value: string | undefined, fallback = false): boolean =>
  value === undefined ? fallback : /^(1|true|yes)$/i.test(value);

export interface Config {
  port: number;
  demoMode: boolean;
  firmsMapKey: string | undefined;
  amazonLocationApiKey: string | undefined;
  awsRegion: string;
  nwsUserAgent: string;
  allowedOrigins: string[];
  /** External request timeout in milliseconds (spec 5.6). */
  fetchTimeoutMs: number;
  /** In-memory cache TTL in milliseconds (spec 5.6). */
  cacheTtlMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: asNumber(env.PORT, 8787),
    demoMode: asBoolean(env.DEMO_MODE),
    firmsMapKey: env.FIRMS_MAP_KEY?.trim() || undefined,
    amazonLocationApiKey: env.AMAZON_LOCATION_API_KEY?.trim() || undefined,
    awsRegion: env.AWS_REGION?.trim() || "us-east-1",
    nwsUserAgent: env.NWS_USER_AGENT?.trim() || "SafeZone (safezone-hackathon@example.com)",
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    fetchTimeoutMs: asNumber(env.FETCH_TIMEOUT_MS, 8000),
    cacheTtlMs: asNumber(env.CACHE_TTL_MS, 5 * 60 * 1000),
  };
}

export const config: Config = loadConfig();
