/** Fetch helpers: timeout, redacted errors, tiny in-memory cache (spec 5.6). */
import { config } from "../config.js";
import { SourceUnavailableError } from "./errors.js";

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Cache key: tool/source name plus coordinates rounded to 0.01° plus params (spec 5.6). */
export function cacheKey(name: string, params: Readonly<Record<string, unknown>>): string {
  const normalized = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const normalizedValue =
        typeof value === "number" && (key === "lat" || key === "lon")
          ? value.toFixed(2)
          : String(value);
      return `${key}=${normalizedValue}`;
    })
    .sort()
    .join("&");
  return `${name}?${normalized}`;
}

export async function withCache<T>(key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await load();
  cache.set(key, { value, expiresAt: now + config.cacheTtlMs });
  return value;
}

export function clearCache(): void {
  cache.clear();
}

interface FetchOptions {
  /** Shown to the user when the source fails; never includes the URL. */
  sourceName: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /**
   * Status codes to hand back instead of raising. Needed for sources that answer
   * a valid question with 4xx — NWS replies 400 "out of bounds" outside the US.
   */
  acceptStatuses?: number[];
}

async function fetchWithTimeout(url: string, options: FetchOptions): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? config.fetchTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "*/*", ...options.headers },
    });
    if (!response.ok && !(options.acceptStatuses ?? []).includes(response.status)) {
      throw new SourceUnavailableError(
        options.sourceName,
        `${options.sourceName} returned HTTP ${response.status}`,
      );
    }
    return response;
  } catch (error) {
    if (error instanceof SourceUnavailableError) throw error;
    const reason = controller.signal.aborted ? "timed out" : "is unreachable";
    throw new SourceUnavailableError(options.sourceName, `${options.sourceName} ${reason}`, {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchText(url: string, options: FetchOptions): Promise<string> {
  const response = await fetchWithTimeout(url, options);
  return response.text();
}

export async function fetchJson<T>(url: string, options: FetchOptions): Promise<T> {
  return (await fetchJsonWithStatus<T>(url, options)).data;
}

/** Like fetchJson, but also reports the status so callers can react to accepted 4xx. */
export async function fetchJsonWithStatus<T>(
  url: string,
  options: FetchOptions,
): Promise<{ status: number; data: T }> {
  const response = await fetchWithTimeout(url, options);
  try {
    return { status: response.status, data: (await response.json()) as T };
  } catch (error) {
    throw new SourceUnavailableError(
      options.sourceName,
      `${options.sourceName} returned an unreadable response`,
      { cause: error },
    );
  }
}

/** POST body variant, for Overpass QL. */
export async function postForJson<T>(
  url: string,
  body: URLSearchParams | string,
  options: FetchOptions & { contentType?: string },
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? config.fetchTimeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": options.contentType ?? "application/x-www-form-urlencoded",
        ...options.headers,
      },
      body,
    });
    if (!response.ok) {
      throw new SourceUnavailableError(
        options.sourceName,
        `${options.sourceName} returned HTTP ${response.status}`,
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof SourceUnavailableError) throw error;
    const reason = controller.signal.aborted ? "timed out" : "is unreachable";
    throw new SourceUnavailableError(options.sourceName, `${options.sourceName} ${reason}`, {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}
